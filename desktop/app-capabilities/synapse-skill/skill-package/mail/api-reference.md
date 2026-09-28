# 站内信 MCP 工具

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

以下是参数概览。调用前仍须用 MCP `search` 读取工具 schema。

| 工具 | 必填参数 | 返回或作用 |
|---|---|---|
| `app_mail_recipient_list` | `query`（可传空字符串浏览），可选 `cursor` | `userId`、昵称、handle、匹配类型、共同团队、`nextCursor` |
| `app_mail_message_list` | `box: inbox \| sent` | 当前用户分页列表；可选 `query`、`cursor` |
| `app_mail_message_get` | `messageId` | 完整正文、参与者、附件 |
| `app_mail_message_context` | `messageId`，可选 `cursor` | 仅返回当前账号可见的关联往来，使用 `nextCursor` 续页 |
| `app_mail_message_update` | `messageId`, `read` | 当前收件人已读状态 |
| `app_mail_message_delete` | `messageId` | 只隐藏当前用户的信件 |
| `app_mail_attachment_create` | 本地文件绝对路径 `filePath` | 直接上传并返回 `attachmentToken`、文件名 |
| `app_mail_attachment_download_file` | `messageId`, `attachmentId`, `outputPath` | 下载到绝对本地路径 |
| `app_mail_send_preview` | `formatVersion: 2`, `toIds`, `ccIds`, `subject`, `body`, `attachmentIds`, `forwardAttachmentIds`，可选 `relation: {kind, messageId}` | `previewId`、分组收件人、原信引用、完整待发内容与团队 |
| `app_mail_message_send` | `previewId`, `clientRequestId`, `confirmed: true` | `messageId`、实际收件人、发送时间 |

附件只接受本地文件直接上传，最大 20 MB，最多 10 个；转发可用 `forwardAttachmentIds` 指定原信附件，服务端复制到新信且计入 10 个上限。云盘文件使用分享链接放在正文中。To/Cc 合计最多 50 位且不可重复，To 至少一人。回复或转发时 `relation.kind` 为 `reply` 或 `forward`；回复正文必填，转发附言可为空。`previewId` 有效 10 分钟；失效后重做预览并重新获得用户确认。服务端在发送时重新校验当前登录用户、原信读取权、原团队、所有收件人及附件状态。
未发出的附件若七天未被有效预览引用，会由服务端回收。`confirmed: true` 仅是调用者声明，不是对话确认凭证。
