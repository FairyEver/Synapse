# CC 记录页产品化设计

## Status

Approved direction on 2026-05-27. The user selected the recommended product direction:

- merge `明细` and `对话` into one `记录` entry;
- make the default list session-centered;
- show request / billing details inline by expanding a session row;
- keep raw transcript reading as an explicit action.

This supersedes the `明细` + `对话` split introduced by `2026-05-27-cc-conversation-query-design.md` for the CC usage-analysis renderer UI. The raw conversation service and detail window remain valid infrastructure.

## Problem

The current CC usage-analysis navigation exposes both `明细` and `对话`. To users, the distinction is unclear:

- `明细` is billing/request events.
- `对话` is raw conversation sessions.
- Both rows are usually keyed by the same session and project data.

This creates duplicate-looking tabs, long path-heavy tables, and a weak product story. The user should not need to understand internal storage layers before finding a record and opening the raw conversation.

## Goals

- Replace the two secondary tabs `明细` and `对话` with one tab: `记录`.
- Default `记录` to a session-level list because this matches how people recall work.
- Let each session row summarize project, time, model, tokens, estimated cost, requests, tools, and events.
- Let users expand a session row to see request-level billing details that previously lived in `明细`.
- Keep a direct `打开对话` action for the raw transcript detail window.
- Keep raw transcript text search opt-in because it can be expensive.
- Preserve existing CC overview, time, model, project, and tool report pages.
- Keep all filesystem and transcript parsing in the Electron main process.

## Non-Goals

- Do not redesign the whole usage-analysis module.
- Do not add a second visual system or custom colors.
- Do not pre-ingest full raw transcript bodies into SQLite.
- Do not expose file paths or filesystem APIs directly to renderer code.
- Do not remove the standalone raw conversation detail window.
- Do not make `记录` a generic command palette or file browser.

## Information Architecture

The CC secondary navigation becomes:

```text
今日 / 概览 / 时间 / 模型 / 项目 / 工具 / 记录
```

Remove `明细` and `对话` from the visible tab list. Existing implementation names can be migrated incrementally, but the user-facing label and route/view should become `records`.

`记录` contains:

- search input;
- raw text search toggle labeled `原文`;
- active date range from the shared range picker;
- session-level record list;
- expandable request details;
- per-session raw transcript action.

## Record Row Model

Default row: one Claude Code session.

Visible summary fields:

- title;
- project label, shortened by removing shared path prefixes across visible rows;
- time range or last activity;
- model summary;
- total token count;
- estimated cost;
- request count;
- tool call count;
- raw event count when known;
- `打开对话` action.

The row should not show full filesystem paths by default. Full values can remain in `title` attributes or copy/open actions where useful.

## Inline Details

Expanding a session row shows request-level usage events for that session.

Each detail row should show:

- timestamp;
- model;
- token total;
- estimated cost;
- token breakdown when compact enough;
- tool call count;
- `定位到对话` action when a stable usage event id or timestamp is available.

The inline details replace the old `明细` tab for normal browsing. They should be loaded from indexed usage events, not by parsing the full raw transcript.

## Raw Transcript Flow

Raw transcript reading remains explicit:

- Clicking `打开对话` opens the existing standalone conversation detail window for the selected session.
- Clicking `定位到对话` from an expanded request row opens the same window with focus metadata.
- Turning on `原文` makes search scan raw JSONL text within the active filters.

The main `记录` list should not render full transcript content inline. It may show short match snippets when `原文` search is enabled.

## Loading And Empty States

The `记录` page must make pending work visible:

- initial load shows a visible loading state;
- refresh with existing rows keeps rows visible and shows a loading status;
- raw text search shows loading while scanning;
- the first record list request loads 50 sessions;
- the list footer shows how many records are visible out of the total;
- clicking `加载更多` requests the next batch size, increasing the visible limit by 50;
- `加载更多` is hidden when all matching records are visible;
- expanded request details load independently from the session list, with an initial limit of 200 request rows;
- expanded request details show their own visible count and `加载更多请求` when a session has more request rows than currently loaded;
- empty state stays short and action-oriented.

No UI copy should explain implementation details such as SQLite, JSONL, parser stages, or internal bridge names.

## Data And API Shape

Use the existing conversation list service as the session index foundation, but extend the response for record use:

```ts
type CcRecordListItem = CcConversationListItem & {
  readonly requestCount: number
  readonly detailRows?: readonly CcRecordDetailRow[]
  readonly detailsLoaded?: boolean
}
```

Preferred IPC surface:

```text
synapse:usage-analysis:cc:records:list
synapse:usage-analysis:cc:record-details:list
```

The implementation may keep old conversation IPC methods during migration, but renderer code should move to records-oriented naming.

`record-details:list` should accept:

```ts
type CcRecordDetailsInput = {
  readonly sessionId: string
  readonly limit?: number
  readonly offset?: number
}
```

It should return request-level `CcRecordDetailRow[]` for that session, ordered newest first. The record detail row type should live in `desktop/src/types/usage-analysis-conversations.ts` so record APIs do not import renderer bridge types back into the conversation type module.

The renderer should use `limit` and `offset` or cursor fields to avoid loading the full session list at once. The default visible batch is 50 records. For the first implementation, increasing the requested `limit` from 50 to 100 to 150 is acceptable because it keeps ordering deterministic and avoids client-side merge bugs. A future optimization can switch the same UI contract to cursor append without changing the product behavior.

## Renderer Structure

Preferred renderer files:

- `desktop/src/modules/usage-analysis/cc/pages/records.tsx`
- `desktop/src/modules/usage-analysis/cc/components/record-filters.tsx`
- `desktop/src/modules/usage-analysis/cc/components/record-table.tsx`
- `desktop/src/modules/usage-analysis/cc/components/record-detail-rows.tsx`

The current `conversations` page/table can be renamed or replaced in place. Keep changes surgical and avoid unrelated redesigns.

## Migration Notes

- Existing raw conversation detail window remains.
- Existing `CcDetailsPage` becomes obsolete for CC navigation after `记录` owns inline request details.
- Shared report tables can keep supporting `onOpenConversation` for other usage, but CC should not expose a separate `明细` tab.
- Update pending release notes because this is a user-facing navigation and workflow change.

## Testing Requirements

Add focused tests for:

- shell tab list shows `记录` and no longer shows `明细` / `对话` for CC;
- records page renders filters, loading state, session summary rows, and `打开对话`;
- records page renders visible batch count and `加载更多` when `items.length < total`;
- record table removes shared path prefixes in title/project display;
- expanding a session loads and renders request detail rows;
- detail row action opens raw conversation with focus metadata;
- main-process record details query returns only rows for the requested session;
- typecheck passes.

Do not use browser/runtime preview as required verification unless the user explicitly asks. Source tests and typecheck are sufficient for this planning scope.
