# UC-012: Vessel documents (development/demo)

No UC-012 SRS or object-storage adapter was present when this was implemented. The current design uses SQL Server for document metadata and a local storage adapter for file bytes. Replace the storage adapter with MinIO/object storage when that service is selected.

## Local file storage

Set `DOCUMENT_STORAGE_DIR` before starting Node.js. The directory must be outside the `backend-nodejs` repository; the application rejects a path inside that repository. If unset, files go to `%TEMP%\smartport-vessel-documents` on Windows (the OS temp directory on other systems).

```powershell
$env:DOCUMENT_STORAGE_DIR = 'D:\SmartPortData\vessel-documents'
node server.js
```

The server stores files under random UUID keys, checks PDF/JPEG/PNG file signatures, and limits each file to 10 MiB. The uploaded filename is metadata only. Downloads are served by the API; local paths and storage keys are not returned by list or metadata endpoints.

## Migration

Review and run `database/migrations/003_uc012_vessel_documents.sql` manually in SSMS after confirming the earlier ship migrations have been applied. The application does not execute migrations. The migration creates `dbo.ship_documents`, its ship foreign key, review/file-size checks, unique storage key and ship/date index.

## Spring multipart configuration

Spring Boot accepts a file up to 10 MB and a multipart request up to 11 MB to allow fields and multipart framing. Node.js applies the authoritative file size and file-signature checks.

## API routes

All routes are available through Spring Boot on port 8080 and Node.js on port 5000.

| Method | Spring Boot path | Purpose |
|---|---|---|
| POST | `/api/v1/vessels/{shipId}/documents` | Upload multipart fields `document_type` and `file` |
| GET | `/api/v1/vessels/{shipId}/documents` | List a vessel's metadata |
| GET | `/api/v1/vessels/{shipId}/documents/{documentId}` | Read metadata |
| GET | `/api/v1/vessels/{shipId}/documents/{documentId}/download` | Download original bytes |
| PATCH | `/api/v1/vessels/{shipId}/documents/{documentId}/review` | Demo-only review of a pending document |

Example upload using `curl.exe`:

```powershell
curl.exe -i -F "document_type=REGISTRATION" -F "file=@C:\Temp\ship.pdf;type=application/pdf" http://localhost:8080/api/v1/vessels/3/documents
```

Example success response:

```json
{
  "success": true,
  "data": {
    "id": 12,
    "ship_id": 3,
    "document_type": "REGISTRATION",
    "original_filename": "ship.pdf",
    "mime_type": "application/pdf",
    "file_size": 12345,
    "review_status": "PENDING"
  }
}
```

Review accepts `{"status":"APPROVED"}` or `{"status":"REJECTED","reviewNote":"Reason"}` through Spring Boot (`/api/v1/...`). Spring also accepts the legacy `review_note` alias. Spring translates either spelling to Node's canonical `review_note` property on `PATCH /api/ships/:id/documents/:documentId/review`. Direct Node requests use `review_note`. The server ignores any client-supplied reviewer identity and stores `local-demo`.

Spring Boot example:

```powershell
$body = @{ status = 'REJECTED'; reviewNote = 'Missing signature' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri 'http://localhost:8080/api/v1/vessels/3/documents/12/review' -ContentType 'application/json' -Body $body
```

Direct Node example:

```powershell
$body = @{ status = 'REJECTED'; review_note = 'Missing signature' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri 'http://localhost:5000/api/ships/3/documents/12/review' -ContentType 'application/json' -Body $body
```

## Inspect metadata in SQL Server

```sql
SELECT id, ship_id, document_type, original_filename, mime_type,
       file_size, review_status, uploaded_at, reviewed_at,
       reviewed_by, review_note
FROM dbo.ship_documents
WHERE ship_id = 3
ORDER BY uploaded_at DESC, id DESC;
```

## Demo limitations

Review routes have no authentication or role enforcement because the project has no real identity system. Do not expose them to untrusted users or treat `local-demo` as an authenticated reviewer. Local storage is suitable only for a single development/demo instance; production needs access controls, backups, malware scanning and a shared object-storage implementation.
