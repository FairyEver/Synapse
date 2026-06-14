# Synapse Drive MCP

Use Synapse Drive MCP tools when the user wants to upload, share, hand off, organize, or delete files in Synapse Drive.

## Scope

Use these tools only for Synapse Drive:

- `drive_item_list`
- `drive_file_upload`
- `drive_folder_upload`
- `drive_folder_create`
- `drive_item_move`
- `drive_item_delete`
- `drive_share_create`
- `drive_share_disable`
- `drive_usage_get`

Do not use this skill for database records, content resources, scheduler tasks, workflow definitions, provider settings, or general local file editing.

## Default Flow

1. If the user did not specify a target folder, omit `parentId` so the file or folder is uploaded to the Drive root directory.
2. For a single local file, call `drive_file_upload` with `filePath`, optional `parentId`, optional `name`, and optional `mimeType`.
3. For a local folder, call `drive_folder_upload` with `folderPath`, optional `parentId`, and optional `folderName`. Preserve the relative paths returned by the tool.
4. If the user wants to hand the file to someone else, call `drive_share_create` for the uploaded item and return the public URL.
5. If a folder needs to exist first, call `drive_folder_create`, then pass the returned folder id as `parentId`.
6. Report the final item name, item id, and share URL when a share was created.

## Safety

Never reveal COS AK, SK, Authorization headers, local secrets, or presigned upload URLs. Drive upload tools should return item and share results only; if an error includes a signed query string, summarize the failure without copying the sensitive URL.

Before deleting or disabling a share, make sure the user asked for that operation clearly.
When deleting a file or folder that may have active page/site publications, pass `disablePublications: true` only when the user asked to disable related publications as part of the delete operation. If omitted or false, related publications can remain accessible from their published snapshots.

## Common Requests

- "上传这个文件并给我链接": call `drive_file_upload`, then `drive_share_create`.
- "把这个目录传到云盘": call `drive_folder_upload`.
- "新建一个资料文件夹": call `drive_folder_create`.
- "移动到某个文件夹": call `drive_item_move` with the target folder id.
- "删除并下线相关发布": call `drive_item_delete` with `disablePublications: true`.
- "看看云盘空间": call `drive_usage_get`.
