# Wiki Source Manager Design

## Goal

Replace the current "open `.raw` in system file manager" workflow with a Synapse-native source manager for knowledge base projects.

Users should not need to understand `.raw`, folder structure, or manual file organization. They should be able to open a Synapse dialog, see existing source files, search by file name, drag new files into the dialog, and then import them into the knowledge base.

## Product Positioning

The feature should be presented as **资料管理** rather than **文件管理**.

The user mental model is:

1. Put source materials into Synapse.
2. Synapse keeps the original files organized.
3. Click import to update the knowledge base.

The UI should not expose `.raw` as a primary concept. `.raw` remains the Obsidian-compatible storage implementation.

## First Version Scope

The first version includes:

- A Synapse-native source manager dialog or window for knowledge base projects.
- A drag-and-drop upload area.
- A file picker upload action.
- Automatic copy into `.raw/YYYY/MM/DD/`.
- A flat source list of all supported and unsupported uploaded files.
- File name search.
- Source status display.
- A primary "导入知识库" action that triggers the existing wiki ingest flow.

The first version excludes:

- User-created folders.
- Moving files.
- Renaming files.
- Deleting files.
- File preview.
- Full-text search.
- User-defined categories or tags.

These exclusions are deliberate. The feature is a source inbox, not a general file manager.

## Entry Point

Knowledge base projects should show a **资料管理** action where the current raw-directory maintenance action lives.

Clicking **资料管理** opens the Synapse-native source manager. It should not open Finder or the OS file manager.

The existing OS-folder behavior can remain as a developer or fallback capability later, but it should not be the normal user path.

## Dialog Structure

The first version should use a restrained internal-tool layout:

```text
资料管理

[搜索资料]

拖拽文件到这里
或 [选择文件]

全部资料
文件名              状态        上传时间
部门职责.md        待导入      今天 13:50
会议纪要.txt       已导入      昨天 18:20
产品资料.pdf       暂不支持    今天 14:10

[导入知识库]
```

The list is flat even though the on-disk layout is date-based.

Default sort order: newest upload first.

Optional grouping can be added with date buckets such as "今天", "昨天", and "更早", but this is presentation only and should not imply user-managed folders.

## Storage Rules

Uploaded files are copied into the current project under:

```text
.raw/YYYY/MM/DD/
```

Example:

```text
.raw/2026/05/23/部门职责.md
```

If a file with the same name already exists in the target date folder, Synapse should create a non-conflicting name, for example:

```text
部门职责-2.md
```

The original source file outside Synapse must not be modified.

The user should not choose the target folder in the first version.

## Source Status

Each source row should display one status:

- `待导入`: source file is not present in `.raw/.manifest.json`.
- `有变化`: source hash differs from the manifest entry.
- `已导入`: source hash matches the manifest entry.
- `暂不支持`: file type is not currently processed by wiki ingest.
- `读取失败`: Synapse could not read the source file.

The status should come from the same deterministic scan logic used by `/wiki status` and `/wiki ingest`, so the UI and command behavior stay consistent.

## Upload Behavior

Users can add files by dragging them into the dialog or by clicking **选择文件**.

After files are copied, the dialog should refresh the source list and show a short result state such as:

```text
已添加 3 个文件
```

Upload should not automatically run ingest. The next step is explicit:

```text
导入知识库
```

This keeps file intake and knowledge extraction separate.

## Import Behavior

The **导入知识库** action should trigger the existing wiki ingest behavior.

The user should see product language, not slash command language. Internally, this can route through the same command path as:

```text
/wiki ingest
```

If there are no changed sources, the UI should show that no import is needed.

## Technical Shape

Renderer:

- Add a knowledge base source manager UI.
- Handle drag-over/drop and file picker interactions.
- Call narrow preload APIs for source listing and upload.
- Render source rows from typed IPC results.

Preload:

- Expose knowledge-base source APIs under `window.synapse.knowledgeBase`.
- Do not expose broad filesystem access.

Electron main process:

- Add guarded IPC methods for:
  - listing source files,
  - uploading/copying files into `.raw/YYYY/MM/DD/`,
  - optionally invoking or routing ingest.
- Reuse existing knowledge base path safety checks.
- Continue using PermissionGuard and AuditSink for filesystem writes.

Knowledge base service:

- Extend the existing service rather than creating a parallel raw-file service.
- Reuse source scan logic for statuses.
- Add copy logic with path normalization, symlink checks, and collision-safe names.

## Cost Estimate

MVP cost: 3-5 development days.

This includes:

- Source manager UI.
- Drag-and-drop upload.
- File picker upload.
- Date-based raw storage.
- Source list.
- File name search.
- Status display.
- Import button wiring.
- Focused tests.

Features that should remain later-phase:

- File preview: +2-4 days.
- Delete/rename/move: +2-3 days.
- PDF/Word text extraction: +3-7 days.
- Full-text search or OCR: +1-2 weeks.

## Product Decision

Use automatic date-based storage and hide folder organization from users.

This keeps the product simple and prevents users from needing to design a filing system before they can use the knowledge base. The knowledge structure should be created in `wiki/`; `.raw` should remain an original-source archive managed by Synapse.

