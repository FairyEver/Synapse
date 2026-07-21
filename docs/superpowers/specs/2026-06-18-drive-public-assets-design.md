# Drive Public Assets And Trash Design

Date: 2026-06-18
Scope: `server/`, `dashboard/`, `desktop/`, `shared/`, `desktop/synapse-capabilities/`, `desktop/resources/templates/skills/synapse-drive-mcp/`, `docs/`

> Format, delivery, and replacement-category rules in this V1 design are superseded by `2026-07-21-drive-public-documents-design.md`. Lifecycle, identity, quota, audit, and storage rules remain authoritative.

## Goal

Add a Drive-backed public asset library to Synapse Drive and convert Drive deletion into a recoverable soft-delete lifecycle.

Users get a fixed `公开素材` entry in the Drive root. Files uploaded there become public image assets with stable URLs shaped as:

```text
https://<APP_PUBLIC_URL>/files/<assetId>
```

The feature is not a separate image-hosting or public-file product. Public assets remain Drive files for ownership, storage, quota, audit, admin inspection, MCP access, and lifecycle handling.

## Confirmed Product Decisions

- The user-facing name is `公开素材`.
- `公开素材` appears as a fixed virtual entry at the top of the Drive root.
- `回收站` appears as a fixed virtual entry under `公开素材` and above normal Drive items.
- Both virtual entries are root-only. Users cannot rename, move, or delete them.
- Public assets are always flat. They never support folders.
- Public assets cannot be moved into normal Drive folders.
- Normal Drive files cannot be moved into `公开素材`.
- Public assets can only be created through the public asset upload flow.
- Public asset content can only be changed through explicit replace.
- Public asset upload always creates a new Drive file and a new `assetId`, even for the same local file or same filename.
- Public assets allow duplicate filenames.
- Public asset URLs never include the filename.
- `assetId` is `asset_` plus 32 base62 characters, total length 38.
- `assetId` is generated with cryptographically secure random bytes. A unique database index is the final guard, and collisions retry.
- `assetId` is never reused.
- Rename, replace, delete, restore, trash, and hidden lifecycle changes never change the public URL.
- Renaming a public asset changes the filename used in `Content-Disposition`.
- Replacing a public asset defaults the current display filename to the selected replacement filename.
- Public asset rename must keep the extension compatible with the current MIME type.
- Public asset upload and replace require both a supported extension and matching MIME/content signature.
- First version supports images only: jpg, jpeg, png, webp, gif, avif, and ico.
- First version rejects SVG.
- The image type policy must live in one server-side configuration location and be shared by upload and replace validation.
- Public URL responses always use `Content-Disposition: inline; filename="<current filename>"`.
- Public URL responses do not support download query parameters, filename parameters, `/download`, or directory URLs.
- Public URL responses support `ETag` and `If-None-Match`.
- Public URL responses use `Cache-Control: public, max-age=300`.
- Public URL responses do not support Range in the first version.
- `GET` and `HEAD` are accepted on `/files/:assetId`.
- `HEAD` writes access detail but does not increase the user-visible access count.
- `GET` 200 and 304 increase access count.
- 404 visits for well-formed `/files/:assetId` paths write access detail.
- Access detail is admin-only and permanently retained.
- Access statistic writes must be isolated from file response delivery. Failures are logged and never break the response.
- Public asset list shows no thumbnails in the first version.
- Public asset list is paginated, searchable by filename and `assetId`, and fixed to newest-created-first ordering.
- The user cannot choose sort order in the first version.
- Public asset details use a side sheet or equivalent detail panel.
- Batch upload is supported with limited concurrency, suggested concurrency 3.
- Batch upload results stay visible until the user closes them and preserve the user's selected file order.
- Batch operations other than upload are not included in the first version.
- Public asset single-item operations are copy link, rename, replace, download, delete, and details.
- Management download is logged-in. The public URL remains inline-only.
- Public assets appear in global Drive search results with `公开素材` as the path prefix and a copy-link shortcut.
- Drive deletion becomes two-stage soft delete for normal Drive files and public assets.
- User delete changes `active` to `trashed`.
- User delete from trash changes `trashed` to `hidden`.
- `active` and `trashed` count toward user quota.
- `hidden` does not count toward user quota but remains visible to administrators and remains in object storage.
- Objects are not physically deleted in the first version.
- Administrators can see active, trashed, hidden, and legacy missing records.
- Administrators can download active, trashed, and hidden current file objects. This must be audited.
- Administrators can restore hidden records if the user's quota has enough space.
- Administrators cannot physically purge objects in the first version.
- Old deleted Drive items whose objects were already removed are marked admin-visible and not recoverable.
- Normal Drive shares and public asset URLs are inaccessible while the item is `trashed` or `hidden`.
- Restore makes existing Drive share links and public asset URLs available again.
- Public asset replacement history is retained internally.
- Public asset replacement history does not count toward user quota.
- Administrators can view and download public asset replacement history.
- Administrators cannot restore a public asset to a historical replacement version in the first version.

