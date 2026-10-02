# 通知 MCP 工具

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` for the user's intent or an exact `app_*` name, then call `invoke` with the returned tool name and `inputSchema`. Never guess tool arguments.

调用前先用 MCP `search` 取得完整 `inputSchema`。

| 工具 | 参数 | 结果或作用 |
|---|---|---|
| `app_account_notification_list` | 可选 `filter: all \| unread \| pending`、`source`、`cursor` | 最多 50 条、`nextCursor` |
| `app_account_notification_count` | 无 | `{ unread }`，精确未读数 |
| `app_account_notification_get` | `id` 或完整 `reference: "synapse:notification:<id>"`，二选一 | 单条通知全文，不改变已读状态 |
| `app_account_notification_read` | `id` | 单条标已读 |
| `app_account_notification_read_all` | 无 | 全部未读标为已读 |
| `app_account_notification_delete` | `id` | 仅隐藏当前账号的单条通知 |
| `app_account_notification_delete_all` | `filter: all \| pending` | 清空全部或忽略待处理通知 |

列表按创建时间倒序分页，所有筛选都只读取当前账号未删除且在保留期内的通知。可选 `source` 为 `system-notifier`（系统通知）、`terminal-attention`（Agent 待回复）、`terminal-complete`（Agent 回复完成）、`mail`（站内信）、`meeting-transcription`（录音转写）或 `external`（外部通知）；不传时包含全部来源。来源与 `filter` 取交集，服务端先筛选再分页；翻页保持条件，改变条件重新从第一页读取。

`terminal-attention` 包含已经处理的历史通知；`pending` 只包含 `resolvedAt` 为空的终端待处理通知，搭配其他 `source` 返回空列表。删除它不改变终端会话状态。精确未读数、全部已读与批量删除仍按当前账号范围执行，不受列表来源筛选影响。发送通知另见 `app/index.md`。
