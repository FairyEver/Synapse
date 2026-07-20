# Synapse System App Dock Design

## Context

Synapse currently has two navigation models:

- The main window uses fixed top tabs for Agent, Workflow, Drive, Automation, Apps, and Settings.
- The Apps module uses a system app registry for built-in apps such as Resource Repository, Database, Terminal, Model Price, and Document Template.

The target product model is that Synapse behaves as an app-based system. Top-level functions are system apps, and the top bar becomes a Dock for pinned apps rather than a fixed tab list.

## Decisions

### Main Window Model

The main window should use `activeAppId` instead of `activeTab`.

```text
Old:
activeTab = agent | workflow | drive | automation | apps | settings

New:
activeAppId = SynapseSystemAppId
```

Rendering should go through a unified `SystemAppContent` switch keyed by app id.

```text
App.tsx
└─ SystemAppContent(activeAppId)
   ├─ agent                  -> AgentModule
   ├─ workflow               -> WorkflowModule
   ├─ drive                  -> DriveModule
   ├─ automation             -> AutomationModule
   ├─ launcher               -> LauncherModule
   ├─ settings               -> SettingsModule
   ├─ resource-repository    -> ResourceRepositoryModule
   ├─ database               -> DatabaseModule
   └─ existing system apps
```

### Dock And Launcher

The top navigation becomes a Dock.

```text
Dock
├─ shows pinned system app icons
├─ shows app name on hover
├─ switches the active app on click
├─ owns no business state
└─ uses registry metadata for visibility and ordering
```

The current "应用" entry remains, but its stable app id is `launcher`. It acts like Launchpad: a system app that displays the full system app grid.

```text
Display name: 应用
App id: launcher
Namespace: launcher
```

The old `apps` id may be accepted as a route/navigation alias during migration, but it must not be the new stable app id.

### System App Registry

System app definitions should include stable product identity, Dock metadata, and MCP ownership metadata.

```text
SynapseSystemAppDefinition
├─ id
├─ namespace
├─ type: system
├─ name
├─ windowTitle
├─ dock
│  ├─ pinnedByDefault
│  ├─ order
│  └─ visibility
├─ window
│  └─ openable
└─ capabilities
   └─ primaryMcpPrefix
```

Implementation can add the fields incrementally, but the registry is the long-term source of truth for Dock, Launcher, and system app window behavior.

## Stable Names

### Dock-Pinned System Apps

```text
Display Name   App ID       Namespace
--------------------------------------
对话           agent        agent
工作流         workflow     workflow
云盘           drive        drive
自动化         automation   automation
应用           launcher     launcher
设置           settings     settings
```

Workflow remains gated by the existing workflow-entry visibility mechanism.

### Full System App Set

```text
Display Name   App ID                Namespace
-------------------------------------------------
对话           agent                 agent
工作流         workflow              workflow
云盘           drive                 drive
自动化         automation            automation
应用           launcher              launcher
设置           settings              settings
资源仓库       resource-repository   resource_repository
本地数据库     database              database
终端           terminal              terminal
Git            git                   git
编辑器扫描     editor-scan           editor_scan
用量监控       usage-monitor         usage_monitor
模型价格       model-price           model_price
文档模板       document-template     document_template
```

Reserved names not to use as stable app ids:

```text
app
apps
system
content
repository
scheduler
```

`scheduler` remains reserved for a future standalone scheduling app. Current scheduled behavior belongs to Automation unless a separate Scheduler product is introduced.

## MCP Naming

All Synapse system capabilities should use `app.*` canonical capability ids and `app_*` primary MCP tool names.

```text
Canonical capability id:
app.<app_namespace>.<domain>.<action>

Primary MCP tool:
app_<app_namespace>_<domain>_<action>
```

Examples:

```text
app.database.row.create
app.drive.file.upload
app.automation.item.create
app.workflow.definition.update
app.resource_repository.skill.create
app.settings.variable.item.upsert
app.settings.repository.item.list
app.model_price.rule.list
app.document_template.docx.generate
```

Primary MCP tool names:

```text
Capability Prefix                 MCP Tool Prefix
------------------------------------------------------------
app.agent.*                       app_agent_*
app.workflow.*                    app_workflow_*
app.drive.*                       app_drive_*
app.automation.*                  app_automation_*
app.launcher.*                    app_launcher_*
app.settings.*                    app_settings_*
app.settings.variable.*           app_settings_variable_*
app.settings.repository.*         app_settings_repository_*
app.resource_repository.*         app_resource_repository_*
app.database.*                    app_database_*
app.terminal.*                    app_terminal_*
app.git.*                         app_git_*
app.editor_scan.*                 app_editor_scan_*
app.usage_monitor.*               app_usage_monitor_*
app.model_price.*                 app_model_price_*
app.document_template.*           app_document_template_*
```

The following public MCP prefixes are retired and are not callable aliases:

```text
Retired Prefix    Current Prefix
-----------------------------------------------
database_*        app_database_*
model_price_*     app_model_price_*
repository_*      app_settings_repository_*
automation_*      app_automation_*
workflow_*        app_workflow_*
content_*         app_resource_repository_*
drive_*           app_drive_*
```

The suffix after each prefix remains unchanged. For example, `database_table_list` becomes `app_database_table_list`. The built-in `synapse-skill` template and all maintained callers must use the current `app_*` names.

## Current Naming Rules

- Only current `app_*` MCP names are registered and callable.
- Retired names are absent from `tools/list`, action maps, app registry metadata, and MCP dispatch.
- Calling a retired name returns `Unknown tool`; there is no compatibility fallback.
- Documentation, built-in skills, and Agent guidance must use current `app_*` names.

## Implementation Shape

The implementation should be staged:

1. Extend the system app registry with `namespace`, Dock metadata, and the current MCP prefix.
2. Add app definitions/manifests for Agent, Workflow, Drive, Automation, Launcher, and Settings.
3. Replace `APP_NAVIGATION_TABS` with Dock data derived from the app registry.
4. Rename the renderer navigation state from `activeTab` to `activeAppId`.
5. Move AppsModule into `launcher` while preserving current launcher behavior.
6. Convert MCP canonical ids and primary tool names to `app.*` / `app_*`.
7. Remove retired public MCP names from registration and dispatch.
8. Update the built-in `synapse-skill` template to document current `app_*` tools.

Business modules do not need to be physically moved in the first implementation. The first goal is to unify the shell, registry, and naming contract.

## Non-Goals

- Do not redesign the internal UI of Agent, Drive, Automation, Workflow, or Settings.
- Do not introduce a standalone Scheduler app in this phase.
- Do not add third-party app installation or app marketplace behavior in this phase.

## Testing

Focused tests should cover:

- Dock renders pinned apps in registry order.
- Workflow Dock item follows the existing workflow-entry visibility gate.
- Launcher lists the full visible system app set.
- Main window switches active apps through app ids.
- Existing settings/account/update navigation requests still open Settings.
- Existing content-open requests open Resource Repository through Launcher/system app routing.
- MCP `tools/list` exposes only current `app_*` tools.
- MCP `tools/call` rejects retired names with `Unknown tool`.
- Built-in `synapse-skill` docs reference primary `app_*` names.
