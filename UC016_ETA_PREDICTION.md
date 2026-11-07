# UC-016 – Tích hợp dự báo ETA

**Bàn giao một phần FR-VES-05: adapter HTTP, API, lịch sử và cập nhật queue đã triển khai; chưa có mô hình AI được huấn luyện/đánh giá trong repository.** Mặc định trả UNAVAILABLE. Không có dịch vụ giả lập được đóng gói thành AI thật, không có confidence ngẫu nhiên. Chưa chạy migration 007 hoặc kết nối SQL Server Windows trong phiên Codex này. Không triển khai UC-017.

## Nhánh và bằng chứng hiện có

- Nhánh UC-016: `feat/uc016-eta-prediction`, xuất phát đúng **`57af0e0ac4e3bd4576157e147a93dd2cc0271cc2`** của `feat/uc015-validation-queue`.
- PR mới dùng **base `feat/uc015-validation-queue`**, không dùng main khi PR #2 còn mở; diff UC-016: `git diff 57af0e0 HEAD`. Không merge PR #1/#2 hoặc sửa main.
- Theo kết quả Windows người dùng cung cấp: migration 006 đã chạy trên `CangThongMinh_UC015_Test`; voyage 1 đã VALID/QUEUED, voyage 2 vẫn ANNOUNCED. Đây là thông tin bàn giao từ người dùng, không phải kết quả được agent chạy lại.
- Giữ nguyên migration 001–006 và databaseSafety.js/db.js của commit gốc; không ghi hoặc xóa dữ liệu SQL gốc.

## Khảo sát dữ liệu/mô hình

Source hiện có voyage/ship/port, ETA khai báo, cargo/TEU và các cột ATA/ATD của migration 002. Không thấy SRS độc lập, thiết kế ML riêng, dataset, model artifact, training pipeline, metrics, nguồn AIS/vận tốc hoặc weather trong repo. Có cột ATA không chứng minh có đủ dữ liệu lịch sử để học; Codex không truy cập DB Windows để xác nhận số mẫu.

Đầu vào adapter chỉ lấy những gì source có thể đọc thật:

- Tàu: ID, IMO, loại, capacity, lengthOverall, draft từ `ships`.
- Chuyến: voyageId, declaredEta UTC, cargoType, declaredTeu; originPort ID/code từ `voyages`/`ports`.
- Tối đa 20 voyage COMPLETED gần nhất của cùng tàu/cảng đi, có declared_eta và ATA, sắp ATA/id giảm dần. Chỉ dùng rows SQL thực trả về; không tự sinh lịch sử. Đây là lịch sử sai lệch giờ đến, không phải thời gian hành trình do thiếu departure timestamp/route đầy đủ.
- `speedKnots: null`, `weather: null`, `missingFeatures` ghi rõ thiếu nguồn; historicalArrivals rỗng nếu không có dữ liệu. Không lấy capacity hoặc chiều dài làm tốc độ, không suy diễn weather.

Provider phải xử lý missing features hoặc từ chối. Không thêm dependency Python/FastAPI/ML vì chưa có model/data để chạy inference có ý nghĩa. `/predict/eta` là hợp đồng với dịch vụ độc lập do nhóm cung cấp, **không phải route mới của Node hoặc Spring**.

## Kiến trúc và ngân sách thời gian

```text
Operator local + X-UC015-Key
  → Spring 8080 (RestClient, giữ HTTP/JSON)
  → Node 5000 (guard local/key + DB/server/GUID)
  → đọc snapshot từ SQL TEST, kiểm tra VALID và hồ sơ còn đạt
  → adapter HTTP POST <ETA_AI_BASE_URL>/predict/eta (không có SQL transaction)
  → mở transaction, kiểm tra DB identity lại, lấy applock UC015
  → đọc lại snapshot/hồ sơ, lưu history, áp dụng hoặc discard, reorder nguyên tử
```

