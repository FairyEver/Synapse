# Swarm Task App Design

Date: 2026-07-07
Status: Proposed

## Context

Synapse needs a new system app named "蜂群任务" for running multiple Synapse Agent Runtime side sessions from one reusable task configuration. It is conceptually closer to `auto/` than to `cmux-controller`: the app should not control terminals, should not spawn `codex` or `claude` CLI processes, and should not depend on cmux. It should use Synapse's existing Agent Runtime so each worker run has a normal Agent conversation that can be opened from the UI.

The app value is prompt orchestration. Users write the core prompt and choose structured options. The system then injects worker identity, round context, output rules, Summary/Handoff protocol, and parallel coordination context into each Agent prompt.

## Goals

- Provide a reusable task list. A task stores configuration and can be run many times.
- Store a full config snapshot for every run so historical runs remain reproducible.
- Support fixed batch and continuous refill modes.
- Create a new Agent conversation source for swarm worker conversations, shown separately from user, automation, workflow, and scheduled conversations.
- Show high-level worker status in the app, with a button to open the corresponding Agent conversation for full details.
- Support managed output directories and optional user target files with configurable write policy.
- Support Summary and Handoff as separate optional protocols:
  - Summary is enabled by default and describes what the worker did.
  - Handoff is disabled by default and passes a message only to the next round.
- Organize the implementation as a full app capability package with renderer UI, main service, IPC, MCP dispatcher, and Workflow node entry.

## Non-Goals

- Do not spawn CLI workers from the desktop app.
- Do not implement a terminal monitor or terminal grid.
- Do not classify user prompts as research, fix, implementation, or writing tasks. The user prompt decides what workers do.
- Do not pass full prior worker output into later prompts. Cross-round context uses Summary and optional Handoff only.
- Do not hide Agent Runtime permissions, provider choice, or existing Agent safety controls behind a separate permission model.

## Architecture

```text
desktop/app-capabilities/swarm-task/
  shared/
    capability.ts
    schema.ts
    prompt.ts

  main/
    service.ts
    scheduler.ts
    prompt-builder.ts
    ipc.ts
    dispatcher.ts

  renderer/
    index.tsx
    app-definition.ts
    app-manifest.ts
    components/

  workflow-node/
    manifest.ts
    schema.ts
    executor.main.ts
    panel.tsx
    card.tsx
```

`main/service.ts` owns task CRUD, run lifecycle, worker records, prompt construction, Summary/Handoff extraction, and stop handling. `main/scheduler.ts` owns slot and round scheduling. `main/prompt-builder.ts` is pure and testable.

Worker execution uses existing `AgentRuntimeService.sendNewSession`. Each worker round creates a fresh Agent side session. Worker conversations use a new platform:

```text
platform: "swarm"
sessionKey: "swarm:<taskId>:<runId>"
```

Agent conversation bodies and events remain in existing Agent Runtime stores. Swarm Task stores references, snapshots, summaries, handoffs, and high-level status.

## Data Model

Use DataRepository namespaces:

```text
app.swarm-task.tasks
app.swarm-task.runs
app.swarm-task.worker-runs
```

`SwarmTask`:

```text
id
schemaVersion
name
description?
currentConfig
createdAt
updatedAt
lastRunId?
lastStatus?
```

`SwarmTaskConfig`:

```text
projectId
workspacePath
prompt
presetId
injectOptions
runMode                 # batch | continuous
concurrency
maxRounds               # used by continuous mode
output
summary
handoff
agent
```

`injectOptions`:

```text
workerIdentity          # worker index and total concurrency
roundContext            # current round
runContext              # task/run id and run mode
outputProtocol          # output directory or target file rules
parallelContext         # parallel environment reminder
gitContext              # optional git collaboration reminder
customAppendix?
```

`output`:

```text
mode                    # managed-directory | target-file | both
managedDirectory?
targetFile?
targetFilePolicy        # append-only | section-update | free-edit
```

`summary`:

```text
enabled                 # default true
injectRecent            # inject recent summaries into later rounds
recentLimit             # default 3
```

`handoff`:

```text
enabled                 # default false
```

`agent`:

```text
providerId?
modelTier?
permissionMode?
mainThreadPersonaId?
```

Each run stores a full config snapshot:

```text
SwarmRun
  id
  schemaVersion
  taskId
  status                  # running | draining | success | partial | failed | cancelled
  configSnapshot
  startedAt
  finishedAt?
  totals                  # started/success/failed/cancelled/timeout
  outputDirectory?
  stopRequested
```

Each worker round has a record:

