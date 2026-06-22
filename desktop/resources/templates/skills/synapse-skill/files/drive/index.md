# Synapse Drive MCP

Use Synapse Drive MCP tools when the user wants to upload, open, preview, download, share, organize, delete, restore, or create Drive-backed public asset links in Synapse Drive.

## Scope

Use these tools only for Synapse Drive:

- `drive_item_list`
- `drive_item_get`
- `drive_file_upload`
- `drive_folder_upload`
- `drive_folder_create`
- `drive_item_rename`
- `drive_item_move`
- `drive_item_delete`
- `drive_item_preview_get`
- `drive_file_content_read`
- `drive_file_download_create`
- `drive_file_version_list`
- `drive_file_version_download_create`
- `drive_file_version_restore`
- `drive_file_version_delete`
- `drive_file_version_pin_update`
- `drive_folder_zip_create`
- `drive_share_list`
- `drive_share_create`
- `drive_share_disable`
- `drive_usage_get`
- `drive_stats_get`
- `drive_item_tree_list`
- `drive_folder_path_ensure`
- `drive_reorganization_preview`
- `drive_reorganization_apply`
- `drive_direct_link_upload`
- `drive_direct_link_list`
- `drive_direct_link_get`
- `drive_direct_link_update`
- `drive_direct_link_rename`
- `drive_direct_link_delete`
- `drive_direct_link_restore`
- `drive_trash_list`
- `drive_trash_delete`
- `drive_item_restore`

Do not use this skill for database records, content resources, scheduler tasks, workflow definitions, provider settings, or general local file editing.

## Default Flow

1. If the user did not specify a target folder, omit `parentId` so the file or folder is uploaded to the Drive root directory.
2. For a single local file, call `drive_file_upload` with `filePath`, optional `parentId`, optional `name`, and optional `mimeType`.
3. For a local folder, call `drive_folder_upload` with `folderPath`, optional `parentId`, and optional `folderName`. Preserve the relative paths returned by the tool.
   - Uploading a same-name file to the same Drive folder overwrites the existing newest active file while preserving its item id and share links.
   - Uploading a same-name folder merges into the existing folder; same-name files inside it are overwritten and missing files are added.
4. To open or preview an item for the owner, call `drive_item_preview_get`. It returns the browser snapshot, preview metadata, children, and available download/render URLs without creating a share.
5. To read a small previewable text file, call `drive_file_content_read`. Use `drive_file_download_create` instead for binary, oversized, or non-previewable files.
6. To save Drive content locally, call `drive_file_download_create` for a file, `drive_file_version_download_create` for a specific file version, or `drive_folder_zip_create` for a folder. These tools write to the local filesystem and require write permission.
7. If the user asks to upload to `公开素材`, upload to a `图床`, generate a `直链`, generate an `外链`, create a `public asset`, or create a `direct link`, call `drive_direct_link_upload`. Public assets are image-only in v1, flat, and duplicate names are allowed; every upload creates a new asset id and `/files/<assetId>` URL.
8. If the user asks to replace an existing public asset, call `drive_direct_link_update` with `assetId` and `filePath`. The `/files/<assetId>` URL is preserved.
9. If the user asks to rename an existing public asset, call `drive_direct_link_rename` with `assetId` and `name`. The `/files/<assetId>` URL is preserved.
10. If the user asks to share an existing Drive file or folder, call `drive_share_create` for the item and return the `/share/...` public URL.
   - When a share already exists, omit access settings unless the user explicitly asks to change password, expiry, or edit access. Reusing an existing share preserves its current settings.
   - Pass `passwordEnabled: false` only when the user asks for a no-password link. For a new share, omitting it keeps the default password requirement.
   - Pass `expiresIn` when the user asks for a specific duration. Supported values are `3d`, `7d`, `30d`, `1y`, and `forever`; for a new share, omitting it uses `3d`.
   - Pass `accessMode: "link_read"` for a new read-only link, `accessMode: "link_edit"` when logged-in link holders may edit supported text files, or `accessMode: "specified_users_edit"` with `editorEmails` when only specific logged-in users may edit.
   - Do not pass `editorEmails` for read-only or link-edit links. For `specified_users_edit`, provide one or more email addresses.
   - Use the `drive_share_create` result when the user needs the password for a specific share. `drive_share_list` lists existing shares without returning passwords.
