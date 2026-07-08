# Swarm Task Config Simplification Design

Date: 2026-07-08
Status: Approved for planning

## Context

The current Swarm Task configuration exposes several controls whose labels imply stronger behavior than the app actually provides:

- `workspacePath` appears as "运行目录", but Swarm workers should simply run inside the selected Synapse project.
- Output options appear as a managed output system, but the app only injects prompt instructions. It does not enforce or merge file writes.
- "Git 上下文" is unclear to users and only injects a safety reminder.
- The form order mixes task identity, execution behavior, context protocol, and advanced prompt injection.

This adjustment keeps Swarm Task as a prompt orchestration app. It removes configuration that competes with the selected project mental model and renames file-related behavior to match what the system actually does.

## Goals

- Make project selection the only workspace decision. A worker always runs in the selected project's path.
- Replace the current output mode controls with one optional "汇总文件" prompt injection feature.
- Reorder the configuration form into clear groups.
- Remove Git context from the UI and prompt injection options.
- Keep the implementation surgical: no new runtime output manager, no new file merge system, and no new dependency.

## Non-Goals

- Do not implement automatic result collection, export, or file merging.
- Do not create a separate output directory management UI.
- Do not let users choose a workspace path outside the selected project.
- Do not keep hidden Git collaboration controls in the form.
- Do not change the core worker scheduling model, run history model, or Agent Runtime conversation linkage.

## Product Semantics

### Project As Workspace

The selected project is the only runtime workspace. When a task selects a project, all workers run in that project's path.

The UI removes the "运行目录" field entirely, including from advanced settings. The data model may continue to derive or store `workspacePath` internally during migration or compatibility work, but users do not configure it.

### Summary File Prompt Injection

The old "输出" area becomes "汇总文件".

This feature is optional. When enabled, Swarm Task injects a rule into the worker prompt telling the worker how to handle summary-style file output if the user's own task asks for file writing.

The app does not:

- create the summary content itself
- force the worker to write the file
- merge worker outputs
- resolve concurrent edits
- guarantee that the file changed

It only provides a clear prompt instruction.

Suggested injected rule:

```text
如果本轮任务需要写入总结性结果，请追加到以下项目文件：
<summaryFilePath>

不要覆盖已有内容。追加前保留文件原有内容。
```

The file path must be project-relative or resolved under the selected project. The UI should not encourage writing outside the project.

## Configuration Layout

The form should use four groups in this order.

### 任务

- 任务目标
- 项目

### 运行

- 运行模式
- 并发
- 轮次

### 上下文

- 摘要
- 最近摘要
- 交接

### 汇总文件

- 写入汇总文件
- 汇总文件路径

The group only exposes append behavior. Remove the old output mode and target file policy choices:

- no "目录"
- no "文件"
- no "目录 + 文件"
- no `append-only`
- no `section-update`
- no `free-edit`

The UI copy should be short and operational. Avoid explaining implementation details in the visible form. If a secondary line is needed, use wording like:

```text
需要写总结文件时追加到此文件。
```

## Data Model Direction

The current config includes:

```text
workspacePath
output.mode
output.managedDirectory
output.targetFile
output.targetFilePolicy
injectOptions.gitContext
```

The desired user-facing model is:

```text
projectId
prompt
runMode
concurrency
maxRounds
summary
handoff
summaryFile
agent
```

`summaryFile` should represent:

```text
enabled
path
```

The path is only meaningful when enabled. The write mode is fixed to append and should not be configurable.

Compatibility can be handled inside schema migration or config normalization:

- derive the runtime workspace from the selected project path
- ignore or drop `injectOptions.gitContext`
- map an existing `output.targetFile` to `summaryFile.path` only when the old output mode was file-oriented
- otherwise disable `summaryFile`

## Prompt Builder

Prompt construction should keep system-owned injection invisible to the form:

- worker identity
- round context
- run context
- parallel context
- structured Summary protocol
- optional Handoff protocol

Remove Git context injection.

Replace the old output protocol section with a narrower summary file section. It should only appear when `summaryFile.enabled` is true and `summaryFile.path` is non-empty.

The section should avoid claiming that Synapse will write or manage the file. It should instruct the worker to append if the task requires a summary file.

## UI Impact

Renderer changes are limited to the Swarm Task configuration surface:

- Remove "运行目录".
- Remove the current "输出" option menu.
- Remove "Git 上下文".
- Add grouped layout.
- Add "汇总文件" switch and path input.

Keep existing system app shell, task sidebar, tabs, run panel, and history panel. This design does not require a visual overhaul of the running table or task list.

## MCP And Workflow Impact

Swarm Task MCP and Workflow callers should receive the same simplified config semantics over time.

When the implementation changes shared schema or capability input shape, update:

- Swarm Task MCP dispatcher schemas
- Workflow node config schema and panel if it exposes affected overrides
- built-in `synapse-skill` API reference for Swarm Task capabilities
- tests covering schema parsing and prompt generation

Do not introduce a new MCP action for summary file injection. It is part of task config.

## Error Handling

- Starting a run should fail if the selected project cannot be resolved to a path.
- If summary file injection is enabled with an empty path, the form should block save or run.
- If the file path points outside the selected project, reject it before saving.
- Missing or unchanged summary files after a run are not treated as run failures because the app does not enforce writing.

## Tests

Renderer:

- renders the new grouped form order
- does not render "运行目录", "输出", or "Git 上下文"
- disables save/run when summary file is enabled without a valid path

Prompt builder:

- injects the summary file rule when enabled
- omits the summary file rule when disabled
- no longer injects Git context
- keeps Summary and Handoff protocol behavior unchanged

Service/schema:

- starts workers using the selected project's path
- normalizes or migrates old config safely
- rejects summary file paths outside the selected project

Workflow/MCP:

- accept the simplified config shape
- preserve existing start/list/get/update behavior

