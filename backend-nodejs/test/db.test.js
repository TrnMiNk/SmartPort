const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
const testEnv = { UC015_DEMO_ENABLED: 'true', DB_DATABASE: 'CangThongMinh_UC015_Test',
  UC015_TEST_SERVER_NAME: 'TEST-HOST\\TEST', UC015_TEST_DATABASE_GUID: '12345678-1234-1234-1234-123456789abc' };
const identity = { databaseName: testEnv.DB_DATABASE, serverName: testEnv.UC015_TEST_SERVER_NAME,
  databaseGuid: testEnv.UC015_TEST_DATABASE_GUID };
function loadDatabase(server, connect, options = {}) {
  let config;
  const queries = [];
  const sql = { ConnectionPool: class {
    constructor(value) { config = value; options.constructed?.(); }
    connect() { return connect(); }
  }, Request: class {
    async query(query) {
      queries.push(query);
      if (options.queryError) throw options.queryError;
      return { recordset: options.rows === undefined ? [identity] : options.rows };
    }
  } };
  const context = { module: { exports: {} }, process: { env: { ...(server ? { DB_SERVER: server } : {}), ...options.env } },
    console: { log() {}, error() {} }, require(name) {
      if (name === './databaseSafety') return require('../databaseSafety');
      assert.equal(name, 'mssql/msnodesqlv8');
      return sql;
    } };
  vm.runInNewContext(source, context, { filename: 'db.js' });
  return { ...context.module.exports, config, queries };
}

test('database connection failures remain rejected with the original error', async () => {
  const error = new Error('mock connection failure');
  const db = loadDatabase('localhost', () => Promise.reject(error));
  await assert.rejects(db.poolPromise, actual => actual === error);
});

test('DB_SERVER localhost and the default named instance preserve Windows trusted connection', async () => {
  for (const server of ['localhost', undefined]) {
    const pool = {};
    const db = loadDatabase(server, () => Promise.resolve(pool));
    assert.equal(await db.poolPromise, pool);
    assert.equal(db.config.server, server || 'ADDY\\SQL2025');
    assert.equal(db.config.database, 'CangThongMinh');
    assert.equal(db.config.driver, 'ODBC Driver 18 for SQL Server');
    assert.equal(db.config.options.trustedConnection, true);
    assert.equal(db.queries.length, 0);
  }
});

test('DB_DATABASE selects the configured database without enabling UC015 or adding legacy metadata permissions', async () => {
  const pool = {};
  const db = loadDatabase('localhost', () => Promise.resolve(pool), { env: { DB_DATABASE: 'CangThongMinh_UC015_Test' } });
  assert.equal(await db.poolPromise, pool);
  assert.equal(db.config.database, 'CangThongMinh_UC015_Test');
  assert.equal(db.queries.length, 0);
});

for (const [name, env] of [
  ['missing database', { DB_DATABASE: undefined }], ['blank database', { DB_DATABASE: '   ' }],
  ['original database', { DB_DATABASE: 'CangThongMinh' }], ['original ignoring case/space', { DB_DATABASE: ' cAnGtHoNgMiNh ' }],
  ['system database', { DB_DATABASE: 'master' }], ['missing server selector', { DB_SERVER: '' }],
  ['missing SQL server confirmation', { UC015_TEST_SERVER_NAME: undefined }],
  ['missing GUID confirmation', { UC015_TEST_DATABASE_GUID: undefined }],
  ['malformed GUID', { UC015_TEST_DATABASE_GUID: 'acknowledged' }]
]) test(`demo ${name} fails closed before constructing/connecting SQL pool`, () => {
  let constructed = false;
  assert.throws(() => loadDatabase('localhost', () => { throw new Error('must not connect'); },
    { env: { ...testEnv, ...env }, constructed: () => { constructed = true; } }), { code: 'UC015_TEST_DATABASE_REQUIRED' });
  assert.equal(constructed, false);
});

test('demo exposes pool only after its actual SQL database/server/GUID match the explicit target', async () => {
  const pool = {};
  const db = loadDatabase('localhost', () => Promise.resolve(pool), { env: testEnv,
    rows: [{ ...identity, serverName: identity.serverName.toLowerCase(), databaseGuid: identity.databaseGuid.toUpperCase() }] });
  assert.equal(await db.poolPromise, pool);
  assert.equal(db.config.database, testEnv.DB_DATABASE);
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0], /DB_NAME\(\)/);
  assert.match(db.queries[0], /SERVERPROPERTY/);
  assert.match(db.queries[0], /database_guid/);
  assert.doesNotMatch(db.queries[0], /\b(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i);
});

for (const [name, options, code] of [
  ['actual original database', { rows: [{ ...identity, databaseName: 'CangThongMinh' }] }, 'UC015_TEST_DATABASE_MISMATCH'],
  ['another database', { rows: [{ ...identity, databaseName: 'Another_Test' }] }, 'UC015_TEST_DATABASE_MISMATCH'],
  ['another server', { rows: [{ ...identity, serverName: 'OTHER-HOST\\TEST' }] }, 'UC015_TEST_DATABASE_MISMATCH'],
  ['another database GUID', { rows: [{ ...identity, databaseGuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] }, 'UC015_TEST_DATABASE_MISMATCH'],
  ['invisible metadata', { rows: [] }, 'UC015_TEST_DATABASE_MISMATCH'],
  ['metadata query denied', { queryError: new Error('permission denied') }, 'UC015_TEST_DATABASE_UNVERIFIED']
]) test(`demo ${name} closes connected pool and rejects it instead of trusting configured name`, async () => {
  let closed = false;
  const pool = { async close() { closed = true; } };
  const db = loadDatabase('localhost', () => Promise.resolve(pool), { env: testEnv, ...options });
  await assert.rejects(db.poolPromise, { code });
  assert.equal(closed, true);
});
