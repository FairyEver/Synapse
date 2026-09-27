# 站内信 MCP 工具

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

以下是参数概览。调用前仍须用 MCP `search` 读取工具 schema。

| 工具 | 必填参数 | 返回或作用 |
|---|---|---|
| `app_mail_recipient_list` | `query` | `userId`、昵称、handle、匹配类型、共同团队 |
| `app_mail_message_list` | `box: inbox \| sent` | 当前用户分页列表；可选 `query`、`cursor` |
| `app_mail_message_get` | `messageId` | 完整正文、参与者、附件 |
| `app_mail_message_update` | `messageId`, `read` | 当前收件人已读状态 |
| `app_mail_message_delete` | `messageId` | 只隐藏当前用户的信件 |
| `app_mail_draft_list` | 无 | 草稿列表及版本 |
| `app_mail_draft_create` | `recipientIds`, `subject`, `body`, `attachmentIds` | 新草稿 |
| `app_mail_draft_update` | 上述内容及 `draftId`, `baseVersion` | 乐观并发更新 |
| `app_mail_draft_delete` | `draftId` | 删除自己的草稿 |
| `app_mail_attachment_create` | `driveItemId`，可选 `versionId` | `attachmentToken`、固定版本、文件名 |
| `app_mail_attachment_download_file` | `messageId`, `attachmentId`, `outputPath` | 下载到绝对本地路径 |
| `app_mail_send_preview` | `recipientIds`, `subject`, `body`, `attachmentIds`，可选 `replyToId` | `previewId`、完整待发内容与团队 |
| `app_mail_message_send` | `previewId`, `clientRequestId`, `confirmed: true` | `messageId`、实际收件人、发送时间 |

附件最大 20 MB，最多 10 个；一封信最多 50 位具体收件人。`previewId` 有效 10 分钟；失效后重做预览并重新获得用户确认。服务端在发送时重新校验当前登录用户、所有收件人的共同团队及附件状态。
