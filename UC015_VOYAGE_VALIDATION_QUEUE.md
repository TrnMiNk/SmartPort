# UC-015 – Kiểm tra hồ sơ và hàng đợi cập bến

Trạng thái bàn giao: **hoàn thành luồng kiểm tra thủ công cho demo local; UC-015 chưa hoàn thành toàn bộ SRS**. Chưa chạy migration 006 hoặc kết nối SQL Server để kiểm thử nghiệp vụ trong phiên này. Chưa đo SLA 5 giây. Không tự chuyển voyage 1/2 sang QUEUED.

## Điểm xuất phát và phạm vi diff

- Repository: `TrnMiNk/SmartPort`.
- Nhánh làm việc: `feat/uc015-validation-queue`, xuất phát **`b97bb7d06166ed8d5e98e449b95e4467ae19df9e`** của `fix/uc014-tests-http`.
- Giữ nguyên bản sửa PR #1. Không sửa/push/merge `main`. Nhánh UC-015 được bàn giao qua draft PR với base `fix/uc014-tests-http`; việc chạy migration vẫn chờ người dùng review.
- Nếu mở PR khi #1 còn mở, chọn **base `fix/uc014-tests-http`**, head `feat/uc015-validation-queue`. Sau khi #1 merge, kiểm tra ancestry/diff trước khi đổi base sang main. Nếu #1 squash merge thì cần rebase/cherry-pick riêng phần UC-015 để tránh lặp diff UC-014.
- Xem diff riêng UC-015: `git diff b97bb7d HEAD` hoặc Files changed của draft PR. Không so sánh với main khi PR #1 còn chưa merge.

## Kết quả khảo sát source

| Thành phần | Thực tế ở base b97bb7d | Cách UC-015 xử lý |
|---|---|---|
| Migration 001/002 | `ships` có IMO, kích thước; `is_active`; `voyages` có status vòng đời | Kiểm tra checksum IMO giống UC-010/011 và trạng thái active; không sửa logic deactivate |
| Migration 003 / UC-012 | `ship_documents` gắn theo **ship**, có PENDING/APPROVED/REJECTED và thông tin reviewer; chưa có ngày hiệu lực | 006 thêm hai ngày nullable, không sửa trạng thái duyệt hay backfill |
| Migration 004 / UC-013 | Thông báo ANNOUNCED, ETA khai báo UTC, cargo/TEU, priority; history, idempotency | Đọc lại đầu vào dưới khóa trước khi ghi kết quả |
| Migration 005 / UC-014 | Danh mục ports/agents/partners, khóa API dạng hash, phân quyền tàu, idempotency theo partner | Giữ nguyên route và transaction tiếp nhận thông báo |
| Hạn chế tàu / danh mục hồ sơ | Chưa có nguồn hoặc bảng nghiệp vụ | Policy DEMO được reviewer cấu hình, có thời gian rà soát/hết hạn và hash; không giả định có blacklist thật |
| Queue / AI ETA / notification | Chưa có implementation | Queue lưu trực tiếp trên voyages; adapter AI mặc định UNAVAILABLE; chưa gửi notification |
| Authentication chung / RBAC | Chưa có | Hai route mới mặc định tắt, demo local, khóa operator riêng từ env |

`agent_id` và `origin_port_id` vẫn theo semantics UC-013: bắt buộc positive ID, không bổ sung quy định master-data mới khiến voyage UC-013 trước 005 bị loại chỉ vì chưa seed catalog. Không thêm loại giấy tờ mặc định cho mọi tàu.

## Tệp thêm/sửa

Thêm:

