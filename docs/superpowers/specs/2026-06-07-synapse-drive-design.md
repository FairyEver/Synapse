# Synapse Drive Design

Date: 2026-06-07
Scope: `server/`, `dashboard/`, `desktop/`, `shared/`, `docs/`

## Goal

Add a Synapse cloud drive service for personal file handoff. A logged-in user can upload files or folders, organize them in a personal cloud drive, create public share links, and send those links to colleagues. A public visitor can download a shared file or browse a shared folder without logging in. Admins can inspect all stored files and delete any user file or folder.

The first version is a complete drive MVP, not only a file-link MVP.

## Confirmed Product Decisions

- Scope is personal drive only. Team spaces are not included in the first version.
- Every user receives a personal root folder.
- Users can upload one file, upload one folder, create folders, move items, rename items, delete items, share files, and share folders.
- If an Agent uploads without a target folder, the uploaded item lands in the user's root folder.
- Admins can view all files and folders across users and delete any item.
- Admins do not move, rename, or create files on behalf of users in the first version.
- Default quota is 10 GB per user and 1 GB per file.
- Tencent Cloud COS stores file bytes. COS object keys use internal item ids, not filenames or folder paths.
- The database owns user ownership, folder path, filename, size, mime type, share state, quota, and storage metadata.
- Uploads use a server-issued upload session and short-lived COS upload credential. The desktop client uploads bytes directly to COS; Synapse server never exposes permanent AK/SK.
- Public link shape is:

  ```text
  https://<domain>/files/<shareId>
  ```

- `shareId` belongs to a share record. It is not the internal file or folder id.
- Moving or renaming a file or folder does not change its internal id or existing share link.
- Sharing is explicit. Uploaded files are not publicly accessible until the user creates a share.
- A user can disable a share. Wrong ids, disabled shares, deleted source items, and expired future shares all show the same public error text: `文件未找到`.
- Folder sharing opens a public folder page and also supports downloading the whole folder as a zip.
- Password-protected links are not implemented in the first version, but the data model reserves password and expiry fields.

## Non-Goals

- Do not build team shared drives in the first version.
- Do not implement encrypted storage or password-required public links in the first version.
- Do not expose Tencent Cloud AK/SK to desktop, dashboard, renderer, MCP responses, or logs.
- Do not use filenames or user folder paths as COS object keys.
- Do not make every uploaded item publicly accessible by default.
- Do not implement user file upload in the dashboard web UI in the first version. User upload and file organization live in the desktop client.
- Do not let admins reorganize a user's personal drive in the first version.
- Do not expose owner identity or deletion status on public error pages.
- Do not create a parallel dashboard component system or custom visual style for the management UI.

## URL And Identity Model

There are two ids:

- `DriveItem.id`: internal stable id for a file or folder in a user's drive.
- `DriveShare.shareId`: public, URL-safe, non-guessable id for an enabled share.

Public routes use `shareId`:

```text
GET /files/<shareId>
GET /files/<shareId>/download
GET /files/<shareId>/zip
```

`/files/<shareId>` is the canonical public link users copy. `/download` is the explicit file download endpoint for public folder file entries, and `/zip` is the folder download endpoint. The server decides whether the canonical share points to a file or folder.

Recommended `shareId` format:

```text
shr_<32+ url-safe random chars>
```

The database must enforce uniqueness. If generation collides, generation retries. Collisions must never overwrite an existing share.

## Data Model

### DriveItem

Represents both files and folders.

Suggested fields:

```prisma
model DriveItem {
  id                   String      @id @default(cuid())
  userId               String
  user                 User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  parentId             String?
  parent               DriveItem?  @relation("DriveTree", fields: [parentId], references: [id], onDelete: Restrict)
  children             DriveItem[] @relation("DriveTree")
  type                 String
  name                 String
  size                 BigInt      @default(0)
  mimeType             String?
  storageKey           String?
  storageStatus        String
  uploadStatus         String
  storageDeletePending Boolean     @default(false)
  createdAt            DateTime    @default(now())
  updatedAt            DateTime    @updatedAt
  deletedAt            DateTime?
  shares               DriveShare[]

  @@index([userId, parentId, deletedAt, createdAt])
  @@index([userId, deletedAt, updatedAt])
  @@index([storageStatus])
}
```

