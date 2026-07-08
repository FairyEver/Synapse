# Synapse Database MCP — API Reference

All tools are accessed through the `synapse-mcp` MCP server. Use `app_database_*` as the primary tool names; `database_*` remains a compatibility alias.

## Discovery

### app_database_overview_get

Return all user tables, descriptions, row counts, and column summaries. Use first when the user asks broadly about available data.

### app_database_table_list

List user tables. Use when a table name is missing or imprecise.

### app_database_table_describe

Return one table schema and metadata. Call before writes, filters, choice handling, and schema-sensitive reads.

**Params:** `tableName`

### app_database_log_list

Return recent Database mutation operations. `limit` defaults to 50 and must be between 0 and 500.

**Params:** `limit?`

## Row Reads

### app_database_row_list

Query rows and return `{ rows, total }`.

**Params:** `tableName`, `where?`, `orderBy?`, `limit?`, `offset?`

### app_database_row_count

Count rows matching an optional filter.

**Params:** `tableName`, `where?`

## Row Writes

### app_database_row_create

Insert one row and return `{ id }`.

**Params:** `tableName`, `data`

### app_database_rows_create

Insert multiple rows in one transaction and return `{ ids }`.

**Params:** `tableName`, `rows`

### app_database_row_update

Partially update one row by id and return `{ affected }`.

**Params:** `tableName`, `rowId`, `data`

### app_database_row_delete

Delete one row by id and return `{ affected }`.

**Params:** `tableName`, `rowId`

### app_database_rows_update

Partially update every row matching a non-empty `where` clause and return `{ affected, ids }`.

**Params:** `tableName`, `where`, `data`, `dryRun?`

**Safety:** call with `dryRun: true` first unless the user has already reviewed the exact target ids.

### app_database_rows_delete

Delete every row matching a non-empty `where` clause and return `{ affected, ids }`.

**Params:** `tableName`, `where`, `dryRun?`

**Safety:** call with `dryRun: true` first unless the user has already reviewed the exact target ids.

## Tables

### app_database_table_create

Create a user table. System columns `id`, `created_at`, and `updated_at` are added automatically.

**Params:** `tableName`, `columns`, `description?`

### app_database_table_update

Update table description metadata only.

**Params:** `tableName`, `description`

### app_database_table_rename

Rename a table without changing rows or metadata.

**Params:** `fromTableName`, `toTableName`

### app_database_table_delete

Drop a user table and all rows and metadata.

**Params:** `tableName`

**Safety:** irreversible.

## Columns And Choices

### app_database_column_create

Add one column.

**Params:** `tableName`, `column`

Column kinds: `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`, `single_choice`, `multi_choice`, `json`, `binary`.

### app_database_column_update

Update column description metadata only.

**Params:** `tableName`, `columnName`, `description`

### app_database_column_rename

Rename one user column without changing data, kind, description, or choices.

**Params:** `tableName`, `fromColumnName`, `toColumnName`

### app_database_column_delete

Drop one user column and its stored values. Cannot target system columns and refuses to remove the last non-system column.

**Params:** `tableName`, `columnName`

**Safety:** destructive.

### app_database_choice_usage_get

Return usage counts for every configured choice in a `single_choice` or `multi_choice` column.

**Params:** `tableName`, `columnName`

### app_database_choice_update

Replace choices metadata for a `single_choice` or `multi_choice` column.

**Params:** `tableName`, `columnName`, `choices`

**Safety:** call `app_database_choice_usage_get` first. The new list must remain compatible with existing row values.

## SQL

### app_database_sql_read

Execute read-only SQL. Allows `SELECT`, `PRAGMA`, and `EXPLAIN`.

**Params:** `sql`, `params?`

### app_database_sql_execute

Execute raw SQL. System tables prefixed with `_`, `ATTACH` / `DETACH`, and mutating `PRAGMA` statements are blocked.

**Params:** `sql`, `params?`

**Safety:** prefer structured tools for normal writes. Use only for explicit SQL-level DDL/DML or advanced repair.

## Folders

### app_database_folder_list

List table folders and their members.

### app_database_folder_create

Create a table folder.

**Params:** `name`

### app_database_folder_rename

Rename a table folder.

**Params:** `folderId`, `name`

### app_database_folder_delete

Delete a table folder. Tables inside are moved to root.

**Params:** `folderId`

### app_database_folder_reorder

Reorder table folders.

**Params:** `folderIds`

### app_database_table_move

Move a table to a folder or to root.

**Params:** `tableName`, `folderId?`