- `backend-nodejs/database/migrations/006_uc015_voyage_validation_queue.sql`
- `backend-nodejs/services/voyageValidationPolicy.js`: đọc/kiểm tra policy demo, điều kiện hồ sơ và hạn chế.
- `backend-nodejs/services/etaPredictionAdapter.js`: seam UC-016, timeout/fallback, không giả lập AI.
- `backend-nodejs/services/voyageValidation.js`: revalidation, transaction, history, queue và đọc queue.
- `backend-nodejs/routes/voyageValidation.js`: guard demo/key/local và hai API Node.
- `backend-nodejs/config/uc015-policy.example.json`: mẫu cố ý đã hết hạn, có placeholder, không tự kích hoạt.
- `backend-nodejs/test/uc015-validation.test.js`: nghiệp vụ, transaction có staging, concurrency có mutex mô phỏng applock, HTTP Node.
- `UC015_VOYAGE_VALIDATION_QUEUE.md`: tài liệu này.

Sửa:

- `backend-nodejs/server.js`: mount UC-015 **trước** UC-013 `/:id`, tránh `/queue` bị coi là ID.
- `QLDAPM/src/main/java/smartport_m1m/service/VoyageApiClient.java`: RestClient validate/queue, forward `X-UC015-Key`.
- `QLDAPM/src/main/java/smartport_m1m/m1/service/VoyageService.java`: validate ID/key, chuyển status/JSON UC-015, fallback error body không null.
- `QLDAPM/src/main/java/smartport_m1m/m1/controller/VoyageController.java`: hai route Spring, giới hạn loopback.
- `QLDAPM/src/test/java/smartport_m1m/m1/controller/VoyageHttpIntegrationTest.java`: chạy Spring thật với HTTP upstream stub, thêm UC-015.

Không sửa migration 001–005, db.js, route tiếp nhận UC-013/014, route UC-012 hoặc handler UC-014. Không thêm dependency.

## Migration 006 – chỉ review, chưa thực thi

File dùng `USE [CangThongMinh]`, transaction `TRY/CATCH`, `XACT_ABORT ON`, kiểm tra bảng/cột trước khi thêm. Không có seed, DELETE hoặc UPDATE dữ liệu demo. Tất cả trường mới nullable để voyage cũ và tài liệu hiện có được giữ nguyên. Sau migration, voyage ID 1 và 2 vẫn có trạng thái cũ và metadata UC-015 NULL.

Thêm trên `ship_documents`: `valid_from`, `valid_until` (`DATETIME2(3)`, UTC). CHECK cho phép cả hai NULL để giữ tương thích, hoặc đủ hai ngày với `valid_until > valid_from`. NULL không có nghĩa là vô thời hạn.

Thêm trên `voyages`:

| Cột | Ý nghĩa |
|---|---|
| `validation_result` | NULL / VALID / MISSING_DOCUMENTS / REJECTED, tách biệt status |
| `validation_reason`, `validated_at` | Lý do và thời điểm lần kiểm tra đã hoàn tất gần nhất |
| `validation_policy_hash` | SHA-256 của policy đã dùng, lưu bản policy tương ứng ngoài repo để audit |
| `ai_status`, `predicted_eta` | UNAVAILABLE + NULL hoặc AVAILABLE + ETA thực sự từ provider |
| `eta_input_hash` | Hash đầu vào adapter, dùng lại prediction khi recheck đầu vào không đổi |
| `queue_position`, `queued_at` | Vị trí hiện tại (BIGINT) và lúc vào queue; recheck hợp lệ giữ queued_at |

CHECK ràng buộc kết quả/lý do/thời điểm, cặp AI/ETA và điều kiện khi có queue_position. Filtered UNIQUE index trên queue_position ngăn vị trí trùng. Index hỗ trợ đọc queue và tìm hồ sơ theo ship/type/status. Không tạo bảng queue vì mỗi voyage chỉ có một membership; bảng riêng sẽ nhân đôi trạng thái. Vị trí thuộc chính row PK của voyage nên không thể có hai row queue cho cùng voyage.

Các CHECK/index tham chiếu cột vừa thêm đều chạy bằng **`sp_executesql`**, tránh lỗi SQL Server compile cột chưa tồn tại trong cùng batch như bài học migration 004. Nếu DB có cùng tên cột nhưng schema khác, cần so sánh schema trước khi chạy; script không tự sửa kiểu cột hoặc dữ liệu không tương thích.