```text
SwarmWorkerRun
  id
  schemaVersion
  taskId
  runId
  workerIndex
  roundIndex
  status                  # queued | running | success | failed | cancelled | timeout
  conversationId?
  sessionKey
  startedAt?
  finishedAt?
  lastPhase?
  lastMessage?
  summary?
  handoff?
  error?
```

## Run Modes

Fixed batch:

```text
start run
  -> snapshot task config
  -> create SwarmRun
  -> create N worker rounds
  -> create one new Agent side session per worker round
  -> wait for all workers
  -> classify final run status
```

Continuous refill:

```text
start run
  -> snapshot task config
  -> create SwarmRun
  -> fill slots up to concurrency
  -> when any worker finishes:
       -> save Summary/Handoff
       -> if stopRequested or reached maxRounds: mark slot idle
       -> else start next round as a new Agent side session
  -> when all slots idle: classify final run status
```

Continuous mode supports manual "stop refill" and `maxRounds`. Stop refill does not cancel currently running workers. A separate cancel action may request Agent Runtime cancellation for active worker conversations.

## Prompt Protocol

Prompt construction order:

```text
[Swarm runtime context]
  task/run/worker/round/concurrency/run mode

[Recent summaries]
  only if summary.enabled && summary.injectRecent
  include latest K summaries from this run

[Previous handoff]
  only if handoff.enabled
  include previous completed worker's handoff only

[Output protocol]
  managed directory and/or target file
  write policy: append-only | section-update | free-edit

[Parallel coordination]
  enabled options and git/file safety reminders

[User prompt]
  original configured prompt

[Structured ending protocol]
  Summary block if enabled
  Handoff block if enabled
```

Structured blocks use parseable delimiters:

```text
<SYNAPSE_SWARM_SUMMARY>
本轮完成的工作、产出、风险和建议。
</SYNAPSE_SWARM_SUMMARY>

<SYNAPSE_SWARM_HANDOFF>
给下一轮 worker 的接续信息。
</SYNAPSE_SWARM_HANDOFF>
```

Summary and Handoff are separate:

- Summary records what the worker did and can be injected into later rounds.
- Handoff is a message to the next round only.
- There is no "full previous output" transfer option.

If Summary is enabled but the block is missing, the service stores a fallback summary from the final Agent result and marks it as fallback. If Handoff is enabled but missing, the next round receives no handoff.

## Output Rules

Managed output directory is the default. The service creates a run-owned directory such as:

```text
swarm-runs/<runId>/
  summary.md
  workers/
    worker-1-round-1.md
    worker-2-round-2.md
  state/
    summaries.jsonl
    handoffs.jsonl
```

Target file mode is optional. The prompt builder injects the selected target file and policy:

```text
append-only
section-update
free-edit
```

The service does not enforce file writes itself in v1; it gives explicit instructions to Agent Runtime. Agent Runtime permissions still decide whether tools are allowed.

## Agent Conversation Source

Add a new conversation platform and source filter:

```text
platform: "swarm"
sourceFilter: "swarm"
label: "蜂群任务"
```

Open actions reuse existing Agent conversation navigation, with the platform set to `swarm`. Swarm Task worker rows link to their conversation. The main Agent session list can show the new source as a separate filter.

## UI

Use existing system app patterns:

```text
SystemAppWindowShell
  actions: [新建] [运行] [停止补位/停止运行] [刷新]

SidebarContentLayout
  sidebar: SwarmTaskSidebar
  content: SwarmTaskDetail
```

Layout:

```text
+--------------------------------------------------------------+
|                                      [新建] [运行] [刷新]     |
+--------------------------+-----------------------------------+
| 搜索                     | 任务名称                           |
|                          | 状态 / 最近运行 / 输出位置          |
| 任务 A                   |                                   |
| 任务 B      running      | [配置] [运行中] [历史]              |
| 任务 C      failed       |                                   |
|                          | 配置 tab                           |
|                          | - Prompt                           |
|                          | - 项目 / 工作目录                   |
|                          | - 预设 / 注入项                     |
|                          | - 并发 / 运行模式 / 最大轮次         |
|                          | - 输出策略                         |
|                          | - Summary / Handoff                |
|                          | - Provider / Model / 权限模式       |
+--------------------------+-----------------------------------+
```

Running tab:

```text
Totals: started / success / failed / cancelled

+--------+-------+----------+----------+----------------+------+
| Worker | Round | Status   | Phase    | Last message   | Open |
+--------+-------+----------+----------+----------------+------+
| 1      | 1     | running  | 读文件   | Read schema.ts | ->   |
| 2      | 2     | success  | 完成     | Summary saved  | ->   |
+--------+-------+----------+----------+----------------+------+
```

