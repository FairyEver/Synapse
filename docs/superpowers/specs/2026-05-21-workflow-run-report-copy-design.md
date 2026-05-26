# Workflow Run Report Copy Design

## Goal

Add one-click Markdown copying for workflow run results so workflow authors can paste a complete run context into another AI for debugging and workflow editing assistance.

The copied content is optimized for AI review, not end-user presentation. It must be complete, explicit, and easy to scan.

## User Needs

- Copy one node's run result from the node result side panel.
- Copy the whole workflow run result from the runner toolbar.
- Include useful debugging data while redacting sensitive tokens, credentials, auth headers, and local paths before copying.
- Include every node in the workflow, including completed, failed, cancelled, skipped, waiting, and never-started nodes.
- Include time, duration, and execution order information.
- Allow copying while a workflow is still running. The report marks this as a running snapshot.
- Use Markdown with embedded fenced code blocks.

## Scope

In scope:

- Add a `复制` action to the workflow runner toolbar.
- Add a `复制` action to the selected node result panel header.
- Generate Markdown in renderer-side pure formatting functions.
- Copy through `navigator.clipboard.writeText`.
- Show concise success or failure toast messages.
- Add focused unit tests for formatting, sorting, and clipboard actions.

Out of scope:

- Exporting reports to files.
- Adding new IPC endpoints.
- Changing workflow engine execution or snapshot persistence.
- Adding copy format menus such as JSON, YAML, or summary-only variants.

## Existing Context

The runner already has the data needed for the first version:

- `WorkflowRunnerApp` holds `definition`, `runId`, `runState`, `nodeResults`, `runParams`, and `runError`.
- `WorkflowRunStatus` and `WorkflowRunSnapshot` can include the workflow definition.
- `NodeRunResult` includes status, input variables, resolved prompt/template, output, structured outputs, active branch, error, timestamps, and duration.
- `RunnerToolbar` is the natural entry for whole-run copy.
- `NodeResultPanel` is the natural entry for single-node copy.

This means the first version should stay renderer-only and avoid new main-process contracts.

## Interaction Design

### Whole Run Copy

Add a `复制` button to the workflow runner toolbar.

```text
┌────────────────────────────────────────────────────┐
│ Workflow Name  已完成                 复制 重新运行 编辑 │
└────────────────────────────────────────────────────┘
```

Behavior:

- The button is visible when a workflow definition is loaded.
- It is enabled during running, completed, failed, and cancelled states.
- Clicking copies a Markdown report for the current runner state.
- If `runState` is `running`, the report says it is a running snapshot.
- Success toast: `运行报告已复制。`
- Failure toast: `复制失败。`

### Node Copy

Add a `复制` button to the node result panel header.

```text
┌────────────────────────────────────────────────────┐
│ Node Name  完成                           复制 关闭 │
└────────────────────────────────────────────────────┘
```

Behavior:

- The button is visible whenever a node result panel is open.
- It copies only the selected node report.
- It includes node config and current run result data.
- Success toast: `节点报告已复制。`
- Failure toast: `复制失败。`

## Markdown Report Format

### Whole Workflow Report

The full report uses this structure:

~~~markdown
# 工作流运行报告：{workflowName}

## 运行概览
- 工作流 ID：{workflowId}
- 运行 ID：{runId}
- 状态：{runState}
- 快照：{是/否}
- 开始时间：{startedAt}
- 结束时间：{endedAt}
- 总耗时：{durationMs}

### 运行参数
```json
{ ...params }
```

## 工作流结构
- 节点数：{nodeCount}
- 边数：{edgeCount}
- 默认项目：{defaultProjectId}
- 默认供应商：{defaultProviderId}
- 默认模型：{defaultModelTier}
- 默认超时：{defaultNodeTimeoutMins}

## 执行顺序
1. {nodeName}（{nodeType}）：{status}，{durationMs}

## 节点详情
### 1. {nodeName}
...
~~~

### Node Report

Each node report uses this structure:

~~~markdown
# 节点运行报告：{nodeName}

## 基本信息
- 节点 ID：{nodeId}
- 类型：{nodeType}
- 状态：{status}
- 开始时间：{startedAt}
- 结束时间：{endedAt}
- 耗时：{durationMs}
- 命中分支：{activeBranchLabel} ({activeBranchId})

## 设置
```json
{ ...node.config }
```

## 变量绑定
```json
{ ...node.config.variables }
```

## 运行输入变量
```json
{ ...result.input.variables }
```

## 完整 Prompt
```text
...
```

## 输出
```text
...
```

## 结构化输出
```json
{ ...result.outputs }
```

## 错误
```text
...
```
~~~

Sections with no data may be omitted, except for basic information and settings. This keeps the report complete without filling it with empty headings.

## Node-Type Specific Content

All node types share the same basic layout. The main content heading adapts by node type:

- `prompt`: `完整 Prompt`
- `switch`: `判断 Prompt`
- `script`: `脚本`
- `http_request`: `请求配置`
- `end`: `返回模板`
- unknown type: `主要内容`

For HTTP nodes, request method, URL, headers, query, body type, body, auth, timeout, variables, outputs, and errors are included through the node config and result sections.

For script nodes, shell, script, env, path strategy, login mode, timeout, variables, outputs, and errors are included through the node config and result sections.

## Ordering Rules

The whole-run report orders nodes for debugging:

1. Nodes with `startedAt`, sorted by `startedAt` ascending.
2. Nodes without `startedAt`, appended in workflow definition order.

This preserves actual execution order while still showing skipped or never-started nodes.

The report also keeps each node's original definition order index when available, so a reviewer can map execution order back to the workflow graph.

## Formatting Rules

- Markdown is the only copy format in the first version.
- Values that are objects are formatted as fenced JSON.
- Strings that represent prompts, scripts, templates, outputs, and errors are formatted as fenced text.
- BigInt and circular object values must not crash formatting.
- Missing values use `未记录`.
- Empty string values use `（空）`.
- Timestamps are rendered as readable local time plus the raw timestamp when useful for debugging.
- Durations are rendered in milliseconds, with a readable seconds form when the value is large.
- Copied content redacts sensitive keys and sensitive scalar values before it enters the system clipboard.

## Implementation Plan Boundary

The implementation should be small and renderer-only:

- Add `desktop/src/modules/workflow/runner/run-report.ts`.
- Keep Markdown generation in pure functions.
- Pass a whole-run copy callback from `WorkflowRunnerApp` into `RunnerToolbar`.
- Add node copy handling to `NodeResultPanel` or pass it in from `WorkflowRunnerApp`.
- Use existing shadcn `Button`, lucide copy icon, and existing toast conventions.
- Avoid custom styles, custom colors, new CSS files, or new dependencies.

## Testing

Add focused tests for:

- Whole-run report includes overview, params, workflow structure, execution order, and all node details.
- Node report includes config, variable bindings, runtime input variables, node-specific main content, output, structured output, error, timestamps, and duration.
- Node ordering follows started-time first, definition-order fallback second.
- Copy buttons call `navigator.clipboard.writeText` with Markdown content.
- Copy success and failure toasts are shown.
- JSON formatting handles BigInt and circular references without throwing.

## Acceptance Criteria

- A user can copy a whole workflow run report with one click from the runner toolbar.
- A user can copy a selected node report with one click from the node detail panel.
- Reports are Markdown with embedded code blocks.
- Reports preserve debugging structure while redacting sensitive values before clipboard writes.
- Reports include all nodes for whole-run copy.
- Running workflows can be copied as snapshots.
- The change does not add IPC, storage changes, or workflow engine changes.