CHECK cho phép tạm thời queue_position NULL trong transaction để đổi thứ tự mà không đụng UNIQUE index. Tính đầy đủ của queue_position sau commit do service bảo đảm. Các writer trực tiếp khác/UC-020 trong tương lai bắt buộc dùng cùng giao thức khóa và cập nhật nguyên tử, không ghi status/position riêng lẻ.

## Policy hồ sơ demo và hạn chế tàu

Đặt `UC015_POLICY_FILE` trỏ tới file JSON bên ngoài repo. Cấu trúc:

```json
{
  "mode": "DEMO",
  "policyId": "ten-ban-policy-da-review",
  "reviewedAt": "2026-11-07T00:00:00Z",
  "validUntil": "2026-11-08T00:00:00Z",
  "requiredDocumentTypesByShipType": {
    "LOAI_TAU_CHINH_XAC_TRONG_DB": ["LOAI_HO_SO_DA_DUOC_REVIEW"]
  },
  "restrictedImos": [
    {"imo": "9074729", "reason": "Vi du cau truc, khong phai danh sach cam that"}
  ]
}
```

Đây chỉ là ví dụ cấu trúc, **không sao chép các loại/danh sách/ngày này thành quy định thực tế**. Thay bằng chính sách và nguồn hạn chế demo đã được người phụ trách xác nhận. `restrictedImos: []` là lựa chọn demo minh bạch rằng danh sách đã review không có entry, không chứng minh không có hạn chế trong thực tế. Không có nguồn hạn chế production ở đây.

- Policy phải mode DEMO, có thời điểm review không ở tương lai, còn hạn; thiếu file, JSON sai hoặc hết hạn trả **503**, không ghi thành kết quả thiếu hồ sơ.
- Ship type và document type đối chiếu đúng chuỗi, phân biệt hoa thường, không wildcard/default. Mỗi ship type cấu hình phải có danh sách không rỗng, không trùng loại. Ship type chưa cấu hình trả 422 MISSING_DOCUMENTS với lý do riêng.
- Mỗi loại bắt buộc phải có ít nhất một tài liệu của **chính ship đó**, `APPROVED`, đủ cả hai ngày hợp lệ, `valid_from <= thời điểm kiểm tra`, `valid_until >= max(thời điểm kiểm tra, effective ETA)`. Khoảng hiệu lực được hiểu gồm hai đầu.
- Không tự approve/review hay sửa bất kỳ tài liệu nào. PENDING/REJECTED không thỏa mãn. Nếu có một bản APPROVED còn hiệu lực thì bản PENDING khác cùng loại không tự vô hiệu bản đã được duyệt; cơ chế supersession/revocation ngoài review hiện chưa có.
- Giấy tờ hết hạn trước ETA dự báo cũng bị loại. Thiếu ngày hết hạn luôn không đạt.
- Tái sử dụng `ship_documents` UC-012, không thêm liên kết theo voyage. Tài liệu riêng từng chuyến nếu SRS cần sẽ là phần mở rộng sau này.
- **Chưa bổ sung API/UI quản lý ngày hiệu lực.** Sau khi người dùng duyệt migration, reviewer có thể nhập hai ngày đã xác minh bằng quy trình quản trị trên DB demo sao chép. Upload/review UC-012 hiện tại vẫn giữ contract cũ; tài liệu mới upload không có ngày sẽ không tự đạt UC-015. Không gán ngày theo now + N ngày, không đổi PENDING/REJECTED chỉ để ép case PASS.
- Policy nạp một lần khi Node khởi động. Muốn đổi policy/danh sách hạn chế phải lưu file đã review rồi restart Node; lưu bản JSON ứng với hash để đối chiếu về sau.

Kiểm tra dữ liệu còn gồm mã/tên/loại tàu, kích thước dương, mã chuyến, ID đại lý/cảng, cargo, TEU không âm, priority không âm, ETA khai báo hợp lệ, IMO 7 số và checksum, tàu active. Sai dữ liệu/tàu inactive/IMO sai/hạn chế lưu REJECTED, không đưa REJECTED vào status vòng đời.

