# Synapse 站内信

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

这是 Synapse 内部信箱，不与互联网电子邮件互通。一封信只属于当前用户所在的一个团队；可选该团队的具体用户和组织。选上级组织会覆盖下级成员，实际名单在发送时确定。桌面与 iOS 的人工写信界面不参与 AI 发信。

## 工具入口

先通过 Synapse MCP `search` 查找 mail domain，取得工具当前完整 schema，再用 `invoke` 调用。契约见 `api-reference.md`。

## AI 发送流程

用户已明确要求发送（包括回复或转发），且收件人、内容和附件都明确，没有疑惑、不确定或确需用户检查的内容时，直接发送，不再要求用户确认。用户只要求起草、查看或明确要求先审阅时，不得直接发送。AI 生成正文或文档本身不是必须确认的理由。

1. 如用户要求生成文档并作为附件发送，先在本机生成完整文件，再用 `app_mail_internal_attachment_create` 的 `filePath` 直接上传为站内信附件，不经云盘。如用户要求分享已有云盘文件，取得该文件的分享链接，放入信件正文；不要将云盘文件转存为附件。
2. 对个人调用 `app_mail_internal_recipient_list`，对组织调用 `app_mail_internal_organization_list`；重名或模糊结果必须让用户选定。可用 `app_mail_internal_organization_members_list` 分页核对组织及下级成员。不要猜测组织 ID，不要把跨团队组织放在同一封信里。
3. 调用 `app_mail_internal_send_preview`，传 `formatVersion: 3`、`toIds`、`ccIds`、`toOrganizationIds`、`ccOrganizationIds`、主题、完整正文及附件 ID；回复或转发传 `relation: {kind, messageId}`。检查预览返回的 To/Cc 地址、当前可投递人数、主题、完整正文及原信引用、每个附件的文件名，确保符合用户指令。成员变化时最终人数可能不同；预览接口始终调用，但无需为没有疑惑的发送额外展示全文并等待确认。
4. 只有收件人或组织存在歧义、内容含无法核实的关键事实、附件内容或版本不确定、待发内容超出授权范围，或用户明确要求先审阅等确需用户判断的情况，才说明具体疑惑或检查理由并询问用户。需要检查完整信件时，展示 To/Cc 地址、人数、主题、完整正文及原信引用、附件名；AI 生成文档还需提供完整内容或准确可打开的预览。等待用户明确答复并解决疑惑；模糊回应不算确认。用户改动任何一项或预览过期时，重新预览并检查；内容仍明确且在授权范围内时直接发送，不因重新预览本身再次确认。
5. 用户已授权发送且预览检查无待解决问题后，调用 `app_mail_internal_message_send`，`confirmed` 填 `true`，表示调用者已核对发送授权与待发内容，不要求每次都有额外的用户确认回复。AI 在后台以当前登录用户身份直发，不打开写信界面，也不让用户在界面里点发送。重试同一次请求沿用原幂等键。
6. 仅在 `send` 成功返回后告知 messageId 与最终收件人数。失败时说明原因，保留未发送内容，不声称已发出。

`confirmed: true` 由调用者声明，不是对话确认凭证；有待解决问题或用户要求审阅时，不能用该参数替代用户答复。当前服务端只验证预览、身份和发送权限，无法从该参数核实用户回复。

## 读信

用户通过站内信列表或正文菜单的“复制 ID”取得的 `synapse://mail-internal/<id>` 可直接定位原信。使用 `app_mail_internal_message_get` 的 `reference` 参数传入完整原文，不自行拆出 ID；该链接也可在桌面和 iOS 定位信件，但不是授权凭证。即使用户只说“看这个”，也由 `mail` 前缀选择站内信工具。读取仍受当前登录账号权限控制，`get` 不会自动设为已读。

桌面菜单的“复制全文”仅复制标题和完整正文，不包含附件或信件定位 ID；这是桌面剪贴板操作，不新增 MCP 工具。

用 `app_mail_internal_message_count` 取得收件箱、已发送箱和未读数的精确统计。`app_mail_internal_message_list` 按发送时间倒序分页，收件箱可设 `unreadOnly: true`；持续使用 `nextCursor` 才能查全。列表包含发件人与摘要，需要判断正文时用 `app_mail_internal_message_get` 读取完整信件；`app_mail_internal_context_list` 查看当前账号可见的关联往来。AI 根据用户要求和这些内容自行选择需处理的信件，不能由 MCP 代它定义“没用”。

按人员找历史信件时先调用 `app_mail_internal_contact_list`，传 `box: inbox` 得发件人及各自未读数，传 `box: sent` 得历史收件/抄送个人和组织；列表来自完整可见信箱，按最近相关信件时间倒序。将返回的 `key` 原样作为 `app_mail_internal_message_list` 的 `contactKey`，可叠加 `query` 和收件箱 `unreadOnly`，翻页沿用全部条件；换人员或条件时清除 cursor。同名人员按 handle 或 key 区分，组织结合 teamName；已发送的组织不展开成员。这与发送新信时搜索当前可投递人员的 `app_mail_internal_recipient_list` 不同。全部已读、清空信箱不会继承 `contactKey`，仅处理特定人员时须先列出并核对具体信件 ID，再逐封更新或按 ID 批量删除。

单封设已读或未读用 `app_mail_internal_message_update`；收件箱全部设已读用 `app_mail_internal_message_read_all`。单封删除用 `app_mail_internal_message_delete`，最多 100 个确定 ID 用 `app_mail_internal_message_delete_batch`；从收件箱或已发送操作时传对应 `box`，自发信只隐藏这一侧副本；检查返回的 `skippedIds`，不能把未处理项报告成已删除。`app_mail_internal_message_delete_all` 按 `box` 清空完整收件箱或已发送箱，与当前搜索词和已加载页无关。下载附件走 `app_mail_internal_attachment_download_file`，目的地为绝对本地路径。

普通来信回复原发件人；自己发出的信回复时保留原 To 收件人（其中可以包含当前用户）。转发重新选择 To/Cc，默认把原附件 ID 放入 `forwardAttachmentIds`，用户可要求移除。两种操作都通过新预览执行上述流程，无疑惑时直接发送，需要用户判断时才确认。不提供回复全部。
