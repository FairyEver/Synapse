# Drive Upload Task Panel Design

## Context

The Drive module currently shows upload activity as a small status badge in the breadcrumb row, for example `正在上传 92 项`. The renderer owns only `uploading` and `uploadItemCount` state in `desktop/src/modules/drive/index.tsx`, then waits for `account.uploadDriveLocalItems(request)` to resolve. The main process uploads local files sequentially through `AccountService.uploadDriveLocalItems`, but it only returns a final summary.

This leaves users without enough feedback for large uploads. They cannot see which files are included, which file is active, how many succeeded, what failed, or whether the upload is still making progress.

## Goal

Add a Drive upload task panel that makes active and recently completed uploads inspectable without blocking normal file browsing.

Success means a user uploading dozens or hundreds of files can answer:

- What is being uploaded?
- Where is it going?
- How far along is the upload?
- Which files succeeded, failed, or were skipped?
- What should I do after failures?

## Non-Goals

- Do not build a global cross-app upload center.
- Do not persist upload history across app restarts.
- Do not add pause, resume, or bandwidth controls.
- Do not claim byte-level speed or remaining time until the upload pipeline emits reliable byte progress.
- Do not change Drive storage rules, COS domains, permissions, or quota policy.

## Product UX

### Entry Point

Keep the current breadcrumb-row status location, but make the upload badge an actionable status button:

- Hidden when there is no active task and no recent result worth showing.
- `正在上传 N 项` while an upload task is active.
- `上传失败 N 项` when the latest task finished with failures.
- `已上传 N 项` briefly after a fully successful task.

Clicking the status button opens the upload task panel.

### Panel Shape

Use the existing `desktop/src/components/ui/sheet.tsx` right-side `Sheet` within the Drive module. It should not block browsing, opening folders, renaming, deleting, or sharing existing files. It should follow existing shadcn/Radix and Tailwind token rules.

Panel layout:

- Header: `上传` plus a close button.
- Summary row: completed count, total count, failed count when present, destination path.
- Progress: one compact `Progress` bar. First implementation uses item-count progress.
- Current item: file name, relative path when available, size when known, current phase.
- File list: rows with icon, file name, relative path, size, and status.
- Footer: `重试失败项` only when there are failed retryable items.

Use restrained operational copy. Avoid explanatory paragraphs.

### File Statuses

Use these statuses in the UI model:

- `queued`: 等待中
- `preparing`: 准备中
- `uploading`: 上传中
- `completed`: 已上传
- `skipped`: 已跳过
- `failed`: 失败

Status must not rely on color alone. Each row should expose text status, and failures should include a short error message when available.

### Large Upload Behavior

The list should remain usable for up to the existing `DRIVE_LOCAL_UPLOAD_MAX_FILES` limit. Render it as a scrollable table/list inside the panel. The panel should show file paths compactly, with file names as the scan target and relative paths as muted metadata.

The status button stays visible while the user navigates to another Drive folder. The panel shows the original destination path for the task, not the current folder after navigation.

## Architecture

### Renderer State

Introduce an upload task view model in the Drive module, separate from the existing `items` list state:

- `id`: stable renderer-generated task id.
- `parentId`: destination folder id at upload start.
- `destinationPath`: breadcrumb label at upload start.
- `status`: `running | completed | failed`.
- `totalItems`, `completedItems`, `failedItems`, `skippedItems`.
- `items`: flattened upload entries.
- `startedAt`, `finishedAt`.

Flatten `DriveLocalUploadRequest` before upload starts:

- File upload entries map directly from file items.
- Folder upload entries map from `folder.files`, preserving `folderName` and `relativePath`.
- Empty folder directories may be represented in summary counts if the backend reports completed directories, but the first panel list focuses on file rows.

The old `uploading` and `uploadItemCount` state can be replaced by this task model or derived from it.

### Main Process Progress Events

Extend the local upload IPC path so the main process can emit progress events for the active invocation.

Proposed event payload:

```ts
type DriveLocalUploadProgressEvent =
  | { type: "item-started"; taskId: string; itemKey: string }
  | { type: "item-completed"; taskId: string; itemKey: string }
  | { type: "item-skipped"; taskId: string; itemKey: string; message?: string }
  | { type: "item-failed"; taskId: string; itemKey: string; message?: string }
  | { type: "task-finished"; taskId: string; result: DriveLocalUploadResult }
```

`itemKey` should be deterministic from the request entry, such as `file:<path>` for file items and `folder:<folderName>/<relativePath>` for folder entries. It must not be shown as a raw local path in UI. The renderer uses it only to match progress to rows.

The renderer sends `taskId` with `uploadDriveLocalItems`. The IPC handler passes a progress callback into `AccountService.uploadDriveLocalItems`. The service emits events when each file starts and when it completes, skips, or fails.

### Error Handling

If request building fails before upload starts, keep the current toast behavior and do not open an empty task panel.

If permission checks fail before service execution, create no active task or immediately mark the task failed with a top-level error. The UI should not expose raw sensitive paths beyond the already selected file names and relative paths.

If the progress event stream fails but the upload promise resolves, use the final summary to reconcile task totals.

If the upload promise rejects, mark the task failed and show the sanitized error message from the existing Drive error helper.

### Retry

Retry is limited to failed file rows from the latest task. The retry action builds a new `DriveLocalUploadRequest` using the original request entries for failed items and the original destination `parentId`.

Skipped items are not retried by default because they usually indicate invalid paths, duplicates, unreadable local files, or selection metadata problems.

### Accessibility

- The status button uses an accessible label that includes the current upload state and counts.
- The progress bar exposes `aria-valuemin`, `aria-valuemax`, and `aria-valuenow`.
- The panel list is keyboard scrollable.
- Failure rows include visible text, not only destructive coloring.

## Testing

Renderer tests:

- Uploading files opens and updates the status button with active counts.
- Clicking the status button opens the panel.
- The panel shows file names, relative paths, sizes, destination path, and statuses.
- Navigating folders during upload keeps the task destination stable.
- Progress events update row statuses and aggregate counts.
- Final successful result shows completed summary and refreshes current Drive items.
- Failures show failed rows and enable retry.

Main process tests:

- `uploadDriveLocalItems` accepts a task id and emits item progress events for file uploads.
- Folder uploads emit events per file.
- Skipped and failed files emit sanitized status messages.
- Permission failures still run through existing guarded local upload checks.

## Release Note

When implemented, add a user-facing pending release note under 功能优化:

`云盘上传新增任务面板，批量上传时可以查看目标位置、文件列表、整体进度和失败项。`
