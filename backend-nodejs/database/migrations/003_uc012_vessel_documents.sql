USE [CangThongMinh];
GO

IF OBJECT_ID('dbo.ships', 'U') IS NULL
BEGIN
    THROW 50012, 'Bang dbo.ships chua ton tai; hay chay migration UC-010 truoc', 1;
END;
GO

IF OBJECT_ID('dbo.ship_documents', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ship_documents (
        id INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_ship_documents PRIMARY KEY,
        ship_id INT NOT NULL,
        document_type NVARCHAR(50) NOT NULL,
        original_filename NVARCHAR(255) NOT NULL,
        storage_key NVARCHAR(100) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        file_size BIGINT NOT NULL,
        review_status VARCHAR(20) NOT NULL
            CONSTRAINT DF_ship_documents_review_status DEFAULT ('PENDING'),
        uploaded_at DATETIME2(3) NOT NULL
            CONSTRAINT DF_ship_documents_uploaded_at DEFAULT SYSUTCDATETIME(),
        reviewed_at DATETIME2(3) NULL,
        reviewed_by NVARCHAR(100) NULL,
        review_note NVARCHAR(1000) NULL,

        CONSTRAINT FK_ship_documents_ships
            FOREIGN KEY (ship_id) REFERENCES dbo.ships(id),
        CONSTRAINT UQ_ship_documents_storage_key UNIQUE (storage_key),
        CONSTRAINT CK_ship_documents_file_size
            CHECK (file_size > 0 AND file_size <= 10485760),
        CONSTRAINT CK_ship_documents_review_status
            CHECK (review_status IN ('PENDING', 'APPROVED', 'REJECTED')),
        CONSTRAINT CK_ship_documents_review_fields
            CHECK (
                (review_status = 'PENDING' AND reviewed_at IS NULL AND reviewed_by IS NULL)
                OR
                (review_status IN ('APPROVED', 'REJECTED') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
            )
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.ship_documents')
      AND name = 'IX_ship_documents_ship_uploaded'
)
BEGIN
    CREATE INDEX IX_ship_documents_ship_uploaded
        ON dbo.ship_documents(ship_id, uploaded_at DESC, id DESC)
        INCLUDE (document_type, original_filename, mime_type,
                 file_size, review_status, reviewed_at);
END;
GO
