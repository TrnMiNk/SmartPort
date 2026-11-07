
USE [CangThongMinh];
GO

-- UC-011: Danh dau tau con duoc su dung
IF COL_LENGTH('dbo.ships', 'is_active') IS NULL
BEGIN
    ALTER TABLE dbo.ships
    ADD is_active BIT NOT NULL
        CONSTRAINT DF_ships_is_active DEFAULT (1)
        WITH VALUES;
END;
GO

-- Bang quan ly chuyen tau (ban khoi dau)
IF OBJECT_ID('dbo.voyages', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.voyages (
        id INT IDENTITY(1,1) PRIMARY KEY,
        ship_id INT NOT NULL,
        voyage_code VARCHAR(50) NOT NULL UNIQUE,
        status VARCHAR(30) NOT NULL DEFAULT 'PLANNED',
        eta DATETIME2 NULL,
        ata DATETIME2 NULL,
        atd DATETIME2 NULL,
        created_at DATETIME2 NOT NULL
            DEFAULT SYSUTCDATETIME(),

        CONSTRAINT FK_voyages_ships
            FOREIGN KEY (ship_id)
            REFERENCES dbo.ships(id)
    );
END;
GO

-- Nhat ky thay doi trang thai su dung tau
IF OBJECT_ID('dbo.ship_audit_log', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ship_audit_log (
        id BIGINT IDENTITY(1,1) PRIMARY KEY,
        ship_id INT NOT NULL,
        action VARCHAR(50) NOT NULL,
        old_value NVARCHAR(100) NULL,
        new_value NVARCHAR(100) NULL,
        reason NVARCHAR(500) NULL,
        changed_by NVARCHAR(100) NULL,
        changed_at DATETIME2 NOT NULL
            DEFAULT SYSUTCDATETIME(),

        CONSTRAINT FK_ship_audit_log_ships
            FOREIGN KEY (ship_id)
            REFERENCES dbo.ships(id)
    );
END;
GO
