---
name: synapse-ui-log-completion
description: Use when working in the Synapse repository and the user mentions UI operation logs, interaction logs, UI logging gaps, log completion, telemetry, tracking, click/input/tab/table/list/scroll records, or asks to audit or automatically complete renderer-side logs.
---

# Synapse UI Log Completion

## Purpose

Complete Synapse renderer UI operation logs with a review-first workflow. The goal is to make future log analysis reconstruct what the user did: clicked which button, switched which tab, selected which list item, edited which table cell, typed which value, or scrolled which important container.

This is a project-specific skill for the Synapse repository. Apply it to `desktop/src` unless the user narrows the scope.

## Modes

Infer the mode from the user's wording.

| Mode | User intent | Behavior |
| --- | --- | --- |
| Review first | "检查", "审查", "看看缺哪些", "audit UI logs" | Scan code and output findings plus a patch plan. Do not edit code. |
| Review then edit | "审查并自动修改", "自动补", "看完直接改", "帮我补全", "fix the gaps" | Scan code, summarize the patch plan, then implement the planned changes. |
| Scoped execution | User names a module, file, or interaction type | Limit the scan and edits to that scope. |

If the wording is ambiguous, default to review first.

## Mandatory Project Context

Before reviewing or editing, read these files to refresh the current logging shape:

- `desktop/src/lib/ui-tracking.ts`
- `desktop/src/app-shell/logging.ts`
- `desktop/src/app-shell/notifications.tsx`
- `desktop/src/components/ui/button.tsx`
- `desktop/src/components/ui/tabs.tsx`
- `desktop/src/components/ui/input.tsx`
- `desktop/src/components/ui/textarea.tsx`
- `desktop/src/components/ui/select.tsx`

Also search for existing usage:

```bash
rg -n "track\\(|data-track|createRendererLogger\\(" desktop/src
rg -n "onClick|onChange|onValueChange|onOpenChange|onSelect|onSubmit|onScroll|onDoubleClick" desktop/src
```

Never start the app, browser, Playwright, or runtime debugging for this skill unless the user explicitly asks. Reason from source code.

## Logging Primitives

Prefer existing primitives in this order:

1. `track({ component, name, action, value })` from `desktop/src/lib/ui-tracking.ts` for generic UI interactions.
2. `data-track="stable-semantic-name"` on tracked shadcn primitives when fallback labels are weak.
3. `createRendererLogger("category")` for business-semantic operations, async flows, failures, and transitions that need rich details.
4. Existing notification `promise()` logging for async user operations when already used by the module.

Do not introduce another logging client, analytics abstraction, dependency, or cross-process channel.

## Review Workflow

### 1. Build The Component Coverage Map

Scan `desktop/src/components/ui/` and list primitives that already call `track()`. Note missing primitives only when user interactions inside them matter.

Expected examples:

- Buttons: click
- Tabs: select
- Inputs and textarea: focus / blur
- Selects, menus, dialogs, sheets, switches, checkboxes, sliders: open / close / select / check / uncheck / slide

### 2. Find Interaction Entries

Search renderer code for user-triggered entries:

- `onClick`
- `onDoubleClick`
- `onChange`
- `onValueChange`
- `onOpenChange`
- `onSelect`
- `onSubmit`
- `onScroll`
- keyboard submit handlers
- custom props such as `onTableSelect`, `onAddClick`, `onSearchChange`, `onPageChange`

For each entry, decide whether it is already covered by a tracked primitive, a business logger, or notification logging.

### 3. Classify Gaps

Use these priorities:

| Priority | Interaction | Expected log |
| --- | --- | --- |
| P0 | App-level tab/page transitions, destructive operations, async operations with IO | from/to, target id/name, source, elapsedMs for async |
| P1 | Dialog open/close, form submit, table row/cell edit, list item select, repository/content/database changes | semantic action and target |
| P2 | Search input, filters, sorting, pagination, view mode, table column resize | new value or summarized value |
| P3 | Generic button/menu click already covered by primitive but weakly named | add or improve `data-track` |
| P4 | Scroll in important containers | debounced final position, direction, percent |

Do not report pure display components without meaningful user action.

### 4. Output Patch Plan

For review-first mode, output:

```text
## UI Log Completion Review

### Coverage Map
- Covered primitives: ...
- Missing or weak primitives: ...

### Findings
- [P1] file:line — interaction — current coverage — proposed log fields — input handling — risk

### Patch Plan
1. Batch name — files — changes — verification
2. Batch name — files — changes — verification
```