## Non-Goals

- Do not build an independent image hosting, public file, or CDN management system.
- Do not support non-image public assets in the first version.
- Do not support SVG public assets in the first version.
- Do not support public asset folders, nested paths, or user-defined public URL slugs.
- Do not expose public asset access details to normal users or MCP.
- Do not expose hidden admin recovery through ordinary user MCP tools.
- Do not implement physical object purge in the first version.
- Do not implement CSV export for access logs in the first version.
- Do not implement public URL download parameters or Range responses in the first version.
- Do not add thumbnails or a gallery layout in the first version.
- Do not create custom UI colors, custom component styles, or a parallel design system.

## Product Model

Drive root becomes:

```text
云盘根目录
├─ 公开素材
├─ 回收站
├─ 普通文件夹...
└─ 普通文件...
```

`公开素材` is a virtual projection over Drive-backed public asset records:

```text
公开素材
├─ logo.png       → /files/asset_...
├─ logo.png       → /files/asset_...
└─ banner.webp    → /files/asset_...
```

`回收站` is a virtual projection over user-visible `trashed` deletion roots:

```text
回收站
├─ 项目A/
├─ 方案.pdf
└─ 公开素材 / logo.png
```

Normal Drive and public assets share the same lifecycle:

```text
active
  ↓ user delete
trashed
  ↓ user delete from trash
hidden
```

Restore behavior:

```text
normal Drive item:
  restore to original parent
  if original parent is unavailable, restore to root
  if same-type name conflicts, auto-rename

public asset:
  restore to 公开素材
  allow duplicate names
  preserve assetId and URL
```

Folder deletion behavior:

```text
删除 项目A/
  ↓
回收站只显示 项目A/
  ↓
恢复或再次删除 项目A/ 时对子树整体生效
```

Administrators may inspect and restore individual children from a deleted folder subtree. If the original parent is unavailable, the child restores to the user's Drive root with normal conflict handling.

## Data Model

### DriveItem

`DriveItem` continues to represent the file or folder body. Add explicit lifecycle and restore metadata instead of relying only on `deletedAt`.

Suggested fields:

```prisma
model DriveItem {
  id                   String    @id @default(cuid())
  userId               String
  parentId             String?
  type                 String    @db.VarChar(16)
  name                 String    @db.VarChar(255)
  size                 BigInt    @default(0)
  mimeType             String?   @db.VarChar(255)
  storageKey           String?   @unique
  storageStatus        String    @db.VarChar(32)
  uploadStatus         String    @db.VarChar(32)
  storageDeletePending Boolean   @default(false)
  lifecycleStatus      String    @default("active") @db.VarChar(32)
  trashedAt            DateTime?
  trashedBy            String?
  hiddenAt             DateTime?
  hiddenBy             String?
  restoreParentId      String?
  restorePath          String?
  deleteRootId         String?
  objectMissing        Boolean   @default(false)
  deletedAt            DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@index([userId, parentId, lifecycleStatus, createdAt])
  @@index([userId, lifecycleStatus, updatedAt])
  @@index([deleteRootId, lifecycleStatus])
  @@index([storageStatus])
  @@index([objectMissing])
}
```

`deletedAt` can remain for compatibility, but new code should use `lifecycleStatus` as the state source. `deletedAt` may mirror `trashedAt` for old query compatibility during migration.

Lifecycle values:

- `active`
- `trashed`
- `hidden`
- `legacy_missing`

`legacy_missing` is for records deleted by old behavior where the storage object may no longer exist. These are admin-visible and not recoverable.

`deleteRootId` identifies the user-visible trash root. When deleting a folder, every child receives the same `deleteRootId` as the deleted folder id. Normal user trash lists show only records where `id = deleteRootId`.

