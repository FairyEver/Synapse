# Capability Naming Matrix

Canonical capability ids use `app.<namespace>.<resource>.<action>`. The local HTTP API uses the same canonical id in the top-level `action` field. MCP only exposes the current `app_*` names; the retired prefixes below are not aliases and calls using them fail with `Unknown tool`.

| Retired MCP prefix | Current MCP prefix | Removed tools |
| --- | --- | ---: |
| `database_*` | `app_database_*` | 30 |
| `model_price_*` | `app_model_price_*` | 11 |
| `repository_*` | `app_settings_repository_*` | 1 |
| `automation_*` | `app_automation_*` | 14 |
| `workflow_*` | `app_workflow_*` | 19 |
| `content_*` | `app_resource_repository_*` | 16 |
| `drive_*` | `app_drive_*` | 48 |

The suffix after the prefix is unchanged. For example, `database_table_list` became `app_database_table_list`.

For a two-column list of all 139 renamed tools, see [MCP tool name migration](./mcp-tool-name-migration.md).
For HTTP action, IPC channel, and preload bridge changes, see [API、IPC 与 Bridge 名称迁移](./api-ipc-bridge-name-migration.md).

| Capability id | MCP tool | HTTP action | Service method |
| --- | --- | --- | --- |
| `app.database.table.list` | `app_database_table_list` | `app.database.table.list` | `databaseTableList` |
| `app.database.table.describe` | `app_database_table_describe` | `app.database.table.describe` | `databaseTableDescribe` |
| `app.database.table.create` | `app_database_table_create` | `app.database.table.create` | `databaseTableCreate` |
| `app.database.table.delete` | `app_database_table_delete` | `app.database.table.delete` | `databaseTableDelete` |
| `app.database.table.rename` | `app_database_table_rename` | `app.database.table.rename` | `databaseTableRename` |
| `app.database.table.update` | `app_database_table_update` | `app.database.table.update` | `databaseTableUpdate` |
| `app.database.overview.get` | `app_database_overview_get` | `app.database.overview.get` | `databaseOverviewGet` |
| `app.database.column.create` | `app_database_column_create` | `app.database.column.create` | `databaseColumnCreate` |
| `app.database.column.delete` | `app_database_column_delete` | `app.database.column.delete` | `databaseColumnDelete` |
| `app.database.column.rename` | `app_database_column_rename` | `app.database.column.rename` | `databaseColumnRename` |
| `app.database.column.update` | `app_database_column_update` | `app.database.column.update` | `databaseColumnUpdate` |
| `app.database.choice.update` | `app_database_choice_update` | `app.database.choice.update` | `databaseChoiceUpdate` |
| `app.database.choice_usage.get` | `app_database_choice_usage_get` | `app.database.choice_usage.get` | `databaseChoiceUsageGet` |
| `app.database.row.create` | `app_database_row_create` | `app.database.row.create` | `databaseRowCreate` |
| `app.database.rows.create` | `app_database_rows_create` | `app.database.rows.create` | `databaseRowsCreate` |
| `app.database.row.list` | `app_database_row_list` | `app.database.row.list` | `databaseRowList` |
| `app.database.row.count` | `app_database_row_count` | `app.database.row.count` | `databaseRowCount` |
| `app.database.row.update` | `app_database_row_update` | `app.database.row.update` | `databaseRowUpdate` |
| `app.database.row.delete` | `app_database_row_delete` | `app.database.row.delete` | `databaseRowDelete` |
| `app.database.rows.update` | `app_database_rows_update` | `app.database.rows.update` | `databaseRowsUpdate` |
| `app.database.rows.delete` | `app_database_rows_delete` | `app.database.rows.delete` | `databaseRowsDelete` |
| `app.database.log.list` | `app_database_log_list` | `app.database.log.list` | `databaseLogList` |
| `app.database.sql.read` | `app_database_sql_read` | `app.database.sql.read` | `databaseSqlRead` |
| `app.database.sql.execute` | `app_database_sql_execute` | `app.database.sql.execute` | `databaseSqlExecute` |
| `app.database.folder.list` | `app_database_folder_list` | `app.database.folder.list` | `databaseFolderList` |
| `app.database.folder.create` | `app_database_folder_create` | `app.database.folder.create` | `databaseFolderCreate` |
| `app.database.folder.rename` | `app_database_folder_rename` | `app.database.folder.rename` | `databaseFolderRename` |
| `app.database.folder.delete` | `app_database_folder_delete` | `app.database.folder.delete` | `databaseFolderDelete` |
| `app.database.folder.reorder` | `app_database_folder_reorder` | `app.database.folder.reorder` | `databaseFolderReorder` |
| `app.database.table.move` | `app_database_table_move` | `app.database.table.move` | `databaseTableMove` |
| `app.model_price.used_model.list` | `app_model_price_used_model_list` | `app.model_price.used_model.list` | `modelPriceUsedModelList` |
| `app.model_price.rule.list` | `app_model_price_rule_list` | `app.model_price.rule.list` | `modelPriceRuleList` |
| `app.model_price.rule.get` | `app_model_price_rule_get` | `app.model_price.rule.get` | `modelPriceRuleGet` |
| `app.model_price.rule.create` | `app_model_price_rule_create` | `app.model_price.rule.create` | `modelPriceRuleCreate` |
| `app.model_price.rule.update` | `app_model_price_rule_update` | `app.model_price.rule.update` | `modelPriceRuleUpdate` |
| `app.model_price.rule.delete` | `app_model_price_rule_delete` | `app.model_price.rule.delete` | `modelPriceRuleDelete` |
| `app.model_price.rule.enable` | `app_model_price_rule_enable` | `app.model_price.rule.enable` | `modelPriceRuleEnable` |
| `app.model_price.rule.disable` | `app_model_price_rule_disable` | `app.model_price.rule.disable` | `modelPriceRuleDisable` |
| `app.settings.repository.item.list` | `app_settings_repository_item_list` | `app.settings.repository.item.list` | `repositoryItemList` |
| `app.document_template.docx.generate` | `app_document_template_docx_generate` | `app.document_template.docx.generate` | `documentTemplateDocxGenerate` |
| `app.automation.item.list` | `app_automation_item_list` | `app.automation.item.list` | `automationItemList` |
| `app.automation.item.get` | `app_automation_item_get` | `app.automation.item.get` | `automationItemGet` |
| `app.automation.item.create` | `app_automation_item_create` | `app.automation.item.create` | `automationItemCreate` |
| `app.automation.item.update` | `app_automation_item_update` | `app.automation.item.update` | `automationItemUpdate` |
| `app.automation.item.delete` | `app_automation_item_delete` | `app.automation.item.delete` | `automationItemDelete` |
| `app.automation.item.enable` | `app_automation_item_enable` | `app.automation.item.enable` | `automationItemEnable` |
| `app.automation.item.disable` | `app_automation_item_disable` | `app.automation.item.disable` | `automationItemDisable` |
| `app.automation.run.execute` | `app_automation_run_execute` | `app.automation.run.execute` | `automationRunExecute` |
| `app.automation.run.disable` | `app_automation_run_disable` | `app.automation.run.disable` | `automationRunDisable` |
| `app.automation.run.list` | `app_automation_run_list` | `app.automation.run.list` | `automationRunList` |
| `app.automation.runtime.inspect` | `app_automation_runtime_inspect` | `app.automation.runtime.inspect` | `automationRuntimeInspect` |
| `app.automation.webhook.list` | `app_automation_webhook_list` | `app.automation.webhook.list` | `automationWebhookList` |
| `app.automation.trigger_type.list` | `app_automation_trigger_type_list` | `app.automation.trigger_type.list` | `automationTriggerTypeList` |
| `app.automation.executor_type.list` | `app_automation_executor_type_list` | `app.automation.executor_type.list` | `automationExecutorTypeList` |
| `app.workflow.node_type.list` | `app_workflow_node_type_list` | `app.workflow.node_type.list` | `workflowNodeTypeList` |
| `app.workflow.node_type.describe` | `app_workflow_node_type_describe` | `app.workflow.node_type.describe` | `workflowNodeTypeDescribe` |
| `app.workflow.definition.list` | `app_workflow_definition_list` | `app.workflow.definition.list` | `workflowDefinitionList` |
| `app.workflow.definition.get` | `app_workflow_definition_get` | `app.workflow.definition.get` | `workflowDefinitionGet` |
| `app.workflow.definition.inspect` | `app_workflow_definition_inspect` | `app.workflow.definition.inspect` | `workflowDefinitionInspect` |
| `app.workflow.run.get` | `app_workflow_run_get` | `app.workflow.run.get` | `workflowRunGet` |
| `app.workflow.run.list` | `app_workflow_run_list` | `app.workflow.run.list` | `workflowRunList` |
| `app.workflow.definition.create` | `app_workflow_definition_create` | `app.workflow.definition.create` | `workflowDefinitionCreate` |
| `app.workflow.definition.update` | `app_workflow_definition_update` | `app.workflow.definition.update` | `workflowDefinitionUpdate` |
| `app.workflow.definition.delete` | `app_workflow_definition_delete` | `app.workflow.definition.delete` | `workflowDefinitionDelete` |
| `app.workflow.run.execute` | `app_workflow_run_execute` | `app.workflow.run.execute` | `workflowRunExecute` |
| `app.workflow.run.disable` | `app_workflow_run_disable` | `app.workflow.run.disable` | `workflowRunDisable` |
| `app.workflow.node.create` | `app_workflow_node_create` | `app.workflow.node.create` | `workflowNodeCreate` |
| `app.workflow.node.update` | `app_workflow_node_update` | `app.workflow.node.update` | `workflowNodeUpdate` |
| `app.workflow.node.delete` | `app_workflow_node_delete` | `app.workflow.node.delete` | `workflowNodeDelete` |
| `app.workflow.edge.create` | `app_workflow_edge_create` | `app.workflow.edge.create` | `workflowEdgeCreate` |
| `app.workflow.edge.delete` | `app_workflow_edge_delete` | `app.workflow.edge.delete` | `workflowEdgeDelete` |
| `app.workflow.param.update` | `app_workflow_param_update` | `app.workflow.param.update` | `workflowParamUpdate` |
| `app.workflow.layout.update` | `app_workflow_layout_update` | `app.workflow.layout.update` | `workflowLayoutUpdate` |
| `app.resource_repository.type.describe` | `app_resource_repository_type_describe` | `app.resource_repository.type.describe` | `contentTypeDescribe` |
| `app.resource_repository.rule.list` | `app_resource_repository_rule_list` | `app.resource_repository.rule.list` | `contentRuleList` |
| `app.resource_repository.rule.get` | `app_resource_repository_rule_get` | `app.resource_repository.rule.get` | `contentRuleGet` |
| `app.resource_repository.rule.create` | `app_resource_repository_rule_create` | `app.resource_repository.rule.create` | `contentRuleCreate` |
| `app.resource_repository.rule.update` | `app_resource_repository_rule_update` | `app.resource_repository.rule.update` | `contentRuleUpdate` |
| `app.resource_repository.rule.delete` | `app_resource_repository_rule_delete` | `app.resource_repository.rule.delete` | `contentRuleDelete` |
| `app.resource_repository.skill.list` | `app_resource_repository_skill_list` | `app.resource_repository.skill.list` | `contentSkillList` |
| `app.resource_repository.skill.get` | `app_resource_repository_skill_get` | `app.resource_repository.skill.get` | `contentSkillGet` |
| `app.resource_repository.skill.create` | `app_resource_repository_skill_create` | `app.resource_repository.skill.create` | `contentSkillCreate` |
| `app.resource_repository.skill.update` | `app_resource_repository_skill_update` | `app.resource_repository.skill.update` | `contentSkillUpdate` |
| `app.resource_repository.skill.delete` | `app_resource_repository_skill_delete` | `app.resource_repository.skill.delete` | `contentSkillDelete` |
| `app.resource_repository.prompt.list` | `app_resource_repository_prompt_list` | `app.resource_repository.prompt.list` | `contentPromptList` |
| `app.resource_repository.prompt.get` | `app_resource_repository_prompt_get` | `app.resource_repository.prompt.get` | `contentPromptGet` |
| `app.resource_repository.prompt.create` | `app_resource_repository_prompt_create` | `app.resource_repository.prompt.create` | `contentPromptCreate` |
| `app.resource_repository.prompt.update` | `app_resource_repository_prompt_update` | `app.resource_repository.prompt.update` | `contentPromptUpdate` |
| `app.resource_repository.prompt.delete` | `app_resource_repository_prompt_delete` | `app.resource_repository.prompt.delete` | `contentPromptDelete` |
| `app.drive.item.list` | `app_drive_item_list` | `app.drive.item.list` | `driveItemList` |
| `app.drive.item.get` | `app_drive_item_get` | `app.drive.item.get` | `driveItemGet` |
| `app.drive.file.upload` | `app_drive_file_upload` | `app.drive.file.upload` | `driveFileUpload` |
| `app.drive.folder.upload` | `app_drive_folder_upload` | `app.drive.folder.upload` | `driveFolderUpload` |
| `app.drive.folder.create` | `app_drive_folder_create` | `app.drive.folder.create` | `driveFolderCreate` |
| `app.drive.item.rename` | `app_drive_item_rename` | `app.drive.item.rename` | `driveItemRename` |
| `app.drive.item.move` | `app_drive_item_move` | `app.drive.item.move` | `driveItemMove` |
| `app.drive.item.delete` | `app_drive_item_delete` | `app.drive.item.delete` | `driveItemDelete` |
| `app.drive.item_preview.get` | `app_drive_item_preview_get` | `app.drive.item_preview.get` | `driveItemPreviewGet` |
| `app.drive.file_content.read` | `app_drive_file_content_read` | `app.drive.file_content.read` | `driveFileContentRead` |
| `app.drive.file_download.create` | `app_drive_file_download_create` | `app.drive.file_download.create` | `driveFileDownloadCreate` |
| `app.drive.file_version.list` | `app_drive_file_version_list` | `app.drive.file_version.list` | `driveFileVersionList` |
| `app.drive.file_version_download.create` | `app_drive_file_version_download_create` | `app.drive.file_version_download.create` | `driveFileVersionDownloadCreate` |
| `app.drive.file_version.restore` | `app_drive_file_version_restore` | `app.drive.file_version.restore` | `driveFileVersionRestore` |
| `app.drive.file_version.delete` | `app_drive_file_version_delete` | `app.drive.file_version.delete` | `driveFileVersionDelete` |
| `app.drive.file_version_pin.update` | `app_drive_file_version_pin_update` | `app.drive.file_version_pin.update` | `driveFileVersionPinUpdate` |
| `app.drive.folder_zip.create` | `app_drive_folder_zip_create` | `app.drive.folder_zip.create` | `driveFolderZipCreate` |
| `app.drive.share.list` | `app_drive_share_list` | `app.drive.share.list` | `driveShareList` |
| `app.drive.share.create` | `app_drive_share_create` | `app.drive.share.create` | `driveShareCreate` |
| `app.drive.share.disable` | `app_drive_share_disable` | `app.drive.share.disable` | `driveShareDisable` |
| `app.drive.usage.get` | `app_drive_usage_get` | `app.drive.usage.get` | `driveUsageGet` |
| `app.drive.stats.get` | `app_drive_stats_get` | `app.drive.stats.get` | `driveStatsGet` |
| `app.drive.item_tree.list` | `app_drive_item_tree_list` | `app.drive.item_tree.list` | `driveItemTreeList` |
| `app.drive.folder_path.ensure` | `app_drive_folder_path_ensure` | `app.drive.folder_path.ensure` | `driveFolderPathEnsure` |
| `app.drive.reorganization.preview` | `app_drive_reorganization_preview` | `app.drive.reorganization.preview` | `driveReorganizationPreview` |
| `app.drive.reorganization.apply` | `app_drive_reorganization_apply` | `app.drive.reorganization.apply` | `driveReorganizationApply` |
| `app.drive.direct_link.upload` | `app_drive_direct_link_upload` | `app.drive.direct_link.upload` | `uploadDrivePublicAssets` |
| `app.drive.direct_link.list` | `app_drive_direct_link_list` | `app.drive.direct_link.list` | `listDrivePublicAssets` |
| `app.drive.direct_link.get` | `app_drive_direct_link_get` | `app.drive.direct_link.get` | `getDrivePublicAsset` |
| `app.drive.direct_link.update` | `app_drive_direct_link_update` | `app.drive.direct_link.update` | `replaceDrivePublicAssetFile` |
| `app.drive.direct_link.rename` | `app_drive_direct_link_rename` | `app.drive.direct_link.rename` | `renameDrivePublicAsset` |
| `app.drive.direct_link.delete` | `app_drive_direct_link_delete` | `app.drive.direct_link.delete` | `trashDrivePublicAsset` |
| `app.drive.direct_link.restore` | `app_drive_direct_link_restore` | `app.drive.direct_link.restore` | `restoreDrivePublicAsset` |
| `app.drive.trash.list` | `app_drive_trash_list` | `app.drive.trash.list` | `listDriveTrash` |
| `app.drive.trash.delete` | `app_drive_trash_delete` | `app.drive.trash.delete` | `deleteDriveTrashItem` |
| `app.drive.item.restore` | `app_drive_item_restore` | `app.drive.item.restore` | `restoreDriveTrashItem` |

Retired public names are not aliases; only the canonical names in this matrix are supported.
