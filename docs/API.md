# Arcamage API 文档

> 默认前缀：`/api`  
> 在线文档：`/docs`（Swagger） / `/redoc`

---

## 1. 通用约定

### 1.1 Base URL

- 本地开发：`http://localhost:8000`

### 1.2 响应形态

#### A) 标准包装（多数 JSON 接口）

```json
{
  "success": true,
  "data": {},
  "error": null,
  "error_code": null
}
```

#### B) 二进制响应

- `POST /api/cards/inject` 返回 `image/png`

#### C) 非标准包装接口

- `GET /api/health`、`GET /api/version`、`GET /api` 返回普通 JSON
- `POST /api/import/remote` 返回 `RemoteImportResponse`（非 `ApiResponse`）
- `GET /api/import/remote/pending*` 返回普通 JSON
- `POST /api/proxy/chat`：
  - `stream=true` 时返回 SSE
  - `stream=false` 时返回上游 JSON（或上游错误 JSON）

### 1.3 上传字段名

所有 multipart 上传统一使用 `file` 字段。

---

## 2. 基础接口

### `GET /api/health`

健康检查。

```json
{
  "status": "healthy"
}
```

### `GET /api/version`

返回应用名与版本号。

```json
{
  "name": "Arcamage",
  "version": "0.1.0"
}
```

### `GET /api`

API 根信息。

```json
{
  "name": "Arcamage",
  "version": "0.1.0",
  "docs": "/docs"
}
```

---

## 3. 卡片接口（`/api/cards/*`）

### `POST /api/cards/parse`

上传文件并解析为 CCv3。

- Content-Type: `multipart/form-data`
- 字段：`file`
- 支持：
  - PNG（优先读取 `ccv3`，其次 `chara`）
  - JSON（V2/V3）
  - 其他图片（JPG/WebP/GIF/BMP 等）会先转 PNG 再尝试解析

成功响应：`ApiResponse[ParseResult]`

```json
{
  "success": true,
  "data": {
    "card": {
      "spec": "chara_card_v3",
      "spec_version": "3.0",
      "data": { "name": "Example" }
    },
    "source_format": "v3",
    "has_image": true,
    "warnings": []
  },
  "error": null,
  "error_code": null
}
```

### `POST /api/cards/inject`

将 CCv3 JSON 注入 PNG 并返回图片。

- Content-Type: `multipart/form-data`
- 字段：
  - `file`: PNG 文件
  - `card_v3_json`: CCv3 JSON 字符串
  - `include_v2_compat`: 可选，默认 `true`
  - `verify`: 可选，默认 `true`

成功响应：

- HTTP 200
- `Content-Type: image/png`
- `Content-Disposition` 附带导出文件名

### `POST /api/cards/validate`

校验 CCv3 结构（不处理图片）。

- Content-Type: `application/json`
- Body: `CharacterCardV3`

成功响应：`ApiResponse[ValidateResult]`

```json
{
  "success": true,
  "data": {
    "valid": true,
    "errors": [],
    "warnings": []
  }
}
```

---

## 4. 世界书接口（`/api/lorebook/*`）

### `POST /api/lorebook/export`

从卡片中提取世界书。

请求：

```json
{
  "card": { "spec": "chara_card_v3", "spec_version": "3.0", "data": {} }
}
```

响应：`ApiResponse[LorebookExportResult]`

```json
{
  "success": true,
  "data": {
    "lorebook": { "name": "World Book", "entries": [] },
    "entry_count": 0
  }
}
```

### `POST /api/lorebook/import`

将世界书导入到卡片。

请求：

```json
{
  "card": { "spec": "chara_card_v3", "spec_version": "3.0", "data": {} },
  "lorebook": { "name": "World Book", "entries": [] },
  "merge_mode": "replace"
}
```

`merge_mode`：

- `replace`：覆盖现有世界书
- `merge`：按条目 ID 追加，不重复添加已有 ID
- `skip`：若已有世界书则保持不变

---

## 5. Arcaferry 远程导入（`/api/import/*`）

### `POST /api/import/remote`