`restorePath` stores a display snapshot for the recycle bin and admin views. Restore uses `restoreParentId` first, not string path resolution.

### PublicAsset

`PublicAsset` carries public asset identity and aggregate stats. The current filename, size, MIME type, lifecycle, and storage key are read from the linked `DriveItem`.

```prisma
model PublicAsset {
  id              String    @id @default(cuid())
  assetId         String    @unique @db.VarChar(38)
  userId          String
  driveItemId     String    @unique
  originalName    String    @db.VarChar(255)
  accessCount     BigInt    @default(0)
  responseBytes   BigInt    @default(0)
  lastAccessedAt  DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([userId, createdAt])
  @@index([lastAccessedAt])
}
```

### PublicAssetAccessLog

Access detail is append-only and admin-only.

```prisma
model PublicAssetAccessLog {
  id             String    @id @default(cuid())
  assetId        String    @db.VarChar(38)
  publicAssetId  String?
  userId         String?
  ip             String?
  referer        String?
  userAgent      String?
  method         String    @db.VarChar(16)
  statusCode     Int
  bytes          BigInt    @default(0)
  accessedAt     DateTime  @default(now())

  @@index([assetId, accessedAt])
  @@index([publicAssetId, accessedAt])
  @@index([userId, accessedAt])
  @@index([statusCode, accessedAt])
  @@index([method, accessedAt])
}
```

### PublicAssetRevision

Public asset replacement history is internal. It is not a normal user version list.

```prisma
model PublicAssetRevision {
  id             String    @id @default(cuid())
  publicAssetId  String
  driveItemId     String
  storageKey     String    @unique
  name           String    @db.VarChar(255)
  size           BigInt
  mimeType       String?   @db.VarChar(255)
  etag           String?
  replacedAt     DateTime  @default(now())
  replacedBy     String?

  @@index([publicAssetId, replacedAt])
}
```

### Upload Sessions

Reuse `DriveUploadSession` for normal Drive upload, public asset upload, and public asset replace. Extend it with explicit purpose metadata so prepare, PUT, complete, cancellation, expiry, quota reservation, and storage cleanup keep one operational path.

Suggested additional fields:

```text
purpose: drive_upload | public_asset_upload | public_asset_replace
publicAssetId nullable
replacePreviousStorageKey nullable
```

The service should branch by `purpose` at narrow validation and completion points, not by duplicating the whole upload-session lifecycle.

## Quota Model

User quota counts:

```text
active normal Drive current files
+ trashed normal Drive current files
+ active public asset current files
+ trashed public asset current files
+ normal Drive file versions, unchanged from existing version policy
```

User quota does not count:

```text
hidden current files
legacy_missing records
public asset replacement history
```

Admin storage views should show:

```text
user quota usage: active + trashed
hidden object usage
normal Drive historical version usage
public asset replacement history usage
platform actual object usage
object missing count
```

When an admin restores a hidden file, the server must check the user's quota. If restoring would exceed quota, the restore is blocked.

## Public Asset Upload Flow

### Prepare

```text
POST /api/drive/public-assets/uploads/prepare
```

Responsibilities:

1. Normalize and validate filename.
2. Require a supported extension.
3. Require a declared MIME type compatible with the extension.
4. Require size <= Drive max file size.
5. Check quota and reserve the requested size.
6. Generate `assetId` with collision retry.
7. Create a pending `DriveItem(file)`.
8. Create `PublicAsset`.
9. Create upload session.
10. Create storage upload instruction.

### Complete

```text
POST /api/drive/public-assets/uploads/:sessionId/complete
```

Responsibilities:

1. Verify session ownership, status, and expiry.
2. Verify object exists and size matches.
3. Read object header bytes.
4. Detect real image type by magic number.
5. Require real type, declared MIME, and extension to match the public asset policy.
6. Transactionally complete the session, activate the Drive item, and move reserved bytes to used bytes.
7. Initialize stats.
8. Record audit.

On validation or completion failure, release reserved quota and clean up the temporary object. Failed public assets do not appear in the user list.

### Batch Upload

Desktop should run independent upload flows with limited concurrency, suggested concurrency 3.

Results are ordered by the original file selection order:

```text
logo.png      成功   复制链接
banner.webp   成功   复制链接
icon.svg      失败   仅支持图片
```

Successful items stay created even if other files fail.

## Public Asset Replace Flow

### Prepare

```text
POST /api/drive/public-assets/:assetId/replace/prepare
```

