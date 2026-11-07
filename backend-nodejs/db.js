const sql = require('mssql/msnodesqlv8');
const { readUc015DatabaseTarget, verifyUc015Database } = require('./databaseSafety');

// Reject unsafe demo configuration before opening any connection.
const testTarget = process.env.UC015_DEMO_ENABLED === 'true' ? readUc015DatabaseTarget(process.env) : null;

const config = {
    server: process.env.DB_SERVER || 'ADDY\\SQL2025',
    database: process.env.DB_DATABASE?.trim() || 'CangThongMinh',
    driver: 'ODBC Driver 18 for SQL Server',
    options: {
        trustedConnection: true,
        trustServerCertificate: true
    }
};


const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(async pool => {
        if (testTarget) {
            try {
                const identity = await verifyUc015Database(sql, pool, testTarget);
                console.log('UC015 test database identity verified:', identity);
            } catch (error) {
                try { await pool.close(); } catch (_) { /* preserve the verification failure */ }
                throw error;
            }
        }
        console.log('✅ Đã kết nối SQL Server:', { server: config.server, database: config.database });
        return pool;
    })
    .catch(err => {
        console.error('❌ Lỗi kết nối CSDL: ', err);
        throw err;
    });

module.exports = { sql, poolPromise };