## API contract và bảo vệ

| Method | Spring Boot (8080) | Node (5000) |
|---|---|---|
| POST, không cần body | `/api/v1/voyages/{id}/validate` | `/api/voyages/:id/validate` |
| GET, chỉ đọc | `/api/v1/voyages/queue` | `/api/voyages/queue` |

Cả hai yêu cầu `X-UC015-Key`, tách biệt hoàn toàn `X-API-Key` của đối tác UC-014. Không nhận actor/role/priority/ETA từ body validate.

Node chỉ cho phép khi `UC015_DEMO_ENABLED=true`, `NODE_ENV` khác production, token operator từ env dài 32–512 ký tự, socket thật là loopback. So sánh digest token bằng `timingSafeEqual`, không log khóa. Spring kiểm tra key có mặt, socket loopback rồi forward header bằng RestClient; Node là nơi kiểm chứng secret. Không tin `X-Forwarded-For`. Reverse proxy local không biến workflow này thành production-ready; không công khai hai dịch vụ hoặc các route demo cũ.

Response POST 200 (ví dụ schema; không phải kết quả đã kiểm tra voyage 1/2):

```json
{
  "voyageId": 1,
  "validationResult": "VALID",
  "validationReason": null,
  "status": "QUEUED",
  "queuePosition": 1,
  "predictedEta": null,
  "aiStatus": "UNAVAILABLE",
  "validatedAt": "2026-11-07T05:00:00.000Z",
  "queuedAt": "2026-11-07T05:00:00.000Z",
  "declaredEta": "2026-11-12T03:00:00.000Z",
  "effectiveEta": "2026-11-12T03:00:00.000Z",
  "priorityLevel": null,
  "validationPolicyHash": "sha256-cua-policy"
}
```

GET queue: `{"success":true,"data":[...cùng schema row...]}` theo queuePosition. Không gọi AI, không revalidate, không sửa thứ tự. Nó đọc kết quả kiểm tra đã lưu tại một thời điểm; không phải chứng nhận rằng hồ sơ chưa đổi kể từ đó.

| HTTP | Ý nghĩa và tác động |
|---|---|
| 200 | VALID, transaction đã commit result/history/queue; recheck hợp lệ cũng 200 |
| 400 | ID sai định dạng/ngoài INT, không ghi DB |
| 401 | Thiếu/sai operator key, không ghi DB |
| 403 | UC-015 tắt, production hoặc request không local; không ghi DB |
| 404 | Voyage không tồn tại, không ghi DB |
| 422 + validationResult | Thiếu hồ sơ/REJECTED: **đã commit** reason/time; status ANNOUNCED, không có queuePosition |
| 422 + `INVALID_VOYAGE_STATUS` | Ngoài ANNOUNCED/VALIDATED/QUEUED: không bắt đầu kiểm tra hồ sơ, giữ nguyên status và kết quả cũ; không sửa COMPLETED/CANCELLED |
| 503 | Policy/key chưa cấu hình/hết hạn hoặc queue lock chưa lấy được; lỗi khả dụng, không đánh dấu MISSING_DOCUMENTS |
| 500 tại Node | Lỗi DB/hệ thống, rollback mọi thay đổi của transaction |
| 502 tại Spring | Node lỗi 500, kết nối hỏng hoặc JSON thành công không parse được/null; giữ nội dung lỗi nội bộ ở upstream |

Spring dùng handler `VoyageExceptionHandler` của UC-014 để giữ HTTP/JSON cho 400/401/403/404/409/422/503 của UC-015. Không kết nối SQL từ Spring. Semantics error UC-013/014 hiện tại vẫn được kiểm thử hồi quy.

## Transaction, retry và thứ tự queue

