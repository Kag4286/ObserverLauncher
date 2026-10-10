# Quy trình kiểm thử MCP (v5.0.0)

Tài liệu này hướng dẫn một AI agent (hoặc người) **kết nối vào MCP của ObserverLauncher và kiểm thử
end-to-end**. Đây là bài test CHỈ ĐỌC/GỌI TOOL — agent **KHÔNG được sửa code ObserverLauncher**, chỉ
kết nối như một MCP client bình thường rồi gọi thử. Mỗi bước ghi rõ: gọi gì, kỳ vọng gì, PASS/FAIL ra sao.

> ⚠️ Nguyên tắc: KHÔNG sửa file nguồn OBS. Chỉ đọc `mcp-bridge.json` để lấy port + token, rồi gọi HTTP /
> nói JSON-RPC qua stdio. Mọi thao tác ghi (write/destroy) phải để nguyên cơ chế xác nhận của app —
> nếu bị hỏi confirm thì đó là ĐÚNG, không phải lỗi.

---

## 0. Điều kiện tiên quyết

1. ObserverLauncher đang chạy, và **Settings > MCP / AI > Enable** đang BẬT.
2. App ghi file `mcp-bridge.json` khi khởi động, tại:
   - Windows: `%APPDATA%\ObserverLauncher\mcp-bridge.json`
   - Linux: `~/.config/ObserverLauncher/mcp-bridge.json`
   - macOS: `~/Library/Application Support/ObserverLauncher/mcp-bridge.json`
   Đọc file: `{ port, token, pid, script, appVersion }`. Token bắt buộc cho mọi lời gọi.
3. User đã cấu hình ÍT NHẤT một thư mục server (để tool có cái mà đọc). Đa instance là điểm cộng, không bắt buộc.

Có HAI cách test. Làm CẢ HAI.

---

## A. Tầng HTTP trực tiếp (nhanh, không cần MCP client)

Mọi lời gọi là `GET http://127.0.0.1:<port>/...` kèm header `Authorization: Bearer <token>` (trừ khi
ghi chú khác). Dùng `curl` hoặc bất kỳ HTTP tool nào. `$T` = token, `$P` = port.

### A1. /health (KHÔNG cần token) — kiểm tra sống
- `GET /health`, không auth.
- PASS: HTTP 200, body `{ ok: true, uptime: <int>, version: "5.0.0" }`.
- PASS: KHÔNG lộ danh sách tool, KHÔNG lộ trạng thái server.

### A2. Auth được ép buộc
- `GET /tools` KHÔNG có header Authorization.
- PASS: HTTP 401, body `unauthorized`.
- `GET /tools` với `Authorization: Bearer SAI`.
- PASS: HTTP 401.

### A3. /tools — annotations + outputSchema (Gói A)
- `GET /tools` với token đúng.
- PASS: HTTP 200, `{ tools: [...] }`, độ dài **75**.
- Mỗi tool có `name`, `description`, `inputSchema`.
- **Annotations** (cốt lõi của v5.0.0):
  - `get_status` -> `annotations.readOnlyHint === true`, `destructiveHint === false`.
  - `stop_server` -> `annotations.readOnlyHint === false`, `destructiveHint === true`.
  - `install_from_market` -> `annotations.openWorldHint === true`.
  - `read_console` -> `annotations.openWorldHint === false`.
- **outputSchema**: `get_status` có `outputSchema.type === 'object'`; `list_files` KHÔNG có
  `outputSchema` (chỉ ~18 read tool giá trị cao mới có — xem mục E).

### A4. /resources — danh sách tĩnh (Gói C, một nguồn duy nhất)
- `GET /resources`.
- PASS: `{ resources: [...] }` có **8** mục, gồm `observer://server/status` và `observer://instances`.

### A5. /resource-templates (Gói C)
- `GET /resource-templates`.
- PASS: `{ resourceTemplates: [...] }` có **4** mục. Tập `uriTemplate` phải ĐÚNG:
  - `observer://instance/{id}/status`
  - `observer://instance/{id}/console`
  - `observer://instance/{id}/metrics`
  - `observer://file/{path}`

### A6. /resource — đọc một resource tĩnh
- `GET /resource?uri=observer://server/status` (URL-encode phần uri).
- PASS: `{ ok: true, data: {...} }` với data giống object status (có `status`).
- Phủ định: `GET /resource?uri=observer://nope/x` -> `{ ok: false, error: "Unknown resource: ..." }`.

### A7. /resource — template động resolve (Gói C)
- `GET /resource?uri=observer://file/server.properties`.
- PASS: `{ ok: true, data: {...} }` (nội dung file) HOẶC `{ ok: false, error }` gọn gàng nếu file
  không tồn tại — dù cách nào cũng KHÔNG crash và KHÔNG thoát khỏi thư mục.
