# Synapse Database MCP

You have access to Synapse Database MCP tools for table discovery, schema inspection, row CRUD, schema changes, table folders, operation logs, and SQL. Treat the MCP schema as static: discover current tables with `app_database_table_list` or `app_database_overview_get`, and inspect current columns, kinds, descriptions, and choices with `app_database_table_describe`.

Use the `app_database_*` tool names for new work. The older `database_*` tool names remain available as compatibility aliases for existing workflows and fixed skills.

## Scope Boundary

Use this skill only for Synapse Database operations: tables, columns, rows, choices, table folders, mutation logs, and SQL against the Synapse Database.

Do not use this domain file for workflows, scheduled tasks, Resource Repository publishing, provider settings, or editor MCP registration. For another current Synapse MCP domain, return to `SKILL.md` for routing and read the matching `<domain>/index.md` attachment before using that domain's tools.

## Default Flow

1. If the user names a table imprecisely, call `app_database_table_list` and choose by `name` and `description`.
2. If the user asks broadly what data exists, call `app_database_overview_get`.
3. Before inserts, updates, filters, schema-sensitive reads, choice changes, or column work, call `app_database_table_describe`.
4. Use structured tools first. Use `app_database_sql_read` for read-only SQL inspection. Use `app_database_sql_execute` only when the user explicitly needs SQL-level DDL/DML or an advanced repair.
5. After mutating data or schema, report the affected rows, ids, or changed object names when the tool returns them. Use `app_database_log_list` when the user asks what an Agent, CLI, or MCP operation recently changed.

## Data Rules

- Never send system columns `id`, `created_at`, or `updated_at` in insert/update payloads.
- `boolean` values must be `true` or `false`.
- `date` values must be `YYYY-MM-DD`.
- `timestamp` values must be ISO 8601, for example `2026-04-24T15:30:00`.
- `single_choice` values must exactly match one configured choice.
- `multi_choice` values must be arrays of strings, and every string must be one configured choice.
- `json` values must be objects or arrays.
- For `CONTAINS`, pass one scalar item and use it only with `multi_choice` columns.

## Safe Mutation Rules

- For single-row changes, prefer `app_database_row_update` or `app_database_row_delete` with an explicit `rowId`.
- For bulk changes, use `app_database_rows_update` or `app_database_rows_delete` only with a narrow, non-empty `where` clause. Run the same call with `dryRun: true` first and inspect the returned `ids` and `affected` count before performing the real mutation.
- If the user asks to clear a whole table, use `app_database_table_delete` followed by `app_database_table_create` only when that destructive intent is explicit.
- Treat `app_database_table_delete`, `app_database_column_delete`, `app_database_rows_delete`, and `app_database_sql_execute` as destructive. If the request is ambiguous, ask before running them.
- `app_database_rows_delete` deletes matching rows; it is not for deleting a single known row id. Use `app_database_row_delete` for that.

## Schema Rules

- Table and column names must start with a letter, contain only letters, digits, or underscores, and must not start with `_`.
- Columns cannot be named `id`, `created_at`, or `updated_at`.
- Every table needs at least one user column; system columns are added automatically.
- For `single_choice` and `multi_choice` columns, provide a non-empty `choices` array.
- Before `app_database_choice_update`, call `app_database_choice_usage_get`. The replacement choices must remain compatible with existing rows, or the update is rejected.
- Prefer `app_database_column_update` and `app_database_table_update` for metadata descriptions. They do not change stored data.
- `app_database_column_rename` preserves kind, choices, description metadata, and stored values.
- `app_database_column_delete` drops stored values and refuses to remove the last non-system column.

## Where Clauses

`where` accepts three shapes:

```json
{ "status": "todo" }
```

```json
[{ "field": "status", "op": "=", "value": "todo" }]
```

```json
{
  "combinator": "any",
  "conditions": [
    { "field": "status", "op": "=", "value": "todo" },
    { "field": "tags", "op": "CONTAINS", "value": "urgent" }
  ]
}
```

Supported operators are `=`, `!=`, `>`, `<`, `>=`, `<=`, `LIKE`, and `CONTAINS`.

## SQL Rules

- Use `app_database_sql_read` for `SELECT`, `PRAGMA`, and `EXPLAIN`.
- Use bind params instead of interpolating user values into SQL strings.
- Use `app_database_sql_execute` only when structured MCP tools cannot express the requested operation or when the user explicitly requested raw SQL.
- `app_database_sql_execute` blocks mutating `PRAGMA`, `ATTACH`, `DETACH`, `VACUUM INTO`, and system tables prefixed with `_`.
- Do not use raw SQL as a shortcut for normal table, column, or row operations.

## Table Folders

Use `app_database_folder_list` before moving tables or changing folder order. `app_database_folder_delete` removes the folder only; tables inside are moved to root. To move a table to root, call `app_database_table_move` and omit `folderId`.

## API Reference

See the attached `api-reference.md` for tool groups, signatures, and high-risk operations.
