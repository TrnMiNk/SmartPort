const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { createPartnerIntegrationRouter } = require('../routes/partnerIntegration');

const secret = crypto.randomBytes(32).toString('base64url');
const rotatedSecret = crypto.randomBytes(32).toString('base64url');
const otherSecret = crypto.randomBytes(32).toString('base64url');
const endpoint = 'POST:/api/v1/integration/voyages';
const hash = value => crypto.createHash('sha256').update(value).digest();
const scope = (partner, route, key) => JSON.stringify([partner, route, key]);
const state = {};

function credential(token, partner_id, agent_id) {
  return { key_hash: hash(token), partner_id, agent_id, is_active: true,
    revoked_at: null, expires_at: new Date(Date.now() + 3600000), partnerActive: true };
}
function reset() {
  Object.assign(state, {
    keys: [credential(secret, 7, 9), credential(rotatedSecret, 7, 9), credential(otherSecret, 8, 10)],
    ships: new Map([['1234567', { id: 3, is_active: true }]]),
    grants: new Set(['7:3']), ports: new Map([['DEMO', { id: 4 }]]),
    voyages: new Map(), history: [], idem: new Map(), nextId: 41,
    failHistory: false, failIdempotency: false, transactions: [],
    stats: { commits: 0, rollbacks: 0, voyageInserts: 0, historyAttempts: 0 }
  });
}

// Keep durable state separate from writes staged inside a transaction.
class Tx {
  constructor() { this.pending = []; this.active = false; state.transactions.push(this); }
  async begin() { this.active = true; }
  stage(write) { assert.equal(this.active, true); this.pending.push(write); }
  async commit() {
    assert.equal(this.active, true);
    for (const write of this.pending) write();
    this.pending = [];
    this.active = false;
    state.stats.commits++;
  }
  async rollback() {
    assert.equal(this.active, true);
    this.pending = [];
    this.active = false;
    state.stats.rollbacks++;
  }
}
class Request {
  constructor(tx) { this.tx = tx; this.params = {}; }
  input(name, _type, value) { this.params[name] = value; return this; }
  async query(query) {
    const p = this.params;
    if (query.includes('FROM dbo.partner_api_keys')) {
      // Check the query contract too: the mock must not hide removed SQL auth predicates.
      for (const predicate of ['k.key_hash=@hash', 'k.is_active=1', 'k.revoked_at IS NULL',
        'k.expires_at>SYSUTCDATETIME()', 'p.is_active=1']) assert.ok(query.includes(predicate), predicate);
      const row = state.keys.find(key => key.key_hash.equals(p.hash) && key.is_active &&
        key.revoked_at === null && key.expires_at > new Date() && key.partnerActive);
      return { recordset: row ? [row] : [] };
    }
    if (query.includes('FROM dbo.partner_voyage_idempotency')) {
      assert.ok(query.includes('partner_id=@partner AND endpoint_code=@endpoint AND idempotency_key=@key'));
      const row = state.idem.get(scope(p.partner, p.endpoint, p.key));
      return { recordset: row ? [row] : [] };
    }
    if (query.includes('FROM dbo.ships')) {
      const row = state.ships.get(p.imo);
      return { recordset: row ? [row] : [] };
    }
    if (query.includes('FROM dbo.partner_vessel_access')) {
      return { recordset: state.grants.has(p.partner + ':' + p.ship) ? [{ allowed: 1 }] : [] };
    }
    if (query.includes('FROM dbo.ports')) {
      const row = state.ports.get(p.code);
      return { recordset: row ? [row] : [] };
    }
    if (query.includes('FROM dbo.voyages WITH')) {
      const row = [...state.voyages.values()].find(v => v.ship === p.ship && v.voyage === p.voyage);
      return { recordset: row ? [{ id: row.id }] : [] };
    }
    if (query.includes('INSERT dbo.voyages')) {
      const row = { id: state.nextId++, ...p };
      this.tx.stage(() => state.voyages.set(row.id, row));
      state.stats.voyageInserts++;
      return { recordset: [{ id: row.id }] };
    }
    if (query.includes('INSERT dbo.voyage_status_history')) {
      state.stats.historyAttempts++;
      if (state.failHistory) throw Error('mock history persistence failure');
      this.tx.stage(() => state.history.push({ voyage_id: p.id, status: 'ANNOUNCED' }));
      if (state.failIdempotency) throw Error('mock idempotency persistence failure');
      this.tx.stage(() => state.idem.set(scope(p.partner, p.endpoint, p.key), {
        request_fingerprint: p.fingerprint, voyage_id: p.id
      }));
      return { recordset: [] };
    }
    throw Error('unexpected query ' + query);
  }
}
const sqlType = name => size => ({ name, size });
const sql = {
  Transaction: Tx, Request, Int: 'int', VarBinary: sqlType('binary'),
  VarChar: sqlType('varchar'), NVarChar: sqlType('nvarchar'),
  Char: sqlType('char'), DateTime2: sqlType('datetime'),
  ISOLATION_LEVEL: { SERIALIZABLE: 1 }
};
let server, url;
const body = overrides => ({ vesselImo: '1234567', voyageNo: 'DEMO-01', originPortCode: 'DEMO',
  declaredEta: '2026-11-20T10:00:00Z', cargoType: 'container', declaredTeu: 10, ...overrides });