- **Phủ định (bảo mật)**: `GET /resource?uri=observer://file/../../../../etc/passwd` (URL-encode).
- PASS: `{ ok: false, error: ... }` — tuyệt đối KHÔNG đọc được file. **Chữ lỗi có thể là `notAllowed`
  HOẶC `Path outside the server folder.`** tùy thứ tự kiểm tra: `read_file` chạy allowlist phần mở rộng
  (`extAllowed`) TRƯỚC khi kiểm tra traversal (`resolveSafe`), nên một path như `../../etc/passwd`
  thường bị chặn ở bước đuôi file và trả `notAllowed`. Cả hai message đều là PASS — mấu chốt là nội
  dung file KHÔNG bị trả về.

### A8. /prompts + /prompt (Gói B)
- `GET /prompts`.
- PASS: `{ prompts: [...] }` có **6** mục; tên ĐÚNG: `diagnose_server`, `optimize_for_ram`,
  `explain_last_crash`, `set_up_paper_for_players`, `audit_mods`, `safe_modpack_install`. Mỗi mục có
  `title`, `description`, `arguments`.
- `GET /prompt?name=diagnose_server` (không args).
- PASS: `{ ok: true, description, messages: [{ role: "user", content: { type: "text", text: "..." } }] }`;
  phần text có nhắc `doctor_report`.
- `GET /prompt?name=safe_modpack_install&args=<base64 của {"query":"better mc"}>`.
- PASS: text trả về chứa `better mc`.
- Phủ định: `GET /prompt?name=does_not_exist` -> HTTP 404, `{ ok: false, error: "Unknown prompt: ..." }`.

### A9. /rpc — gọi một read tool thật
- `POST /rpc` body `{ "tool": "get_status", "args": {} }`, kèm auth header.
- PASS: HTTP 200, `{ ok: true, result: {...} }`.
- `POST /rpc` body `{ "tool": "no_such_tool", "args": {} }`.
- PASS: `{ ok: false, error: "Unknown tool: no_such_tool" }`.

### A10. Bảo mật: request kiểu trình duyệt bị từ chối
- Gửi `GET /tools` kèm header `Origin: https://evil.example` (auth đúng).
- PASS: HTTP 403.
- Gửi `GET /tools` với `Host: evil.example` (auth đúng).
- PASS: HTTP 403 (Host guard từ chối hostname không phải loopback).

### A11. Rate limit (tuỳ chọn)
- Bắn >60 lời gọi `POST /rpc` cho CÙNG một tool trong một phút.
- PASS: sau ngưỡng, HTTP 429 `{ ok: false, error: "Rate limit exceeded ..." }`.

---

## B. Tầng stdio MCP (đúng thứ một client thật nhìn thấy)

Spawn bridge y hệt cách một client làm, rồi nói JSON-RPC 2.0, mỗi dòng một object JSON, qua stdin/stdout.
Cấu hình lấy từ `mcp-bridge.json` qua biến môi trường app đặt.

```bash
# Windows
ELECTRON_RUN_AS_NODE=1 "<đường dẫn ObserverLauncher.exe>" "<script trong mcp-bridge.json>"
# hoặc khi dev, dùng node thường:
OBSERVER_MCP_USERDATA="<thư mục userData>" node src/mcp/bridge.js
```

Mỗi request ghi một dòng, ví dụ `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}`.
Đọc một dòng response cho mỗi id.

### B1. initialize
- Request `initialize` với `params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify", version: "1" } }`.
- PASS: result có `serverInfo.name === "observerlauncher"`, `serverInfo.version` bằng version app
  (5.0.0), và `instructions` là chuỗi không rỗng.
- PASS: có `capabilities.tools`; `capabilities.resources.subscribe === true`;
  **có `capabilities.prompts`**; **KHÔNG có `capabilities.subscriptions`** (cái
  `subscriptions.listen` cũ khai man nhưng không handle phải đã BIẾN MẤT).
- PASS: `protocolVersion` trong result thuộc tập hỗ trợ
  (`2025-06-18` / `2025-03-26` / `2024-11-05`).
- Kiểm tra đàm phán: gửi `initialize` với `protocolVersion: "1999-01-01"`.
- PASS: `protocolVersion` trả về KHÔNG phải `1999-01-01` (nó lùi về bản hỗ trợ).

### B2. tools/list
- Request `tools/list`.
- PASS: **75** tool; `read_file` có `inputSchema.required` gồm `path`; `get_status` mang
  `annotations` và `outputSchema`.

### B3. tools/call (read)
- Request `tools/call` với `{ name: "get_status", arguments: {} }`.
- PASS: result có `content[0].type === "text"`, `isError === false`, và `structuredContent` là object
  status (đây là dạng máy đọc được của v5.0.0).
- Kiểm tra write vẫn phải xác nhận: thử `set_setting` với `{ key: "locale", value: "en" }` khi
  auto-allow đang TẮT. (Trong phiên GUI sẽ bật hộp thoại; ở auto-deny sẽ trả về từ chối. Cả hai đều
  PASS — mấu chốt là nó KHÔNG âm thầm ghi.)

