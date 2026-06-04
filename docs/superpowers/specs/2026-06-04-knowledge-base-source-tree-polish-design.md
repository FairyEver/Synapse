# Knowledge Base Source Tree Polish Design

## Summary

Polish the left folder tree in the Knowledge Base source manager so it feels tighter and behaves like a normal file browser tree.

The selected direction is a compact tree with one-level directory preloading:

- folder rows use a consistent compact height and smaller indentation,
- folders known to have no child folders do not show an expand arrow,
- root-level folders preload one child-directory level after the root listing loads,
- tree-node context menus support only rename and delete.

This is a renderer-only UI and interaction refinement. It does not change raw storage, Electron APIs, `.raw/.manifest.json`, wiki content, Agent runtime, import/export behavior, or file conversion.

## Context

The current source manager already implements a two-pane file manager. The right pane shows the current folder list and row menus. The left pane shows a folder tree built from `listRawDirectory` results cached in renderer state.

The current tree has three visible issues:

- every folder row renders an expand button even when the folder has no child folders,
- nested rows use broad spacing, so the tree feels loose and imprecise,
- left tree folders do not expose the expected right-click rename and delete actions.

The existing product baseline remains valid:

- the source manager is only a `.raw/` file manager,
- uploads copy raw files as-is,
- deletion moves entries to the system Trash,
- users never see the real managed Knowledge Base backing path.

## Goals

- Make the left folder tree denser and easier to scan.
- Hide expand arrows for folders that are known to have no child folders.
- Make root-level tree arrows mostly accurate on initial load by preloading one child-directory level.
- Add right-click rename and delete for folders in the left tree.
- Reuse existing rename and trash flows.
- Keep UI copy sparse and operational.
- Use existing shadcn/Radix components, lucide icons, and theme token classes.

## Non-Goals

- No Electron IPC, preload API, service, or shared type changes.
- No recursive full-tree preload.
- No backend `hasChildren` field in this pass.
- No new sorting, filtering, preview, grid view, or file metadata surface.
- No changes to right-pane row actions except any local plumbing needed for shared handlers.
- No direct filesystem access from renderer.
- No custom colors, gradients, decorative copy, page-specific CSS, or nested cards.

## Product Decisions

### Tree Density

The left tree should use a compact row rhythm:

- one row per folder,
- stable row height around the small button height already used by the project,
- smaller indentation per depth than the current nested `ml-4` treatment,
- folder icon and label vertically centered,
- selected row uses existing token-driven shadcn button variants.

The tree should stay visually aligned with the current `radix-nova` shadcn baseline. This is a cleanup of spacing and behavior, not a new visual system.

### Expand Arrow Rules

A folder row shows an expand arrow only when one of these is true:

- the folder is loading,
- the folder has cached child folders,
- the folder has not yet been checked for child folders.

After a folder is checked and has no child folders, the arrow space remains reserved for alignment but the visible arrow is hidden or replaced with an inert spacer. This prevents leaf folders like `saves` from looking expandable.

### One-Level Preloading

After the current root directory listing loads, the renderer preloads one child-directory level for root folders that are not already cached or loading.

Example:

```text
资料/
  第一层/
  saves/
```

If `saves/` has no child folders, its arrow is hidden on the initial tree view. If `第一层/` has child folders, it remains expandable.

This preloading is intentionally shallow. Deeper folders become accurate after the user expands or opens them. This keeps the interaction natural without turning the renderer into a recursive scanner.

### Tree Context Menu

Left tree folder context menu supports:

- `重命名`
- `删除`

It does not include `打开`, `移动`, or `导出`.

Reasons:

- opening remains the normal click action,
- move and export belong to the right-pane list and batch selection model,
- keeping the tree menu short avoids turning navigation into a second file-action surface.

Delete uses the existing trash confirmation dialog. Rename uses the existing rename dialog. Both actions pass the selected folder entry into the same mutation paths used by right-pane row actions.

The root `资料` node does not get rename or delete.