async function send(payload = body(), headers = { 'X-API-Key': secret, 'Idempotency-Key': 'k1' }) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload) });
}
function assertNoCommittedWrites() {
  assert.equal(state.voyages.size, 0);
  assert.equal(state.history.length, 0);
  assert.equal(state.idem.size, 0);
  assert.equal(state.stats.commits, 0);
}
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/integration', createPartnerIntegrationRouter({ sql,
    poolPromise: Promise.resolve({ request: () => new Request(null) }), logger: { info() {}, error() {} } }));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + server.address().port + '/api/v1/integration/voyages';
});
beforeEach(reset);
after(async () => new Promise(resolve => server.close(resolve)));

test('requires key and validates JSON fields without database writes', async () => {
  assert.equal((await send(body(), { 'Idempotency-Key': 'k' })).status, 401);
  for (const invalid of [{ declaredEta: 'tomorrow' }, { declaredTeu: -1 }, { vesselImo: 'bad' }]) {
    assert.equal((await send(body(invalid))).status, 400);
  }
  assertNoCommittedWrites();
  assert.equal(state.transactions.length, 0);
});

test('rejects wrong credentials as 401 without exposing token', async () => {
  const response = await send(body(), { 'X-API-Key': 'wrong', 'Idempotency-Key': 'k' });
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /wrong/);
  assertNoCommittedWrites();
});

for (const condition of ['expired', 'revoked', 'inactive key', 'inactive partner']) {
  test('rejects ' + condition + ' credentials without starting a transaction', async () => {
    const key = state.keys[0];
    if (condition === 'expired') key.expires_at = new Date(Date.now() - 1000);
    if (condition === 'revoked') key.revoked_at = new Date();
    if (condition === 'inactive key') key.is_active = false;
    if (condition === 'inactive partner') key.partnerActive = false;
    const response = await send();
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { success: false, code: 'INVALID_API_KEY' });
    assertNoCommittedWrites();
    assert.equal(state.transactions.length, 0);
  });
}

test('enforces vessel scope and active vessel and port', async () => {
  state.grants.clear();
  assert.equal((await send()).status, 403);
  assertNoCommittedWrites();
  reset();
  state.ships.get('1234567').is_active = false;
  assert.equal((await send()).status, 422);
  assertNoCommittedWrites();
  reset();
  state.ports.clear();
  assert.equal((await send()).status, 422);
  assertNoCommittedWrites();
  reset();
  state.ships.clear();
  assert.equal((await send()).status, 404);
  assertNoCommittedWrites();
});

test('creates with key-owned agent, records history, replays and reports changed payload', async () => {
  const first = await send(body({ agentId: 999 }));
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { success: true, referenceId: 41, status: 'ANNOUNCED', missingFields: [] });
  assert.equal(state.voyages.get(41).agent, 9);
  assert.equal(state.history.length, 1);
  assert.equal(state.idem.size, 1);
  const replay = await send();
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).referenceId, 41);
  const changed = await send(body({ declaredTeu: 11 }));
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(state.voyages.size, 1);
  assert.equal(state.history.length, 1);
  assert.equal(state.idem.size, 1);
  assert.equal(state.stats.commits, 1);
});

