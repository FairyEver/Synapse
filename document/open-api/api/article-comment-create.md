# 给分享文章留言

给当前 Synapse `/share/...` 链接指向的 Markdown 文件添加一条文末留言。留言以 API 密钥所属账号的身份发布，显示在文章正文之后，不附着到正文选区。

创建 API 密钥时选择「给分享文章留言」（`drive.public_link.comment.create`）。此权限不包含文件下载或留言编辑、删除。路径、权限和 operation ID 中的 `comment` 是已发布的兼容标识，实际创建的是文末留言。

```http
POST /api/open/v1/drive/public-links/comments
Authorization: Bearer syn_sk_...
Content-Type: application/json
```

```json
{
  "url": "{{APP_PUBLIC_URL}}/share/shr_example",
  "body": "这篇文章的结论很有帮助。"
}
```

| 请求头 | 必填 | 说明 |
|---|---|---|
| `Authorization` | 是 | `Bearer syn_sk_...`，使用具有 `drive.public_link.comment.create` 权限的 API 密钥 |
| `Content-Type` | 是 | `application/json` |
| `Idempotency-Key` | 否 | 防止同一次请求重试时重复创建留言；正常发留言无需提供 |

请求体参数：

| 字段 | 必填 | 说明 |
|---|---|---|
| `url` | 与 `shareId` 二选一 | 完整的当前 Synapse `/share/...` 链接，最长 2048 字符 |
| `shareId` | 与 `url` 二选一 | 分享链接中的公开 ID，形如 `shr_...`；不接受分享记录 `id` 或文件 `itemId` |
| `password` | 否 | 分享密码；如果链接也带 `password` query，以此字段为准 |
| `body` | 是 | 纯文本留言，去除首尾空白后为 1–4000 字符 |

`url` 和 `shareId` 可同时提供。服务端分别解析两个目标，要求它们属于同一分享且最终指向同一文件；不一致返回 `409 TARGET_MISMATCH`。都不提供返回 `400 TARGET_REQUIRED`。任一字段无效时直接报错，不使用另一个字段兜底。

`shareId` 单独使用时指向分享根目标。如果分享的是文件夹，应使用指向具体 Markdown 文件的 `/share/<shareId>/items/<itemId>` 链接，并且只传 `url`。同时传入文件夹的 `shareId` 和子文件链接会返回目标不一致。

成功返回 `201 Created`：

```json
{
  "requestId": "req_example",
  "data": {
    "id": "留言 ID",
    "createdAt": "2026-09-30T08:00:00.000Z"
  }
}
```

每次成功调用都可以创建一条新留言。未提供 `Idempotency-Key` 时，即使目标和正文相同，重复调用也会新增留言。提供时，其值须为 8–120 位字母、数字、下划线或连字符：同一 API 密钥使用相同去重键重试同一目标和正文，返回原留言；使用该键提交不同目标或正文，返回 `409 IDEMPOTENCY_CONFLICT`。要用去重键创建另一条留言，应换一个键。

| HTTP | code | 说明 |
|---:|---|---|
| 400 | `TARGET_REQUIRED`、`INVALID_REQUEST`、`INVALID_IDEMPOTENCY_KEY` | 目标缺失、字段无效或去重键无效 |
| 401 | `INVALID_API_KEY` | API 密钥无效 |
| 403 | `INSUFFICIENT_SCOPE`、`LINK_PASSWORD_REQUIRED_OR_INVALID`、`COMMENT_FORBIDDEN` | 密钥权限不足、分享密码错误或无法留言 |
| 404 | `LINK_NOT_FOUND` | 分享不存在、已失效或目标文件不可用 |
| 409 | `TARGET_MISMATCH`、`IDEMPOTENCY_CONFLICT` | 双字段目标不一致或去重键冲突 |
| 422 | `TARGET_NOT_ARTICLE`、`UNSUPPORTED_LINK` | 分享根目标或链接不是可留言的 Markdown 文件 |
| 503 | `USAGE_LOG_UNAVAILABLE` | 用量记录暂时无法写入 |

响应包含 `X-Request-Id`，JSON 响应不缓存。调用方须保管 API 密钥和分享密码；留言内容会存入 Synapse 并显示给该文章的可读者。
