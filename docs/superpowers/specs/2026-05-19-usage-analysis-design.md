# Usage Analysis Design

## Status

Approved design direction from brainstorming. This spec defines a new usage analysis feature that coexists with the current `token-usage` module. The old `用量` tab remains unchanged.

## Goals

- Add two new top-level app tabs: `CC` and `Codex`.
- Build a new usage analysis module from scratch instead of extending the existing `desktop/src/modules/token-usage` UI.
- Store new analysis data in a new `usage.db` database.
- Keep Claude Code and Codex data logically independent through table prefixes:
  - `cc_*` for Claude Code
  - `cx_*` for Codex
- Make token consumption, estimated cost, time trends, type breakdowns, models, projects, tools, and drill-down details the core product experience.
- Avoid showing or storing conversation text in report-facing tables. The feature should analyze usage metadata and numeric metrics, not expose prompt or assistant content.

## Non-Goals

- Do not modify or remove the existing `用量` tab or `token-usage` service.
- Do not build a cross-tool comparison page in the first version.
- Do not make subagent analysis a first-class view. Users care more about token and cost consumption.
- Do not claim estimated cost is the user’s actual bill.
- Do not add new visual styling systems, custom colors, gradients, or custom primitives.

## Existing Context

The current repository already has a `token-usage` service and UI. It scans many clients and normalizes them into shared daily/hourly usage tables. This is useful as a reference for parsing, fingerprinting, and aggregation, but the new feature should not inherit its product shape.

The local data inspection showed:

- Claude Code data has strong support for request-level usage, cache read/write, 5-minute and 1-hour cache creation fields, model distribution, project paths, content block types, and tool calls.
- Codex data has strong support for `token_count`, model/provider/workspace/source/session metadata, function/tool calls, command results, patch events, web search events, task duration, and time-to-first-token.

Pricing categories should follow public provider concepts:

- Claude Code / Anthropic style usage:
  - input tokens
  - output tokens
  - cache read tokens
  - cache creation tokens
  - 5-minute cache creation tokens
  - 1-hour cache creation tokens
  - thinking tokens when present, displayed as usage and charged as output where applicable
- Codex / OpenAI style usage:
  - input tokens
  - cached input tokens
  - output tokens
  - reasoning output tokens, displayed separately and treated as output-cost usage to avoid double counting

References used during brainstorming:

- OpenAI pricing: https://platform.openai.com/docs/pricing
- OpenAI prompt caching: https://platform.openai.com/docs/guides/prompt-caching
- OpenAI Codex rate card: https://help.openai.com/en/articles/20001106-codex-rate-card
- Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Anthropic context windows: https://docs.anthropic.com/en/docs/build-with-claude/context-windows

## Product Structure

Add two new top-level tabs in `desktop/src/App.tsx`:

- `CC`
- `Codex`

Keep the existing `用量` tab. The new tabs are temporary entry points during the replacement period. After the new feature replaces the old one, naming can be revisited.

Each top-level tab owns its own module page:

- `CC` loads Claude Code usage analysis.
- `Codex` loads Codex usage analysis.

The two pages share layout patterns but do not share report logic. Each page has its own refresh action, data hooks, report queries, parser, and renderer view components.

## Page Layout

Both `CC` and `Codex` use the same page shell:

- Left side: secondary view tabs.
- Right side: date range and refresh button.
- Date range options:
  - `7 天`
  - `30 天`
  - `90 天`
  - `全部`
- Secondary views:
  - `概览`
  - `时间`
  - `模型`
  - `项目`
  - `工具`
  - `明细`

Use existing shadcn/ui components and the current `radix-nova` visual baseline. Use Tailwind only for layout, spacing, sizing, overflow, and token-based typography. Do not use custom colors, inline style, page-level CSS overrides, or decorative gradients.

## View Design

### 概览

Purpose: answer “How much did I use, and where did it go?”

Show:

- Total tokens.
- Estimated cost.
- Request count.
- Conversation or task count:
  - CC: user message / request counts where available.
  - Codex: task and user message counts where available.
- Tool call count.
- Active days.
- Token trend summary.
- Token type breakdown.
- Estimated cost type breakdown.
- Top models.
- Top projects.
- Top tools.

### 时间

Purpose: show consumption fluctuation over time.

Range behavior:

- `7 天`: hourly distribution should be emphasized.
- `30 天` and `90 天`: daily distribution should be emphasized.
- `全部`: weekly or monthly grouping can be used for readability, while the stored data should preserve daily/hourly aggregates.

Show:

- Token trend.
- Estimated cost trend.
- Request/task trend.
- Tool call trend.
- Table columns: time bucket, tokens, estimated cost, requests/tasks, tool calls, dominant model.

### 模型

Purpose: show which models consume the most and why.

Columns:

- Model.
- Provider when available.
- Total tokens.
- Estimated cost.
- Input tokens.
- Output tokens.
- Cache read or cached input tokens.
- Cache creation tokens where available.
- Reasoning/thinking tokens where available.
- Request count.
- Average tokens per request.

Default sort: total tokens descending. Users should also be able to sort by estimated cost.

### 项目

Purpose: show which workspaces consume the most.

Columns:

- Workspace label.
- Workspace path/key.
- Sessions.
- Requests/tasks.
- Total tokens.
- Estimated cost.
- Tool calls.
- Last used time.

Default sort: total tokens descending.

### 工具

Purpose: show tool-call behavior, failure signals, and tool-heavy workflows.

CC can use Claude content blocks and tool names:

- `tool_use`
- `tool_result`
- tool name such as `Bash`, `Read`, `Edit`, `Grep`, `Write`, `WebFetch`, `WebSearch`, MCP tools

Codex can use event types:

- `function_call`
- `function_call_output`
- `custom_tool_call`
- `custom_tool_call_output`
- `exec_command_end`
- `patch_apply_end`
- `mcp_tool_call_end`
- `web_search_call`
- `web_search_end`

Columns:

- Tool name or tool category.
- Call count.
- Failure count where available.
- Failure rate.
- Average duration where available.
- Related token window when reasonably attributable.

Do not display command output, tool output, prompt content, or assistant content.

### 明细

Purpose: let users trace where usage came from without exposing conversation content.

Rows can be daily, session-level, or request-level depending on report mode. First version should support at least session-level and daily-level detail.

Columns:

- Date/time.
- Session id or short session label.
- Workspace.
- Model.
- Total tokens.
- Estimated cost.
- Token type breakdown.
- Tool count.
- Duration where available.

## Cost and Token Semantics

Display cost as `估算费用`.

Every total should have a visible breakdown:

- Token breakdown:
  - input
  - output
  - cache read / cached input
  - cache creation when available
  - reasoning/thinking when available
- Estimated cost breakdown:
  - input
  - output
  - cache read / cached input
  - cache creation when available
  - reasoning/thinking attributed to output-cost usage when applicable

Avoid double counting:

- Codex `reasoning_output_tokens` should be displayed as reasoning usage. For cost, treat it according to the applicable model output pricing rather than adding it twice on top of output if output already includes it.
- Claude thinking tokens should be displayed when detectable, and cost attribution should follow the available usage fields and provider pricing assumptions.

If a model price is unknown, show tokens and use zero or unknown cost for that row. Do not invent prices.

## Data Storage

Create a new Electron main service under:

```text
desktop/electron/services/usage-analysis/
```

Use a new SQLite database:

```text
usage.db
```

The database lives under Electron `app.getPath("userData")`, consistent with existing app-owned data.

Use prefixed table namespaces.

### Shared Table Pattern

Each tool namespace should have:

- scan file table
- session table
- usage event table
- tool event table
- daily aggregate table
- hourly aggregate table

Codex also has task event data.

### CC Tables

Proposed tables:

- `cc_scan_files`
  - file path
  - size
  - mtime
  - parse status
  - error code/message class
  - last scanned at
- `cc_sessions`
  - session id
  - file path
  - workspace key
  - workspace label
  - started at
  - ended at
  - model summary
  - request count
  - user message count
  - tool call count
- `cc_usage_events`
  - event id
  - session id
  - timestamp
  - local date
  - local hour
  - model
  - service tier
  - speed
  - input tokens
  - output tokens
  - cache read tokens
  - cache creation tokens
  - cache creation 5m tokens
  - cache creation 1h tokens
  - thinking tokens when available
  - estimated cost fields by type
- `cc_tool_events`
  - event id
  - session id
  - timestamp
  - local date
  - tool name
  - tool category
  - success/failure when available
  - duration when available
- `cc_daily_usage`
- `cc_hourly_usage`

### Codex Tables

Proposed tables:

- `cx_scan_files`
  - file path
  - size
  - mtime
  - parse status
  - error code/message class
  - last scanned at
- `cx_sessions`
  - session id
  - file path
  - workspace key
  - workspace label
  - provider
  - source
  - CLI version
  - agent nickname when useful
  - started at
  - ended at
  - model summary
  - user message count
  - task count
  - tool call count