test('another API key of the same partner shares idempotency and cannot change the payload', async () => {
  assert.equal((await send()).status, 201);
  const headers = { 'X-API-Key': rotatedSecret, 'Idempotency-Key': 'k1' };
  assert.equal((await send(body(), headers)).status, 200);
  const changed = await send(body({ declaredTeu: 11 }), headers);
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(state.stats.commits, 1);
});

test('reports duplicate voyage with a different idempotency key without new writes', async () => {
  assert.equal((await send()).status, 201);
  const duplicate = await send(body(), { 'X-API-Key': secret, 'Idempotency-Key': 'different' });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { success: false, code: 'VOYAGE_ALREADY_EXISTS', referenceId: 41 });
  assert.equal(state.voyages.size, 1);
  assert.equal(state.history.length, 1);
  assert.equal(state.idem.size, 1);
});

test('another partner cannot replay another partners key or use its vessel grant', async () => {
  assert.equal((await send()).status, 201);
  const headers = { 'X-API-Key': otherSecret, 'Idempotency-Key': 'k1' };
  assert.equal((await send(body(), headers)).status, 403);
  state.grants.add('8:3');
  const duplicate = await send(body(), headers);
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, 'VOYAGE_ALREADY_EXISTS');
  assert.equal((await send(body({ voyageNo: 'PARTNER-8' }), headers)).status, 201);
  assert.equal(state.voyages.get(42).agent, 10);
  assert.equal(state.idem.size, 2);
  assert.equal(state.idem.get(scope(7, endpoint, 'k1')).voyage_id, 41);
  assert.equal(state.idem.get(scope(8, endpoint, 'k1')).voyage_id, 42);
});

test('idempotency keys from another endpoint do not replay or conflict', async () => {
  const otherScope = scope(7, 'POST:/another-endpoint', 'k1');
  state.idem.set(otherScope, { request_fingerprint: 'unrelated', voyage_id: 77 });
  assert.equal((await send()).status, 201);
  assert.equal(state.idem.get(otherScope).voyage_id, 77);
  assert.equal(state.idem.get(scope(7, endpoint, 'k1')).voyage_id, 41);
});

for (const failure of ['failHistory', 'failIdempotency']) {
  test('rolls back voyage, history and idempotency when ' + failure + ' occurs', async () => {
    state[failure] = true;
    assert.equal((await send()).status, 500);
    assert.equal(state.stats.voyageInserts, 1);
    assert.equal(state.stats.historyAttempts, 1);
    assert.equal(state.stats.rollbacks, 1);
    assert.deepEqual(state.transactions[0].pending, []);
    assertNoCommittedWrites();
    state[failure] = false;
    assert.equal((await send()).status, 201);
    assert.equal(state.voyages.size, 1);
    assert.equal(state.history.length, 1);
    assert.equal(state.idem.size, 1);
  });
}

test('rejects impossible UTC calendar dates and invalid time components before database access', async () => {
  for (const declaredEta of ['2026-02-30T12:00:00Z', '2026-02-29T12:00:00Z',
    '1900-02-29T12:00:00Z', '2100-02-29T12:00:00Z', '2026-04-31T12:00:00Z',
    '2026-11-20T24:00:00Z', '2026-11-20T12:60:00Z', '2026-11-20T12:00:60Z',
    '2026-11-20T12:00:00+00:00']) {
    const response = await send(body({ declaredEta }));
    assert.equal(response.status, 400, declaredEta);
    assert.equal((await response.json()).code, 'VALIDATION_ERROR');
  }
  assertNoCommittedWrites();
  assert.equal(state.transactions.length, 0);
});

test('accepts leap years including century divisible by 400 and UTC fractional seconds', async () => {
  for (const declaredEta of ['2024-02-29T12:00:00Z', '2000-02-29T12:00:00Z',
    '2028-02-29T23:59:59.1234567Z']) {
    reset();
    assert.equal((await send(body({ declaredEta }))).status, 201, declaredEta);
    assert.equal(state.voyages.size, 1);
  }
});
