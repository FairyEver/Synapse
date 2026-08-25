# Agent Session Token Usage Display — Design

## Context

Agent conversation messages currently display the token usage attached to each SDK `result` event. That usage represents one completed assistant run: the work done for the current user turn, including input, output, cache read, and cache write tokens reported by the Claude Agent SDK.

The desired product behavior is different. In the Agent conversation, each completed assistant message should display the cumulative token usage for the current Synapse conversation up to that message.

Example:

- After turn 1, the assistant message shows turn 1 usage.
- After turn 2, the assistant message shows turn 1 plus turn 2 usage.
- After turn 3, the assistant message shows turns 1, 2, and 3 usage.

## Goals

- Show cumulative token usage in Agent conversation messages.
- Scope the cumulative total to the current Synapse conversation.
- Preserve the existing per-result raw usage ledger for aggregation, workflow, scheduler, and future analysis.
- Display cumulative usage as separated fields, not as one collapsed total number.
- Make the UI wording clear enough that users do not mistake the values for per-turn usage.

## Non-Goals

- Do not change workflow node result usage, scheduled task usage, Action result usage, or usage analysis reports.
- Do not change Claude SDK usage interpretation or pricing logic.
- Do not merge cache read tokens into regular input tokens.
- Do not add a second "current turn" display beside the cumulative total.
- Do not add new dependencies.

## Product Behavior

Agent assistant messages should show a compact usage summary like:

```text
累计 输入 12,345 输出 678 缓存读 90,000 缓存写 1,234 思考 567
```

The leading label `累计` means the following token fields are cumulative for the current conversation up to this assistant message.

Fields remain separated:

- `输入`: cumulative non-cache input tokens.
- `输出`: cumulative output tokens.
- `缓存读`: cumulative cache read input tokens.
- `缓存写`: cumulative cache creation input tokens.
- `思考`: cumulative reasoning or thinking tokens, only when available from usage metadata and after aggregation supports that field.

Cache read tokens are cumulative because each request may read cached context and that cache read is part of the request usage. Cache reads can grow quickly in long conversations because later turns may reuse a larger cached prefix. The UI must keep cache reads as their own field so users can distinguish "large cached context reused cheaply" from "large new input".

## Architecture

Keep the existing raw usage ledger:

- `agent.usage` stores each SDK result usage as one row.
- `recordSdkResultUsage()` continues to normalize and store the per-result usage summary.
- `getUsageSummary(conversationId)` remains the conversation-level aggregation mechanism.

The current normalized usage summary covers input, output, cache read, and cache write tokens. Implementation should extend the summary to include an optional reasoning/thinking token field when SDK usage contains fields such as `reasoning_output_tokens` or `reasoning_tokens`. The display should omit `思考` when the cumulative summary has no reasoning field, instead of showing a misleading zero.

Change the Agent conversation persistence path:

1. When a `result` event arrives, keep extracting raw usage from the SDK result event.
2. Record the raw result usage into `agent.usage`.
3. Query the cumulative conversation usage after recording the current result.
4. Store the cumulative summary in the assistant history entry metadata as `metadata.usage`.

This keeps renderer data flow mostly unchanged: the Agent message toolbar already reads `item.metadata?.usage`. The meaning of that field for Agent conversation assistant messages becomes "cumulative usage snapshot at this message".

## Data Flow

For a successful turn:

```text
SDK result usage
  -> recordSdkResultUsage(conversationId, turnId, result usage)
  -> getUsageSummary(conversationId)
  -> assistant history metadata.usage = cumulative summary
  -> renderer timeline item metadata.usage
  -> TokenUsageSummary renders "累计" plus separated fields
```

For an SDK error result that contains usage:

- Continue recording the usage in `agent.usage`.
- If an assistant history entry is created from partial output, use the same cumulative summary behavior.
- If no assistant message is created, the usage remains in the ledger but has no message-level display.

## UI

Use the recommended Agent conversation presentation: each completed assistant reply gets its own compact cumulative usage summary row below the assistant content. The row should feel like metadata attached to that reply, not a card, badge group, or page-level counter.

Recommended layout:

```text
累计 输入 12,345  输出 678  缓存读 90,000  缓存写 1,234  思考 567
```

Placement:

- Keep it below the assistant response body so it represents the cumulative snapshot at that turn.
- Keep the copy button available in the same footer area, but do not make token usage look like a hover-only toolbar detail.
- Do not move this cumulative billing display to the page header or composer. The header may separately show the SDK-reported current context occupancy, but it is a different metric and does not replace the per-turn historical snapshot.

Visual treatment:

- Use existing muted metadata styling, such as the current small muted text treatment.
- Do not use cards, nested cards, custom colors, gradients, shadows, or badge-like decorative containers.
- Let the row wrap naturally on narrow widths while keeping each label/value pair together.

The shared `TokenUsageSummary` component is used outside Agent conversations, so the cumulative wording should be opt-in.

Implementation shape:

- Add a small prop such as `prefix`.
- Agent conversation messages pass `prefix="累计"`.
- Workflow, scheduler, and Action result callers keep the current display without the cumulative label.

No custom colors, inline styles, or visual redesign are needed.

### Current context is a separate metric

The Agent header also shows the current main-thread context occupancy. It updates during streaming and can decrease after SDK compaction. The usage display below each reply remains the cumulative billing-token snapshot and never derives its values from the header. See `2026-08-25-agent-context-usage-header-design.md`.

## Testing

Add focused tests around the changed behavior:

- Conversation router test with two turns:
  - turn 1 assistant metadata usage equals turn 1 usage.
  - turn 2 assistant metadata usage equals turn 1 plus turn 2 usage.
  - raw `agent.usage` rows remain per-result, not cumulative.
- Deduplication test continues to prove aggregation deduplicates by SDK result UUID.
- Agent message toolbar or message event test verifies `累计` appears for Agent conversation usage.
- Token summary tests keep non-Agent callers without the prefix.

## Release Notes

This is user-visible and should update `RELEASE_NOTES_PENDING.md` during implementation:

```text
- Agent 对话里的 token 用量改为在回复底部显示当前会话截至该回复的累计分项统计，并用“累计”标明口径，避免误看成单轮消耗。
```
