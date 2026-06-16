# Synapse Drive MCP

Use Synapse Drive MCP tools when the user wants to upload, open, preview, download, share, organize, or delete files in Synapse Drive.

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

Do not use this skill for database records, content resources, scheduler tasks, workflow definitions, provider settings, or general local file editing.

## Default Flow

1. If the user did not specify a target folder, omit `parentId` so the file or folder is uploaded to the Drive root directory.
2. For a single local file, call `drive_file_upload` with `filePath`, optional `parentId`, optional `name`, and optional `mimeType`.
3. For a local folder, call `drive_folder_upload` with `folderPath`, optional `parentId`, and optional `folderName`. Preserve the relative paths returned by the tool.
4. To open or preview an item for the owner, call `drive_item_preview_get`. It returns the browser snapshot, preview metadata, children, and available download/render URLs without creating a share.
5. To read a small previewable text file, call `drive_file_content_read`. Use `drive_file_download_create` instead for binary, oversized, or non-previewable files.
6. To save Drive content locally, call `drive_file_download_create` for a file or `drive_folder_zip_create` for a folder. These tools write to the local filesystem and require write permission.
7. If the user wants to hand the file or folder to someone else for browse, render, or download access, call `drive_share_create` for the item and return the `/share/...` public URL.
   - Pass `passwordEnabled: false` only when the user asks for a no-password link. Omit it to keep the default password requirement.
   - Pass `expiresIn` when the user asks for a specific duration. Supported values are `3d`, `7d`, `30d`, `1y`, and `forever`; omitting it uses `3d`.
8. If a folder needs to exist first, call `drive_folder_create`, then pass the returned folder id as `parentId`.
9. To organize the user's Drive, call `drive_stats_get` and `drive_item_tree_list` first. Classify primarily from metadata such as name, path, extension, MIME type, size, and timestamps.
10. Only read file content when it is necessary, and only for a small number of text-like candidates. Use `drive_file_content_read` one file at a time. Do not attempt bulk content reads; Drive MCP does not provide a batch file-content API.
11. Use `drive_folder_path_ensure` to create or reuse target category folders, then call `drive_reorganization_preview` with item ids and target folder ids. Show the preview summary to the user before applying.
12. Apply organization changes only with `drive_reorganization_apply` and the `planId` returned by the preview. Do not submit raw moves to apply.
13. Report the final item name, item id, and share URL when one was created.

## Safety

Never reveal COS AK, SK, Authorization headers, local secrets, or presigned upload URLs. Drive upload tools should return item and share results only; if an error includes a signed query string, summarize the failure without copying the sensitive URL.

Before deleting a file or folder, or disabling a share, make sure the user asked for that operation clearly.

Shares use `/share/...` and let others browse files and folders, render previewable HTML, or download content. HTML shares are live links to the current Drive file, not static site snapshots.

Drive organization changes can move many user files. Always preview first, then apply by `planId` only after the user has confirmed. If apply reports that the Drive changed, refresh the tree and create a new preview.

## Common Requests

- "上传这个文件并给我链接": call `drive_file_upload`, then `drive_share_create`.
- "把这个目录传到云盘": call `drive_folder_upload`.
- "打开/预览这个文件": call `drive_item_preview_get`.
- "读取这个 Markdown": call `drive_file_content_read`.
- "下载这个文件到本地": call `drive_file_download_create`.
- "下载整个文件夹": call `drive_folder_zip_create`.
- "新建一个资料文件夹": call `drive_folder_create`.
- "移动到某个文件夹": call `drive_item_move` with the target folder id.
- "重命名": call `drive_item_rename`.
- "分享这个 HTML": call `drive_share_create`.
- "公开链接列表": call `drive_share_list`.
- "看看云盘空间": call `drive_usage_get`.
- "整理我的云盘": call `drive_stats_get`, `drive_item_tree_list`, optional small per-file `drive_file_content_read`, `drive_folder_path_ensure`, `drive_reorganization_preview`, then `drive_reorganization_apply` with the returned `planId`.
