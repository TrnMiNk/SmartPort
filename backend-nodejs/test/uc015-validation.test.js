const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { parsePolicy } = require('../services/voyageValidationPolicy');
const { createVoyageValidationService } = require('../services/voyageValidation');
const { createVoyageValidationRouter } = require('../routes/voyageValidation');
const now = new Date('2026-11-07T05:00:00Z');
const clock = () => new Date(now);
const token = require('node:crypto').randomBytes(32).toString('hex');
const databaseEnv = { DB_SERVER: 'localhost\\TEST', DB_DATABASE: 'CangThongMinh_UC015_Test',
    UC015_TEST_SERVER_NAME: 'TEST-HOST\\TEST', UC015_TEST_DATABASE_GUID: '12345678-1234-1234-1234-123456789abc' };
const rawPolicy = () => ({ mode: 'DEMO', policyId: 'reviewed-test-policy', reviewedAt: '2026-11-01T00:00:00Z',
    validUntil: '2026-12-01T00:00:00Z', requiredDocumentTypesByShipType: { Container: ['Registry', 'Safety'] }, restrictedImos: [] });
const policy = () => parsePolicy(rawPolicy());
const voyage = (id = 1, overrides = {}) => ({ id, ship_id: 7, ship_exists: 7, is_active: true,
    ship_code: 'S7', ship_name: 'Test vessel', ship_type: 'Container', imo_number: '9074729',
    capacity: 100, length_overall: 80, draft: 8, voyage_code: `TEST-${id}`, agent_id: 1, origin_port_id: 1,
    cargo_type: 'container', declared_teu: 10, declared_eta: new Date('2026-11-12T03:00:00Z'),
    priority_level: null, status: 'ANNOUNCED', ...overrides });
const documents = () => ['Registry', 'Safety'].map((type, i) => ({ id: i + 1, ship_id: 7,
    document_type: type, review_status: 'APPROVED', valid_from: new Date('2026-11-01T00:00:00Z'),
    valid_until: new Date('2026-11-30T00:00:00Z') }));
const publicRow = row => ({ voyageId: row.id, validationResult: row.validation_result ?? null,
    validationReason: row.validation_reason ?? null, status: row.status, queuePosition: row.queue_position ?? null,
    predictedEta: row.predicted_eta ?? null, aiStatus: row.ai_status ?? null, validatedAt: row.validated_at,
    queuedAt: row.queued_at, declaredEta: row.declared_eta, effectiveEta: row.predicted_eta || row.declared_eta,
    priorityLevel: row.priority_level, validationPolicyHash: row.validation_policy_hash });

