# Knowledge Base File Management Design

## Summary

Upgrade the managed Knowledge Base source manager from a lightweight raw file list into a more natural file-management surface.

Users can copy files and folders into the current Knowledge Base raw folder, preserve folder structure, move items inside the raw tree by dragging them to explicit folder targets, and export files or folders through row and batch actions.

This design extends the existing `.raw/` file manager. It does not convert files, ingest sources, update `.raw/.manifest.json`, rewrite `wiki/`, or trigger Agent / Claude Code sessions.

## Context

The current source manager already follows the raw file manager product direction:

- users manage only `.raw/` source files,
- the renderer sees typed raw entries and relative paths,
- Electron validates all raw paths,
- deletion uses the system Trash,
- uploads currently accept files and skip folders.

This design intentionally changes the older first-version rule that dropped folders are skipped. Folder import is now a first-class file-management capability.

The user goal is not another ingestion flow. The goal is a familiar source-material manager where users can organize files with the same basic expectations they have in Finder or a lightweight cloud drive.

## Goals

- Support external file drag-in.
- Support external folder drag-in with recursive copy and preserved structure.
- Add separate toolbar actions for uploading files and uploading folders.
- Add row-level export for one file or one folder.
- Add batch export for selected files and folders.
- Add internal drag-to-folder movement for one or more selected raw entries.
- Keep collision handling consistent for import and export.
- Keep the managed Knowledge Base boundary intact.
- Keep UI copy short and operational.

## Non-Goals

- No conversion during file or folder upload.
- No source ingestion.
- No `.raw/.manifest.json` writes.
- No `wiki/` writes or reference repair.
- No Agent, Claude Code, Workflow, or Scheduler invocation.
- No drag-out-to-Finder export.
- No custom file preview, grid view, recursive search, sorting controls, or file type filters.
- No user access to the real managed backing path.
- No management of `wiki/`, `_attachments/`, `.vault-meta/`, runtime plugins, commands, skills, hooks, or scripts.

## Hard Rules

- All visible and mutable entries remain scoped to `.raw/`.
- Renderer-supplied raw paths are `.raw`-relative and must be validated in Electron.
- Raw operations must not escape `.raw/`.
- Recursive copy must use `lstat` and must not follow symlinks.
- Symlinks are skipped on import and export.
- Common system noise files are skipped, including `.DS_Store`, `Thumbs.db`, and `desktop.ini`.
- Hidden user files are not skipped solely because they start with `.`.
- No operation overwrites an existing file by default.
- Folder collisions merge recursively.
- File collisions use an available name such as `report-2.pdf`.
- Export is triggered only by buttons or menus, not by dragging entries out of the app.
- Ordinary projects must not receive Knowledge Base file-manager behavior.

## Product Behavior

### Import

Users can import from outside Synapse into the currently open folder:

```text
+-------------------+        +-------------------------+
| Desktop / Finder  | -----> | Knowledge Base .raw/    |
| files and folders |        | current folder          |
+-------------------+        +-------------------------+
```

Supported entry points:

- drag files into the right pane,
- drag folders into the right pane,
- click `上传文件` and choose one or more files,
- click `上传文件夹` and choose one folder.

Folder upload copies the folder itself into the current directory and preserves its inner structure.

Example:

```text
External:
会议资料/
  01.pdf
  访谈/
    a.md

Current raw folder:
资料/项目A/

Result:
资料/项目A/会议资料/
  01.pdf
  访谈/
    a.md
```

If `资料/项目A/会议资料/` already exists, Synapse merges into that folder. If a destination file already exists, Synapse creates a collision-safe name.

### Internal Move

Users can move raw entries inside the Knowledge Base by dragging to explicit folder targets:

```text
Allowed targets:
  - a folder row in the right list
  - a folder node in the left tree

Not a target:
  - right-pane blank space
  - a file row
  - the dragged folder itself
  - a descendant of the dragged folder
```

Dragging behavior:

```text
Drag unselected entry       -> move that entry
Drag one selected entry     -> move all selected entries
Drag selected group         -> move all selected entries
```

Internal drag movement is a move operation, not a copy operation.

### Export

Export is available from row actions and the batch selection bar:

```text
Row menu:
  file:   重命名 / 移动 / 导出 / 删除
  folder: 打开 / 重命名 / 移动 / 导出 / 删除

Batch bar:
  已选择 2 项        移动  导出  删除
```

Export opens a directory picker in Electron. Synapse copies the selected raw entries into the chosen external folder.

Exporting a folder keeps the folder shell:

```text
Raw:
会议资料/
  01.pdf

Export target:
Desktop/

Result:
Desktop/会议资料/
  01.pdf
```

If the export target already contains a folder with the same name, Synapse merges into it. If a file already exists, Synapse writes a collision-safe copy.

## UI Design

Keep the current two-pane source manager:

```text
+------------------+---------------------------------------------+
| 资料             | 资料 / 项目A / 会议纪要                     |
| +- 项目A         | [搜索当前文件夹] [上传文件] [上传文件夹] [新建文件夹] |
| |  +- 会议纪要   |                                             |
| +- 截图          | 已选择 2 项              [移动] [导出] [删除] |
|                  | ------------------------------------------- |
|                  | [ ] [folder] 访谈资料        ...            |
|                  |     文件夹 · 06/02 14:12                    |
|                  | [ ] [file]   需求.pdf        ...            |
|                  |     2.4 MB · 06/02 14:10                    |
+------------------+---------------------------------------------+
```

Toolbar actions:

- `上传文件`
- `上传文件夹`
- `新建文件夹`
- current-folder search

Do not place a global export button in the toolbar. Export belongs to a row target or selected entries.

Drag states:

```text
External drag over right pane:
+----------------+
|    松开上传     |
+----------------+

Internal drag over valid folder target:
+----------------+
| target highlight |
+----------------+
```

Use existing shadcn/Radix components, lucide icons, and theme token classes. Do not add custom colors, gradients, glow, decorative copy, nested cards, or page-specific CSS.

## Technical Design

### Files

Primary renderer:

- `desktop/src/modules/knowledge-base/source-manager-window.tsx`

Primary Electron service:

- `desktop/electron/services/knowledge-base/raw-file-manager.ts`

Primary IPC module:

- `desktop/electron/modules/knowledge-base/ipc.ts`

Shared types:

- `desktop/src/types/knowledge-base.ts`

Focused tests:

- `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`
- `desktop/electron/services/knowledge-base/__tests__/raw-file-manager.test.ts`
- `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`

### Service API

Extend the existing raw file manager instead of creating a parallel service.

Conceptual service surface:

```ts
class KnowledgeBaseRawFileManager {
  list(...)
  createFolder(...)
  uploadFiles(...)
  uploadItems(...)      // accepts external files and directories
  exportEntries(...)    // copies raw files/directories to an external target
  renameEntry(...)
  moveEntries(...)
  trashEntries(...)
}
```

`uploadFiles` remains available for existing file-only callers. New file-manager import paths use `uploadItems`, which accepts external file and directory paths and applies recursive copy rules.

### IPC

Add typed bridge methods for:

- selecting and uploading a raw folder into the current raw directory,
- exporting raw entries to a user-selected external directory.

New bridge methods:

```text
uploadRawItems
selectAndUploadRawDirectory
exportRawEntries
```

External drag-in uses `uploadRawItems`. The dedicated folder button uses `selectAndUploadRawDirectory`. Export uses `exportRawEntries`.

### Permission And Audit

Use existing permission and audit infrastructure.

Import:

```text
read external file/folder path  -> fs.read.outside-userdata
write managed .raw             -> fs.write managed-knowledge-base:<projectId>
```

Export:

```text
read managed .raw              -> guarded managed-knowledge-base read operation
write selected external folder -> fs.write with target resource
```

Internal move:

```text
write managed .raw -> fs.write managed-knowledge-base:<projectId>
```

The renderer must not receive the real managed backing path or perform filesystem writes directly.

### Recursive Copy Rules

Recursive copy uses these rules for both import and export:

- inspect entries with `lstat`,
- skip symbolic links,
- skip common system noise files,
- recursively create destination folders,
- merge folder collisions,
- copy files with exclusive creation,
- retry file collisions with `-2`, `-3`, and so on,
- return created entries plus skipped items.

## Error Handling

Use partial-success results where possible.

Result shape should continue to include:

```ts
{
  entries: SynapseKnowledgeBaseRawEntry[]
  skipped: Array<{ path: string; reason: string }>
}
```

Extend skip reasons as needed:

```text
not-file
not-directory
read-error
invalid-path
collision
trash-error
symlink
system-noise
export-error
```

User-visible copy stays short:

- `正在上传`
- `已上传`
- `已上传 12 项，跳过 2 项`
- `正在导出`
- `已导出`
- `导出失败`
- `正在移动`
- `已移动`

Renderer failures continue to use `useAppNotifications`. Logging continues to use `createRendererLogger` and Knowledge Base structured service logs. Do not introduce production `console.log`.

## Testing

### Electron Service

Cover:

- recursive folder import preserves structure,
- folder collision merges recursively,
- file collision creates a safe copy name,
- symlinks are skipped,
- `.DS_Store`, `Thumbs.db`, and `desktop.ini` are skipped,
- hidden user files such as `.gitignore` are copied,
- exporting one file copies it to the chosen directory,
- exporting one folder keeps the folder shell,
- exporting multiple selected entries works,
- export collision handling matches import collision handling,
- path traversal is rejected,
- raw symlinks are not followed.

### IPC

Cover:

- selecting a folder calls the raw folder upload path,
- canceled folder selection returns an empty mutation result,
- folder upload checks external read permission before writing managed raw content,
- export opens a directory picker,
- canceled export returns an empty mutation result,
- export checks permission and records audit,
- schemas accept the new payloads and reject invalid values.

### Renderer

Cover:

- toolbar renders `上传文件` and `上传文件夹`,
- upload-file button calls the existing file picker path,
- upload-folder button calls the new folder picker path,
- external dropped folder paths are sent to the upload path,
- row menu renders `导出`,
- selected entries show batch `导出`,
- row export calls the bridge with one path,
- batch export calls the bridge with selected paths,
- internal drag to a folder row calls `moveRawEntries`,
- internal drag to a left-tree folder calls `moveRawEntries`,
- dragging selected entries moves the selected group,
- dragging to invalid targets does not call move.

## Release Notes

When implementation lands, update `RELEASE_NOTES_PENDING.md` with a user-facing note such as:

```text
- 知识库资料管理支持上传文件夹、批量导出，以及拖拽整理文件；文件夹结构会保留，同名文件会自动保留副本，避免覆盖。
```

## Acceptance Criteria

- Users can upload folders through a dedicated button.
- Users can drag files and folders into the current raw folder.
- Imported folder structure is preserved.
- Upload and export do not convert, ingest, or update manifest/wiki content.
- Users can export one file or one folder from the row menu.
- Users can export multiple selected entries from the batch bar.
- Exporting folders keeps the folder shell.
- Import and export never overwrite existing files by default.
- Internal drag-to-folder movement works for single and selected entries.
- Internal drag targets are limited to explicit folder rows and folder tree nodes.
- Symlinks are skipped and never followed.
- Common system noise files are skipped.
- The real managed Knowledge Base path remains hidden from the renderer and user UI.
- UI uses existing shadcn/Radix components, lucide icons, and token classes.
