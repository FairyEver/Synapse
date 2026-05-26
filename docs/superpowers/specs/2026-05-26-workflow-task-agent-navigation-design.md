# Workflow / Task Agent Conversation Navigation Design

**Date**: 2026-05-26
**Status**: Draft for user review

## Context

Workflow runs can execute AI-backed nodes such as prompt and switch nodes. Those nodes create Agent conversations under the workflow source, and users can already view live or historical output from the Agent conversation page. Today the run observer does not expose a direct path to that conversation, so users must leave the runner, switch to Agent, set the sidebar source filter to "工作流", and manually find the conversation.

Scheduled task runs have a similar gap for Agent actions in run history. The task may have created or resumed a conversation, but the history dialog does not provide a direct jump to it.

## Goal

Add a reliable "打开对话" path from:

- Workflow Runner timeline rows for AI-backed nodes.
- Workflow Runner node detail panels for AI-backed nodes.
- Task Scheduler run history entries for Agent task runs.

When opened, Synapse should focus the main window, switch to the Agent tab, set the Agent source filter to the target source, and select the exact conversation.

If the target conversation was deleted, Synapse should show a short failure message and not navigate.

## Non-Goals

- Do not infer conversations from project, workflow, task, node name, timestamps, or other fuzzy metadata.
- Do not show disabled placeholder buttons before a real conversation target exists.
- Do not add buttons to DAG node cards in this iteration.
- Do not change the Agent page information architecture beyond accepting a source-filter hint during navigation.
- Do not restore or recreate deleted conversations.
- Do not add custom visual styling, custom colors, nested cards, or explanatory UI copy.

## Chosen Approach

Persist the actual Agent conversation target in execution results and use one shared navigation entry point.

Each Agent-producing execution records:

```text
AgentConversationTarget
  projectId: string
  conversationId: string
  sessionKey: string
  platform: "workflow" | "scheduled"
```

Workflow AI nodes store the target in `NodeRunResult.outputs.agentConversation`.

Scheduled Agent task runs store the target in `ActionRunResult.outputs`:

```text
conversationId
sessionKey
projectId
platform: "scheduled"
```

The UI shows "打开对话" only when a complete target is available.

## Workflow Runtime

Workflow prompt and switch nodes already call Agent through `AgentRuntimeService.sendScheduled` with `sourcePlatform: "workflow"` and workflow metadata. Extend that path so the Agent runtime returns both `conversationId` and `sessionKey`, and exposes the target as soon as the conversation is created.

The live flow should be:

```text
Workflow AI node starts
  -> Agent runtime creates conversation
  -> Workflow Engine receives AgentConversationTarget
  -> Workflow Engine emits a node agent-conversation event
  -> Runner stores target on the running node result
  -> Runner shows "打开对话"
  -> Agent turn continues streaming in the Agent page
```

This lets users jump while the node is still running. For historical runs, the same target is preserved in the run snapshot.

The workflow event model should gain a node-scoped event for the target, for example:

```text
node:agent-conversation
  runId
  nodeId
  target
```

The existing `node:completed` and terminal snapshot path still include the target in `NodeRunResult.outputs.agentConversation`.

## Scheduler Runtime

Scheduled Agent actions already persist `conversationId` in outputs. Extend that result to also include `sessionKey`, `projectId`, and `platform: "scheduled"` so the history dialog can open the exact conversation without guessing.

The existing manual-run watch behavior can stay. This design adds a durable, click-driven path for run history and does not replace current auto-follow behavior.

## Navigation

Add one shared renderer-accessible bridge method, conceptually:

```text
agent.openConversation(target)
```

The method runs in the main process and must:

1. Check the conversation still exists for `target.projectId` and `target.conversationId`.
2. Return `{ opened: false, reason: "not-found" }` if it is missing.
3. Focus or create the main app window when the conversation exists.
4. Broadcast an open-agent-session navigation event to the main window.
5. Include `projectId`, `conversationId`, `sessionKey`, and `sourceFilter`.

The source filter is derived from `platform`:

```text
workflow  -> "workflow"
scheduled -> "scheduled"
```

The main App already listens for Agent navigation events. Extend that payload so the Agent module can set its sidebar source filter before selecting the target conversation.

This main-process entry point is required because Workflow Runner is a separate BrowserWindow; a local DOM CustomEvent from that window cannot reliably switch the main window tab.

## Agent Page Behavior

When Agent receives a pending session navigation payload:

```text
sourceFilter = payload.sourceFilter ?? current sourceFilter
select target conversation by projectId + conversationId
```

If the target is currently filtered out, setting the source filter first makes it visible in the sidebar. The existing handoff logic can then refresh sessions and select the target.

If the session cannot be found after refresh, the UI should show:

```text
对话不存在或已删除
```

It should not change the current Agent selection in this stale-payload case. The normal deleted-conversation path is handled earlier by `agent.openConversation`, before the main window receives a navigation event.

## Workflow Runner UI

Use the existing shadcn/Radix baseline and current token classes.

Timeline row:

```text
[运行中] 生成发版总结                         [打开对话]
```

Node detail header:

```text
生成发版总结          [运行中] [打开对话] [复制] [关闭]
```

Rules:

- Show the button only when `NodeRunResult.outputs.agentConversation` is a complete target.
- Do not show the button for non-AI nodes.
- Do not show a disabled placeholder while the target is unknown.
- On not-found, show a toast and do not navigate.

## Task Scheduler UI

In `TaskRunsDialog`, Agent run history entries show the same action when a complete target exists:

```text
[成功] 手动                         2m 15s   [打开对话]
2026-05-26 10:12 -> 2026-05-26 10:14
```

Rules:

- Show the button only for `builtin.agent` runs with complete target fields in `run.result.outputs`.
- On not-found, show a toast and do not navigate.
- Keep existing run result rendering and diagnostics unchanged.

## Error Handling

Missing or deleted conversation:

```text
agent.openConversation -> { opened: false, reason: "not-found" }
toast: 对话不存在或已删除
```

Bridge or unexpected failure:

```text
agent.openConversation throws
toast: 打开失败
renderer logger records sanitized context
```

The bridge should not expose raw filesystem paths, prompt text, or full errors in renderer logs.

## Testing

Focused tests should cover:

- Agent runtime `sendScheduled` returns `conversationId` and `sessionKey`.
- `agent.openConversation` returns not-found for deleted or missing conversations.
- `agent.openConversation` focuses/broadcasts to the main window for existing conversations.
- Workflow AI nodes persist `outputs.agentConversation`.
- Workflow live event updates a running node with `agentConversation`.
- Workflow snapshots retain `agentConversation` for history.
- Agent module applies `sourceFilter: "workflow"` or `"scheduled"` before selecting the pending conversation.
- Workflow Runner timeline row and node detail panel show the action only when a complete target exists.
- Task Scheduler history shows the action only for Agent runs with complete target fields.
- Not-found clicks show the expected toast and do not navigate.

## Constraints

- Keep changes scoped to Agent navigation, Workflow Runner result data, and Task Scheduler history UI.
- Respect renderer/preload/main boundaries. Renderer must only use `window.synapse.*`.
- Use `WindowManager.broadcast` or existing EventBus paths for cross-window communication; do not call `webContents.send` outside approved runtime/window boundaries.
- Do not add dependencies.
- Update release notes during implementation because this is user-visible behavior.
