# UC-014 – Tiếp nhận thông báo tàu đến qua API đại lý

## Contract

`POST http://localhost:8080/api/v1/integration/voyages` (Spring proxy to Node `POST /api/v1/integration/voyages`). Headers `X-API-Key` and `Idempotency-Key` are required. JSON fields: `vesselImo` (7 digits), `voyageNo`, `originPortCode`, `declaredEta` (UTC ISO 8601 ending `Z`), `cargoType`, `declaredTeu` (integer >= 0), optional `serviceRequest`.

Success is `201 {success:true,referenceId,status:"ANNOUNCED",missingFields:[]}`; an exact retry is `200` with `replayed:true`. Errors: `400 VALIDATION_ERROR`, `401 INVALID_API_KEY`, `403 VESSEL_NOT_AUTHORIZED`, `404 VESSEL_NOT_FOUND`, `409 VOYAGE_ALREADY_EXISTS` (has `referenceId`) or `IDEMPOTENCY_KEY_REUSED`, `422 VESSEL_INACTIVE` / `ORIGIN_PORT_NOT_FOUND`, and `502` for unexpected Node upstream failures. A key's scope is partner + endpoint.

The token is 32 random bytes encoded base64url. SQL stores only SHA-256 binary hash. Node computes the hash and uses timing-safe comparison; keys are never included in logs or API responses. Partner agent identity is taken from the authenticated key's partner row. A partner requires an active explicit ship grant.

## Local setup

Node binds to `127.0.0.1:5000` by default (`HOST` can override it). Keep it loopback-only behind Spring in local use and firewall port 5000 from external networks. Configure SQL connection using the existing Windows trusted connection settings in `backend-nodejs/db.js`; do not place secrets in source control. Spring's `smartport.node-api.base-url` defaults to localhost.

After reviewing it, apply migration `backend-nodejs/database/migrations/005_uc014_partner_integration.sql` manually in SSMS; this project change does not run it. Migrations 001–004 are unchanged. The migration creates minimal `ports`, `agents`, partner, key, vessel grant, and scoped idempotency tables only when absent; it inserts no demonstration records.

### Create a local demo authorization

Use an existing active ship TAU03 and an existing port code if present. If the schema does not have TAU03, provision it through the project's normal vessel workflow; do not fabricate an IMO. Choose a clearly local demo port code only when the operator has approved the port mapping. Run this in SSMS after migration, substituting verified IDs and a unique demo name:

```sql
DECLARE @agent int, @partner int;
INSERT dbo.agents(agent_name) VALUES (N'Local demo agent'); SET @agent = SCOPE_IDENTITY();
INSERT dbo.integration_partners(partner_name, agent_id) VALUES (N'Local demo partner', @agent); SET @partner = SCOPE_IDENTITY();
-- Set @ship to the verified TAU03 dbo.ships.id and @port to the verified dbo.ports.id.
DECLARE @ship int = (SELECT id FROM dbo.ships WHERE ship_code='TAU03');
DECLARE @port int = (SELECT id FROM dbo.ports WHERE port_code='DEMO');
IF @ship IS NULL OR @port IS NULL THROW 50060, 'Provision/verify TAU03 and demo port first', 1;
INSERT dbo.partner_vessel_access(partner_id,ship_id) VALUES(@partner,@ship);
SELECT @agent agent_id,@partner partner_id,@ship ship_id,@port port_id;
```

Generate a key locally and copy it directly into a local PowerShell secret variable; do not save it in the repo or shell history:

```powershell
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$apiKey = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
$hashBytes = [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($apiKey))
$hashHex = [Convert]::ToHexString($hashBytes)
```

Insert the hash into SSMS as a hex literal, never the token; set expiry to a suitably short local-demo period:

```sql
INSERT dbo.partner_api_keys(partner_id,key_hash,expires_at)
VALUES (/* verified partner id */, 0x/* paste 64 hex chars */, DATEADD(day,1,SYSUTCDATETIME()));
```

The database key row supports revocation via `is_active=0` or `revoked_at=SYSUTCDATETIME()` and expiry via `expires_at`.

## PowerShell smoke request

Run Spring and Node locally. Populate `$apiKey` without echoing it (for example from a secure prompt), then:

```powershell
$headers = @{ 'X-API-Key' = $apiKey; 'Idempotency-Key' = [guid]::NewGuid().ToString() }
$body = @{ vesselImo='1234567'; voyageNo='DEMO-2026-01'; originPortCode='DEMO'; declaredEta='2026-11-20T10:00:00Z'; cargoType='container'; declaredTeu=100; serviceRequest='Local integration demo' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/api/v1/integration/voyages' -Headers $headers -ContentType 'application/json' -Body $body
```

Use the real IMO returned for TAU03 and a fresh voyage number in an actual demo. Repeat with identical body and same key to see replay; change body while retaining key to see 409. To revoke, update the key row. No UC-015 service is invoked.

## SSMS verification

```sql
SELECT v.id referenceId,s.ship_code,v.voyage_code,v.status,v.agent_id,v.origin_port_id,v.declared_eta,v.declared_teu
FROM dbo.voyages v JOIN dbo.ships s ON s.id=v.ship_id WHERE v.announced_by=N'partner-api' ORDER BY v.id DESC;
SELECT h.* FROM dbo.voyage_status_history h JOIN dbo.voyages v ON v.id=h.voyage_id WHERE v.announced_by=N'partner-api' ORDER BY h.id DESC;
SELECT partner_id,endpoint_code,idempotency_key,request_fingerprint,voyage_id FROM dbo.partner_voyage_idempotency ORDER BY id DESC;
```

## Limits

Partner setup, port/agent catalog ownership, key rotation UI, request rate limits, detailed audit retention, and external monitoring are not implemented. Migration only creates missing catalog tables and does not seed data. Current IMO validation checks seven digits; SQL identity lookup is the authoritative ship match. API-key hashes are unsalted SHA-256, appropriate for high-entropy random 256-bit tokens but not human passwords. Node's legacy UC-013 route remains unchanged and continues using its existing local-demo semantics. Database-backed integration cases require a local SQL Server with reviewed migration and authorized demo fixtures.
