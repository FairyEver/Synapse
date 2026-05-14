# Agent Bypass Permission Startup Design

## Context

Claude Code `bypassPermissions` cannot be enabled on a live session unless that
session was launched with the dangerous skip-permissions startup capability.
Synapse currently exposes it in the same permission menu as runtime-switchable
modes, so a user can try to switch an existing conversation into
`bypassPermissions` and receive a raw SDK error.

The product needs to distinguish two decisions:

- Runtime permission switching for the current live conversation.
- Startup permission defaults for newly created Agent conversations.

## Goals

- Prevent raw SDK errors when users choose `bypassPermissions` from an active
  non-bypass conversation.
- Give users a clear path to start a new conversation with `bypassPermissions`.
- Add a global setting that makes new Agent conversations start in
  `bypassPermissions`.
- Keep existing conversations stable. Do not mutate or restart them because a
  global default changed.

## Non-Goals

- No automatic migration of current conversation context into the new
  `bypassPermissions` conversation.
- No project-level or repository-level override in the first version.
- No silent fallback from `bypassPermissions` to `default` if startup fails.
- No broader redesign of the Agent composer or settings page.

## Permission Mode Capability Model

Introduce a small renderer-side capability model for Agent permission modes.

Each mode resolves to one of these interaction capabilities for the selected
conversation:

- `switchable`: can be applied immediately through the existing runtime
  `setPermissionMode` flow.
- `confirmable`: can be applied immediately, but requires confirmation first.
- `requiresNewSession`: cannot be applied to the current live session and must
  start a new Agent conversation.

Initial mapping:

| Mode | Capability |
| --- | --- |
| `default` | `switchable` |
| `acceptEdits` | `switchable` |
| `plan` | `switchable` |
| `dontAsk` | `switchable` |
| `auto` | `confirmable` |
| `bypassPermissions` | `requiresNewSession` unless Synapse can prove the selected live session was launched with the dangerous skip-permissions capability |

The capability helper should stay separate from JSX event handlers so future
SDK-specific constraints can be added without spreading permission rules across
the UI.

If the selected conversation is already in `bypassPermissions`, selecting the
same mode is a no-op. If Synapse cannot determine whether the live session was
launched with the dangerous capability, treat `bypassPermissions` as
`requiresNewSession`.

## Conversation Menu Behavior

When the user chooses a runtime-switchable mode, Synapse keeps the existing
behavior and calls `bridge.agent.setPermissionMode`.

When the user chooses `auto`, Synapse keeps the existing confirmation flow.
If the SDK rejects it, show the existing renderer error path.

When the user chooses `bypassPermissions` from a non-bypass live conversation,
Synapse must not call `setPermissionMode`. It opens a confirmation dialog:

- Title: `需要新会话`
- Description: `跳过权限只能在会话启动时启用。`
- Secondary action: `取消`
- Primary action: `新建会话`

Confirming creates a new Agent conversation in the same project and starts it
with mode `bypassPermissions`. The old conversation remains unchanged.

## Global Default Setting

Add one global setting under Settings -> Agent:

- Label: `默认跳过权限`
- Description: `新建 Agent 对话时使用跳过权限模式。`
- Control: shadcn `Switch`

Turning the switch on opens a confirmation dialog:

- Title: `启用默认跳过权限`
- Description: `新建 Agent 对话将跳过工具权限确认。`
- Secondary action: `取消`
- Primary action: `启用`

Turning it off does not need confirmation.

The setting is global. It is not scoped by project, repository, provider, or
conversation.

## Default Resolution Rules

When Synapse creates a new Agent conversation:

1. If the caller explicitly supplies a permission mode, use it.
2. Otherwise, if the global `defaultBypassPermissions` setting is enabled, use
   `bypassPermissions`.
3. Otherwise, use the existing default mode.

Existing conversations keep their stored conversation-level mode. A later
global setting change does not rewrite them.

If creating a new conversation with `bypassPermissions` fails, surface the
failure. Do not retry with `default` unless the user explicitly starts another
conversation in a different mode.

## Persistence

Persist the new global setting in the existing app config store rather than a
module-local file.

Suggested config shape:

```ts
agent?: {
  defaultBypassPermissions?: boolean
}
```

Use normalization so missing config values behave as `false`.

## UI Constraints

Use existing shadcn primitives and current Synapse settings patterns:

- `Switch` for the global boolean.
- `AlertDialog` or existing dialog primitives for confirmations.
- Existing `Card`, `Button`, and settings row components where they already fit.

Do not add custom colors, custom styling systems, gradients, or page-level
visual treatment. Use concise product copy only.

## Error Handling

- Runtime `bypassPermissions` selection from an incompatible live session should
  be handled before IPC and should not produce a raw SDK error.
- Backend failures while creating the new bypass conversation should flow
  through the existing Agent error handling path.
- Settings save failures should show the existing settings error/toast pattern
  and leave the switch in the last confirmed persisted state.

## Testing

Add focused coverage for:

- Permission capability helper maps `bypassPermissions` to
  `requiresNewSession` for an incompatible live conversation.
- Selecting `bypassPermissions` from an incompatible live conversation opens the
  new-session dialog instead of calling `setPermissionMode`.
- Confirming the dialog creates a new Agent conversation with
  `bypassPermissions`.
- The global setting persists and is read when creating new Agent conversations.
- Explicit per-conversation or per-call modes override the global default.
- Existing conversations are not rewritten when the global setting changes.

## Open Decisions

None. The first version uses a global setting only.