Responsibilities:

1. Require asset ownership and `active` lifecycle.
2. Validate filename, extension, declared MIME, and size.
3. Check quota by size delta:

   ```text
   available + currentSize >= replacementSize
   ```

4. Reserve only the positive delta.
5. Create replace session and upload instruction for a temporary object.

### Complete

```text
POST /api/drive/public-assets/:assetId/replace/:sessionId/complete
```

Responsibilities:

1. Verify session ownership, status, expiry, size, and image signature.
2. In a transaction:
   - Insert current object metadata into `PublicAssetRevision`.
   - Switch `DriveItem.storageKey`, `name`, `size`, and `mimeType` to the new object.
   - Adjust quota by the new-current minus old-current delta.
   - Complete the session.
   - Update audit metadata.
3. Keep old object storage. Do not delete it.

If database update fails, the old file remains current and the new temporary object is cleaned up. If cleanup fails, log a warning with redacted storage details and retry using existing cleanup patterns.

## Trash And Restore Flow

### Delete Active Item

Normal user delete:

```text
active → trashed
```

Effects:

- Set `lifecycleStatus=trashed`.
- Set `trashedAt`, `trashedBy`.
- Set `restoreParentId` and `restorePath`.
- Set `deleteRootId` for the deletion root and its subtree.
- Keep storage objects.
- Keep quota charged.
- Keep Drive shares enabled in metadata, but public access checks must reject non-active items.
- Keep public asset records, but `/files/:assetId` returns 404 while trashed.

### Delete From Trash

Normal user delete from trash:

```text
trashed → hidden
```

Effects:

- Set `lifecycleStatus=hidden`.
- Set `hiddenAt`, `hiddenBy`.
- Keep storage objects.
- Release user quota for the current file object.
- Remove from user-visible trash.
- Keep admin visibility.

### Restore

Normal user restore:

```text
trashed → active
```

Effects:

- Verify quota.
- Restore normal Drive item to `restoreParentId` if active and valid.
- If the original parent is unavailable, restore to root.
- Auto-rename normal Drive items on same-type name conflict.
- Restore public assets to `公开素材` without conflict handling.
- Clear `trashedAt`, `trashedBy`, `hiddenAt`, `hiddenBy` as appropriate.
- Clear `deleteRootId` for the restored subtree.

Admin restore:

```text
trashed | hidden → active
```

Effects are the same, but hidden restore must also check quota. If quota is insufficient, the operation fails.

### Legacy Migration

For existing deleted `DriveItem` records from old behavior:

- If object exists, migration may mark as `hidden` or `legacy_missing` depending on confidence.
- If object is missing, mark `legacy_missing` and `objectMissing=true`.
- Do not show legacy missing records in user trash.
- Admin can inspect legacy missing metadata.
- Legacy missing records are not restorable.

## API Design

### User Public Asset API

```text
GET    /api/drive/public-assets
GET    /api/drive/public-assets/:assetId
PATCH  /api/drive/public-assets/:assetId
DELETE /api/drive/public-assets/:assetId

POST   /api/drive/public-assets/uploads/prepare
POST   /api/drive/public-assets/uploads/:sessionId/complete
POST   /api/drive/public-assets/uploads/:sessionId/cancel

POST   /api/drive/public-assets/:assetId/replace/prepare
POST   /api/drive/public-assets/:assetId/replace/:sessionId/complete
POST   /api/drive/public-assets/:assetId/replace/:sessionId/cancel

GET    /api/drive/public-assets/:assetId/download
```

List defaults:

```text
status=active
page size default 50
sort fixed: createdAt desc
search: filename + assetId
```

Rename uses `PATCH`. It validates filename and extension compatibility with the current MIME.

Delete maps `active` to `trashed`.

### User Trash API

```text
GET    /api/drive/trash
POST   /api/drive/items/:id/restore
DELETE /api/drive/trash/:id
```

Trash list supports:

```text
type=all | normal | public_asset
search=filename/path/assetId
page size default 50
```

`DELETE /api/drive/trash/:id` maps `trashed` to `hidden` and is high risk.

### Public URL

```text
GET  /files/:assetId
HEAD /files/:assetId
```

Resolution:

1. Validate `assetId` shape.
2. Load `PublicAsset` and linked `DriveItem`.
3. Return 404 for missing, non-active, object-missing, or invalid records.
4. Resolve object stream and metadata.
5. Return 304 for `If-None-Match` match.
6. Return 200 with image bytes otherwise.

