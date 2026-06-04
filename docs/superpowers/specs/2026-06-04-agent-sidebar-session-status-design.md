# Agent Sidebar Session Status Design

## Goal

Make the Agent conversation sidebar show the current session state more clearly:

1. A conversation that is still producing output shows a spinning loading icon.
2. A completed conversation with unread updates shows one small blue dot.
3. A completed and read conversation shows its relative update time.

Running state has priority over unread state. Numeric unread badges are removed.

## Scope

This is a renderer-only sidebar refinement for the Agent module.

In scope:

- User conversation groups.
- Archived conversation group.
- Existing unread and sending state wiring.
- Focused component tests for the new priority order and marker shape.

Out of scope:

- Persisting read receipts.
- Changing Electron conversation storage or IPC schemas.
- Changing timeline rendering.
- Changing Agent runtime busy-state ownership.
- Adding new colors outside theme tokens or Tailwind default palette.

## Current State

The sidebar already has the state needed for this change:

- `sendingConversationIds` in `useAgentChat` tracks conversations currently receiving live events.
- `unreadByConversationId` tracks inactive conversations that received `conversationUpdated`.
- `SessionTrailing` renders the right-side metadata for each sidebar row.
- `ProjectGroup` and `ArchivedGroup` already calculate each session's unread count and pass it to `SessionTrailing`.

The current UI displays numeric unread badges. It does not give running sessions their own sidebar indicator.

## Design

### Status Priority

Each session row derives a single trailing status:

1. `running` when `sendingConversationIds.has(session.id)` is true.
2. `unread` when not running and `unreadByConversationId[projectId:conversationId] > 0`.
3. `idle` when not running and not unread.

Only one of these is visible at a time.

### Visual Behavior

Running:

- Show a `LoaderCircle` icon with `animate-spin`.
- Hide relative time while running.
- Hide unread marker while running.
- Keep the delete button behavior unchanged on row hover.

Unread:

- Show one small blue dot.
- Do not show unread counts.
- Include an accessible label such as `未读`.
- Hide relative time while unread, so the dot remains the clear signal.

Idle:

- Show the current relative time behavior.
- Continue hiding the time on hover when the delete button appears.

The dot should use a Tailwind default blue utility or an approved existing token. No hex, rgb, hsl, arbitrary color values, gradients, or custom CSS are introduced.

### Data Flow

`AgentModule` already receives `chat.sendingConversationIds` from `useAgentChat`. Pass this set to `AgentSessionSidebar`.

`AgentSessionSidebar` passes the set to `ProjectGroup` and `ArchivedGroup`.

Each group computes:

```ts
const running = sendingConversationIds.has(session.id)
const unread = unreadByConversationId[conversationUnreadKey(session.projectId, session.id)] ?? 0
```

Then it passes both values into `SessionTrailing`.

`SessionTrailing` becomes responsible for the local display priority:

```ts
if (running) render spinner
else if (unread > 0) render unread dot
else render relative time
```

This keeps behavior close to the existing component boundary and avoids pushing display decisions into every group.

## Error Handling

Malformed timestamps continue to render nothing for idle relative time.

If a running or unread session has a malformed timestamp, the running spinner or unread dot still renders because those states do not depend on timestamp parsing.

## Testing

Add or update focused Vitest tests:

- `SessionTrailing` renders a spinner when `running` is true.
- Running state hides unread marker and relative time.
- Unread state renders a dot and does not render numeric unread text.
- Idle state still renders relative time for valid timestamps.
- `ProjectGroup` or `AgentSessionSidebar` passes running state from `sendingConversationIds`.

Existing tests for malformed timestamps and long title truncation should continue to pass.

## Acceptance Criteria

- Running conversations show a spinning loading icon in the sidebar.
- Running conversations do not show unread dots or time while running.
- Completed unread conversations show one blue dot.
- Numeric unread badges are gone.
- Completed read conversations still show relative time.
- Archived sessions follow the same status rules.
- No backend model, IPC schema, storage, or runtime changes are required.
