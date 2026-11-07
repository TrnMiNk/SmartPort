const crypto = require('node:crypto');
const express = require('express');

const requiredText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const positiveId = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
const isoWithZone = value => {
    if (typeof value !== 'string') return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
    if (!match) return false;
    const [, y, mo, d, h, mi, s, , offsetHour, offsetMinute] = match;
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(mo) - 1 &&
        date.getUTCDate() === Number(d) && Number(h) <= 23 && Number(mi) <= 59 &&
        Number(s) <= 59 && (!offsetHour || (Number(offsetHour) <= 14 && Number(offsetMinute) <= 59)) &&
        !Number.isNaN(Date.parse(value));
};

function createVoyageRouter({ sql, poolPromise }) {
    const router = express.Router();

    router.post('/', async (req, res) => {
        const body = req.body || {};
        const key = req.get('Idempotency-Key');
        const errors = [];
        if (!positiveId(body.vesselId)) errors.push('vesselId must be a positive integer');
        if (!requiredText(body.voyageNo, 50)) errors.push('voyageNo is required (max 50 characters)');
        if (!positiveId(body.agentId)) errors.push('agentId must be a positive integer');
        if (!positiveId(body.originPortId)) errors.push('originPortId must be a positive integer');
        if (!isoWithZone(body.declaredEta)) errors.push('declaredEta must be ISO 8601 with a timezone');
        if (!requiredText(body.cargoType, 100)) errors.push('cargoType is required (max 100 characters)');
        if (!Number.isInteger(body.declaredTeu) || body.declaredTeu < 0 || body.declaredTeu > 2147483647) errors.push('declaredTeu must be a non-negative integer');
        if (body.serviceRequest != null && (typeof body.serviceRequest !== 'string' || body.serviceRequest.length > 1000)) errors.push('serviceRequest must be at most 1000 characters');
        if (body.priorityLevel != null && (!Number.isInteger(body.priorityLevel) || body.priorityLevel < 0 || body.priorityLevel > 2147483647)) errors.push('priorityLevel must be a non-negative integer');
        if (!key || key.trim().length === 0 || key.length > 200) errors.push('Idempotency-Key header is required (max 200 characters)');
        if (errors.length) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Invalid arrival notice', errors });

        const normalized = {
            vesselId: body.vesselId, voyageNo: body.voyageNo.trim(), agentId: body.agentId,
            originPortId: body.originPortId, declaredEta: new Date(body.declaredEta).toISOString(),
            cargoType: body.cargoType.trim(), declaredTeu: body.declaredTeu,
            serviceRequest: body.serviceRequest == null ? null : body.serviceRequest.trim(),
            priorityLevel: body.priorityLevel == null ? null : body.priorityLevel
        };
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
        let transaction;
        try {
            const pool = await poolPromise;
            transaction = new sql.Transaction(pool);
            await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
            const existingKey = await new sql.Request(transaction)
                .input('key', sql.NVarChar(200), key)
                .query(`SELECT request_fingerprint, voyage_id FROM dbo.voyage_idempotency WITH (UPDLOCK, HOLDLOCK) WHERE idempotency_key = @key`);
            if (existingKey.recordset.length) {
                const prior = existingKey.recordset[0];
                await transaction.rollback(); transaction = null;
                if (prior.request_fingerprint !== fingerprint) return res.status(409).json({ success: false, code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key was already used with a different request', existingVoyageId: prior.voyage_id });
                return res.status(200).json({ success: true, replayed: true, data: await readVoyage(pool, sql, prior.voyage_id) });
            }
            const shipResult = await new sql.Request(transaction)
                .input('id', sql.Int, normalized.vesselId)
                .query(`SELECT id, is_active FROM dbo.ships WITH (UPDLOCK, HOLDLOCK) WHERE id = @id`);
            if (!shipResult.recordset.length) {
                await transaction.rollback(); transaction = null;
                return res.status(404).json({ success: false, code: 'VESSEL_NOT_FOUND', message: 'Vessel does not exist' });
            }
            if (!shipResult.recordset[0].is_active) {
                await transaction.rollback(); transaction = null;
                return res.status(409).json({ success: false, code: 'VESSEL_INACTIVE', message: 'Vessel is inactive' });
            }
            const duplicate = await new sql.Request(transaction)
                .input('ship_id', sql.Int, normalized.vesselId)
                .input('voyage_code', sql.VarChar(50), normalized.voyageNo)
                .query(`SELECT id FROM dbo.voyages WITH (UPDLOCK, HOLDLOCK) WHERE ship_id = @ship_id AND voyage_code = @voyage_code`);
            if (duplicate.recordset.length) {
                const id = duplicate.recordset[0].id;
                await transaction.rollback(); transaction = null;
                return res.status(409).json({ success: false, code: 'VOYAGE_ALREADY_EXISTS', message: 'An arrival notice already exists for this vessel and voyage number', existingVoyageId: id });
            }
            const inserted = await new sql.Request(transaction)
                .input('ship_id', sql.Int, normalized.vesselId)
                .input('voyage_code', sql.VarChar(50), normalized.voyageNo)
                .input('agent_id', sql.Int, normalized.agentId)
                .input('origin_port_id', sql.Int, normalized.originPortId)
                .input('declared_eta', sql.DateTime2(3), new Date(normalized.declaredEta))
                .input('cargo_type', sql.NVarChar(100), normalized.cargoType)
                .input('declared_teu', sql.Int, normalized.declaredTeu)
                .input('service_request', sql.NVarChar(1000), normalized.serviceRequest)
                .input('priority_level', sql.Int, normalized.priorityLevel)
                .query(`INSERT INTO dbo.voyages (ship_id, voyage_code, status, eta, declared_eta, agent_id, origin_port_id, cargo_type, declared_teu, service_request, priority_level, announced_at, announced_by) OUTPUT INSERTED.id VALUES (@ship_id, @voyage_code, 'ANNOUNCED', @declared_eta, @declared_eta, @agent_id, @origin_port_id, @cargo_type, @declared_teu, @service_request, @priority_level, SYSUTCDATETIME(), 'local-demo')`);
            const voyageId = inserted.recordset[0].id;
            await new sql.Request(transaction)
                .input('voyage_id', sql.Int, voyageId)
                .input('key', sql.NVarChar(200), key)
                .input('fingerprint', sql.Char(64), fingerprint)
                .query(`INSERT INTO dbo.voyage_status_history (voyage_id, status, changed_by) VALUES (@voyage_id, 'ANNOUNCED', 'local-demo'); INSERT INTO dbo.voyage_idempotency (idempotency_key, request_fingerprint, voyage_id) VALUES (@key, @fingerprint, @voyage_id)`);
            await transaction.commit(); transaction = null;
            const data = await readVoyage(pool, sql, voyageId);
            return res.status(201).json({ success: true, data });
        } catch (error) {
            if (transaction) { try { await transaction.rollback(); } catch (_) { /* preserve original error */ } }
            console.error('Arrival notice database operation failed:', error);
            return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Unable to create arrival notice' });
        }
    });

    router.get('/:id', async (req, res) => {
        const id = Number(req.params.id);
        if (!positiveId(id)) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'id must be a positive integer' });
        try {
            const data = await readVoyage(await poolPromise, sql, id);
            if (!data) return res.status(404).json({ success: false, code: 'VOYAGE_NOT_FOUND', message: 'Arrival notice does not exist' });
            return res.json({ success: true, data });
        } catch (error) {
            console.error('Arrival notice lookup failed:', error);
            return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Unable to retrieve arrival notice' });
        }
    });
    return router;
}

async function readVoyage(pool, sql, id) {
    const result = await pool.request().input('id', sql.Int, id).query(`SELECT id, ship_id AS vesselId, voyage_code AS voyageNo, agent_id AS agentId, origin_port_id AS originPortId, declared_eta AS declaredEta, cargo_type AS cargoType, declared_teu AS declaredTeu, service_request AS serviceRequest, priority_level AS priorityLevel, status, announced_at AS announcedAt, announced_by AS announcedBy, created_at AS createdAt FROM dbo.voyages WHERE id = @id`);
    return result.recordset[0] || null;
}

module.exports = { createVoyageRouter };
