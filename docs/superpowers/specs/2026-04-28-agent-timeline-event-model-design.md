# Agent Timeline Event Model Design

Date: 2026-04-28

## Goal

Synapse should render agent conversations in a way that feels close to official Codex and Claude Code clients while staying on Synapse's shadcn/Radix visual baseline.

The first implementation will build a unified timeline event model as the long-term display foundation. It must support Codex, Claude Code, and future agent runtimes without hardcoding provider-specific rendering logic throughout the renderer.

## Non-Goals

- Do not copy the exact visual skin of Codex or Claude Code.
- Do not migrate stored conversation history in place.
- Do not introduce a new styling system, custom colors, gradients, or page-specific UI primitives.
- Do not expose runtime-specific raw protocol payloads directly to renderer components.
- Do not redesign session management, provider configuration, or permission approval semantics.

## Current Context

The current renderer timeline uses `SynapseAgentTimelineEntry` with only:

- `role`
- `content`
- `timestamp`

Runtime events already contain richer structure, including `toolName`, `toolInput`, `toolInputRaw`, `status`, `exitCode`, `success`, `requestId`, and `metadata`. Some of that structure is preserved in stored history metadata, but `getTimeline` currently returns only role/content entries, so the renderer loses information needed for official-client-like tool display.

Agent definitions already share a base definition through each agent's `agent-shared.ts`. That is the right place to declare display strategy for Codex, Claude Code, and future agents.

## Design Summary

Implement three layers:

1. Canonical timeline event model.
2. History adapter that reads old history into the canonical model.
3. Agent display profiles declared on agent definitions.

The renderer consumes canonical timeline items and the selected agent's display profile. It should not need provider-specific branches for normal rendering.

## Canonical Timeline Model

Add a shared timeline item model in `desktop/src/types/agent.ts`.

The model should represent Synapse display facts, not raw Codex or Claude Code protocol records:

- user message
- assistant text
- system text
- thinking block
- tool call
- tool result
- permission request
- error
- turn result or completion metadata

Each item should have stable fields:

- `id`
- `kind`
- `timestamp`
- optional `agentType`
- optional `agentSessionId`
- optional `threadId`

Tool-related items should preserve structured fields:

- `toolName`
- `toolInput`
- `toolInputRaw`
- `content`
- `status`
- `exitCode`
- `success`
- `requestId`

The model can keep the existing `SynapseAgentEvent` runtime shape for live events. Runtime events are converted to canonical timeline items before rendering.

## History Adapter

`desktop/electron/modules/agent/ipc.ts` should make `getTimeline` return canonical timeline items instead of plain role/content entries.

Stored history remains backward-compatible:

- Existing `ConversationEntryV1.history` is not migrated.
- New event metadata should keep preserving `agentEventType`, `toolName`, `toolInputRaw`, `status`, `exitCode`, `success`, `requestId`, and related IDs.
- Old entries are adapted on read.

Adaptation rules:

- `metadata.agentEventType=toolUse` becomes a tool call item.
- `metadata.agentEventType=toolResult` becomes a tool result item.
- `metadata.agentEventType=thinking` becomes a thinking item.
- `metadata.agentEventType=permissionRequest` becomes a permission request item.
- `metadata.agentEventType=error` becomes an error item.
- Plain user/assistant/system/tool history becomes text-like fallback items.
- Old tool text such as `toolName\ninput` is displayed as legacy text if metadata is missing; do not guess complex structure.
- Result events should not duplicate an already-rendered assistant answer. Treat them as completion metadata when possible.

## Agent Display Profile

Extend `SynapseAgentBaseDefinition` with a `displayProfile`.

Profiles declare presentation policy only:

- label for the agent in the timeline
- tool name aliases
- default collapse behavior by tool category or tool name
- long input and output preview thresholds
- status labels for pending, running, success, error, and denied states
- whether thinking blocks default to collapsed
- unknown-tool fallback behavior

