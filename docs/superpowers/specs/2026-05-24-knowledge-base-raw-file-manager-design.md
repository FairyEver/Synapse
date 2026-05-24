# Knowledge Base Raw File Manager Design

## Summary

Synapse will replace the current flat Knowledge Base source manager with a pure file-manager view over the managed knowledge base `.raw/` directory.

The feature behaves like a small cloud-drive window for user-provided source files. Users can create folders, enter folders through breadcrumbs, upload files into the current folder, rename entries, move entries, select multiple entries, and delete entries to the system Trash.

This design intentionally does not update `.raw/.manifest.json`, does not rewrite `wiki/` references, does not run Claude Code, and does not show ingest state. It only manages the raw source file tree.

## Context

The canonical managed knowledge base design keeps runtime directories hidden from users while allowing source/material management through Synapse APIs.

Current source management is closer to a flat source inbox:

- uploaded files are copied into date-based `.raw/` subdirectories,
- the UI lists source status such as pending/imported/changed,
- users do not directly manage folders.

The new product direction is different. Users should be able to organize uploaded materials themselves in a visible folder structure, similar to a lightweight network drive. This also prepares for future knowledge base export because user source organization becomes explicit product data rather than only an implementation layout.

## Product Decision

Use a pure `.raw/` file manager.

The user-facing model is:

```text
资料管理 = 管理上传到知识库的原始资料文件
```

It is not:

```text
资料管理 = 管理 AI 生成的 wiki 页面
资料管理 = 导入状态中心
资料管理 = manifest 修复工具
```

## Goals

- Let users browse the `.raw/` source tree without exposing the real backing filesystem path.
- Let users organize materials with familiar file operations.
- Keep upload behavior spatial: dropping or choosing files copies them into the currently open folder.
- Support first-version batch organization through multi-select move and delete.
- Keep deletion aligned with Finder-style user expectations by moving entries to the system Trash.
- Keep file operations deterministic and owned by Synapse Electron services.
- Preserve the managed knowledge base boundary: renderer sees typed entries and relative paths, not raw privileged filesystem access.

## Non-Goals

- No immediate `.raw/.manifest.json` update when users move, rename, or delete raw files.
- No immediate `wiki/` reference rewrite.
- No automatic Claude Code repair task.
- No repair prompt or "knowledge base may be broken" warning in the first version.
- No ingest status badges in the file manager.
- No recursive folder upload in the first version.
- No user access to the real managed backing path.
- No management of `wiki/`, `_attachments/`, `.vault-meta/`, `commands/`, `skills/`, or other runtime folders.

## Hard Rules

- All visible entries come from `.raw/` only.
- All renderer-supplied paths are `.raw`-relative or scoped raw paths validated in Electron before use.
- File and folder operations must not escape `.raw/`.
- Symlinks must not be followed for traversal, copy, move, rename, or delete.
- Delete must use the system Trash, not permanent deletion.
- Upload accepts files only. Dropped folders are skipped.
- File operations must not write `.raw/.manifest.json`.
- File operations must not modify `wiki/` files.
- File operations must not invoke Agent or Claude Code sessions.
- Ordinary projects must not receive Knowledge Base file-manager behavior.

## User Experience

Entry point remains the existing Knowledge Base project action currently labeled as source/material management.

The window opens at the `.raw/` root:

```text
资料
```

When the user enters a folder, the breadcrumb updates:

```text
资料 / 项目A / 会议纪要
```

The first version uses a single-column list layout:

```text
+----------------------------------------------+
| 资料 / 项目A / 会议纪要                       |
| [新建文件夹] [上传文件] [搜索当前文件夹]       |
+----------------------------------------------+
| [ ] [folder] 2026 会议资料  --      05/24 18:10 |
| [ ] [file]   产品需求.md    24 KB   05/24 17:45 |
| [ ] [file]   用户访谈.pdf   2.1 MB  05/23 21:12 |
+----------------------------------------------+
```

Required visible controls:

- Breadcrumb navigation.
- New folder button.
- Upload file button.
- Current-folder search.
- Select-all checkbox.
- Row checkbox.
- Row action menu.
- Batch action bar when one or more entries are selected.

Required row actions:

- Open folder.
- Rename.
- Move to.
- Delete.

Required batch actions:

- Move to.
- Delete.

The UI should use existing shadcn/Radix primitives, lucide icons, table/list primitives, dropdown menus, dialogs, and existing token classes. It should not introduce custom colors, decorative gradients, or explanatory product copy.

## Copy

Use restrained product copy.

Recommended labels:

- `资料管理`
- `新建文件夹`
- `上传文件`
- `搜索当前文件夹`
- `重命名`
- `移动到`
- `删除`
- `移到废纸篓`
- `没有文件`

Avoid implementation or warning copy such as:

- "manifest 未更新"
- "知识库可能损坏"
- "Claude Code 修复"
- "当前功能只管理 .raw"

These details belong in implementation docs and agent prompts, not the user interface.

## Behavior

### Listing

Listing a directory returns only the immediate children of that directory.

Directory entries should include:

```ts
type KnowledgeBaseRawEntry = {
  name: string
  relativePath: string
  kind: "file" | "directory"
  size: number | null
  modifiedAt: string
}
```

The UI sorts directories before files, then sorts by name by default.

### Navigation

Users can enter directories from the list and return through breadcrumbs.

The `.raw/` root is displayed as `资料`.

The UI must not show `.raw` as a folder name unless a later product decision explicitly chooses a developer-oriented mode.

### Upload

Users can upload through:

- upload button with file picker,
- dragging files into the current window.

Uploaded files are copied into the currently open folder.

Dropped folders are skipped. The first version may show a short result toast if some dropped items were skipped, but it should not explain filesystem internals.