`type` is `file` or `folder`. `storageKey` is required for active files and null for folders. `storageKey` should be shaped like `drive/<driveItemId>`.

Same-name files are allowed in the same folder. Same-name folders should be rejected in the same parent in the first version to keep navigation and move dialogs unambiguous. This rule can be enforced in service validation rather than a partial unique index if soft-delete behavior makes the index awkward.

### DriveShare

Represents public access to one file or folder.

Suggested fields:

```prisma
model DriveShare {
  id              String    @id @default(cuid())
  shareId         String    @unique
  itemId          String
  item            DriveItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  userId          String
  type            String
  enabled         Boolean   @default(true)
  passwordEnabled Boolean   @default(false)
  passwordHash    String?
  expiresAt       DateTime?
  createdAt       DateTime  @default(now())
  disabledAt      DateTime?

  @@index([itemId, enabled])
  @@index([userId, createdAt])
}
```

`passwordEnabled`, `passwordHash`, and `expiresAt` are reserved for later private share links. The first version keeps them inactive in UI and API behavior.

### DriveUsage

Tracks quota for a user.

Suggested fields:

```prisma
model DriveUsage {
  userId        String   @id
  usedBytes     BigInt   @default(0)
  reservedBytes BigInt  @default(0)
  quotaBytes    BigInt
  updatedAt     DateTime @updatedAt
}
```

Default `quotaBytes` is 10 GB. Upload preparation must reserve quota transactionally by increasing `reservedBytes`; upload completion moves reserved bytes into `usedBytes`; cancellation, expiry, or failed verification releases the reservation. The server must enforce `usedBytes + reservedBytes + requestedBytes <= quotaBytes` so concurrent uploads cannot exceed quota.

### DriveUploadSession

Represents a pending direct-to-COS upload.

Suggested fields:

```prisma
model DriveUploadSession {
  id             String   @id @default(cuid())
  userId         String
  itemId         String
  storageKey     String
  expectedName   String
  expectedSize   BigInt
  expectedMime   String?
  status         String
  credentialKind String
  expiresAt      DateTime
  createdAt      DateTime @default(now())
  completedAt    DateTime?
  failedAt       DateTime?

  @@index([userId, status, createdAt])
  @@index([expiresAt, status])
}
```

Upload credentials are not stored in this table. It stores only the server-created upload intent, expected object key, expected size, status, and expiry.

## Storage And Credential Model

Tencent Cloud COS is the byte store. Permanent Tencent Cloud AK/SK live only in the server deployment secret layer, such as environment variables, Docker/Kubernetes secrets, or a cloud secret manager. They must not be stored in PostgreSQL, sent to desktop, sent to dashboard, included in MCP output, or written to logs. Dashboard diagnostics may show only whether COS is configured, never the credential value.

The permanent credential should belong to a least-privilege CAM identity that can issue scoped upload credentials and operate only the configured bucket/prefix needed by Synapse Drive. Credential rotation should be possible by replacing deployment secrets and restarting or reloading the server.

COS rules:

- File bytes are stored under `drive/<driveItemId>`.
- Folder structure is not mirrored in COS.
- File names are not used in COS keys.
- Metadata needed for download names, folder listings, and ownership is stored in PostgreSQL.

Uploads use direct-to-COS transfer with a server-issued upload session:

- The server, not the client, creates `DriveItem.id` and `storageKey`.
- The client never chooses the COS object key or random object filename.
- The server returns either a short-lived STS credential scoped to the exact object key and upload actions, or a short-lived pre-signed upload URL for the exact object key.
- The credential must expire quickly and must not allow listing, reading, deleting, or writing arbitrary keys.
- The client uploads bytes directly to COS.
- The client then calls the server completion endpoint.
- The server verifies the COS object exists and that size/key match the upload session before marking the item active and charging usage.