Adapter trong `services/etaPredictionAdapter.js` là chỗ tích hợp duy nhất; UC-016 tái sử dụng `predictSafely`, không có thuật toán ETA thứ hai. UC-015 vẫn giữ adapter mặc định UNAVAILABLE và wrapper 1500 ms; cấu hình HTTP provider **chỉ được nối vào workflow UC-016 tường minh**, không tự kéo dài request validate. Các fixture UC-015 có inject adapter vẫn chạy, nay phải đáp ứng contract source/confidence/version đầy đủ.

UC-016 mặc định đợi tối đa **10000 ms** cho provider, tính cả kết nối, headers và body. `ETA_AI_TIMEOUT_MS` cho phép số nguyên 1–10000; thiếu/sai/ngoài khoảng dùng 10000, không tăng vô hạn. Timeout abort HTTP request rồi ghi fallback. UC-015 không chờ thêm 10 giây nên không phá fast path đã kiểm thử.

Yêu cầu ngoại lệ sau 10 giây được lấy từ yêu cầu bàn giao, chưa đối chiếu văn bản SRS riêng vì repo chưa có. Tổng latency API còn gồm SQL/lock (applock timeout riêng 10000 ms), có thể vượt 10 giây. Không tuyên bố SLA 5 giây/10 giây end-to-end. Muốn tự kích hoạt dự báo sau UC-015 cần worker/outbox có retry/lease; chưa triển khai cơ chế đó. Operator gọi API UC-016 sau UC-015 trong demo hiện tại.

## Hợp đồng provider HTTP

Cấu hình qua biến môi trường trước khi start Node:

| Biến | Quy tắc |
|---|---|
| `ETA_AI_BASE_URL` | Base URL gốc không path/query/userinfo; HTTPS hoặc HTTP loopback. Không đặt: NOT_CONFIGURED |
| `ETA_AI_MODE` | Phải là MODEL khi bật external provider; không tự hiểu demo là MODEL |
| `ETA_AI_MODEL_VERSIONS` | Danh sách modelVersion đã review, phân cách dấu phẩy; không rỗng, so khớp chính xác |
| `ETA_AI_API_KEY` | Tùy chọn, forward Authorization: Bearer từ env; không lưu vào history/log/repo |
| `ETA_AI_TIMEOUT_MS` | Mặc định 10000, giới hạn như trên; không áp dụng vào timeout UC-015 |

Dùng URL từ cấu hình server, không nhận URL hoặc credential qua API body. Không follow redirect. Response phải application/json, tối đa 64 KiB; raw error body bị bỏ, không lưu credential/nội dung lỗi provider.

Ví dụ request schema (các ID/giá trị dưới đây chỉ là minh họa contract, không phải snapshot DB test đã được agent đọc):

```json
{
  "contractVersion": "1",
  "voyageId": 1,
  "vessel": {"id": 7, "imo": "9074729", "type": "Container", "capacity": 200, "lengthOverall": 100, "draft": 9},
  "originPort": {"id": 1, "code": "TEST"},
  "declaredEta": "2026-11-10T12:00:00.000Z",
  "cargoType": "container",
  "declaredTeu": 10,
  "speedKnots": null,
  "weather": null,
  "historicalArrivals": [],
  "missingFeatures": ["speedKnots", "weather", "historicalArrivals"]
}
```

Provider response hợp lệ:

```json
{
  "aiStatus": "AVAILABLE",
  "predictionSource": "MODEL",
  "predictedEta": "2026-11-10T14:00:00.000Z",
  "etaConfidence": 0.8,
  "modelVersion": "<version-model-da-review>"
}
```

Đây chỉ là schema, không phải kết quả mô hình thật. Kiểm tra: UTC có Z, ngày tồn tại, độ chính xác tối đa milliseconds, không trước thời điểm request; confidence là number hữu hạn trong [0,1], chấp nhận cả 0 và 1; version không rỗng/tối đa 100 ký tự và phải nằm trong allowlist. Không chấp nhận confidence dạng chuỗi. Status/source `DEMO_SIMULATED` bị từ chối dù modelVersion được allowlist. Source thiếu hoặc khác MODEL cũng không đạt.

