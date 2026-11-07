const express = require('express');
const { createUc015LocalGuard } = require('./voyageValidation');
const { loadPolicy } = require('../services/voyageValidationPolicy');
const { createVoyageEtaService } = require('../services/voyageEtaPrediction');

function createVoyageEtaRouter({ sql, poolPromise, env = process.env, policy, adapter, clock, timeoutMs, logger = console }) {
    const router = express.Router(); const guard = createUc015LocalGuard(env);
    let invalidPolicy = false;
    if (policy === undefined && env.UC015_DEMO_ENABLED === 'true') {
        try { policy = loadPolicy(env.UC015_POLICY_FILE); } catch (_) { invalidPolicy = true; }
    }
    const service = createVoyageEtaService({ sql, poolPromise, env, policy, adapter, clock, timeoutMs });
    function id(req,res,next) {
        if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647)
            return res.status(400).json({ success: false, code: 'VALIDATION_ERROR' });
        return next();
    }
    async function invoke(res, operation) {
        try { await operation(); }
        catch (error) {
            if (error.status) return res.status(error.status).json({ success: false, code: error.code });
            logger.error('UC016 system/database operation failed', { code: error.number || error.code || 'unknown' });
            return res.status(500).json({ success: false, code: 'INTERNAL_ERROR' });
        }
    }
    router.post('/:id/eta-prediction', guard, id, (req,res) => invoke(res,async () => {
        if (invalidPolicy) return res.status(503).json({ success: false, code: 'VALIDATION_POLICY_UNAVAILABLE' });
        const result = await service.predict(Number(req.params.id)); res.status(result.httpStatus).json(result.body);
    }));
    router.get('/:id/eta-predictions', guard, id, (req,res) => invoke(res,async () => {
        const before = req.query.beforeId;
        if (before !== undefined && (typeof before !== 'string' || !/^[1-9]\d{0,18}$/.test(before) || BigInt(before)>9223372036854775807n))
            return res.status(400).json({ success: false, code: 'VALIDATION_ERROR' });
        res.json(await service.history(Number(req.params.id),before));
    }));
    return router;
}
module.exports = { createVoyageEtaRouter };