If the client uploads to the wrong key, it is outside the issued permission scope and should fail. If the client uploads wrong bytes or size to the right key, completion verification fails, the object is deleted or marked for cleanup, and reserved quota is released.

Deletion should mark database state first, then delete COS objects. If COS deletion fails, keep `storageDeletePending=true` and expose retry diagnostics to admin operations or a future maintenance task. A failed COS delete must not resurrect the user-visible file.

## User Upload Flow

Single file upload:

1. Client or MCP sends target `parentId`, file name, file size, and mime type.
2. Server verifies the authenticated user, parent folder ownership, single-file limit, and remaining quota.
3. Server creates an uploading `DriveItem`, creates a `DriveUploadSession`, reserves quota transactionally, and generates `storageKey=drive/<driveItemId>`.
4. Server returns upload instructions with short-lived STS credentials or a pre-signed upload URL scoped to that exact `storageKey`.
5. Desktop client uploads bytes directly to COS.
6. Client calls the upload completion endpoint with the upload session id and COS upload metadata such as ETag when available.
7. Server checks the upload session, verifies the object in COS by key and size, marks the item active, moves reserved quota into used quota, and returns item metadata.
8. On upload failure, cancellation, timeout, or verification mismatch, server releases reserved quota and marks or removes the uploading record. Any uploaded object for the failed session is deleted or marked for cleanup.

Folder upload:

1. Client sends a relative path manifest.
2. Server creates missing folder nodes in the target parent.
3. Server prepares one upload session per file, each with its own server-generated `DriveItem.id` and `storageKey`.
4. Desktop client uploads file bytes directly to COS, then completes each session.
5. Response returns successful items and skipped or failed entries.

Partial success is allowed for folder upload. The UI and MCP result must make partial failures explicit.

## Public Access Flow

`GET /files/<shareId>`:

- If share points to a file, return a download response or redirect to a short-lived COS signed URL.
- If share points to a folder, render the public folder page.
- If share is missing, disabled, expired, password-locked in a future version without valid password, or the source item is deleted, return a public error page that says `文件未找到`.

File downloads should prefer server validation followed by `302` to a short-lived COS signed URL. This avoids streaming all file bytes through Synapse for normal file downloads while keeping public permission checks in Synapse.

Folder share page:

- Shows folder name.
- Lists child folders and files under the shared folder.
- Supports individual file download within the share context.
- Supports `下载全部`.
- Does not show owner email, internal item ids, admin metadata, or private path outside the shared folder.

Folder zip:

- Small folders can be streamed as a zip from the server.
- Large folders should use an async zip job with a public page state such as preparing, ready, or failed.
- Generated zip files are temporary download artifacts, not normal user drive files.
- Zip generation must have size and item-count thresholds to protect the server.

## User Interface

Add a top-level `云盘` module entry in the CNAPS/Synapse desktop client.

The user drive screen uses a standard file manager layout:

- Left folder tree.
- Top toolbar with breadcrumbs, search, upload file, upload folder, and new folder.
- Main file list with name, type, size, updated time, and share status.
- Row actions: download, share, disable share, move, rename, delete.
- Batch actions for selected items: move and delete.
- Folder rows open on double-click or explicit open action.
- Drag move can be added if it fits existing renderer interaction patterns; click-based move is sufficient for the first implementation.

The share dialog stays minimal:

- Shows link after sharing.
- Copy link.
- Disable share.
- It should not show disabled password or expiry controls in the first version.

UI copy should stay operational and short. No feature-introduction paragraphs or marketing text.

The first version does not add user upload or user file organization pages to the dashboard web UI. Dashboard remains for admin management only.

## Admin Dashboard

Add a dashboard `云盘` admin page.

The page lists all users' drive items using the existing server-side data table pattern:

- Name
- Type
- Owner user
- Size
- Upload or created time
- Share status
- Storage status
- Actions

Admin actions:

- Delete file.
- Delete folder.

Deleting a folder requires confirmation and should show the number of child files and total bytes affected. Admin deletion cascades through the visible drive tree and disables related shares. Admins do not move or rename user items in the first version.

The page supports filters for owner, type, share status, and storage status, plus search by name or id. Pagination and sorting are server-side.

## MCP Domain And Built-In Skill

Add a new MCP capability domain named `drive`.

Canonical capabilities and MCP tools:

| Capability id | MCP tool | Mutates | Purpose |
| --- | --- | --- | --- |
| `drive.item.list` | `drive_item_list` | false | List items under a folder. |
| `drive.item.get` | `drive_item_get` | false | Get one item summary. |
| `drive.file.upload` | `drive_file_upload` | true | Upload a local file to the user's drive. |
| `drive.folder.upload` | `drive_folder_upload` | true | Upload a local folder while preserving relative paths. |
| `drive.folder.create` | `drive_folder_create` | true | Create a folder. |
| `drive.item.rename` | `drive_item_rename` | true | Rename an item. |
| `drive.item.move` | `drive_item_move` | true | Move an item to another folder. |
| `drive.delete_impact.get` | `drive_delete_impact_get` | false | Check affected page or site publications before deletion. |
| `drive.item.delete` | `drive_item_delete` | true | Delete a file or folder. |
| `drive.item_preview.get` | `drive_item_preview_get` | false | Get the owner preview snapshot and available browser URLs. |
| `drive.file_content.read` | `drive_file_content_read` | false | Read previewable small text content. |
| `drive.file_download.create` | `drive_file_download_create` | true | Save one Drive file to a local path. |
| `drive.folder_zip.create` | `drive_folder_zip_create` | true | Save one Drive folder as a local zip file. |
| `drive.share.list` | `drive_share_list` | false | List current user's `/files/...` share links. |
| `drive.share.create` | `drive_share_create` | true | Create or return an enabled share link. |
| `drive.share.disable` | `drive_share_disable` | true | Disable a share. |
| `drive.publication.list` | `drive_publication_list` | false | List current user's `/pages/...` and `/sites/...` publication links. |
| `drive.page_publication.create` | `drive_page_publication_create` | true | Publish an HTML file as a page. |
| `drive.site_publication.create` | `drive_site_publication_create` | true | Publish a folder with root `index.html` as a site. |
| `drive.publication_deployment.create` | `drive_publication_deployment_create` | true | Create a new deployment snapshot for an existing publication. |
| `drive.publication.disable` | `drive_publication_disable` | true | Disable a page or site publication. |
| `drive.usage.get` | `drive_usage_get` | false | Return quota and usage summary. |

MCP responses must not include COS credentials, AK/SK, signed URLs with long lifetime, password hashes, or private admin-only metadata.

Mutating tools must use the existing permission and audit patterns for agent-driven operations. Deletion should require a clear user confirmation before the Agent proceeds. Tools that save Drive content to a local path must pass filesystem write permission before writing.

Add a built-in skill template named `synapse-drive-mcp`. The skill should guide Agents to:

- Resolve target folders through `drive_item_list` or `drive_item_get`.
- Upload to root when no target folder is specified.
- Use share tools only for `/files/...` browse/download links.
- Use publication tools only when the user wants an HTML page or site online under `/pages/...` or `/sites/...`.
- Use preview and text-read tools for inspection, and download or zip tools when the user asks to save Drive content locally.
- Never guess ids from names when duplicates may exist.
- Confirm before deleting or moving many items.
- Report partial failures from folder upload.

## API Surface

Recommended authenticated user API group:

```text
GET    /api/drive/items
GET    /api/drive/items/:id
POST   /api/drive/uploads/prepare
POST   /api/drive/uploads/:sessionId/complete
POST   /api/drive/uploads/:sessionId/cancel
POST   /api/drive/folders
PATCH  /api/drive/items/:id
DELETE /api/drive/items/:id
POST   /api/drive/items/:id/share
DELETE /api/drive/shares/:id
GET    /api/drive/usage
```

