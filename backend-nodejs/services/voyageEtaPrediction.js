const { createHash } = require('node:crypto');
const { readUc015DatabaseTarget, verifyUc015Database } = require('../databaseSafety');
const { lockVoyageQueue, reorderVoyageQueue } = require('./voyageQueue');
const { checkPolicy, evaluate } = require('./voyageValidationPolicy');
const { createHttpEtaPredictionAdapter, predictSafely } = require('./etaPredictionAdapter');

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const error = (status, code) => Object.assign(new Error(code), { status, code });
const eligible = row => row.validation_result === 'VALID' && row.validated_at != null &&
    ['VALIDATED', 'QUEUED'].includes(row.status) && (row.status !== 'QUEUED' || row.queue_position != null);
const basicInputHash = row => hash({ voyageId: row.id, vesselId: row.ship_id, declaredEta: row.declared_eta });
const pointer = row => row.latest_eta_prediction_cursor ?? '0';

function buildEtaInput(row, history) {
    return { contractVersion: '1', voyageId: row.id,
        vessel: { id: row.ship_id, imo: row.imo_number, type: row.ship_type,
            capacity: row.capacity, lengthOverall: row.length_overall, draft: row.draft },
        originPort: { id: row.origin_port_id, code: row.origin_port_code ?? null },
        declaredEta: new Date(row.declared_eta).toISOString(), cargoType: row.cargo_type,
        declaredTeu: row.declared_teu, speedKnots: null, weather: null,
        historicalArrivals: history.map(h => ({ voyageId: h.id, declaredEta: new Date(h.declared_eta).toISOString(),
            actualArrival: new Date(h.ata).toISOString() })),
        missingFeatures: ['speedKnots', 'weather', ...(history.length ? [] : ['historicalArrivals'])] };
}

const historyColumns = `CAST(id AS varchar(20)) AS predictionId, voyage_id AS voyageId,
    declared_eta AS declaredEta, predicted_eta AS predictedEta, eta_deviation_h AS etaDeviationH,
    eta_confidence AS etaConfidence, ai_status AS aiStatus, model_version AS modelVersion,
    failure_reason AS failureReason, application_status AS applicationStatus, discard_reason AS discardReason,
    CASE WHEN application_status='APPLIED' THEN COALESCE(predicted_eta,declared_eta) ELSE declared_eta END AS effectiveEta,
    requested_at AS requestedAt, predicted_at AS predictedAt`;

