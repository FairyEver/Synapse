# Web Drive Console Alignment Design

Date: 2026-06-29
Scope: `dashboard/`, `server/`, `shared/`, `docs/`

## Goal

Bring the web console Drive experience in line with the desktop client's cloud-side Drive capabilities. A user should be able to manage Synapse Drive from the web console with the same cloud model they see in the desktop client: files and folders, public links, sites, public assets, trash, previews, inline editing, comments, and version history.

The web version intentionally does not implement local machine capabilities. It does not show or manage Drive sync, and it does not support folder upload.

## Confirmed Decisions

- Use a dedicated web Drive Console shell instead of turning the existing browser/preview component into a full management surface.
- Keep the current web preview and reader stack for file rendering, Markdown editing, comments, Markdown image import, and version history.
- Align the web console information architecture with the desktop Drive module.
- Show root system entries for `公开素材` and `回收站`.
- Add top-level web console actions: `上传文件`, `新建文件夹`, `我的分享`, `站点`, and `刷新`.
- Support web file upload through button selection and drag-and-drop of loose files.
- Reject folder upload on the web. Dropped folders are skipped with a short unsupported message.
- Do not expose Drive sync in the web console. No sync status button, no local binding entry, and no sync conflict UI.
- Do not reuse desktop Electron bridge code in the web console. Web actions use dashboard API calls.
- Keep UI styling within the existing dashboard shadcn/Tailwind conventions. No custom colors, decorative gradients, card nesting, or explanatory product copy.

## Non-Goals

- Do not implement web folder upload.
- Do not implement local sync, local path binding, or sync conflict management in the web console.
- Do not refactor the desktop Drive module into shared UI components in this project.
- Do not create a new Drive data model or upload protocol.
- Do not duplicate the renderer/preview logic that already exists under `dashboard/src/features/drive-browser/`.
- Do not add a separate visual system for the web Drive console.

## Current State

The server already exposes most user Drive APIs:

- `POST /api/drive/uploads/prepare`
- `POST /api/drive/uploads/:sessionId/complete`
- `POST /api/drive/uploads/:sessionId/cancel`
- `POST /api/drive/folders`
- `PATCH /api/drive/items/:id`
- `DELETE /api/drive/items/:id`
- `GET /api/drive/trash`
- `POST /api/drive/items/:id/restore`
- `DELETE /api/drive/trash/:id`
- `POST /api/drive/items/:id/share`
- `DELETE /api/drive/shares/:id`
- `GET /api/drive/shares`
- `GET /api/drive/usage`
- `GET /api/drive/browser/owner/root`
- `GET /api/drive/browser/owner/items/:itemId`
- site, public asset, file version, annotation, and Markdown image-source endpoints.

The current web console Drive page mostly behaves like a browser and preview surface. It can browse folders, open previews, edit supported text/Markdown files, comment, and use existing reader tools. It lacks the management shell that the desktop client has.

The desktop client has a richer Drive module with capacity status, file upload, folder upload, drag upload, folder creation, share management, site publishing, public assets, trash, refresh, and sync. For the web alignment project, only cloud-side features are in scope.

## Information Architecture

```text
Web Drive Console
├─ Header actions
│  ├─ 上传文件
│  ├─ 新建文件夹
│  ├─ 我的分享
│  ├─ 站点
│  └─ 刷新
├─ Capacity
│  └─ used bytes / quota bytes
├─ Breadcrumbs
│  └─ 根目录 / child folders
├─ Main table
│  ├─ root system entries
│  │  ├─ 公开素材
│  │  └─ 回收站
│  ├─ folder rows
│  │  ├─ enter
│  │  ├─ share / cancel share
│  │  ├─ preview
│  │  ├─ delete
│  │  └─ more: publish site, rename, move
│  └─ file rows
│     ├─ preview / edit through existing renderer
│     ├─ share / cancel share
│     ├─ delete
│     └─ more: rename, move
├─ Dialogs
│  ├─ create folder / rename
│  ├─ move target tree
│  ├─ share settings
│  ├─ share success
│  ├─ my shares
│  ├─ publish site
│  └─ sites
└─ Subviews
   ├─ public assets
   └─ trash
```

The web console should remain dense and task-focused. Empty, loading, and error states use short operational text only.

## Frontend Architecture

Add a web management shell under a dashboard feature area. The final exact file split can follow implementation pressure, but the intended boundaries are:

```text
dashboard/src/features/drive-console/
├─ drive-console-page.tsx
├─ use-drive-console.ts
├─ drive-file-table.tsx
├─ drive-upload.ts
├─ drive-share-dialogs.tsx
├─ drive-move-dialog.tsx
├─ drive-trash-view.tsx
├─ drive-public-assets-view.tsx
└─ drive-sites-dialogs.tsx
```

Responsibilities:

- `drive-console-page.tsx` owns the page shell, active view, toolbar, breadcrumbs, and dialogs.
- `use-drive-console.ts` owns the current folder, item loading, usage loading, refresh, and mutation orchestration.
- `drive-upload.ts` owns web `File` upload sequencing.
- `drive-file-table.tsx` owns the file list, root system entries, row actions, drag state, and keyboard-accessible row behavior.
- Share, move, trash, public asset, and site files own their respective dialogs or subviews.

Reuse:

- Continue using `dashboard/src/features/drive-browser/renderers/*` for file rendering and editing.
- Continue using `dashboard/src/features/drive-browser/shared/*` for icons, formatting, and view-model helpers when practical.
- Continue using `@synapse/shared` DTOs, URL helpers, and Drive constants.
- Use the existing dashboard `@/components/ui/*` primitives and existing API client style.

Avoid:

- Direct imports from `desktop/src/modules/drive/*`.
- Desktop `window.synapse` bridge concepts.
- Sync DTOs or sync UI in the web console.
- New component libraries or custom CSS modules.

## API Client

Extend `dashboard/src/lib/api.ts` with user Drive methods that mirror existing server endpoints. Keep this as the single web API client layer for dashboard Drive mutations.

Required user Drive methods:

```text
driveApi
├─ getUsage()
├─ prepareUpload(input)
├─ completeUpload(sessionId)
├─ cancelUpload(sessionId)
├─ createFolder(input)
├─ renameItem(itemId, name)
├─ moveItem(itemId, parentId)
├─ deleteItem(itemId)
├─ listTrash(options)
├─ restoreTrashItem(itemId)
├─ deleteTrashItem(itemId)
├─ createShare(itemId, settings)
├─ disableShare(shareId)
├─ getShare(shareId)
├─ listShares(options)
├─ site preflight/create/list/update/disable/enable/delete/republish
└─ public asset list/upload/replace/rename/trash/restore/download helpers
```

The existing `driveBrowserApi` remains responsible for browser snapshots, share browsing, inline text save, annotations, and Markdown image-source operations.

## Upload Design

Web upload supports selected or dropped loose files only.

```text
File[]
├─ filter unsupported folder entries
├─ for each file
│  ├─ prepareUpload(parentId, name, size, mimeType)
│  ├─ fetch(prepared.upload.url, PUT, headers, body: file)
│  ├─ completeUpload(sessionId)
│  └─ on PUT/complete failure: try cancelUpload(sessionId)
└─ refresh current folder and usage
```

Rules:

- Multiple files are allowed.
- A failure for one file does not stop the remaining files.
- Upload result is summarized by completed, failed, and skipped counts.
- Same-name overwrite behavior remains owned by the server.
- The web client never sends local filesystem paths.
- The web client does not call `/uploads/folder/prepare`.
- Dragging a folder skips that folder. If the browser exposes nested files through directory drag APIs, the web console still treats folder upload as unsupported and does not reconstruct a folder manifest.
- Upload controls are disabled while a web upload batch is running.

## File Management

Folder navigation should be consistent with the current web browser URLs, so existing deep links remain useful. The console shell can still use `DriveBrowserSnapshotDto` for the current folder because it already provides breadcrumbs, children, browser URLs, download URLs, preview kind, and share state.

Actions:

- `新建文件夹` creates a folder in the current folder.
- `重命名` updates a file or folder name.
- `移动` opens a folder tree and moves the item to the selected target.
- `删除` moves the item to trash.
- `预览` opens the existing browser/renderer flow.
- `下载` uses existing download URLs where exposed. Folder download remains available where `canZip` and `downloadUrl` allow it.

Row actions should mirror the desktop order where practical:

```text
分享 / 取消分享 | 预览 | 删除 | 更多
```

`更多` includes cloud-only actions:

```text
folder: 发布站点, 重命名, 移动
file: 重命名, 移动
```

There is no `同步` action.

## Sharing

Share settings should match the desktop client:

```text
分享设置
├─ 权限
│  ├─ 可阅读
│  ├─ 登录用户可编辑
│  └─ 指定用户可编辑
├─ 可编辑用户
├─ 需要密码
└─ 有效时长
   ├─ 3 天
   ├─ 7 天
   ├─ 30 天
   ├─ 1 年
   └─ 永久
```