Recommended admin API group:

```text
GET    /api/admin/drive/items
DELETE /api/admin/drive/items/:id
```

The final route names can follow the current server controller naming conventions, but authenticated user routes must stay under `/api/drive/*`; admin routes stay under `/api/admin/drive/*`; public share routes stay under `/files/*`.

## Error Handling

Public errors:

- Always display `文件未找到` for missing, disabled, deleted, expired, or invalid share links.
- Do not disclose whether the id ever existed.

Authenticated API errors:

- Return clear quota errors for over-limit uploads.
- Return not-found errors for items outside the current user's drive.
- Return validation errors for invalid parent folders, folder cycles, invalid names, oversized files, and unsupported operations.

Storage errors:

- Upload failures release quota reservations.
- Upload session expiry releases reserved quota and schedules any partial COS object for cleanup.
- Upload completion verifies COS object key and size before making the item active.
- COS delete failures mark delete-pending state and log structured diagnostics.
- COS credentials and signed URLs must be redacted from logs and MCP output.

## Security And Privacy

- AK/SK live only in server configuration.
- Desktop clients receive only short-lived, scoped upload credentials or pre-signed upload URLs for server-generated object keys.
- Public visitors cannot infer owner identity from share pages or errors.
- Shares are explicit and revocable.
- Share ids must be non-guessable and unique.
- COS object keys are generated by the server from `DriveItem.id`; clients never generate storage object names.
- All user operations check item ownership server-side.
- Agent/MCP mutating operations follow permission and audit patterns.
- Quota checks are enforced server-side for UI, API, and MCP.
- Public folder pages only expose the subtree under the shared folder.

## Implementation Phases

1. Server foundation: Prisma models, quota service, COS adapter, upload-session preparation and completion, delete, public file download, and public error page.
2. User drive UI: desktop top entry, file manager, upload file/folder, folder operations, sharing, and quota display.
3. Admin dashboard: global drive table, filters, and admin delete.
4. MCP and skill: `drive` capability domain, dispatcher, tool docs, `synapse-drive-mcp` template, and capability naming matrix updates.

## Testing

Server tests:

- Unique share id generation retries on collision.
- Same-name files can coexist in one folder.
- Same-name folders in one parent are rejected.
- Moving an item does not change its id or share link.
- Disabled or deleted shares return the public not-found page.
- Upload enforces 1 GB single-file limit and 10 GB user quota.
- Concurrent uploads cannot exceed quota.
- Upload prepare returns only scoped temporary upload credentials or pre-signed URLs.
- Upload completion rejects wrong key, wrong size, expired sessions, and missing COS objects.
- Upload failure, cancellation, and session expiry release reserved quota.
- COS delete failure leaves delete-pending state.

Dashboard and desktop tests:

- User file manager renders root and folder contents.
- Upload file and folder flows show success and partial failure.
- Share dialog creates, copies, and disables share links.
- Admin table uses server-side pagination and delete confirmation.
- Public folder page lists only shared subtree contents.
- Dashboard does not expose user upload or user file organization in the first version.

MCP tests:

- `drive_item_list`, `drive_item_get`, and `drive_usage_get` return safe summaries.
- Upload defaults to root when no parent is supplied.
- Upload uses prepare/complete semantics and does not expose permanent COS credentials.
- Share create returns `/files/<shareId>`.
- Delete and move route through permission and audit handling.
- MCP responses never include COS credentials or password hashes.

## Implementation Notes

These notes guide implementation without changing the confirmed product scope:

- Exact COS SDK package and upload credential mode depend on existing server dependency policy.
- Upload credentials should use Tencent Cloud COS STS or pre-signed upload URLs, selected during implementation based on SDK fit and multipart upload support.
- Zip async threshold should be set during implementation after checking server limits.