1. Đọc đầu vào/hồ sơ sơ bộ, chỉ gọi adapter nếu hồ sơ sơ bộ đạt. Không mở SQL transaction trong lúc chờ adapter/network.
2. Adapter mặc định không có provider: predictedEta NULL, aiStatus UNAVAILABLE. Lỗi, timeout 1500 ms hoặc output không hợp lệ cũng fallback. ETA khai báo chỉ là effectiveEta, **không gán sang predictedEta**.
3. Mở SERIALIZABLE; lấy `sys.sp_getapplock` Exclusive, resource `SmartPort:UC015:queue`, owner Transaction, timeout 10000 ms **trước khi lấy row locks**. Đọc lại ship/voyage/documents với UPDLOCK/HOLDLOCK. Nếu đầu vào ETA thay đổi, bỏ prediction cũ.
4. Kiểm tra lại tất cả điều kiện bằng thời điểm hiện tại và ETA được chọn. Ghi result/reason/time/hash; nếu VALID thì cuối transaction là QUEUED và history ANNOUNCED → VALIDATED → QUEUED. VALIDATED có thể tiếp tục QUEUED. Không thêm history khi đã QUEUED hợp lệ.
5. Clear các queuePosition trong transaction rồi xếp lại: **effective ETA tăng dần, priority cao trước khi ETA bằng nhau (NULL = 0), queued_at, id**. Priority không cho tàu ETA muộn vượt mọi ETA sớm. Thay đổi policy thứ tự là quyết định nghiệp vụ sau này.
6. Đọc response rồi commit. Lỗi ghi history/reorder/response khiến result, status, history, vị trí của cả những voyage khác đều rollback.

Queue reader lấy Shared applock cùng resource trong transaction để không quan sát quá trình clear/reorder. Applock thuộc SQL Server nên phối hợp được nhiều Node process. UNIQUE index là lớp bảo vệ DB bổ sung. App lock có thể cần quyền EXECUTE theo cấu hình SQL Server; thiếu quyền là lỗi hệ thống, không bỏ khóa để chạy tiếp.

Recheck đầu vào ETA không đổi dùng lại AI result và queued_at, không thêm membership/history. Nếu hồ sơ không còn đạt, đưa voyage QUEUED/VALIDATED về ANNOUNCED, gỡ queue và ghi một history ANNOUNCED. Lần kiểm tra lỗi kế tiếp khi vẫn ANNOUNCED chỉ cập nhật kết quả kiểm tra, không thêm history. `validation_result` vẫn giữ MISSING_DOCUMENTS/REJECTED riêng biệt.

Các route legacy UC-010/011/012 không cùng applock nhưng các row/range locks bảo vệ snapshot trong lúc ghi. Sau commit, người dùng vẫn có thể sửa hồ sơ/tàu; hiện chưa có cơ chế liên tục tự loại voyage khỏi queue. Recheck thủ công mới phản ánh các thay đổi đó. Deadlock/DB failure không tự đổi thành thiếu hồ sơ; client có thể retry. Không cam kết latency 5 giây: riêng queue lock timeout đã có thể dài hơn.

## UC-013/014 và những phần chưa đáp ứng SRS

Tiếp nhận thông báo vẫn trả ANNOUNCED với 201/replay 200 như trước. **Chưa tự kích hoạt UC-015**. Không thêm lời gọi fire-and-forget sau commit vì có thể mất công việc khi restart, không giữ transaction tiếp nhận trong lúc AI chạy, không thay đổi response/idempotency UC-014 thành kết quả giả sau queue.

Để tự động hóa bền vững cần outbox ghi cùng transaction tiếp nhận, worker có lease/retry/giám sát và gọi validation nội bộ; replay không tạo thêm job. Chưa có hạ tầng hoặc cấu hình vận hành đó trong source, nên bàn giao endpoint chạy tay theo lựa chọn fallback cho demo trong yêu cầu.

Chưa có notification infrastructure: chưa tạo hoặc gửi thông báo cho Điều phối viên. Chưa triển khai UC-016 AI, dữ liệu hạn chế chính thức, danh mục giấy tờ chính thức, RBAC/identity/audit đầy đủ, API quản lý hiệu lực giấy tờ, giám sát revalidation khi giấy tờ thay đổi/hết hạn hoặc UC-020 chỉnh thứ tự. Hash policy và actor `uc015-local-demo` không thay thế audit người dùng thật. Không đánh dấu toàn bộ UC-015 PASS.

