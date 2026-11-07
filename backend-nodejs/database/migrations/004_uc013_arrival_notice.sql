USE [CangThongMinh];
GO
SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.voyages', 'U') IS NULL
    THROW 50040, 'dbo.voyages is missing; apply UC-011 migration first.', 1;

IF COL_LENGTH('dbo.voyages', 'agent_id') IS NULL ALTER TABLE dbo.voyages ADD agent_id INT NULL;
IF COL_LENGTH('dbo.voyages', 'origin_port_id') IS NULL ALTER TABLE dbo.voyages ADD origin_port_id INT NULL;
IF COL_LENGTH('dbo.voyages', 'declared_eta') IS NULL ALTER TABLE dbo.voyages ADD declared_eta DATETIME2(3) NULL;
IF COL_LENGTH('dbo.voyages', 'cargo_type') IS NULL ALTER TABLE dbo.voyages ADD cargo_type NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.voyages', 'declared_teu') IS NULL ALTER TABLE dbo.voyages ADD declared_teu INT NULL;
IF COL_LENGTH('dbo.voyages', 'service_request') IS NULL ALTER TABLE dbo.voyages ADD service_request NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.voyages', 'priority_level') IS NULL ALTER TABLE dbo.voyages ADD priority_level INT NULL;
IF COL_LENGTH('dbo.voyages', 'announced_at') IS NULL ALTER TABLE dbo.voyages ADD announced_at DATETIME2(3) NULL;
IF COL_LENGTH('dbo.voyages', 'announced_by') IS NULL ALTER TABLE dbo.voyages ADD announced_by NVARCHAR(100) NULL;

-- Replace UC-011's voyage_code-only uniqueness with the requested ship/code key.
DECLARE @constraint sysname;
SELECT TOP (1) @constraint = kc.name
FROM sys.key_constraints kc
JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id AND ic.key_ordinal = 1
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE kc.parent_object_id = OBJECT_ID('dbo.voyages') AND kc.type = 'UQ'
  AND c.name = 'voyage_code'
  AND NOT EXISTS (
      SELECT 1 FROM sys.index_columns ic2
      JOIN sys.columns c2 ON c2.object_id = ic2.object_id AND c2.column_id = ic2.column_id
      WHERE ic2.object_id = kc.parent_object_id AND ic2.index_id = kc.unique_index_id
        AND ic2.key_ordinal = 2 AND c2.name = 'ship_id'
  );
IF @constraint IS NOT NULL
BEGIN
    DECLARE @dropSql nvarchar(500) = N'ALTER TABLE dbo.voyages DROP CONSTRAINT ' + QUOTENAME(@constraint);
    EXEC(@dropSql);
END;

IF EXISTS (SELECT 1 FROM dbo.voyages GROUP BY ship_id, voyage_code HAVING COUNT(*) > 1)
    THROW 50041, 'Duplicate ship_id/voyage_code legacy rows prevent the required unique key.', 1;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.voyages') AND name = 'UX_voyages_ship_voyage_code')
    CREATE UNIQUE INDEX UX_voyages_ship_voyage_code ON dbo.voyages(ship_id, voyage_code);

IF OBJECT_ID('dbo.voyage_status_history', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.voyage_status_history (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_voyage_status_history PRIMARY KEY,
        voyage_id INT NOT NULL,
        status VARCHAR(30) NOT NULL,
        changed_at DATETIME2(3) NOT NULL CONSTRAINT DF_voyage_status_history_changed_at DEFAULT SYSUTCDATETIME(),
        changed_by NVARCHAR(100) NULL,
        CONSTRAINT FK_voyage_status_history_voyages FOREIGN KEY (voyage_id) REFERENCES dbo.voyages(id)
    );
    CREATE INDEX IX_voyage_status_history_voyage ON dbo.voyage_status_history(voyage_id, changed_at DESC, id DESC);
END;

IF OBJECT_ID('dbo.voyage_idempotency', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.voyage_idempotency (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_voyage_idempotency PRIMARY KEY,
        idempotency_key NVARCHAR(200) NOT NULL,
        request_fingerprint CHAR(64) NOT NULL,
        voyage_id INT NOT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_voyage_idempotency_created_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_voyage_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT FK_voyage_idempotency_voyages FOREIGN KEY (voyage_id) REFERENCES dbo.voyages(id)
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.voyages') AND name = 'CK_voyages_declared_teu_nonnegative')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.voyages ADD CONSTRAINT CK_voyages_declared_teu_nonnegative CHECK (declared_teu IS NULL OR declared_teu >= 0);';

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
