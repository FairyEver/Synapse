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

Upload one local file to Drive. A same-name file in the target folder is overwritten while preserving its item id and share links.

Input:

- `filePath` required: absolute local file path.
- `parentId` optional: target folder id. Omit or pass `null` for Drive root.
- `name` optional: Drive display name; defaults to local basename.
- `mimeType` optional.

### `app_drive_folder_upload`

Upload a local folder to Drive. Same-name folders are merged and same-name files are overwritten.

Input:

- `folderPath` required: absolute local folder path.
- `parentId` optional: target folder id. Omit or pass `null` for Drive root.
- `folderName` optional: Drive folder name; defaults to local basename.

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

This disables `/share/...` links for the deleted item and its folder subtree. Restoring the item later does not reactivate those old share links.

Input:

- `itemId` required.

### `app_drive_item_preview_get`

Get the owner preview snapshot for a Drive item. This returns browser state and available URLs without creating a share.

Input:

- `itemId` required.
- `surface` optional: `standalone` or `console`.
- `childrenOffset` optional: folder child pagination offset.
- `childrenLimit` optional: folder child pagination page size.

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

### `app_drive_link_read_text`

Input:

- `url` required.
- `password` optional.
- `path` optional.
- `itemId` optional.
- `maxBytes` optional.

Use for Markdown, HTML source, JSON, and text. Binary files should use `app_drive_link_download_file`.

For `/share` children, prefer `itemId` from `app_drive_link_list`; `path` is primarily for `/sites` assets and share fallback lookup.

### `app_drive_link_materialize`

Input:

- `url` required.
- `password` optional.
- `scope` optional: `entry`, `text`, or `all`.
- `maxFiles` optional.
- `maxBytes` optional.

Writes a local cache directory and returns `localRootPath`, `manifestPath`, `entryPath`, `files`, `skipped`, and `warnings`.

### `app_drive_link_download_file`

Input:

- `url` required.
- `password` optional.
- `path` optional.
- `itemId` optional.
- `outputPath` optional: absolute local output path.

Downloads one linked file or public asset. When `outputPath` is omitted, Synapse writes to the Drive link intake cache.

For `/share` children, prefer `itemId` from `app_drive_link_list`; for `/sites`, pass the site-relative `path`.

## Share Tools

Use share tools for `/share/...` links to existing Drive files or folders. Shares can be read-only or editable depending on access settings. Deleted or trashed source items invalidate their share links; restore does not reactivate old links.

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
- `passwordEnabled` optional: `false` only when the user asks for a no-password link. New shares default to password required; existing shares keep their current setting when omitted.
- `expiresIn` optional: `3d`, `7d`, `30d`, `1y`, or `forever`. New shares default to `3d`; existing shares keep their current expiry when omitted.
- `accessMode` optional: `link_read`, `link_edit`, or `specified_users_edit`. Existing shares keep their current mode when omitted.
- `editorEmails` optional: email list for `specified_users_edit`; leave empty for other modes.

### `app_drive_share_disable`

Disable a Drive share link.

Input:

- `shareId` required: Drive share record id, item `activeShareId`, or public share id such as `shr_...`.

## Drive Site Tools

Use site tools for publishing a Drive folder as a read-only static website at `/sites/<siteId>/`. Site publishing copies the folder at publish or republish time. It does not create a `/share/...` link, does not grant Drive browse or edit access, and does not use `/files/<assetId>` public asset URLs.

### `app_drive_site_create`

Publish a Drive folder as an independent static site.

Input:

- `sourceFolderItemId` required: Drive folder item id to copy.
- `name` required: site display name.
- `entryPath` optional: HTML entry path inside the folder. Omit when the homepage is `index.html`.
- `accessMode` required: `public` or `password`.
- `password` optional: custom site password. Use only with `accessMode: "password"`; omit it to generate a random password.
- `expiresIn` required: `3d`, `7d`, `30d`, `1y`, or `forever`.

Output:

- `siteId`: public id used in `/sites/<siteId>/`.
- `url`: public site URL.
- `urlWithPassword`: public site URL with password query when password mode is enabled.
- `password`: custom or generated password for password sites, or `null` for public sites.

### `app_drive_site_list`

List current user's published Drive sites.

Input:

- `offset` optional.
- `limit` optional.
- `search` optional: match site name, site id, source folder, or entry path.
- `status` optional: `active`, `disabled`, `expired`, `deleted`, `failed`, or `all`.

Output:

- Returns published site metadata. List results do not include historical passwords: `password` is `null`, and `urlWithPassword` is the same as `url`.
- Use `app_drive_site_create` or `app_drive_site_update_access` when the user needs the new password for a specific site.

### `app_drive_site_update_access`

Update site access mode and expiry without republishing files.

Input:

- `siteId` required.
- `accessMode` required: `public` or `password`.
- `password` optional: custom site password. Use only with `accessMode: "password"`; omit it to generate a random password.
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

Copy the remembered source folder into a new site deployment. The active deployment switches only after success.

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

Download a specific Drive file version to a local path. This writes to local filesystem and requires write permission.

Input:

- `itemId` required: Drive file item id.
- `versionId` required.
- `outputPath` required: absolute local output path.

### `app_drive_file_version_restore`

Restore a historical version as the current file version.

Input:

- `itemId` required: Drive file item id.
- `versionId` required.

### `app_drive_file_version_delete`

Delete a non-current historical file version. Current versions cannot be deleted.

Input:

- `itemId` required: Drive file item id.
- `versionId` required.

### `app_drive_file_version_pin_update`

Keep or unkeep a historical file version during automatic cleanup.

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

Use these tools for Drive-backed `公开素材`, `图床`, `外链`, `直链`, `public asset`, or `direct link` requests. Public assets are image-only in v1, support PNG/JPG/JPEG/GIF/WebP/AVIF/ICO, do not support SVG, are flat, allow duplicate names, and use stable `/files/<assetId>` URLs.

Natural language mapping:

- `上传到公开素材` / `上传到图床` / `生成直链` / `生成外链` / `public asset` / `direct link` -> `app_drive_direct_link_upload`
- `重命名公开素材` / `重命名图床素材` / `rename public asset` -> `app_drive_direct_link_rename`
- `分享云盘文件` -> `app_drive_share_create`

### `app_drive_direct_link_upload`

Upload a supported image and create a new public asset id and URL.

Input:

- `filePath` required: absolute local image file path. Supported formats are PNG/JPG/JPEG/GIF/WebP/AVIF/ICO; SVG is not supported.
- `name` optional: display name; defaults to local basename.
- `mimeType` optional: supported image MIME type; inferred from the local `filePath` extension when omitted.

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

Replace a public asset image while preserving the same `/files/<assetId>` URL. Supported formats are PNG/JPG/JPEG/GIF/WebP/AVIF/ICO; SVG is not supported.

Input:

- `assetId` required.
- `filePath` required: absolute local replacement image file path.
- `name` optional.
- `mimeType` optional: supported image MIME type inferred from the local `filePath` extension when omitted.

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
