# Feishu Agent Live Sync Design

## Goal

Make Feishu-origin Agent conversations appear live in the desktop Agent page.

The Agent page should treat Feishu conversations as first-class conversations:

- Feishu messages appear in the session list as soon as they enter Synapse.
- The selected conversation updates live.
- Non-selected Feishu conversations do not interrupt the user; they show unread state.
- A `跟随飞书` control lets the user opt in to automatic switching when Feishu conversations update.

## Product Design

The Agent page remains the single place to inspect Agent conversations across local and Feishu channels. This feature should not create a separate Feishu inbox or a parallel transcript view.

Default behavior is conservative:

1. Feishu sends a message to Agent.
2. The matching conversation appears or moves up in the left session list.
3. If the user is already viewing that conversation, the right timeline updates live.
4. If the user is viewing another conversation, the current timeline stays unchanged and the Feishu conversation receives an unread marker.
5. Selecting the Feishu conversation clears its unread marker and loads the full timeline.

Opt-in behavior:

1. The user enables `跟随飞书`.
2. New Feishu conversation updates automatically switch the Agent page to the updated Feishu conversation.
3. If the local input has unsent text, automatic switching is suppressed to avoid disrupting the user.

## UX And UE

### Session List

The left session list remains the primary navigation surface.

Each conversation row should continue to show:

- session label
- last updated time
- delete action

For this feature it also needs:

- a compact unread badge for non-selected conversations
- enough metadata to distinguish Feishu conversations by name when available

Unread behavior:

- Increment or set unread state when a non-selected conversation receives an update.
- Clear unread state when the user selects the conversation.
- Do not count updates for the currently selected conversation as unread.

### Follow Feishu Control

Add one control near the session toolbar area:

- label: `跟随飞书`
- behavior: toggle on/off

Use existing shadcn/Radix UI primitives and existing tokens. Do not introduce custom colors, inline styles, gradients, or a new visual system.

The label is intentionally short. No helper paragraph is needed.

### Timeline

The selected conversation timeline updates live from existing Agent event streaming:

- user message appears after backend writes it to history and emits `conversationUpdated`
- Agent text/tool/permission/result events append as they arrive
- final `conversationUpdated` refreshes the persisted snapshot

For non-selected conversations, the timeline does not change.

### Focus Protection

When `跟随飞书` is enabled, auto-switching should not happen if the local input box contains unsent text.

This prevents losing context while typing locally.

## Architecture

Keep the current shared Agent event model.

Do not create Feishu-specific renderer IPC channels.

The flow should be:

```text
Feishu message
  -> FeishuConnectorService
  -> AgentRuntimeService.send
  -> AgentSessionRepository history
  -> EventBus conversationUpdated / AgentEvent stream
  -> Renderer agent.onEvent
  -> Agent page session list / timeline / unread state
```

## Backend Design

### Immediate User Message Update

`AgentRuntimeService.processTurn()` already appends the incoming user message to conversation history before running the adapter.

After this append, emit `conversationUpdated` immediately.

This lets the desktop UI show the Feishu user message without waiting for the agent to complete.

The assistant result path remains unchanged:

- streaming events are emitted through `emitEvent`
- final assistant text is persisted by `saveExecutionResult`
- `saveExecutionResult` emits `conversationUpdated`

### Conversation Metadata

Existing Feishu metadata should continue to be carried by `AgentMessage`:

- `platform: "feishu"`
- `sessionKey`
- `channelKey`
- `channelName`
- `userName`
- `chatName`
- `chatType`
- workspace fields when bound

Session summaries should expose enough existing fields for the UI to identify Feishu conversations. If the current summary shape is insufficient, add only narrow fields already persisted on `ConversationEntryV1`, such as `channelName` or user metadata.

## Renderer Design

### Hook State

Extend `useAgentChat` with local renderer state:

- `followFeishu: boolean`
- `setFollowFeishu(next: boolean): void`
- `unreadByConversationId: Record<string, number>`
- input draft state or input-dirty signal, if not already available at hook level

The hook should remain the single owner of Agent page live-sync behavior.

### Event Handling

Current behavior filters out `conversationUpdated` for non-selected conversations. Replace that with:

1. Ignore events for other projects.
2. For every matching-project `conversationUpdated`, refresh sessions and pending permissions.
3. If the updated conversation is selected, refresh its timeline.
4. If it is not selected, update unread state.
5. If `followFeishu` is enabled, the update is from `platform === "feishu"`, and the input is not dirty, select that conversation and load its timeline.

For stream events (`text`, `thinking`, `toolUse`, `toolResult`, `permissionRequest`, `result`, `error`):

- append only when the event belongs to the selected conversation
- refresh pending permissions as today
- do not append stream events from non-selected conversations to the visible timeline

### Session Selection

When the user selects a conversation:

- set `selectedConversationId`
- set `selectedSessionKey`
- clear unread state for that conversation
- call existing timeline load by conversation id

Manual selection always wins over follow mode until another Feishu update arrives.

## UI Implementation Scope

Files likely involved:

- `desktop/src/modules/agent/hooks/use-agent-chat.ts`
- `desktop/src/modules/agent/index.tsx`
- `desktop/src/modules/agent/components/agent-session-sidebar.tsx`
- `desktop/src/types/agent.ts`
- `desktop/electron/modules/agent/ipc.ts`
- `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- related tests

Expected UI additions:

- one `跟随飞书` toggle/control in the session sidebar header or toolbar
- unread badge in session rows

No page redesign, no new color palette, no card nesting changes, no marketing copy.

## Data Model

Unread counts and follow state are renderer-local for this implementation.

They do not need persistence in Phase 1 because:

- unread only describes what the current desktop window has seen
- follow mode is a local interaction preference
- persisting either can be added later without changing backend conversation history

If persistence is later required, use the existing settings/config path rather than storing UI-only state in conversation history.

## Error Handling

Event refresh failures should:

- log through the existing renderer logger
- set the existing Agent page error state
- avoid clearing the current timeline

If auto-follow selection fails:

- keep the current selection
- keep the unread marker on the target conversation
- expose the same concise error path used by existing session switching

Backend `conversationUpdated` emission should stay best-effort through the existing event bus and must not block the agent turn.

## Testing

### Backend Tests

Add or update `agent-runtime-service` coverage:

- appending a user message emits `conversationUpdated` before the assistant result is saved
- Feishu-origin messages preserve `platform` and `sessionKey` in emitted payloads
- existing assistant-result persistence still emits the final `conversationUpdated`

### Renderer Tests

Add focused hook/util tests where current test harness allows:

- non-selected `conversationUpdated` refreshes sessions and records unread without replacing the current timeline
- selected `conversationUpdated` refreshes the current timeline
- selecting a session clears unread state
- `followFeishu` auto-selects Feishu updates when input is clean
- `followFeishu` does not auto-select when input is dirty
- stream events for non-selected conversations are ignored by the visible timeline

### UI Tests

Add component coverage for:

- `跟随飞书` control renders and toggles state
- unread marker renders for sessions with unread count
- no custom styles or hard-coded colors are introduced

## Non-Goals

- No separate Feishu inbox.
- No Feishu-specific Agent transcript backend.
- No new IPC event channel for Feishu conversations.
- No automatic switching when `跟随飞书` is off.
- No auto-switch while the local input has unsent text.
- No persistence for unread or follow state in this implementation.
- No UI restyle beyond the required toggle and unread marker.

## Acceptance Criteria

1. Feishu messages appear in the Agent session list immediately after receipt.
2. Current selected Feishu conversation updates live, including user message and Agent progress.
3. Non-selected Feishu conversations show unread state without changing the right timeline.
4. Selecting a conversation clears its unread state.
5. `跟随飞书` auto-selects updated Feishu conversations only when enabled and the local input is clean.
6. Existing local Agent conversations continue to work.
7. Feishu permission requests and Agent tool progress continue using the shared Agent event path.
8. Typecheck, hard-constraint checks, targeted tests, and desktop tests pass.

## Self-Review

- Placeholder scan: no unresolved markers remain.
- Internal consistency: product behavior, event flow, and UI state all use the same shared Agent conversation model.
- Scope check: this is a single Agent page live-sync feature, not a Feishu inbox rewrite.
- Ambiguity check: auto-follow, unread clearing, input-dirty suppression, and persistence boundaries are explicit.
