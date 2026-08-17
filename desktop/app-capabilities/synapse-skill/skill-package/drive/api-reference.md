# Synapse Drive MCP API Reference

Use these tools only for Synapse Drive files, folders, shares, public assets, trash, quota, and reorganization.

## File And Folder Tools

### `app_drive_item_list`

List files and folders under a parent folder.

Input:

- `parentId` optional: folder item id. Omit or pass `null` for Drive root.
- `offset` optional: pagination offset. Defaults to `0`.
- `limit` optional: page size. Defaults to the service page size.

Output:

- `items`: page of files and folders.
- `page.hasMore`: whether another page exists.
- `page.nextOffset`: pass this as `offset` for the next page when `hasMore` is true.

### `app_drive_item_get`

Get metadata for one file or folder. This does not open, download, or share it.

Input:

- `itemId` required: Drive item id.

### `app_drive_file_upload`

Upload one local file to Drive once. This does not create persistent sync. A same-name file in the target folder is overwritten while preserving its item id and share links.

Input:

- `filePath` required: absolute local file path.
- `parentId` optional: target folder id. Omit or pass `null` for Drive root.
- `name` optional: Drive display name; defaults to local basename.
- `mimeType` optional.

### `app_drive_folder_upload`

Upload a local folder to Drive once. This does not create persistent sync. Relative paths are preserved, including empty subdirectories. Same-name folders are merged and same-name files are overwritten.

Input:

- `folderPath` required: absolute local folder path.
- `parentId` optional: target folder id. Omit or pass `null` for Drive root.
- `folderName` optional: Drive folder name; defaults to local basename.

Limits:

- The local preflight stops before upload when the folder contains more than 1,000 files, more than 1,000 subdirectories, or exceeds the supported folder depth.

Uploading a folder preserves the layout needed by relative images in `.md` and `.markdown`. Cloud preview, online editing, and Markdown file shares can resolve supported raster images from that Drive tree without rewriting the Markdown or converting images to public assets.

Output:

- `root`: root Drive folder item.
- `uploadedFiles`: successful file uploads, each with `relativePath` and `item`.
- `createdDirectories`: preserved directory paths, each with `relativePath`.
- `failures`: failed file uploads, each with `relativePath` and `error`.

### `app_drive_folder_create`

Create a Drive folder.

Input:

- `name` required: folder name.
- `parentId` optional: parent folder id. Omit or pass `null` for Drive root.

### `app_drive_item_rename`

Rename a Drive file or folder. Existing item id and share links are preserved.

Input:

- `itemId` required.
- `name` required: new item name.

### `app_drive_item_move`

Move a Drive file or folder.

Input:

- `itemId` required.
- `parentId` required: target folder id. Pass `null` to move to Drive root. Do not omit this field.

### `app_drive_item_delete`

Move a Drive file or folder to Drive trash.

This temporarily disables `/share/...` links for the deleted item and its folder subtree. Restoring the item reactivates share links disabled by that delete operation; shares manually disabled before the delete stay disabled.

Input:

- `itemId` required.

### `app_drive_item_preview_get`

Get the owner preview snapshot for a Drive item. This returns browser state and available URLs without creating a share.

Input:

- `itemId` required.
- `surface` optional: `standalone` or `console`.
- `childrenOffset` optional: folder child pagination offset.
- `childrenLimit` optional: folder child pagination page size.

