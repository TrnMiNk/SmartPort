const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const dbPath = require.resolve('../db');

const state = { ships: new Map([[7, { is_active: true }]]), voyages: new Map(), keys: new Map(), history: [], nextId: 1, failHistory: false };
function reset() { state.voyages.clear(); state.keys.clear(); state.history.length = 0; state.nextId = 1; state.failHistory = false; }
class Transaction {
    constructor() { this.pending = []; }
    async begin() {}
    async commit() { for (const action of this.pending) action(); }
    async rollback() { this.pending.length = 0; }
}
class Request {
    constructor(transaction) { this.transaction = transaction; this.params = {}; }
    input(name, _type, value) { this.params[name] = value; return this; }
    async query(query) {
        const p = this.params;
        if (query.includes('FROM dbo.voyage_idempotency')) {
            const value = state.keys.get(p.key); return { recordset: value ? [value] : [] };
        }
        if (query.includes('FROM dbo.ships')) {
            const ship = state.ships.get(p.id); return { recordset: ship ? [{ id: p.id, ...ship }] : [] };
        }
        if (query.includes('FROM dbo.voyages WITH')) {
            const voyage = [...state.voyages.values()].find(v => v.ship_id === p.ship_id && v.voyage_code === p.voyage_code);
            return { recordset: voyage ? [{ id: voyage.id }] : [] };
        }
        if (query.includes('INSERT INTO dbo.voyages')) {
            const id = state.nextId++;
            const row = { id, ship_id: p.ship_id, voyage_code: p.voyage_code, agent_id: p.agent_id,
                origin_port_id: p.origin_port_id, declared_eta: p.declared_eta, cargo_type: p.cargo_type,
                declared_teu: p.declared_teu, service_request: p.service_request, priority_level: p.priority_level,
                status: 'ANNOUNCED', announced_by: 'local-demo' };
            this.transaction.pending.push(() => state.voyages.set(id, row));
            return { recordset: [{ id }] };
        }
        if (query.includes('INSERT INTO dbo.voyage_status_history')) {
            if (state.failHistory) throw new Error('mock history failure');
            this.transaction.pending.push(() => { state.history.push({ voyage_id: p.voyage_id, status: 'ANNOUNCED' }); state.keys.set(p.key, { request_fingerprint: p.fingerprint, voyage_id: p.voyage_id }); });
            return { recordset: [] };
        }
        if (query.includes('SELECT id, ship_id AS vesselId')) {
            const row = state.voyages.get(p.id); return { recordset: row ? [{ ...row, vesselId: row.ship_id, voyageNo: row.voyage_code }] : [] };
        }
        throw new Error(`Unexpected test query: ${query}`);
    }
}
const sql = { Transaction, Request, Int: 'Int', VarChar: () => 'VarChar', NVarChar: () => 'NVarChar', Char: () => 'Char', DateTime2: () => 'DateTime2', ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' } };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { sql, poolPromise: Promise.resolve({ request: () => new Request(null) }) } };
let server; let baseUrl;
before(async () => { const app = require('../server'); server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); delete require.cache[dbPath]; });
const payload = overrides => ({ vesselId: 7, voyageNo: 'SP-2026-001', agentId: 1, originPortId: 1, declaredEta: '2026-11-12T03:30:00+07:00', cargoType: 'container', declaredTeu: 1800, ...overrides });
async function post(body, key = 'test-key') { return fetch(`${baseUrl}/api/voyages`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) }); }

test('creates announced voyage and status history transactionally', async () => { reset(); const response = await post(payload()); const result = await response.json(); assert.equal(response.status, 201); assert.equal(result.data.status, 'ANNOUNCED'); assert.equal(state.history.length, 1); assert.equal(state.voyages.get(1).declared_eta.toISOString(), '2026-11-11T20:30:00.000Z'); });
test('rejects missing fields, malformed ETA, and invalid TEU', async () => { reset(); assert.equal((await post({ ...payload(), cargoType: '' })).status, 400); assert.equal((await post(payload({ declaredEta: 'tomorrow' }))).status, 400); assert.equal((await post(payload({ declaredEta: '2026-02-30T12:00:00Z' }))).status, 400); assert.equal((await post(payload({ declaredTeu: -1 }))).status, 400); assert.equal((await post(payload({ declaredTeu: 1.2 }))).status, 400); });
test('reports unknown and inactive vessels', async () => { reset(); assert.equal((await post(payload({ vesselId: 999 }))).status, 404); state.ships.set(8, { is_active: false }); assert.equal((await post(payload({ vesselId: 8 }))).status, 409); });
test('rejects duplicate voyage and safely replays idempotent request', async () => { reset(); const first = await post(payload(), 'same'); const id = (await first.json()).data.id; assert.equal((await post(payload(), 'retry')).status, 409); const replay = await post(payload(), 'same'); assert.equal(replay.status, 200); assert.equal((await replay.json()).data.id, id); assert.equal((await post(payload({ declaredTeu: 2 }), 'same')).status, 409); assert.equal(state.voyages.size, 1); });
test('rolls back voyage when status history write fails', async () => { reset(); state.failHistory = true; assert.equal((await post(payload())).status, 500); assert.equal(state.voyages.size, 0); assert.equal(state.history.length, 0); });
test('requires the idempotency header and retrieves a created voyage', async () => {
    reset();
    const noKey = await fetch(`${baseUrl}/api/voyages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload()) });
    assert.equal(noKey.status, 400);
    const created = await post(payload(), 'get-test'); const id = (await created.json()).data.id;
    assert.equal((await fetch(`${baseUrl}/api/voyages/${id}`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/voyages/999`)).status, 404);
});