### B4. resources/list + resources/templates/list (Gói C)
- `resources/list` -> **8** resource.
- `resources/templates/list` -> **4** template (cùng tập như A5).

### B5. resources/read + subscribe
- `resources/read` với `{ uri: "observer://server/status" }`.
- PASS: `contents[0].text` là chuỗi JSON; có `mimeType`.
- `resources/subscribe` với `{ uri: "observer://server/status" }` -> result `{}`.
  Sau đó đổi trạng thái server (start hoặc stop).
- PASS: trong ~5s bridge phát `notifications/resources/updated` với uri đó.
- `resources/unsubscribe` -> result `{}`.

### B6. prompts/list + prompts/get (Gói B)
- `prompts/list` -> **6** prompt (cùng tên như A8).
- `prompts/get` với `{ name: "diagnose_server", arguments: {} }`.
- PASS: result có `messages` (mảng) và `description`.
- `prompts/get` với `{ name: "nope" }`.
- PASS: lỗi JSON-RPC code `-32602`.

### B7. ping + method lạ
- `ping` -> result `{}`.
- `nonexistent/method` -> lỗi code `-32601`.

---

## C. Kiểm thử workflow end-to-end (giá trị thật)

Chạy các case này với server đang chạy (hoặc đã dừng, chỗ nào ghi rõ). Chỉ PASS khi AI hoàn thành
workflow MÀ KHÔNG cần người cầm tay chỉ việc.

### C1. Tự duyệt read (lợi ích của Gói A)
- Trong một client có tôn trọng `readOnlyHint`, kết nối và để nó gọi vài read tool
  (`get_status`, `read_console`, `list_players`, `diagnose_server`).
- PASS: client chạy chúng MÀ KHÔNG hỏi duyệt.
- Sau đó bảo nó đổi gì đó (`set_property`).
- PASS: client CÓ hỏi/xác nhận (không phải read-only).

### C2. Workflow chẩn đoán (prompt `diagnose_server`)
- Chọn prompt `diagnose_server`.
- PASS: AI gọi `doctor_report`, liệt kê từng check với mức (ok/warn/error), và với check không-ok thì
  nêu cách sửa. Nếu cách sửa là hành động ghi, nó phải hỏi trước.

### C3. Workflow crash (prompt `explain_last_crash`)
- Cần ít nhất một crash report trong `crash-reports/`. Nếu không có, bảo AI chạy `list_crash_reports`;
  kết quả rỗng là chấp nhận được và phải được xử lý gọn gàng.
- Nếu có report: PASS = nguyên nhân bằng ngôn ngữ dễ hiểu + bước tiếp theo cụ thể.

### C4. Template instance (Gói C, cần 2+ instance)
- Hỏi: "đọc console của instance <id-khác> mà KHÔNG chuyển sang nó".
- PASS: AI đọc `observer://instance/<id-khác>/console` (hoặc `get_instance_snapshot`), và instance
  đang active trên GUI KHÔNG đổi sau đó.

### C5. Modpack an toàn (prompt `safe_modpack_install`)
- Chọn nó với một query. KHÔNG xác nhận cài.
- PASS: AI tìm kiếm, gọi `plan_modpack`, TRÌNH BÀY plan, rồi DỪNG chờ xác nhận. Nó không được cài gì
  trước khi bạn đồng ý.

---

## D. Định dạng báo cáo

Xuất một bảng: Bước | PASS/FAIL | Quan sát được | Ghi chú. Ghi rõ version app lấy từ `initialize`. Với
mọi FAIL, chụp lại request gốc + response gốc. Nếu bridge không kết nối được app, nói thẳng (thiếu
config / app không chạy / MCP tắt) thay vì báo là tool lỗi.

---

## E. Kỳ vọng đúng sẵn (đừng báo nhầm là bug)

- `list_files` và hầu hết read tool KHÔNG có `outputSchema` — cố ý (chỉ ~18 tool giá trị cao mới có).
- `tools/list` offline (app không chạy) trả về danh sách dự phòng chỉ có name+description; sau đó
  `tools/call` sẽ báo lỗi đúng kiểu "ObserverLauncher is not running…".
- Headless không có GUI confirm: tool write/destroy bị TỪ CHỐI (không treo) — đó là chính sách
  `auto-deny`, không phải lỗi.
- `/health` không cần token nhưng chỉ lộ liveness + version.
- Việc agent bị hỏi xác nhận khi gọi tool ghi là ĐÚNG thiết kế — không phải bug.
- Chữ lỗi khi chặn path (A7 phủ định) có thể khác nhau (`notAllowed` vs `Path outside...`) do thứ tự
  kiểm tra — cả hai đều là chặn ĐÚNG.
- Số tool trong tài liệu NÀY là **75** (bản 5.0.0). Nếu bạn thấy "70", đó là `docs/v3.0.0-plan.md` cũ,
  không phải tài liệu kiểm thử này.
