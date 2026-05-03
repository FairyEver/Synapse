# Capability Naming Matrix

Canonical capability ids use `<domain>.<resource>.<action>`.

| Capability id | MCP tool | CLI command | Service method |
| --- | --- | --- | --- |
| `database.table.list` | `database_table_list` | `synapse database table list` | `databaseTableList` |
| `database.table.describe` | `database_table_describe` | `synapse database table describe` | `databaseTableDescribe` |
| `database.table.create` | `database_table_create` | `synapse database table create` | `databaseTableCreate` |
| `database.table.delete` | `database_table_delete` | `synapse database table delete` | `databaseTableDelete` |
| `database.table.rename` | `database_table_rename` | `synapse database table rename` | `databaseTableRename` |
| `database.table.update` | `database_table_update` | `synapse database table update` | `databaseTableUpdate` |
| `database.overview.get` | `database_overview_get` | `synapse database overview get` | `databaseOverviewGet` |
| `database.column.create` | `database_column_create` | `synapse database column create` | `databaseColumnCreate` |
| `database.column.delete` | `database_column_delete` | `synapse database column delete` | `databaseColumnDelete` |
| `database.column.rename` | `database_column_rename` | `synapse database column rename` | `databaseColumnRename` |
| `database.column.update` | `database_column_update` | `synapse database column update` | `databaseColumnUpdate` |
| `database.choice.update` | `database_choice_update` | `synapse database choice update` | `databaseChoiceUpdate` |
| `database.choice_usage.get` | `database_choice_usage_get` | `synapse database choice-usage get` | `databaseChoiceUsageGet` |
| `database.row.create` | `database_row_create` | `synapse database row create` | `databaseRowCreate` |
| `database.rows.create` | `database_rows_create` | `synapse database rows create` | `databaseRowsCreate` |
| `database.row.list` | `database_row_list` | `synapse database row list` | `databaseRowList` |
| `database.row.count` | `database_row_count` | `synapse database row count` | `databaseRowCount` |
| `database.row.update` | `database_row_update` | `synapse database row update` | `databaseRowUpdate` |
| `database.row.delete` | `database_row_delete` | `synapse database row delete` | `databaseRowDelete` |
| `database.rows.update` | `database_rows_update` | `synapse database rows update` | `databaseRowsUpdate` |
| `database.rows.delete` | `database_rows_delete` | `synapse database rows delete` | `databaseRowsDelete` |
| `database.log.list` | `database_log_list` | `synapse database log list` | `databaseLogList` |
| `database.sql.read` | `database_sql_read` | `synapse database sql read` | `databaseSqlRead` |
| `database.sql.execute` | `database_sql_execute` | `synapse database sql execute` | `databaseSqlExecute` |
| `scheduler.task.list` | `scheduler_task_list` | `synapse scheduler task list` | `schedulerTaskList` |
| `scheduler.task.get` | `scheduler_task_get` | `synapse scheduler task get` | `schedulerTaskGet` |
| `scheduler.task.create` | `scheduler_task_create` | `synapse scheduler task create` | `schedulerTaskCreate` |
| `scheduler.task.enable` | `scheduler_task_enable` | `synapse scheduler task enable` | `schedulerTaskEnable` |
| `scheduler.task.disable` | `scheduler_task_disable` | `synapse scheduler task disable` | `schedulerTaskDisable` |
| `scheduler.task.update` | `scheduler_task_update` | `synapse scheduler task update` | `schedulerTaskUpdate` |
| `scheduler.run.list` | `scheduler_run_list` | `synapse scheduler run list` | `schedulerRunList` |
| `scheduler.runtime.inspect` | `scheduler_runtime_inspect` | `synapse scheduler runtime inspect` | `schedulerRuntimeInspect` |
| `scheduler.action_type.list` | `scheduler_action_type_list` | `synapse scheduler action-type list` | `schedulerActionTypeList` |

Only the canonical names in this matrix are supported public names.
