# Agent Conversation Source Filter Design

## Goal

Agent conversations from user chat, scheduled tasks, and workflow runs currently share the same project-grouped sidebar. Workflow prompt/switch nodes also enter through `sendScheduled`, so workflow-generated conversations are persisted as `platform: "scheduled"` and cannot be separated from scheduled task conversations.

Add a source filter at the top of the Agent sidebar and make workflow-generated conversations persist as a distinct `workflow` source.

## Source Model

Keep `ConversationEntryV1.platform` as the source discriminator.

Supported sidebar source buckets:

- `user`: `platform` is missing, `local`, or `local-renderer`
- `scheduled`: `platform === "scheduled"`
- `workflow`: `platform === "workflow"`
- `webhook`: `platform === "webhook"`
- `relay`: `platform === "relay"`
- `bridge`: any other non-empty `platform`
- `all`: no source filtering

Do not add a new database field for this change. The existing `platform` field already controls routing and source identity.

## Workflow Runtime Change

Workflow nodes currently call `AgentRuntimeService.sendScheduled`. Extend the scheduled send input with optional source metadata:

- `sourcePlatform?: "scheduled" | "workflow"`
- optional `userMeta` values for source details

`sendScheduled` defaults `sourcePlatform` to `scheduled` so existing scheduled task behavior stays unchanged.

The workflow engine passes `sourcePlatform: "workflow"` when calling the agent runtime. It should also pass workflow context when available:

- `source: "workflow"`
- `workflowId`
- `workflowName`
- `workflowRunId`
- `workflowNodeId`
- `workflowNodeName`

Sidebar filtering depends only on `platform`; metadata is for later display, diagnostics, and audit use.

## Sidebar UX

Add a shadcn `Select` at the top of the Agent session sidebar, above the project groups.

Options, in order:

1. 用户对话
2. 定时任务
3. 工作流
4. Webhook
5. Relay
6. 外部桥接
7. 全部

Default selection is `用户对话`.

Filtering affects only the session list shown in the sidebar. It must not delete, archive, mutate, or reload conversations. If the currently selected conversation is filtered out, keep the right-side conversation open until the user selects another visible conversation.

## Compatibility

Existing workflow conversations that were already stored as `platform: "scheduled"` remain in the scheduled-task bucket. Do not infer workflow history from names or session keys; guessing risks misclassifying old scheduled task runs.

New workflow runs must be stored as `platform: "workflow"`.

## UI Constraints

Use existing shadcn components and current Tailwind token classes only.

Do not add custom colors, inline styles, nested cards, explanatory UI copy, or a new visual system. The control should feel like a compact sidebar filter, not a feature banner.

## Verification

Add or update focused tests for:

- session source bucket classification
- sidebar filtering by source
- workflow agent calls producing `platform: "workflow"`
- scheduled task agent calls still producing `platform: "scheduled"`

Run the relevant Agent and workflow tests plus the hard-constraints check.
