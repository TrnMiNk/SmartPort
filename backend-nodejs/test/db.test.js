const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
function loadDatabase(server, connect) {
  let config;
  const sql = { ConnectionPool: class {
    constructor(value) { config = value; }
    connect() { return connect(); }
  } };
  const context = { module: { exports: {} }, process: { env: server ? { DB_SERVER: server } : {} },
    console: { log() {}, error() {} }, require(name) {
      assert.equal(name, 'mssql/msnodesqlv8');
      return sql;
    } };
  vm.runInNewContext(source, context, { filename: 'db.js' });
  return { ...context.module.exports, config };
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
  }
});
