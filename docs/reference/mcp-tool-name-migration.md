# MCP 工具名称新旧对照

本页只列出已经移除的旧 MCP 工具名及其当前名称，不包含 capability ID、HTTP action 或服务方法。

- 旧名称不再兼容，调用会返回 `Unknown tool`。
- 名称只更换前缀，后半部分保持不变。
- 共移除 139 个旧别名；当前 Synapse MCP 注册 174 个唯一工具。

## 前缀汇总

| 旧前缀 | 新前缀 | 工具数 |
| --- | --- | ---: |
| `database_*` | `app_database_*` | 30 |
| `model_price_*` | `app_model_price_*` | 11 |
| `repository_*` | `app_settings_repository_*` | 1 |
| `automation_*` | `app_automation_*` | 14 |
| `workflow_*` | `app_workflow_*` | 19 |
| `content_*` | `app_resource_repository_*` | 16 |
| `drive_*` | `app_drive_*` | 48 |

## Database（30）

| 旧名称（已移除） | 新名称（当前可用） |
| --- | --- |
| `database_table_list` | `app_database_table_list` |
| `database_table_create` | `app_database_table_create` |
| `database_table_delete` | `app_database_table_delete` |
| `database_table_describe` | `app_database_table_describe` |
| `database_overview_get` | `app_database_overview_get` |
| `database_table_update` | `app_database_table_update` |
| `database_column_create` | `app_database_column_create` |
| `database_column_update` | `app_database_column_update` |
| `database_choice_update` | `app_database_choice_update` |
| `database_choice_usage_get` | `app_database_choice_usage_get` |
| `database_row_create` | `app_database_row_create` |
| `database_rows_create` | `app_database_rows_create` |
| `database_row_list` | `app_database_row_list` |
| `database_row_update` | `app_database_row_update` |
| `database_row_delete` | `app_database_row_delete` |
| `database_rows_update` | `app_database_rows_update` |
| `database_rows_delete` | `app_database_rows_delete` |
| `database_row_count` | `app_database_row_count` |
| `database_log_list` | `app_database_log_list` |
| `database_table_rename` | `app_database_table_rename` |
| `database_column_rename` | `app_database_column_rename` |
| `database_column_delete` | `app_database_column_delete` |
| `database_sql_read` | `app_database_sql_read` |
| `database_sql_execute` | `app_database_sql_execute` |
| `database_folder_list` | `app_database_folder_list` |
| `database_folder_create` | `app_database_folder_create` |
| `database_folder_rename` | `app_database_folder_rename` |
| `database_folder_delete` | `app_database_folder_delete` |
| `database_folder_reorder` | `app_database_folder_reorder` |
| `database_table_move` | `app_database_table_move` |

## Model Price（11）

| 旧名称（已移除） | 新名称（当前可用） |
| --- | --- |
| `model_price_used_model_list` | `app_model_price_used_model_list` |
| `model_price_rule_list` | `app_model_price_rule_list` |
| `model_price_preset_list` | `app_model_price_preset_list` |
| `model_price_preset_import` | `app_model_price_preset_import` |
| `model_price_rule_get` | `app_model_price_rule_get` |
| `model_price_rule_create` | `app_model_price_rule_create` |
| `model_price_rule_update` | `app_model_price_rule_update` |
| `model_price_rule_delete` | `app_model_price_rule_delete` |
| `model_price_rule_clear` | `app_model_price_rule_clear` |
| `model_price_rule_enable` | `app_model_price_rule_enable` |
| `model_price_rule_disable` | `app_model_price_rule_disable` |

## Repository（1）

| 旧名称（已移除） | 新名称（当前可用） |
| --- | --- |
| `repository_item_list` | `app_settings_repository_item_list` |

## Automation（14）

| 旧名称（已移除） | 新名称（当前可用） |
| --- | --- |
| `automation_item_list` | `app_automation_item_list` |
| `automation_item_get` | `app_automation_item_get` |
| `automation_item_create` | `app_automation_item_create` |
| `automation_item_update` | `app_automation_item_update` |
| `automation_item_delete` | `app_automation_item_delete` |
| `automation_item_enable` | `app_automation_item_enable` |
| `automation_item_disable` | `app_automation_item_disable` |
| `automation_run_execute` | `app_automation_run_execute` |
| `automation_run_disable` | `app_automation_run_disable` |
| `automation_run_list` | `app_automation_run_list` |
| `automation_runtime_inspect` | `app_automation_runtime_inspect` |
| `automation_webhook_list` | `app_automation_webhook_list` |
| `automation_trigger_type_list` | `app_automation_trigger_type_list` |
| `automation_executor_type_list` | `app_automation_executor_type_list` |

## Workflow（19）

| 旧名称（已移除） | 新名称（当前可用） |
| --- | --- |
| `workflow_node_type_list` | `app_workflow_node_type_list` |
| `workflow_node_type_describe` | `app_workflow_node_type_describe` |
| `workflow_definition_list` | `app_workflow_definition_list` |
| `workflow_definition_get` | `app_workflow_definition_get` |
| `workflow_definition_inspect` | `app_workflow_definition_inspect` |
| `workflow_run_get` | `app_workflow_run_get` |
| `workflow_run_list` | `app_workflow_run_list` |
| `workflow_definition_create` | `app_workflow_definition_create` |
| `workflow_definition_update` | `app_workflow_definition_update` |
| `workflow_definition_delete` | `app_workflow_definition_delete` |
| `workflow_run_execute` | `app_workflow_run_execute` |
| `workflow_run_disable` | `app_workflow_run_disable` |
| `workflow_node_create` | `app_workflow_node_create` |
| `workflow_node_update` | `app_workflow_node_update` |
| `workflow_node_delete` | `app_workflow_node_delete` |
| `workflow_edge_create` | `app_workflow_edge_create` |
| `workflow_edge_delete` | `app_workflow_edge_delete` |
| `workflow_param_update` | `app_workflow_param_update` |
| `workflow_layout_update` | `app_workflow_layout_update` |

