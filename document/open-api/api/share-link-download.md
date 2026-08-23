# 获取公共链接文件

将完整的 Synapse Drive 分享链接、Drive Site 或公开素材 URL 转换为十分钟有效的下载地址。创建地址需要 API 密钥；使用临时地址下载时不再发送 API 密钥。

## 机器可读契约

[OpenAPI 3.1 JSON]({{APP_PUBLIC_URL}}/api/open/openapi.json) 包含本页接口的请求、响应、认证和错误 schema。

| operationId | 方法与路径 | 认证 |
|---|---|---|
| `createPublicLinkDownload` | `POST /drive/public-links/downloads` | API 密钥与 `drive.public_link.download` |
| `downloadPublicLinkArtifact` | `GET /downloads/{grantId}` | 创建接口返回的临时 token |

## 创建公共链接下载地址

```http
POST /drive/public-links/downloads
Content-Type: application/json
Authorization: Bearer syn_sk_...
```

请求体：

```json
{
  "url": "{{APP_PUBLIC_URL}}/share/shr_example?password=optional-password"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `url` | string | 是 | 当前 Synapse 公共地址下的完整 HTTP(S) URL，最长 2048 字符 |

请求体只允许 `url` 字段。独立的 `password` 字段或其它未知字段会返回 `400 INVALID_REQUEST`。

### 支持的 URL

| URL 形式 | 目标 |
|---|---|
| `{{APP_PUBLIC_URL}}/share/<shareId>` | Drive 分享根目标 |
| `{{APP_PUBLIC_URL}}/share/<shareId>/items/<itemId>` | 分享内指定文件或文件夹 |
| `{{APP_PUBLIC_URL}}/sites/<siteId>/` | Drive Site 根路径 |
| `{{APP_PUBLIC_URL}}/sites/<siteId>/<path>` | Drive Site 页面或 asset |
| `{{APP_PUBLIC_URL}}/files/<assetId>` | 公开素材 |

只接受当前 Synapse 公共地址的同源 URL。外部域名、其它 Synapse 部署地址和不受支持的路径会返回 `422 UNSUPPORTED_LINK`。

受密码保护时，将密码放入完整 URL 的 `password` query，并进行 URL 编码：

```text
{{APP_PUBLIC_URL}}/share/shr_example?password=encoded-password
```

cURL 示例：

```bash
curl --request POST '{{APP_PUBLIC_URL}}/api/open/v1/drive/public-links/downloads' \
  --header 'Authorization: Bearer syn_sk_example000000000000000000000000000000000000' \
  --header 'Content-Type: application/json' \
  --data '{"url":"{{APP_PUBLIC_URL}}/share/shr_example?password=optional-password"}'
```

成功时返回 `201 Created`：

```json
{
  "requestId": "req_example",
  "data": {
    "sourceType": "share",
    "artifact": {
      "type": "file",
      "fileName": "需求说明.md",
      "mimeType": "text/markdown",
      "size": "12000",
      "entryPath": null,
      "snapshotId": "snap_example"
    },
    "download": {
      "method": "GET",
      "url": "{{APP_PUBLIC_URL}}/api/open/v1/downloads/dlg_example?token=example",
      "expiresAt": "2026-08-23T09:10:00.000Z"
    }
  }
}
```

### 响应字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `requestId` | string | 本次请求 ID，与 `X-Request-Id` 响应头一致 |
| `data.sourceType` | string | `share`、`share_item`、`site`、`site_path` 或 `public_asset` |
| `data.artifact.type` | string | `file` 或 `archive` |
| `data.artifact.fileName` | string | 下载响应使用的原始文件名或 ZIP 文件名 |
| `data.artifact.mimeType` | string | 下载制品的 MIME type |
| `data.artifact.size` | string \| null | 文件字节数的十进制字符串；流式 ZIP 为 `null` |
| `data.artifact.entryPath` | string \| null | Site ZIP 中建议首先打开的 HTML 相对路径；其它制品为 `null` |
| `data.artifact.snapshotId` | string | 创建下载地址时固定的内容快照标识 |
| `data.download.method` | string | 固定为 `GET` |
| `data.download.url` | string | 包含临时 token 的完整下载地址 |
| `data.download.expiresAt` | string | RFC 3339 格式的到期时间 |

`snapshotId` 是 opaque 标识，用于关联本次输入快照，不是 Drive 历史版本 ID，也不能用于构造下载地址。创建地址后源文件出现新版本时，本次下载仍读取已固定的内容；源分享、Site 或公开素材仍需保持可用。

## 下载制品

| 分享目标 | 下载制品 |
|---|---|
| 单一文件（包括 Markdown、独立 HTML）、公开素材 | 原始文件 |
| 文件夹或分享内文件夹 | ZIP |
| Drive Site 根路径或 HTML 页面 | 当前站点 deployment 的完整 ZIP |
| Drive Site 非 HTML asset | 原始文件 |

文件夹始终返回 ZIP，包括空文件夹或只包含一个文件的文件夹。Drive Site ZIP 的 `entryPath` 表示解压后应首先打开的 HTML 路径。

单文件和 ZIP 内条目都保留云盘中的原始文件名与目录层级，包括仅大小写不同的名称以及同名文件与文件夹。将这类 ZIP 解压到大小写不敏感的文件系统时可能发生路径冲突，调用方应直接处理 ZIP entry 或使用能区分这些路径的目标文件系统。单个 Markdown 文件不会额外封装为 ZIP；如需连同相对图片等资源一起下载，请分享包含文档和资源的文件夹。

文件夹和 Drive Site ZIP 最多包含 1000 个文件，未压缩总大小最多为 200 MiB。

## 临时下载地址

`download.url` 是 bearer credential，固定十分钟有效。下载请求不需要 `Authorization` header。原样执行响应中的 GET 地址，不要自行构造 `grantId` 或 token：

```bash
curl --location '{{APP_PUBLIC_URL}}/api/open/v1/downloads/dlg_example?token=example' \
  --output download.bin