// Staged state is visible only on commit. Mutex models sp_getapplock orchestration,
// not SQL Server's actual engine/DDL/locking behavior.
function database() {
    const db = { state: { voyages: [voyage()], documents: documents(), history: [] }, fail: null, active: 0,
        commits: 0, rollbacks: 0, queries: [], lockModes: [], tail: Promise.resolve(),
        identity: { databaseName: databaseEnv.DB_DATABASE, serverName: databaseEnv.UC015_TEST_SERVER_NAME,
            databaseGuid: databaseEnv.UC015_TEST_DATABASE_GUID } };
    class Transaction {
        async begin(level) { assert.equal(level, 'SERIALIZABLE'); db.active++; }
        async commit() { if (this.staged) db.state = this.staged; db.active--; db.commits++; this.release?.(); }
        async rollback() { db.active--; db.rollbacks++; this.release?.(); }
    }
    class Request {
        constructor(connection) { this.tx = connection instanceof Transaction ? connection : null; this.p = {}; }
        input(name, type, value) { assert.notEqual(type, undefined); this.p[name] = value; return this; }
        async query(query) {
            db.queries.push(query);
            const tag = /uc015:(\w+)/.exec(query)?.[1];
            if (tag === db.fail) throw new Error(`Injected ${tag} failure`);
            if (tag === 'lock') {
                assert.ok(this.tx); assert.ok(query.includes("@LockOwner='Transaction'")); db.lockModes.push(this.p.mode);
                const previous = db.tail;
                db.tail = new Promise(resolve => { this.tx.release = resolve; }); await previous;
                this.tx.staged = structuredClone(db.state); return { recordset: [{ lockResult: 0 }] };
            }
            const state = this.tx?.staged || db.state;
            const row = state.voyages.find(v => v.id === this.p.id);
            switch (tag) {
                case 'database': return { recordset: [structuredClone(this.tx && db.transactionIdentity ? db.transactionIdentity : db.identity)] };
                case 'inputs':
                    if (this.tx) assert.match(query, /UPDLOCK, HOLDLOCK/);
                    return { recordset: row ? [structuredClone(row)] : [] };
                case 'documents': return { recordset: structuredClone(state.documents.filter(d => d.ship_id === this.p.ship)) };
                case 'save': {
                    assert.ok(this.tx?.staged); const p = this.p;
                    Object.assign(row, { validation_result: p.result, validation_reason: p.reason, validated_at: p.now,
                        validation_policy_hash: p.hash, eta_input_hash: p.input_hash, ai_status: p.ai, predicted_eta: p.predicted,
                        queue_position: null, status: p.status, queued_at: p.status === 'QUEUED' ? row.queued_at || p.now : null });
                    return { recordset: [] };
                }
                case 'history': state.history.push({ voyageId: this.p.id, status: this.p.status }); return { recordset: [] };
                case 'reorder': {
                    assert.ok(this.tx?.staged); assert.match(query, /ROW_NUMBER\(\)/);
                    state.voyages.forEach(v => { v.queue_position = null; });
                    const rows = state.voyages.filter(v => v.status === 'QUEUED' && v.validation_result === 'VALID');
                    rows.sort((a, b) => new Date(a.predicted_eta || a.declared_eta) - new Date(b.predicted_eta || b.declared_eta) ||
                        (b.priority_level || 0) - (a.priority_level || 0) || a.queued_at - b.queued_at || a.id - b.id);
                    rows.forEach((v, i) => { v.queue_position = i + 1; }); return { recordset: [] };
                }
                case 'response': return { recordset: [structuredClone(publicRow(row))] };
                case 'queue': return { recordset: structuredClone(state.voyages.filter(v => v.queue_position != null)
                    .sort((a, b) => a.queue_position - b.queue_position).map(publicRow)) };
                default: throw new Error(`Unexpected SQL: ${query}`);
            }
        }
    }
    db.sql = { Transaction, Request, Int: 'Int', VarChar: () => 'VarChar', NVarChar: () => 'NVarChar',
        Char: () => 'Char', DateTime2: () => 'DateTime2', ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' } };
    db.poolPromise = Promise.resolve({});
    db.service = options => createVoyageValidationService({ sql: db.sql, poolPromise: db.poolPromise, policy: policy(), clock, env: databaseEnv, ...options });
    return db;
}
let db;
beforeEach(() => { db = database(); });
test('valid documents commit VALID, two lifecycle transitions and one queue membership', async () => {
    const result = await db.service().validate(1);
    assert.equal(result.httpStatus, 200); assert.equal(result.body.validationResult, 'VALID');
    assert.equal(result.body.validationReason, null); assert.equal(result.body.status, 'QUEUED');
    assert.equal(result.body.queuePosition, 1); assert.equal(result.body.aiStatus, 'UNAVAILABLE');
    assert.equal(result.body.predictedEta, null);
    assert.deepEqual(db.state.history.map(h => h.status), ['VALIDATED', 'QUEUED']); assert.equal(db.commits, 1);
});
for (const [name, patch] of [
    ['missing document', docs => docs.pop()],
    ['PENDING', docs => { docs[0].review_status = 'PENDING'; }],
    ['REJECTED', docs => { docs[0].review_status = 'REJECTED'; }],
    ['expired', docs => { docs[0].valid_until = new Date('2026-11-06T00:00:00Z'); }],
    ['expires before ETA', docs => { docs[0].valid_until = new Date('2026-11-09T00:00:00Z'); }],
    ['missing expiry', docs => { docs[0].valid_until = null; }],
    ['missing start', docs => { docs[0].valid_from = null; }],
    ['not yet effective', docs => { docs[0].valid_from = new Date('2026-11-08T00:00:00Z'); }]
]) test(`${name} commits MISSING_DOCUMENTS with reason and does not enqueue`, async () => {
    patch(db.state.documents); const originalDocs = structuredClone(db.state.documents); let called = false;
    const result = await db.service({ adapter: { predict: async () => { called = true; } } }).validate(1);
    assert.equal(result.httpStatus, 422); assert.equal(result.body.validationResult, 'MISSING_DOCUMENTS');
    assert.match(result.body.validationReason, /DOCUMENTS_NOT_ELIGIBLE/); assert.equal(result.body.status, 'ANNOUNCED');
    assert.equal(result.body.queuePosition, null); assert.equal(db.commits, 1); assert.equal(db.state.history.length, 0);
    assert.deepEqual(db.state.documents, originalDocs); assert.equal(called, false);
});
test('another approved valid document satisfies the rule even if an extra pending version exists', async () => {
    db.state.documents.push({ ...db.state.documents[0], id: 9, review_status: 'PENDING' });
    assert.equal((await db.service().validate(1)).httpStatus, 200);
});
for (const [name, changes, reason] of [
    ['invalid IMO', { imo_number: '9074728' }, 'INVALID_IMO'],
    ['missing IMO', { imo_number: null }, 'INVALID_IMO'],
    ['inactive vessel', { is_active: false }, 'VESSEL_INACTIVE_OR_MISSING'],
    ['missing data', { agent_id: null }, 'REQUIRED_DATA_INVALID'],
    ['invalid technical data', { draft: null }, 'REQUIRED_DATA_INVALID']
]) test(`${name} commits REJECTED without putting it in lifecycle status`, async () => {
    Object.assign(db.state.voyages[0], changes); const result = await db.service().validate(1);
    assert.equal(result.httpStatus, 422); assert.equal(result.body.validationResult, 'REJECTED');
    assert.equal(result.body.validationReason, reason); assert.equal(db.state.voyages[0].status, 'ANNOUNCED');
    assert.equal(db.state.voyages[0].queue_position, null);
});
test('reviewed demo restriction rejects the vessel, saving the operator reason', async () => {
    const raw = rawPolicy(); raw.restrictedImos = [{ imo: '9074729', reason: 'Demo restriction reviewed' }];
    const result = await db.service({ policy: parsePolicy(raw) }).validate(1);
    assert.equal(result.httpStatus, 422); assert.equal(result.body.validationResult, 'REJECTED');
    assert.match(result.body.validationReason, /Demo restriction reviewed/);
});
test('undefined ship-type document policy cannot silently pass', async () => {
    db.state.voyages[0].ship_type = 'Tanker'; const result = await db.service().validate(1);
    assert.equal(result.httpStatus, 422); assert.match(result.body.validationReason, /POLICY_NOT_DEFINED/);
});
test('missing/expired policy is system unavailability rather than missing documents', async () => {
    const before = structuredClone(db.state);
    await assert.rejects(db.service({ policy: null }).validate(1), { status: 503, code: 'VALIDATION_POLICY_UNAVAILABLE' });
    await assert.rejects(db.service({ clock: () => new Date('2027-01-01T00:00:00Z') }).validate(1), { status: 503 });
    assert.deepEqual(db.state, before);
});
test('policy parser rejects empty requirements, unknown trust mode, invalid restrictions and impossible dates', () => {
    for (const override of [{ mode: 'PRODUCTION' }, { requiredDocumentTypesByShipType: { Container: [] } },
        { restrictedImos: [{ imo: 'bad', reason: 'x' }] }, { reviewedAt: '2026-02-30T00:00:00Z' }])
        assert.throws(() => parsePolicy({ ...rawPolicy(), ...override }));
});
test('voyage not found returns 404 without writes', async () => {
    await assert.rejects(db.service().validate(999), { status: 404, code: 'VOYAGE_NOT_FOUND' }); assert.equal(db.commits, 0);
});
for (const status of ['PLANNED', 'COMPLETED', 'CANCELLED', 'DOCKED'])
    test(`wrong lifecycle ${status} returns 422 without overwriting validation`, async () => {
        db.state.voyages[0].status = status; const before = structuredClone(db.state);
        await assert.rejects(db.service().validate(1), { status: 422, code: 'INVALID_VOYAGE_STATUS' }); assert.deepEqual(db.state, before);
    });
test('AI error falls back to declared ETA, with no SQL transaction during adapter call', async () => {
    const adapter = { async predict() { assert.equal(db.active, 0); throw new Error('Provider down'); } };
    const result = await db.service({ adapter }).validate(1);
    assert.equal(result.httpStatus, 200); assert.equal(result.body.aiStatus, 'UNAVAILABLE'); assert.equal(result.body.predictedEta, null);
    assert.equal(result.body.effectiveEta.toISOString(), '2026-11-12T03:00:00.000Z');
});
test('AI timeout is aborted and falls back without a transaction during wait', async () => {
    let signal; const adapter = { predict(_input, options) { assert.equal(db.active, 0); signal = options.signal; return new Promise(() => {}); } };
    const result = await db.service({ adapter, etaTimeoutMs: 10 }).validate(1);
    assert.equal(signal.aborted, true); assert.equal(result.body.aiStatus, 'UNAVAILABLE');
});
test('valid provider ETA is stored distinctly and drives queue ordering', async () => {
    db.state.voyages.push(voyage(2, { declared_eta: new Date('2026-11-10T00:00:00Z') })); await db.service().validate(2);
    const adapter = { async predict() { return { aiStatus: 'AVAILABLE', predictionSource: 'MODEL', etaConfidence: 0.8, modelVersion: 'unit-fixture-v1', predictedEta: '2026-11-08T00:00:00Z' }; } };
    const result = await db.service({ adapter }).validate(1); assert.equal(result.body.aiStatus, 'AVAILABLE');
    assert.equal(result.body.queuePosition, 1); assert.equal(db.state.voyages.find(v => v.id === 2).queue_position, 2);
});
test('documents must cover predicted ETA as well', async () => {
    const adapter = { async predict() { return { aiStatus: 'AVAILABLE', predictionSource: 'MODEL', etaConfidence: 0.8, modelVersion: 'unit-fixture-v1', predictedEta: '2026-12-02T00:00:00Z' }; } };
    assert.equal((await db.service({ adapter }).validate(1)).body.validationResult, 'MISSING_DOCUMENTS');
});
test('malformed provider response never masquerades as a prediction', async () => {
    const adapter = { async predict() { return { aiStatus: 'AVAILABLE', predictionSource: 'MODEL', etaConfidence: 0.8, modelVersion: 'unit-fixture-v1', predictedEta: 'tomorrow' }; } };
    assert.equal((await db.service({ adapter }).validate(1)).body.aiStatus, 'UNAVAILABLE');
});
test('ETA first, higher priority at equal ETA, then stable queue time/id', async () => {
    db.state.voyages.push(voyage(2, { priority_level: 5 }), voyage(3, { priority_level: 9,
        declared_eta: new Date('2026-11-13T00:00:00Z') }), voyage(4, { priority_level: 5 }));
    for (const id of [1, 3, 2, 4]) await db.service().validate(id);
    assert.deepEqual((await db.service().queue()).data.map(v => v.voyageId), [2, 4, 1, 3]); assert.equal(db.lockModes.at(-1), 'Shared');
});
test('validation replay preserves membership, position, queuedAt and history count', async () => {
    const service = db.service(); const first = await service.validate(1); const second = await service.validate(1);
    assert.equal(first.body.queuePosition, second.body.queuePosition); assert.deepEqual(first.body.queuedAt, second.body.queuedAt);
    assert.equal(db.state.voyages.length, 1); assert.equal(db.state.history.length, 2);
});
test('recheck uses existing AI prediction for unchanged inputs', async () => {
    let calls = 0; const service = db.service({ adapter: { async predict() { calls++; return { aiStatus: 'AVAILABLE', predictionSource: 'MODEL', etaConfidence: 0.8, modelVersion: 'unit-fixture-v1', predictedEta: '2026-11-08T00:00:00Z' }; } } });
    await service.validate(1); await service.validate(1); assert.equal(calls, 1);
});
test('invalid recheck removes membership and commits ANNOUNCED only once', async () => {
    await db.service().validate(1); db.state.documents.pop(); const result = await db.service().validate(1); await db.service().validate(1);
    assert.equal(result.httpStatus, 422); assert.equal(result.body.queuePosition, null);
    assert.deepEqual(db.state.history.map(v => v.status), ['VALIDATED', 'QUEUED', 'ANNOUNCED']);
});
for (const failure of ['save', 'history', 'reorder', 'response'])
    test(`${failure} failure rolls back validation, history, lifecycle and queue`, async () => {
        const before = structuredClone(db.state); db.fail = failure;
        await assert.rejects(db.service().validate(1), new RegExp(`Injected ${failure} failure`));
        assert.deepEqual(db.state, before); assert.equal(db.rollbacks, 1); assert.equal(db.active, 0);
        db.fail = null; assert.equal((await db.service().validate(1)).httpStatus, 200);
    });
test('reorder failure restores existing entries as well as the new voyage', async () => {
    await db.service().validate(1); db.state.voyages.push(voyage(2)); const before = structuredClone(db.state); db.fail = 'reorder';
    await assert.rejects(db.service().validate(2)); assert.deepEqual(db.state, before);
});
test('concurrent validations serialize without duplicate positions/membership/extra history', async () => {
    db.state.voyages.push(voyage(2), voyage(3));
    await Promise.all(Array.from({ length: 18 }, (_, i) => db.service().validate(i % 3 + 1)));
    assert.deepEqual(db.state.voyages.map(v => v.queue_position).sort(), [1, 2, 3]); assert.equal(db.state.history.length, 6); assert.equal(db.active, 0);
});
test('documents changing during adapter wait are checked again under locks', async () => {
    const adapter = { async predict() { db.state.documents.pop(); return { aiStatus: 'UNAVAILABLE' }; } };
    assert.equal((await db.service({ adapter }).validate(1)).body.validationResult, 'MISSING_DOCUMENTS');
});
test('ETA changing during adapter wait discards stale prediction', async () => {
    const adapter = { async predict() { db.state.voyages[0].declared_eta = new Date('2026-11-13T00:00:00Z');
        return { aiStatus: 'AVAILABLE', predictionSource: 'MODEL', etaConfidence: 0.8, modelVersion: 'unit-fixture-v1', predictedEta: '2026-11-08T00:00:00Z' }; } };
    const result = await db.service({ adapter }).validate(1); assert.equal(result.body.aiStatus, 'UNAVAILABLE'); assert.equal(result.body.predictedEta, null);
});
test('status changing to COMPLETED during AI wait cannot be overwritten', async () => {
    const adapter = { async predict() { db.state.voyages[0].status = 'COMPLETED'; return { aiStatus: 'UNAVAILABLE' }; } };
    await assert.rejects(db.service({ adapter }).validate(1), { status: 422 }); assert.equal(db.state.voyages[0].status, 'COMPLETED'); assert.equal(db.state.history.length, 0);
});

let server; let base; let httpDb;
const env = { ...databaseEnv, UC015_DEMO_ENABLED: 'true', UC015_OPERATOR_TOKEN: token };
before(async () => {
    const app = express(); app.use(express.json());
    app.use('/api/voyages', (req, res, next) => createVoyageValidationRouter({ sql: httpDb.sql,
        poolPromise: httpDb.poolPromise, policy: policy(), env, clock, logger: { error() {} } })(req, res, next));
    app.get('/api/voyages/:id', (_req, res) => res.status(400).json({ code: 'UC013_ID_FALLTHROUGH' }));
    server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/voyages`;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
async function post(id, key = token) {
    return fetch(`${base}/${id}/validate`, { method: 'POST', headers: key == null ? {} : { 'X-UC015-Key': key } });
}
test('HTTP 200/422 preserve result bodies; /queue takes precedence over /:id', async () => {
    httpDb = db; assert.equal((await post(1)).status, 200);
    let response = await fetch(`${base}/queue`, { headers: { 'X-UC015-Key': token } });
    assert.equal(response.status, 200); assert.equal((await response.json()).data.length, 1);
    httpDb.state.documents.pop(); response = await post(1); assert.equal(response.status, 422);
    assert.equal((await response.json()).validationResult, 'MISSING_DOCUMENTS');
});
test('HTTP guards reject missing/wrong keys on both routes and disabled/production mode', async () => {
    httpDb = db;
    for (const key of [null, 'wrong']) {
        assert.equal((await post(1, key)).status, 401);
        assert.equal((await fetch(`${base}/queue`, { headers: key ? { 'X-UC015-Key': key } : {} })).status, 401);
    }
    delete env.UC015_DEMO_ENABLED; assert.equal((await post(1)).status, 403);
    env.UC015_DEMO_ENABLED = 'true'; env.NODE_ENV = 'production'; assert.equal((await post(1)).status, 403); delete env.NODE_ENV;
    assert.equal(db.queries.length, 0);
});
test('HTTP bad id, missing voyage and DB failure return distinct 400/404/500', async () => {
    httpDb = db; assert.equal((await post('abc')).status, 400); assert.equal((await post(999)).status, 404);
    db.fail = 'history'; const response = await post(1); assert.equal(response.status, 500); assert.equal((await response.json()).code, 'INTERNAL_ERROR');
});
test('HTTP rejects missing operator configuration and invalid policy before DB work', async () => {
    function callRouter(settings, address = '127.0.0.1', path = '/1/validate') {
        return new Promise((resolve, reject) => {
            const router = createVoyageValidationRouter({ sql: db.sql, poolPromise: db.poolPromise,
                clock, logger: { error() {} }, ...settings });
            const req = { method: path === '/queue' ? 'GET' : 'POST', url: path,
                socket: { remoteAddress: address }, get: () => token };
            const res = { status(status) { this.code = status; return this; }, json(body) { resolve({ status: this.code, body }); } };
            router(req, res, reject);
        });
    }
    let response = await callRouter({ env: { UC015_DEMO_ENABLED: 'true' }, policy: policy() });
    assert.equal(response.status, 503); assert.equal(response.body.code, 'OPERATOR_KEY_NOT_CONFIGURED');
    response = await callRouter({ env: { ...env, UC015_POLICY_FILE: '/nonexistent/uc015-policy.json' } });
    assert.equal(response.status, 503); assert.equal(response.body.code, 'VALIDATION_POLICY_UNAVAILABLE');
    response = await callRouter({ env, policy: policy() }, '192.0.2.10', '/queue');
    assert.equal(response.status, 403); assert.equal(db.queries.length, 0);
});

for (const [name, options] of [
    ['missing explicit target', { env: {} }],
    ['original database configured', { env: { ...databaseEnv, DB_DATABASE: 'CangThongMinh' } }]
]) test(`${name} blocks direct UC015 service calls before any SQL`, async () => {
    const service = db.service(options);
    await assert.rejects(service.validate(1), { status: 503, code: 'UC015_TEST_DATABASE_REQUIRED' });
    await assert.rejects(service.queue(), { status: 503, code: 'UC015_TEST_DATABASE_REQUIRED' });
    assert.equal(db.queries.length, 0);
});

test('actual original database blocks both HTTP routes despite a test database in env', async () => {
    httpDb = db; db.identity.databaseName = 'CangThongMinh';
    const before = structuredClone(db.state);
    const response = await post(1);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'UC015_TEST_DATABASE_MISMATCH');
    const queue = await fetch(`${base}/queue`, { headers: { 'X-UC015-Key': token } });
    assert.equal(queue.status, 503);
    assert.deepEqual(db.state, before);
    assert.equal(db.queries.some(q => /uc015:(inputs|save|history|reorder|queue|lock)/.test(q)), false);
});

test('verification uses the transaction connection before any business lock/read/write', async () => {
    db.transactionIdentity = { ...db.identity, databaseGuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    const before = structuredClone(db.state);
    await assert.rejects(db.service().validate(1), { status: 503, code: 'UC015_TEST_DATABASE_MISMATCH' });
    assert.deepEqual(db.state, before);
    assert.equal(db.rollbacks, 1); assert.equal(db.active, 0);
    assert.equal(db.queries.some(q => /uc015:(save|history|reorder|lock)/.test(q)), false);
});

test('identity changing during adapter wait is rejected and rolls back without touching queue/history', async () => {
    const before = structuredClone(db.state);
    const adapter = { async predict() { db.identity.databaseName = 'CangThongMinh'; return { aiStatus: 'UNAVAILABLE' }; } };
    await assert.rejects(db.service({ adapter }).validate(1), { status: 503, code: 'UC015_TEST_DATABASE_MISMATCH' });
    assert.deepEqual(db.state, before); assert.equal(db.rollbacks, 1);
});

test('metadata query failure is system unavailability, never a stored missing-documents result', async () => {
    const before = structuredClone(db.state); db.fail = 'database';
    await assert.rejects(db.service().validate(1), { status: 503, code: 'UC015_TEST_DATABASE_UNVERIFIED' });
    assert.deepEqual(db.state, before); assert.equal(db.commits, 0);
});