Thiếu cấu hình, lỗi mạng/HTTP, timeout, JSON sai/quá lớn, model chưa review, ETA/confidence sai hoặc kết quả demo → UNAVAILABLE, predictedEta/confidence/deviation/modelVersion NULL, effectiveEta bằng ETA khai báo. Failure reason dùng mã cố định, không chép tùy ý error text từ provider.

## API Node và Spring

Dùng lại **`UC015_DEMO_ENABLED=true`, NODE_ENV khác production, socket loopback, X-UC015-Key và DB identity guard ba thành phần**. Spring kiểm tra local/key trước rồi forward đúng header; Node xác thực token. Không public endpoint ghi không được bảo vệ, không tin X-Forwarded-For hoặc role do client gửi.

| Method | Node | Spring |
|---|---|---|
| POST, không cần body | `/api/voyages/:id/eta-prediction` | `/api/v1/voyages/{id}/eta-prediction` |
| GET | `/api/voyages/:id/eta-predictions` | `/api/v1/voyages/{id}/eta-predictions` |

GET trả 50 bản ghi gần nhất theo ID giảm dần, response `{success:true,data:[...],nextBeforeId:null hoặc cursor}`. Dùng `?beforeId=<nextBeforeId>` để xem trang tiếp. ID prediction/cursor là chuỗi BIGINT nhằm tránh mất chính xác JavaScript. History đọc được kể cả voyage hiện không còn VALID và không gọi AI; không cần policy còn hiệu lực để đọc audit. GET không ghi DB. POST không dùng Idempotency-Key: gọi lại có chủ đích tạo một attempt mới.

Response POST 200 khi provider được chấp nhận hoặc khi fallback đã được commit:

```json
{
  "predictionId": "1",
  "voyageId": 1,
  "declaredEta": "2026-11-10T12:00:00.000Z",
  "predictedEta": null,
  "etaDeviationH": null,
  "etaConfidence": null,
  "aiStatus": "UNAVAILABLE",
  "effectiveEta": "2026-11-10T12:00:00.000Z",
  "modelVersion": null,
  "failureReason": "NOT_CONFIGURED",
  "applicationStatus": "APPLIED",
  "discardReason": null,
  "requestedAt": "2026-11-07T00:00:00.000Z",
  "predictedAt": "2026-11-07T00:00:00.010Z"
}
```

`predictedAt` là thời điểm Node hoàn tất/ghi nhận attempt, không giả là timestamp model server trả về. ETA đều UTC. Khi có dự báo hợp lệ, `etaDeviationH = (predictedEta - declaredEta) / 3600000`, số giờ có dấu, làm tròn 6 chữ số thập phân trong SQL computed column. Confidence lưu DECIMAL(9,8); số chữ số lưu không có nghĩa mô hình chính xác đến mức đó.

| HTTP | Ý nghĩa |
|---|---|
| 200 | Attempt APPLIED; có thể AVAILABLE hoặc UNAVAILABLE fallback, không tự coi 200 là AI thành công |
| 400 | ID/cursor sai, không gọi provider |
| 401/403 | Thiếu/sai key hoặc không local/demo; không gọi provider |
| 404 | Voyage không tồn tại |
| 422 | Chưa VALID/không đúng lifecycle/hồ sơ không đạt; không promote thành VALID |
| 409 | Input đổi hoặc kết quả cùng chuyến đã được áp dụng trước; attempt bị discard |
| 503 | DB identity/key/policy/lock không khả dụng; không bỏ guard để chạy tiếp |
| 500 Node / 502 Spring | Lỗi SQL/hệ thống; rollback history, pointer, prediction và queue của transaction |

