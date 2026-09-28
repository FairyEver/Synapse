# Synapse 站内信

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

这是 Synapse 内部信箱，不与互联网电子邮件互通。收件人只能是当前用户同一团队内的具体用户；多人发送逐个选择，不存在“产品组”“研发组”等群发地址。桌面与 iOS 的人工写信界面不参与 AI 发信。

## 工具入口

先通过 Synapse MCP `search` 查找 mail domain，取得工具当前完整 schema，再用 `invoke` 调用。契约见 `api-reference.md`。

## AI 发送的固定流程

1. 如用户要求生成文档并作为附件发送，先在本机生成完整文件，再用 `app_mail_attachment_create` 的 `filePath` 直接上传为站内信附件，不经云盘。如用户要求分享已有云盘文件，取得该文件的分享链接，放入信件正文；不要将云盘文件转存为附件。
2. 对每位收件人或抄送人调用 `app_mail_recipient_list`。唯一精确匹配可暂定；模糊匹配、重名、多个精确结果必须列出姓名与 handle，请用户选择具体用户。无结果时请用户补充线索，不得猜测。不要用相似度分数替用户做最终选择。不要传电子邮件地址或团队/部门名字作为收件人。
3. 调用 `app_mail_send_preview`，传 `formatVersion: 2`，分别固定 `toIds`、`ccIds`、主题、完整正文、附件令牌和转发的原附件 ID；共同团队由服务端确定。回复或转发传 `relation: {kind, messageId}`。向用户展示预览返回的实际 To/Cc、主题、**完整正文及原信引用**、每个附件的文件名。AI 生成的文档还需提供完整内容或准确可打开的预览。
4. 明确问用户“是否按以上内容发送？”。即使最初指令已经说“发给某人”、收件人唯一精确匹配，也必须等待对这一版完整预览的明确肯定。用户改动任何一项，就重新预览、重新确认。模糊回应不算确认。
5. 确认后调用 `app_mail_message_send`，`confirmed` 填 `true`，`clientRequestId` 为该次投递的稳定 UUID。AI 在后台以当前登录用户身份直发，不打开写信界面，也不让用户在界面里点发送。重试同一次请求沿用原幂等键。
6. 仅在 `send` 成功返回后告知 messageId 与实际收件人。失败时说明原因，保留未发送内容，不声称已发出。

`confirmed: true` 由调用者声明，不能替代第 4 步的对话确认；当前服务端只验证预览、身份和发送权限，无法从该参数核实用户回复。

## 读信

用 `app_mail_message_list` 和 `app_mail_message_get` 查看当前用户可见信件，`app_mail_message_context` 查看当前账号可见的关联往来；下载附件走 `app_mail_attachment_download_file`，目的地为绝对本地路径。回复只选原发件人；回复全部覆盖原发件人及原 To/Cc 并排除自己；转发重新选择 To/Cc，默认把原附件 ID 放入 `forwardAttachmentIds`，用户可要求移除。三种操作都通过新预览执行完整确认流程。标记已读或删除只影响当前用户的状态。