11. If a folder needs to exist first, call `drive_folder_create`, then pass the returned folder id as `parentId`.
12. To organize the user's Drive, call `drive_stats_get` and `drive_item_tree_list` first. Classify primarily from metadata such as name, path, extension, MIME type, size, and timestamps.
13. Only read file content when it is necessary, and only for a small number of text-like candidates. Use `drive_file_content_read` one file at a time. Do not attempt bulk content reads; Drive MCP does not provide a batch file-content API.
14. Use `drive_folder_path_ensure` to create or reuse target category folders, then call `drive_reorganization_preview` with item ids and target folder ids. For moves back to Drive root, set `targetParentId` to `null`. Show the preview summary to the user before applying.
15. Apply organization changes only with `drive_reorganization_apply` and the `planId` returned by the preview. Do not submit raw moves to apply.
16. For file history, call `drive_file_version_list` first. Use `drive_file_version_restore` only when the user wants that version to become current, `drive_file_version_delete` only for non-current versions the user wants removed, and `drive_file_version_pin_update` to keep or unkeep a version during automatic cleanup.
17. Use `drive_trash_list` to inspect user-visible trash. Restore rows from that list with `drive_item_restore`; pass `kind` and `assetId` when the row kind is `public_asset`. Use `drive_direct_link_restore` only when the user directly provides a public asset id. Use `drive_trash_delete` only when the user clearly asks to remove an item from their visible trash.
18. Report the final item name, item id, and share URL or public asset URL when one was created.

## Safety

Never reveal COS AK, SK, Authorization headers, local secrets, share passwords from list results, or presigned upload URLs. Drive upload tools should return item and share results only; if an error includes a signed query string, summarize the failure without copying the sensitive URL.

Before deleting a file, folder, public asset, trash item, or disabling a share, make sure the user asked for that operation clearly.

`drive_item_delete` and `drive_direct_link_delete` move items to Drive trash. A trashed public asset keeps its asset id, but `/files/<assetId>` returns 404 until restored. `drive_trash_delete` hides a trashed item from ordinary user views; admins can still see and restore it.

Shares use `/share/...` and let others browse files and folders, render previewable HTML, download content, and, when the owner chooses an editable mode, edit supported text files after login. HTML shares are live links to the current Drive file, not static site snapshots.

Share editors cannot see version history through public share links. Editable shares update the owner's Drive file and create normal file versions owned by the file owner.

Drive organization changes can move many user files. Always preview first, then apply by `planId` only after the user has confirmed. If apply reports that the Drive changed, refresh the tree and create a new preview.

File versions are full-copy history for owned Drive files. Public share links always point to the current file and do not expose version history. Restoring a version creates a new current version; deleting a historical version cannot be undone.

Public asset access logs are admin-only and are not available through MCP. Do not invent or request access-log tools.

## Common Requests

- "上传这个文件并给我链接": call `drive_file_upload`, then `drive_share_create`.
- "上传到公开素材": call `drive_direct_link_upload`.
- "上传到图床": call `drive_direct_link_upload`.
- "生成直链": call `drive_direct_link_upload`.
- "生成外链": call `drive_direct_link_upload`.
- "分享云盘文件": call `drive_share_create`.
- "把这个目录传到云盘": call `drive_folder_upload`.
- "打开/预览这个文件": call `drive_item_preview_get`.
- "读取这个 Markdown": call `drive_file_content_read`.
- "下载这个文件到本地": call `drive_file_download_create`.
- "下载 v3 历史版本": call `drive_file_version_list`, then `drive_file_version_download_create` with the selected version id.
- "恢复到上一个版本": call `drive_file_version_list`, then `drive_file_version_restore` with the selected version id.
- "保留这个历史版本": call `drive_file_version_pin_update`.
- "下载整个文件夹": call `drive_folder_zip_create`.
- "新建一个资料文件夹": call `drive_folder_create`.
- "移动到某个文件夹": call `drive_item_move` with the target folder id.
- "重命名": call `drive_item_rename`.
- "分享这个 HTML": call `drive_share_create`.
- "替换公开素材": call `drive_direct_link_update`.
- "重命名公开素材": call `drive_direct_link_rename`.
- "恢复公开素材": call `drive_direct_link_restore`.
- "查看回收站": call `drive_trash_list`.
- "从回收站恢复": call `drive_item_restore`; include `kind` and `assetId` for `public_asset` trash rows.
- "公开链接列表": call `drive_share_list`.
- "看看云盘空间": call `drive_usage_get`.
- "整理我的云盘": call `drive_stats_get`, `drive_item_tree_list`, optional small per-file `drive_file_content_read`, `drive_folder_path_ensure`, `drive_reorganization_preview`, then `drive_reorganization_apply` with the returned `planId`.
