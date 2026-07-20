# API、IPC 与 Bridge 名称迁移

本次迁移不提供兼容别名、转发或 fallback。`POST /api` 路径不变，只修改请求体中的 `action`。

## 唯一命名规则

| 入口 | 规则 | 示例 |
| --- | --- | --- |
| Capability / HTTP action | `app.<namespace>.<resource>.<action>` | `app.database.table.list` |
| MCP tool | capability id 的点号改为下划线 | `app_database_table_list` |
| IPC channel | operation id 的点号改为冒号，并加 `synapse:` | `synapse:app:database:table:list` |
| Preload bridge | 去掉 `app`，snake_case 转 camelCase，按 token 嵌套 | `window.synapse.database.table.list()` |

界面专用 IPC operation id 也使用 `app.*`，但不会因此注册 MCP 工具。

## HTTP action 完整迁移规则

旧 action 共 139 个，逐项名称与 [MCP 工具名称新旧对照](./mcp-tool-name-migration.md) 完全对应：把该表两列中的下划线改为点号，就是旧、新 HTTP action。没有例外。

| 旧 action 前缀 | 新 action 前缀 | 数量 |
| --- | --- | ---: |
| `database.*` | `app.database.*` | 30 |
| `model_price.*` | `app.model_price.*` | 11 |
| `repository.*` | `app.settings.repository.*` | 1 |
| `automation.*` | `app.automation.*` | 14 |
| `workflow.*` | `app.workflow.*` | 19 |
| `content.*` | `app.resource_repository.*` | 16 |
| `drive.*` | `app.drive.*` | 48 |

例如 `content.skill.list` 改为 `app.resource_repository.skill.list`。旧 action 直接返回现有格式的 `Unknown action`。

## IPC channel 迁移

所有 channel 统一采用 `synapse:app:<namespace>:...:<action>`。下划线 token 原样保留，例如 `model_price`、`resource_repository`、`choice_usage`。

| 旧形式 | 新形式 |
| --- | --- |
| `synapse:database:<resource>:<action>` | `synapse:app:database:<resource>:<action>` |
| `synapse:automation:<resource>:<action>` | `synapse:app:automation:<resource>:<action>` |
| `synapse:workflow:<resource>:<action>` | `synapse:app:workflow:<resource>:<action>` |
| `synapse:content:<resource>:<action>` | `synapse:app:resource_repository:<resource>:<action>` |
| `synapse:account:drive:<resource>:<action>` | `synapse:app:drive:<resource>:<action>` |
| `synapse:model-price:<resource>:<action>` | `synapse:app:model_price:<resource>:<action>` |
| `synapse:repository:<resource>:<action>` | `synapse:app:settings:repository:<resource>:<action>` |
| 其它 `synapse:<namespace>:...` | 在 `synapse:` 后加入 `app:`，token 统一为 snake_case |

语义调整后的明确名称：

| 旧 channel | 新 channel |
| --- | --- |
| `synapse:account:drive:file-version:download` | `synapse:app:drive:file_version_download:create` |
| `synapse:account:drive:file-version:pin` | `synapse:app:drive:file_version_pin:update` |
| `synapse:account:drive:item:share` | `synapse:app:drive:share:create` |
| `synapse:account:drive:public-asset:replace` | `synapse:app:drive:direct_link:update` |
| `synapse:account:drive:public-asset:trash` | `synapse:app:drive:direct_link:delete` |
| `synapse:account:drive:site:update-access` | `synapse:app:drive:site:update_access` |
| `synapse:model-price:coverage:list` | `synapse:app:model_price:used_model:list` |

## Preload bridge 完整迁移

下表覆盖本次被移除的所有公开 bridge 组。组内方法按最后一个语义 token 命名；没有列出的旧根级方法不保留。

