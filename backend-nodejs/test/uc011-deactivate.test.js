const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const dbPath = require.resolve('../db');
let currentState;

function installMockDatabase(options = {}) {
    currentState = {
        ship: options.ship === undefined
            ? { id: 7, ship_code: 'TEST', status: 'IDLE', is_active: true }
            : options.ship,
        voyages: options.voyages || [],
        committed: false,
        rolledBack: false,
        auditWrites: 0,
        shipUpdates: 0,
        auditFails: Boolean(options.auditFails),
        auditReason: null
    };

    class Transaction {
        async begin() {}
        async commit() { currentState.committed = true; }
        async rollback() { currentState.rolledBack = true; }
    }

    class Request {
        constructor() { this.params = {}; }
        input(name, _type, value) { this.params[name] = value; return this; }
        async query(query) {
            if (query.includes('SELECT id, ship_code, status, is_active')) {
                return { recordset: currentState.ship ? [currentState.ship] : [] };
            }
            if (query.includes('FROM dbo.voyages')) {
                const unfinished = currentState.voyages.filter(voyage =>
                    voyage.status == null ||
                    !['COMPLETED', 'CANCELLED'].includes(
                        String(voyage.status).toUpperCase()
                    )
                );
                return { recordset: unfinished };
            }
            if (query.includes('UPDATE dbo.ships')) {
                currentState.shipUpdates++;
                return { recordset: [] };
            }
            if (query.includes('INSERT INTO dbo.ship_audit_log')) {
                currentState.auditWrites++;
                currentState.auditReason = this.params.reason;
                if (currentState.auditFails) throw new Error('mock audit failure');
                return { recordset: [] };
            }
            throw new Error(`Unexpected SQL in test: ${query}`);
        }
    }

    const sql = {
        Transaction,
        Request,
        Int: 'Int',
        NVarChar: () => 'NVarChar',
        ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' }
    };
    require.cache[dbPath] = {
        id: dbPath,
        filename: dbPath,
        loaded: true,
        exports: { sql, poolPromise: Promise.resolve({}) }
    };
    return { app: require('../server'), state: currentState };
}

let server;
let baseUrl;

before(async () => {
    const { app } = installMockDatabase();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    delete require.cache[dbPath];
});

async function deactivate(id = 7, body = { reason: 'Demo retirement' }) {
    return fetch(`${baseUrl}/api/ships/${id}/deactivate`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
}

test('invalid ID, missing reason, and non-string reason return 400 without audit', async () => {
    const invalidId = await deactivate('nope');
    assert.equal(invalidId.status, 400);

    const missing = await deactivate(7, {});
    assert.equal(missing.status, 400);

    for (const reason of [12, {}, null, ['reason'], '', ' '.repeat(3), 'x'.repeat(501)]) {
        const response = await deactivate(7, { reason });
        assert.equal(response.status, 400);
    }
    assert.equal(currentState.auditWrites, 0);
});

test('missing and inactive ships are rejected without audit', async () => {
    const missingMock = installMockDatabase({ ship: null });
    const missingResponse = await fetch(`${baseUrl}/api/ships/8/deactivate`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'test' })
    });
    assert.equal(missingResponse.status, 404);
    assert.equal(missingMock.state.auditWrites, 0);

    const inactive = installMockDatabase({ ship: { id: 7, status: 'IDLE', is_active: false } });
    const inactiveResponse = await deactivate();
    assert.equal(inactiveResponse.status, 409);
    assert.equal(inactive.state.auditWrites, 0);
});

test('operational statuses and any unfinished or unknown voyage are rejected', async () => {
    for (const status of ['AT_SEA', 'DOCKED']) {
        const mock = installMockDatabase({ ship: { id: 7, status, is_active: true } });
        assert.equal((await deactivate()).status, 409);
        assert.equal(mock.state.auditWrites, 0);
    }

    for (const voyageStatus of ['PLANNED', 'QUEUED', 'BERTHED', null, 'MYSTERY']) {
        const mock = installMockDatabase({ voyages: [{ id: 1, status: voyageStatus }] });
        assert.equal((await deactivate()).status, 409);
        assert.equal(mock.state.auditWrites, 0);
    }
});

test('completed voyages allow deactivation and audit commits with the update', async () => {
    const mock = installMockDatabase({
        voyages: [{ id: 1, status: 'COMPLETED' }, { id: 2, status: 'CANCELLED' }]
    });
    const response = await deactivate();
    assert.equal(response.status, 200);
    assert.equal(mock.state.shipUpdates, 1);
    assert.equal(mock.state.auditWrites, 1);
    assert.equal(mock.state.auditReason, 'Demo retirement');
    assert.equal(mock.state.committed, true);
    assert.equal(mock.state.rolledBack, false);
});

test('a completed voyage does not hide a separate unfinished voyage', async () => {
    const mock = installMockDatabase({
        voyages: [
            { id: 1, status: 'COMPLETED' },
            { id: 2, status: 'QUEUED' }
        ]
    });
    assert.equal((await deactivate()).status, 409);
    assert.equal(mock.state.auditWrites, 0);
});

test('audit failure rolls back the deactivation', async () => {
    const mock = installMockDatabase({ auditFails: true });
    const response = await deactivate();
    assert.equal(response.status, 500);
    assert.equal(mock.state.shipUpdates, 1);
    assert.equal(mock.state.auditWrites, 1);
    assert.equal(mock.state.committed, false);
    assert.equal(mock.state.rolledBack, true);
});
