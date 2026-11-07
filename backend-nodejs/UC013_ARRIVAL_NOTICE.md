# UC-013: Arrival Notice

## Architecture and routes

Client → Spring Boot (`localhost:8080`) → Node.js (`localhost:5000`) → SQL Server `CangThongMinh`. Only Node.js connects to SQL Server. UC-013 does not call a document-review or queue workflow.

| Method | Spring Boot | Node.js | Purpose |
|---|---|---|---|
| POST | `/api/v1/voyages` | `/api/voyages` | Create an arrival notice (HTTP 201) |
| GET | `/api/v1/voyages/{id}` | `/api/voyages/:id` | Retrieve the notice |

Every POST requires `Idempotency-Key` (1–200 characters). The key and SHA-256 request fingerprint are stored durably in SQL Server. Repeating the same key and normalized request returns HTTP 200 and the original resource. Reusing the key with a different request returns HTTP 409.

## Request

All fields use camelCase. Required: `vesselId`, `voyageNo`, `agentId`, `originPortId`, `declaredEta`, `cargoType`, `declaredTeu`. IDs are positive integers; `voyageNo` is at most 50 characters; ETA must be ISO 8601 with an explicit timezone; TEU is a non-negative 32-bit integer. Optional: `serviceRequest` (up to 1000 characters) and `priorityLevel` (non-negative integer).

```json
{
  "vesselId": 3,
  "voyageNo": "SP-2026-001",
  "agentId": 1,
  "originPortId": 1,
  "declaredEta": "2026-11-12T03:30:00+07:00",
  "cargoType": "container",
  "declaredTeu": 1800,
  "serviceRequest": "Cau bo x2",
  "priorityLevel": 2
}
```

The stored ETA is UTC (`DATETIME2(3)`); the API represents it as the corresponding UTC instant. Vessel IDs are verified against `dbo.ships` and `is_active`. A unique database key on `(ship_id, voyage_code)` prevents duplicate notices for the same vessel and voyage number. Success creates the voyage with status `ANNOUNCED` and a `voyage_status_history` row in the same transaction.

## Errors

Errors use `{ "success": false, "code": "...", "message": "..." }`; field errors may also include `errors`.

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing/invalid field or Idempotency-Key |
| 404 | `VESSEL_NOT_FOUND` / `VOYAGE_NOT_FOUND` | Referenced vessel or notice does not exist |
| 409 | `VESSEL_INACTIVE` | Vessel is inactive |
| 409 | `VOYAGE_ALREADY_EXISTS` | Duplicate vessel and voyage number; response includes `existingVoyageId` |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Same key with different request; response includes prior `existingVoyageId` |
| 500 | `INTERNAL_ERROR` | Generic database/service failure; internal details are logged server-side only |
| 502 | Spring gateway error | Node service unavailable or returned an upstream server error |

Example conflict:

```json
{
  "success": false,
  "code": "VOYAGE_ALREADY_EXISTS",
  "message": "An arrival notice already exists for this vessel and voyage number",
  "existingVoyageId": 42
}
```

## Apply migration manually

No application startup runs migrations. In SSMS, select the `CangThongMinh` instance and execute `database/migrations/004_uc013_arrival_notice.sql` after UC-011. The migration alters the existing `dbo.voyages`, replaces its single-column unique key on `voyage_code` with a unique index on `(ship_id, voyage_code)`, and creates `dbo.voyage_status_history` and `dbo.voyage_idempotency` if missing. It preserves existing columns and rows. If legacy rows already duplicate a ship/code pair, it stops with an error; resolve those records deliberately before rerunning. The migration intentionally does not mark new fields `NOT NULL`, so older UC-011 voyage rows remain valid.

`agent_id` and `origin_port_id` are demo references only: no agent/port master schema was found, so no foreign keys or fabricated master data are introduced. Migration itself is transactional.

## Manual API checks (PowerShell)

Start Node.js and Spring Boot. Replace the IDs with an existing active ship and demo agent/port identifiers. `Invoke-RestMethod` serializes the timestamp as provided; the Node service converts it to UTC.

```powershell
$body = @{
  vesselId = 3; voyageNo = 'SP-2026-001'; agentId = 1; originPortId = 1
  declaredEta = '2026-11-12T03:30:00+07:00'; cargoType = 'container'; declaredTeu = 1800
  serviceRequest = 'Cau bo x2'; priorityLevel = 2
} | ConvertTo-Json
$headers = @{ 'Idempotency-Key' = 'arrival-SP-2026-001-demo-001' }
$created = Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/api/v1/voyages' -Headers $headers -ContentType 'application/json' -Body $body
$created | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Get -Uri "http://localhost:8080/api/v1/voyages/$($created.data.id)" | ConvertTo-Json -Depth 8
```

Repeat the exact POST with the same key and payload: it returns the same `data.id` with HTTP 200. Reuse that key after changing `declaredTeu`: it returns 409 `IDEMPOTENCY_KEY_REUSED`. Use a fresh key but repeat the same `vesselId` and `voyageNo`: it returns 409 `VOYAGE_ALREADY_EXISTS` and the existing ID. For status inspection and exact HTTP codes, `curl.exe -i` may be used with the same JSON and `-H "Idempotency-Key: ..."`.

## Inspect in SSMS

```sql
SELECT id, ship_id, voyage_code, status, eta, declared_eta, agent_id,
       origin_port_id, cargo_type, declared_teu, announced_at, announced_by
FROM dbo.voyages
ORDER BY id DESC;

SELECT id, voyage_id, status, changed_at, changed_by
FROM dbo.voyage_status_history
ORDER BY id DESC;

SELECT idempotency_key, request_fingerprint, voyage_id, created_at
FROM dbo.voyage_idempotency
ORDER BY id DESC;
```

## Demo limits

- Authentication, role authorization, and trusted agent identity are not implemented. `announced_by = local-demo` is an audit placeholder, not an authenticated user.
- Agent and port IDs are accepted as positive identifiers; there are no master tables available for authoritative validation.
- Save Draft is a frontend-only behavior and has no API here.
- UC-015 document checks and queueing are not implemented. Creating an announcement does not claim documents were checked and does not enqueue the vessel. `ANNOUNCED` is the integration point for a later UC-015 workflow. UC-011's deactivation check treats it as an unfinished voyage and therefore blocks deactivation.
- This feature does not implement UC-014 or ETA prediction.