Response headers:

```text
Cache-Control: public, max-age=300
ETag: "<current object etag or stable content revision tag>"
Content-Type: <current MIME>
Content-Disposition: inline; filename="<current DriveItem.name>"
```

404 responses must not use long public cache headers.

### Admin API

```text
GET    /api/admin/drive/items
GET    /api/admin/drive/items/:id/download
POST   /api/admin/drive/items/:id/restore
DELETE /api/admin/drive/items/:id

GET    /api/admin/drive/public-assets
GET    /api/admin/drive/public-assets/:assetId
GET    /api/admin/drive/public-assets/:assetId/access-logs
GET    /api/admin/drive/public-assets/:assetId/revisions
GET    /api/admin/drive/public-assets/:assetId/revisions/:revisionId/download
```

Admin `DELETE` means hide, not physical purge, in the first version. Hiding an active or trashed item releases user quota but keeps the object for admin visibility and recovery.

Admin download and restore must write audit records.

## Access Statistics

Access logging is fire-and-forget after response outcome is known.

Detail behavior:

```text
GET active 200       write detail, count +1, bytes += body bytes
GET active 304       write detail, count +1, bytes += 0
HEAD active 200/304  write detail, count unchanged, bytes += 0
GET/HEAD 404         write detail, count unchanged, bytes += 0
```

If `assetId` is well-formed but no record exists, write `publicAssetId=null` and `userId=null`.

Logging failures:

- never affect the file response
- are logged as warnings
- must not leak tokens, Authorization headers, cookies, or storage secrets

Normal users see only:

- access count
- response bytes
- last accessed time

Administrators see full access detail:

- IP
- Referer
- User-Agent
- assetId
- method
- status code
- bytes
- time

No access detail MCP tool is included.

## UI Design Requirements

UI must follow Synapse's current product design system: shadcn/Radix components, Tailwind token classes, compact density, token colors, no custom colors, no gradients, no decorative shadows, no card nesting, and no explanatory marketing copy.

Use familiar product controls:

- `Button` with lucide icons for upload, copy, replace, download, restore, delete, and more actions.
- `Table` or existing list pattern for Drive items, public assets, trash, and admin logs.
- `DropdownMenu` for row actions.
- `Sheet` for public asset details.
- `Dialog` or `AlertDialog` only for destructive confirmations and upload result review where inline UI is insufficient.
- `Badge` for lifecycle and type labels.
- `Tabs` or segmented control for trash type filters.
- `Input` for search.
- Existing toast pattern for operation feedback.

### Drive Root

Root list order:

```text
公开素材
回收站
normal folders and files
```

The two system entries should look like Drive rows, not promotional cards. They can use a small system badge or icon, but no helper paragraph is needed.

System entry constraints:

- fixed at root top
- excluded from ordinary sort
- not shown inside normal folders
- no rename, move, delete, or share actions
- row click opens the virtual view

### Public Asset List

Layout:

```text
[搜索]                         [上传公开素材]

文件名 | 大小 | 类型 | 公开链接 | 访问次数 | 最近访问 | 操作
```

Requirements:

- no thumbnails
- no gallery grid
- no user-controlled sorting
- paginated, default 50 per page
- search filename and `assetId`
- show copy-link action inline or in the URL column
- row click opens details
- row actions must stop propagation
- empty state should be short, for example `暂无公开素材`
- upload button label should be `上传公开素材`

Do not write feature-introduction copy such as "公开素材可以帮助你..." in the UI.

### Public Asset Detail Sheet

Fields:

```text
文件名
公开链接
assetId
MIME
大小
访问次数
响应字节
最近访问
创建时间
更新时间
```

Actions:

```text
复制链接
重命名
替换文件
下载
删除
```

Do not show access logs to normal users. Do not show replacement history to normal users.

### Batch Upload Result

Use a compact result panel or dialog that remains until dismissed:

```text
logo.png      成功   复制链接
banner.webp   成功   复制链接
icon.svg      失败   仅支持图片
```

Requirements:

- preserve original selected order
- show per-file success or failure
- include copy-link for successful rows
- no half-created failed asset rows in the main list

### Trash

Layout:

```text
[搜索] [全部] [普通文件] [公开素材]

名称 | 类型 | 原位置 | 删除时间 | 大小 | 操作
```

Actions:

```text
恢复
删除
```