## Windows – review trước, chạy trên bản sao sau

### 1. Đồng bộ code và chạy test, không cần DB/migration

Lưu thay đổi đang làm trước khi chuyển branch; không checkout/reset đè work chưa lưu. Lấy nhánh triển khai, kiểm tra base rồi chạy các test không cần SQL Server:

```powershell
git fetch origin fix/uc014-tests-http feat/uc015-validation-queue
git switch --track -c feat/uc015-validation-queue origin/feat/uc015-validation-queue
git merge-base --is-ancestor b97bb7d HEAD
if ($LASTEXITCODE -ne 0) { throw 'Branch khong chua base UC-014 da xac minh' }
git diff --stat b97bb7d HEAD

Set-Location backend-nodejs
npm ci
npm test
Get-ChildItem -Recurse -Filter *.js | Where-Object { $_.FullName -notmatch '\\node_modules\\' } | ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "node --check failed: $($_.FullName)" }
}
Set-Location ..\QLDAPM
$env:JAVA_HOME = 'C:\duong-dan-den-jdk-25'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
java -version
.\gradlew.bat clean test
Set-Location ..
git diff --check
```

Nếu branch đã có local, dùng branch hiện có phù hợp thay vì lặp `switch -c`, kiểm tra worktree trước khi cập nhật. Files changed của PR chỉ có UC-015; base branch được nêu ở đầu tài liệu. Nếu tải patch từ PR để áp dụng riêng, dùng `git apply --check` trên base b97bb7d trước khi apply.

### 2. Bảo toàn voyage 1/2

POST validate **có ghi dữ liệu kể cả khi trả 422**, không dùng như dry-run trên DB gốc. Không thể gửi POST đó vào DB gốc rồi khẳng định hai voyage không đổi.

Trước mọi smoke test ghi dữ liệu, backup/restore database trên **một SQL Server instance demo biệt lập**, giữ tên database `CangThongMinh` trên instance sao chép vì db.js và migration dùng tên này. Xác minh `@@SERVERNAME`, `DB_NAME()` và DB_SERVER của Node. Giữ instance gốc nguyên trạng, dừng Node cũ để tránh nhầm port. Bản sao phải có đúng ID 1/2 và các history/idempotency hiện tại.

Chỉ sau khi người dùng review SQL, tự quyết định chạy 006 trong SSMS **trên instance sao chép**. Agent chưa chạy bất kỳ migration nào. Kiểm tra lại số rows và status 1/2 ngay sau migration: phải giữ nguyên; metadata mới NULL. Có thể chạy lại script trên bản sao để kiểm tra tính rerunnable. Không chạy 001–005 lại vì chúng đã được áp dụng.

Trên bản sao, đọc loại tàu/hồ sơ thực tế, tạo policy demo được reviewer xác nhận. Với case VALID, nhập hai ngày đã kiểm chứng cho những tài liệu APPROVED đủ loại bằng quy trình quản trị demo. Nếu hồ sơ thực tế không đủ, kết quả 422 là đúng; không sửa dữ liệu gốc, không tự approve để ép PASS. Dùng fixture mới trên bản sao cho các case PENDING/REJECTED/expired/inactive/restricted; ghi nhận rõ đó là fixture, không kết luận voyage thật hợp lệ.

### 3. Khởi động demo local

Trong PowerShell tại repository, cấu hình trước khi start Node. File policy và document storage để ngoài repo. Thay mọi placeholder; không commit khóa hoặc policy vận hành.