## Resource Repository（16）

| 旧名称（已移除） | 新名称（当前可用） |
| --- | --- |
| `content_type_describe` | `app_resource_repository_type_describe` |
| `content_rule_list` | `app_resource_repository_rule_list` |
| `content_rule_get` | `app_resource_repository_rule_get` |
| `content_rule_create` | `app_resource_repository_rule_create` |
| `content_rule_update` | `app_resource_repository_rule_update` |
| `content_rule_delete` | `app_resource_repository_rule_delete` |
| `content_skill_list` | `app_resource_repository_skill_list` |
| `content_skill_get` | `app_resource_repository_skill_get` |
| `content_skill_create` | `app_resource_repository_skill_create` |
| `content_skill_update` | `app_resource_repository_skill_update` |
| `content_skill_delete` | `app_resource_repository_skill_delete` |
| `content_prompt_list` | `app_resource_repository_prompt_list` |
| `content_prompt_get` | `app_resource_repository_prompt_get` |
| `content_prompt_create` | `app_resource_repository_prompt_create` |
| `content_prompt_update` | `app_resource_repository_prompt_update` |
| `content_prompt_delete` | `app_resource_repository_prompt_delete` |

## Drive（48）

| 旧名称（已移除） | 新名称（当前可用） |
| --- | --- |
| `drive_item_list` | `app_drive_item_list` |
| `drive_item_get` | `app_drive_item_get` |
| `drive_file_upload` | `app_drive_file_upload` |
| `drive_folder_upload` | `app_drive_folder_upload` |
| `drive_folder_create` | `app_drive_folder_create` |
| `drive_item_rename` | `app_drive_item_rename` |
| `drive_item_move` | `app_drive_item_move` |
| `drive_item_delete` | `app_drive_item_delete` |
| `drive_item_preview_get` | `app_drive_item_preview_get` |
| `drive_file_content_read` | `app_drive_file_content_read` |
| `drive_file_download_create` | `app_drive_file_download_create` |
| `drive_file_version_list` | `app_drive_file_version_list` |
| `drive_file_version_download_create` | `app_drive_file_version_download_create` |
| `drive_file_version_restore` | `app_drive_file_version_restore` |
| `drive_file_version_delete` | `app_drive_file_version_delete` |
| `drive_file_version_pin_update` | `app_drive_file_version_pin_update` |
| `drive_link_resolve` | `app_drive_link_resolve` |
| `drive_link_list` | `app_drive_link_list` |
| `drive_link_read_text` | `app_drive_link_read_text` |
| `drive_link_annotation_thread_list` | `app_drive_link_annotation_thread_list` |
| `drive_link_annotation_thread_create` | `app_drive_link_annotation_thread_create` |
| `drive_link_annotation_comment_create` | `app_drive_link_annotation_comment_create` |
| `drive_link_annotation_comment_update` | `app_drive_link_annotation_comment_update` |
| `drive_link_annotation_comment_delete` | `app_drive_link_annotation_comment_delete` |
| `drive_link_annotation_thread_delete` | `app_drive_link_annotation_thread_delete` |
| `drive_link_annotation_anchor_update` | `app_drive_link_annotation_anchor_update` |
| `drive_link_materialize` | `app_drive_link_materialize` |
| `drive_link_download_file` | `app_drive_link_download_file` |
| `drive_folder_zip_create` | `app_drive_folder_zip_create` |
| `drive_share_list` | `app_drive_share_list` |
| `drive_share_create` | `app_drive_share_create` |
| `drive_share_disable` | `app_drive_share_disable` |
| `drive_site_create` | `app_drive_site_create` |
| `drive_site_list` | `app_drive_site_list` |
| `drive_site_update_access` | `app_drive_site_update_access` |
| `drive_site_disable` | `app_drive_site_disable` |
| `drive_site_enable` | `app_drive_site_enable` |
| `drive_site_delete` | `app_drive_site_delete` |
| `drive_site_republish` | `app_drive_site_republish` |
| `drive_usage_get` | `app_drive_usage_get` |
| `drive_stats_get` | `app_drive_stats_get` |
| `drive_item_tree_list` | `app_drive_item_tree_list` |
| `drive_folder_path_ensure` | `app_drive_folder_path_ensure` |
| `drive_reorganization_preview` | `app_drive_reorganization_preview` |
| `drive_reorganization_apply` | `app_drive_reorganization_apply` |
| `drive_direct_link_upload` | `app_drive_direct_link_upload` |
| `drive_direct_link_list` | `app_drive_direct_link_list` |
| `drive_direct_link_get` | `app_drive_direct_link_get` |
| `drive_direct_link_update` | `app_drive_direct_link_update` |
| `drive_direct_link_rename` | `app_drive_direct_link_rename` |
| `drive_direct_link_delete` | `app_drive_direct_link_delete` |
| `drive_direct_link_restore` | `app_drive_direct_link_restore` |
| `drive_trash_list` | `app_drive_trash_list` |
| `drive_trash_delete` | `app_drive_trash_delete` |
| `drive_item_restore` | `app_drive_item_restore` |
