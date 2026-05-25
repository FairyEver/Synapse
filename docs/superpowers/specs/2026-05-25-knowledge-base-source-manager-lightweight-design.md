# Knowledge Base Source Manager Lightweight UI Design

## Summary

Refresh the Knowledge Base source manager window into a lighter, more mature C-end file-management surface while preserving the existing raw file manager behavior.

The selected direction is:

- lightweight cloud-drive structure,
- consumer-style list rows instead of a heavy table,
- an inline batch action bar that appears only after selection,
- no persistent drag-and-drop instruction text.

This is a renderer UI and interaction refinement. It does not change Knowledge Base storage semantics, Electron APIs, raw path validation, manifest behavior, wiki generation, or Agent workflows.

## Context

The current `desktop/src/modules/knowledge-base/source-manager-window.tsx` implements the managed Knowledge Base `.raw/` file manager. It already follows the product decision from `2026-05-24-knowledge-base-raw-file-manager-design.md`: users manage uploaded source files inside Synapse without seeing the real backing directory.

The current UI works, but visually reads closer to an internal table tool:

- persistent table headers dominate the page,
- file size and update time are separate table columns,
- batch actions are always visible but disabled,
- the normal state includes drag instruction text,
- the toolbar and row treatment feel heavier than the rest of the app.

The goal is to make the page feel like a mature lightweight product, without adding new capabilities or new visual systems.

## Goals

- Preserve the current two-pane file manager mental model.
- Make the right pane read as a consumer-style source list rather than a data table.
- Keep frequently needed actions available without making disabled controls dominate the page.
- Treat drag-and-drop as an invisible capability in the normal state.
- Keep UI copy sparse and necessary.
- Use existing shadcn/Radix components, lucide icons, and theme tokens.
- Keep the implementation local to the Knowledge Base source manager renderer module.

## Non-Goals

- No new Electron IPC or preload API.
- No storage behavior changes.
- No new sorting, file-type filters, file preview, grid view, recursive search, or grouping.
- No ingest status, manifest status, wiki status, or import action.
- No Agent, Claude Code, workflow, or scheduler behavior changes.
- No custom color system, decorative gradients, card nesting, or page-level custom CSS.
- No visible implementation explanation such as `.raw`, manifest, or wiki repair copy.

## Product Decisions

### Layout

Keep the two-pane layout:

- left: lightweight folder tree,
- right: current folder toolbar and source list.

The toolbar shows:

- breadcrumb location,
- current-folder search,
- new folder action,
- upload action.

The toolbar should feel compact. It should not include explanatory text or duplicate status summaries.

### List Presentation

Replace the visual weight of the table with list rows.

Each row shows:

- a selection checkbox,
- a file or folder icon,
- the entry name as primary text,
- compact secondary metadata such as `24 KB · 今天 08:32` or `文件夹 · 今天 09:10`,
- a row action menu.

Size and update time are no longer separate visible columns. This keeps the list scannable while reducing the spreadsheet feel.

Folders remain navigable from the list. Files remain non-previewable in this pass.

### Batch Actions

Do not show disabled batch action buttons in the normal state.

When one or more entries are selected, show an inline selection bar at the top of the list area:

```text
已选择 2 项        移动  删除
```

The bar belongs to the list area, not the global toolbar. It disappears when the selection is cleared or the user changes directory.

### Drag And Drop

The whole right content area accepts dropped files for upload into the current folder.

Normal state must not show persistent copy such as:

```text
拖拽文件到这里上传
拖拽文件到窗口
```

During drag-over, the right pane may show a lightweight drop state. The copy should be short if used:

```text
松开上传
```

It is also acceptable for implementation to use only a subtle visual highlight if the existing component composition makes text unnecessary.

### Empty And Loading States

Use short necessary copy only:

- loading: `读取中`
- empty folder: `没有文件`
- empty search result: `没有匹配项`

Do not add helper descriptions under these states unless the user needs a next action. Since upload remains in the toolbar, the empty state does not need to explain drag-and-drop.

## Technical Design

### Files

Primary renderer file:

- `desktop/src/modules/knowledge-base/source-manager-window.tsx`

Primary test file:

- `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

No Electron service, IPC, preload, or type changes are expected.

### Component Boundaries

Split the current large window into narrow local components inside the same module area or same file during the first implementation pass:

- `SourceManagerSidebar`: left folder tree.
- `SourceManagerToolbar`: breadcrumbs, search, new folder, upload.
- `SourceEntryList`: row rendering, empty state, row menu.
- `SourceSelectionBar`: selected count and batch actions.

These names can be adjusted to match local style, but the implementation should avoid moving business logic into JSX-heavy inline blocks.

Keep state ownership in `KnowledgeBaseSourceManagerWindow` for this pass:

- current directory,
- loaded entries,
- folder tree cache,
- search query,
- selected paths,
- drag state,
- dialog state.

This keeps the change surgical and avoids inventing a new state architecture.

### Data Flow

Existing bridge calls remain unchanged:

- `listRawDirectory`
- `selectAndUploadRawFiles`
- `uploadRawFiles`
- `createRawFolder`
- `renameRawEntry`
- `moveRawEntries`
- `trashRawEntries`

Search still filters only the current directory.

Upload still targets the current directory.

Changing directory still clears selection.

Move and delete still use selected raw relative paths.

### Error Handling

Reuse existing notification and renderer logger behavior.

The redesign should not weaken existing async error handling:

- directory load failures continue logging through `createRendererLogger`,
- user-visible failures continue using `useAppNotifications`,
- mutation actions continue using the existing `promise` notification helper.

No production `console.log` should be introduced.

## Testing

Update focused renderer tests to cover behavior and copy:

- renders as a file browser without ingest statuses,
- does not render table column labels such as `大小` and `更新时间` as persistent headers,
- does not show persistent drag-and-drop instruction text in the normal state,
- opens folders and updates breadcrumbs,
- uploads dropped files to the current folder,
- selection shows the inline batch action bar,
- move and trash actions still call the existing bridge payloads.

Existing Electron raw file manager tests remain valid and should not need updates.

## Acceptance Criteria

- The source manager reads as a lightweight file list, not a heavy table.
- The normal state contains no persistent drag-and-drop instruction copy.
- The right pane accepts drag-and-drop upload into the current folder.
- Selected entries reveal an inline batch action bar.
- Row actions still support open folder, rename, move, and delete.
- Breadcrumb navigation, current-folder search, create folder, upload, move, and trash behavior remain intact.
- No new colors, custom CSS modules, inline style-based product implementation, gradients, glow, or card nesting are introduced.
- No changes are made to `.raw/.manifest.json`, `wiki/`, Agent sessions, or Electron raw file manager APIs.
