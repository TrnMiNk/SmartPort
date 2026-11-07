
const express = require('express');
const cors = require('cors');
const { sql, poolPromise } = require('./db');
const { createShipDocumentRouter } = require('./routes/shipDocuments');
const { createVoyageRouter } = require('./routes/voyages');
const { createPartnerIntegrationRouter } = require('./routes/partnerIntegration');
const { createVoyageValidationRouter } = require('./routes/voyageValidation');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api/ships', createShipDocumentRouter({ sql, poolPromise }));
app.use('/api/voyages', createVoyageValidationRouter({ sql, poolPromise }));
app.use('/api/voyages', createVoyageRouter({ sql, poolPromise }));
app.use('/api/v1/integration', createPartnerIntegrationRouter({ sql, poolPromise }));

// ==========================================
// 1. API QUAN LY BEN BAI (BERTHS)
// ==========================================

// Lay danh sach ben bai
app.get('/api/berths', async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request()
            .query('SELECT * FROM dbo.berths');

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (err) {
        console.error('Loi lay danh sach ben:', err);

        res.status(500).json({
            success: false,
            message: 'Khong the lay danh sach ben'
        });
    }
});

// Them ben bai moi
app.post('/api/berths', async (req, res) => {
    const {
        berth_code,
        berth_name,
        length,
        status
    } = req.body || {};

    try {
        const pool = await poolPromise;

        await pool.request()
            .input('berth_code', sql.VarChar(50), berth_code)
            .input('berth_name', sql.NVarChar(100), berth_name)
            .input('length', sql.Decimal(10, 2), length)
            .input('status', sql.VarChar(50), status || 'AVAILABLE')
            .query(`
                INSERT INTO dbo.berths (
                    berth_code,
                    berth_name,
                    length,
                    status
                )
                VALUES (
                    @berth_code,
                    @berth_name,
                    @length,
                    @status
                )
            `);

        res.status(201).json({
            success: true,
            message: 'Thêm bến bãi thành công'
        });

    } catch (err) {
        console.error('Loi them ben:', err);

        res.status(500).json({
            success: false,
            message: 'Khong the them ben bai'
        });
    }
});

// ==========================================
// 2. API QUAN LY TAU (SHIPS)
// ==========================================

// Lay danh sach tau
app.get('/api/ships', async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request()
            .query('SELECT * FROM dbo.ships');

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (err) {
        console.error('Loi lay danh sach tau:', err);

        res.status(500).json({
            success: false,
            message: 'Khong the lay danh sach tau'
        });
    }
});

 // UC-011: Cap nhat thong tin ho so tau
