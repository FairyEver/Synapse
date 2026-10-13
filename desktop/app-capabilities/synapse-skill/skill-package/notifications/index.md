# Synapse 通知清单

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` for the user's intent or an exact `app_*` name, then call `invoke` with the returned tool name and `inputSchema`. Never guess tool arguments.

通过 Synapse MCP `search` 查询 `app_account_notification_*` 的实时 schema，再用 `invoke` 操作。完整工具表见 `api-reference.md`。发送一条新通知属于 System Notifier，走 `app/index.md`；这里管理账号里已有的通知。

用户从通知列表或正文菜单复制的 `synapse:notification:<id>` 是带类型的通知 ID，不是桌面深度链接。即使用户只说“看这个”，也由 `notification` 前缀选择通知工具；将完整标识原样传给 `app_account_notification_get` 的 `reference` 参数，不自行拆 ID。读取只受当前登录账号权限控制，不改变已读状态。

- 用 `app_account_notification_count` 取得当前账号的精确未读数。`list` 按 `all`、`unread`、`pending` 筛选，也可按 `source` 筛选来源，两者取交集；有 `nextCursor` 就按相同条件继续翻页，改变筛选条件时不沿用旧游标，不能把第一页当作全部。
- 用 `get` 阅读指定通知的完整标题、正文和目标信息；读取本身不标已读，需要时明确调用 `read` 或 `read_all`。
- 删除指定通知用 `delete`；清空全部或忽略待处理通知用 `delete_all`，`filter` 只能是 `all` 或 `pending`。`read_all` 与 `delete_all` 不接受来源条件，分别作用于当前账号全部未读、全部通知或全部待处理通知；列表来源筛选不缩小操作范围。待处理通知的软删除不解除终端本身的待处理状态。
- 根据用户的任务与通知内容选择处理对象。不要在 MCP 层假定哪些通知“没用”；只报告实际调用成功的操作。

所有读取与修改都使用当前登录账号的权限；删除只隐藏该账号的记录。站内信通知仅含安全摘要，读信件正文应按目标 `targetId` 使用站内信工具。

文档互动来源为 `drive-discussion`，可用 `source` 筛选。它由云盘新评论、新留言及新回复自动产生，正文含本次内容的 120 字摘要及最多 60 字上下文；`driveDiscussion` 可选元数据说明评论/留言及创建/回复，并可含 `snapshot`：完整详情标题、本次内容最多 500 字、评论原文与被回复内容各最多 200 字及被回复者名称。快照为当时的纯文本摘录，不是当前正文或完整讨论，旧通知可能没有。通知 `url` 是本人通知的受保护网页定位入口，不能把 `targetId` 当作评论 ID，也不能用摘要推断完整正文。打开后仍受当前文档与原分享权限约束；旧参与记录缺少分享来源时，仍会通知新回复，但对应直达可能不可用。
