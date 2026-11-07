// One contract for the UC015 fast path and the explicit UC016 HTTP workflow.
const reasons = new Set(['NOT_CONFIGURED', 'INVALID_CONFIGURATION', 'TIMEOUT', 'SERVICE_ERROR', 'INVALID_RESPONSE',
    'DEMO_NOT_ACCEPTED', 'UNAPPROVED_MODEL']);
const unavailable = reason => ({ predictedEta: null, etaConfidence: null, modelVersion: null,
    aiStatus: 'UNAVAILABLE', failureReason: reasons.has(reason) ? reason : 'SERVICE_ERROR' });
const unavailablePrediction = unavailable('NOT_CONFIGURED');
// Keep inline UC015 off until an asynchronous workflow owns its longer network budget.
const etaPredictionAdapter = { async predict() { return { ...unavailablePrediction }; } };

function validUtc(value) {
    return typeof value === 'string' && /^(?!0000)\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
        Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

function normalizePrediction(value, now) {
    if (value?.aiStatus === 'DEMO_SIMULATED' || value?.predictionSource === 'DEMO_SIMULATED') return unavailable('DEMO_NOT_ACCEPTED');
    if (value?.aiStatus === 'UNAVAILABLE') return unavailable(value.failureReason || 'SERVICE_ERROR');
    const timestamp = value?.predictedEta instanceof Date ? value.predictedEta.toISOString() : value?.predictedEta;
    if (value?.aiStatus !== 'AVAILABLE' || value.predictionSource !== 'MODEL' || !validUtc(timestamp) ||
        new Date(timestamp) < now || typeof value.etaConfidence !== 'number' || !Number.isFinite(value.etaConfidence) ||
        value.etaConfidence < 0 || value.etaConfidence > 1 || typeof value.modelVersion !== 'string' ||
        !value.modelVersion.trim() || value.modelVersion.length > 100 || /[\x00-\x1f\x7f]/.test(value.modelVersion)) return unavailable('INVALID_RESPONSE');
    return { predictedEta: new Date(timestamp), etaConfidence: value.etaConfidence,
        modelVersion: value.modelVersion, aiStatus: 'AVAILABLE', failureReason: null };
}

async function predictSafely(adapter, input, now, timeoutMs = 1500) {
    const controller = new AbortController();
    let timer;
    try {
        const prediction = await Promise.race([
            Promise.resolve().then(() => adapter.predict(input, { signal: controller.signal })),
            new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(unavailable('TIMEOUT')); }, timeoutMs); })
        ]);
        return normalizePrediction(prediction, now);
    } catch (_) { return unavailable('SERVICE_ERROR'); }
    finally { clearTimeout(timer); }
}

function createHttpEtaPredictionAdapter(env = process.env, fetchImpl = fetch) {
    const versions = new Set((env.ETA_AI_MODEL_VERSIONS || '').split(',').map(s => s.trim()).filter(Boolean));
    let endpoint;
    if (!env.ETA_AI_BASE_URL) return etaPredictionAdapter;
    try {
        const base = new URL(env.ETA_AI_BASE_URL);
        const localHttp = base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
        if ((!localHttp && base.protocol !== 'https:') || base.username || base.password || base.search || base.hash ||
            base.pathname !== '/' || env.ETA_AI_MODE !== 'MODEL' || !versions.size ||
            /[\r\n]/.test(env.ETA_AI_API_KEY || '')) throw new Error('Invalid provider configuration');
        endpoint = new URL('/predict/eta', base).toString();
    } catch (_) { return { async predict() { return unavailable('INVALID_CONFIGURATION'); } }; }
    const apiKey = env.ETA_AI_API_KEY;
    return { async predict(input, { signal }) {
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal,
            headers, body: JSON.stringify(input) });
        if (!response.ok) { await response.body?.cancel(); return unavailable('SERVICE_ERROR'); }
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
            await response.body?.cancel(); return unavailable('INVALID_RESPONSE');
        }
        const reader = response.body.getReader();
        const chunks = []; let size = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read(); if (done) break;
                size += value.byteLength;
                if (size > 65536) { await reader.cancel(); return unavailable('INVALID_RESPONSE'); }
                chunks.push(Buffer.from(value));
            }
        } finally { reader.releaseLock(); }
        let result;
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch (_) { return unavailable('INVALID_RESPONSE'); }
        if (result?.aiStatus === 'AVAILABLE' && result.predictionSource === 'MODEL' && !versions.has(result.modelVersion))
            return unavailable('UNAPPROVED_MODEL');
        return result;
    } };
}

module.exports = { etaPredictionAdapter, predictSafely, unavailablePrediction, unavailable,
    createHttpEtaPredictionAdapter, validUtc };