app.put('/api/ships/:id', async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
        return res.status(400).json({
            success: false,
            message: 'ID tau khong hop le'
        });
    }

    const {
        ship_code,
        ship_name,
        ship_type,
        capacity,
        imo_number,
        length_overall,
        draft
    } = req.body || {};

    // Kiem tra thong tin bat buoc
    if (
        typeof ship_code !== 'string' ||
        !ship_code.trim() ||
        ship_code.length > 50 ||
        typeof ship_name !== 'string' ||
        !ship_name.trim() ||
        ship_name.length > 200 ||
        typeof ship_type !== 'string' ||
        !ship_type.trim() ||
        ship_type.length > 100
    ) {
        return res.status(400).json({
            success: false,
            message: 'Thong tin tau khong hop le'
        });
    }

    // Kiem tra IMO va checksum
    if (!isValidIMO(imo_number)) {
        return res.status(400).json({
            success: false,
            message: 'So IMO khong hop le'
        });
    }

    // Kiem tra thong so ky thuat
    const numbers = [capacity, length_overall, draft];

    if (numbers.some(value =>
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value <= 0 ||
        value > 99999999.99
    )) {
        return res.status(400).json({
            success: false,
            message: 'Thong so tau phai la so duong hop le'
        });
    }

    try {
        const pool = await poolPromise;

        const result = await pool.request()
            .input('id', sql.Int, id)
            .input('ship_code', sql.VarChar(50), ship_code.trim())
            .input('ship_name', sql.NVarChar(200), ship_name.trim())
            .input('ship_type', sql.NVarChar(100), ship_type.trim())
            .input('capacity', sql.Decimal(10, 2), capacity)
            .input('imo_number', sql.VarChar(7), imo_number)
            .input('length_overall', sql.Decimal(10, 2), length_overall)
            .input('draft', sql.Decimal(10, 2), draft)
            .query(`
                UPDATE dbo.ships
                SET
                    ship_code = @ship_code,
                    ship_name = @ship_name,
                    ship_type = @ship_type,
                    capacity = @capacity,
                    imo_number = @imo_number,
                    length_overall = @length_overall,
                    draft = @draft
                OUTPUT INSERTED.id, INSERTED.ship_code,
                       INSERTED.ship_name, INSERTED.imo_number,
                       INSERTED.length_overall, INSERTED.draft
                WHERE id = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Khong tim thay tau'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Cap nhat ho so tau thanh cong',
            data: result.recordset[0]
        });

    } catch (err) {
        const errorNumber =
            err.number ??
            err.originalError?.info?.number ??
            err.originalError?.number;

        if (Number(errorNumber) === 2601 ||
            Number(errorNumber) === 2627) {
            return res.status(409).json({
                success: false,
                message: 'Ma tau hoac IMO da ton tai'
            });
        }

        console.error('Loi cap nhat tau:', err);

        return res.status(500).json({
            success: false,
            message: 'Khong the cap nhat ho so tau'
        });
    }
});


 // UC-011: Tim kiem tau theo ma, ten hoac IMO
app.get('/api/ships/search', async (req, res) => {
    const q = typeof req.query.q === 'string'
        ? req.query.q.trim()
        : '';

    if (!q || q.length > 100) {
        return res.status(400).json({
            success: false,
            message: 'Tu khoa tim kiem phai co tu 1 den 100 ky tu'
        });
    }

    try {
        const pool = await poolPromise;

        const result = await pool.request()
            .input('q', sql.NVarChar(100), q)
            .query(`
                SELECT TOP (50)
                    id,
                    ship_code,
                    ship_name,
                    ship_type,
                    capacity,
                    current_berth_id,
                    status,
                    imo_number,
                    length_overall,
                    draft
                FROM dbo.ships
                WHERE CHARINDEX(@q, ship_code) > 0
                   OR CHARINDEX(@q, ship_name) > 0
                   OR CHARINDEX(@q, imo_number) > 0
                ORDER BY id
            `);

        return res.status(200).json({
            success: true,
            data: result.recordset
        });

    } catch (err) {
        console.error('Loi tim kiem tau:', err);

        return res.status(500).json({
            success: false,
            message: 'Khong the tim kiem tau'
        });
    }
});

 // UC-011: Lay chi tiet tau theo ID
app.get('/api/ships/:id', async (req, res) => {

    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0 ||
        id > 2147483647) {
        return res.status(400).json({
            success: false,
            message: 'ID tau khong hop le'
        });
    }

    try {
        const pool = await poolPromise;

        const result = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT
                    id,
                    ship_code,
                    ship_name,
                    ship_type,
                    capacity,
                    current_berth_id,
                    status,
                    imo_number,
                    length_overall,
                    draft
                FROM dbo.ships
                WHERE id = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Khong tim thay tau'
            });
        }

        return res.status(200).json({
            success: true,
            data: result.recordset[0]
        });

    } catch (err) {
        console.error('Loi tra cuu tau:', err);

        return res.status(500).json({
            success: false,
            message: 'Khong the tra cuu tau'
        });
    }
});


// ------------------------------------------
// HAM KIEM TRA SO IMO
// ------------------------------------------

function isValidIMO(imo) {

    if (typeof imo !== 'string') {
        return false;
    }

    // IMO gom 7 chu so, chu so dau khac 0
    if (!/^[1-9][0-9]{6}$/.test(imo)) {
        return false;
    }

    let sum = 0;

    // 6 chu so dau nhan voi trong so 7,6,5,4,3,2
    for (let i = 0; i < 6; i++) {
        const digit = Number(imo[i]);
        const weight = 7 - i;

        sum += digit * weight;
    }

    const checkDigit = sum % 10;
    const lastDigit = Number(imo[6]);

    return checkDigit === lastDigit;
}

// ------------------------------------------
// UC-010: THEM HO SO TAU
// ------------------------------------------

app.post('/api/ships', async (req, res) => {

    const {
        ship_code,
        ship_name,
        ship_type,
        capacity,
        status,
        imo_number,
        length_overall,
        draft
    } = req.body || {};

    // 1. Kiem tra ma tau va ten tau
    if (
        typeof ship_code !== 'string' ||
        !ship_code.trim() ||
        ship_code.length > 50 ||
        typeof ship_name !== 'string' ||
        !ship_name.trim() ||
        ship_name.length > 100
    ) {
        return res.status(400).json({
            success: false,
            message: 'Ma tau hoac ten tau khong hop le'
        });
    }

    // 2. Kiem tra IMO neu co
    // Tam thoi cho phep null de tuong thich API cu
    if (imo_number != null) {

        if (!isValidIMO(imo_number)) {
            return res.status(400).json({
                success: false,
                message: 'So IMO khong hop le'
            });
        }
    }

    // 3. Kiem tra thong so ky thuat
    const numericFields = [
        capacity,
        length_overall,
        draft
    ];

    for (const value of numericFields) {

        if (
            value != null &&
            (
                typeof value !== 'number' ||
                !Number.isFinite(value) ||
                value <= 0
            )
        ) {
            return res.status(400).json({
                success: false,
                message: 'Thong so tau phai la so duong'
            });
        }
    }

    // 4. Kiem tra loai tau va trang thai neu duoc gui
    if (
        (ship_type != null &&
            (typeof ship_type !== 'string' ||
             ship_type.length > 50)) ||
        (status != null &&
            (typeof status !== 'string' ||
             !status.trim() ||
             status.length > 50))
    ) {
        return res.status(400).json({
            success: false,
            message: 'Loai tau hoac trang thai khong hop le'
        });
    }

    try {

        const pool = await poolPromise;

        // 5. Luu ho so tau vao SQL Server
        const result = await pool.request()

            .input(
                'ship_code',
                sql.VarChar(50),
                ship_code.trim()
            )

            .input(
                'ship_name',
                sql.NVarChar(100),
                ship_name.trim()
            )

            .input(
                'ship_type',
                sql.NVarChar(50),
                ship_type ?? null
            )

            .input(
                'capacity',
                sql.Decimal(10, 2),
                capacity ?? null
            )

            .input(
                'status',
                sql.VarChar(50),
                status ?? 'AT_SEA'
            )

            .input(
                'imo_number',
                sql.VarChar(7),
                imo_number ?? null
            )

            .input(
                'length_overall',
                sql.Decimal(10, 2),
                length_overall ?? null
            )

            .input(
                'draft',
                sql.Decimal(10, 2),
                draft ?? null
            )

            .query(`
                INSERT INTO dbo.ships (
                    ship_code,
                    ship_name,
                    ship_type,
                    capacity,
                    status,
                    imo_number,
                    length_overall,
                    draft
                )

                OUTPUT INSERTED.id

                VALUES (
                    @ship_code,
                    @ship_name,
                    @ship_type,
                    @capacity,
                    @status,
                    @imo_number,
                    @length_overall,
                    @draft
                )
            `);

        // 6. Tra ket qua thanh cong
        return res.status(201).json({
            success: true,
            message: 'Them ho so tau thanh cong',
            id: result.recordset[0].id
        });

    } catch (err) {

        // 7. Xu ly loi trung ma tau hoac IMO
        const errorNumber =
            err.number ??
            err.originalError?.info?.number ??
            err.originalError?.number;

        if (
            Number(errorNumber) === 2601 ||
            Number(errorNumber) === 2627
        ) {
            return res.status(409).json({
                success: false,
                message: 'Ma tau hoac so IMO da ton tai'
            });
        }

        console.error('Loi them ho so tau:', err);

        return res.status(500).json({
            success: false,
            message: 'Khong the them ho so tau'
        });
    }
});

 // UC-011: Ngung su dung tau
app.patch('/api/ships/:id/deactivate', async (req, res) => {
    const id = Number(req.params.id);
    const rawReason = req.body?.reason;

    if (!Number.isInteger(id) || id <= 0 ||
        id > 2147483647) {
        return res.status(400).json({
            success: false,
            message: 'ID tau khong hop le'
        });
    }

    if (typeof rawReason !== 'string') {
        return res.status(400).json({
            success: false,
            message: 'Phai nhap ly do ngung su dung (toi da 500 ky tu)'
        });
    }

    const reason = rawReason.trim();
    if (!reason || reason.length > 500) {
        return res.status(400).json({
            success: false,
            message: 'Phai nhap ly do ngung su dung (toi da 500 ky tu)'
        });
    }

    let transaction;

    try {
        const pool = await poolPromise;
        transaction = new sql.Transaction(pool);

        await transaction.begin(
            sql.ISOLATION_LEVEL.SERIALIZABLE
        );

        // Khoa ban ghi tau trong transaction
        const shipResult = await new sql.Request(transaction)
            .input('id', sql.Int, id)
            .query(`
                SELECT id, ship_code, status, is_active
                FROM dbo.ships WITH (UPDLOCK, HOLDLOCK)
                WHERE id = @id
            `);

        if (shipResult.recordset.length === 0) {
            await transaction.rollback();
            transaction = null;

            return res.status(404).json({
                success: false,
                message: 'Khong tim thay tau'
            });
        }

        const ship = shipResult.recordset[0];

        if (!ship.is_active) {
            await transaction.rollback();
            transaction = null;

            return res.status(409).json({
                success: false,
                message: 'Tau da ngung su dung'
            });
        }

        // Chan tau dang van hanh ke ca khi chua co voyage
        if (['AT_SEA', 'DOCKED'].includes(
            String(ship.status).toUpperCase()
        )) {
            await transaction.rollback();
            transaction = null;

            return res.status(409).json({
                success: false,
                message: 'Tau dang van hanh, khong the ngung su dung'
            });
        }

        // Kiem tra chuyen tau chua ket thuc
        const voyageResult = await new sql.Request(transaction)
            .input('ship_id', sql.Int, id)
            .query(`
                SELECT TOP (1) id
                FROM dbo.voyages WITH (HOLDLOCK)
                WHERE ship_id = @ship_id
                  AND (
                    status IS NULL
                    OR status NOT IN ('COMPLETED', 'CANCELLED')
                  )
            `);

        if (voyageResult.recordset.length > 0) {
            await transaction.rollback();
            transaction = null;

            return res.status(409).json({
                success: false,
                message: 'Tau dang co chuyen hoat dong'
            });
        }

        // Cap nhat trang thai
        await new sql.Request(transaction)
            .input('id', sql.Int, id)
            .query(`
                UPDATE dbo.ships
                SET is_active = 0
                WHERE id = @id
            `);

        // Ghi nhat ky trong cung transaction
        await new sql.Request(transaction)
            .input('ship_id', sql.Int, id)
            .input('reason', sql.NVarChar(500), reason)
            .query(`
                INSERT INTO dbo.ship_audit_log (
                    ship_id, action, old_value,
                    new_value, reason, changed_by
                )
                VALUES (
                    @ship_id, 'DEACTIVATE', '1',
                    '0', @reason, 'local-demo'
                )
            `);

        await transaction.commit();
        transaction = null;

        return res.status(200).json({
            success: true,
            message: 'Ngung su dung tau thanh cong',
            shipId: id
        });

    } catch (err) {
        if (transaction) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Rollback loi:', rollbackError);
            }
        }

        console.error('Loi ngung su dung tau:', err);

        return res.status(500).json({
            success: false,
            message: 'Khong the ngung su dung tau'
        });
    }
});

// ==========================================
// 3. API QUAN LY KHO HANG (WAREHOUSES)
// ==========================================

app.get('/api/warehouses', async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request()
            .query('SELECT * FROM dbo.warehouses');

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (err) {
        console.error('Loi lay danh sach kho:', err);

        res.status(500).json({
            success: false,
            message: 'Khong the lay danh sach kho'
        });
    }
});

// ==========================================
// 4. API QUAN LY CONTAINER
// ==========================================

app.get('/api/containers', async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request()
            .query('SELECT * FROM dbo.containers');

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (err) {
        console.error('Loi lay danh sach container:', err);

        res.status(500).json({
            success: false,
            message: 'Khong the lay danh sach container'
        });
    }
});

// ==========================================
// 5. KHOI DONG SERVER
// ==========================================

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '127.0.0.1';

if (require.main === module) app.listen(PORT, HOST, () => {
    console.log(
        `🚀 Server đang chạy tại http://localhost:${PORT}`
    );
});

module.exports = app;