- `cx_usage_events`
  - event id
  - session id
  - timestamp
  - local date
  - local hour
  - model
  - provider
  - input tokens
  - cached input tokens
  - output tokens
  - reasoning output tokens
  - total tokens from source when available
  - estimated cost fields by type
- `cx_tool_events`
  - event id
  - session id
  - timestamp
  - local date
  - tool name
  - tool category
  - status
  - exit code when available
  - duration when available
- `cx_task_events`
  - task id / turn id
  - session id
  - started at
  - completed at
  - duration ms
  - time to first token ms
- `cx_daily_usage`
- `cx_hourly_usage`

## Scanning

Refresh behavior:

- `CC` refresh scans only Claude Code paths.
- `Codex` refresh scans only Codex paths.

Paths:

- CC: `~/.claude/projects`
- Codex:
  - `${CODEX_HOME}/sessions` when `CODEX_HOME` is set
  - `~/.codex/sessions`
  - `${CODEX_HOME}/archived_sessions` or `~/.codex/archived_sessions`

Scanning should:

- Use file fingerprints to skip unchanged files.
- Parse changed files into in-memory rows first.
- Update the matching namespace in a transaction.
- Preserve existing rows for a namespace if parsing aborts before a safe transaction point.
- Record parse errors in scan file metadata without deleting old data.

Do not scan every tool when the user refreshes one tab.

## IPC and Bridge

Add a new IPC namespace instead of extending old `token-usage`.

Proposed renderer bridge shape:

```ts
usageAnalysis: {
  cc: {
    refresh: () => Promise<UsageRefreshResult>
    getOverview: (range: UsageRange) => Promise<CcOverviewReport>
    getTime: (range: UsageRange) => Promise<CcTimeReport>
    getModels: (range: UsageRange) => Promise<CcModelReport>
    getProjects: (range: UsageRange) => Promise<CcProjectReport>
    getTools: (range: UsageRange) => Promise<CcToolReport>
    getDetails: (params: CcDetailParams) => Promise<CcDetailReport>
  }
  codex: {
    refresh: () => Promise<UsageRefreshResult>
    getOverview: (range: UsageRange) => Promise<CodexOverviewReport>
    getTime: (range: UsageRange) => Promise<CodexTimeReport>
    getModels: (range: UsageRange) => Promise<CodexModelReport>
    getProjects: (range: UsageRange) => Promise<CodexProjectReport>
    getTools: (range: UsageRange) => Promise<CodexToolReport>
    getDetails: (params: CodexDetailParams) => Promise<CodexDetailReport>
  }
}
```

Register handlers through the existing validated IPC infrastructure. Do not add bare `ipcMain.handle`.

## Renderer Structure

Create:

```text
desktop/src/modules/usage-analysis/
```

Suggested structure:

```text
usage-analysis/
  index.tsx
  cc/
    cc-usage-page.tsx
    hooks/
    pages/
      overview.tsx
      time.tsx
      models.tsx
      projects.tsx
      tools.tsx
      details.tsx
  codex/
    codex-usage-page.tsx
    hooks/
    pages/
      overview.tsx
      time.tsx
      models.tsx
      projects.tsx
      tools.tsx
      details.tsx
  shared/
    components/
    lib/
    types.ts
```

Shared components should be thin and generic:

- metric grid
- range picker
- report table shell
- token breakdown display
- cost breakdown display
- empty/loading/error states

Do not put report-specific business logic in JSX. Keep report shaping in hooks, service calls, or pure helper functions.

## Testing

Add focused tests for:

- CC parser fixtures:
  - assistant usage
  - cache read/write
  - 5-minute and 1-hour cache creation fields
  - tool use/result counting
  - malformed lines
- Codex parser fixtures:
  - token count totals and deltas
  - cached input
  - reasoning output
  - session metadata
  - function/custom tool events
  - task duration and time-to-first-token
  - malformed lines
- Report aggregation:
  - date range filtering
  - hourly/daily bucketing
  - token type totals
  - estimated cost breakdown
  - model/project/tool sorting
- Renderer:
  - tab switching
  - range selection
  - loading state
  - empty state
  - table rendering

Run at minimum:

```text
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run test
```

If implementation touches broad renderer types or bridge definitions, also run the relevant typecheck/codegen checks used by the package.

## Open Decisions

No blocking open decisions remain for the design stage.

Implementation may still refine exact table columns while preserving these constraints:

- `usage.db`
- `cc_*` / `cx_*`
- old `token-usage` untouched
- CC and Codex refresh independently
- cost shown as estimated
- report UI focused on token, cost, time, model, project, tool, and detail views
