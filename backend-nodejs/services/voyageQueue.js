// All queue writers/readers share the same transaction-owned SQL Server lock.
async function lockVoyageQueue(sql, tx, mode = 'Exclusive') {
    const result = await new sql.Request(tx).input('mode', sql.VarChar(20), mode).query(`/* uc015:lock */
        DECLARE @result int;
        EXEC @result = sys.sp_getapplock @Resource=N'SmartPort:UC015:queue', @LockMode=@mode,
            @LockOwner='Transaction', @LockTimeout=10000;
        SELECT @result AS lockResult;`);
    if (!(result.recordset[0]?.lockResult >= 0))
        throw Object.assign(new Error('QUEUE_BUSY'), { status: 503, code: 'QUEUE_BUSY' });
}

async function reorderVoyageQueue(sql, tx) {
    await new sql.Request(tx).query(`/* uc015:reorder */
        UPDATE dbo.voyages SET queue_position = NULL WHERE queue_position IS NOT NULL;
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY COALESCE(predicted_eta, declared_eta),
                COALESCE(priority_level, 0) DESC, queued_at, id) AS position
            FROM dbo.voyages WHERE status = 'QUEUED' AND validation_result = 'VALID'
        ) UPDATE v SET queue_position = r.position FROM dbo.voyages v JOIN ranked r ON r.id = v.id;`);
}

module.exports = { lockVoyageQueue, reorderVoyageQueue };
