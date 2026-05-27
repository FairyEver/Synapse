# CC Conversation Query Design

## Status

Approved brainstorming direction on 2026-05-27.

This design adds a conversation query surface to Claude Code usage analysis. The feature must let users find sessions from the CC analysis area, then open a separate window that reads and displays the complete Claude Code raw transcript on demand.

## Goals

- Add a new `对话` secondary tab inside the existing CC usage analysis module.
- Let users browse Claude Code sessions by project, time, model, tool, token usage, and report context.
- Let existing CC report rows open or prefilter related raw conversations.
- Display every available Claude Code raw event field in a productized UI.
- Read raw Claude Code JSONL only when the user opens a conversation, jumps from a report, or explicitly enables full-text raw search.
- Avoid importing or duplicating full raw transcript content into `usage.db`.
- Keep the main CC tab fast and uncluttered by moving heavy transcript reading into a separate detail window.

## Non-Goals

- Do not redesign the existing CC overview, time, model, project, tool, or Codex analysis pages.
- Do not pre-ingest all conversation text into Synapse SQLite.
- Do not add a separate visual system, custom colors, gradients, or custom primitives.
- Do not expose filesystem access to renderer code.
- Do not build a general file browser for `~/.claude`.
- Do not hide raw event categories because they are internal-looking. The detail window should show them in a readable way.

## Data Inspection Summary

Local Claude Code data has two relevant layers.

The existing Synapse `usage.db` already contains the report index:

- `cc_scan_files`: about 42k scanned files on the inspected machine.
- `cc_sessions`: about 41k sessions.
- `cc_usage_events`: about 221k usage events.
- `cc_tool_events`: about 145k tool events.
- `cc_daily_usage` and `cc_hourly_usage`: aggregate report rows.

This database does not store complete user prompts, assistant text, thinking text, tool input payloads, or tool output payloads.

The complete raw data is in Claude Code JSONL files under `~/.claude/projects/**/<sessionId>.jsonl`. The inspected data includes these event types:

- `user`
- `assistant`
- `attachment`
- `system`
- `queue-operation`
- `last-prompt`
- `ai-title`
- `permission-mode`
- `file-history-snapshot`

Assistant and user message blocks include:

- `text`
- `thinking`
- `tool_use`
- `tool_result`
- plain string content

Raw events can also contain metadata such as `uuid`, `parentUuid`, `sessionId`, `cwd`, `gitBranch`, `version`, `userType`, `promptId`, `agentId`, `entrypoint`, `isSidechain`, `sourceToolAssistantUUID`, `message.usage`, `message.model`, `message.stop_reason`, `toolUseResult`, and attachment payloads.

## Chosen Approach

Use a light index with on-demand raw reads.

The main `对话` tab queries `usage.db` for fast session list and filters. It does not load transcript bodies. When the user opens a session, the main process reads that one JSONL file, parses it line by line, and returns the complete event stream to a dedicated conversation detail window.

Full-text raw search is opt-in. By default, the search box searches only indexed metadata. When the user enables raw text search, the main process scans raw JSONL files within the active filter range and returns matching sessions and matching event references.

This keeps the normal workflow fast, preserves the user's requirement that data is queried when clicked, and avoids copying gigabytes of raw transcripts into Synapse state.

## Product Structure

Add `对话` to the CC usage analysis secondary tabs:

```text
今日 / 概览 / 时间 / 模型 / 项目 / 工具 / 对话
```

The `对话` tab is the session-finding surface. It should contain only controls and result rows needed to locate conversations and open the detail window.

The heavy transcript experience lives in a separate Electron window. The window opens from:

- the `对话` tab session row;
- raw search hit rows;
- CC detail rows when a row has a concrete `sessionId`;
- CC tool event rows when a row has a concrete `sessionId`;
- aggregate CC `项目`, `模型`, `时间`, and `工具` report rows through prefilled `对话` tab filters.

## Main Tab Design

The main `对话` tab should provide:

- A search input.
- A raw text search toggle.
- Time range filter.
- Project filter.
- Model filter.
- Tool filter.
- Event type filter.
- Paginated session table.
- Per-row `打开对话` action.

Default search scope:

- session id;
- title from `ai-title` when available;
- fallback title from `last-prompt` or first user text summary;
- project path;
- model;
- tool names.

Raw text search scope, only when enabled:

- user message text;
- assistant text;
- thinking text;
- tool input;
- tool result;
- attachment payloads and metadata;
- system and queue event content;
- raw JSON fields when representable as text.

Session table columns should include:

- Title.
- Project.
- Started and ended time.
- Model summary.
- Tokens.
- Estimated cost.
- Tool call count.
- Event count.
- Attachment count.
- Last activity time.
- Open action.

The main tab should not render full transcript content inline. It may show short title and hit snippets when raw search is enabled.

## Conversation Detail Window

The detail window reads a single session JSONL file on open.

Window layout:

- Header: title, project, time range, model summary, token total, estimated cost, tool count, source file path.
- Left rail: event outline and type filters.
- Center pane: chronological full event stream.
- Right pane: selected event inspector.

The event stream must include all event categories found in the raw file:

- `user`
- `assistant`
- `attachment`
- `system`
- `queue-operation`
- `last-prompt`
- `ai-title`
- `permission-mode`
- `file-history-snapshot`
- unknown future event types

Rendering rules:

- User events show the original user content, `cwd`, `gitBranch`, `uuid`, `parentUuid`, and attachment links when present.
- Assistant events show text, thinking, tool use blocks, `usage`, `model`, `stop_reason`, `uuid`, and parent relationship.
- Tool use blocks show tool name, tool id, and full input payload.
- Tool result blocks show result content, error state, and related tool use id.
- Top-level `toolUseResult` objects show stdout, stderr, filenames, patch information, file paths, and all other available fields.
- Attachment events show attachment metadata and payload fields.
- System, queue, permission, title, last prompt, and file snapshot events show concise labels plus full raw fields in the inspector.
- Unknown event types show their type, timestamp if present, and full raw JSON.

Long content can be collapsed by default to keep the UI usable, but it must be expandable without data loss. Collapsing is a presentation choice, not a redaction.

Window actions:

- Search within the loaded conversation.
- Jump to a focused event or timestamp.
- Copy message text.
- Copy raw event JSON.
- Copy session id.
- Copy source file path.

## Report Linkage

Report linkage should avoid string guessing.

Extend report rows and bridge types where needed so UI actions can pass stable focus data:

- `sessionId`
- usage event id where available
- tool event id where available
- timestamp or timestamp range
- model
- workspace key
- tool name

Expected interactions:

- From `明细`, open the detail window and focus the corresponding usage event or nearest raw assistant event.
- From an aggregate `工具` row, filter the `对话` tab by tool name.
- From a concrete tool event row, open the detail window focused on the related tool event.
- From `项目`, open the `对话` tab with the project filter applied.
- From `模型`, open the `对话` tab with the model filter applied.
- From `时间`, open the `对话` tab with the time range applied.

If a focus id cannot be mapped to a raw JSONL event, the detail window should open the session and focus the nearest timestamp match.

## Main Process Architecture

Keep all privileged work in Electron main process code under the usage-analysis boundary.

Proposed service boundary:

```text
desktop/electron/services/usage-analysis/cc-conversation-service.ts
```

Responsibilities:

- Query session indexes from `usage.db`.
- Resolve a session id to its JSONL file path.
- Parse one conversation JSONL file on demand.
- Search raw transcript text within an indexed filter range.
- Return typed, renderer-safe data.
- Surface parse and file errors explicitly.

Proposed IPC channels:

```text
synapse:usage-analysis:cc:conversations:list
synapse:usage-analysis:cc:conversation:get
synapse:usage-analysis:cc:conversation:search-text
synapse:usage-analysis:cc:conversation-window:open
```

IPC registration must continue to use the existing validated IPC helper. Do not introduce direct `ipcMain.handle` calls outside the allowed runtime IPC layer.

Renderer code should access this through `window.synapse.usageAnalysis.cc.*` bridge methods only.

## Data Shapes

Suggested shared types:

```ts
type CcConversationListInput = {
  preset: UsageAnalysisRangePreset
  query?: string
  rawText?: boolean
  project?: string
  model?: string
  tool?: string
  eventType?: string
  limit?: number
  offset?: number
}

type CcConversationListItem = {
  sessionId: string
  title: string
  workspaceKey: string
  workspaceLabel: string
  startedAt: string
  endedAt: string
  modelSummary: string
  tokens: number
  estimatedCost: number
  toolCalls: number
  eventCount: number
  attachmentCount: number
  lastUsedAt: string
  sourceFilePath: string
  matchSnippets?: readonly CcConversationMatchSnippet[]
}

type CcConversationFocus = {
  eventId?: string
  usageEventId?: string
  toolEventId?: string
  timestampMs?: number
}

type CcConversationDetail = {
  session: CcConversationListItem
  events: readonly CcRawConversationEvent[]
  parseErrors: readonly CcConversationParseError[]
}
```

