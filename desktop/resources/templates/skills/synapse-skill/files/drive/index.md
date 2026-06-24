# Synapse Drive MCP

Use Synapse Drive MCP tools when the user wants to upload, open, preview, download, share, organize, delete, restore, or create Drive-backed public asset links in Synapse Drive.

## Scope

Use these tools only for Synapse Drive:

- `app_drive_item_list`
- `app_drive_item_get`
- `app_drive_file_upload`
- `app_drive_folder_upload`
- `app_drive_folder_create`
- `app_drive_item_rename`
- `app_drive_item_move`
- `app_drive_item_delete`
- `app_drive_item_preview_get`
- `app_drive_file_content_read`
- `app_drive_file_download_create`
- `app_drive_file_version_list`
- `app_drive_file_version_download_create`
- `app_drive_file_version_restore`
- `app_drive_file_version_delete`
- `app_drive_file_version_pin_update`
- `app_drive_folder_zip_create`
- `app_drive_share_list`
- `app_drive_share_create`
- `app_drive_share_disable`
- `app_drive_site_create`
- `app_drive_site_list`
- `app_drive_site_update_access`
- `app_drive_site_disable`
- `app_drive_site_delete`
- `app_drive_site_republish`
- `app_drive_usage_get`
- `app_drive_stats_get`
- `app_drive_item_tree_list`
- `app_drive_folder_path_ensure`
- `app_drive_reorganization_preview`
- `app_drive_reorganization_apply`
- `app_drive_direct_link_upload`
- `app_drive_direct_link_list`
- `app_drive_direct_link_get`
- `app_drive_direct_link_update`
- `app_drive_direct_link_rename`
- `app_drive_direct_link_delete`
- `app_drive_direct_link_restore`
- `app_drive_trash_list`
- `app_drive_trash_delete`
- `app_drive_item_restore`

Do not use this skill for database records, Resource Repository resources, scheduler tasks, workflow definitions, provider settings, or general local file editing.

## Default Flow

1. If the user did not specify a target folder, omit `parentId` so the file or folder is uploaded to the Drive root directory.
2. For a single local file, call `app_drive_file_upload` with `filePath`, optional `parentId`, optional `name`, and optional `mimeType`.
3. For a local folder, call `app_drive_folder_upload` with `folderPath`, optional `parentId`, and optional `folderName`. Preserve the relative paths returned by the tool.
   - Uploading a same-name file to the same Drive folder overwrites the existing newest active file while preserving its item id and share links.
   - Uploading a same-name folder merges into the existing folder; same-name files inside it are overwritten and missing files are added.
4. To open or preview an item for the owner, call `app_drive_item_preview_get`. It returns the browser snapshot, preview metadata, children, and available download/render URLs without creating a share.
5. To read a small previewable text file, call `app_drive_file_content_read`. Use `app_drive_file_download_create` instead for binary, oversized, or non-previewable files.
6. To save Drive content locally, call `app_drive_file_download_create` for a file, `app_drive_file_version_download_create` for a specific file version, or `app_drive_folder_zip_create` for a folder. These tools write to the local filesystem and require write permission.
7. If the user asks to upload to `公开素材`, upload to a `图床`, generate a `直链`, generate an `外链`, create a `public asset`, or create a `direct link`, call `app_drive_direct_link_upload`. Public assets are image-only in v1, flat, and duplicate names are allowed; every upload creates a new asset id and `/files/<assetId>` URL.
8. If the user asks to replace an existing public asset, call `app_drive_direct_link_update` with `assetId` and `filePath`. The `/files/<assetId>` URL is preserved.
9. If the user asks to rename an existing public asset, call `app_drive_direct_link_rename` with `assetId` and `name`. The `/files/<assetId>` URL is preserved.
10. If the user asks to share an existing Drive file or folder, call `app_drive_share_create` for the item and return the `/share/...` public URL.
   - When a share already exists, omit access settings unless the user explicitly asks to change password, expiry, or edit access. Reusing an existing share preserves its current settings.
   - Pass `passwordEnabled: false` only when the user asks for a no-password link. For a new share, omitting it keeps the default password requirement.
   - Pass `expiresIn` when the user asks for a specific duration. Supported values are `3d`, `7d`, `30d`, `1y`, and `forever`; for a new share, omitting it uses `3d`.
   - Pass `accessMode: "link_read"` for a new read-only link, `accessMode: "link_edit"` when logged-in link holders may edit supported text files, or `accessMode: "specified_users_edit"` with `editorEmails` when only specific logged-in users may edit.
   - Do not pass `editorEmails` for read-only or link-edit links. For `specified_users_edit`, provide one or more email addresses.
   - Use the `app_drive_share_create` result when the user needs the password for a specific share. `app_drive_share_list` lists existing shares without returning passwords.
11. If the user asks to publish a Drive folder as a static website, folder site, multi-page HTML prototype, or product prototype site, call `app_drive_site_create`. Sites use `/sites/<siteId>/`, copy the folder at publish time, and do not grant Drive browse or edit access.
   - Use `sourceFolderItemId`, `name`, `accessMode`, and `expiresIn`.
   - Set `entryPath` only when the homepage is not the default `index.html`.
   - Use `accessMode: "public"` for open sites or `accessMode: "password"` when the user asks for a password. Do not provide a password value; Synapse generates it and returns it in the result.
   - Use `app_drive_site_list`, `app_drive_site_update_access`, `app_drive_site_disable`, `app_drive_site_delete`, and `app_drive_site_republish` for existing site management.