Codex and Claude Code profiles live in:

- `desktop/src/definitions/agent/codex/agent-shared.ts`
- `desktop/src/definitions/agent/claude-code/agent-shared.ts`

Future agents declare their own profile in their definition. If a profile is missing, the renderer uses a neutral default profile.

## Renderer Data Flow

`useAgentChat` should maintain canonical timeline items.

Flow:

1. Sending a local message appends a local user timeline item.
2. Live `SynapseAgentEvent` values are converted into canonical timeline items using the selected profile.
3. Text deltas still merge into the previous assistant text item when appropriate.
4. Tool calls and tool results remain separate structured items.
5. Refreshing a session replaces local timeline state with canonical items from `getTimeline`.

The hook should keep session selection, unread tracking, and permission refresh behavior unchanged.

## UI Behavior

The Agent page should feel like an execution timeline, not a bubble-only chat.

Messages:

- User messages may stay visually distinct.
- Assistant text should render as readable content blocks.
- System fallback text should be subdued and brief.

Thinking:

- Show a light running state while the agent is active.
- Render thinking content in a collapsible block.
- Empty thinking should not create noisy UI text.

Tools:

- Render a one-line summary with tool icon, tool label, status, and a short parameter preview.
- Expanded state shows input, output, exit code, status, and copy action.
- Long input/output is automatically collapsed by profile thresholds.
- Failed tool results default to expanded.
- Unknown tools use the default profile behavior.

Permissions:

- Keep the existing pending permission panel.
- Also render permission requests in the timeline so users can see why the agent is waiting.
- Pending permission events default to expanded.

Styling:

- Use existing shadcn components such as `Button`, `Badge`, `Collapsible`, `ScrollArea`, `Separator`, and `Tooltip`.
- Use theme token classes and Tailwind layout utilities only.
- Do not add custom colors, gradients, nested cards, or separate visual systems.

## Component Split

Keep `desktop/src/modules/agent/index.tsx` focused on orchestration.

Add or split module-local components under `desktop/src/modules/agent/components/`:

- `agent-timeline.tsx`: timeline list, empty state, and running indicator placement.
- `agent-timeline-item.tsx`: dispatches canonical item kinds.
- `agent-message-event.tsx`: user, assistant, and system text rendering.
- `agent-thinking-event.tsx`: thinking block.
- `agent-tool-event.tsx`: tool call, tool result, and permission request display.
- `agent-run-status.tsx`: active sending/running indicator.

Pure conversion helpers should live outside JSX-heavy files, likely in module utils or a focused timeline helper file.

## Error Handling

- Missing metadata must degrade to readable text.
- Unknown tool names must render with the default tool display.
- Oversized output should be collapsed or previewed without mutating stored content.
- Conversion functions should be pure and exhaustively typed.
- Renderer errors should use the existing renderer logger and brief user-facing error text.

## Testing

Add or update tests for:

- Converting live runtime events into canonical timeline items.
- Reading legacy role/content history into canonical items.
- Reconstructing tool call, tool result, thinking, permission, and error items from metadata.
- Text delta merging behavior.
- Profile-driven default collapse decisions.
- Tool result failure defaulting to expanded.
- Permission request timeline rendering.
- `getTimeline` IPC response schema returning canonical items.

Existing session, live sync, and sidebar behavior should not change except for type updates.

## Acceptance Criteria

- Codex and Claude Code conversations render through the same canonical timeline component set.
- Tool calls and tool results preserve structured display information in live and historical timelines.
- Codex and Claude Code each define a display profile in their agent definition.
- Missing or old metadata still produces readable timeline output.
- Long tool input/output collapses according to profile rules.
- Failed tool results and pending permissions are visible without extra clicks.
- The implementation uses the existing shadcn/Radix UI baseline and theme tokens.
- Existing hard-constraint, typecheck, and relevant agent tests pass.