After share creation, show a compact success dialog with:

- access link
- password if enabled
- expiration
- permission summary
- copy and open actions

`我的分享` lists file and folder shares, grouped or tabbed by item type. It supports copying the link, copying the password when present, opening the link, and canceling the share.

## Sites

The web console should expose the same cloud-side site actions as the desktop client:

- Publish a folder as a site from the folder row.
- Open `站点` from the toolbar.
- List sites.
- Update access settings.
- Disable and enable a site.
- Republish a site.
- Delete a site record.

Site publishing uses the existing server preflight and create flow. The UI should surface only necessary status and action text.

## Public Assets

`公开素材` appears as a root system entry. Opening it switches the main content area to the public asset view.

Capabilities:

- list public assets
- upload image files
- replace an asset file
- rename an asset
- copy/open the public asset URL
- move an asset to trash
- refresh and paginate

Use the existing shared public asset image MIME restrictions. The web version may upload files directly from `File` objects through the server's existing public asset upload prepare/complete flow.

## Trash

`回收站` appears as a root system entry. Opening it switches the main content area to the trash view.

Capabilities:

- list trashed Drive items and public assets
- restore an item
- remove an item from trash
- refresh and paginate

Restoring or removing an item refreshes usage where the server result can affect quota.

## Error Handling

```text
Auth expired
└─ use existing dashboard auth-expired handling

Directory load failure
├─ show compact error state
└─ provide retry

Upload failure
├─ prepare failure: mark file failed and continue
├─ PUT failure: try cancel session, mark failed, continue
├─ complete failure: try cancel session, mark failed, continue
├─ all failed: toast upload failure summary
└─ partial success: toast completed / failed / skipped summary

Folder dropped
└─ skip and show a short unsupported message

Create / rename / move
├─ keep dialog data on failure
└─ show the server error text when available

Delete / restore / cancel share
├─ row-level busy state
├─ refresh current view on success
└─ show short failure toast on error
```

The UI should avoid exposing storage keys, signed URL internals, or raw server implementation details. It should not log credentials or upload URLs in normal UI state.

## Compatibility

Existing routes should remain valid:

- `/console/drive`
- `/console/drive/folders/:folderId`
- owner item browser URLs
- share browser URLs
- standalone owner file reader URLs

The management shell should not break existing single-file reader behavior. When a route targets a file, the existing reader/renderer can remain the primary view. When a route targets a folder or root, the console management shell renders the table and cloud actions.

## Testing Plan

API tests:

- User Drive methods serialize paths, query strings, and request bodies correctly.
- Protected user Drive mutations participate in existing auth-expired handling.
- Upload helper sends `File` as the PUT body and calls complete after a successful PUT.
- Upload helper tries cancel after PUT or complete failure.

Component and hook tests:

- Root console shows `公开素材` and `回收站`.
- Toolbar shows `上传文件`, `新建文件夹`, `我的分享`, `站点`, `刷新`, and does not show `同步`.
- Selecting multiple files uploads them to the current folder.
- Dropping loose files uploads them to the current folder.
- Dropping folders skips them and does not call folder upload prepare.
- Create folder, rename, move, delete, share, and cancel share call the correct APIs and refresh state.
- Share settings send access mode, password setting, expiry, and editor emails consistently with desktop semantics.
- My Shares can copy/open links and cancel shares.
- Public assets can upload, replace, rename, open/copy, trash, paginate, and refresh.
- Trash can restore and remove items.
- Site dialogs call preflight, create, list, access update, enable/disable, republish, and delete APIs.

Regression tests:

- Existing owner browser snapshot loading still works.
- Existing share browser loading, password unlock, and invalid-share state still work.
- Markdown editing, comments, version history, and Markdown image-source import remain functional.
- Existing deep links continue to open the correct folder or file.

## Implementation Notes

- Prefer TanStack Query and existing dashboard API patterns for data loading and mutations.
- Keep mutation orchestration outside JSX-heavy rendering components.
- Extract repeated formatting, result summaries, and upload sequencing into small helpers.
- Keep table column sizing stable and use right-aligned numeric columns.
- Use existing shadcn components for dialogs, tables, dropdowns, buttons, inputs, switches, tabs, progress, badges, empty states, and alerts.
- Keep copy concise: labels, actions, loading, empty, and error states only.
