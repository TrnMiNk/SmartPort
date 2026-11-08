# SMARTPORT — HANDOFF CODEX WEB → CODEX VS CODE (UC016)

Kiểm tra ngày **08/11/2026 (Asia/Bangkok)**. Repository: https://github.com/TrnMiNk/SmartPort.
Workspace Windows do người dùng cung cấp: `C:\Users\trann\Desktop\SmartPort`.

**Mục tiêu tiếp theo:** xác minh local, tiếp tục phần AI ETA thật của UC016/FR-VES-05 dựa trên dữ liệu/model có bằng chứng. Đây là bàn giao; không triển khai UC017, không tự chạy migration hoặc ghi vào database gốc.

## A. Git status và điểm tiếp tục chính xác

### A1. GitHub đã kiểm tra trực tiếp

| Nhánh | HEAD đầy đủ | PR / trạng thái | Base |
|---|---|---|---|
| `main` | `35e5cb3e9ac3e3d318db8d8f9b50fae8473745ce` | Chưa nhận merge các PR bên dưới | — |
| `fix/uc014-tests-http` | `b97bb7d06166ed8d5e98e449b95e4467ae19df9e` | [#1](https://github.com/TrnMiNk/SmartPort/pull/1): OPEN, DRAFT, chưa merge | `main` |
| `feat/uc015-validation-queue` | `57af0e0ac4e3bd4576157e147a93dd2cc0271cc2` | [#2](https://github.com/TrnMiNk/SmartPort/pull/2): OPEN, DRAFT, chưa merge | `fix/uc014-tests-http` |
| `feat/uc016-eta-prediction` | `26bd008197a32aabf0b2179ceab70e8a7f8b696a` | [#3](https://github.com/TrnMiNk/SmartPort/pull/3): OPEN, DRAFT, chưa merge | `feat/uc015-validation-queue` |

Quan hệ commit thực tế:

```text
35e5cb3 main
  └─ b97bb7d fix/uc014-tests-http          PR #1 → main
      └─ c3ef869 triển khai UC015 demo
          └─ 57af0e0 guard DB TEST        PR #2 → fix/uc014-tests-http
              └─ 26bd008 UC016 adapter   PR #3 → feat/uc015-validation-queue
                  └─ docs/uc016-vscode-handoff: chỉ thêm tài liệu này
```

- **Code nghiệp vụ mới nhất:** `feat/uc016-eta-prediction` / `26bd008`. Checkout riêng main hoặc UC014 sẽ thiếu UC015/UC016.
- **Nhánh bàn giao:** `docs/uc016-vscode-handoff`, base chính xác `26bd008`; chỉ thêm `CODEX_VSC_HANDOFF_UC016.md`. Commit tài liệu được báo trong phản hồi bàn giao; có thể xác minh bằng `git log -1 --format=fuller -- CODEX_VSC_HANDOFF_UC016.md`.
- Tại thời điểm kiểm tra có 4 branch GitHub trước khi tạo branch tài liệu. Không thấy branch/PR/commit mới hơn liên quan AI ETA thật trong các ref đang có; không thể suy ra tình trạng service/data/model nằm ngoài repository hoặc commit không được ref nào trỏ tới.
- Checkout cloud ban đầu ở `fix/uc014-tests-http` / `b97bb7d`, working tree sạch. Đã đọc code UC016 trong worktree riêng từ `26bd008`, ban đầu sạch. Không có thay đổi source nghiệp vụ đang dang dở trong workspace cloud này; chỉ có tài liệu bàn giao mới.
- **Chưa kiểm tra được working tree Windows.** Không giả định local Windows giống GitHub. Các file policy, token, cấu hình SQL hoặc model bên ngoài Git cũng chưa được đọc.
- Không merge, reset, force push hoặc sửa main trong phiên bàn giao.

### A2. Đồng bộ Windows an toàn

Chạy trong PowerShell. Nếu `git status` có thay đổi, dừng và trình bày chúng; không tự stash, checkout đè hoặc reset.

```powershell
Set-Location 'C:\Users\trann\Desktop\SmartPort'
git status --short --branch
git remote -v
if (git status --porcelain) { throw 'Working tree chưa sạch; dừng để xem thay đổi local.' }

# RefSpec tường minh cũng dùng được khi clone ban đầu chỉ fetch main.
# Không thêm dấu +/--force. Nếu non-fast-forward, dừng và kiểm tra.
git fetch origin refs/heads/feat/uc016-eta-prediction:refs/remotes/origin/feat/uc016-eta-prediction refs/heads/docs/uc016-vscode-handoff:refs/remotes/origin/docs/uc016-vscode-handoff
if ($LASTEXITCODE -ne 0) { throw 'Fetch chưa thành công; không tiếp tục checkout.' }

# Nếu branch tài liệu chưa tồn tại local:
git switch --no-track -c docs/uc016-vscode-handoff refs/remotes/origin/docs/uc016-vscode-handoff
# Nếu đã tồn tại, dùng git switch docs/uc016-vscode-handoff thay lệnh trên,
# rồi so sánh HEAD với remote; không tự merge/reset để ép giống.
if ($LASTEXITCODE -ne 0) { throw 'Switch chưa thành công; dừng và kiểm tra branch local.' }

git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 26bd008197a32aabf0b2179ceab70e8a7f8b696a HEAD
if ($LASTEXITCODE -ne 0) { throw 'Nhánh này chưa chứa baseline UC016 đã bàn giao.' }
git diff 26bd008197a32aabf0b2179ceab70e8a7f8b696a HEAD --name-status
Get-Content .\CODEX_VSC_HANDOFF_UC016.md
```

Ở nhánh bàn giao, diff so với `26bd008` phải chỉ là tài liệu này. Nếu khác, kiểm tra tiến độ mới trước khi sửa. Sau khi xác minh, có thể tạo branch local mới từ nhánh bàn giao để làm AI, ví dụ `git switch -c work/uc016-ai-eta-local` nếu tên chưa tồn tại. Không tự push/merge. Để xem riêng UC016 dùng `git diff 57af0e0 26bd008`; để xem riêng guard DB UC015 dùng `git show 57af0e0`.

### A3. Danh sách file thay đổi theo PR

Danh sách A/M chính xác được ghi ở phụ lục cuối file, lấy từ Git giữa các mốc đã xác minh. Nhánh tài liệu không sửa các file đó. Những phần chưa hoàn tất là chức năng ML/nguồn dữ liệu/đánh giá bên dưới, không phải một patch local chưa commit đã được tìm thấy.

## B. Kiến trúc, API và lưu trữ

### B1. Cây source cần đọc

```text
QLDAPM/                             Spring Boot 4.1.2, Java 25, Gradle 9.8.2, :8080
  src/main/java/smartport_m1m/
    m1/controller/VoyageController.java        UC013 + UC015 + UC016 methods
    m1/controller/VoyageExceptionHandler.java shared advice (Voyage + Partner)
    m1/service/VoyageService.java             proxy/error mapping
    service/VoyageApiClient.java              RestClient → Node, X-UC015-Key
  src/test/java/.../VoyageHttpIntegrationTest.java
backend-nodejs/                      Express 5/CommonJS, :5000, Windows ODBC
  server.js                         mount validation/ETA trước router voyage cũ
  db.js, databaseSafety.js           pool + identity guard
  routes/voyageValidation.js         local/demo/token guard + validate/queue
  routes/voyageEtaPrediction.js      POST prediction, GET history/cursor
  services/voyageValidation.js       UC015 orchestration
  services/voyageValidationPolicy.js policy, IMO, hồ sơ còn hiệu lực
  services/voyageQueue.js            applock + reorder dùng chung
  services/voyageEtaPrediction.js    snapshot → provider → recheck → history/apply
  services/etaPredictionAdapter.js   HTTP contract + fallback duy nhất
  config/uc015-policy.example.json   ví dụ hết hạn có chủ đích, không dùng nguyên bản
  database/migrations/001...007*.sql
  test/db.test.js, uc011...uc016*.test.js
UC014_PARTNER_INTEGRATION.md
UC015_VOYAGE_VALIDATION_QUEUE.md
UC016_ETA_PREDICTION.md
```

UC015/016 được thêm vào **VoyageController/VoyageService/VoyageApiClient có sẵn**, không có controller Java ETA riêng. Spring không kết nối SQL Server; JPA/DataSource đã tắt trong application.properties dù dependency JPA/PostgreSQL còn được khai báo.

```text
Operator (loopback, X-UC015-Key)
 → Spring :8080 → RestClient → Node :5000
 → verify SQL database/server/GUID → đọc snapshot/chứng từ/lịch sử từ SQL TEST
 → HTTP POST <ETA_AI_BASE_URL>/predict/eta (không giữ SQL transaction)
 → SERIALIZABLE transaction → verify identity lại trên connection ghi
 → sp_getapplock SmartPort:UC015:queue → recheck snapshot/pointer/chứng từ
 → history + apply ETA/pointer + reorder queue cùng transaction, hoặc lưu DISCARDED
```

### B2. API hiện có

| Method | Spring | Node | Ghi dữ liệu? |
|---|---|---|---|
| GET | `/api/v1/ping` | — | Không; không chứng minh DB/provider khỏe |
| GET | `/api/v1/voyages/{id}` | `/api/voyages/:id` | Không |
| POST | `/api/v1/voyages/{id}/validate` | `/api/voyages/:id/validate` | **Có, kể cả kết quả nghiệp vụ 422** |
| GET | `/api/v1/voyages/queue` | `/api/voyages/queue` | Không DML; có transaction/shared applock/identity check |
| POST, không cần body | `/api/v1/voyages/{id}/eta-prediction` | `/api/voyages/:id/eta-prediction` | **Có, kể cả fallback 200 UNAVAILABLE** |
| GET | `/api/v1/voyages/{id}/eta-predictions?beforeId=...` | `/api/voyages/:id/eta-predictions?beforeId=...` | Không DML; có transaction/shared lock |

UC015/016 dùng `X-UC015-Key` (khác `X-API-Key` của đại lý UC014). Spring kiểm tra socket local/header và forward key; Node yêu cầu demo bật, NODE_ENV khác production, socket loopback thật, token hợp lệ 32–512 ký tự. Không tin X-Forwarded-For. Node dùng constant-time hash comparison. Auth/RBAC production chưa có.

GET history trả `{success:true,data:[...],nextBeforeId:null hoặc cursor}`; mỗi trang 50 bản ghi, ID/cursor là chuỗi BIGINT. GET không gọi AI, đọc được history của voyage nay không còn VALID. POST không dùng Idempotency-Key: gọi lại tạo attempt mới.

UC015 validate trả object có voyageId, validationResult, validationReason, status, queuePosition, predictedEta, aiStatus, declaredEta, effectiveEta, validatedAt, queuedAt, priorityLevel, validationPolicyHash. Kết quả hợp lệ đi `ANNOUNCED → VALIDATED → QUEUED`; recheck không nhân lifecycle history/membership. `MISSING_DOCUMENTS`/`REJECTED` là kết quả đã commit và trả 422, không phải rollback toàn request.

UC016 POST chỉ nhận voyage VALID, validated_at có giá trị, lifecycle VALIDATED/QUEUED; QUEUED phải có vị trí. Kiểm tra policy, IMO/ship active, hạn chế và chứng từ hiện tại trước/sau network. Không tự promote ANNOUNCED thành VALID. Ví dụ **schema fallback**, không phải kết quả SQL vừa đọc:

```json
{
  "predictionId":"1", "voyageId":1,
  "declaredEta":"2026-11-10T12:00:00.000Z", "predictedEta":null,
  "etaDeviationH":null, "etaConfidence":null, "aiStatus":"UNAVAILABLE",
  "effectiveEta":"2026-11-10T12:00:00.000Z", "modelVersion":null,
  "failureReason":"NOT_CONFIGURED", "applicationStatus":"APPLIED", "discardReason":null,
  "requestedAt":"2026-11-08T00:00:00.000Z", "predictedAt":"2026-11-08T00:00:00.010Z"
}
```

HTTP: 200 attempt APPLIED (AVAILABLE **hoặc** UNAVAILABLE); 400 ID/cursor sai; 401/403 key/local/demo; 404 voyage thiếu; 422 chưa VALID/chứng từ không đạt; 409 input thay đổi hoặc kết quả bị supersede; 503 identity/policy/key cấu hình/lock; SQL/system 500 ở Node → 502 ở Spring. Các lỗi nghiệp vụ 400/401/403/404/409/422/503 giữ status và JSON qua Spring.

Nếu input/pointer/chứng từ đổi trong lúc đợi AI, có thể lưu attempt DISCARDED, trả 409/422 với `{success:false,code,currentDeclaredEta,currentEffectiveEta,attempt}`. `AVAILABLE` trong attempt DISCARDED không được coi là ETA đang áp dụng. Nếu identity/DB/policy không cho commit thì có thể không lưu được attempt; không đảm bảo audit durable cho request chưa commit.

### B3. Contract provider `/predict/eta`

Đây là URL **outbound của service độc lập**, không phải route inference đã được triển khai trong Spring/Node. Hiện chưa có provider thật trong repo.

```json
{
  "contractVersion":"1", "voyageId":1,
  "vessel":{"id":7,"imo":"9074729","type":"Container","capacity":200,"lengthOverall":100,"draft":9},
  "originPort":{"id":1,"code":"TEST"}, "declaredEta":"2026-11-10T12:00:00.000Z",
  "cargoType":"container", "declaredTeu":10,
  "speedKnots":null, "weather":null, "historicalArrivals":[],
  "missingFeatures":["speedKnots","weather","historicalArrivals"]
}
```

Các giá trị trên chỉ minh họa schema. Source đọc tối đa 20 voyage COMPLETED của cùng ship/origin port có declared_eta và ATA, lấy `voyageId/declaredEta/actualArrival`. Không biết số bản ghi thực tế. Thiếu departure/route nên đây là lịch sử sai lệch ETA, không tự gọi là thời gian hành trình. Tốc độ/weather hiện null, không bịa từ capacity/chiều dài tàu.

Provider hợp lệ phải trả:

```json
{
  "aiStatus":"AVAILABLE", "predictionSource":"MODEL",
  "predictedEta":"2026-11-10T14:00:00.000Z",
  "etaConfidence":0.8, "modelVersion":"<reviewed-model-version>"
}
```

Ví dụ confidence chỉ minh họa hợp đồng, không phải accuracy/calibration đã đo. Adapter yêu cầu UTC ngày tồn tại, hậu tố Z, tối đa milliseconds, không trước requestedAt; confidence number hữu hạn [0,1]; modelVersion trong allowlist, không rỗng/tối đa 100 ký tự. Source thiếu/khác MODEL hoặc DEMO_SIMULATED bị loại. Không follow redirect; JSON tối đa 64 KiB; không lưu raw error/credential provider.

Failure reasons cố định: NOT_CONFIGURED, INVALID_CONFIGURATION, TIMEOUT, SERVICE_ERROR, INVALID_RESPONSE, DEMO_NOT_ACCEPTED, UNAPPROVED_MODEL. Fallback xóa predictedEta/confidence/modelVersion/deviation về null và dùng declaredEta.

### B4. Schema, migration và bất biến phải giữ

- 001–005 cần schema nền có sẵn (ships và các bảng cũ); 001 không tạo database/ships từ đầu. 002 tạo voyages/history ship lifecycle; 003 tài liệu; 004 arrival/history/idempotency; 005 master partner/key/grant/ports/agents. Xem SQL thực tế trước khi suy ra constraint.
- 006 thêm `ship_documents.valid_from/valid_until`, các cột validation/policy/AI/queue trên voyages, CHECK/index, unique queue_position. **File 006 trong repo vẫn có `USE [CangThongMinh]`; không chạy nguyên file hoặc chạy lại trên database gốc.** Người dùng báo đã áp dụng bản review trên TEST. Không tự sửa hoặc thực thi migration cũ khi bàn giao.
- 007 phụ thuộc 001–006; có `USE [CangThongMinh_UC015_Test]` và guard DB_NAME, nhưng guard tên không thay thế server/GUID. Tạo `voyage_eta_predictions`: BIGINT PK, FK voyage, UNIQUE(voyage_id,id), input_json/hash, ETA, confidence DECIMAL(9,8), status/version/reasons/requested_at/predicted_at. Deviation computed PERSISTED có dấu: `(predictedEta - declaredEta)/3600000`, DECIMAL(18,6). CHECK JSON/confidence/result/application status.
- 007 thêm `voyages.latest_eta_prediction_id` nullable và composite FK `(id,latest_eta_prediction_id)` → `(voyage_id,id)`, index history. Không seed/backfill hoặc tự chuyển lifecycle.
- History + ETA/pointer + queue reorder phải commit/rollback cùng nhau. Không giữ SQL transaction khi chờ provider. Giữ SERIALIZABLE, recheck hash đầy đủ input và pointer, applock `SmartPort:UC015:queue`.
- UC016 không đổi declared_eta, eta legacy, validation_result, validated_at, status, queued_at; không ghi lifecycle history/membership mới. Chỉ reorder khi voyage QUEUED. Queue: effective ETA tăng, priority giảm khi ETA bằng, queued_at/id.
- Fallback APPLIED có thể bỏ prediction cũ và reorder queue. Không dùng POST fallback như dry-run. UC015 revalidation có thể đổi hiệu lực hiện tại dù history prediction cũ còn APPLIED.
- Không gắn provider 10 giây vào fast path validate UC015 (wrapper 1500 ms). UC016 explicit budget 1–10000 ms, mặc định 10000, bao gồm đọc response body; applock timeout riêng 10000 ms. Chưa đo SLA end-to-end 5/10 giây.
- Giữ nguyên validation/idempotency/HTTP UC010–014, thứ tự route `/queue` trước UC013 `/:id`, shared advice, file signature/limit tài liệu, guards DB/local/token và các test hồi quy.

## C. Tình trạng AI và mức độ bằng chứng

| Thành phần | Bằng chứng ở code/ref đã kiểm tra | Kết luận |
|---|---|---|
| Python/FastAPI/inference service | Không có file Python, requirements, service/container ML trong 83 file tracked ở 26bd008 | Chưa triển khai trong repo |
| Dataset và provenance | Không có CSV/Parquet/dataset manifest; có SQL feature reader | Không biết dữ liệu thật đủ/được phép dùng hay không |
| Model artifact/modelVersion review | Không có artifact/digest/model card; chỉ allowlist cấu hình và version fixture | Chưa có model thật được chứng minh |
| Training/preprocessing/inference pipeline | Không có | Cần thiết kế sau khi xác minh dữ liệu |
| MAE/RMSE/bias/calibration | Không có kết quả đo/held-out evaluation | Không được điền số liệu hoặc confidence giả |
| HTTP `/predict/eta` | Adapter và tests với stub | Transport/contract đã có; chưa là provider ML thật |
| History/fallback/apply/discard/queue | Source + SQL doubles + Spring HTTP tests | Đã có workflow, chưa chứng minh SQL engine bằng mock |
| AIS/weather/tốc độ | Gửi null và missingFeatures | Thiếu nguồn; không tự suy diễn |
| Tự kích hoạt sau UC013/014/015 | Không có worker/outbox | Workflow demo vẫn operator gọi thủ công |

`AVAILABLE` + `MODEL` chỉ là contract do provider khai báo, không chứng minh mô hình học máy thật. Allowlist string không kiểm tra digest artifact. Cần dữ liệu có quyền sử dụng, label ATA, timestamp prediction/as-of để tránh leakage, feature schema tái lập, time split, baseline declared ETA và metrics ngoài mẫu. Nếu không có dữ liệu, làm data audit/contract/gap report trước; không tạo dataset giả rồi gọi là real training.

**UC016 mới bàn giao một phần FR-VES-05**, chưa hoàn thiện ML/metrics/calibration/AIS/weather/automation/SLA. Repository không có SRS FR-VES-05 độc lập để xác minh đầy đủ acceptance criteria; cần lấy bản được review nếu công việc phụ thuộc chi tiết đó. UC017 chưa triển khai.

### C1. Kết quả Windows do người dùng cung cấp (không chạy lại trên cloud)

- SQL Server 2022, Windows Authentication, ODBC Driver 18.
- TEST database `CangThongMinh_UC015_Test`, server identity `MinhMaj`, database GUID `D385EE44-C4AA-466B-BF82-ED1B5A8AD147`.
- UC010–014 đã kiểm thử các luồng demo chính; 006 và 007 đã chạy trên TEST; đường Spring → Node → SQL TEST đã kiểm thử.
- Voyage 1: VALID/QUEUED, queuePosition 1, queued_at `2026-11-07 03:54:15.602`; prediction ID 1, UNAVAILABLE/NOT_CONFIGURED/APPLIED, effective ETA bằng declared ETA.
- Voyage 2: ANNOUNCED; POST prediction 422 và không có prediction history.

Đây là trạng thái **lần kiểm thử gần nhất do người dùng báo**, không bảo đảm DB hiện tại vẫn vậy. Không suy ra timezone của queued_at ngoài thông tin được cung cấp. Tài liệu UC016 cũ ghi agent chưa chạy 007; điều đó không mâu thuẫn việc người dùng đã chạy 007 sau đó. Không vì câu cũ mà tự chạy lại migration.

## D. Cấu hình Windows và bảo vệ database

Yêu cầu JDK **25** (`java -version` phải đúng toolchain), Node có native fetch/node:test (cloud dùng **v24.22.1**, repo chưa pin engines), SQL Server 2022 và Microsoft ODBC Driver 18 cùng kiến trúc Node. Native msnodesqlv8 cần môi trường Windows phù hợp. Không cài Python/FastAPI khi chưa có provider/pipeline được chọn.

| Biến | Cấu hình / lưu ý |
|---|---|
| DB_SERVER | Địa chỉ kết nối instance thực tế. `localhost` chỉ đúng nếu nối tới instance đã xác minh; không đồng nhất địa chỉ này với SERVERPROPERTY |
| DB_DATABASE | **CangThongMinh_UC015_Test**, đặt tường minh trong mọi terminal chạy app |
| UC015_TEST_SERVER_NAME | **MinhMaj**, phải khớp metadata SQL |
| UC015_TEST_DATABASE_GUID | **D385EE44-C4AA-466B-BF82-ED1B5A8AD147**, phải khớp metadata SQL |
| UC015_DEMO_ENABLED | `true` để bật guard và workflow local UC015/016 |
| NODE_ENV | `development`, không `production` |
| HOST / PORT | `127.0.0.1` / `5000` |
| UC015_POLICY_FILE | File policy đã review bên ngoài repo; đúng ship_type/document_type và còn hiệu lực |
| UC015_OPERATOR_TOKEN | Token phiên demo 32–512 ký tự, nhập kín, gửi qua X-UC015-Key; không lưu vào tài liệu/Git/log |
| DOCUMENT_STORAGE_DIR | Giữ thư mục dữ liệu tài liệu ngoài repo đã dùng; default thư mục tạm không phải lưu trữ bền vững |
| ETA_AI_BASE_URL | Để unset khi chưa có provider thật; HTTPS hoặc HTTP loopback, URL gốc không path/query/userinfo |
| ETA_AI_MODE | MODEL chỉ khi có provider thật được review |
| ETA_AI_MODEL_VERSIONS | Allowlist version chính xác phân cách dấu phẩy; phải có bằng chứng model ngoài fixture |
| ETA_AI_TIMEOUT_MS | 1–10000; mặc định 10000, không phải SLA toàn request |
| ETA_AI_API_KEY | Tùy provider; env-only, Bearer, không in/commit |

`db.js` đọc env trực tiếp, chưa tự nạp `.env`. Nếu không đặt DB_DATABASE và demo guard tắt, default vẫn là **CangThongMinh gốc**. Vì vậy không start app bằng cấu hình cũ/unset. `databaseSafety.js` chặn tên gốc/system DB khi demo bật; pin tên DB/server/GUID, kiểm tra metadata trước trả pool và trên transaction ghi; mismatch/unverifiable đóng pool hoặc chặn request. Không bỏ guard/đổi GUID để ép chạy.

### D1. Preflight SQL chỉ đọc, bắt buộc trước mọi POST

Trong SSMS, dùng cùng Windows principal với Node. Chỉ đọc; không chạy migration, restore, UPDATE hoặc INSERT:

```sql
USE [CangThongMinh_UC015_Test];
GO
DECLARE @server nvarchar(128) = CONVERT(nvarchar(128), SERVERPROPERTY(N'ServerName'));
DECLARE @guid uniqueidentifier = (
    SELECT database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID()
);
IF DB_NAME() <> N'CangThongMinh_UC015_Test'
   OR @server IS NULL OR LOWER(@server) <> N'minhmaj'
   OR @guid IS NULL OR @guid <> CONVERT(uniqueidentifier,N'D385EE44-C4AA-466B-BF82-ED1B5A8AD147')
    THROW 51016, 'STOP: database/server/GUID do not match the reviewed TEST target.', 1;
SELECT DB_NAME() AS databaseName, @server AS serverName, @guid AS databaseGuid;
SELECT COL_LENGTH('dbo.voyages','validation_result') AS validationColumn,
       COL_LENGTH('dbo.voyages','latest_eta_prediction_id') AS predictionPointer,
       OBJECT_ID('dbo.voyage_eta_predictions','U') AS predictionHistoryTable;
```

Nếu thiếu quyền metadata hoặc identity khác: dừng, không xem đó là lý do bỏ guard. Nếu thiếu cột/bảng: báo lệch schema, không tự chạy 006/007. Sau khi schema đúng, đọc baseline voyage/history/queue bằng các query trong `UC016_ETA_PREDICTION.md`; so với thông tin C1, không ghi đè để ép giống.

### D2. Env cho Node (sau khi xác minh identity)

```powershell
Set-Location 'C:\Users\trann\Desktop\SmartPort'
$env:DB_SERVER = Read-Host 'Địa chỉ SQL instance đã xác minh (localhost chỉ nếu đúng instance)'
$env:DB_DATABASE = 'CangThongMinh_UC015_Test'
$env:UC015_TEST_SERVER_NAME = 'MinhMaj'
$env:UC015_TEST_DATABASE_GUID = 'D385EE44-C4AA-466B-BF82-ED1B5A8AD147'
$env:UC015_DEMO_ENABLED = 'true'
$env:NODE_ENV = 'development'
$env:HOST = '127.0.0.1'
$env:PORT = '5000'
$env:UC015_POLICY_FILE = 'C:\SmartPortDemo\uc015-policy.json' # thay bằng policy thật đã review
if (!(Test-Path $env:UC015_POLICY_FILE)) { throw 'Thiếu policy đã review.' }
$secureToken = Read-Host 'Operator token phiên demo' -AsSecureString
$env:UC015_OPERATOR_TOKEN = ([pscredential]::new('unused', $secureToken)).GetNetworkCredential().Password
if ($env:UC015_OPERATOR_TOKEN.Length -lt 32 -or $env:UC015_OPERATOR_TOKEN.Length -gt 512) {
    throw 'Token không đúng độ dài; không in token ra màn hình.'
}
# Chưa có provider thật: không tự đặt ETA_AI_BASE_URL/MODE/MODEL_VERSIONS.
# Kiểm tra riêng các biến đó nếu terminal cũ đã đặt; không dump toàn bộ env chứa secrets.
Set-Location backend-nodejs
node -e "require('./db').poolPromise.then(p=>p.close()).catch(e=>{console.error(e.message);process.exitCode=1})"
if ($LASTEXITCODE -ne 0) { throw 'Preflight DB thất bại; không start server hoặc POST.' }
node server.js
```

Kiểm tra đúng process chiếm cổng 5000/8080 trước khi start; không tự kill process chưa xác định. Env thay đổi cần restart đúng Node process. Spring chỉ forward operator header; Node xác thực token. Terminal GET/POST cần cùng token đã cấu hình, nhập kín; không giả định env truyền sang terminal đã mở từ trước.

Terminal khác cho Spring:

```powershell
Set-Location 'C:\Users\trann\Desktop\SmartPort\QLDAPM'
$env:JAVA_HOME = 'C:\duong-dan-JDK-25' # thay bằng JDK25 thực tế
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
java -version
.\gradlew.bat bootRun --args="--server.address=127.0.0.1 --smartport.node-api.base-url=http://127.0.0.1:5000"
```

Policy sample trong repo có hạn năm 2000 để fail closed; không tự kéo dài thời hạn/chấp thuận giấy tờ cho test PASS. `reviewedAt/validUntil`, requiredDocumentTypesByShipType và restrictedImos phải do reviewer xác nhận. Token/policy content không được ghi log.

## E. Kiểm thử và giới hạn

### E1. Bằng chứng mới chạy lại khi bàn giao

Trên source **26bd008**, ngày 08/11/2026:

| Check | Kết quả trực tiếp |
|---|---|
| Node v24.22.1 + `npm test` | **159/159 PASS**, 0 fail/skip/cancel |
| `node --check` | **22/22 tệp JS PASS**, ngoài node_modules |
| JDK25 + Gradle `clean test` | **81/81 PASS**, 0 failure/error/skip |
| Source diff trước thêm handoff | Sạch; không sửa code nghiệp vụ |
| Python tests/model evaluation | Không có service/test/model Python để chạy |
| SQL Server Windows/007/provider ML thật | Không truy cập/chạy trong phiên bàn giao |

Dependencies Node dùng cache đã có cùng package/lockfile, không sửa dependency. Test HTTP adapter thực sự dùng HTTP client nhưng server là **stub**. SQL orchestration dùng staged doubles/mutex mô phỏng applock, không thực thi T-SQL trên engine SQL Server. Spring HTTP tests chạy ứng dụng thật với Node upstream giả lập. Không suy ra SQL/ODBC/DDL/computed column/FK/isolation/concurrency thật hay MAE/RMSE từ các test này.

Các test quan trọng: `test/uc016-eta-adapter.test.js` (contract, confidence, version, timestamp, timeout/body, redirect), `test/uc016-eta-prediction.test.js` (eligibility, feature rows, signed deviation, fallback, stale/discard, rollback, concurrency, cursor, guards), `test/uc015-validation.test.js`, `test/db.test.js` và `VoyageHttpIntegrationTest.java` (status/JSON/headers và hồi quy UC013–016).

### E2. Lệnh Windows không dùng database thật

```powershell
Set-Location 'C:\Users\trann\Desktop\SmartPort\backend-nodejs'
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed.' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'Node tests failed.' }
Get-ChildItem -Recurse -Filter *.js | Where-Object { $_.FullName -notmatch '\\node_modules\\' } | ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $($_.FullName)" }
}
Set-Location ..\QLDAPM
$env:JAVA_HOME = 'C:\duong-dan-JDK-25'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
.\gradlew.bat clean test
if ($LASTEXITCODE -ne 0) { throw 'Java tests failed.' }
Set-Location ..
git diff --check
```

Không có lệnh pytest/uvicorn hiện hành. Chỉ thêm Python tests khi có code provider thật trong scope đã thống nhất; không dựng fake FastAPI rồi báo AI hoàn tất.

### E3. Smoke GET chỉ đọc và POST cần điều kiện riêng

Sau D1/D2 và app start thành công, trong terminal đã nhập operator token kín:

```powershell
if (!$env:UC015_OPERATOR_TOKEN) { throw 'Nhập kín cùng operator token của Node trước khi GET.' }
$headers = @{ 'X-UC015-Key' = $env:UC015_OPERATOR_TOKEN }
Invoke-RestMethod 'http://127.0.0.1:8080/api/v1/ping'
Invoke-RestMethod -Headers $headers 'http://127.0.0.1:8080/api/v1/voyages/queue' | ConvertTo-Json -Depth 8
Invoke-RestMethod -Headers $headers 'http://127.0.0.1:8080/api/v1/voyages/1/eta-predictions' | ConvertTo-Json -Depth 8
Invoke-RestMethod 'http://127.0.0.1:8080/api/v1/voyages/2' | ConvertTo-Json -Depth 8
```

Không dùng GET ping thay preflight DB. GET history/queue có lock/identity checks nhưng không ghi nghiệp vụ. Không bật debug log toàn bộ headers/token. Nếu thiếu token trong terminal, nhập lại kín cùng token của server; không gửi header rỗng rồi kết luận service hỏng.

**Bàn giao không cấp lệnh tự động POST/migration.** Trước POST bất kỳ: kiểm tra identity khớp DB TEST/server/GUID, schema 006/007 tồn tại, policy/chứng từ còn hiệu lực, baseline trạng thái hiện tại và phạm vi ghi được người dùng cho phép. POST validate 422 vẫn ghi validation; POST prediction 200 fallback vẫn ghi history/pointer và có thể reorder. Không dùng voyage 1/2 như fixture có thể xóa/khôi phục tùy tiện. SQL integration nên chạy trên bản TEST/fixture được review, không phải CangThongMinh gốc; lập kế hoạch transaction/concurrency và backup trước, không tự migrate.

## F. Việc tiếp tục theo ưu tiên

| Ưu tiên | File cần đọc/chỉnh (chưa được sửa trong handoff) | Mục tiêu và điều kiện hoàn thành | Test/bằng chứng cần bổ sung | Rủi ro / migration |
|---|---|---|---|---|
| P0 — Xác minh workspace và DB | Handoff, git status, db.js, databaseSafety.js, UC015/016 docs, migrations 006/007 | Đúng baseline/branch; liệt kê thay đổi Windows; chỉ đọc identity/schema/baseline TEST; nêu rõ lệch trạng thái | Git ancestry, unit suite, SSMS/preflight chỉ đọc nếu có quyền | Dừng khi identity khác; **không migration** |
| P1 — Data audit và FR-VES-05 | buildEtaInput trong voyageEtaPrediction.js; migrations 002/004/006/007; SRS được cung cấp ngoài repo | Kiểm kê nguồn thật, quyền dùng, số mẫu/coverage/missingness, ATA/declaredEta/as-of timestamps, leakage; xác định yêu cầu accuracy/confidence | Báo cáo truy vấn chỉ đọc trên TEST đã xác minh; dataset manifest không secret; không xuất dữ liệu khi chưa được phép | Lộ dữ liệu/leakage/thiếu labels; chưa cần migration |
| P2 — Model và evaluation tái lập | Adapter contract; vị trí đề xuất ai-eta/ chỉ tạo khi scope/data được chốt | Dùng artifact đã được review hoặc train trên dữ liệu thật đã được phép; preprocessing/feature schema; time split; baseline declared ETA; modelVersion + artifact SHA-256/model card | MAE/RMSE/bias theo tập ngoài mẫu và nhóm tàu/cảng; sample counts/split/seeds; test tái lập train/infer; không bịa target/metrics | Data ít/drift; confidence chưa định nghĩa; **không migration mặc định** |
| P3 — Provider inference thật | services/etaPredictionAdapter.js, voyageEtaPrediction.js; ai-eta/ đề xuất nếu chọn Python/FastAPI | Serve artifact thật theo /predict/eta; missing features trung thực; model/version allowlist có evidence; endpoint local/HTTPS, timeout và input schema | Python unit/contract nếu có Python; integration Node → service thật với model thật; malformed/OOD/missing/timeouts; không chỉ stub | Model loading/auth/secrets/latency; không đổi migration 001–007; chỉ đề xuất migration mới nếu thật sự cần schema |
| P4 — Confidence và acceptance | Model card/evaluation provider + adapter tests | Định nghĩa ý nghĩa confidence, calibration/coverage; đối chiếu acceptance FR-VES-05 với reviewer | Held-out calibration/coverage, baseline comparison, latency end-to-end đo thật | Scalar [0,1] không tự là xác suất; không tự đặt tiêu chí PASS; migration chỉ nếu bổ sung schema được duyệt |
| P5 — SQL integration và hồi quy | services/voyageEtaPrediction.js, voyageQueue.js, voyageValidation.js; Node/Java tests | Provider thật + SQL TEST: verify apply/discard, computed deviation +/-/confidence/FK, rollback, stale/concurrent, queue, giữ queued_at và lifecycle | SQL engine integration trên fixture được phép + tất cả Node/Java; record version/identity/time, không ghi gốc | Mock mutex không chứng minh applock SQL; không tự chạy DDL/migration |
| P6 — Automation sau khi chốt scope | server.js, UC013/014/015/016 services; worker/outbox đề xuất | Hiện manual, chưa tự trigger; chỉ thiết kế/triển khai khi được yêu cầu riêng, có retry/idempotency/lease và không kéo dài UC015 fast path | Crash/retry/concurrency/SLA tests; đánh giá tác động | Có thể cần migration outbox mới sau review; **không tự làm UC017** |

Nếu P1 thiếu dữ liệu/model/SRS/quyền truy cập, hoàn tất phần kiểm kê và báo chính xác thứ còn thiếu; hỏi người dùng về nguồn/artifact khi cần, tiếp tục công việc độc lập trong scope. Không dùng dữ liệu giả, confidence ngẫu nhiên hoặc metric fixture để tuyên bố AI thật.

## G. Quy tắc bắt buộc cho Codex VS Code

1. Đọc handoff và source thực tế trước khi sửa; kiểm tra AGENTS.md nếu có. Không giả định local giống GitHub hoặc các trạng thái DB C1 còn nguyên.
2. Kiểm tra git status trước checkout; không dùng git reset --hard hoặc tự stash/clean/checkout đè. Không tự push, merge, force push hoặc sửa main.
3. Không ghi, migrate, restore đè hoặc xóa dữ liệu **CangThongMinh gốc**. Không tự thực thi migration kể cả trên TEST. Không tắt identity guard hoặc thay GUID để ép kết quả.
4. Mọi POST là khả năng ghi; chỉ thực hiện trên TEST đã xác minh và trong phạm vi được người dùng cho phép. Giữ dữ liệu voyage/history/queue có sẵn.
5. Không commit/in/log token/API key/.env/policy nhạy cảm. Không gửi dữ liệu thật sang provider chưa review.
6. Không tạo dataset/model/accuracy/confidence giả; AVAILABLE từ provider chưa chứng minh ML thật. Phân biệt user-reported, mock, SQL integration và metrics đã đo.
7. Không phá UC010–016 đã chạy; thay đổi nhỏ có test phù hợp, báo file/dòng, kết quả/giới hạn. Không tự mở rộng UC017 hoặc refactor lớn.

## H. Prompt tự chứa để bắt đầu trong Codex VS Code

Copy nguyên khối bên dưới. Prompt nằm trong chính tài liệu để không mất theo lịch sử chat.

```text
Bạn đang tiếp tục SmartPort từ Codex Web trong VS Code Windows.
Workspace: C:\Users\trann\Desktop\SmartPort; GitHub: TrnMiNk/SmartPort.
Đầu tiên đọc CODEX_VSC_HANDOFF_UC016.md, AGENTS.md nếu có, rồi source thực tế. Không chỉ dựa vào mô tả này.

Snapshot GitHub kiểm tra ngày 08/11/2026:
- main 35e5cb3; PR #1 fix/uc014-tests-http b97bb7d → main.
- PR #2 feat/uc015-validation-queue 57af0e0 → fix/uc014-tests-http (có commit triển khai c3ef869 trước guard).
- PR #3 feat/uc016-eta-prediction 26bd008197a32aabf0b2179ceab70e8a7f8b696a → feat/uc015-validation-queue.
- Cả 3 PR OPEN/DRAFT, chưa merge ở snapshot. Branch docs/uc016-vscode-handoff dựa trên 26bd008, chỉ thêm handoff.
Kiểm tra lại GitHub/local HEAD vì có thể đã tiến triển. Không tự merge/reset/force push/sửa main.

Kiến trúc: Spring Boot 4.1.2/Java25/Gradle, QLDAPM :8080 → HTTP RestClient → backend-nodejs Express :5000 → SQL Server 2022/Windows Auth/ODBC18. Spring không kết nối SQL trực tiếp.
UC015 demo validate hồ sơ/queue đã có; UC016 có HTTP adapter outbound /predict/eta, POST /api/v1/voyages/{id}/eta-prediction, GET .../{id}/eta-predictions, history/apply/discard/fallback và queue reorder. Header UC015/016 là X-UC015-Key, không phải X-API-Key của UC014. Đọc VoyageController, VoyageService, VoyageApiClient, databaseSafety.js, services/voyageEtaPrediction.js, etaPredictionAdapter.js, voyageValidation.js, voyageQueue.js và các test.

Chưa thấy Python/FastAPI, dataset/provenance, model artifact, train/infer pipeline, MAE/RMSE hoặc calibration thật trong ref 26bd008. Adapter/tests với stub không phải mô hình AI thật. speedKnots/weather hiện null; SQL history tối đa20 chuyến COMPLETED cùng tàu/cảng có declared_eta/ATA. Không suy ra đủ dữ liệu để train. Mục tiêu tiếp tục là phần AI ETA thật UC016/FR-VES-05; không làm UC017, không dựng fake AI/dataset/metrics/confidence rồi báo hoàn tất.

DB gốc CangThongMinh: tuyệt đối không ghi/migrate/xóa/restore đè.
TEST do người dùng xác nhận: CangThongMinh_UC015_Test; SQL server identity MinhMaj; GUID D385EE44-C4AA-466B-BF82-ED1B5A8AD147. DB_SERVER là địa chỉ kết nối thực tế, không tự đồng nhất với server identity. Luôn đặt DB_DATABASE TEST tường minh; UC015_DEMO_ENABLED=true, NODE_ENV=development, HOST=127.0.0.1, UC015_TEST_SERVER_NAME và UC015_TEST_DATABASE_GUID đúng identity. Giữ UC015_POLICY_FILE bên ngoài repo có policy đã review/còn hiệu lực; operator token nhập kín, không ghi/in/log/commit secrets. Provider chưa được review thì không bật ETA_AI_BASE_URL/MODE=MODEL/model allowlist.

Người dùng báo đã chạy migrations006/007 trên TEST và smoke Spring→Node→SQL: voyage1 VALID/QUEUED, queuePosition1, queued_at 2026-11-07 03:54:15.602, prediction1 UNAVAILABLE/NOT_CONFIGURED/APPLIED, effective ETA=declared ETA; voyage2 ANNOUNCED, prediction POST422, không history. Đây là trạng thái lần test gần nhất, không bảo đảm hiện tại. Migration006 trong repo còn USE CangThongMinh; không chạy nguyên file hoặc chạy lại. Không tự thực thi bất kỳ migration nào.

Cloud vừa chạy lại: Node159/159, JS syntax22/22, JDK25 Gradle clean test81/81 PASS. Đây là mock/upstream-stub, không phải SQL engine hoặc model evaluation. Không có Python tests hiện hành.

Hãy bắt đầu bằng công việc sau, theo thứ tự:
1) Chỉ đọc git status/branch/HEAD/remotes/log và kiểm tra ancestry chứa26bd008; liệt kê thay đổi local. Nếu dirty/khác snapshot, giải thích rồi chọn cách bảo toàn; không tự stash/reset/clean/checkout đè. Nếu sạch, dùng branch làm việc local riêng, không tự push/merge.
2) Đọc handoff/source/config và báo ngắn trạng thái đã xác minh, những giả định còn thiếu; lập kế hoạch nhỏ cho UC016 AI thật.
3) Chạy các test tự động không dùng DB; kiểm tra Java25/Node/ODBC. Chỉ đọc metadata/schema/baseline TEST khi có kết nối phù hợp; xác minh đủ databaseName/serverName/databaseGuid trước bất kỳ POST nào. Thiếu quyền/identity sai/schema khác thì dừng phần DB, không bỏ guard hoặc migrate.
4) Tìm dataset/model/provider/SRS thật đã có trong workspace và vị trí được người dùng cung cấp. Không quét/đọc credentials ngoài scope. Nếu chưa có, hoàn tất data/model gap audit và xác định nguồn/quyền/labels/as-of timestamps, time split, baseline declared ETA, modelVersion+artifact digest và định nghĩa confidence cần reviewer chốt. Không bịa số liệu hoặc đặt accuracy target tùy ý.
5) Khi có đủ dữ liệu/artifact được phép, tiếp tục task nhỏ P2/P3 trong handoff: pipeline/model evaluation tái lập hoặc provider thật theo contract; thêm test có ý nghĩa. Giữ fallback trung thực, timeout, version allowlist, không giữ SQL transaction khi đợi AI; giữ hash/pointer recheck, applock, rollback, lifecycle/queued_at và UC010–016 regression.
6) Báo file/dòng, test đã chạy, metric có bằng chứng, giới hạn cloud/Windows, việc cần người dùng cung cấp/cho phép. Chưa có bằng chứng thì không tuyên bố UC016/FR-VES-05 hoàn tất. Không tự POST, thay dữ liệu, export dataset, chạy migration, gửi dữ liệu ra provider hoặc triển khai UC017 ngoài phạm vi được phép.
```

## Phụ lục — File thay đổi ở các PR đã kiểm tra

Các block bên dưới là tên file từ Git, không phải danh sách file được sửa thêm trong bước bàn giao.

### PR #1 — UC014

```text
M	QLDAPM/src/main/java/smartport_m1m/m1/controller/VoyageController.java
A	QLDAPM/src/main/java/smartport_m1m/m1/controller/VoyageExceptionHandler.java
M	QLDAPM/src/main/java/smartport_m1m/m1/service/PartnerIntegrationService.java
M	QLDAPM/src/main/java/smartport_m1m/m1/service/VesselDocumentService.java
A	QLDAPM/src/test/java/smartport_m1m/m1/controller/VoyageHttpIntegrationTest.java
M	QLDAPM/src/test/java/smartport_m1m/m1/service/VesselDocumentServiceTest.java
M	UC014_PARTNER_INTEGRATION.md
M	backend-nodejs/db.js
M	backend-nodejs/routes/partnerIntegration.js
A	backend-nodejs/test/db.test.js
M	backend-nodejs/test/uc014-partner-integration.test.js
```

### PR #2 — UC015

```text
M	QLDAPM/src/main/java/smartport_m1m/m1/controller/VoyageController.java
M	QLDAPM/src/main/java/smartport_m1m/m1/service/VoyageService.java
M	QLDAPM/src/main/java/smartport_m1m/service/VoyageApiClient.java
M	QLDAPM/src/test/java/smartport_m1m/m1/controller/VoyageHttpIntegrationTest.java
A	UC015_VOYAGE_VALIDATION_QUEUE.md
A	backend-nodejs/config/uc015-policy.example.json
A	backend-nodejs/database/migrations/006_uc015_voyage_validation_queue.sql
A	backend-nodejs/databaseSafety.js
M	backend-nodejs/db.js
A	backend-nodejs/routes/voyageValidation.js
M	backend-nodejs/server.js
A	backend-nodejs/services/etaPredictionAdapter.js
A	backend-nodejs/services/voyageValidation.js
A	backend-nodejs/services/voyageValidationPolicy.js
M	backend-nodejs/test/db.test.js
A	backend-nodejs/test/uc015-validation.test.js
```

### PR #3 — UC016

```text
M	QLDAPM/src/main/java/smartport_m1m/m1/controller/VoyageController.java
M	QLDAPM/src/main/java/smartport_m1m/m1/service/VoyageService.java
M	QLDAPM/src/main/java/smartport_m1m/service/VoyageApiClient.java
M	QLDAPM/src/test/java/smartport_m1m/m1/controller/VoyageHttpIntegrationTest.java
A	UC016_ETA_PREDICTION.md
A	backend-nodejs/database/migrations/007_uc016_eta_prediction.sql
A	backend-nodejs/routes/voyageEtaPrediction.js
M	backend-nodejs/routes/voyageValidation.js
M	backend-nodejs/server.js
M	backend-nodejs/services/etaPredictionAdapter.js
A	backend-nodejs/services/voyageEtaPrediction.js
A	backend-nodejs/services/voyageQueue.js
M	backend-nodejs/services/voyageValidation.js
M	backend-nodejs/test/uc015-validation.test.js
A	backend-nodejs/test/uc016-eta-adapter.test.js
A	backend-nodejs/test/uc016-eta-prediction.test.js
```