```powershell
$env:DB_SERVER = '<SQL_SERVER_INSTANCE_SAO_CHEP_DA_XAC_MINH>'
$env:HOST = '127.0.0.1'
$env:NODE_ENV = 'development'
$env:UC015_DEMO_ENABLED = 'true'
$randomBytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($randomBytes)
$rng.Dispose()
$env:UC015_OPERATOR_TOKEN = [Convert]::ToBase64String($randomBytes)
$env:UC015_POLICY_FILE = 'C:\SmartPortDemo\uc015-policy.json'
$env:DOCUMENT_STORAGE_DIR = 'C:\SmartPortDemo\documents'
# Chuẩn bị và review file policy trước; mẫu trong repo cố ý hết hạn.
Start-Process node -ArgumentList 'server.js' -WorkingDirectory "$PWD\backend-nodejs"
```

Mở terminal thứ hai để chạy Spring bằng JDK25:

```powershell
Set-Location QLDAPM
.\gradlew.bat bootRun --args="--server.address=127.0.0.1 --smartport.node-api.base-url=http://127.0.0.1:5000"
```

Ở terminal PowerShell tạo token, gọi API (không in token ra màn hình):

```powershell
$headers = @{ 'X-UC015-Key' = $env:UC015_OPERATOR_TOKEN }
# CHỈ khi Node đang trỏ tới instance SAO CHÉP đã xác minh.
curl.exe -i -X POST -H "X-UC015-Key: $($env:UC015_OPERATOR_TOKEN)" http://127.0.0.1:8080/api/v1/voyages/1/validate
curl.exe -i -X POST -H "X-UC015-Key: $($env:UC015_OPERATOR_TOKEN)" http://127.0.0.1:8080/api/v1/voyages/2/validate
Invoke-RestMethod -Headers $headers http://127.0.0.1:8080/api/v1/voyages/queue | ConvertTo-Json -Depth 8
# Kiểm tra khóa sai: 401; bỏ cờ UC015_DEMO_ENABLED rồi restart Node: 403.
```

Cần so sánh HTTP Node trực tiếp: thay port 8080 thành 5000 và `/api/v1` thành `/api`. Kết quả nghiệp vụ phải cùng JSON/status. Chạy lại POST với đầu vào không đổi: nếu hợp lệ, không thêm hai history mới, queued_at và thứ tự tương đối không đổi. Voyage chưa đạt phải giữ ANNOUNCED và queuePosition NULL.

### 4. Kiểm tra cạnh tranh/rollback thực tế cần thực hiện sau review

Trên instance sao chép, chuẩn bị hai voyage fixture đủ hồ sơ, ETA bằng nhau và priority khác nhau; gửi hai POST từ hai terminal/PowerShell job cùng lúc. Lặp nhiều POST cho cùng voyage. Đối chiếu query phía dưới: không vị trí trùng, mỗi voyage một row, một cặp history VALIDATED/QUEUED khi không có chuyển trạng thái mới. Thử thêm voyage ETA sớm hơn và xác nhận policy ETA-first.

Để kiểm chứng rollback SQL Server thật, chỉ trên bản sao dùng cơ chế fault injection được reviewer quản lý (ví dụ quyền ghi history bị từ chối cho tài khoản thử nghiệm riêng), xác minh lỗi 500 Node/502 Spring và mọi row/history/queue giữ nguyên. Không sửa quyền, thêm trigger gây lỗi hoặc xóa dữ liệu trên DB gốc. Test mock đã bao phủ việc ném lỗi ở save/history/reorder/response, nhưng chưa chứng minh engine SQL/ODBC/permission hoạt động giống mô phỏng.

## SSMS – các truy vấn chỉ đọc

Trước 006, trên DB gốc hoặc bản sao để lưu baseline:

```sql
SELECT @@SERVERNAME AS instance_name, DB_NAME() AS database_name;
SELECT id, ship_id, voyage_code, status, declared_eta, priority_level
FROM dbo.voyages WHERE id IN (1,2) ORDER BY id;
SELECT voyage_id, status, changed_at, changed_by
FROM dbo.voyage_status_history WHERE voyage_id IN (1,2) ORDER BY id;
SELECT * FROM dbo.voyage_idempotency WHERE voyage_id IN (1,2);
SELECT * FROM dbo.partner_voyage_idempotency WHERE voyage_id IN (1,2);
SELECT d.id, d.ship_id, s.ship_type, d.document_type, d.review_status,
       d.reviewed_at, d.reviewed_by
FROM dbo.ship_documents d JOIN dbo.ships s ON s.id=d.ship_id
WHERE d.ship_id IN (SELECT ship_id FROM dbo.voyages WHERE id IN (1,2));
```

