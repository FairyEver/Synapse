# Synapse 站内信

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

这是 Synapse 内部信箱，不与互联网电子邮件互通。一封信只属于当前用户所在的一个团队；可选该团队的具体用户和组织。选上级组织会覆盖下级成员，实际名单在发送时确定。桌面与 iOS 的人工写信界面不参与 AI 发信。

## 工具入口

先通过 Synapse MCP `search` 查找 mail domain，取得工具当前完整 schema，再用 `invoke` 调用。契约见 `api-reference.md`。

## AI 发送的固定流程

1. 如用户要求生成文档并作为附件发送，先在本机生成完整文件，再用 `app_mail_attachment_create` 的 `filePath` 直接上传为站内信附件，不经云盘。如用户要求分享已有云盘文件，取得该文件的分享链接，放入信件正文；不要将云盘文件转存为附件。
2. 对个人调用 `app_mail_recipient_list`，对组织调用 `app_mail_organization_list`；重名或模糊结果必须让用户选定。可用 `app_mail_organization_members_list` 分页核对组织及下级成员。不要猜测组织 ID，不要把跨团队组织放在同一封信里。
3. 调用 `app_mail_send_preview`，传 `formatVersion: 3`、`toIds`、`ccIds`、`toOrganizationIds`、`ccOrganizationIds`、主题、完整正文及附件 ID；回复或转发传 `relation: {kind, messageId}`。向用户展示预览返回的 To/Cc 地址、当前可投递人数、主题、**完整正文及原信引用**、每个附件的文件名。成员变化时最终人数可能不同；AI 生成的文档还需提供完整内容或准确可打开的预览。
4. 明确问用户“是否按以上内容发送？”。即使最初指令已经说“发给某人”、收件人唯一精确匹配，也必须等待对这一版完整预览的明确肯定。用户改动任何一项，就重新预览、重新确认。模糊回应不算确认。
5. 确认后调用 `app_mail_message_send`，`confirmed` 填 `true`，`clientRequestId` 为该次投递的稳定 UUID。AI 在后台以当前登录用户身份直发，不打开写信界面，也不让用户在界面里点发送。重试同一次请求沿用原幂等键。
6. 仅在 `send` 成功返回后告知 messageId 与最终收件人数。失败时说明原因，保留未发送内容，不声称已发出。

`confirmed: true` 由调用者声明，不能替代第 4 步的对话确认；当前服务端只验证预览、身份和发送权限，无法从该参数核实用户回复。

## 读信

用户从站内信列表或正文菜单复制的 `synapse://mail/<id>` 可直接定位原信。使用 `app_mail_message_get` 的 `reference` 参数传入完整原文，不自行拆出 ID；该链接也可在桌面和 iOS 定位信件，但不是授权凭证。即使用户只说“看这个”，也由 `mail` 前缀选择站内信工具。读取仍受当前登录账号权限控制，`get` 不会自动设为已读。

用 `app_mail_message_count` 取得收件箱、已发送箱和未读数的精确统计。`app_mail_message_list` 按发送时间倒序分页，收件箱可设 `unreadOnly: true`；持续使用 `nextCursor` 才能查全。列表包含发件人与摘要，需要判断正文时用 `app_mail_message_get` 读取完整信件；`app_mail_context_list` 查看当前账号可见的关联往来。AI 根据用户要求和这些内容自行选择需处理的信件，不能由 MCP 代它定义“没用”。

单封设已读或未读用 `app_mail_message_update`；收件箱全部设已读用 `app_mail_message_read_all`。单封删除用 `app_mail_message_delete`，最多 100 个确定 ID 用 `app_mail_message_delete_batch`；检查返回的 `skippedIds`，不能把未处理项报告成已删除。`app_mail_message_delete_all` 按 `box` 清空完整收件箱或已发送箱，与当前搜索词和已加载页无关。删除只隐藏当前用户的副本。下载附件走 `app_mail_attachment_download_file`，目的地为绝对本地路径。

回复只选原发件人；转发重新选择 To/Cc，默认把原附件 ID 放入 `forwardAttachmentIds`，用户可要求移除。两种操作都通过新预览执行完整确认流程。不提供回复全部。