## Technical Design

### Files

Primary renderer file:

- `desktop/src/modules/knowledge-base/source-manager-window.tsx`

Primary renderer test file:

- `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

No Electron service, IPC, preload, shared type, or raw manager files should change.

### Renderer State

Keep the existing `directoryTree` cache:

```ts
type DirectoryTree = Record<string, SynapseKnowledgeBaseRawEntry[]>
```

Add a renderer-only checked-directory set:

```ts
const [checkedTreeDirectories, setCheckedTreeDirectories] = useState<Set<string>>(() => new Set())
```

Semantics:

- `directoryTree[path]` stores known child directories.
- `checkedTreeDirectories` records that a directory has been listed at least once for tree purposes.
- a checked directory with no cached children is a leaf for arrow rendering.

Existing current-directory loads should also mark that directory checked for tree purposes because they already provide the child folder list.

### Preload Flow

After the root directory is loaded and `directoryTree[""]` is populated:

1. Find root child folders.
2. Exclude folders already cached, already checked, or currently loading.
3. Call `listRawDirectory` for each remaining root child folder.
4. Store only child directories in `directoryTree`.
5. Mark each attempted directory as checked after success.
6. On failure, log with `createRendererLogger` and show the existing short error notification.

The preload must not recurse into grandchildren.

### Tree Rendering

Replace recursive margin nesting with a tree-row renderer that receives `depth`.

Each row:

- reserves a small control slot for the expand arrow or spacer,
- uses `padding-left` via existing Tailwind spacing or a small finite depth-class mapping,
- keeps the clickable folder label aligned,
- uses `ContextMenu` around the row button for tree folder actions,
- keeps internal drag target handling on valid folder rows.

Avoid inline `style` for product layout. If dynamic depth needs classes, use a finite helper mapping such as:

```ts
function treeDepthPadding(depth: number): string
```

The helper can cap deeper levels to a maximum practical indentation.

### Mutations And Cache Refresh

Reuse existing mutation paths:

- rename: `renameRawEntry`
- delete: `trashRawEntries`

When a directory is renamed or deleted:

- prune cached tree entries for that directory and descendants,
- refresh the current directory through the existing flow,
- keep existing user notifications and logger behavior.

If a folder is created in the current directory, the current directory refresh updates the visible tree cache. If the created folder is root-level, subsequent one-level preload can check it as needed.

## Error Handling

Use existing renderer patterns:

- `createRendererLogger("knowledge-base.source-manager")` for logs,
- `useAppNotifications` for short user-facing failures,
- no production `console.log`,
- no swallowed empty catches.

User-visible copy remains short:

- `读取资料失败`
- `正在重命名`
- `已重命名`
- `正在移到废纸篓`
- `已移到废纸篓`

No new helper text is added to explain the tree behavior.

## Testing

Update focused renderer tests to cover:

- root-level folders preload one child-directory level after the root listing loads,
- a checked folder with no child directories does not render an expand action,
- a folder with child directories still renders an expand action,
- tree rows remain clickable for opening folders,
- right-clicking a tree folder exposes `重命名` and `删除`,
- tree rename calls the existing `renameRawEntry` payload,
- tree delete opens the existing trash confirmation and calls `trashRawEntries`,
- root `资料` does not expose rename or delete.

Existing tests for upload, row menus, drag-to-folder, move, export, and batch delete should continue to pass.

## Acceptance Criteria

- The left folder tree reads as compact and precise.
- Leaf folders no longer show a visible expand arrow after they are checked.
- Root-level leaf folders are usually accurate on initial load through one-level preloading.
- Left tree folder right-click supports rename and delete.
- Right-pane list actions remain unchanged.
- No Electron API, raw storage, manifest, wiki, Agent, Scheduler, or Workflow behavior changes.
- UI uses existing shadcn/Radix components, lucide icons, and token classes.
- No custom colors, CSS modules, gradients, glow, card nesting, or decorative copy are introduced.