```

同一地址在有效期内可以重复下载。接口不提供 Range 或断点续传；失败重试时执行完整 GET，地址过期后重新创建。

下载在十分钟内开始后可以继续完成。若文件读取或 ZIP 流在响应开始后失败，连接可能只收到截断文件；调用方应丢弃该文件并完整重试。

成功下载使用以下响应头：

| Header | 说明 |
|---|---|
| `X-Request-Id` | 下载请求 ID |
| `Content-Type` | 文件或 ZIP 的 MIME type |
| `Content-Disposition` | `attachment` 与 UTF-8 文件名 |
| `Content-Length` | 仅原始文件提供；流式 ZIP 不提供 |
| `Cache-Control` | `private, no-store` |
| `Referrer-Policy` | `no-referrer` |
| `X-Content-Type-Options` | `nosniff` |

临时地址不能进入日志、工单、公开消息或 Referer。地址到期，或 API 密钥被撤销、移除“获取公共链接文件”权限、用户被禁用、源分享或 Site 被停用、源资源不可用时，尚未开始的下载会返回 `410 DOWNLOAD_UNAVAILABLE`。

## 错误码

错误响应包含 `requestId`：

```json
{
  "requestId": "req_example",
  "error": {
    "code": "LINK_NOT_FOUND",
    "message": "公共链接不存在或已失效。"
  }
}
```

| HTTP | code | 说明 |
|---:|---|---|
| 400 | `INVALID_REQUEST` | JSON 请求体、`url` 或字段集合无效 |
| 400 | `INVALID_DOWNLOAD_TOKEN` | 临时下载 token 缺失或格式无效 |
| 401 | `INVALID_API_KEY` | API 密钥缺失、无效、已撤销或所属用户不可用 |
| 403 | `INSUFFICIENT_SCOPE` | API 密钥没有“获取公共链接文件”权限 |
| 403 | `LINK_PASSWORD_REQUIRED_OR_INVALID` | 链接密码缺失或错误 |
| 404 | `LINK_NOT_FOUND` | 创建地址时源链接不存在、已失效或目标不可用 |
| 404 | `DOWNLOAD_NOT_FOUND` | 临时下载地址不存在 |
| 410 | `DOWNLOAD_UNAVAILABLE` | 已创建的临时地址到期、权限被收回或源内容不可用 |
| 413 | `ARCHIVE_TOO_LARGE` | ZIP 超过文件数或未压缩大小上限 |
| 422 | `UNSUPPORTED_LINK` | 链接来源或路径不受支持 |
| 503 | `USAGE_LOG_UNAVAILABLE` | 必需的用量记录暂时无法写入 |
| 500 | `INTERNAL_ERROR` | 未预期的服务端错误 |

POST 成功响应和所有 JSON 错误响应都使用 `Cache-Control: no-store`，并同时返回 `requestId` 和 `X-Request-Id`。

该接口不设置 API 密钥、IP、次数、并发数或请求频率限制。十分钟有效期与归档大小属于授权和同步归档边界，不是流量配额。

旧版 `/drive/share-links/downloads` 路径和 `drive.share_link.download` scope 继续兼容已有集成；新集成使用本页记录的公共链接路径和 scope。