接收 Arcaferry 发送的卡片数据，并放入临时待取队列。

支持两种请求方式：

1. `multipart/form-data` + `file`（PNG）
2. `application/json` + CCv3 JSON

可选请求头：

- `X-Arcaferry-Version`
- `Authorization`

响应：`RemoteImportResponse`

```json
{
  "success": true,
  "card_id": "a1b2c3d4",
  "message": "Card 'Alice' imported successfully",
  "error_code": null
}
```

> 注意：版本不兼容时通常仍返回 HTTP 200，但 `success=false` 且 `error_code=VERSION_MISMATCH`。

### `GET /api/import/remote/pending`

查看当前待取队列。

```json
{
  "count": 1,
  "cards": [
    { "id": "a1b2c3d4", "name": "Alice" }
  ]
}
```

### `GET /api/import/remote/pending/{card_id}`

读取并移除指定待取卡片。

```json
{
  "success": true,
  "card": {
    "spec": "chara_card_v3",
    "spec_version": "3.0",
    "data": { "name": "Alice" }
  }
}
```

---

## 6. 供应商接口（`/api/suppliers/*`）

用于 OpenAI 兼容服务连通性检查和模型列表拉取。

### `POST /api/suppliers/test-connection`

请求示例：

```json
{
  "base_url": "https://api.example.com",
  "api_key": "sk-...",
  "model": "gpt-4o-mini",
  "use_proxy": true
}
```

响应：`ApiResponse[SupplierConnectionResult]`，其中 `data.models` 为模型列表。

### `POST /api/suppliers/models`

请求示例：

```json
{
  "base_url": "https://api.example.com",
  "api_key": "sk-...",
  "use_proxy": true
}
```

响应：`ApiResponse[SupplierModelsResult]`

```json
{
  "success": true,
  "data": {
    "models": [
      { "id": "gpt-4o-mini" },
      { "id": "gpt-4.1" }
    ]
  }
}
```

---

## 7. Chat 代理接口（`/api/proxy/chat`）

### `POST /api/proxy/chat`

代理 OpenAI 兼容的 `/v1/chat/completions`。

请求示例：

```json
{
  "base_url": "https://api.example.com",
  "api_key": "sk-...",
  "model": "gpt-4o-mini",
  "messages": [
    { "role": "user", "content": "hello" }
  ],
  "stream": true,
  "temperature": 0.8,
  "tools": [],
  "tool_choice": "auto"
}
```

响应行为：

- `stream=true`：`text/event-stream`
- `stream=false`：普通 JSON（透传上游响应）

---

## 8. 错误码参考

| 错误码 | 含义 |
|--------|------|
| `VALIDATION_ERROR` | 参数或结构验证失败 |
| `PARSE_ERROR` | 文件/数据解析失败 |
| `FILE_TOO_LARGE` | 上传超过大小限制 |
| `INVALID_FORMAT` | 文件格式不支持或不符合要求 |
| `NETWORK_ERROR` | 上游网络请求失败 |
| `TIMEOUT` | 请求超时 |
| `UNAUTHORIZED` | 认证失败 |
| `RATE_LIMITED` | 被限流 |
| `UPSTREAM_ERROR` | 上游返回其它错误状态（主要见 `/api/proxy/chat`） |
| `INTERNAL_ERROR` | 服务器内部错误 |

---

## 9. 快速调试示例

### 9.1 解析卡片

```bash
curl -X POST "http://localhost:8000/api/cards/parse" \
  -F "file=@./example.png"
```

### 9.2 校验卡片

```bash
curl -X POST "http://localhost:8000/api/cards/validate" \
  -H "Content-Type: application/json" \
  -d '{"spec":"chara_card_v3","spec_version":"3.0","data":{"name":"Alice"}}'
```

### 9.3 导出世界书

```bash
curl -X POST "http://localhost:8000/api/lorebook/export" \
  -H "Content-Type: application/json" \
  -d '{"card":{"spec":"chara_card_v3","spec_version":"3.0","data":{"name":"Alice"}}}'
```
