# 站内信 MCP 工具

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

以下是参数概览。调用前仍须用 MCP `search` 读取工具 schema。

| 工具 | 必填参数 | 返回或作用 |
|---|---|---|
| `app_mail_recipient_list` | `query`（可传空字符串浏览），可选 `cursor` | `userId`、昵称、handle、匹配类型、共同团队、`nextCursor` |
| `app_mail_organization_list` | `query`（可传空字符串浏览） | 当前用户所在团队的组织 ID、名称、所属团队和成员数 |
| `app_mail_organization_members_list` | `organizationId`，可选 `cursor` | 组织及下级的有效成员，按 `nextCursor` 续页 |
| `app_mail_message_list` | `box: inbox \| sent` | 当前用户分页列表；可选 `query`、`cursor` |
| `app_mail_message_count` | 无 | 精确的 `inboxTotal`、`sentTotal`、`unread` |
| `app_mail_message_read_all` | 无 | 当前用户的收件箱全部设已读，返回 `updated` |
| `app_mail_message_delete_batch` | 1–100 个不同的 `messageIds` | 返回 `deleted` 与未处理的 `skippedIds` |
| `app_mail_message_delete_all` | `box: inbox \| sent` | 清空当前用户的整个信箱，返回 `deleted` |
| `app_mail_message_get` | `messageId` | 完整正文、参与者、附件 |
| `app_mail_context_list` | `messageId`，可选 `cursor` | 仅返回当前账号可见的关联往来，使用 `nextCursor` 续页 |
| `app_mail_message_update` | `messageId`, `read` | 当前收件人已读状态 |
| `app_mail_message_delete` | `messageId` | 只隐藏当前用户的信件 |
| `app_mail_attachment_create` | 本地文件绝对路径 `filePath` | 直接上传并返回 `attachmentToken`、文件名 |
| `app_mail_attachment_download_file` | `messageId`, `attachmentId`, `outputPath` | 下载到绝对本地路径 |
| `app_mail_send_preview` | `formatVersion: 3`, `toIds`, `ccIds`, `toOrganizationIds`, `ccOrganizationIds`, `subject`, `body`, `attachmentIds`, `forwardAttachmentIds`，可选 `relation: {kind, messageId}` | `previewId`、To/Cc 地址、当前可投递人数、完整待发内容与团队 |
| `app_mail_message_send` | `previewId`, `clientRequestId`, `confirmed: true` | `messageId`、最终收件人数、发送时间 |

`app_mail_message_list` 的 `unreadOnly: true` 只可用于 `inbox`；它与 `query`、`cursor` 可组合。按 `nextCursor` 续页，查询条件变化时从第一页重新开始。`get` 不自动设已读。清空信箱不受搜索词或当前页限制。

附件只接受本地文件直接上传，最大 20 MB，最多 10 个；转发可用 `forwardAttachmentIds` 指定原信附件，服务端复制到新信且计入 10 个上限。云盘文件使用分享链接放在正文中。个人和组织地址可混选，实际收件人不设 50 人上限；To 展开后须至少一人，重复成员只收到一封。回复或转发时 `relation.kind` 为 `reply` 或 `forward`；回复正文必填，转发附言可为空。`previewId` 有效 10 分钟；失效后重做预览并重新获得用户确认。服务端在发送时按最新组织成员展开并重新校验权限、原信和附件；组织失效则拒绝发送。
未发出的附件若七天未被有效预览引用，会由服务端回收。`confirmed: true` 仅是调用者声明，不是对话确认凭证。
