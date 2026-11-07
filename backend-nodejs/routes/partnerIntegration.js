const crypto = require('node:crypto');
const express = require('express');

const text = (v, max) => typeof v === 'string' && !!v.trim() && v.trim().length <= max;
const isoUtc = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/.test(v) && !Number.isNaN(Date.parse(v));

function createPartnerIntegrationRouter({ sql, poolPromise, logger = console }) {
  const router = express.Router();
  router.post('/voyages', async (req, res) => {
    const rawKey = req.get('X-API-Key');
    if (!rawKey || rawKey.length > 512) return res.status(401).json({ success: false, code: 'INVALID_API_KEY' });
    const apiKeyHash = crypto.createHash('sha256').update(rawKey, 'utf8').digest();
    const body = req.body || {};
    const errors = [];
    if (typeof body.vesselImo !== 'string' || !/^[0-9]{7}$/.test(body.vesselImo)) errors.push('vesselImo must contain exactly 7 digits');
    if (!text(body.voyageNo, 50)) errors.push('voyageNo is required (max 50 characters)');
    if (!text(body.originPortCode, 20)) errors.push('originPortCode is required (max 20 characters)');
    if (!isoUtc(body.declaredEta)) errors.push('declaredEta must be an ISO 8601 UTC timestamp ending in Z');
    if (!text(body.cargoType, 100)) errors.push('cargoType is required (max 100 characters)');
    if (!Number.isInteger(body.declaredTeu) || body.declaredTeu < 0 || body.declaredTeu > 2147483647) errors.push('declaredTeu must be a non-negative integer');
    if (body.serviceRequest != null && (typeof body.serviceRequest !== 'string' || body.serviceRequest.length > 1000)) errors.push('serviceRequest must be at most 1000 characters');
    const idem = req.get('Idempotency-Key');
    if (!idem || !idem.trim() || idem.length > 200) errors.push('Idempotency-Key header is required (max 200 characters)');
    if (errors.length) { logger.info('UC-014 integration request rejected: validation'); return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', errors }); }
    const normalized = { vesselImo: body.vesselImo, voyageNo: body.voyageNo.trim(), originPortCode: body.originPortCode.trim(), declaredEta: body.declaredEta, cargoType: body.cargoType.trim(), declaredTeu: body.declaredTeu, serviceRequest: body.serviceRequest == null ? null : body.serviceRequest.trim() };
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    let tx;
    try {
      const pool = await poolPromise;
      // SQL lookup is by hash; timingSafeEqual also avoids ordinary byte comparisons.
      const keyRows = await pool.request().input('hash', sql.VarBinary(32), apiKeyHash)
        .query(`SELECT k.key_hash, k.partner_id, p.agent_id FROM dbo.partner_api_keys k JOIN dbo.integration_partners p ON p.id=k.partner_id WHERE k.key_hash=@hash AND k.is_active=1 AND k.revoked_at IS NULL AND k.expires_at>SYSUTCDATETIME() AND p.is_active=1`);
      const row = keyRows.recordset[0];
      if (!row || !crypto.timingSafeEqual(Buffer.from(row.key_hash), apiKeyHash)) { logger.info('UC-014 integration request rejected: authentication'); return res.status(401).json({ success: false, code: 'INVALID_API_KEY' }); }
      tx = new sql.Transaction(pool); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      const idemRow = await new sql.Request(tx).input('partner', sql.Int, row.partner_id).input('endpoint', sql.VarChar(50), 'POST:/api/v1/integration/voyages').input('key', sql.NVarChar(200), idem)
        .query('SELECT request_fingerprint, voyage_id FROM dbo.partner_voyage_idempotency WITH (UPDLOCK,HOLDLOCK) WHERE partner_id=@partner AND endpoint_code=@endpoint AND idempotency_key=@key');
      if (idemRow.recordset.length) {
        const prior = idemRow.recordset[0]; await tx.rollback(); tx = null;
        if (prior.request_fingerprint !== fingerprint) return res.status(409).json({ success: false, code: 'IDEMPOTENCY_KEY_REUSED', referenceId: prior.voyage_id });
        return res.status(200).json({ success: true, replayed: true, referenceId: prior.voyage_id, status: 'ANNOUNCED', missingFields: [] });
      }
      const shipResult = await new sql.Request(tx).input('imo', sql.VarChar(7), normalized.vesselImo).query('SELECT id,is_active FROM dbo.ships WITH (UPDLOCK,HOLDLOCK) WHERE imo_number=@imo');
      if (!shipResult.recordset.length) { await tx.rollback(); tx = null; logger.info('UC-014 integration request rejected: vessel_not_found'); return res.status(404).json({ success:false, code:'VESSEL_NOT_FOUND', field:'vesselImo' }); }
      const ship = shipResult.recordset[0];
      if (!ship.is_active) { await tx.rollback(); tx = null; logger.info('UC-014 integration request rejected: vessel_inactive'); return res.status(422).json({success:false,code:'VESSEL_INACTIVE',field:'vesselImo'}); }
      const grant = await new sql.Request(tx).input('partner', sql.Int, row.partner_id).input('ship', sql.Int, ship.id).query('SELECT 1 AS allowed FROM dbo.partner_vessel_access WITH (UPDLOCK,HOLDLOCK) WHERE partner_id=@partner AND ship_id=@ship AND is_active=1');
      if (!grant.recordset.length) { await tx.rollback(); tx = null; logger.info('UC-014 integration request rejected: vessel_scope'); return res.status(403).json({success:false,code:'VESSEL_NOT_AUTHORIZED'}); }
      const portResult = await new sql.Request(tx).input('code', sql.VarChar(20), normalized.originPortCode).query('SELECT id FROM dbo.ports WHERE port_code=@code AND is_active=1');
      if (!portResult.recordset.length) { await tx.rollback(); tx = null; logger.info('UC-014 integration request rejected: origin_port'); return res.status(422).json({success:false,code:'ORIGIN_PORT_NOT_FOUND',field:'originPortCode'}); }
      const duplicate = await new sql.Request(tx).input('ship', sql.Int, ship.id).input('voyage', sql.VarChar(50), normalized.voyageNo).query('SELECT id FROM dbo.voyages WITH (UPDLOCK,HOLDLOCK) WHERE ship_id=@ship AND voyage_code=@voyage');
      if (duplicate.recordset.length) { const id=duplicate.recordset[0].id; await tx.rollback(); tx=null; logger.info('UC-014 integration request rejected: duplicate_voyage'); return res.status(409).json({success:false,code:'VOYAGE_ALREADY_EXISTS',referenceId:id}); }
      const inserted = await new sql.Request(tx).input('ship',sql.Int,ship.id).input('voyage',sql.VarChar(50),normalized.voyageNo).input('agent',sql.Int,row.agent_id).input('port',sql.Int,portResult.recordset[0].id).input('eta',sql.DateTime2(3),new Date(normalized.declaredEta)).input('cargo',sql.NVarChar(100),normalized.cargoType).input('teu',sql.Int,normalized.declaredTeu).input('service',sql.NVarChar(1000),normalized.serviceRequest)
        .query(`INSERT dbo.voyages(ship_id,voyage_code,status,eta,declared_eta,agent_id,origin_port_id,cargo_type,declared_teu,service_request,announced_at,announced_by) OUTPUT INSERTED.id VALUES(@ship,@voyage,'ANNOUNCED',@eta,@eta,@agent,@port,@cargo,@teu,@service,SYSUTCDATETIME(),N'partner-api')`);
      const id=inserted.recordset[0].id;
      await new sql.Request(tx).input('id',sql.Int,id).input('partner',sql.Int,row.partner_id).input('endpoint',sql.VarChar(50),'POST:/api/v1/integration/voyages').input('key',sql.NVarChar(200),idem).input('fingerprint',sql.Char(64),fingerprint)
        .query(`INSERT dbo.voyage_status_history(voyage_id,status,changed_by) VALUES(@id,'ANNOUNCED',N'partner-api'); INSERT dbo.partner_voyage_idempotency(partner_id,endpoint_code,idempotency_key,request_fingerprint,voyage_id) VALUES(@partner,@endpoint,@key,@fingerprint,@id)`);
      await tx.commit(); tx=null;
      logger.info('UC-014 integration request accepted', { partnerId: row.partner_id, referenceId: id });
      return res.status(201).json({success:true,referenceId:id,status:'ANNOUNCED',missingFields:[]});
    } catch (error) {
      if (tx) { try { await tx.rollback(); } catch (_) {} }
      logger.error('UC-014 integration database failure', { code: error.number || error.code || 'unknown' });
      return res.status(500).json({success:false,code:'INTERNAL_ERROR'});
    }
  });
  return router;
}
module.exports = { createPartnerIntegrationRouter };