function createVoyageEtaService({ sql, poolPromise, policy, env = process.env, adapter, clock = () => new Date(), timeoutMs }) {
    const config = Object.fromEntries(['DB_SERVER', 'DB_DATABASE', 'UC015_TEST_SERVER_NAME', 'UC015_TEST_DATABASE_GUID',
        'ETA_AI_BASE_URL', 'ETA_AI_MODE', 'ETA_AI_MODEL_VERSIONS', 'ETA_AI_API_KEY', 'ETA_AI_TIMEOUT_MS'].map(name => [name,env[name]]));
    const provider = adapter || createHttpEtaPredictionAdapter(config);
    const configuredTimeout = Number(config.ETA_AI_TIMEOUT_MS ?? 10000);
    const budget = timeoutMs ?? (Number.isInteger(configuredTimeout) && configuredTimeout >= 1 && configuredTimeout <= 10000 ? configuredTimeout : 10000);
    const request = connection => new sql.Request(connection);
    async function read(connection, id, locked = false) {
        const hint = locked ? 'WITH (UPDLOCK,HOLDLOCK)' : '';
        const rows = await request(connection).input('id',sql.Int,id).query(`/* uc016:inputs */
            SELECT v.*, CONVERT(varchar(20),v.latest_eta_prediction_id) AS latest_eta_prediction_cursor,
                s.id AS ship_exists, s.is_active, s.imo_number, s.ship_code, s.ship_name, s.ship_type,
                s.capacity,s.length_overall,s.draft,p.port_code AS origin_port_code
            FROM dbo.voyages v ${hint} LEFT JOIN dbo.ships s ${hint} ON s.id=v.ship_id
            LEFT JOIN dbo.ports p ${locked ? 'WITH (HOLDLOCK)' : ''} ON p.id=v.origin_port_id WHERE v.id=@id`);
        if (!rows.recordset.length) throw error(404,'VOYAGE_NOT_FOUND');
        return rows.recordset[0];
    }
    async function features(connection, row, locked = false) {
        const history = await request(connection).input('ship',sql.Int,row.ship_id).input('id',sql.Int,row.id)
            .input('port',sql.Int,row.origin_port_id).query(`/* uc016:features */
                SELECT TOP(20) id,declared_eta,ata FROM dbo.voyages ${locked ? 'WITH (HOLDLOCK)' : ''}
                WHERE ship_id=@ship AND origin_port_id=@port AND id<>@id AND status='COMPLETED'
                    AND declared_eta IS NOT NULL AND ata IS NOT NULL ORDER BY ata DESC,id DESC`);
        return buildEtaInput(row,history.recordset);
    }
    async function checkDocuments(connection, row, eta, now, locked = false) {
        checkPolicy(policy,now);
        const result = await request(connection).input('ship',sql.Int,row.ship_id).query(`/* uc016:documents */
            SELECT id,document_type,review_status,valid_from,valid_until FROM dbo.ship_documents
            ${locked ? 'WITH (UPDLOCK,HOLDLOCK)' : ''} WHERE ship_id=@ship`);
        return evaluate(row,result.recordset,policy,now,eta).result === 'VALID';
    }
    async function predict(id) {
        const target = readUc015DatabaseTarget(config);
        const pool = await poolPromise; await verifyUc015Database(sql,pool,target);
        const snapshot = await read(pool,id);
        if (!eligible(snapshot)) throw error(422,'VOYAGE_NOT_VALIDATED');
        if (!await checkDocuments(pool,snapshot,snapshot.declared_eta,clock())) throw error(422,'VOYAGE_DOCUMENTS_NO_LONGER_VALID');
        const input = await features(pool,snapshot);
        const inputHash = hash(input);
        const requestedAt = clock();
        // The full external request (including body read) runs before opening any SQL transaction.
        const result = await predictSafely(provider,input,requestedAt,budget);
        let tx;
        try {
            tx = new sql.Transaction(pool); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
            await verifyUc015Database(sql,tx,target); await lockVoyageQueue(sql,tx);
            const current = await read(tx,id,true);
            let failure;
            if (!eligible(current)) failure = { code: 'VOYAGE_NO_LONGER_VALID', status: 422 };
            else if (hash(await features(tx,current,true)) !== inputHash) failure = { code: 'ETA_INPUT_CHANGED', status: 409 };
            else if (pointer(current) !== pointer(snapshot)) failure = { code: 'ETA_PREDICTION_SUPERSEDED', status: 409 };
            else if (!await checkDocuments(tx,current,result.predictedEta || current.declared_eta,clock(),true))
                failure = { code: 'DOCUMENTS_NOT_VALID_FOR_EFFECTIVE_ETA', status: 422 };
            const completedAt = clock();
            const inserted = await request(tx).input('id',sql.Int,id).input('declared',sql.DateTime2(3),snapshot.declared_eta)
                .input('predicted',sql.DateTime2(3),result.predictedEta).input('confidence',sql.Decimal(9,8),result.etaConfidence)
                .input('ai',sql.VarChar(20),result.aiStatus).input('model',sql.NVarChar(100),result.modelVersion)
                .input('reason',sql.VarChar(100),result.failureReason).input('application',sql.VarChar(20),failure ? 'DISCARDED' : 'APPLIED')
                .input('discard',sql.VarChar(100),failure?.code || null)
                .input('hash',sql.Char(64),inputHash).input('json',sql.NVarChar(sql.MAX),JSON.stringify(input))
                .input('requested',sql.DateTime2(3),requestedAt).input('completed',sql.DateTime2(3),completedAt)
                .query(`/* uc016:history */ INSERT dbo.voyage_eta_predictions(voyage_id,declared_eta,predicted_eta,
                    eta_confidence,ai_status,model_version,failure_reason,application_status,discard_reason,input_hash,input_json,requested_at,predicted_at)
                    OUTPUT CAST(INSERTED.id AS varchar(20)) AS predictionId
                    VALUES(@id,@declared,@predicted,@confidence,@ai,@model,@reason,@application,@discard,@hash,@json,@requested,@completed)`);
            const predictionId = inserted.recordset[0].predictionId;
            if (!failure) {
                await request(tx).input('id',sql.Int,id).input('prediction_id',sql.BigInt,predictionId)
                    .input('predicted',sql.DateTime2(3),result.predictedEta).input('ai',sql.VarChar(20),result.aiStatus)
                    .input('hash',sql.Char(64),basicInputHash(current)).query(`/* uc016:apply */
                        UPDATE dbo.voyages SET predicted_eta=@predicted,ai_status=@ai,eta_input_hash=@hash,
                            latest_eta_prediction_id=@prediction_id WHERE id=@id`);
                if (current.status === 'QUEUED') await reorderVoyageQueue(sql,tx);
            }
            const saved = await request(tx).input('prediction_id',sql.BigInt,predictionId)
                .query(`/* uc016:result */ SELECT ${historyColumns} FROM dbo.voyage_eta_predictions WHERE id=@prediction_id`);
            await tx.commit(); tx = null;
            return { httpStatus: failure?.status || 200, body: failure
                ? { success: false, code: failure.code, currentDeclaredEta: current.declared_eta,
                    currentEffectiveEta: current.predicted_eta || current.declared_eta, attempt: saved.recordset[0] } : saved.recordset[0] };
        } catch (cause) {
            if (tx) { try { await tx.rollback(); } catch (_) { /* preserve original error */ } }
            throw cause;
        }
    }
    async function history(id, beforeId = null) {
        const target = readUc015DatabaseTarget(config); const pool = await poolPromise;
        const tx = new sql.Transaction(pool); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
            await verifyUc015Database(sql,tx,target); await lockVoyageQueue(sql,tx,'Shared'); await read(tx,id);
            const result = await request(tx).input('id',sql.Int,id).input('before',sql.BigInt,beforeId)
                .query(`/* uc016:list */ SELECT TOP(51) ${historyColumns} FROM dbo.voyage_eta_predictions
                    WHERE voyage_id=@id AND (@before IS NULL OR id<@before) ORDER BY id DESC`);
            const data = result.recordset.slice(0,50);
            await tx.commit();
            return { success: true, data, nextBeforeId: result.recordset.length > 50 ? data.at(-1).predictionId : null };
        } catch (cause) {
            try { await tx.rollback(); } catch (_) { /* preserve original error */ }
            throw cause;
        }
    }
    return { predict, history };
}

module.exports = { createVoyageEtaService, buildEtaInput };
