USE [CangThongMinh];
GO
-- REVIEW ONLY: the application never runs this migration. No seed/backfill/DML.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.voyages', 'U') IS NULL OR OBJECT_ID('dbo.ships', 'U') IS NULL
        OR OBJECT_ID('dbo.ship_documents', 'U') IS NULL OR OBJECT_ID('dbo.voyage_status_history', 'U') IS NULL
        OR COL_LENGTH('dbo.voyages', 'declared_eta') IS NULL
        THROW 50060, 'Apply migrations 001-005 before UC015.', 1;

    IF COL_LENGTH('dbo.ship_documents', 'valid_from') IS NULL
        ALTER TABLE dbo.ship_documents ADD valid_from DATETIME2(3) NULL;
    IF COL_LENGTH('dbo.ship_documents', 'valid_until') IS NULL
        ALTER TABLE dbo.ship_documents ADD valid_until DATETIME2(3) NULL;
    -- Existing approvals stay approved; NULL validity is intentionally NOT treated as valid.
    IF COL_LENGTH('dbo.voyages', 'validation_result') IS NULL
        ALTER TABLE dbo.voyages ADD validation_result VARCHAR(30) NULL;
    IF COL_LENGTH('dbo.voyages', 'validation_reason') IS NULL
        ALTER TABLE dbo.voyages ADD validation_reason NVARCHAR(1000) NULL;
    IF COL_LENGTH('dbo.voyages', 'validated_at') IS NULL
        ALTER TABLE dbo.voyages ADD validated_at DATETIME2(3) NULL;
    IF COL_LENGTH('dbo.voyages', 'validation_policy_hash') IS NULL
        ALTER TABLE dbo.voyages ADD validation_policy_hash CHAR(64) NULL;
    IF COL_LENGTH('dbo.voyages', 'ai_status') IS NULL
        ALTER TABLE dbo.voyages ADD ai_status VARCHAR(20) NULL;
    IF COL_LENGTH('dbo.voyages', 'predicted_eta') IS NULL
        ALTER TABLE dbo.voyages ADD predicted_eta DATETIME2(3) NULL;
    IF COL_LENGTH('dbo.voyages', 'eta_input_hash') IS NULL
        ALTER TABLE dbo.voyages ADD eta_input_hash CHAR(64) NULL;
    IF COL_LENGTH('dbo.voyages', 'queue_position') IS NULL
        ALTER TABLE dbo.voyages ADD queue_position BIGINT NULL;
    IF COL_LENGTH('dbo.voyages', 'queued_at') IS NULL
        ALTER TABLE dbo.voyages ADD queued_at DATETIME2(3) NULL;

    -- Dynamic SQL is deliberate: SQL Server compiles static references before ADD COLUMN runs.
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.ship_documents') AND name='CK_ship_documents_uc015_validity')
        EXEC sys.sp_executesql N'ALTER TABLE dbo.ship_documents WITH CHECK ADD CONSTRAINT CK_ship_documents_uc015_validity
            CHECK ((valid_from IS NULL AND valid_until IS NULL) OR
                (valid_from IS NOT NULL AND valid_until IS NOT NULL AND valid_until > valid_from));';
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.voyages') AND name='CK_voyages_uc015_validation')
        EXEC sys.sp_executesql N'ALTER TABLE dbo.voyages WITH CHECK ADD CONSTRAINT CK_voyages_uc015_validation CHECK (
            (validation_result IS NULL AND validation_reason IS NULL AND validated_at IS NULL AND validation_policy_hash IS NULL)
            OR (validation_result IS NOT NULL AND validated_at IS NOT NULL AND validation_policy_hash IS NOT NULL AND
                ((validation_result=''VALID'' AND validation_reason IS NULL) OR
                 (validation_result IN (''MISSING_DOCUMENTS'',''REJECTED'') AND validation_reason IS NOT NULL AND LEN(validation_reason)>0))));';
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.voyages') AND name='CK_voyages_uc015_ai')
        EXEC sys.sp_executesql N'ALTER TABLE dbo.voyages WITH CHECK ADD CONSTRAINT CK_voyages_uc015_ai CHECK (
            (ai_status IS NULL AND predicted_eta IS NULL) OR
            (ai_status IS NOT NULL AND ((ai_status=''UNAVAILABLE'' AND predicted_eta IS NULL) OR
             (ai_status=''AVAILABLE'' AND predicted_eta IS NOT NULL AND eta_input_hash IS NOT NULL))));';
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.voyages') AND name='CK_voyages_uc015_queue')
        EXEC sys.sp_executesql N'ALTER TABLE dbo.voyages WITH CHECK ADD CONSTRAINT CK_voyages_uc015_queue CHECK (
            queue_position IS NULL OR (queue_position>0 AND status=''QUEUED'' AND validation_result IS NOT NULL AND
                validation_result=''VALID'' AND validated_at IS NOT NULL AND declared_eta IS NOT NULL AND queued_at IS NOT NULL AND ai_status IS NOT NULL));';

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.voyages') AND name='UX_voyages_uc015_queue_position')
        EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UX_voyages_uc015_queue_position ON dbo.voyages(queue_position) WHERE queue_position IS NOT NULL;';
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.voyages') AND name='IX_voyages_uc015_queue')
        EXEC sys.sp_executesql N'CREATE INDEX IX_voyages_uc015_queue ON dbo.voyages(status, validation_result, queue_position)
            INCLUDE (declared_eta, predicted_eta, priority_level, queued_at);';
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.ship_documents') AND name='IX_ship_documents_uc015_eligibility')
        EXEC sys.sp_executesql N'CREATE INDEX IX_ship_documents_uc015_eligibility ON dbo.ship_documents(ship_id, document_type, review_status)
            INCLUDE (valid_from, valid_until);';
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
