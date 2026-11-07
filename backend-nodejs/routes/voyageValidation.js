const crypto = require('node:crypto');
const express = require('express');
const { loadPolicy } = require('../services/voyageValidationPolicy');
const { createVoyageValidationService } = require('../services/voyageValidation');

function createVoyageValidationRouter({ sql, poolPromise, env = process.env, policy, adapter, logger = console, clock, etaTimeoutMs }) {
    const router = express.Router();
    // Snapshot configuration once; never log the token or the policy's contents.
    const enabled = env.UC015_DEMO_ENABLED === 'true' && env.NODE_ENV !== 'production';
    const token = env.UC015_OPERATOR_TOKEN;
    let policyError = false;
    if (policy === undefined && enabled) {
        try { policy = loadPolicy(env.UC015_POLICY_FILE); }
        catch (_) { policyError = true; logger.error('UC015 policy configuration invalid'); }
    }
    const service = createVoyageValidationService({ sql, poolPromise, policy, adapter, clock, etaTimeoutMs });

    function protect(req, res, next) {
        if (!enabled || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress))
            return res.status(403).json({ success: false, code: 'UC015_LOCAL_DEMO_ONLY' });
        if (typeof token !== 'string' || token.length < 32 || token.length > 512)
            return res.status(503).json({ success: false, code: 'OPERATOR_KEY_NOT_CONFIGURED' });
        const supplied = req.get('X-UC015-Key');
        const actual = crypto.createHash('sha256').update(supplied || '').digest();
        const expected = crypto.createHash('sha256').update(token).digest();
        if (!supplied || supplied.length > 512 || !crypto.timingSafeEqual(actual, expected))
            return res.status(401).json({ success: false, code: 'INVALID_OPERATOR_KEY' });
        return next();
    }

    async function invoke(res, operation) {
        try { await operation(); }
        catch (error) {
            if (error.status) return res.status(error.status).json({ success: false, code: error.code, ...error.body });
            logger.error('UC015 database/system operation failed', { code: error.number || error.code || 'unknown' });
            return res.status(500).json({ success: false, code: 'INTERNAL_ERROR' });
        }
    }
    // Register /queue before the UC013 /:id route; guards apply only to these two endpoints.
    router.get('/queue', protect, async (_req, res) => invoke(res, async () => res.json(await service.queue())));
    router.post('/:id/validate', protect, async (req, res) => {
        if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647)
            return res.status(400).json({ success: false, code: 'VALIDATION_ERROR' });
        if (policyError) return res.status(503).json({ success: false, code: 'VALIDATION_POLICY_UNAVAILABLE' });
        return invoke(res, async () => { const result = await service.validate(Number(req.params.id)); res.status(result.httpStatus).json(result.body); });
    });
    return router;
}

module.exports = { createVoyageValidationRouter };