For `.md` and `.markdown`, `preview.relativeImages` contains each supported relative image source and its `resolvedUrl`. A non-null URL means the current Drive directory tree resolves that PNG, JPG/JPEG, WebP, GIF, AVIF, or ICO reference. The Markdown content and saved file keep the original relative source unchanged. Standard `/` paths may be bare relative paths or start with `./` or one or more `../` segments. Explicit Windows-style `.\` and `..\` paths are accepted as compatibility input only when every path separator is a backslash; a bare path such as `images\diagram.png` is not accepted, and generated references should use `/`. Resolution covers the current 128 KiB Markdown preview and at most 256 unique relative image sources. This does not apply to `.mdx`, root-relative paths, SVG, or relative HTML resources.

For `.md`, the browser snapshot may also advertise browser-only realtime collaboration and include a Markdown projection used by the web comment UI. These fields do not create MCP collaboration, presence, comment, or anchor operations. MCP content changes remain explicit Drive versions and may replace the active browser collaboration Epoch.

### `app_drive_file_content_read`

Read previewable small text content from a Drive file. Use download for binary, oversized, or non-previewable files.

Input:

- `itemId` required: Drive file item id.
- `maxBytes` optional: maximum UTF-8 bytes to return.

### `app_drive_file_download_create`

Download a Drive file to a local path. This writes to local filesystem and requires write permission.

Input:

- `itemId` required: Drive file item id.
- `outputPath` required: absolute local output path.

### `app_drive_folder_zip_create`

Download a Drive folder as a local zip file. This writes to local filesystem and requires write permission.

Input:

- `itemId` required: Drive folder item id.
- `outputPath` required: absolute local `.zip` output path.

## Local Sync Tools

These tools create and manage a persistent relationship between an owned Drive item and a stable local path while the Synapse client is running. Ordinary file and folder upload tools do not create this relationship.

### `app_drive_sync_snapshot_get`

Input: none.

Returns all current-account `bindings`, visible `operations`, open `conflicts`, `health`, and summary counts. Offline or logged-out snapshots are read-only.

### `app_drive_sync_binding_preview`

Validate a binding without creating it. Always call this before creation.

Input:

- `localPath` required: stable absolute local file or folder path. Never pass a temporary attachment or Agent cache path.
- `direction` required: `local_to_remote`, `remote_to_local`, or `bind_existing`.
- `driveItemId` required for `remote_to_local` and `bind_existing`; omit it for `local_to_remote`.
- `targetParentId` optional for `local_to_remote`: target Drive folder id. Omit or pass `null` for Drive root.
- `name` optional for `local_to_remote`: new Drive item name. Defaults to the local basename.
- `excludeRules` optional: user rules for a folder binding.
- `useDefaultExcludes` optional: defaults to `true`.
- `importGitignore` optional: import the current root `.gitignore` once. Defaults to `false`.

Output includes `status` (`ready`, `warning`, or `blocked`), selected `direction`, `reason`, local path facts, forced/default rules, and detected/imported `.gitignore` rules. Do not bypass `blocked`.

A non-blocked preview also includes `initialTransfer`:

- `totalEntries`, `fileCount`, `folderCount`, and decimal-string `totalBytes` summarize the first transfer.
- `entries` contains up to 200 `{ action, relativePath, size }` records. `relativePath: "."` is the binding root. Actions are `upload_file`, `download_file`, `create_remote_folder`, or `create_local_folder`.
- `truncated: true` means `totalEntries` is authoritative but `entries` is only the first 200 records.
- `bind_existing` has an empty transfer summary because creation validates and records the existing equal content instead of transferring it.

### `app_drive_sync_binding_create`

Uses the same input as preview. It repeats the complete safety preflight before creating the binding. A blocked preflight returns `ok: false` with the preview in `data` and creates no binding.

For `local_to_remote`, same-name Drive content is never overwritten or merged. Use `bind_existing` only when both sides already exist with the same type and exact content.

Output is the created binding, including `id`, `driveItemId`, `driveItemName`, `kind`, `localPath`, `status`, exclude rules, timestamps, and error state.

### `app_drive_sync_binding_pause`

Input: `bindingId` required. Returns the paused binding.

### `app_drive_sync_binding_resume`

Input: `bindingId` required. Resumes and catches up the binding, then returns its current state.

### `app_drive_sync_binding_remove`

Input: `bindingId` required. Stops and removes the binding without deleting local or Drive content. Returns `{ removed: true }`.

### `app_drive_sync_binding_exclude_rules_update`

Input:

- `bindingId` required: folder binding id.
- `defaults` required: complete replacement list of enabled recommended rules; may be empty.
- `importedGitignore` required: complete replacement list of imported rules; may be empty.
- `user` required: complete replacement list of user rules; may be empty.

Forced rules such as `.git/` cannot be removed. Returns the updated binding.

### `app_drive_sync_binding_rescan`

Input: `bindingId` required. Runs a complete catch-up scan and returns the refreshed binding.

### `app_drive_sync_conflict_resolve`

Input:

- `conflictId` required: open conflict id from the snapshot.
- `action` required: `keep_local`, `keep_remote`, `keep_both`, `confirm_delete`, or `skip`; it must be an explicit user choice and must appear in the conflict's `availableActions`.

`keep_local` overwrites Drive, `keep_remote` overwrites local, `keep_both` is limited to supported file conflicts, `confirm_delete` propagates a recoverable delete, and `skip` leaves the conflict open. Returns `{ resolved: true }`; call the snapshot tool for refreshed state.

## Drive Link Intake Tools

Use these tools for Synapse `/share/...`, `/sites/...`, and `/files/...` URLs sent by another person. They do not modify remote Drive content.

### `app_drive_link_resolve`

Input:

- `url` required.
- `password` optional: pass the actual password string. MCP parameters do not expand `$ENV_VAR`; read the variable first or ask the user.

Output includes `linkType`, `access`, `root`, and `ref`. When `access.status` is `password_required`, `root.type` may be `protected` and the real file/folder shape is intentionally hidden until a valid password is supplied.

Raw MCP or Codex `--json` event streams may include tool arguments. Do not save or quote logs that contain share or site passwords.

### `app_drive_link_list`

Input:

- `url` required.
- `password` optional.
- `path` optional.
- `itemId` optional.
- `offset` optional.
- `limit` optional.

Output includes `items` and `page`.

For `/share` folders, each file entry includes an `itemId`. Prefer that `itemId` for later `read_text` or `download_file` calls. For `/sites`, use the returned site-relative `path`.
Protected `/share` and `/sites` links require `password`; without it, this tool reports that the link needs a password rather than treating the link as missing.

### `app_drive_link_read_text`

Input:

- `url` required.
- `password` optional.
- `path` optional.
- `itemId` optional.
- `maxBytes` optional.

Use for Markdown, HTML source, JSON, and text, including public TXT, MD, and CSV assets. PDF, Office, and other binary files should use `app_drive_link_download_file`.

For `/share` children, prefer `itemId` from `app_drive_link_list`; `path` is primarily for `/sites` assets and share fallback lookup.
Protected `/share` and `/sites` links require `password`; without it, this tool reports that the link needs a password rather than treating the link as missing.

### Shared Markdown annotation tools

All seven tools accept:

- `url` required: current Synapse `/share/...` URL.
- `password` optional: used only for this request and never returned.
- `itemId` optional: shared Markdown item id; takes precedence over `path`.
- `path` optional: share-relative Markdown path fallback.

They reject `/sites`, `/files`, folders, and files whose name is not `.md`. They do not expose document editing, presence, or collaboration-room controls.

All list and mutation results redact author email addresses as `author.email: null`. In every returned thread, `anchor` is the current authoritative position. The legacy `target` field preserves the original quote snapshot for compatibility and can differ after reassociation; use `anchor.selectors`, `anchor.positionStatus`, and `anchor.quoteStatus` to inspect the current anchor.

### `app_drive_link_annotation_thread_list`

Returns `{ itemId, canComment, threads }`. `threads` includes every visible cross-version thread, nested comments, authoritative anchors, author-safe metadata with email addresses redacted, and projected thread/comment permissions.

### `app_drive_link_annotation_thread_create`

Additional input:

- `target` required: `{ exact, prefix?, suffix? }` visible text.
- `body` required: initial comment, at most 4000 characters.
- `idempotencyKey` required: stable 8-128 character key; reuse it when retrying the same creation.

The server resolves the current Markdown projection and version. Missing text returns `DRIVE_ANNOTATION_TARGET_NOT_FOUND`; unresolved repetition returns `DRIVE_ANNOTATION_TARGET_AMBIGUOUS`. Add visible `prefix` or `suffix` context instead of guessing.

### `app_drive_link_annotation_comment_create`

Additional input: `threadId`, optional `parentCommentId`, and `body` up to 4000 characters. Omit `parentCommentId` for a top-level thread reply.

### `app_drive_link_annotation_comment_update`

Additional input: `commentId` and replacement `body` up to 4000 characters. Only the comment author can edit it.

### `app_drive_link_annotation_comment_delete`

Additional input: `commentId`. The author or file owner can delete the selected comment. Deletion also removes all descendant replies regardless of author; deleting the first comment removes the entire thread. Call only when the user explicitly identifies the comment to delete.

### `app_drive_link_annotation_thread_delete`

Additional input: `threadId`. The file owner can delete any thread; the thread creator can delete it only when all visible comments belong to that creator. Call only when the user explicitly identifies the thread to delete.

### `app_drive_link_annotation_anchor_update`

Additional input: `threadId`, `target: { exact, prefix?, suffix? }`, and stable `idempotencyKey`. Only the thread creator or file owner can reassociate the anchor. Target resolution uses the same missing/ambiguous behavior as thread creation. Read the returned `anchor` for the new current position; the compatibility `target` remains the original quote snapshot.

### `app_drive_link_materialize`

Input:

- `url` required.
- `password` optional.
- `scope` optional: `entry`, `text`, or `all`.
- `maxFiles` optional.
- `maxBytes` optional.

Writes a local cache directory and returns `localRootPath`, `manifestPath`, `entryPath`, `files`, `skipped`, and `warnings`. Folder entries are included in `files` and the manifest with `kind: "folder"`, including empty folders. The cache write requires local write permission and is audited with the cache root and manifest path.

### `app_drive_link_download_file`

Input:

- `url` required.
- `password` optional.
- `path` optional.
- `itemId` optional.
- `outputPath` optional: absolute local output path.

Downloads one linked file or public asset. When `outputPath` is omitted, Synapse writes to the Drive link intake cache; that cache write requires local write permission and is audited with the final local path.

For `/share` children, prefer `itemId` from `app_drive_link_list`; for `/sites`, pass the site-relative `path`.
Protected `/share` and `/sites` links require `password`; without it, this tool reports that the link needs a password rather than treating the link as missing.

## Share Tools

Use share tools for `/share/...` links to existing Drive files or folders. Shares can be read-only or editable depending on access settings. Deleted or trashed source items temporarily disable affected share links. Restoring the item reactivates links disabled by that delete operation; manually disabled shares stay disabled.

Use a share by default for a standalone HTML file, including when the user casually calls it a website or site or names a Drive destination folder for the upload. Use a site instead only when the artifact requires a folder or the user explicitly asks to publish the whole folder. Updating the same Drive item changes what the existing `/share/...` link renders; do not create another share for a normal file update.

### `app_drive_share_list`

List current user's Drive share links. Passwords are not returned.

Input:

- `offset` optional.
- `limit` optional.
- `search` optional: match share id, share record id, or item name.

### `app_drive_share_create`

Create or reuse a public Drive share link and return the `/share/...` URL. Existing shares keep their current password, expiry, and access mode unless access settings are supplied.

Input:

- `itemId` required: Drive file or folder item id.
- `passwordEnabled` optional: `true` when the user asks for password protection. Omit it to use the current Synapse version's no-password default for a new share; existing shares keep their current setting when omitted.
- `expiresIn` optional: `3d`, `7d`, `30d`, `1y`, or `forever`. Omit it to use the current Synapse version's default for a new share; existing shares keep their current expiry when omitted.
- `accessMode` optional: `link_read`, `link_edit`, or `specified_users_edit`. Existing shares keep their current mode when omitted.
- `editorEmails` optional: email list for `specified_users_edit`; leave empty for other modes.

### `app_drive_share_disable`

Disable a Drive share link.

Input:

- `shareId` required: Drive share record id, item `activeShareId`, or public share id such as `shr_...`.

## Drive Webpage Share Tools

Use these compatibility-named site tools to create a Drive webpage share at `/sites/<siteId>/`. A webpage share copies the folder at publish or republish time. It does not create a `/share/...` link, does not grant Drive browse or edit access, and does not use `/files/<assetId>` public asset URLs.

Use a site when the publishable artifact is a multi-file folder, build bundle, multi-page site, or HTML that requires local relative assets, or when the user explicitly asks to publish the whole folder as a website or site. A folder containing only `index.html` is valid in the explicit whole-folder case. Merely naming an upload destination folder or casually saying page, website, or site does not request whole-folder publishing; a standalone HTML file still defaults to a normal share.

### `app_drive_site_create`

Create an independent static webpage share from a Drive folder.

Input:

- `sourceFolderItemId` required: Drive folder item id to copy.
- `name` required: site display name.
- `entryPath` optional: HTML entry path inside the folder. Omit when the homepage is `index.html`.
- `accessMode` optional: `public` or `password`. Omit it to use `public` for a new webpage share.
- `password` optional: custom site password. Use only with `accessMode: "password"`. MCP responses never return site passwords; ask for or pass a custom password when the user needs a known value.
- `expiresIn` optional: `3d`, `7d`, `30d`, `1y`, or `forever`. Omit it to use `forever` for a new webpage share.

Output:

- `siteId`: public id used in `/sites/<siteId>/`.
- `url`: public site URL.
- `urlWithPassword`: same as `url` in MCP responses.
- `password`: always `null` in MCP responses.

### `app_drive_site_list`

List the current user's Drive webpage shares.

Input:

- `offset` optional.
- `limit` optional.
- `search` optional: match site name, site id, source folder, or entry path.
- `status` optional: `active`, `disabled`, `expired`, `deleted`, `failed`, or `all`.

Output:

- Returns published site metadata. Site tool results never include passwords: `password` is `null`, and `urlWithPassword` is the same as `url`.

### `app_drive_site_update_access`

Update site access mode and expiry without republishing files.

Input:

- `siteId` required.
- `accessMode` required: `public` or `password`.
- `password` optional: custom site password. Use only with `accessMode: "password"`. MCP responses never return site passwords; ask for or pass a custom password when the user needs a known value.
- `expiresIn` required: `3d`, `7d`, `30d`, `1y`, or `forever`.

### `app_drive_site_disable`

Disable public access to a site while keeping its record and deployment.

Input:

- `siteId` required.

### `app_drive_site_enable`

Restore public access to a disabled site.

Input:

- `siteId` required.

### `app_drive_site_delete`

Delete a published site and make its `/sites/<siteId>/` URL inaccessible.

Input:

- `siteId` required.

### `app_drive_site_republish`

Copy the remembered source folder into a new site deployment. Use the existing `siteId` after updating that source folder; republishing preserves the public site URL. The active deployment switches only after success, so a failed republish leaves the previous deployment online.

Input:

- `siteId` required.
- `entryPath` optional: replacement HTML entry path inside the source folder.

## File Version Tools

Versions are available for owned Drive files. Public share links always point to the current version and do not expose version history.

### `app_drive_file_version_list`

List historical versions for an owned Drive file.

Input:

- `itemId` required: Drive file item id.
- `offset` optional.
- `limit` optional.

### `app_drive_file_version_download_create`

Download a specific Drive file version that is not pending cleanup to a local path. This writes to local filesystem and requires write permission.

Input:

- `itemId` required: Drive file item id.
- `versionId` required.
- `outputPath` required: absolute local output path.

### `app_drive_file_version_restore`

Restore a non-current historical version that is not pending cleanup as the current file version.

Input:

- `itemId` required: Drive file item id.
- `versionId` required.

### `app_drive_file_version_delete`

Delete a non-current historical file version that is not pending cleanup and is not pinned. Current versions cannot be deleted. If the version is pinned/retained, call `app_drive_file_version_pin_update` with `isPinned: false` before deleting it.

Input:

- `itemId` required: Drive file item id.
- `versionId` required.

Output:

- `ok`: `true` when the delete request was accepted.
- `deletePending`: optional. When `true`, physical cleanup is still pending; report it as cleanup in progress.

### `app_drive_file_version_pin_update`

Keep or unkeep a non-current historical file version that is not pending cleanup.

Input:

- `itemId` required: Drive file item id.
- `versionId` required.
- `isPinned` required: `true` keeps the version; `false` lets cleanup remove it later.

## Usage And Reorganization Tools

Use these tools before reorganizing Drive content. Classify primarily from metadata; read file content only for a small number of necessary text candidates.

### `app_drive_usage_get`

Get Drive quota usage for the current user.

Input: none.

### `app_drive_stats_get`

Get Drive item counts and quota usage for the current user.

Input: none.

### `app_drive_item_tree_list`

Recursively list Drive file and folder metadata without reading file contents.

Input:

- `parentId` optional: folder item id. Omit or pass `null` for Drive root.
- `offset` optional: pagination offset across the flattened tree.
- `limit` optional: page size.

### `app_drive_folder_path_ensure`

Create or reuse a nested Drive folder path. Fails if any segment collides with an existing file.

Input:

- `segments` required: folder names from parent to leaf.
- `parentId` optional: folder item id. Omit or pass `null` for Drive root.

### `app_drive_reorganization_preview`

Validate a Drive reorganization plan and return a `planId`. This does not move files or read file contents.

Input:

- `moves` required: array of objects with:
  - `itemId` required: Drive item id to move.
  - `targetParentId` required: target folder id, or `null` for Drive root.

### `app_drive_reorganization_apply`

Apply a previously previewed Drive reorganization plan. Raw moves are not accepted.

Input:

- `planId` required: id returned by `app_drive_reorganization_preview`.

## Public Asset Tools

Use these tools for Drive-backed `公开素材`, `图床`, `外链`, `直链`, `public asset`, or `direct link` requests. Public assets support PNG/JPG/JPEG/GIF/WebP/AVIF/ICO images and PDF/DOCX/XLSX/PPTX/TXT/MD/CSV documents, do not support SVG, are flat, allow duplicate names, and use stable `/files/<assetId>` URLs. Images open inline; documents download as attachments.

Natural language mapping:

- `上传到公开素材` / `上传到图床` / `生成直链` / `生成外链` / `public asset` / `direct link` -> `app_drive_direct_link_upload`
- `重命名公开素材` / `重命名图床素材` / `rename public asset` -> `app_drive_direct_link_rename`
- `分享云盘文件` -> `app_drive_share_create`

### `app_drive_direct_link_upload`

Upload a supported image or document and create a new public asset id and URL.

Input:

- `filePath` required: absolute local file path. Supported formats are PNG/JPG/JPEG/GIF/WebP/AVIF/ICO/PDF/DOCX/XLSX/PPTX/TXT/MD/CSV; SVG is not supported.
- `name` optional: display name; defaults to local basename.
- `mimeType` optional: supported MIME type; inferred from the local `filePath` extension when omitted.

### `app_drive_direct_link_list`

List current user's public assets. Access logs are not returned.

Input:

- `offset` optional.
- `limit` optional.
- `search` optional: match public asset name or asset id.

### `app_drive_direct_link_get`

Get one public asset without access-log detail.

Input:

- `assetId` required.

### `app_drive_direct_link_update`

Replace a public asset while preserving the same `/files/<assetId>` URL. Images can replace images, and documents can replace documents; the two categories cannot replace each other. Supported formats are PNG/JPG/JPEG/GIF/WebP/AVIF/ICO/PDF/DOCX/XLSX/PPTX/TXT/MD/CSV; SVG is not supported.

Input:

- `assetId` required.
- `filePath` required: absolute local replacement file path.
- `name` optional.
- `mimeType` optional: supported MIME type inferred from the local `filePath` extension when omitted.

### `app_drive_direct_link_rename`

Rename a public asset while preserving the same `/files/<assetId>` URL.

Input:

- `assetId` required.
- `name` required: new public asset display name.

### `app_drive_direct_link_delete`

Move a public asset to Drive trash. Its public URL returns 404 until restored.

Input:

- `assetId` required.

### `app_drive_direct_link_restore`

Restore a trashed public asset and make the same public URL available again.

Input:

- `assetId` required.

## Trash Tools

### `app_drive_trash_list`

List user-visible Drive trash, including normal Drive files and public assets. Rows from this list can be restored with `app_drive_item_restore`; keep `kind` and `assetId` for public asset rows.

Input:

- `offset` optional.
- `limit` optional.
- `search` optional: match item name, original path, or public asset id.

### `app_drive_trash_delete`

Hide a trashed Drive item from the user. Admins can still see and restore it.

Input:

- `itemId` required.

### `app_drive_item_restore`

Restore a Drive item from trash. For public asset rows returned by `app_drive_trash_list`, pass `kind: "public_asset"` and the row `assetId`.

Input:

- `itemId` required.
- `kind` optional. Pass the row value from `app_drive_trash_list`; supported values are `normal` and `public_asset`.
- `assetId` required when `kind` is `public_asset`.

## Safety Notes

- Public asset access logs are admin-only and are not available through MCP.
- Do not reveal COS AK, SK, Authorization headers, local secrets, share or site passwords from list results, or presigned upload URLs.
- Before deleting a file, folder, public asset, trash item, or disabling a share, make sure the user asked for that operation clearly.
- Use `app_drive_reorganization_preview` before `app_drive_reorganization_apply`; apply only with the returned `planId`.
