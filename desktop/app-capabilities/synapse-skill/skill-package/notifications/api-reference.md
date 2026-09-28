# 通知 MCP 工具

调用前先用 MCP `search` 取得完整 `inputSchema`。

| 工具 | 参数 | 结果或作用 |
|---|---|---|
| `app_account_notification_list` | 可选 `filter: all \| unread \| pending`、`cursor` | 最多 50 条、`nextCursor` |
| `app_account_notification_count` | 无 | `{ unread }`，精确未读数 |
| `app_account_notification_get` | `id` | 单条通知全文，不改变已读状态 |
| `app_account_notification_read` | `id` | 单条标已读 |
| `app_account_notification_read_all` | 无 | 全部未读标为已读 |
| `app_account_notification_delete` | `id` | 仅隐藏当前账号的单条通知 |
| `app_account_notification_delete_all` | `filter: all \| pending` | 清空全部或忽略待处理通知 |

列表按创建时间倒序分页，所有筛选都只读取当前账号未删除且在保留期内的通知。`pending` 指终端待处理通知；删除它不改变终端会话状态。发送通知另见 `app/index.md`。