POST chỉ thực hiện khi `validation_result=VALID`, validated_at có giá trị và status VALIDATED hoặc QUEUED; QUEUED phải có queue_position. Kiểm tra lại policy/IMO/active/hạn chế/tài liệu UC-015 bằng nguồn hiện tại. Các precondition fail trước khi gọi AI không tạo history prediction.

Nếu điều kiện đổi sau lúc gọi AI, trả 409/422 với `{success:false,code,currentDeclaredEta,currentEffectiveEta,attempt}`. Attempt ghi DISCARDED, giữ kết quả/schema/model version đã nhận để audit, kèm discardReason. **AVAILABLE trong history DISCARDED chỉ mô tả response provider cho input cũ, không được dùng làm ETA của voyage.** effectiveEta của attempt DISCARDED là declaredEta của snapshot cũ; currentEffectiveEta ngoài attempt và GET queue là trạng thái hiện tại. Không overwrite voyage khi discard.

Một attempt APPLIED trong quá khứ không chứng minh hồ sơ hiện tại vẫn còn hợp lệ. UC-015 revalidation có thể thay đổi state sau đó; đọc queue/voyage hiện tại để biết hiệu lực vận hành.

## Lưu trữ và transaction

Migration mới: `backend-nodejs/database/migrations/007_uc016_eta_prediction.sql`.

- `USE [CangThongMinh_UC015_Test]` và guard DB_NAME trong cùng batch với DDL. Transaction TRY/CATCH, XACT_ABORT; không tự chạy khi start app.
- Tạo `dbo.voyage_eta_predictions` nếu chưa có. Lưu input JSON thực gửi và SHA-256, declared/predicted ETA, computed signed deviation, confidence, status/version/failure/discard reasons, thời điểm request/completion, APPLIED/DISCARDED.
- PK BIGINT, FK voyage, UNIQUE(voyage_id,id), index theo voyage/id giảm dần; CHECK confidence [0,1], JSON, cặp AVAILABLE/UNAVAILABLE và application/discard reason.
- Thêm `voyages.latest_eta_prediction_id` nullable, không default/backfill. Composite FK `(id,latest_eta_prediction_id)` bảo đảm pointer cùng voyage, không trỏ prediction của chuyến khác. Không tạo confidence/modelVersion cache thứ hai trên voyages, tránh lệch audit khi UC-015 chạy lại.
- Tái sử dụng predicted_eta, ai_status, eta_input_hash của 006; **không đổi declared_eta, eta legacy, validation_result, validated_at, status hoặc queued_at**. Queue_position chỉ được reorder bằng shared helper UC-015 sau prediction APPLIED của chuyến QUEUED.
- FK/index tham chiếu cột vừa thêm dùng sp_executesql, tránh compile-before-ADD COLUMN. Không ALTER migration 001–006, không UPDATE/DELETE voyage 1/2 khi chạy migration.

Node lấy snapshot/hồ sơ/history trước network, gọi provider ngoài transaction. Sau đó dùng SERIALIZABLE, kiểm tra identity SQL trên chính connection ghi, lấy applock resource **SmartPort:UC015:queue**, đọc lại dưới row/range locks. So sánh hash toàn bộ model input và latest_eta_prediction_id với snapshot để chặn input cũ và kết quả concurrent đến muộn. Giữ lại hash đơn giản UC-015 trên voyage để revalidate không bỏ prediction UC-016 chỉ vì khác cách tạo input rich.

History INSERT + pointer/ETA update + queue reorder cùng transaction; lỗi bất kỳ bước nào rollback tất cả. Reorder dùng chính helper SQL mới tách từ UC-015: effective ETA tăng, priority giảm khi ETA bằng, queued_at/id. Không ghi voyage_status_history hoặc tạo membership mới, không xếp hàng tự động một voyage VALIDATED. Failure AI APPLIED gỡ prediction cũ, dùng declaredEta và reorder tương ứng; không lưu confidence cũ thành kết quả của lần lỗi.

