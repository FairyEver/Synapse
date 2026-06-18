# Synapse Drive MCP API Reference

## Public Assets

Use these tools for Drive-backed `公开素材` direct links. They are image-only in v1, flat, allow duplicate names, and use stable `/files/<assetId>` URLs.

Natural language mapping:

- `上传到公开素材` / `上传到图床` / `生成直链` / `生成外链` / `public asset` / `direct link` -> `drive_direct_link_upload`
- `分享云盘文件` -> `drive_share_create`

### `drive_direct_link_upload`

Upload an image and create a new public asset id and URL.

Input:

- `filePath` required: absolute local image file path.
- `name` optional: display name; defaults to the local file basename.
- `mimeType` optional: image MIME type; inferred from filename extension when omitted.

### `drive_direct_link_list`

List current user's public assets. Access logs are not returned.

Input:

- `offset` optional.
- `limit` optional.

### `drive_direct_link_get`

Get one public asset without access-log detail.

Input:

- `assetId` required.

### `drive_direct_link_update`

Replace a public asset image while preserving the same `/files/<assetId>` URL.

Input:

- `assetId` required.
- `filePath` required: absolute local replacement image file path.
- `name` optional.
- `mimeType` optional; inferred from filename extension when omitted.

### `drive_direct_link_delete`

Move a public asset to Drive trash. Its public URL returns 404 until restored.

Input:

- `assetId` required.

### `drive_direct_link_restore`

Restore a trashed public asset and make the same public URL available again.

Input:

- `assetId` required.

## Trash

### `drive_trash_list`

List user-visible Drive trash, including normal Drive files and public assets.

Input:

- `offset` optional.
- `limit` optional.

### `drive_trash_delete`

Hide a trashed Drive item from the user. Admins can still see and restore it.

Input:

- `itemId` required.

### `drive_item_restore`

Restore a Drive item from trash.

Input:

- `itemId` required.

## Notes

- Public asset access logs are admin-only and are not available through MCP.
- Use `drive_share_create` for sharing existing Drive files or folders through `/share/...`.
- Use direct-link tools for `公开素材`, `图床`, `外链`, `直链`, `public asset`, or `direct link` requests.
