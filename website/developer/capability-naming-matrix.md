# MCP 能力矩阵

<!-- Sources: docs/reference/capability-naming-matrix.md; desktop/database/shared/capability-registry.ts; desktop/synapse-capabilities/shared/scheduler-domain.ts; desktop/synapse-capabilities/shared/content-domain.ts; desktop/synapse-capabilities/shared/naming.ts -->

本页列出当前公开的 Synapse MCP 能力。规范能力 ID 使用 `<domain>.<resource>.<action>`。

| 能力 ID | MCP 工具 | CLI 命令 | 服务方法 |
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
| `content.type.describe` | `content_type_describe` | `synapse content type describe` | `contentTypeDescribe` |
| `content.rule.list` | `content_rule_list` | `synapse content rule list` | `contentRuleList` |
| `content.rule.get` | `content_rule_get` | `synapse content rule get` | `contentRuleGet` |
| `content.rule.create` | `content_rule_create` | `synapse content rule create` | `contentRuleCreate` |
| `content.rule.update` | `content_rule_update` | `synapse content rule update` | `contentRuleUpdate` |
| `content.rule.delete` | `content_rule_delete` | `synapse content rule delete` | `contentRuleDelete` |
| `content.skill.list` | `content_skill_list` | `synapse content skill list` | `contentSkillList` |
| `content.skill.get` | `content_skill_get` | `synapse content skill get` | `contentSkillGet` |
| `content.skill.create` | `content_skill_create` | `synapse content skill create` | `contentSkillCreate` |
| `content.skill.update` | `content_skill_update` | `synapse content skill update` | `contentSkillUpdate` |
| `content.skill.delete` | `content_skill_delete` | `synapse content skill delete` | `contentSkillDelete` |
| `content.prompt.list` | `content_prompt_list` | `synapse content prompt list` | `contentPromptList` |
| `content.prompt.get` | `content_prompt_get` | `synapse content prompt get` | `contentPromptGet` |
| `content.prompt.create` | `content_prompt_create` | `synapse content prompt create` | `contentPromptCreate` |
| `content.prompt.update` | `content_prompt_update` | `synapse content prompt update` | `contentPromptUpdate` |
| `content.prompt.delete` | `content_prompt_delete` | `synapse content prompt delete` | `contentPromptDelete` |

只支持本矩阵中的规范公开名称。
