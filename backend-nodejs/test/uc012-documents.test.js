const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { createShipDocumentRouter } = require('../routes/shipDocuments');
const { LocalDocumentStorage } = require('../documentStorage');

test('local storage rejects a path inside the Git workspace without writing files', () => {
    assert.throws(() => new LocalDocumentStorage(path.resolve(__dirname, '..')),
        /outside the backend repository/);
});

function fixture(options = {}) {
    const state = { documents: [], writes: 0, files: new Map(), deletes: [], lastParams: null };
    class Request {
        constructor() { this.params = {}; }
        input(name, _type, value) { this.params[name] = value; return this; }
        async query(query) {
            state.lastParams = { ...this.params };
            if (query.includes('SELECT id FROM dbo.ships')) {
                return { recordset: options.shipExists === false ? [] : [{ id: this.params.ship_id }] };
            }
            if (query.includes('INSERT INTO dbo.ship_documents')) {
                if (options.databaseFails) throw new Error('mock database failure');
                state.writes++;
                state.documents.push({
                    id: state.writes,
                    ship_id: this.params.ship_id,
                    document_type: this.params.document_type,
                    original_filename: this.params.original_filename,
                    storage_key: this.params.storage_key,
                    mime_type: this.params.mime_type,
                    file_size: Number(this.params.file_size),
                    review_status: 'PENDING',
                    uploaded_at: '2026-01-01T00:00:00Z',
                    reviewed_at: null,
                    reviewed_by: null,
                    review_note: null
                });
                return { recordset: [{ id: state.writes }] };
            }
            if (query.includes('FROM dbo.ship_documents') && query.includes('ORDER BY uploaded_at')) {
                return { recordset: state.documents
                    .filter(d => d.ship_id === this.params.ship_id)
                    .map(({ storage_key: _storageKey, ...metadata }) => metadata) };
            }
            if (query.includes('UPDATE dbo.ship_documents')) {
                const doc = state.documents.find(d => d.ship_id === this.params.ship_id &&
                    d.id === this.params.document_id && d.review_status === 'PENDING');
                if (!doc) return { recordset: [] };
                Object.assign(doc, {
                    review_status: this.params.status,
                    review_note: this.params.review_note,
                    reviewed_by: 'local-demo',
                    reviewed_at: '2026-01-01T00:00:00Z'
                });
                return { recordset: [{
                    id: doc.id,
                    review_status: doc.review_status,
                    reviewed_at: doc.reviewed_at,
                    reviewed_by: doc.reviewed_by,
                    review_note: doc.review_note
                }] };
            }
            if (query.includes('SELECT id FROM dbo.ship_documents')) {
                return { recordset: state.documents.some(d => d.ship_id === this.params.ship_id &&
                    d.id === this.params.document_id) ? [{ id: this.params.document_id }] : [] };
            }
            if (query.includes('FROM dbo.ship_documents')) {
                const doc = state.documents.find(d => d.ship_id === this.params.ship_id &&
                    d.id === this.params.document_id);
                return { recordset: doc ? [doc] : [] };
            }
            throw new Error(`Unexpected SQL: ${query}`);
        }
    }
    const sql = {
        Int: 'Int',
        BigInt: 'BigInt',
        VarChar: () => 'VarChar',
        NVarChar: () => 'NVarChar'
    };
    const storage = {
        async put(buffer, extension) {
            const key = `test-key-${state.files.size}${extension}`;
            state.files.set(key, Buffer.from(buffer));
            return key;
        },
        async read(key) {
            if (options.storageFails) throw new Error('mock storage failure');
            if (!state.files.has(key)) throw new Error('missing file');
            return state.files.get(key);
        },
        async delete(key) {
            state.deletes.push(key);
            state.files.delete(key);
        }
    };
    const app = express();
    app.use(express.json());
    app.use('/api/ships', createShipDocumentRouter({
        sql, poolPromise: Promise.resolve({ request: () => new Request() }), storage
    }));
    const server = http.createServer(app);
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
        state,
        baseUrl: `http://127.0.0.1:${server.address().port}/api/ships`,
        close: () => new Promise(done => server.close(done))
    })));
}

function pdfForm(filename = 'vessel.pdf', data = Buffer.from('%PDF-1.7\nhello')) {
    const form = new FormData();
    form.set('document_type', 'Registry');
    form.set('file', new Blob([data], { type: 'application/pdf' }), filename);
    return form;
}

