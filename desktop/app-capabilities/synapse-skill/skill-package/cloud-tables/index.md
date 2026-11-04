# Synapse 云端数据表

Use this guide for 云端数据表 / 云表, including using one as the data source for a public form. This is the server-backed `cloud_tables` MCP domain. Desktop Database / Data Store has a separate catalog and local storage.

「做一个报名页」「收集大家的意见」「给原链接加公开人数」等自然语言需求，先读[用一句话做一个云表报名页](public-apps.md)。在建表或更新分享之前调用 `app_cloud_tables_publish_preflight_get`。表主可单独启用 `publicCount`，让网页读取报名总数并继续关闭匿名名单读取。

## 身份和工具发现

- Use the current signed-in Synapse desktop account. Discover with `search({ domain: "cloud_tables" })`, then search for the exact tool to get its complete input schema before calling `invoke`.
- If no tool is found, the connected desktop runtime may need an update. If the tool reports `CLOUD_TABLE_ACCOUNT_REQUIRED`, ask the user to sign into the desktop client and check its connection. If the account changes, stop and rediscover the target under the new identity. The desktop client manages authentication internally.
- `app_cloud_tables_table_list` returns your owned and accessible collaborator tables. Read the actual table ID and schema before record operations. Table ownership, collaborator permissions and row ownership are enforced by the server.

## 结构与记录

1. For a new table, call `app_cloud_tables_table_create` with a display name and typed fields. It starts private. Save the returned ID and use `app_cloud_tables_table_get` to read its actual structure, permissions and `schemaVersion`.
2. Field keys are stable lowercase identifiers. Types are `text`, `integer`, `number`, `boolean`, `date`, `datetime`, `singleSelect`, `multiSelect`, `url`, and `json`. Write option keys, use ISO dates (`YYYY-MM-DD`) and UTC datetimes, and omit a field to apply its default on creation. Required values cannot be null.
3. `app_cloud_tables_table_update` uses the latest `schemaVersion`. If specifying fields, send the **full active field list** without `archivedAt`; omitted field keys are archived. Restore an archived field within 30 days using its original key and definition.
4. For details use `app_cloud_tables_record_list` with filters, optional projection, sorting, and a small limit. Reuse the same query with `nextCursor`. Use `app_cloud_tables_record_count` for a count and `app_cloud_tables_record_exists_get` for existence. Existence does not guarantee unique writes.
5. Use `app_cloud_tables_record_get` to read the current record and version. Use `app_cloud_tables_record_create` to add a record. `app_cloud_tables_record_update` and `app_cloud_tables_record_delete` use the current record version. `app_cloud_tables_record_batch_apply` accepts up to 100 operations with atomic execution. Table creation and record create, update, delete and batch support `idempotencyKey`; choose a stable key before the first attempt and retry only the original input and key within 24 hours. After a version conflict, read the current state before making any new change.
6. The owner can resolve an exact username with `app_cloud_tables_collaborator_resolve` and read recent operation metadata with `app_cloud_tables_log_list`. Delete and permission changes require authorization for the specific target and effect.

| 对象 | 移入回收站 | 列出回收站 | 恢复 |
|---|---|---|---|
| 表 | `app_cloud_tables_table_delete` | `app_cloud_tables_table_trash_list` | `app_cloud_tables_table_restore` |
| 记录 | `app_cloud_tables_record_delete` | `app_cloud_tables_record_trash_list` | `app_cloud_tables_record_restore` |

Restore within 30 days. Restoring a table clears anonymous access.

## 公开收集页

1. Create a dedicated table for the requested form. For example, a lunch survey can use a required date and dish, single-select budget, multi-select preferences and a boolean default for group orders. Add only fields that respondents may write.
2. When the user asks that anyone can submit, read the table, then use `app_cloud_tables_permissions_update` with its latest version. For a new public form set `anonymous: { create: true }` and keep read, update and delete disabled. Preserve unrelated collaborator and anonymous settings when editing an existing table. Never broaden access just to make a request pass.
3. In the page use the same deployment's `/api/open/v1/tables/{id}/schema` to discover active fields and options, and POST `{ values }` to `/api/open/v1/tables/{id}/records`. Send `credentials: "omit"`, no authorization, and a stable `Idempotency-Key` for submission retries. Embed the intended public API origin and table ID as the page’s connection settings. The desktop account remains available only to MCP.
4. For an externally shareable page use a publicly reachable Synapse deployment. Follow [Drive HTML sharing](../drive/index.md#html-sharing-route) when sharing a page. Verify anonymous create, verify anonymous query is denied, then read the submitted result through MCP under the owner's identity. Do not leave test responses in a real survey without the owner's agreement.

## 公开今日汇总

When the owner asks for a public daily leaderboard, use a separate catalog owned by the same account and containing only public data. Confirm its `anonymous.read` is enabled and read both schemas first. In the response table's `app_cloud_tables_permissions_update`, preserve the existing record ACL and members and set `dailySummary: { dateField, selectionField, flagField, catalogTableId, catalogLabelField, timeZone }`. The response fields must be date, text (catalog record ID), and boolean respectively. The catalog label must be text. Omitting `dailySummary` preserves it and `null` disables it.

The page uses an unauthenticated `GET /api/open/v1/tables/{id}/daily-summary` with `credentials: "omit"`. It returns the configured local date, public `data` rows with `label`, `selections` and `flagged`, an `other` count pair and `hasMore`. It accepts no filters. Unmatched submissions count under `other` without exposing their text. Counts represent submissions. Refresh after each submission and poll only while the page is visible. Verify the public summary and confirm anonymous record get, query, count and exists still fail.