`CcRawConversationEvent` should preserve all raw fields in a `raw` property while also exposing common normalized fields for UI rendering:

- `id`
- `type`
- `timestamp`
- `timestampMs`
- `uuid`
- `parentUuid`
- `role`
- `model`
- `contentBlocks`
- `usage`
- `toolName`
- `toolUseId`
- `raw`

Avoid `any` in exported types. Use `Record<string, unknown>` for raw objects.

## Parsing Rules

The conversation parser is a read-only transcript parser, separate from the usage parser.

Rules:

- Read JSONL line by line with Node streams or bounded buffered reads.
- Preserve line order.
- Generate a stable event id from `uuid` when present, otherwise from session id and line number or byte offset.
- Keep malformed JSON lines as parse error entries tied to line number or byte offset.
- Preserve unknown future event types.
- Do not mutate usage tables while reading conversations.
- Do not write raw content into `usage.db`.

For the first implementation, `getConversation` should return the full parsed event list for one session when the source file is below a fixed main-process threshold. If the file exceeds that threshold, the service returns the session header, event index, first event chunk, and a `hasMore` marker. A follow-up chunk API must then allow the detail window to load the rest of the events without losing access to complete content.

## Raw Text Search

Raw text search must be opt-in.

Default search uses indexed metadata only. When raw text is enabled:

- The search uses the active filters to limit candidate sessions before reading files.
- The service scans candidate JSONL files line by line.
- The result returns matching sessions and event references.
- Large content snippets should be bounded.
- The user can open a matching conversation directly focused on the event.

Raw text search returns paginated batches. If the active filter range is broad, the UI still starts the search, but the service must enforce a per-request candidate and elapsed-time limit and return a continuation cursor for the next batch. The renderer must never block while a broad raw search runs.

## UI Rules

Use the existing Synapse UI baseline:

- shadcn/ui + Radix primitives.
- `desktop/components.json` radix-nova preset.
- existing tokens from `desktop/src/styles/globals.css`.
- existing `desktop/src/components/ui/` components.
- Tailwind only for layout, spacing, overflow, sizing, and token-based typography.

Do not use:

- inline styles except unavoidable runtime sizing values;
- custom hex/rgb/hsl colors;
- arbitrary Tailwind colors;
- gradients, glow, decorative emoji, or marketing copy;
- nested cards for visual hierarchy.

Product copy should be minimal:

- labels;
- table headers;
- short empty states;
- short errors;
- direct action names.

Do not add explanatory paragraphs inside the UI.

## Error Handling

Handle these cases explicitly:

- Source JSONL file no longer exists.
- Source file cannot be read.
- Some lines fail JSON parsing.
- Session exists in raw files but not in `usage.db`.
- Session exists in `usage.db` but raw file is missing.
- Focus event cannot be found.
- Raw text search exceeds time or result limits.

Renderer errors should be short and actionable. Main process logs should include enough context through the existing logger pattern, without dumping full transcript content into logs.

## Performance

- Main tab list queries must be paginated.
- Main tab metadata search should use indexed `usage.db` columns first, then fall back to bounded joins for derived fields such as tool names and title snippets.
- Opening a detail window reads only one JSONL file.
- Raw text search first narrows candidate sessions using index filters.
- Avoid rendering thousands of full event DOM nodes at once; use bounded rendering or virtualization if needed.
- Long blocks should be collapsed by default and expandable.
- Do not add new dependencies unless implementation proves the existing stack cannot render or search acceptably.

## Tests

Main process tests:

- Parses all observed event types.
- Preserves unknown event types.
- Keeps malformed JSON lines as parse errors.
- Resolves sessions to raw files.
- Lists conversations with project, model, tool, and date filters.
- Searches indexed metadata.
- Searches raw text only when requested.
- Maps report focus data to raw conversation events or nearest timestamp.
- Handles missing files.

IPC tests:

- Normalizes list/search inputs.
- Rejects invalid pagination.
- Returns explicit errors for missing sessions and unreadable files.

Renderer tests:

- CC shell includes `对话`.
- Conversation tab renders filters and paginated rows.
- Raw text toggle changes search mode.
- Open action calls the bridge with session id and focus data.
- Detail window renders header, event outline, event stream, and inspector.
- Long content is collapsed and expandable.

Regression tests:

- Existing CC and Codex usage reports still render.
- Existing refresh path and pricing rules behavior remain unchanged.

## Implementation Notes

This is a user-visible feature. The implementation PR should update `RELEASE_NOTES_PENDING.md`.

The design itself does not change product behavior and does not require release notes.
