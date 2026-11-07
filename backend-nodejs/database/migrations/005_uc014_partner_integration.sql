USE [CangThongMinh];
GO
SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.voyages', 'U') IS NULL OR OBJECT_ID('dbo.ships', 'U') IS NULL
    THROW 50050, 'Apply UC-011 and UC-013 migrations first.', 1;

-- No partner, port, or agent master existed in migrations 001-004.
IF OBJECT_ID('dbo.ports', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ports (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ports PRIMARY KEY,
        port_code VARCHAR(20) NOT NULL CONSTRAINT UQ_ports_port_code UNIQUE,
        port_name NVARCHAR(200) NOT NULL,
        is_active BIT NOT NULL CONSTRAINT DF_ports_is_active DEFAULT (1)
    );
END;
IF OBJECT_ID('dbo.agents', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.agents (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_agents PRIMARY KEY,
        agent_name NVARCHAR(200) NOT NULL,
        is_active BIT NOT NULL CONSTRAINT DF_agents_is_active DEFAULT (1)
    );
END;
IF OBJECT_ID('dbo.integration_partners', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.integration_partners (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_integration_partners PRIMARY KEY,
        partner_name NVARCHAR(200) NOT NULL,
        agent_id INT NOT NULL,
        is_active BIT NOT NULL CONSTRAINT DF_integration_partners_is_active DEFAULT (1),
        CONSTRAINT FK_integration_partners_agents FOREIGN KEY(agent_id) REFERENCES dbo.agents(id)
    );
END;
IF OBJECT_ID('dbo.partner_api_keys', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.partner_api_keys (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_partner_api_keys PRIMARY KEY,
        partner_id INT NOT NULL,
        key_hash BINARY(32) NOT NULL CONSTRAINT UQ_partner_api_keys_hash UNIQUE,
        is_active BIT NOT NULL CONSTRAINT DF_partner_api_keys_active DEFAULT (1),
        expires_at DATETIME2(3) NOT NULL,
        revoked_at DATETIME2(3) NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_partner_api_keys_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_partner_api_keys_partners FOREIGN KEY(partner_id) REFERENCES dbo.integration_partners(id)
    );
END;
IF OBJECT_ID('dbo.partner_vessel_access', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.partner_vessel_access (
        partner_id INT NOT NULL,
        ship_id INT NOT NULL,
        is_active BIT NOT NULL CONSTRAINT DF_partner_vessel_access_active DEFAULT (1),
        CONSTRAINT PK_partner_vessel_access PRIMARY KEY(partner_id, ship_id),
        CONSTRAINT FK_partner_vessel_access_partner FOREIGN KEY(partner_id) REFERENCES dbo.integration_partners(id),
        CONSTRAINT FK_partner_vessel_access_ship FOREIGN KEY(ship_id) REFERENCES dbo.ships(id)
    );
END;
IF OBJECT_ID('dbo.partner_voyage_idempotency', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.partner_voyage_idempotency (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_partner_voyage_idempotency PRIMARY KEY,
        partner_id INT NOT NULL,
        endpoint_code VARCHAR(50) NOT NULL,
        idempotency_key NVARCHAR(200) NOT NULL,
        request_fingerprint CHAR(64) NOT NULL,
        voyage_id INT NOT NULL,
        created_at DATETIME2(3) NOT NULL CONSTRAINT DF_partner_voyage_idem_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_partner_voyage_idempotency_scope UNIQUE(partner_id, endpoint_code, idempotency_key),
        CONSTRAINT FK_partner_voyage_idem_partner FOREIGN KEY(partner_id) REFERENCES dbo.integration_partners(id),
        CONSTRAINT FK_partner_voyage_idem_voyage FOREIGN KEY(voyage_id) REFERENCES dbo.voyages(id)
    );
END;

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
