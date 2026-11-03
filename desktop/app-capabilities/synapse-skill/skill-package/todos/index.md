# Cloud Todos / 待办事项

## Reaching Synapse tools

The Synapse MCP server publishes only two tools: `search` and `invoke`. Search domain `todos` for its index, then search the canonical name and invoke it with the returned complete schema. Read [api-reference.md](api-reference.md) for fields.

Use this domain for “记录到待办事项”, querying, editing, completing, restoring or deleting cloud todos, and copied `synapse://todos/<id>` references. It requires login and a reachable server. Do not substitute local files, Database tables, Automation items or OS reminders.

## Operation flow

- Create with `app_todos_item_create`, a title, and a fresh UUID `clientRequestId`. Priority, note, deadline, and reminder are optional. Priority defaults to unassigned and reminder defaults to `none`.
- List with `app_todos_item_list`. Completion defaults to `pending` and `all` includes completed. Search title and note with a literal case-insensitive match. Filter by `priority` or sort pending items with `sort: "priority"`. Defaults are `offset=0` and `limit=50`, with a maximum of 100. Follow `nextOffset` until null to check uniqueness. Restart at zero when filters or sort change. Concurrent changes can cause repeats or omissions.
- Read: `app_todos_item_get`, with exactly one `id` or complete copied `reference`, unchanged. Reading neither opens UI nor marks notifications read nor changes completion.
- Edit/complete/restore/delete: locate a unique item, freshly get it, and pass `id` and its `version` as `expectedVersion`. Edit with `app_todos_item_update`; complete/restore with `app_todos_item_set_completed` and `completed=true/false`; delete with `app_todos_item_delete`. Deletion has no restore.

Clear target and user authorization: execute CRUD directly, without extra formal confirmation. “删除续费域名” matching two items: ask which before deleting; do not choose by position. A reference identifies an item but does not alone authorize a write.

Set priority to `high`, `medium`, or `low` when requested. Use `priority: null` in an update to clear it. Omit `priority` when editing another field. For list filters only, `priority: "none"` selects unassigned items.

## Time and reminder rules

Title is trimmed, nonblank, max 200 Unicode code points. Note max 10000, blank -> null. NUL and unpaired surrogates are invalid. Resolve date, clock time and time zone. Send RFC3339 with explicit offset or Z, minute precision (seconds/milliseconds zero); server returns UTC. Deadline may be past; new/changed reminder must be future.

“周五报销并提醒” without a clock time: ask the reminder time; clarify date/time zone if context does not resolve them. Do not invent a time. A date-only deadline also needs a time because dueAt is an instant.

| reminder | Fields |
|---|---|
| `none` | Clear offsetMinutes/remindAt |
| `at_due` | dueAt; server computes remindAt |
| `before_due` | dueAt and offsetMinutes 10/60/1440; server computes remindAt |
| `custom` | Future remindAt; dueAt optional; no offset |

Completion cancels pending reminders. Restoration does not resend sent/past reminders. Do not change reminder without user intent. A save confirms configuration, not successful notification delivery; report returned reminderStatus accurately: none/pending/sent/cancelled/expired.

## Conflicts and retries

Every write has a UUID clientRequestId. Retry a lost response with the exact same action, ID, payload, version and UUID. Memory only, no persistent queue or automatic replay across 24h. A new intent is a new operation/UUID.

Within the 24h receipt window, an exact retry keeps its original reminder instant even if that instant has just passed. Do not change the payload or mint a new UUID to bypass future-time validation. New or revised reminder configurations must still be in the future.

409 TODO_VERSION_CONFLICT: reread and reconcile intended changes with new data, never blindly overwrite. Reminder triggers also advance version. A reconciled new operation uses the new version and a new UUID. 409 TODO_REQUEST_CONFLICT: UUID used for different parameters; report failure, do not reuse it for a changed operation.

Report network/auth/validation/permission failures truthfully. List 404 means server lacks Todo support, not empty list. Get 404 means deleted/unavailable to current account. Do not disclose another account's existence or try another identity.
