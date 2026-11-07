const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { LocalDocumentStorage } = require('../documentStorage');

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIME_BY_EXTENSION = new Map([
    ['.pdf', 'application/pdf'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png']
]);

function validId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 && id <= 2147483647
        ? id
        : null;
}

function detectFileType(buffer) {
    if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
        return { extension: '.pdf', mimeType: 'application/pdf' };
    }
    if (buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return { extension: '.png', mimeType: 'image/png' };
    }
    if (buffer.length >= 3 &&
        buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { extensions: ['.jpg', '.jpeg'], mimeType: 'image/jpeg' };
    }
    return null;
}

function safeFilename(filename) {
    return typeof filename === 'string' && filename.length > 0 &&
        filename.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(filename) &&
        filename.length <= 255 && !filename.includes('/') &&
        !filename.includes('\\') && !filename.includes('\0') &&
        filename !== '.' && filename !== '..';
}

function createShipDocumentRouter({ sql, poolPromise, storage = new LocalDocumentStorage() }) {
    const router = express.Router();
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 5, parts: 7 },
        fileFilter: (_req, file, callback) => {
            const extension = path.extname(file.originalname).toLowerCase();
            if (!MIME_BY_EXTENSION.has(extension) ||
                MIME_BY_EXTENSION.get(extension) !== file.mimetype) {
                return callback(new Error('INVALID_DOCUMENT_FILE'));
            }
            callback(null, true);
        }
    });

    function parseUpload(req, res, next) {
        upload.single('file')(req, res, error => {
            if (!error) return next();
            if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ success: false, message: 'File vuot qua 10 MB' });
            }
            if (error instanceof multer.MulterError) {
                return res.status(400).json({ success: false, message: 'Yeu cau upload khong hop le' });
            }
            return res.status(400).json({ success: false, message: 'Chi chap nhan PDF, JPG, JPEG hoac PNG hop le' });
        });
    }

    async function requireShip(req, res, next) {
        const shipId = validId(req.params.shipId);
        if (!shipId) {
            return res.status(400).json({ success: false, message: 'ID tau khong hop le' });
        }
        req.shipId = shipId;
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('ship_id', sql.Int, shipId)
                .query('SELECT id FROM dbo.ships WHERE id = @ship_id');
            if (result.recordset.length === 0) {
                return res.status(404).json({ success: false, message: 'Khong tim thay tau' });
            }
            return next();
        } catch (error) {
            console.error('Document ship lookup failed:', error);
            return res.status(500).json({ success: false, message: 'Khong the xu ly tai lieu' });
        }
    }

    async function getDocument(pool, shipId, documentId) {
        return pool.request()
            .input('ship_id', sql.Int, shipId)
            .input('document_id', sql.Int, documentId)
            .query(`
                SELECT id, ship_id, document_type, original_filename,
                       mime_type, file_size, review_status, uploaded_at,
                       reviewed_at, reviewed_by, review_note, storage_key
                FROM dbo.ship_documents
                WHERE ship_id = @ship_id AND id = @document_id
            `);
    }

    router.post('/:shipId/documents', requireShip, parseUpload, async (req, res) => {
        const documentType = typeof req.body?.document_type === 'string'
            ? req.body.document_type.trim()
            : '';
        if (!documentType || documentType.length > 50) {
            return res.status(400).json({ success: false, message: 'Loai tai lieu phai co tu 1 den 50 ky tu' });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Thieu file tai lieu' });
        }
        if (!safeFilename(req.file.originalname)) {
            return res.status(400).json({ success: false, message: 'Ten file khong hop le' });
        }

        const extension = path.extname(req.file.originalname).toLowerCase();
        const detected = detectFileType(req.file.buffer);
        const detectedExtensions = detected?.extensions || [detected?.extension];
        if (!detected || !detectedExtensions.includes(extension) ||
            detected.mimeType !== req.file.mimetype) {
            return res.status(400).json({ success: false, message: 'Noi dung file khong khop dinh dang cho phep' });
        }

        let storageKey;
        try {
            storageKey = await storage.put(req.file.buffer, extension);
            const pool = await poolPromise;
            const result = await pool.request()
                .input('ship_id', sql.Int, req.shipId)
                .input('document_type', sql.NVarChar(50), documentType)
                .input('original_filename', sql.NVarChar(255), req.file.originalname)
                .input('storage_key', sql.NVarChar(100), storageKey)
                .input('mime_type', sql.VarChar(100), detected.mimeType)
                .input('file_size', sql.BigInt, req.file.size)
                .query(`
                    INSERT INTO dbo.ship_documents (
                        ship_id, document_type, original_filename,
                        storage_key, mime_type, file_size
                    )
                    OUTPUT INSERTED.id
                    VALUES (
                        @ship_id, @document_type, @original_filename,
                        @storage_key, @mime_type, @file_size
                    )
                `);
            return res.status(201).json({
                success: true,
                data: {
                    id: result.recordset[0].id,
                    ship_id: req.shipId,
                    document_type: documentType,
                    original_filename: req.file.originalname,
                    mime_type: detected.mimeType,
                    file_size: req.file.size,
                    review_status: 'PENDING'
                }
            });
        } catch (error) {
            if (storageKey) {
                try { await storage.delete(storageKey); }
                catch (cleanupError) { console.error('Document cleanup failed:', cleanupError); }
            }
            console.error('Document upload failed:', error);
            return res.status(500).json({ success: false, message: 'Khong the luu tai lieu' });
        }
    });

    router.get('/:shipId/documents', requireShip, async (req, res) => {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('ship_id', sql.Int, req.shipId)
                .query(`
                    SELECT id, ship_id, document_type, original_filename,
                           mime_type, file_size, review_status, uploaded_at,
                           reviewed_at, reviewed_by, review_note
                    FROM dbo.ship_documents
                    WHERE ship_id = @ship_id
                    ORDER BY uploaded_at DESC, id DESC
                `);
            return res.json({ success: true, data: result.recordset });
        } catch (error) {
            console.error('Document list failed:', error);
            return res.status(500).json({ success: false, message: 'Khong the lay danh sach tai lieu' });
        }
    });

    router.get('/:shipId/documents/:documentId/download', requireShip, async (req, res) => {
        const documentId = validId(req.params.documentId);
        if (!documentId) return res.status(400).json({ success: false, message: 'ID tai lieu khong hop le' });
        try {
            const pool = await poolPromise;
            const result = await getDocument(pool, req.shipId, documentId);
            if (result.recordset.length === 0) {
                return res.status(404).json({ success: false, message: 'Khong tim thay tai lieu' });
            }
            const document = result.recordset[0];
            const content = await storage.read(document.storage_key);
            res.type(document.mime_type);
            res.attachment(document.original_filename);
            res.set('Content-Length', String(document.file_size));
            return res.send(content);
        } catch (error) {
            console.error('Document download failed:', error);
            return res.status(500).json({ success: false, message: 'Khong the tai tai lieu' });
        }
    });

    router.get('/:shipId/documents/:documentId', requireShip, async (req, res) => {
        const documentId = validId(req.params.documentId);
        if (!documentId) return res.status(400).json({ success: false, message: 'ID tai lieu khong hop le' });
        try {
            const pool = await poolPromise;
            const result = await getDocument(pool, req.shipId, documentId);
            if (result.recordset.length === 0) {
                return res.status(404).json({ success: false, message: 'Khong tim thay tai lieu' });
            }
            const { storage_key: _storageKey, ...metadata } = result.recordset[0];
            return res.json({ success: true, data: metadata });
        } catch (error) {
            console.error('Document metadata lookup failed:', error);
            return res.status(500).json({ success: false, message: 'Khong the lay tai lieu' });
        }
    });

    // DEMO ONLY: No authentication/RBAC exists. Actor is fixed; client roles are ignored.
    router.patch('/:shipId/documents/:documentId/review', requireShip, async (req, res) => {
        const documentId = validId(req.params.documentId);
        if (!documentId) return res.status(400).json({ success: false, message: 'ID tai lieu khong hop le' });
        const status = req.body?.status;
        const note = req.body?.review_note;
        if (!['APPROVED', 'REJECTED'].includes(status) ||
            (note != null && (typeof note !== 'string' || note.length > 1000)) ||
            (status === 'REJECTED' && (!note || !note.trim()))) {
            return res.status(400).json({ success: false, message: 'Trang thai hoac ghi chu duyet khong hop le' });
        }
        try {
            const pool = await poolPromise;
            const updated = await pool.request()
                .input('ship_id', sql.Int, req.shipId)
                .input('document_id', sql.Int, documentId)
                .input('status', sql.VarChar(20), status)
                .input('review_note', sql.NVarChar(1000), note?.trim() || null)
                .query(`
                    UPDATE dbo.ship_documents
                    SET review_status = @status,
                        reviewed_at = SYSUTCDATETIME(),
                        reviewed_by = 'local-demo',
                        review_note = @review_note
                    OUTPUT INSERTED.id, INSERTED.review_status,
                           INSERTED.reviewed_at, INSERTED.reviewed_by,
                           INSERTED.review_note
                    WHERE ship_id = @ship_id AND id = @document_id
                      AND review_status = 'PENDING'
                `);
            if (updated.recordset.length > 0) {
                return res.json({ success: true, data: updated.recordset[0], demoOnly: true });
            }
            const existing = await pool.request()
                .input('ship_id', sql.Int, req.shipId)
                .input('document_id', sql.Int, documentId)
                .query('SELECT id FROM dbo.ship_documents WHERE ship_id = @ship_id AND id = @document_id');
            if (existing.recordset.length === 0) {
                return res.status(404).json({ success: false, message: 'Khong tim thay tai lieu' });
            }
            return res.status(409).json({ success: false, message: 'Tai lieu da duoc xet duyet' });
        } catch (error) {
            console.error('Document review failed:', error);
            return res.status(500).json({ success: false, message: 'Khong the cap nhat xet duyet tai lieu' });
        }
    });

    return router;
}

module.exports = { createShipDocumentRouter, MAX_FILE_SIZE, detectFileType };
