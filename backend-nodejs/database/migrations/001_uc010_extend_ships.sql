
-- SmartPort - UC-010
-- Bo sung thong tin ho so tau
-- SQL Server - Database CangThongMinh

USE [CangThongMinh];
GO

-- Kiem tra bang ships
IF OBJECT_ID('dbo.ships', 'U') IS NULL
BEGIN
    THROW 50001, 'Bang dbo.ships chua ton tai', 1;
END;
GO

-- 1. Them so IMO
IF COL_LENGTH('dbo.ships', 'imo_number') IS NULL
BEGIN
    ALTER TABLE dbo.ships
    ADD imo_number VARCHAR(7) NULL;
END;
GO

-- 2. Them chieu dai tau
IF COL_LENGTH('dbo.ships', 'length_overall') IS NULL
BEGIN
    ALTER TABLE dbo.ships
    ADD length_overall DECIMAL(10,2) NULL;
END;
GO

-- 3. Them mon nuoc
IF COL_LENGTH('dbo.ships', 'draft') IS NULL
BEGIN
    ALTER TABLE dbo.ships
    ADD draft DECIMAL(10,2) NULL;
END;
GO

-- 4. Tao UNIQUE index cho IMO
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UX_ships_imo_number'
      AND object_id = OBJECT_ID('dbo.ships')
)
BEGIN
    CREATE UNIQUE INDEX UX_ships_imo_number
    ON dbo.ships(imo_number)
    WHERE imo_number IS NOT NULL;
END;
GO

-- 5. Kiem tra ket qua
SELECT
    COLUMN_NAME,
    DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'ships'
ORDER BY ORDINAL_POSITION;
GO