| 旧路径 | 新路径 |
| --- | --- |
| `documentTemplate.chooseTemplateFile()` | `documentTemplate.template.choose()` |
| `documentTemplate.chooseJsonFile()` | `documentTemplate.json.choose()` |
| `documentTemplate.chooseOutputFile()` | `documentTemplate.output.choose()` |
| `documentTemplate.generateDocx()` | `documentTemplate.docx.generate()` |
| `quickInput.{list,create,update,delete,onChanged}` | `quickInput.item.{list,create,update,delete,onChanged}` |
| `secrets.{list,get,create,update,upsert,delete,onChanged}` | `secrets.item.{list,get,create,update,upsert,delete,onChanged}` |
| `secrets.{scanSkillEnvBindings,scanSkillEnvBindingsBatch,queueSkillEnvBindings}` | `secrets.operation.{scanSkillEnvBindings,scanSkillEnvBindingsBatch,queueSkillEnvBindings}` |
| `soundNotifier.{getSettings,updateSettings}` | `soundNotifier.settings.{get,update}` |
| `soundNotifier.{play,preview}` | `soundNotifier.sound.{play,preview}` |
| `soundNotifier.{onChanged,onPlayRequested}` | `soundNotifier.operation.{onChanged,onPlayRequested}` |
| `terminal.chooseDefaultCwd` | `terminal.group.chooseDefaultCwd` |
| `terminal.{listGroups,createGroup,renameGroup,updateGroupSettings,deleteGroup}` | `terminal.group.{list,create,rename,updateSettings,delete}` |
| `terminal.{createGroupCommand,updateGroupCommand,deleteGroupCommand,launchGroupCommand}` | `terminal.groupCommand.{create,update,delete,launch}` |
| `terminal.{listSessions,createSession,getSession,readSession,renameSession,writeSession,resizeSession,deleteSession,stopSession,runStartupCommand}` | `terminal.session.{list,create,get,read,rename,write,resize,delete,stop,runStartupCommand}` |
| `terminal.{onData,onSessionChanged,onSessionDeleted}` | `terminal.operation.{onData,onSessionChanged,onSessionDeleted}` |
| `account.<Drive 方法>` | `drive.<resource>.<action>`；见下方 Drive 资源表 |
| `content.<item 方法>` | `resourceRepository.item.<action>` |
| `content.<窗口、详情、安装等方法>` | `resourceRepository.operation.<camelCase action>` |
| `repository.<method>` | `settings.repository.<method>` |
| `database.database<Resource><Action>` | `database.<resource>.<action>` |
| `automation.{openCreateEditorWindow,openEditorWindow}` | `automation.editor.{openCreate,openEdit}` |
| `automation.{listItems,getItem,createItem,updateItem,deleteItem,setItemEnabled,onChanged}` | `automation.item.{list,get,create,update,delete,setEnabled,onChanged}` |
| `automation.{runItem,stopRun,listRuns}` | `automation.run.{execute,disable,list}` |
| `workflow.{list,get,create,save,delete,validate}` | `workflow.definition.{list,get,create,update,delete,inspect}` |
| `workflow.{run,cancel,activeRuns,runHistory,runStatus}` | `workflow.run.{execute,disable,listActive,list,get}` |
| `workflow.{runDefinition,rerun,openRunner,openEditor,editorState,setEditorMutationState,checkCanSync,inspectDeletePackage,inspectExportPackage,exportPackage,inspectImportPackage,importPackage,importSharePackage,undoShareImport,onEvent,onRunnerSwitchRun,onEditorRefocus}` | `workflow.operation.<同名 camelCase action>` |
| `workflow.{chooseParamFile,chooseParamDirectory,chooseParamFiles,chooseParamDirectories}` | `workflow.{paramFile,paramDirectory,paramFiles,paramDirectories}.choose` |
| `workflowParamPresets.<method>` | `workflow.paramPreset.<method>` |
| `workflow.onDefinitionUpdated` | `workflow.editor.onDefinitionUpdated` |
| `modelPrice.listCoverage` | `modelPrice.usedModel.list` |
| `modelPrice.{listPresets,importPreset,importPresets}` | `modelPrice.preset.{list,import}` |
| `modelPrice.{getRules,saveRules,clearRules}` | `modelPrice.rule.{list,save,clear}` |

Drive 从 `account` 根移出后，资源路径为：

| 旧 `account` 方法组 | 新 `drive` 路径 |
| --- | --- |
| item list/preview/rename/move/delete | `drive.item.{list,previewUrl,rename,move,delete}` |
| prepare/complete/put/local/cancel/progress | `drive.upload.{prepare,folder.prepare,complete,put,localItems,cancel,onLocalProgress}` |
| dropped file path | `drive.localFile.pathForDroppedFile` |
| folder create | `drive.folder.create` |
| file versions | `drive.fileVersion.{list,restore,delete}`、`drive.fileVersionDownload.create`、`drive.fileVersionPin.update` |
| link operations | `drive.link.{resolve,list,readText,materialize,downloadFile}` |
| shares | `drive.share.{create,disable,get,list}` |
| usage | `drive.usage.get` |
| public assets | `drive.directLink.{list,get,upload,uploadBinary,update,rename,delete,restore}` |
| document images | `drive.documentImages.{scan,import}` |
| sites | `drive.site.{preflight,create,list,updateAccess,disable,enable,delete,republish}` |
| trash | `drive.trash.{list,restore,delete}` |

以下兼容入口被直接删除，不提供替代别名：

| 已删除入口 | 当前入口 |
| --- | --- |
| `usageAnalysis.getPricingRules()` | `modelPrice.rule.list()` |
| `usageAnalysis.savePricingRules()` | `modelPrice.rule.save()` |
| `usageAnalysis.resetPricingRules()` | `modelPrice.rule.clear()` |
| `modelPrice.resetRules()` | `modelPrice.rule.clear()` |

