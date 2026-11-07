USE [CangThongMinh_UC015_Test];
GO
-- Review and run manually on the verified restored test database only.
-- No backfill, seed, or automatic prediction of existing voyages.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF DB_NAME() <> N'CangThongMinh_UC015_Test'
        THROW 50070, 'UC016 migration is restricted to CangThongMinh_UC015_Test.', 1;
    IF OBJECT_ID('dbo.voyages','U') IS NULL OR COL_LENGTH('dbo.voyages','validation_result') IS NULL
        OR COL_LENGTH('dbo.voyages','queue_position') IS NULL
        THROW 50071, 'Apply reviewed migrations 001-006 to the test database first.', 1;

    IF OBJECT_ID('dbo.voyage_eta_predictions','U') IS NULL
    BEGIN
        CREATE TABLE dbo.voyage_eta_predictions (
            id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_voyage_eta_predictions PRIMARY KEY,
            voyage_id INT NOT NULL,
            declared_eta DATETIME2(3) NOT NULL,
            predicted_eta DATETIME2(3) NULL,
            eta_deviation_h AS CAST(DATEDIFF_BIG(MILLISECOND, declared_eta, predicted_eta) / 3600000.0 AS DECIMAL(18,6)) PERSISTED,
            eta_confidence DECIMAL(9,8) NULL,
            ai_status VARCHAR(20) NOT NULL,
            model_version NVARCHAR(100) NULL,
            failure_reason VARCHAR(100) NULL,
            application_status VARCHAR(20) NOT NULL,
            discard_reason VARCHAR(100) NULL,
            input_hash CHAR(64) NOT NULL,
            input_json NVARCHAR(MAX) NOT NULL,
            requested_at DATETIME2(3) NOT NULL,
            predicted_at DATETIME2(3) NOT NULL,
            CONSTRAINT FK_eta_predictions_voyage FOREIGN KEY(voyage_id) REFERENCES dbo.voyages(id),
            CONSTRAINT UQ_eta_predictions_voyage_id UNIQUE(voyage_id,id),
            CONSTRAINT CK_eta_predictions_confidence CHECK (eta_confidence IS NULL OR eta_confidence BETWEEN 0 AND 1),
            CONSTRAINT CK_eta_predictions_application CHECK (
                (application_status='APPLIED' AND discard_reason IS NULL) OR
                (application_status='DISCARDED' AND discard_reason IS NOT NULL AND LEN(discard_reason)>0)),
            CONSTRAINT CK_eta_predictions_json CHECK (ISJSON(input_json)=1),
            CONSTRAINT CK_eta_predictions_result CHECK (
                (ai_status='AVAILABLE' AND predicted_eta IS NOT NULL AND eta_confidence IS NOT NULL
                    AND model_version IS NOT NULL AND LEN(model_version)>0 AND failure_reason IS NULL)
                OR (ai_status='UNAVAILABLE' AND predicted_eta IS NULL AND eta_confidence IS NULL
                    AND model_version IS NULL AND failure_reason IS NOT NULL AND LEN(failure_reason)>0))
        );
    END;
    IF COL_LENGTH('dbo.voyages','latest_eta_prediction_id') IS NULL
        ALTER TABLE dbo.voyages ADD latest_eta_prediction_id BIGINT NULL;

    -- Dynamic SQL avoids compiling a reference to the new column in this batch.
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID('dbo.voyages') AND name='FK_voyages_latest_eta_prediction')
        EXEC sys.sp_executesql N'ALTER TABLE dbo.voyages WITH CHECK ADD CONSTRAINT FK_voyages_latest_eta_prediction
            FOREIGN KEY(id,latest_eta_prediction_id) REFERENCES dbo.voyage_eta_predictions(voyage_id,id);';
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.voyage_eta_predictions') AND name='IX_eta_predictions_voyage_time')
        EXEC sys.sp_executesql N'CREATE INDEX IX_eta_predictions_voyage_time
            ON dbo.voyage_eta_predictions(voyage_id,id DESC)
            INCLUDE(declared_eta,predicted_eta,eta_confidence,ai_status,model_version,predicted_at,application_status);';
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
