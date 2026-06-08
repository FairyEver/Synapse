# Agent Conversation Rollover Prompt Design

Date: 2026-06-08

## Context

A billing investigation showed a common high-cost pattern: a user keeps one Agent conversation open for many days, then asks unrelated follow-up questions in the same thread. Later turns continue carrying a large accumulated context and usage history, so short prompts can still produce high input and cache-read usage.

Synapse already stores assistant-message usage metadata, including cumulative cost and cumulative token usage. The Agent UI also has an existing usage card rendered after assistant messages. This feature adds a low-friction prompt after an expensive or very long conversation finishes a turn.

## Goals

- Warn users after a conversation becomes costly or very long.
- Let users start a fresh conversation with one click.
- Preserve the same project and model selection when starting the new conversation.
- Show the prompt only after an output completes, never while the Agent is streaming or busy.
- Keep the UI restrained and consistent with Synapse product design.

## Non-Goals

- Do not summarize or migrate the old conversation into the new one.
- Do not automatically send any message in the new conversation.
- Do not add a Settings page or user-configurable thresholds in this iteration.
- Do not change billing calculation, usage card pricing, or backend usage persistence.
- Do not show a global modal, destructive warning, or persistent composer banner.

## Chosen Approach

Use a hybrid trigger with cost as the primary signal:

- Show the prompt when cumulative estimated cost is at least CNY 10.
- If cumulative cost is unavailable, use cumulative token usage as a fallback and show the prompt at 5,000,000 total tokens.
- Total tokens are computed from the cumulative usage fields available on the assistant message metadata: input, output, cache read, cache creation, and reasoning when present.

The prompt appears after the latest completed assistant message, below the usage card. It is not attached to older messages, and it disappears as soon as a new turn starts because `sending` or streaming state means the current visible conversation is active again. After the next completed turn, if the same conversation still exceeds the threshold, the prompt appears again at the new end of the timeline.

## UI Design

The prompt is an inline action row in the Agent timeline, visually near the usage card but not nested inside it. It follows the Synapse `product` register and impeccable guidance:

- Use existing shadcn primitives, especially `Button`.
- Use lucide iconography inside the action button, such as `MessageSquarePlus`.
- Use token classes only, for example `bg-muted/60`, `border-border`, `text-foreground`, and `text-muted-foreground`.
- Do not use custom colors, red decorative lines, gradients, glow, shadows, or over-rounded surfaces.
- Do not create a card inside the existing usage card.
- Keep text short and operational.

Copy:

```text
这个对话已经很长
新对话会保留当前项目和模型。
开始新对话
```

The prompt should align with the assistant message width, respect the existing `max-w-[76ch]` message body, and stay readable in light and dark themes. The action button should be disabled while the new conversation is being created or while the current conversation is sending.

## Interaction

When the user clicks `开始新对话`:

1. Create a new Agent conversation.
2. Reuse the current session's `projectId`.
3. Reuse the current session's `providerId`.
4. Reuse the current session's `modelTier`.
5. Reuse the current session's permission `mode`, so the new conversation behaves like a manual new conversation in the same working context.
6. Switch the UI to the new conversation.
7. Leave the composer empty.

The old conversation remains unchanged and selectable in the sidebar.

## Architecture

Renderer-only changes are sufficient because all required metadata and create-session inputs already exist.

Suggested units:

- `desktop/src/modules/agent/utils/conversation-rollover.ts`
  - Owns thresholds and trigger calculation.
  - Accepts message metadata and returns whether a rollover prompt should be shown.
  - Keeps token extraction out of JSX.

- `desktop/src/modules/agent/components/agent-conversation-rollover-prompt.tsx`
  - Renders the inline prompt.
  - Receives `disabled` and `onStartNewConversation`.
  - Contains no threshold logic.

- `AgentTimeline`
  - Determines the latest visible completed assistant message.
  - Shows the prompt only after that latest message when the conversation is idle.
  - Avoids rendering prompts on historical assistant messages.

- `AgentModule`
  - Provides the `onStartNewConversation` handler.
  - Calls `chat.createSession(selectedSession.projectId, selectedSession.providerId, selectedSession.mode, selectedSession.modelTier)`.

This keeps business logic in a utility, rendering in a small component, and session creation in the existing Agent module path.

## Data Flow

1. Backend persists assistant message metadata with cumulative `totalCostCny` and `usage`.
2. Renderer receives the timeline item through the existing Agent timeline flow.
3. `AgentTimeline` inspects the latest displayed assistant message only.
4. The rollover utility evaluates the thresholds.
5. If the current conversation is idle and the latest assistant message qualifies, render the prompt after that message.
6. Clicking the button calls the existing create-session flow with the selected session context.

## Error Handling

- If there is no selected session, do not show the prompt.
- If `projectId` is missing, do not show the prompt.
- If create-session fails, rely on the existing `chat.createSession` error handling and toast behavior.
- If cost and usage are both missing, do not show the prompt.
- If the latest assistant message is still streaming, do not show the prompt.

## Testing

Add focused tests for:

- Cost threshold shows at CNY 10 and above.
- Cost below threshold does not show.
- Token fallback shows at 5,000,000 tokens only when cost is unavailable.
- Token fallback does not override a known low cost.
- Prompt does not render while `sending` is true or the latest assistant message is streaming.
- Prompt renders only for the latest completed assistant message.
- Clicking the button calls `createSession` with current project, provider, permission mode, and model tier.

## Release Note

Add a pending release note after implementation because this is user-visible behavior:

```text
Agent 长对话达到费用阈值后，会在本轮输出结束时提示开始新对话，并保留当前项目和模型，减少继续沿用超长上下文带来的额外费用。
```