For review-then-edit mode, give the same summary briefly, then implement the plan.

## Input Value Policy

Logs should help AI understand user behavior without turning logs into a data leak or a giant transcript dump.

### Field Classification

Classify inputs by name, placeholder, label, component type, surrounding module, and value length.

| Class | Examples | Log value policy |
| --- | --- | --- |
| Ordinary short text | search box, title, short name, category, normal one-line form field | Record raw value when it is short and not sensitive. |
| Sensitive | password, token, secret, credential, apiKey, appSecret, private key, cookie, authorization, owner id, user id when privacy-sensitive | Do not record raw value. Use `[redacted]`, length, or boolean presence. |
| Path-like | filesystem path, repository path, base dir, export path | Prefer basename, length, or `[path redacted]` unless path visibility is already core to the UI action. |
| Long text | rule body, skill body, prompt body, markdown/source editor, textarea with large content | Summarize with the long-value policy below. |
| Structured/bulk value | table JSON, multi-select arrays, large generated content | Record count, keys, ids, or a short summary. |

### Long-Value Policy

If a string is longer than 300 characters, record only the first 120 characters plus a clear marker:

```text
{prefix}...（日志自动优化：原始 {length} 字，仅记录前 120 字）
```

The marker is important. It tells future AI log analysis that the ellipsis and note were produced by the logging layer, not typed by the user.

Prefer extracting this behavior into a small helper if multiple files need it. Do not duplicate 5+ lines in 3+ places.

### Search Input Policy

For ordinary search inputs, log the final value with debounce rather than every keystroke. If the search may include secrets, use the sensitive policy.

## Scroll Logging Policy

Scroll logs can become noise. Add them only for important containers:

- module sidebars and long lists
- data tables
- detail/source preview panes
- schema or settings panels where scroll position helps reconstruct user behavior

Use debounce and log only the settled position. Include:

- `component`
- `name`
- `action: "scroll"` if the current `TrackAction` supports it; otherwise use `logger.info`
- `direction`
- `scrollTop`
- `scrollLeft`
- `scrollHeight`
- `clientHeight`
- `percent`

If `TrackAction` lacks `"scroll"`, prefer a business logger or first extend `TrackAction` in `desktop/src/lib/ui-tracking.ts` when several generic components need it.

## Table And List Logging

### Data tables

For editable tables, meaningful events include:

- cell focus or double click to edit: table, row id, column name
- edit commit: table, row id, changed columns, summarized values
- add row start/cancel/save
- delete dialog open/confirm
- pagination change: from/to
- column resize settled width
- table scroll settled position

Avoid logging full row values unless short and non-sensitive.

### Lists and sidebars

For list item selection, record:

- list name
- item id/name
- previous selected item when available
- source if selection comes from shortcut, search, or navigation

Generic `Button` click logs are not enough when the clicked thing is a semantic list item.

## Editing Rules

When implementing:

- Keep changes surgical and focused on UI logging.
- Reuse existing `track`, `data-track`, `createRendererLogger`, hooks, and utilities.
- Do not restyle UI, change copy, restructure components, or introduce new dependencies.
- Do not add `console.log`.
- Preserve renderer/main/preload boundaries.
- Keep state updaters pure. Do not put logging side effects inside React state updater functions.
- In React StrictMode-sensitive code, use refs or event handlers for logging transitions.
- If adding helpers, place shared pure helpers under `desktop/src/lib/` only when reused. Otherwise keep helper local.

## Verification

For review-only mode, no runtime verification is required.

For code edits:

1. Run a targeted typecheck or the smallest relevant test command when practical.
2. If the repo has unrelated dirty changes or test failures, do not revert them. Report what was verified and what was not.
3. Do not start the dev server or browser unless the user explicitly asks.

## Common Mistakes

- Treating primitive click coverage as sufficient for business actions. A "button clicked" log may not say which row, table, tab, or content item was affected.
- Logging every keystroke. Debounce search and summarize long text.
- Logging secrets or full filesystem paths by accident.
- Putting logger calls inside `setState(prev => ...)`, which can duplicate logs under React StrictMode.
- Adding broad scroll listeners without debounce.
- Creating a parallel analytics system instead of using Synapse's existing logging primitives.