test('valid PDF, JPEG, and PNG uploads save metadata and file bytes', async () => {
    const f = await fixture();
    try {
        const examples = [
            ['document.pdf', Buffer.from('%PDF-1.7\nfile'), 'application/pdf'],
            ['photo.jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'],
            ['photo.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), 'image/png']
        ];
        for (const [filename, bytes, mimeType] of examples) {
            const form = new FormData();
            form.set('document_type', 'Registry');
            form.set('file', new Blob([bytes], { type: mimeType }), filename);
            const response = await fetch(`${f.baseUrl}/3/documents`, { method: 'POST', body: form });
            assert.equal(response.status, 201);
            const body = await response.json();
            assert.equal(body.data.review_status, 'PENDING');
            assert.equal(body.data.original_filename, filename);
        }
        assert.equal(f.state.writes, 3);
        assert.equal(f.state.files.size, 3);
    } finally { await f.close(); }
});

test('invalid IDs, missing ship, missing file, unsafe filename, and invalid content return client errors', async () => {
    const f = await fixture();
    try {
        assert.equal((await fetch(`${f.baseUrl}/x/documents`, { method: 'POST', body: pdfForm() })).status, 400);
        const missingShip = await fixture({ shipExists: false });
        try {
            assert.equal((await fetch(`${missingShip.baseUrl}/3/documents`, {
                method: 'POST', body: pdfForm()
            })).status, 404);
        } finally { await missingShip.close(); }

        const noFile = new FormData();
        noFile.set('document_type', 'Registry');
        assert.equal((await fetch(`${f.baseUrl}/3/documents`, { method: 'POST', body: noFile })).status, 400);
        const traversal = await fetch(`${f.baseUrl}/3/documents`, {
            method: 'POST', body: pdfForm('../traversal.pdf')
        });
        assert.equal(traversal.status, 201);
        assert.equal((await traversal.json()).data.original_filename, 'traversal.pdf');

        const fakePdf = pdfForm('fake.pdf', Buffer.from('not a PDF'));
        assert.equal((await fetch(`${f.baseUrl}/3/documents`, { method: 'POST', body: fakePdf })).status, 400);
        const badExtension = new FormData();
        badExtension.set('document_type', 'Registry');
        badExtension.set('file', new Blob(['x'], { type: 'application/x-msdownload' }), 'payload.exe');
        assert.equal((await fetch(`${f.baseUrl}/3/documents`, { method: 'POST', body: badExtension })).status, 400);
        assert.equal(f.state.writes, 1);
    } finally { await f.close(); }
});

test('file over 10 MB is rejected with 413 before storage or metadata writes', async () => {
    const f = await fixture();
    try {
        const response = await fetch(`${f.baseUrl}/3/documents`, {
            method: 'POST', body: pdfForm('large.pdf', Buffer.concat([
                Buffer.from('%PDF-1.7\n'), Buffer.alloc(10 * 1024 * 1024)
            ]))
        });
        assert.equal(response.status, 413);
        assert.equal(f.state.writes, 0);
        assert.equal(f.state.files.size, 0);
    } finally { await f.close(); }
});

test('metadata insert failure removes the stored file', async () => {
    const f = await fixture({ databaseFails: true });
    try {
        const response = await fetch(`${f.baseUrl}/3/documents`, { method: 'POST', body: pdfForm() });
        assert.equal(response.status, 500);
        assert.equal(f.state.files.size, 0);
        assert.deepEqual(f.state.deletes, ['test-key-0.pdf']);
    } finally { await f.close(); }
});

test('list and download are scoped to the requested ship and preserve bytes', async () => {
    const f = await fixture();
    try {
        const upload = await fetch(`${f.baseUrl}/3/documents`, { method: 'POST', body: pdfForm() });
        assert.equal(upload.status, 201);
        const list = await fetch(`${f.baseUrl}/3/documents`);
        const listBody = await list.json();
        assert.equal(listBody.data.length, 1);
        assert.equal(listBody.data[0].storage_key, undefined);
        const metadata = await fetch(`${f.baseUrl}/4/documents/1`);
        assert.equal(metadata.status, 404);
        const download = await fetch(`${f.baseUrl}/3/documents/1/download`);
        assert.equal(download.status, 200);
        assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from('%PDF-1.7\nhello'));
        assert.match(download.headers.get('content-disposition'), /attachment/);
    } finally { await f.close(); }
});

test('storage failures are generic and review enforces state and rejection note', async () => {
    const f = await fixture({ storageFails: true });
    try {
        const upload = await fetch(`${f.baseUrl}/3/documents`, { method: 'POST', body: pdfForm() });
        assert.equal(upload.status, 201);
        const storageFailure = await fetch(`${f.baseUrl}/3/documents/1/download`);
        assert.equal(storageFailure.status, 500);
        assert.doesNotMatch(await storageFailure.text(), /mock storage failure/);
    } finally { await f.close(); }

    const review = await fixture();
    try {
        await fetch(`${review.baseUrl}/3/documents`, { method: 'POST', body: pdfForm() });
        assert.equal((await fetch(`${review.baseUrl}/3/documents/1/review`, {
            method: 'PATCH', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'REJECTED' })
        })).status, 400);
        const approved = await fetch(`${review.baseUrl}/3/documents/1/review`, {
            method: 'PATCH', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'APPROVED', reviewed_by: 'forged-admin' })
        });
        assert.equal(approved.status, 200);
        assert.equal((await approved.json()).data.reviewed_by, 'local-demo');
    } finally { await review.close(); }
});