Sau 006, chỉ chạy các query có cột mới khi đã xác minh migration thành công:

```sql
SELECT id, ship_id, status, validation_result, validation_reason, validated_at,
       ai_status, predicted_eta, declared_eta, queue_position, queued_at,
       validation_policy_hash, eta_input_hash
FROM dbo.voyages WHERE id IN (1,2) ORDER BY id;

SELECT id, ship_id, document_type, review_status, valid_from, valid_until
FROM dbo.ship_documents
WHERE ship_id IN (SELECT ship_id FROM dbo.voyages WHERE id IN (1,2));

SELECT id, status, validation_result, queue_position, priority_level,
       COALESCE(predicted_eta,declared_eta) AS effective_eta, queued_at
FROM dbo.voyages WHERE queue_position IS NOT NULL ORDER BY queue_position;

-- Kỳ vọng không có row:
SELECT queue_position, COUNT(*) AS duplicate_count
FROM dbo.voyages WHERE queue_position IS NOT NULL
GROUP BY queue_position HAVING COUNT(*) > 1;

-- Kỳ vọng không có row sau transaction service commit:
SELECT id, status, validation_result, queue_position FROM dbo.voyages
WHERE (status='QUEUED' AND (queue_position IS NULL OR validation_result IS NULL OR validation_result<>'VALID'))
   OR (queue_position IS NOT NULL AND (status<>'QUEUED' OR validation_result IS NULL OR validation_result<>'VALID'));

SELECT voyage_id, status, COUNT(*) AS transitions
FROM dbo.voyage_status_history WHERE voyage_id IN (1,2)
GROUP BY voyage_id,status ORDER BY voyage_id,status;

SELECT name, definition, is_disabled, is_not_trusted
FROM sys.check_constraints
WHERE parent_object_id IN (OBJECT_ID('dbo.voyages'),OBJECT_ID('dbo.ship_documents'));
SELECT name, is_unique, filter_definition FROM sys.indexes
WHERE object_id=OBJECT_ID('dbo.voyages');
```

Không dùng NOLOCK để kiểm tra tính nhất quán giữa các bước clear/reorder.

## Kết quả kiểm thử trong phiên cloud

Các bộ test dùng SQL doubles có staging/commit/rollback; kiểm thử cạnh tranh có mutex mô phỏng sp_getapplock. HTTP Spring chạy app thật, upstream là HTTP stub, không phải SQL Server hoặc Node thật. Không kết luận các case này xác nhận SQL Server engine, migration, driver ODBC hoặc SLA.

| Check | Kết quả |
|---|---|
| `npm test` | 83/83 PASS, 0 fail/skip |
| `node --check` toàn bộ source/test JS ngoài node_modules | 16/16 tệp PASS |
| JDK 25 + Gradle `clean test` | 67/67 PASS, 0 fail/error/skip; JDK 25.0.5.0.3 |
| `git diff --check` | PASS |
| SQL Server / chạy 006 / voyage 1/2 thực tế | Chưa chạy, chờ review và smoke test trên bản sao |

Bao phủ: VALID, thiếu tài liệu, PENDING/REJECTED, expiry/missing dates/future validity, IMO, active, hạn chế, policy chưa cấu hình/hết hạn, ID/status, fallback AI lỗi/timeout/JSON sai, ETA dự báo và thời hạn tài liệu, ETA/priority/tie-break, revalidation ổn định, gỡ queue khi kiểm tra không đạt, rollback (cả queue khác), validation đồng thời, dữ liệu đổi trong lúc chờ adapter, bảo vệ key/local/demo, Spring chuyển status/JSON và hồi quy các test UC-010 đến UC-014 hiện có. Không tắt/skip test cũ.
