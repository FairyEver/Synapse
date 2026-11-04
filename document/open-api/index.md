# 概览

Synapse 开放接口使用版本化路径。当前版本的基础地址为：

```text
{{APP_PUBLIC_URL}}/api/open/v1
```

## 机器可读契约

OpenAPI 3.1 契约由服务端提供：

```text
{{APP_PUBLIC_URL}}/api/open/openapi.json
```

[打开契约]({{APP_PUBLIC_URL}}/api/open/openapi.json)。该地址包含当前 canonical 接口、标记为 deprecated 的兼容路径、认证方式、请求和响应 schema，可直接导入支持 OpenAPI 3.1 的客户端或代码生成工具。

## 快速开始

1. 在 Console 的“设置 > API 密钥”中创建密钥，选择目标接口需要的操作权限。
2. 如果访问云端数据表，再为密钥选择“表资源”，并确认当前账号获得表授权。
3. 按对应文档的认证方式、请求体和响应约定调用接口。

已登录 Synapse 桌面端的 AI 可以通过 MCP 以当前账号操作云表。独立脚本和集成也可以通过[云端数据表开放 API](/open-api/api/cloud-tables)建表、配置字段与权限、管理记录和回收站并读取日志。开放 API 建表需要 `tables.manage` 及“自己的全部表”。

下载示例：[获取公共链接文件](/open-api/api/share-link-download)。先创建下载地址，再于十分钟内执行响应中的 `GET` 地址。

发送消息步骤：[使用 API 发送消息](/open-api/guide/send-message)。此接口需要单独的 `notification.send` 权限。

给分享的 Markdown 文章添加文末留言：[给分享文章留言](/open-api/api/article-message-create)。此接口需要独立的 `drive.public_link.message.create` 权限。

## 创建 API 密钥

在 Console 的“设置 > API 密钥”中创建密钥，按需选择 scope。例如“获取公共链接文件”对应：

```text
drive.public_link.download
```

云表使用独立的 `tables.manage`、`tables.records.read/create/update/delete` 五项 scope，并额外检查密钥的表资源和表授权。已有密钥不会自动获得云表权限。

完整密钥只显示一次。创建后可以编辑或清空 API 权限，不会轮换密钥；撤销密钥后无法恢复。移除下载权限或撤销密钥会使新请求以及尚未开始的临时下载失效。

## Bearer 认证

公共链接下载、文章留言和私有云表调用通过 `Authorization` header 传入 API 密钥。格式为单个 `Bearer` scheme 和一个不含空白的密钥：

```http
Authorization: Bearer syn_sk_example000000000000000000000000000000000000
```

Cookie、用户登录 token、`X-API-Key` 和 query 参数均不能替代该 header。

云表可逐操作显式开放匿名访问，此时不发送 `Authorization`；无效密钥不会降级为匿名。匿名开放不代表可以使用访问者的登录身份操作私有表。

发送通知接口是例外：它的三种请求形状都把 API 密钥放在请求里（请求体的 `key` 字段或 URL 路径段），不接受这个 header，也不读取 cookie。

## 集成要求

- API 密钥仅用于服务端、CLI 或自动化客户端，不放进网页。云表开放接口支持匿名浏览器调用所需的无凭据 CORS；其它开放接口不提供这一 CORS 例外。
- API 密钥和临时下载地址均属于 bearer credential，不得写入浏览器代码、公开仓库、日志、工单或公开消息。
- 公共链接下载响应中的 `requestId` 与 `X-Request-Id` 响应头一致，可用于 Console 使用记录和问题排查。
- 公共链接下载接口不设置额外请求频率限制；发送通知接口每分钟最多 60 次；云表采用公平并发和队列预算，繁忙时返回 `503` 与 `Retry-After`，详见云表文档。

## 可用 API

[云端数据表](/open-api/api/cloud-tables) 包含完整的 21 项接口、字段类型、请求／响应示例和错误码，可整页复制为 Markdown 供 AI 调用。表中列出常用入口，其余操作见完整文档。

| operationId | 方法 | 路径 | 认证 | 文档 |
|---|---|---|---|---|
| `createCloudTable` | `POST` | `/tables` | Bearer + `tables.manage` + 自己的全部表 | [创建云表](/open-api/api/cloud-tables#创建表) |
| `getCloudTableSchema` | `GET` | `/tables/{id}/schema` | 获授权的密钥，或表已开放的匿名身份 | [读取表结构](/open-api/api/cloud-tables#读取列表与表结构) |
| `queryCloudTableRecords` | `POST` | `/tables/{id}/records/query` | Bearer + 读取授权，或显式开放的匿名查询 | [查询记录](/open-api/api/cloud-tables#查询记录) |
| `countCloudTableRecords` | `POST` | `/tables/{id}/records/count` | 同上，仅统计可读记录 | [条件计数](/open-api/api/cloud-tables#条件计数与存在判断) |
| `existsCloudTableRecords` | `POST` | `/tables/{id}/records/exists` | 同上，仅检查可读记录 | [存在判断](/open-api/api/cloud-tables#条件计数与存在判断) |
| `mutateCloudTableRecords` | `POST` | `/tables/{id}/records/batch` | 逐操作检查 scope、表资源及表授权，或显式开放的匿名操作 | [批量写入](/open-api/api/cloud-tables#批量新增、修改与删除) |
| `createPublicLinkDownload` | `POST` | `/drive/public-links/downloads` | `Authorization: Bearer` 与 `drive.public_link.download` | [获取公共链接文件](/open-api/api/share-link-download) |
| `createPublicLinkArticleMessage` | `POST` | `/drive/public-links/messages` | `Authorization: Bearer` 与 `drive.public_link.message.create` | [给分享文章留言](/open-api/api/article-message-create) |
| `sendNotification` | `POST` | `/notifications` | 请求体 `key` 与 `notification.send` | [发送通知](/open-api/api/notification-send#整体式) |
| `sendNotificationWithKeyInPath` | `POST` | `/notifications/{key}` | 路径段 `key` 与 `notification.send` | [发送通知](/open-api/api/notification-send#表单式) |
| `sendNotificationFromPath` | `GET` | `/notifications/{key}/{title}/{body}` | 路径段 `key` 与 `notification.send` | [发送通知](/open-api/api/notification-send#路径式) |
| `downloadPublicLinkArtifact` | `GET` | `/downloads/{grantId}` | 创建接口返回的临时 token | [获取公共链接文件](/open-api/api/share-link-download#临时下载地址) |
