// Read-only identity checks. Pin the restored database reviewed by the operator,
// rather than trusting a test-looking database name or a client-supplied flag.
const DATABASE_IDENTITY_SQL = `/* uc015:database */
    SELECT DB_NAME() AS databaseName,
        CONVERT(nvarchar(128), SERVERPROPERTY(N'ServerName')) AS serverName,
        CONVERT(varchar(36), database_guid) AS databaseGuid
    FROM sys.database_recovery_status WHERE database_id = DB_ID()`;

const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const forbidden = new Set(['cangthongminh', 'master', 'model', 'msdb', 'tempdb']);
function unsafeTarget(code, message, cause) {
    return Object.assign(new Error(message, { cause }), { status: 503, code });
}

function readUc015DatabaseTarget(env) {
    const database = env.DB_DATABASE?.trim();
    const server = env.UC015_TEST_SERVER_NAME?.trim();
    const guid = normalize(env.UC015_TEST_DATABASE_GUID);
    if (!env.DB_SERVER?.trim() || !database || database.length > 128 || forbidden.has(normalize(database)) ||
        !server || server.length > 128 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(guid)) {
        throw unsafeTarget('UC015_TEST_DATABASE_REQUIRED',
            'UC015 requires explicit DB_SERVER, a test DB_DATABASE (never CangThongMinh), UC015_TEST_SERVER_NAME and UC015_TEST_DATABASE_GUID confirmed in SQL.');
    }
    return Object.freeze({ database, server, guid });
}

async function verifyUc015Database(sql, connection, target) {
    let rows;
    try {
        rows = (await new sql.Request(connection).query(DATABASE_IDENTITY_SQL)).recordset;
    } catch (cause) {
        throw unsafeTarget('UC015_TEST_DATABASE_UNVERIFIED', 'Cannot verify the UC015 SQL database identity.', cause);
    }
    const actual = rows?.[0];
    if (rows?.length !== 1 || !actual || forbidden.has(normalize(actual.databaseName)) ||
        normalize(actual.databaseName) !== normalize(target.database) ||
        normalize(actual.serverName) !== normalize(target.server) || normalize(actual.databaseGuid) !== target.guid) {
        throw unsafeTarget('UC015_TEST_DATABASE_MISMATCH', 'The connected SQL database does not match the reviewed UC015 test target.');
    }
    return actual;
}

module.exports = { DATABASE_IDENTITY_SQL, readUc015DatabaseTarget, verifyUc015Database };