12. If a folder needs to exist first, call `app_drive_folder_create`, then pass the returned folder id as `parentId`.
13. To organize the user's Drive, call `app_drive_stats_get` and `app_drive_item_tree_list` first. Classify primarily from metadata such as name, path, extension, MIME type, size, and timestamps.
14. Only read file content when it is necessary, and only for a small number of text-like candidates. Use `app_drive_file_content_read` one file at a time. Do not attempt bulk content reads; Drive MCP does not provide a batch file-content API.
15. Use `app_drive_folder_path_ensure` to create or reuse target category folders, then call `app_drive_reorganization_preview` with item ids and target folder ids. For moves back to Drive root, set `targetParentId` to `null`. Show the preview summary to the user before applying.
16. Apply organization changes only with `app_drive_reorganization_apply` and the `planId` returned by the preview. Do not submit raw moves to apply.
17. For file history, call `app_drive_file_version_list` first. Use `app_drive_file_version_restore` only when the user wants that version to become current, `app_drive_file_version_delete` only for non-current versions the user wants removed, and `app_drive_file_version_pin_update` to keep or unkeep a version during automatic cleanup.
18. Use `app_drive_trash_list` to inspect user-visible trash. Restore rows from that list with `app_drive_item_restore`; pass `kind` and `assetId` when the row kind is `public_asset`. Use `app_drive_direct_link_restore` only when the user directly provides a public asset id. Use `app_drive_trash_delete` only when the user clearly asks to remove an item from their visible trash.
19. Report the final item name, item id, share URL, public asset URL, or site URL when one was created.

## Safety

Never reveal COS AK, SK, Authorization headers, local secrets, share passwords from list results, or presigned upload URLs. Drive upload tools should return item and share results only; if an error includes a signed query string, summarize the failure without copying the sensitive URL.

Before deleting a file, folder, public asset, trash item, or disabling a share, make sure the user asked for that operation clearly.

`app_drive_item_delete` and `app_drive_direct_link_delete` move items to Drive trash. A trashed public asset keeps its asset id, but `/files/<assetId>` returns 404 until restored. `app_drive_trash_delete` hides a trashed item from ordinary user views; admins can still see and restore it.

Shares use `/share/...` and let others browse files and folders, render previewable HTML, download content, and, when the owner chooses an editable mode, edit supported text files after login. HTML shares are live links to the current Drive file, not static site snapshots.

Share editors cannot see version history through public share links. Editable shares update the owner's Drive file and create normal file versions owned by the file owner.

Sites use `/sites/<siteId>/` and are read-only static snapshots copied from a Drive folder. Site access settings do not change Drive shares, Drive item permissions, or public asset URLs.

Drive organization changes can move many user files. Always preview first, then apply by `planId` only after the user has confirmed. If apply reports that the Drive changed, refresh the tree and create a new preview.

File versions are full-copy history for owned Drive files. Public share links always point to the current file and do not expose version history. Restoring a version creates a new current version; deleting a historical version cannot be undone.

Public asset access logs are admin-only and are not available through MCP. Do not invent or request access-log tools.

## Common Requests

- "上传这个文件并给我链接": call `app_drive_file_upload`, then `app_drive_share_create`.
- "上传到公开素材": call `app_drive_direct_link_upload`.
- "上传到图床": call `app_drive_direct_link_upload`.
- "生成直链": call `app_drive_direct_link_upload`.
- "生成外链": call `app_drive_direct_link_upload`.
- "分享云盘文件": call `app_drive_share_create`.
- "发布这个文件夹为站点": call `app_drive_site_create`.
- "把这个多页 HTML 原型发成网站": call `app_drive_site_create`.
- "重新发布站点": call `app_drive_site_republish`.
- "管理站点": call `app_drive_site_list`.
- "停用站点": call `app_drive_site_disable`.
- "删除站点": call `app_drive_site_delete`.
- "把这个目录传到云盘": call `app_drive_folder_upload`.
- "打开/预览这个文件": call `app_drive_item_preview_get`.
- "读取这个 Markdown": call `app_drive_file_content_read`.
- "下载这个文件到本地": call `app_drive_file_download_create`.
- "下载 v3 历史版本": call `app_drive_file_version_list`, then `app_drive_file_version_download_create` with the selected version id.
- "恢复到上一个版本": call `app_drive_file_version_list`, then `app_drive_file_version_restore` with the selected version id.
- "保留这个历史版本": call `app_drive_file_version_pin_update`.
- "下载整个文件夹": call `app_drive_folder_zip_create`.
- "新建一个资料文件夹": call `app_drive_folder_create`.
- "移动到某个文件夹": call `app_drive_item_move` with the target folder id.
- "重命名": call `app_drive_item_rename`.
- "分享这个 HTML": call `app_drive_share_create`.
- "替换公开素材": call `app_drive_direct_link_update`.
- "重命名公开素材": call `app_drive_direct_link_rename`.
- "恢复公开素材": call `app_drive_direct_link_restore`.
- "查看回收站": call `app_drive_trash_list`.
- "从回收站恢复": call `app_drive_item_restore`; include `kind` and `assetId` for `public_asset` trash rows.
- "公开链接列表": call `app_drive_share_list`.
- "看看云盘空间": call `app_drive_usage_get`.
- "整理我的云盘": call `app_drive_stats_get`, `app_drive_item_tree_list`, optional small per-file `app_drive_file_content_read`, `app_drive_folder_path_ensure`, `app_drive_reorganization_preview`, then `app_drive_reorganization_apply` with the returned `planId`.