Hồ sơ không đủ để cover ETA mới làm attempt DISCARDED; UC-016 không tự sửa kết quả validation/loại voyage khỏi queue. Cần operator chạy lại UC-015 nếu hồ sơ đã đổi. Guard policy hết hạn/DB mismatch/DB failure có thể khiến attempt không được ghi vì transaction không được phép hoàn tất; không tuyên bố audit durable cho request chưa commit.

## Windows – chỉ trên DB test đã xác nhận

1. Lưu work đang làm, fetch/checkout `feat/uc016-eta-prediction`; xác nhận `git merge-base --is-ancestor 57af0e0 HEAD`. Không merge main. Có thể xem riêng diff bằng `git diff 57af0e0 HEAD`.
2. Dừng Node cũ. Giữ `CangThongMinh` nguyên trạng. DB `CangThongMinh_UC015_Test` đã có 006 theo bàn giao; backup DB test trước 007 để có điểm phục hồi. Không restore đè nguồn và không chạy lại 001–006.
3. Trong SSMS, dùng cùng Windows principal mà Node dùng, xác nhận identity và baseline bằng các query chỉ đọc dưới đây. Nếu khác DB/server/GUID đã review thì dừng.
4. Review 007, rồi người dùng tự quyết định chạy file đó trên DB test. Guard tên không thay thế kiểm tra instance/GUID. Agent chưa chạy migration. Sau 007, voyage 1/2 và queue/history UC-015 phải giữ nguyên; bảng prediction rỗng, latest_eta_prediction_id NULL.
5. Giữ chính sách/key/local/DB guard UC-015. Ví dụ env trong PowerShell ở root repo (thay placeholder, không commit credential):

```powershell
$env:DB_SERVER = '<dia-chi-instance-da-xac-nhan>'
$env:DB_DATABASE = 'CangThongMinh_UC015_Test'
$env:UC015_TEST_SERVER_NAME = '<serverName-tu-SQL>'
$env:UC015_TEST_DATABASE_GUID = '<databaseGuid-tu-SQL>'
$env:UC015_DEMO_ENABLED = 'true'
$env:NODE_ENV = 'development'
$env:HOST = '127.0.0.1'
$env:UC015_POLICY_FILE = 'C:\SmartPortDemo\uc015-policy.json'
# UC015_OPERATOR_TOKEN: dùng token ngẫu nhiên đã cấu hình của phiên demo, không hardcode trong repo.
# Giữ DOCUMENT_STORAGE_DIR của bộ demo nếu cần đọc tài liệu.
```

Không có provider thật: để ETA_AI_BASE_URL unset. Sau khi có provider đã được review, cấu hình thêm trước start Node:

```powershell
$env:ETA_AI_BASE_URL = 'http://127.0.0.1:8000' # chỉ nếu đã có dịch vụ thật đang chạy tại đây
$env:ETA_AI_MODE = 'MODEL'
$env:ETA_AI_MODEL_VERSIONS = '<version-da-review>'
$env:ETA_AI_TIMEOUT_MS = '10000'
# ETA_AI_API_KEY: chỉ đặt trong env nếu provider yêu cầu, không in vào log.
```

Không có server Python được triển khai trong PR này; không chạy câu lệnh FastAPI giả. Base URL không tự tạo AI. Đổi env phải restart Node, không để process cũ chiếm port 5000.

6. Preflight chỉ đọc qua chính db.js, so log identity với SSMS trước POST:

```powershell
Set-Location backend-nodejs
node -e "require('./db').poolPromise.then(p=>p.close()).catch(e=>{console.error(e.message);process.exitCode=1})"
if ($LASTEXITCODE -ne 0) { throw 'Dung lai: DB test chua xac minh' }
Start-Process node -ArgumentList 'server.js' -WorkingDirectory $PWD
```

Terminal thứ hai: JDK25, trong QLDAPM chạy `gradlew.bat bootRun --args="--server.address=127.0.0.1 --smartport.node-api.base-url=http://127.0.0.1:5000"`. Terminal gọi API phải có operator token đúng:

```powershell
$headers = @{ 'X-UC015-Key' = $env:UC015_OPERATOR_TOKEN }
# Chỉ sau khi 007 đã review/chạy trên DB test và preflight đúng identity.
Invoke-RestMethod -Method Post -Headers $headers http://127.0.0.1:8080/api/v1/voyages/1/eta-prediction | ConvertTo-Json -Depth 8
Invoke-RestMethod -Headers $headers http://127.0.0.1:8080/api/v1/voyages/1/eta-predictions | ConvertTo-Json -Depth 8
Invoke-RestMethod -Headers $headers http://127.0.0.1:8080/api/v1/voyages/queue | ConvertTo-Json -Depth 8
```

Voyage 1 theo bàn giao đã VALID/QUEUED: nếu policy/hồ sơ vẫn đạt, không có provider sẽ trả 200 UNAVAILABLE, lưu một attempt fallback, không thêm lifecycle history/đổi queued_at. Gọi lại tạo attempt mới, không tạo membership. Voyage 2 ANNOUNCED phải trả 422 VOYAGE_NOT_VALIDATED, không gọi AI/ghi prediction; không tự chuyển sang VALID để demo PASS.

200 UNAVAILABLE vẫn **ghi history/pointer/fallback**, có thể reorder queue nếu bỏ prediction cũ; không dùng POST làm dry-run. GET history/queue chỉ đọc. Các case timeout, invalid confidence/JSON, dấu +/- và concurrency có thể chạy bằng unit/HTTP fixture tests; để smoke test ghi dữ liệu, dùng fixture test riêng đã review trên DB sao chép, không bịa dữ liệu lịch sử/weather/speed cho production.

## SSMS – chỉ đọc trước/sau 007 và POST

```sql
USE [CangThongMinh_UC015_Test];
GO
SELECT DB_NAME() AS databaseName,
       CONVERT(nvarchar(128),SERVERPROPERTY(N'ServerName')) AS serverName,
       CONVERT(varchar(36),database_guid) AS databaseGuid
FROM sys.database_recovery_status WHERE database_id=DB_ID();

-- Chạy được trước 007: lưu baseline để so sánh sau migration.
SELECT id,ship_id,status,validation_result,declared_eta,predicted_eta,ai_status,queue_position,queued_at,validated_at
FROM dbo.voyages WHERE id IN (1,2) ORDER BY id;
SELECT * FROM dbo.voyage_status_history WHERE voyage_id IN (1,2) ORDER BY id;
SELECT COUNT(*) AS voyages_count FROM dbo.voyages;
SELECT COUNT(*) AS histories_count FROM dbo.voyage_status_history;

-- Chỉ chạy sau khi 007 thành công:
SELECT id,status,validation_result,latest_eta_prediction_id,queue_position,queued_at
FROM dbo.voyages WHERE id IN (1,2);
SELECT id,voyage_id,declared_eta,predicted_eta,eta_deviation_h,eta_confidence,ai_status,model_version,
       application_status,discard_reason,failure_reason,requested_at,predicted_at,input_hash
FROM dbo.voyage_eta_predictions WHERE voyage_id IN (1,2) ORDER BY id DESC;
SELECT id,queue_position,COALESCE(predicted_eta,declared_eta) AS effective_eta,priority_level,queued_at
FROM dbo.voyages WHERE queue_position IS NOT NULL ORDER BY queue_position;

-- Không có row mong đợi:
SELECT queue_position,COUNT(*) AS duplicates FROM dbo.voyages WHERE queue_position IS NOT NULL
GROUP BY queue_position HAVING COUNT(*)>1;
SELECT * FROM dbo.voyage_eta_predictions WHERE eta_confidence<0 OR eta_confidence>1;
```

Không dùng NOLOCK. Không sửa ngày/approve giấy tờ để ép dự báo thành công; policy/tài liệu hết hạn phải được reviewer xử lý theo UC-015.

