const { createHash } = require('node:crypto');
const { lockVoyageQueue, reorderVoyageQueue } = require('./voyageQueue');
const { checkPolicy, evaluate } = require('./voyageValidationPolicy');
const { etaPredictionAdapter, predictSafely, unavailablePrediction } = require('./etaPredictionAdapter');
const { readUc015DatabaseTarget, verifyUc015Database } = require('../databaseSafety');

const responseColumns = `id AS voyageId, validation_result AS validationResult, validation_reason AS validationReason,
    status, CAST(queue_position AS INT) AS queuePosition, predicted_eta AS predictedEta, ai_status AS aiStatus,
    validated_at AS validatedAt, queued_at AS queuedAt, declared_eta AS declaredEta,
    COALESCE(predicted_eta, declared_eta) AS effectiveEta, priority_level AS priorityLevel,
    validation_policy_hash AS validationPolicyHash`;

function businessError(status, code, body = {}) {
    const error = new Error(code); error.status = status; error.code = code; error.body = body; return error;
}

function createVoyageValidationService({ sql, poolPromise, policy, adapter = etaPredictionAdapter, clock = () => new Date(), etaTimeoutMs = 1500, env = process.env }) {
    const databaseEnv = { DB_SERVER: env.DB_SERVER, DB_DATABASE: env.DB_DATABASE,
        UC015_TEST_SERVER_NAME: env.UC015_TEST_SERVER_NAME, UC015_TEST_DATABASE_GUID: env.UC015_TEST_DATABASE_GUID };
    const request = connection => new sql.Request(connection);

    async function readInputs(connection, id, locked = false) {
        const hint = locked ? 'WITH (UPDLOCK, HOLDLOCK)' : '';
        const rows = await request(connection).input('id', sql.Int, id).query(`/* uc015:inputs */
            SELECT v.*, s.id AS ship_exists, s.is_active, s.imo_number, s.ship_code, s.ship_name, s.ship_type,
                s.capacity, s.length_overall, s.draft
            FROM dbo.voyages v ${hint} LEFT JOIN dbo.ships s ${hint} ON s.id = v.ship_id WHERE v.id = @id`);
        const row = rows.recordset[0];
        if (!row) throw businessError(404, 'VOYAGE_NOT_FOUND');
        if (!['ANNOUNCED', 'VALIDATED', 'QUEUED'].includes(row.status)) throw businessError(422, 'INVALID_VOYAGE_STATUS', { status: row.status });
        const docs = await request(connection).input('ship', sql.Int, row.ship_id).query(`/* uc015:documents */
            SELECT id, document_type, review_status, valid_from, valid_until FROM dbo.ship_documents ${hint} WHERE ship_id = @ship`);
        return { row, documents: docs.recordset };
    }

    async function validate(id) {
        const target = readUc015DatabaseTarget(databaseEnv);
        checkPolicy(policy, clock());
        const pool = await poolPromise;
        await verifyUc015Database(sql, pool, target);
        // Preliminary eligibility before invoking UC016; no SQL transaction survives the adapter call.
        const snapshot = await readInputs(pool, id);
        const initial = evaluate(snapshot.row, snapshot.documents, policy, clock(), snapshot.row.declared_eta);
        const aiInput = row => JSON.stringify({ voyageId: row.id, vesselId: row.ship_id, declaredEta: row.declared_eta });
        const inputHash = row => createHash('sha256').update(aiInput(row)).digest('hex');
        let prediction = { ...unavailablePrediction };
        if (initial.result === 'VALID') {
            // Keep an unchanged queue entry stable on recheck; new inputs permit a fresh prediction.
            prediction = snapshot.row.status === 'QUEUED' && snapshot.row.eta_input_hash === inputHash(snapshot.row)
                ? { predictedEta: snapshot.row.predicted_eta, aiStatus: snapshot.row.ai_status }
                : await predictSafely(adapter, JSON.parse(aiInput(snapshot.row)), clock(), etaTimeoutMs);
        }
        let tx;
        try {
            tx = new sql.Transaction(pool); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
            // This Request uses the same transaction/connection as every subsequent write.
            await verifyUc015Database(sql, tx, target);
            await lockVoyageQueue(sql, tx);
            const { row, documents } = await readInputs(tx, id, true);
            const now = clock(); checkPolicy(policy, now);
            // An ETA prediction for changed inputs must not be attached to the newer voyage.
            if (aiInput(row) !== aiInput(snapshot.row)) prediction = { ...unavailablePrediction };
            if (row.status === 'QUEUED' && row.eta_input_hash === inputHash(row))
                prediction = { predictedEta: row.predicted_eta, aiStatus: row.ai_status };
            const outcome = evaluate(row, documents, policy, now, prediction.predictedEta || row.declared_eta);
            const nextStatus = outcome.result === 'VALID' ? 'QUEUED' : 'ANNOUNCED';
            const history = outcome.result === 'VALID'
                ? (row.status === 'ANNOUNCED' ? ['VALIDATED', 'QUEUED'] : row.status === 'VALIDATED' ? ['QUEUED'] : [])
                : (row.status === 'ANNOUNCED' ? [] : ['ANNOUNCED']);
            // Validation failure is a committed business result, never a thrown DB error.
            await request(tx).input('id', sql.Int, id)
                .input('result', sql.VarChar(30), outcome.result).input('reason', sql.NVarChar(1000), outcome.reason)
                .input('now', sql.DateTime2(3), now).input('ai', sql.VarChar(20), prediction.aiStatus)
                .input('predicted', sql.DateTime2(3), prediction.predictedEta)
                .input('hash', sql.Char(64), policy.hash).input('status', sql.VarChar(30), nextStatus)
                .input('input_hash', sql.Char(64), inputHash(row))
                .query(`/* uc015:save */ UPDATE dbo.voyages SET validation_result=@result, validation_reason=@reason,
                    validated_at=@now, validation_policy_hash=@hash, ai_status=@ai, predicted_eta=@predicted, eta_input_hash=@input_hash,
                    status=@status, queue_position=NULL,
                    queued_at=CASE WHEN @status='QUEUED' THEN COALESCE(queued_at,@now) ELSE NULL END WHERE id=@id`);
            for (const status of history) {
                await request(tx).input('id', sql.Int, id).input('status', sql.VarChar(30), status)
                    .query(`/* uc015:history */ INSERT dbo.voyage_status_history(voyage_id,status,changed_by)
                        VALUES(@id,@status,N'uc015-local-demo')`);
            }
            await reorderVoyageQueue(sql, tx);
            const result = await request(tx).input('id', sql.Int, id)
                .query(`/* uc015:response */ SELECT ${responseColumns} FROM dbo.voyages WHERE id=@id`);
            await tx.commit(); tx = null;
            return { httpStatus: outcome.result === 'VALID' ? 200 : 422, body: result.recordset[0] };
        } catch (error) {
            if (tx) { try { await tx.rollback(); } catch (_) { /* preserve original failure */ } }
            throw error;
        }
    }

    async function queue() {
        const target = readUc015DatabaseTarget(databaseEnv);
        const pool = await poolPromise;
        const tx = new sql.Transaction(pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
            await verifyUc015Database(sql, tx, target);
            await lockVoyageQueue(sql, tx, 'Shared');
            const result = await request(tx).query(`/* uc015:queue */ SELECT ${responseColumns}
                FROM dbo.voyages WHERE status='QUEUED' AND validation_result='VALID' AND queue_position IS NOT NULL ORDER BY queue_position`);
            await tx.commit();
            return { success: true, data: result.recordset };
        } catch (error) {
            try { await tx.rollback(); } catch (_) { /* preserve original error */ }
            throw error;
        }
    }
    return { validate, queue };
}

module.exports = { createVoyageValidationService };
