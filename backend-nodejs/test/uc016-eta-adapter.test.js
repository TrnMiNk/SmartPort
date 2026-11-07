const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHttpEtaPredictionAdapter, predictSafely } = require('../services/etaPredictionAdapter');
const now = new Date('2026-11-07T00:00:00Z');
const valid = () => ({ aiStatus: 'AVAILABLE', predictionSource: 'MODEL', predictedEta: '2026-11-10T12:00:00Z',
    etaConfidence: 0.75, modelVersion: 'unit-test-model-v1' });
let server, base, behavior, forwarded;
before(async () => {
    server = http.createServer(async (req,res) => {
        let body = ''; for await (const chunk of req) body += chunk;
        forwarded = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body) };
        behavior(req,res);
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
beforeEach(() => { forwarded = null; behavior = (_req,res) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(valid())); }; });
const env = () => ({ ETA_AI_BASE_URL: base, ETA_AI_MODE: 'MODEL', ETA_AI_MODEL_VERSIONS: 'unit-test-model-v1' });
const run = (options = {}, input = { voyageId: 1, speedKnots: null, weather: null }) =>
    predictSafely(createHttpEtaPredictionAdapter({ ...env(), ...options }),input,now,1000);

test('real HTTP adapter posts to /predict/eta with actual input and configured credential', async () => {
    const key = require('node:crypto').randomBytes(24).toString('hex');
    const result = await run({ ETA_AI_API_KEY: key });
    assert.equal(result.aiStatus,'AVAILABLE'); assert.equal(result.etaConfidence,0.75);
    assert.equal(result.modelVersion,'unit-test-model-v1');
    assert.equal(forwarded.method,'POST'); assert.equal(forwarded.url,'/predict/eta');
    assert.deepEqual(forwarded.body,{ voyageId: 1, speedKnots: null, weather: null });
    assert.equal(forwarded.headers.authorization,`Bearer ${key}`);
    assert.equal(JSON.stringify(result).includes(key),false);
});
for (const confidence of [0,1]) test(`confidence boundary ${confidence} is accepted`,async () => {
    behavior = (_req,res) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ...valid(),etaConfidence: confidence })); };
    assert.equal((await run()).etaConfidence,confidence);
});
for (const [name, patch] of [
    ['negative confidence',{ etaConfidence: -0.1 }], ['confidence above one',{ etaConfidence: 1.01 }],
    ['string confidence',{ etaConfidence: '0.7' }], ['null confidence',{ etaConfidence: null }],
    ['missing model version',{ modelVersion: null }], ['impossible date',{ predictedEta: '2026-02-30T12:00:00Z' }],
    ['missing ETA',{ predictedEta: null }], ['past ETA',{ predictedEta: '2026-11-06T00:00:00Z' }],
    ['timezone missing',{ predictedEta: '2026-11-10T12:00:00' }], ['source missing',{ predictionSource: null }]
]) test(`${name} cannot be AVAILABLE`,async () => {
    behavior = (_req,res) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ...valid(),...patch })); };
    const result = await run(); assert.equal(result.aiStatus,'UNAVAILABLE'); assert.equal(result.predictedEta,null);
    assert.equal(result.etaConfidence,null); assert.equal(result.modelVersion,null);
});
test('DEMO_SIMULATED is rejected even when a model version has been allowed',async () => {
    behavior = (_req,res) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ...valid(),predictionSource:'DEMO_SIMULATED' })); };
    assert.equal((await run()).failureReason,'DEMO_NOT_ACCEPTED');
});
test('unapproved model version is rejected',async () => {
    const result = await run({ ETA_AI_MODEL_VERSIONS: 'some-other-reviewed-model' });
    assert.equal(result.failureReason,'UNAPPROVED_MODEL');
});
for (const [name, status, type, body] of [
    ['upstream error',500,'application/json','{}'], ['malformed JSON',200,'application/json','{'],
    ['HTML response',200,'text/html','<html>error</html>'], ['null JSON',200,'application/json','null'],
    ['oversized response',200,'application/json','x'.repeat(65537)]
]) test(`${name} falls back without exposing provider body`,async () => {
    behavior = (_req,res) => { res.statusCode=status; res.setHeader('Content-Type',type); res.end(body); };
    const result = await run(); assert.equal(result.aiStatus,'UNAVAILABLE'); assert.equal(result.predictedEta,null);
    assert.equal(result.etaConfidence,null);
});
test('redirects are not followed to another destination',async () => {
    behavior = (_req,res) => { res.statusCode=302; res.setHeader('Location','http://example.invalid/private'); res.end(); };
    assert.equal((await run()).aiStatus,'UNAVAILABLE');
});
test('timeout covers response body, not just headers',async () => {
    behavior = (_req,res) => { res.setHeader('Content-Type','application/json'); res.write('{'); };
    const result = await predictSafely(createHttpEtaPredictionAdapter(env()),{ voyageId:1 },now,30);
    assert.equal(result.failureReason,'TIMEOUT'); assert.equal(result.predictedEta,null);
});
test('connection failure is UNAVAILABLE',async () => {
    const adapter = createHttpEtaPredictionAdapter(env(),async () => { throw new Error('private provider details'); });
    const result = await predictSafely(adapter,{},now,1000);
    assert.equal(result.failureReason,'SERVICE_ERROR'); assert.equal(JSON.stringify(result).includes('private'),false);
});
test('not configured and unsafe configuration do not call a provider',async () => {
    for (const config of [{}, { ...env(),ETA_AI_BASE_URL:'http://example.invalid' }, { ...env(),ETA_AI_MODE:'DEMO_SIMULATED' },
        { ...env(),ETA_AI_MODEL_VERSIONS:'' }, { ...env(),ETA_AI_BASE_URL:'https://user:password@example.invalid' }]) {
        let called=false;
        const result=await predictSafely(createHttpEtaPredictionAdapter(config,async () => { called=true; }),{},now,1000);
        assert.equal(called,false); assert.equal(result.aiStatus,'UNAVAILABLE');
    }
});