## Xác minh AI thật, giới hạn và phần SRS còn thiếu

AVAILABLE là trạng thái hợp đồng từ provider cấu hình, **không tự chứng minh đó là ML thật**. Trước khi bật MODEL/allowlist, nhóm phải cung cấp artifact/digest và modelVersion tái lập, preprocessing/feature schema, provenance dataset, train/validation/test split theo thời gian, MAE/RMSE/bias theo cảng/tàu, dữ liệu ngoài mẫu và phép kiểm calibration/coverage cho confidence. Lưu bằng chứng review bên ngoài repo hoặc model card được quản lý; không tự ghi metrics không đo.

Hiện chưa có dữ liệu/model artifact/metrics đó. Tests dùng modelVersion có tên unit/http fixture và upstream HTTP stub, không phải dịch vụ AI đáng tin cậy. Không có confidence ngẫu nhiên hoặc thuật toán demo được đóng gói như MODEL. Nếu nhóm sau này cung cấp demo `predictionSource=DEMO_SIMULATED`, adapter sẽ nhận diện và trả UNAVAILABLE thay vì đưa kết quả đó vào queue.

Chưa hoàn thành inference/huấn luyện FR-VES-05, tích hợp AIS/weather, chứng minh độ tin cậy/calibration, đánh giá accuracy/drift, tự kích hoạt bằng worker/outbox hoặc SLA end-to-end. Local/operator/shared token chưa thay thế production authentication/RBAC. Chưa có Windows SQL integration chạy bởi agent cho 007; cần xác minh DDL/computed column/FK/index/ODBC/applock/rollback trên DB test. Không thực hiện gửi cảnh báo UC-017.

## File và kiểm thử

Thêm migration 007, `services/voyageEtaPrediction.js`, `services/voyageQueue.js`, `routes/voyageEtaPrediction.js`, hai test Node UC-016 và tài liệu này. Sửa adapter UC-015 thành contract/HTTP adapter dùng chung; tách guard/queue helper từ UC-015, mount route, thêm Controller/Service/RestClient và HTTP integration tests Spring. Fixture UC-015 được bổ sung confidence/source/version để đáp ứng contract nghiêm ngặt, không bỏ/skip test cũ. Không thêm dependency hoặc sửa migration 001–006/databaseSafety.js/db.js. UC-015 vẫn chỉ cần schema 006; schema 007 chỉ được truy cập khi gọi các API UC-016 mới. Gọi UC-016 khi chưa áp dụng 007 là lỗi hệ thống/schema, không được biến thành kết quả thiếu hồ sơ.

Chạy lại trên Windows:

```powershell
Set-Location backend-nodejs
npm ci
npm test
Get-ChildItem -Recurse -Filter *.js | Where-Object { $_.FullName -notmatch '\\node_modules\\' } | ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw 'JS syntax check failed' }
}
Set-Location ..\QLDAPM
$env:JAVA_HOME = 'C:\duong-dan-jdk-25'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat clean test
Set-Location ..
git diff 57af0e0 HEAD --check
```

Kết quả cloud đã chạy:

| Check | Kết quả |
|---|---|
| `npm test` | **159/159 PASS**, 0 fail/skip, gồm hồi quy UC-010–015 |
| `node --check` | **22/22 tệp JS PASS** ngoài node_modules |
| JDK 25 + Gradle `clean test` | **81/81 PASS**, 0 failure/error/skip |
| `git diff --check` | **PASS** |
| SQL Server / migration 007 / provider ML thật | **Chưa chạy/chưa có bằng chứng**, không đánh dấu toàn UC-016 PASS |

Node kiểm tra actual HTTP client với provider stub; SQL orchestration dùng transaction double có staged state/mutex, không phải engine SQL Server. Spring chạy app thật với HTTP upstream stub. Không coi mock là bằng chứng SQL integration hoặc dự báo AI thật.
