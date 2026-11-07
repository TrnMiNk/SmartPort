const sql = require('mssql/msnodesqlv8');


const config = {
    server: process.env.DB_SERVER || 'ADDY\\SQL2025',
    database: 'CangThongMinh',
    driver: 'ODBC Driver 18 for SQL Server',
    options: {
        trustedConnection: true,
        trustServerCertificate: true
    }
};


const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('✅ Đã kết nối thành công tới SQL Server CangThongMinh');
        return pool;
    })
    .catch(err => {
        console.error('❌ Lỗi kết nối CSDL: ', err);
        throw err;
    });

module.exports = { sql, poolPromise };
