# Agent Permission Mode Design

## Context

Synapse is migrating agent conversations to the Claude Agent SDK. The SDK supports runtime permission modes through the `permissionMode` option at session startup and `query.setPermissionMode(mode)` in streaming input mode.

The current Synapse Claude Code agent definition already lists the SDK modes, and `ClaudeSDKSession` maps the startup mode into SDK query options. Runtime switching is not yet wired: `/mode <mode>` currently reports that switching is unavailable.

## Goals

- Let users choose a Claude Code permission mode at the agent conversation level.
- Show all six SDK modes in the UI: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, and `bypassPermissions`.
- Use the SDK as the source of truth for actual runtime mode behavior.
- Add Synapse-side confirmation before switching to high-risk modes.
- Persist the selected mode on the conversation so refresh, session switching, and future turns keep the same mode.
- Keep UI copy short and product-facing.

## Non-Goals

- Do not implement a custom permission classifier in Synapse.
- Do not replace SDK `canUseTool` approval behavior.
- Do not add a separate global permission settings page for this feature.
- Do not rebuild the agent session merely to switch modes when SDK runtime switching is available.
- Do not change provider, model, or tool allowlist behavior beyond what is needed for mode switching.

## SDK Permission Modes

The TypeScript SDK exposes these permission modes:

| Mode | Meaning |
| --- | --- |
| `default` | Standard permission behavior. Unapproved tools can prompt through the permission callback. |
| `acceptEdits` | Auto-accept file edits and related file operations. |
| `plan` | Planning mode with read-only tools. |
| `auto` | TypeScript SDK mode that uses a model classifier to approve or deny each tool call. |
| `dontAsk` | Do not prompt; deny tools that are not pre-approved. |
| `bypassPermissions` | Bypass permission checks. Requires `allowDangerouslySkipPermissions: true` at query startup. |

Runtime switching should use `query.setPermissionMode(mode)` when a live streaming SDK query exists.

References:

- Claude Code permission modes: https://code.claude.com/docs/en/permission-modes
- Agent SDK permissions: https://code.claude.com/docs/en/agent-sdk/permissions
- TypeScript SDK `PermissionMode` and `setPermissionMode`: https://code.claude.com/docs/en/agent-sdk/typescript

## Product Behavior

Each conversation has one current permission mode. New conversations default to `default`.

The agent composer exposes a compact permission mode selector in the composer control row, immediately before the send or stop button. The selector lists all six modes. Selecting `default`, `acceptEdits`, `plan`, or `dontAsk` switches immediately.

Selecting `auto` or `bypassPermissions` opens a confirmation dialog before the switch:

- `auto`: "将由模型自动判断工具权限。"
- `bypassPermissions`: "将跳过工具权限确认。"
- Actions: `取消` and `继续切换`

The `bypassPermissions` confirmation action should use the existing destructive button variant. No custom colors or custom styling are needed.

If the SDK rejects the switch, the previous mode remains selected and the user sees a short failure message.

## State Model

Store the selected mode on the existing conversation record:

```ts
conversation.agentConfig.mode
```

No new table or standalone preference is needed.

Session summaries should expose `mode?: ClaudePermissionMode` from `conversation.agentConfig.mode` so the renderer can display the current mode without a second fetch. If an older conversation has no mode, treat it as `default`.

## Main Process Flow

Add a service method equivalent to:

```ts
setPermissionMode(input: {
  projectId: string
  conversationId: string
  mode: ClaudePermissionMode
  actor: ActorIdentity
}): Promise<ConversationEntryV1>
```

Behavior:

1. Validate that `mode` is one of the six SDK modes.
2. Load the conversation.
3. If a live session exists and supports `setPermissionMode`, call it.
4. If no live session exists, only persist `agentConfig.mode`; the next message starts the SDK query with this mode.
5. If a live session exists but does not support runtime switching, fail with a clear error.
6. Persist `conversation.agentConfig.mode` only after the live SDK switch succeeds.
7. Emit the normal conversation updated event after persistence.

For `bypassPermissions`, startup still needs `allowDangerouslySkipPermissions: true` when the mode is used to create a query. Runtime switching uses SDK `setPermissionMode("bypassPermissions")`; if the SDK requires extra handling, surface the SDK error instead of pretending the mode changed.

## SDK Session Changes

Extend the SDK session boundary:

- `QueryLike.setPermissionMode?(mode: PermissionMode): Promise<void>`
- `LazyQuery.setPermissionMode(mode)` forwards to SDK `query.setPermissionMode(mode)`
- `AgentLiveSession.setPermissionMode?(mode: string): Promise<void>`
- `ClaudeSDKSession.setPermissionMode(mode)` validates mode and calls the live query

Keep `parsePermissionMode` as the single local validator for SDK mode strings.

## IPC And Renderer Flow

Add an IPC method:

```ts
agent.setPermissionMode({
  projectId,
  conversationId,
  mode,
})
```

The schema should reject unknown modes before reaching the service. The renderer bridge type should expose the same narrow union.

Renderer flow:

1. User selects a mode.
2. If mode is `auto` or `bypassPermissions`, show confirmation.
3. On confirm, call `bridge.agent.setPermissionMode`.
4. On success, use the returned session summary as the selected session state.
5. On failure, keep the old mode and show `切换失败`.

The UI should use existing shadcn primitives: `DropdownMenu` for the selector and `Dialog` for confirmation. Styling must stay on the current Radix Nova baseline and use theme tokens only.

## Slash Command Behavior

`/mode` continues to list all available modes and marks the current mode.

`/mode <mode>` should use the same main-process switch method for normal modes.

For `auto` and `bypassPermissions`, the command should not silently switch without confirmation. It should return a short message that asks the user to use the selector confirmation path. This keeps the dangerous-mode confirmation explicit and avoids inventing a second command-line confirmation protocol.

## Error Handling

- Invalid mode: reject at IPC schema or command parsing.
- No conversation: return the existing session lookup error style.
- No live session: persist the mode for the next turn.
- Live session lacks `setPermissionMode`: fail with `当前会话不支持切换权限模式`.
- SDK failure: sanitize the error text and show it as the switch failure detail.
- Failed switch must not update persisted state or renderer-selected state.

## Audit And Permissions

Changing permission mode is a sensitive agent operation. The service should record the actor and the mode transition through existing structured logging or audit facilities if a suitable action already exists. Do not add a broad new security subsystem for this feature.

`bypassPermissions` is still protected by UI confirmation, but the SDK and managed policy remain authoritative. Synapse must not bypass managed policy or lower-level SDK restrictions.

## Tests

Add focused coverage:

- `ClaudeSDKSession` forwards `setPermissionMode` to the SDK query.
- `ClaudeSDKSession` rejects invalid modes.
- Query startup still maps `bypassPermissions` to `allowDangerouslySkipPermissions: true`.
- Agent runtime service persists mode when no live session exists.
- Agent runtime service calls live `setPermissionMode` before persisting when a live session exists.
- Agent runtime service does not persist on SDK failure.
- IPC schema accepts only the six supported modes.
- `/mode` lists the current mode and switches normal modes.
- `/mode auto` and `/mode bypassPermissions` return confirmation-path guidance.
- Renderer selector lists all six modes.
- Renderer shows confirmation for `auto` and `bypassPermissions`.
- Renderer rolls back on switch failure.