History tab:

```text
+---------------------+----------+---------------------+---------+
| Started             | Status   | Result              | Actions |
+---------------------+----------+---------------------+---------+
| 2026-07-07 10:21    | success  | 4 success / 0 fail  | 查看    |
| 2026-07-07 09:50    | partial  | 3 success / 1 fail  | 查看    |
+---------------------+----------+---------------------+---------+
```

Interaction rules:

- Tasks can be created, saved, edited, duplicated, deleted, and rerun.
- Running creates a config snapshot.
- Historical runs can be rerun with that run's snapshot.
- Worker output is not expanded in the list; full details live in the Agent conversation.
- Copy stays short and operational.
- Styling uses existing shadcn/Tailwind tokens and shared layout components. No custom colors, decorative gradients, nested cards, or explanatory marketing copy.

## Worker Phase Mapping

High-level phase comes from Agent events:

```text
thinking           -> 思考
toolUse Read       -> 读文件
toolUse Edit/Write -> 写文件
toolUse Bash       -> 执行命令
permissionRequest  -> 等待权限
result             -> 完成
error              -> 失败
```

`lastMessage` is a short sanitized event summary. It must not store full prompts, secrets, or long tool payloads.

## MCP Capabilities

Expose app capability actions under `app.swarm_task.*`:

```text
app.swarm_task.task.create
app.swarm_task.task.list
app.swarm_task.task.get
app.swarm_task.task.update
app.swarm_task.task.delete
app.swarm_task.run.start
app.swarm_task.run.stopRefill
app.swarm_task.run.cancel
app.swarm_task.run.list
app.swarm_task.run.get
```

Tool names use underscore form:

```text
app_swarm_task_task_create
app_swarm_task_task_list
app_swarm_task_task_get
app_swarm_task_task_update
app_swarm_task_task_delete
app_swarm_task_run_start
app_swarm_task_run_stopRefill
app_swarm_task_run_cancel
app_swarm_task_run_list
app_swarm_task_run_get
```

Sensitive actions must use existing permission, audit, and error redaction boundaries. The MCP tool descriptions must be mirrored in the built-in `synapse-skill` template when implementation lands.

## Workflow Node

Add a Workflow node that can start a Swarm Task run:

Inputs:

```text
taskId
promptOverride?
runModeOverride?
maxRoundsOverride?
concurrencyOverride?
waitForCompletion
```

Outputs:

```text
runId
status
totals
outputDirectory?
```

When `waitForCompletion` is false, the node returns after run creation. When true, it waits until the run reaches a terminal state or the workflow run is cancelled.

## Error Handling

- Starting a run fails before worker creation if the task config is invalid.
- If one worker fails, the run may finish as `partial` when at least one worker succeeds.
- Stop refill transitions running continuous runs to `draining`.
- Cancel requests call Agent Runtime cancellation for active worker conversations and mark queued worker records cancelled.
- Missing Summary/Handoff blocks do not fail the run. Summary may use fallback extraction; Handoff becomes empty.
- Output directory creation failure fails the run before worker creation.
- Agent Runtime permission requests remain visible in the linked Agent conversation; the Swarm Task list shows phase `等待权限`.

## Tests

Main service and scheduler:

- creates tasks and stores config
- snapshots config on run start
- fixed batch starts one fresh side session per worker
- continuous refill respects maxRounds
- stop refill drains active workers without starting new ones
- cancel propagates to active Agent conversations
- classifies success, partial, failed, and cancelled runs

Prompt builder:

- includes enabled injection sections in the correct order
- omits disabled Summary/Handoff sections
- injects latest K summaries
- injects only the previous handoff
- preserves the user prompt body

Parsing:

- extracts Summary and Handoff blocks
- handles missing blocks
- stores fallback Summary when enabled

Renderer:

- renders task list and selected task detail
- starts run from selected task
- shows worker phase and open conversation action
- shows historical runs from snapshots

Agent conversation source:

- classifies `platform: "swarm"` as source filter `swarm`
- opens swarm conversations through the existing Agent navigation path

MCP and Workflow:

- dispatcher schema validation
- start/stop/list/get tool routing
- workflow node returns run metadata and handles cancellation

## Implementation Notes

Implementation will need to update:

- Agent conversation platform and source filter types.
- Preload bridge types and IPC registration.
- System app registry.
- DataRepository schemas and `allSchemas`.
- Capability dispatcher and action router where needed.
- Built-in `synapse-skill` docs for the new MCP capability.
- `AGENTS.md` only if implementation changes long-term MCP naming, app capability boundaries, or user-operable capability rules beyond what is already described there.
