# 获取分享链接文件

将完整的 Synapse Drive 分享链接、Drive Site 或公开素材 URL 转换为十分钟有效的下载地址。

## 创建分享链接下载地址

```http
POST /drive/share-links/downloads
Content-Type: application/json
Authorization: Bearer syn_sk_...
```

请求体：

```json
{
  "url": "https://synapse.d2.pub/share/shr_example?password=optional-password"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `url` | string | 是 | 当前 Synapse 地址下完整的 `/share`、`/sites` 或 `/files` URL，最长 2048 字符；受密码保护时 URL 需包含 `password` query |

cURL 示例：

```bash
curl --request POST 'https://synapse.d2.pub/api/open/v1/drive/share-links/downloads' \
  --header 'Authorization: Bearer syn_sk_example000000000000000000000000000000000000' \
  --header 'Content-Type: application/json' \
  --data '{"url":"https://synapse.d2.pub/share/shr_example?password=optional-password"}'
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
      "url": "https://synapse.d2.pub/api/open/v1/downloads/dlg_example?token=example",
      "expiresAt": "2026-08-23T09:10:00.000Z"
    }
  }
}
```

`snapshotId` 标识创建下载地址时固定的内容快照，不是 Drive 历史版本 ID。ZIP 的压缩后大小未知，`artifact.size` 为 `null`。

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

`download.url` 是 bearer credential，固定十分钟有效。原样执行响应中的 GET 地址，不要自行构造 `grantId` 或 token：

```bash
curl --location 'https://synapse.d2.pub/api/open/v1/downloads/dlg_example?token=example' \
  --output download.bin
```

同一地址在有效期内可以重复下载。接口不提供 Range 或断点续传；失败重试时执行完整 GET，地址过期后重新创建。

临时地址不能进入日志、工单、公开消息或 Referer。撤销 API 密钥、禁用用户或停用源分享后，尚未开始的下载立即失效。

## 错误码

错误响应包含 `requestId`：

```json
{
  "requestId": "req_example",
  "error": {
    "code": "LINK_NOT_FOUND",
    "message": "分享链接不存在或已失效。"
  }
}
```

| HTTP | code | 说明 |
|---:|---|---|
| 400 | `INVALID_REQUEST` | 请求体或字段无效 |
| 400 | `INVALID_DOWNLOAD_TOKEN` | 临时下载 token 缺失或格式无效 |
| 401 | `INVALID_API_KEY` | API 密钥无效、已撤销或所属用户不可用 |
| 403 | `INSUFFICIENT_SCOPE` | API 密钥没有“获取分享链接文件”权限 |
| 403 | `LINK_PASSWORD_REQUIRED_OR_INVALID` | 分享密码缺失或错误 |
| 404 | `LINK_NOT_FOUND` | 分享链接不存在或已失效 |
| 404 | `DOWNLOAD_NOT_FOUND` | 临时下载地址不存在 |
| 410 | `DOWNLOAD_UNAVAILABLE` | 临时地址到期、源分享失效或内容不可用 |
| 413 | `ARCHIVE_TOO_LARGE` | ZIP 超过文件数或未压缩大小上限 |
| 422 | `UNSUPPORTED_LINK` | 链接来源或路径不受支持 |
| 503 | `USAGE_LOG_UNAVAILABLE` | 必需的用量记录暂时无法写入 |
| 500 | `INTERNAL_ERROR` | 未预期的服务端错误 |

该接口不设置 API 密钥、IP、次数或请求频率限制。十分钟有效期与归档大小属于授权和同步归档边界，不是流量配额。