`删除` from trash should use destructive confirmation because it moves the item to `hidden`, making it unavailable to the user.

Public assets in trash should show path prefix `公开素材`.

Folder deletions show the deletion root only for normal users.

### Admin Dashboard

Admin Drive surfaces should remain dense tables and detail sheets.

Admin file list filters:

- owner
- lifecycle status: active, trashed, hidden, legacy missing
- type
- storage/object status
- search

Admin public asset list filters:

- owner
- lifecycle status
- assetId/search
- status/object missing

Admin public asset detail includes:

- current file metadata and download
- lifecycle
- owner
- public URL
- access summary
- access detail table
- replacement history table with download

Admin storage summary includes:

- user quota usage
- hidden object usage
- normal Drive history usage
- public asset replacement history usage
- platform actual object usage

No CSV export is included in the first version.

## Desktop Bridge

Add typed bridge methods under `account` for user-facing operations:

```ts
listDrivePublicAssets(input)
getDrivePublicAsset(input)
prepareDrivePublicAssetUpload(input)
completeDrivePublicAssetUpload(input)
cancelDrivePublicAssetUpload(input)
prepareDrivePublicAssetReplace(input)
completeDrivePublicAssetReplace(input)
cancelDrivePublicAssetReplace(input)
renameDrivePublicAsset(input)
deleteDrivePublicAsset(input)
restoreDriveItem(input)
listDriveTrash(input)
deleteDriveTrashItem(input)
downloadDrivePublicAsset(input)
```

Bridge responses must not expose storage credentials, COS keys, Authorization headers, presigned URLs beyond the intended upload instruction, or internal storage keys.

## MCP Capabilities

Update Drive capabilities in `desktop/synapse-capabilities/shared/drive-domain.ts` and related MCP schemas.

Public asset tools:

```text
drive.direct_link.upload   → drive_direct_link_upload
drive.direct_link.list     → drive_direct_link_list
drive.direct_link.get      → drive_direct_link_get
drive.direct_link.update   → drive_direct_link_update
drive.direct_link.delete   → drive_direct_link_delete
drive.direct_link.restore  → drive_direct_link_restore
```

Trash tools:

```text
drive.trash.list      → drive_trash_list
drive.trash.delete    → drive_trash_delete
drive.item.restore    → drive_item_restore
```

Existing semantic change:

```text
drive.item.delete
  active → trashed
```

Descriptions should include user-language aliases:

```text
公开素材
图床
外链
直链
公开链接
public asset
direct link
```

MCP write operations require permission confirmation and audit:

- upload
- update/replace
- delete
- restore
- trash delete

MCP read operations:

- list
- get
- trash list

MCP must not expose:

- public asset access detail
- hidden admin recovery
- physical purge
- storage credentials or signed URL internals

Update the built-in Synapse Drive MCP skill/guide and API reference so agent instructions match the new lifecycle and public asset terminology.

## Security And Validation

Public asset validation must not trust client MIME alone.

Validation layers:

1. Filename is valid Drive filename.
2. Extension is present and whitelisted.
3. Declared MIME is whitelisted and compatible with extension.
4. Complete reads object header bytes and verifies magic number.
5. Magic number result must match declared MIME and extension.

Central policy:

```text
jpg/jpeg → image/jpeg
png      → image/png
webp     → image/webp
gif      → image/gif
avif     → image/avif
ico      → image/x-icon
```

SVG is rejected.

Use a small in-repo detector for these image signatures or an existing dependency if already present. Do not add a large dependency only for this validation.

Public responses must not reveal whether an asset exists but is trashed, hidden, forbidden, or missing. They all return 404.

Logs and audit records must not include storage credentials, Authorization headers, cookies, or upload URLs.

## Testing Plan

### Server Unit And Integration Tests

