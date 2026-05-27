# CC 记录页滚动加载与表格细节设计

## Status

Approved direction on 2026-05-27. The selected approach is option B from the brainstorming preview: keep the current CC `记录` page model, fix the visible layout defects, and replace manual load-more with guarded scroll loading.

This document extends `2026-05-27-cc-records-unified-design.md`. It does not change the larger product direction: `记录` remains a session-centered list with expandable request details and an explicit raw transcript action.

## Problem

The current CC `记录` page has several usability issues:

- the search input focus ring is clipped at the top edge;
- the rightmost action column scrolls away instead of staying attached to the right edge;
- the search placeholder does not explain what fields are searched;
- the expand chevron and title text in the first column are visually misaligned;
- loading more records requires clicking a button, and the footer count is separated from the place where users scan and load results.

## Goals

- Make the search input focus state render fully.
- Make the action column sticky on the right side of the table.
- Clarify searchable fields without adding explanatory UI copy.
- Align the expand affordance and row title.
- Replace the manual `加载更多` button with scroll-triggered loading.
- Prevent duplicate load requests while a list request is already in flight.
- Keep existing rows visible while additional rows are loading.
- Surface concise loaded/total progress near the records workflow.

## Non-Goals

- Do not redesign the full usage-analysis module.
- Do not introduce custom colors, custom primitives, gradients, cards, or a parallel table system.
- Do not change the CC records data model.
- Do not switch the backend API to a cursor append model in this pass.
- Do not change raw transcript search semantics.
- Do not add verbose helper text or implementation explanations to the UI.

## Interaction Design

The top filter row remains compact:

- search input on the left;
- `原文` switch on the right;
- a small loaded-count status sits in the same toolbar when records are loaded.

The search placeholder should be explicit and short:

```text
搜标题 / 项目 / 模型 / Session ID；打开原文后搜对话内容
```

The loaded count is a separate muted status rather than dynamic placeholder text. Placeholder text disappears once the user types, so it explains search scope instead of carrying pagination state.

## Table Layout

The existing shadcn `Table` primitives remain the foundation.

Required table changes:

- add sticky right behavior to the `操作` header and cells;
- keep action cells right-aligned;
- ensure sticky cells use existing surface/background tokens only;
- align the first column row content with `items-center`;
- keep the expand button at a stable icon size;
- keep the title/snippet stack `min-w-0` so long paths truncate without shifting the icon.

The clipped search focus should be fixed by giving the filter row or input wrapper enough vertical room for the ring. Avoid changing shared `InputGroup` defaults unless the clipping is proven to affect every use.

## Loading Model

Keep the current renderer-side limit growth model:

- first load requests 50 records;
- each additional load increases the limit by 50;
- range, query, and raw-text changes reset the limit to 50;
- initial loading with no data shows the existing centered loading state;
- refresh/loading with existing rows keeps the table visible;
- if `state.loading` is true, scroll loading must not trigger another increment;
- if `shown >= total`, scroll loading must not trigger.

This preserves deterministic ordering and avoids client-side merge bugs. A future optimization can switch the same UI contract to offset/cursor append without changing visible behavior.

## Footer State

Remove the manual `加载更多` button from the records footer.

The footer becomes a concise status row:

- loading more: `正在加载 51-100 / 240`;
- idle with more records: `已显示 50 / 240`;
- all records loaded: `已显示全部 240 条`.

The status row owns the scroll sentinel. It should be visible at the bottom of the table flow and use existing muted text styling.

## Data Flow

`CcRecordsPage` continues to own:

- `query`;
- `rawText`;
- `loadedLimit`;
- `expandedSessionId`;
- `detailLimit`.

Add a small scroll-load guard in the page or a local hook:

```text
canLoadMore = shown > 0 && shown < total
shouldLoadMore = canLoadMore && !state.loading
```

The observer callback only increments `loadedLimit` when `shouldLoadMore` is true. It should not duplicate request state outside the existing loader unless needed to solve a concrete race.

## Error And Empty States

Keep existing `ReportState` behavior:

- errors stay short;
- empty state remains concise;
- existing rows stay visible during refresh or load-more work.

Do not add explanatory text about SQLite, JSONL, IPC, parser stages, or backend limits.

## Testing Requirements

Add or update focused tests for:

- records page no longer renders a `加载更多` button;
- footer shows loaded/total status;
- loading-more footer shows the next range;
- scroll loading does not increment while the list state is already loading;
- range/query/raw-text changes reset the visible limit;
- operation header and cells include sticky right alignment classes;
- first column expand control and title wrapper use centered alignment;
- initial loading and empty states still render.

Static renderer tests and typecheck are sufficient. Do not require browser/runtime preview for this change unless explicitly requested.