If a file with the same name already exists, Synapse should avoid overwriting by default. The first version should use collision-safe names, such as:

```text
会议纪要.pdf
会议纪要-2.pdf
```

### New Folder

Users can create a folder in the current directory.

Folder names must be validated against path separators, empty names, `.` and `..`, and platform-invalid names where practical.

If a folder already exists, show a concise error.

### Rename

Rename applies to one file or one folder.

Rename changes only the filesystem entry. It does not update manifest or wiki references.

The new name is validated like folder creation. File extensions are preserved only if the user keeps them; the first version should not implement smart extension behavior unless the existing project already has a helper for it.

### Move

Move applies to one or more selected entries.

The destination picker should show folders under `.raw/` and allow choosing the root `资料`.

Moving a folder into itself or its descendant is invalid.

Move changes only filesystem paths. It does not update manifest or wiki references.

### Delete

Delete moves selected entries to the system Trash.

Deletion requires confirmation, especially for folders and multi-select. The confirmation copy should be short:

```text
移到废纸篓？
```

The service should use Electron/system Trash behavior rather than permanent deletion.

### Search

Search filters entries in the current folder only.

First version does not need recursive search or full-text search.

## Technical Shape

Reuse the existing Knowledge Base source manager entry point and window where practical, but change its model from source scanning to raw directory browsing.

Renderer:

- Keep logic under `desktop/src/modules/knowledge-base/`.
- Replace the flat source-status list with a raw directory browser.
- Use narrow bridge calls under `window.synapse.knowledgeBase`.
- Keep state local to the window: current directory, selected entries, query, pending operation.

Preload/types:

- Add typed payloads and results to `desktop/src/types/knowledge-base.ts`.
- Expose only raw-manager methods, not filesystem primitives.

Electron IPC:

- Add guarded methods for list, create folder, upload files, rename, move, and trash.
- Keep all privileged operations in Electron services.
- Use `PermissionGuard` and `AuditSink` for writes and trash operations.

Knowledge Base service:

- Resolve `projectId` to the managed runtime path through the existing managed knowledge base project model.
- Scope every operation to `runtimePath/.raw`.
- Share path normalization and symlink rejection helpers inside the knowledge-base service area.

Suggested bridge/API shape:

```ts
listRawDirectory(projectId, directoryPath)
createRawFolder(projectId, parentDirectoryPath, name)
uploadRawFiles(projectId, targetDirectoryPath, filePaths)
renameRawEntry(projectId, relativePath, newName)
moveRawEntries(projectId, relativePaths, targetDirectoryPath)
trashRawEntries(projectId, relativePaths)
```

Names can be adjusted during implementation to match existing bridge style.

## Path Model

The API should use paths rooted at `.raw/`.

Two acceptable internal representations are:

```text
""                         # raw root
"项目A/会议纪要.md"          # path relative to .raw
```

or:

```text
".raw"
".raw/项目A/会议纪要.md"
```

The first representation is cleaner for the renderer. The Electron service can add `.raw` after validation.

Whatever representation is chosen, it must be consistent across list, move, rename, upload, and trash APIs.

## Safety

Every path operation must:

- resolve against the managed `.raw` root,
- reject absolute paths,
- reject `..` escape,
- reject empty target names where a name is required,
- reject symlink traversal,
- avoid overwrite unless a later explicit overwrite design is approved.

Batch operations should be transactional where practical, but the first version can report partial failures if system Trash or move operations fail mid-batch. The response must include enough information for the UI to refresh and show a concise failure.

## Relationship To claude-obsidian

This design intentionally follows the original `claude-obsidian` posture for raw source files:

- `.raw/` is user-curated source material.
- Ingest and lint are separate knowledge operations.
- Moving source files is not automatically a manifest migration.

The file manager does not try to reimplement `wiki-ingest` or `wiki-lint`.

If future product work adds a repair flow, it should be a separate feature:

```text
Raw file manager operation
-> user chooses "整理知识库"
-> Claude Code or deterministic services repair manifest/wiki references
```

That flow is out of scope for this first version.

## Testing

Focused tests should cover:

- Listing `.raw/` root and nested directories.
- Breadcrumb path handling.
- Upload copies files into the current directory.
- Dropped folders are skipped.
- New folder validation and collision behavior.
- Rename validation and collision behavior.
- Move validation, including rejecting move into self/descendant.
- Multi-select move.
- Trash delete for one entry and multiple entries.
- Symlink entries are not traversed.
- Path escape attempts are rejected.
- Managed project resolution rejects non-knowledge-base projects.
- File operations do not write `.raw/.manifest.json`.
- File operations do not modify `wiki/`.

Renderer tests should cover:

- Empty folder state.
- Folder navigation.
- Selection and batch action visibility.
- Upload target follows the current folder.
- Row action menu calls the correct bridge method.

## Migration Notes

This design supersedes the flat-source-inbox parts of `2026-05-23-wiki-source-manager-design.md` for managed knowledge bases.

It does not supersede the managed runtime design. Knowledge bases remain Synapse-managed projects with hidden backing paths.

Existing uploaded files remain in their current `.raw/` date-based folders. The new file manager simply exposes those folders as the starting file tree. No data migration is required.

## Acceptance Criteria

- Users can manage `.raw/` files and folders without seeing the real runtime path.
- Users can upload files into the currently open folder.
- Users can create folders and navigate with breadcrumbs.
- Users can rename, move, and delete files and folders.
- Users can select multiple entries and batch move or delete them.
- Deletion moves entries to the system Trash.
- The UI does not show ingest status.
- The implementation does not modify `.raw/.manifest.json`.
- The implementation does not modify `wiki/`.
- The implementation does not launch Claude Code or Agent sessions.