- `assetId` format is `asset_` plus 32 base62 characters.
- `assetId` collision retries and unique index prevents overwrite.
- Public asset upload rejects unsupported extensions.
- Public asset upload rejects SVG.
- Public asset upload rejects missing extension.
- Public asset upload rejects MIME/extension mismatch.
- Complete rejects magic-number mismatch.
- Successful upload creates `DriveItem`, `PublicAsset`, active lifecycle, and quota usage.
- Upload validation failure releases reserved quota and leaves no visible asset.
- Upload DB failure cleans temporary object.
- Replace checks ownership and active lifecycle.
- Replace allows MIME changes among allowed image types.
- Replace changes current filename to the replacement filename.
- Replace records old current object in `PublicAssetRevision`.
- Replace charges only size delta.
- Replace failure leaves old URL content available and cleans temporary object.
- Public asset rename validates extension against current MIME.
- Public asset duplicate names are allowed.
- Public asset restore preserves duplicate names.
- Public asset delete changes `active` to `trashed`.
- Trash delete changes `trashed` to `hidden` and releases user quota.
- Hidden restore checks quota and fails when quota is insufficient.
- Hidden records do not appear in user lists.
- Admin lists can see hidden records.
- Legacy missing records are admin-visible and not recoverable.
- Normal Drive delete no longer disables share metadata or deletes objects.
- Shares are inaccessible while item is trashed or hidden.
- Shares become accessible after restore.
- Folder deletion shows only root in user trash.
- Admin can restore individual subtree children.
- Normal Drive restore auto-renames on same-type conflict.
- Restore falls back to root when original parent is unavailable.

### Public URL Tests

- Active asset returns 200 with image content.
- Trashed asset returns 404.
- Hidden asset returns 404.
- Missing asset returns 404.
- Invalid asset id returns 404.
- 200 includes `Cache-Control: public, max-age=300`.
- 200 includes `Content-Disposition: inline`.
- 200 uses current renamed filename.
- `If-None-Match` returns 304.
- Range request is ignored and returns 200 full response.
- `HEAD` returns headers without body.
- GET 200 increments access count.
- GET 304 increments access count with zero bytes.
- HEAD writes detail but does not increment access count.
- 404 writes detail for well-formed asset ids.
- Statistic write failure does not affect file response.

### Desktop UI Tests

- Drive root shows `公开素材` and `回收站` fixed at top.
- System entries have no rename, move, delete, or share actions.
- Public asset list is paginated.
- Public asset search matches filename.
- Public asset search matches `assetId`.
- Public asset rows expose copy link and details.
- Public asset details show `assetId` and summary stats.
- Batch upload result preserves selected file order.
- Failed batch upload items do not appear in the public asset list.
- Trash filters all, normal files, and public assets.
- Trash search matches public asset `assetId`.
- Trash restore works.
- Trash delete requires confirmation.
- Global Drive search shows public assets with `公开素材` path prefix and copy-link action.

### Dashboard UI Tests

- Admin file list filters lifecycle states.
- Admin can see hidden records.
- Admin can download active, trashed, and hidden file objects.
- Admin restore hidden checks quota failure.
- Admin public asset detail shows access logs.
- Admin public asset detail shows replacement history downloads.
- Admin storage summary distinguishes quota usage, hidden usage, history usage, and platform actual usage.

### MCP Tests

- New capability ids pass canonical naming.
- Tool names use dot-to-underscore conversion.
- `drive.item.delete` maps active to trash.
- `drive.item.restore` restores trashed item.
- `drive.trash.list` lists user-visible trash.
- `drive.trash.delete` maps trashed to hidden and is high risk.
- `drive.direct_link.upload` creates a public asset.
- `drive.direct_link.list` defaults to active only.
- `drive.direct_link.get` does not expose access detail.
- `drive.direct_link.update` replaces current content.
- `drive.direct_link.delete` moves active public asset to trash.
- `drive.direct_link.restore` restores trashed public asset.
- Write tools require permission confirmation and audit.
- No MCP tool exposes admin access logs or physical purge.

## Rollout Notes

Migration should be careful because current Drive deletion may already have removed storage objects.

Suggested rollout:

1. Add lifecycle fields and public asset tables.
2. Migrate active Drive items to `lifecycleStatus=active`.
3. Migrate old deleted Drive items to admin-only legacy state, with object existence checks when practical.
4. Change delete behavior to soft lifecycle changes before exposing new UI.
5. Add trash API and UI.
6. Add public asset upload, replace, and public URL.
7. Add dashboard admin views.
8. Add MCP capabilities and update built-in Drive MCP docs.

## Spec Self-Review

- Placeholder scan: no unfinished placeholders remain.
- Consistency check: the design consistently treats public assets as Drive-backed records with a separate `PublicAsset` identity table.
- Scope check: this is a large but coherent Drive feature set. It should produce one implementation plan with phased tasks rather than separate unrelated specs.
- Ambiguity check: deletion is explicitly two-stage soft delete; no physical purge is included in the first version.
