# Usage Analysis Today Page Design

## Status

Approved direction: add an independent `今日` page to both `CC` and `Codex` usage analysis. This is not a date-range variant of the existing overview page. It has its own product purpose, layout, and metric emphasis.

## Goal

Help users understand their current-day AI usage from local midnight to now: current consumption, usage rhythm, token composition, model mix, and near-term burn rate.

## Non-Goals

- Do not show tool call rankings, command rankings, project usage distribution, or project rankings on the today page.
- Do not reuse the existing `概览` layout with a `today` range.
- Do not add a budget system or quota configuration.
- Do not add custom colors, gradients, inline styles, custom CSS modules, or a new visual system.
- Do not start a runtime preview or browser verification as part of this design.

## Product Positioning

Historical pages answer: "Where did my usage go over a chosen period?"

The today page answers: "How is today going right now?"

Users opening `今日` are likely checking:

- How much they have already used today.
- Whether the current pace is unusually high.
- Which hours drove today's consumption.
- Whether token usage is mostly input, output, cache read, cache write, or reasoning.
- Whether today's model mix is skewed toward expensive or heavy models.
- What today's full-day estimate may look like if the current pace continues.

Because of that, `今日` should feel like a day-in-progress dashboard, not a retrospective report.

## Navigation Behavior

Add `今日` as the first secondary tab in both analysis pages:

```text
今日 / 概览 / 时间 / 模型 / 项目 / 工具
```

When `今日` is selected:

- Hide the right-side range picker (`7 天`, `30 天`, `90 天`, `全部`).
- Keep the refresh button.
- Query data using a `today` range from local `00:00` through the current time.

When any non-today tab is selected:

- Show the existing range picker.
- Preserve the current behavior of `概览`, `时间`, `模型`, `项目`, and `工具`.

Default selected tab should be `今日` for both `CC` and `Codex`, because this page is intended as the fastest status check.

## Data Scope

`今日` means local natural day:

```text
local today 00:00 <= event time <= now
```

Implementation should add a `today` preset to the shared usage range type and use existing daily/hourly aggregates where possible.

For today time charts, use hourly buckets. The chart should include buckets from `00:00` through the current local hour when data exists. Empty future hours should not be rendered.

## Page Layout

The page has four sections:

1. Today status metrics.
2. Today hourly rhythm.
3. Token and model structure.
4. Hourly rhythm table.

Use the existing shadcn/ui components and current `radix-nova` baseline. Tailwind should only handle layout, spacing, sizing, overflow, and token-based typography.

### 1. Today Status Metrics

Replace the existing six-card historical metric grid with four today-oriented status cards:

- `今日 Token`
- `今日费用`
- `最近 1 小时`
- `今日预计`

Metric details:

- `今日 Token`: total tokens from midnight to now.
- `今日费用`: estimated cost from midnight to now.
- `最近 1 小时`: token usage during the last complete or current rolling hour, with request count as a secondary value if available.
- `今日预计`: simple full-day projection based on elapsed time since midnight:

```text
projected = current_total / elapsed_day_fraction
```

If elapsed time is too small or total is zero, show `-` rather than forcing a noisy estimate.

The cards should remain compact. Avoid explanatory copy inside the UI.

### 2. Today Hourly Rhythm

Main chart title: `今日时段`

Purpose: show when today's usage happened and how each hour was composed.

Chart behavior:

- X axis: local hour boundaries from `00` through `24`. Hourly buckets are intervals: the `06:00-07:00` bar is centered between boundary ticks `06` and `07`, not on the `07` tick.
- Primary visual: stacked bars for token components:
  - `输入`
  - `输出`
  - `缓存读`
  - `缓存写`
  - `推理`
- Secondary line: request count.
- Tooltip: hour interval, total token, token components, requests, estimated cost.

This chart replaces the historical trend chart on today. It should not include model legend pagination as the primary visual; the focus is hour-by-hour rhythm and token composition.

### 3. Token And Model Structure

Show two compact structure panels below or beside the main chart, depending on available width.

`Token 结构`:

- Shows today token share by input/output/cache read/cache write/reasoning.
- Uses the existing breakdown chart component if it can fit the design without changing the component's visual language.

`模型结构`:

- Shows today's model mix by token share.
- This is not a ranking table. It should communicate composition, not competition.
- Limit visible slices/items to the most meaningful models and group tiny remainder as `其他` if needed.

Do not include project distribution or tool distribution.

### 4. Hourly Rhythm Table

Table title: `今日节奏`

Rows are hourly buckets from midnight to the current hour, ordered newest first or oldest first consistently with the chart. Preferred order: oldest first, matching the chart.

Columns:

- `时段`
- `Token`
- `费用`
- `请求`
- `主要模型`
- `结构`

`结构` should be a compact text summary of the largest token component for that hour, such as `缓存读 62%` or `输出 48%`.

This table is not a detail log and should not show prompts, command output, tool output, project paths, or session IDs.

## Shared CC And Codex Behavior

Both `CC` and `Codex` use the same today page layout and product logic.

Tool-specific differences stay in existing parsers and usage events:

- CC may have stronger cache read/cache write visibility.
- Codex may have reasoning output visibility.
- If a component is unavailable or zero for one tool, it remains part of the structure but contributes zero.

The page should not explain these technical differences in UI copy.

## Data Flow

Recommended implementation approach:

- Add `today` to `UsageRangePreset` / `UsageAnalysisRangePreset`.
- Update range normalization to accept `today`.
- Update local range filtering so `today` resolves to the current local date.
- Update time bucketing so `today` uses hourly aggregate data.
- Add a shared `TodayReportView` in the usage analysis module.
- Reuse existing hooks by passing the `today` range to overview/time/model calls.
- Derive status cards, token structure, model structure, projection, and hourly structure summaries in renderer-side pure helpers.

This keeps the first implementation small while still giving today an independent product shape.

## Error And Empty States

Reuse existing loading/error handling.

Empty today state should be brief:

```text
今天暂无数据
```

Do not add onboarding text or explanations.

## Tests

Add focused tests for:

- Range picker is hidden when view is `today`.
- Range picker is visible for non-today views.
- `today` is accepted by IPC normalization.
- `today` range resolves to the local current date.
- Today time data uses hourly buckets.
- Today page renders the independent labels: `今日 Token`, `最近 1 小时`, `今日时段`, `Token 结构`, `模型结构`, `今日节奏`.

## Open Decisions

No unresolved product decisions remain for the first implementation.
