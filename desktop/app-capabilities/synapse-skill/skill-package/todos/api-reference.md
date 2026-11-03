# Todos API reference

## Reaching Synapse tools

The Synapse MCP server publishes only two tools: `search` and `invoke`. Search each exact canonical name before invoking; returned schema is authoritative. Domain is `todos`; names map one-to-one to app.todos.item.* actions.

| Indexed name | Input | Result |
|---|---|---|
| `app_todos_item_list` | Optional filter pending/all (pending), priority high/medium/low/none (omission means all), sort due/priority (due), query (literal title/note match, max 200 code points), offset (0), limit (50, max 100) | {items: TodoItem[], nextOffset: number/null} |
| `app_todos_item_get` | Exactly one id or reference: synapse://todos/<id> | TodoItem |
| `app_todos_item_create` | Required title, UUID clientRequestId; optional fields below | TodoItem |
| `app_todos_item_update` | Required id, positive expectedVersion, UUID clientRequestId; optional patch fields | TodoItem |
| `app_todos_item_set_completed` | Required id, completed boolean, positive expectedVersion, UUID clientRequestId | TodoItem |
| `app_todos_item_delete` | Required id, positive expectedVersion, UUID clientRequestId | {id, version, deleted: true} |

Unknown fields rejected. No userId/account override. IDs match [A-Za-z0-9_-]{1,200}. Reference is exact synapse://todos/<id>, no query/hash/extra segment/encoded separator. Get is readonly, never marks notification read.

Fields: title (trimmed nonblank max 200 Unicode code points); note (string/null max 10000, blank -> null); dueAt (RFC3339/null); reminder (none/at_due/before_due/custom); offsetMinutes (10/60/1440/null); remindAt (RFC3339/null). Update omission keeps values; null clears nullable fields. No null title/reminder. Times require explicit offset and minute precision; server returns UTC. Relative reminders require dueAt; custom requires future remindAt and permits no dueAt. Only before_due uses offset. New/changed reminder must be future, unchanged sent/past reminder can stay when editing title/note.

Priority accepts `high`, `medium`, `low`, or null on create and update. Null clears priority. Omission on update retains the existing level. `"none"` is only a list filter and matches unassigned items.

An item can return ordered `imageIds` for up to 10 attachments. Create and update accept IDs already attached to the same item or staged by the same account in the desktop editor. Omit the field to retain attachments on update. Pass an empty array to remove them all. The desktop stages and displays image bytes through private, account-scoped operations.

TodoItem contains id, title, note, priority (nullable), dueAt, reminder, offsetMinutes, remindAt, reminderGeneration, reminderStatus (none/pending/sent/cancelled/expired), completedAt (null pending), version, createdAt, updatedAt. A missing priority from an older server also means unassigned. Creation, update, and completion output timestamps can include seconds.

By default, pending items sort by dueAt ascending with nulls last, then createdAt and id ascending. Priority sort orders pending items high, medium, low, then unassigned, using the default order within each level. Completed items follow pending ones in completedAt and id descending order. Filtering and sorting precede pagination. Continue nextOffset until null and restart at zero when filters or sort change. Concurrent edits can cause offset pages to repeat or omit items.

Every write needs clientRequestId. Update/completion/delete need expectedVersion from a fresh get. Exact retry returns the receipt without another effect. Receipts 24h, creation identity stays with item, deleted tombstones 90 days; no automatic replay beyond 24h. 409 TODO_VERSION_CONFLICT requires reread/reconcile then new UUID for revised operation. 409 TODO_REQUEST_CONFLICT means reused UUID with different parameters. List 404 unsupported, get 404 unavailable; never report errors as empty/success. Permissions network.connect/current account. No Workflow/Automation nodes, UI events or third public MCP tool.

See [index.md](index.md) for target/time clarification and authorized flow.
