# Drive File Version History Design

Date: 2026-06-17
Scope: `server/`, `dashboard/`, `desktop/`, `shared/`, `desktop/synapse-capabilities/`, `desktop/resources/templates/skills/synapse-drive-mcp/`

## Goal

Add file history versions to Synapse Drive. Users can browse, download, restore, pin, and delete historical versions of a Drive file. Version generation is automatic for file content changes, while users keep explicit control over important versions and storage cleanup.

The design must support current upload overwrite behavior and reserve a clean path for future online file editing. Online editing is not implemented in this stage.

## Confirmed Product Decisions

- Historical versions apply to files only, not folders.
- File versions are generated only when file content changes.
- Upload overwrite, folder upload overwrite, future online edit saves, and version restore all count as file change scenarios.
- Rename, move, share setting changes, password changes, expiry changes, and other metadata-only operations do not generate file versions.
- Files can include `docx`, binary assets, archives, images, and other non-text formats, so versions are stored as full object copies.
- Do not use source-level delta storage or text diff storage.
- Historical versions count toward the user's Drive quota.
- Users can restore a historical version. Restore creates a new current version instead of mutating an old version into the current file.
- Users can delete historical versions, but cannot delete the current version.
- Deleting a historical version releases the quota used by that version.
- Pinned versions require explicit user intent to delete and are excluded from automatic cleanup.
- Default automatic cleanup keeps at most 100 undeleted versions per file and treats unpinned non-current versions older than 180 days as cleanup candidates.

## Non-Goals

- Do not implement online file editing in this stage.
- Do not implement collaborative editing, locks, conflict merge UI, or file diff UI.
- Do not expose historical versions through existing public share links.
- Do not include historical versions in normal folder zip downloads.
- Do not add team-drive version policies.
- Do not add a complex end-user retention policy UI in the first version.
- Do not return COS keys, signed URLs, Authorization headers, or storage credentials in API, MCP, UI, logs, or audit details.

## Existing Context

Current Drive behavior already preserves `DriveItem.id` and share links when a same-name file upload overwrites an active file. Upload completion writes a replacement object first, verifies it, then switches `DriveItem.storageKey`, size, and mime metadata.

Rename and move operations reject same-type name conflicts instead of overwriting another item. Files and folders may share the same name because they are different item types.

The version history feature should attach to this existing content-switch point. The stable file identity remains `DriveItem.id`; versions are separate immutable records under that file.

## Data Model

Add `DriveFileVersion`.

Suggested fields:

```prisma
model DriveFileVersion {
  id                    String    @id @default(cuid())
  itemId                String
  item                  DriveItem @relation(fields: [itemId], references: [id], onDelete: Restrict)
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  versionNumber         Int
  storageKey            String    @unique
  size                  BigInt
  mimeType              String?   @db.VarChar(255)
  etag                  String?
  source                String    @db.VarChar(32)
  createdBy             String?
  restoredFromVersionId String?
  isPinned              Boolean   @default(false)
  deletedAt             DateTime?
  deletePending         Boolean   @default(false)
  createdAt             DateTime  @default(now())

  @@unique([itemId, versionNumber])
  @@index([itemId, deletedAt, versionNumber])
  @@index([userId, createdAt])
  @@index([deletePending])
}
```

`source` values:

- `upload`
- `online_edit`
- `restore`

`DriveItem` remains the current-file record. `DriveItem.storageKey`, `size`, `mimeType`, and `updatedAt` continue to answer normal open, preview, download, share, and zip operations. The current file also has a `DriveFileVersion` row, so version lists can show the current version consistently.

## Storage Model

Versions are full object copies in the Drive object store. The object store remains an internal implementation detail.

Recommended key shape:

```text
drive/<itemId>/versions/<versionId>
```

Upload sessions may continue to use temporary overwrite keys such as:

```text
drive/<itemId>/overwrites/<sessionId>
```

After upload verification, the service creates the durable version object and points `DriveItem.storageKey` at the version object. Old version objects stay in object storage until the corresponding version is manually deleted or automatically cleaned up.

Version object deletion failures must not corrupt the current file pointer. A failed delete sets `deletePending=true` or keeps an equivalent retry marker for background cleanup.

## Quota Model

All undeleted file versions count toward `DriveUsage.usedBytes`, including the current version.

New upload:

- Reserve and charge the uploaded size.
- Create version `v1`.
- Point the item at `v1`.

Overwrite upload:

- Require enough available quota for the full new version size.
- On completion, increase `usedBytes` by the new version size.
- Keep the old version charged until user deletion or automatic cleanup removes it.

Restore:

- Require enough available quota for the restored version size.
- Create a new version from the selected historical version.
- Increase `usedBytes` by the restored version size.

Delete historical version:

- Reject if the version is current.
- Mark/delete the version and object.
- Decrease `usedBytes` by the deleted version size after the version is no longer available.

Automatic cleanup can release quota after a successful new version, but upload preparation must not rely on cleanup succeeding in advance.

## File Change Flow

All content changes should converge on a service-level operation such as:

```ts
createDriveFileVersionFromObject(input)
```

Responsibilities:

1. Verify user ownership and target file state.
2. Verify the source object exists and size matches the expected size.
3. Create or copy the object to a durable version key.
4. Allocate the next `versionNumber` transactionally.
5. Create `DriveFileVersion`.
6. Update `DriveItem.storageKey`, `size`, `mimeType`, `storageStatus`, and `uploadStatus`.
7. Update Drive quota.
8. Record audit details without exposing storage secrets.
9. Trigger per-file cleanup.

### Upload Overwrite

`completeUpload()` should no longer delete the replaced current object as part of normal overwrite success. Instead, the replaced object remains represented by its existing `DriveFileVersion`.

For migration safety, existing Drive files without version rows need a backfill path. The first content change for such a file must create a version row for the pre-change current object before switching the item to the new version, or a migration must pre-create current-version rows for all active files.

Concurrent overwrites keep current behavior: the last completed upload becomes current. Version numbers must remain unique and strictly increasing for the file.

### Folder Upload Overwrite

Folder upload already calls single-file upload preparation for each file entry. Same-path same-name files that are overwritten generate versions through the same upload completion path. New files inside the folder generate `v1`.

Folder creation during upload follows same-type uniqueness: same-name folders are reused, while same-name files do not block creating or reusing a folder path.

### Restore

Restore creates a new version from a selected historical version:

1. Validate the user owns the file and the version.
2. Reject deleted versions.
3. Reject deleted target files.
4. Copy the selected version object to a new durable version key.
5. Create a new `DriveFileVersion` with `source=restore` and `restoredFromVersionId`.
6. Point `DriveItem` at the new version.
7. Charge quota for the new version.

Restore never mutates the selected historical version into the current version. The previous current version remains in history.

If the object copy succeeds but the database update fails, the copied object should be deleted immediately. If immediate deletion fails, record a cleanup marker.

### Online Editing Reservation

Online editing is out of scope for this stage, but future saves should use the same file change service. Version records reserve optional metadata such as `source=online_edit`, `editorSessionId`, or `changeSummary` if implementation later needs it.

## Automatic Cleanup

Default retention:

- Maximum 100 undeleted versions per file.
- Unpinned non-current versions older than 180 days are eligible for cleanup.
- Pinned versions are not automatically deleted.
- The current version is never automatically deleted.

Cleanup ordering:

1. Exclude current, pinned, and already deleted versions.
2. Prefer oldest eligible versions.
3. Delete enough versions to satisfy count and age limits.
4. Release quota for successfully deleted versions.
5. Mark failed object deletions for retry.

Trigger points:

- Run a light cleanup for the file after a new version is created.
- Run a background maintenance task to handle old eligible versions and retry `deletePending` cleanup.

Cleanup must not change folder structure, share settings, current file identity, or current share behavior.

## User Experience

Drive file rows add a `历史版本` action in the existing more-actions menu.

The single-file reader header also exposes `历史版本`, because users often discover a problem while viewing a file.

Use a drawer or dialog for version history rather than a new full page. The list should be paginated and ordered by newest version first.

Each row shows only operational metadata:

- version number
- current marker
- source
- size
- created time
- creator when available
- pinned state

Actions:

- download
- restore
- delete
- pin or unpin

Interaction rules:

- Restore requires confirmation.
- Delete requires confirmation.
- Deleting a pinned version requires a stronger confirmation.
- Current version deletion is disabled or rejected.
- Empty and error states should use short operational copy.
- Do not add explanatory marketing copy, custom colors, gradients, nested cards, or a parallel component style.

## API Design

Owner-only endpoints:

```text
GET    /api/drive/items/:itemId/versions
GET    /api/drive/items/:itemId/versions/:versionId/download
POST   /api/drive/items/:itemId/versions/:versionId/restore
PATCH  /api/drive/items/:itemId/versions/:versionId
DELETE /api/drive/items/:itemId/versions/:versionId
```

`PATCH` should initially support only `isPinned`.

Version list DTO:

```ts
type DriveFileVersionDto = {
  id: string
  itemId: string
  versionNumber: number
  size: string
  mimeType: string | null
  source: "upload" | "online_edit" | "restore"
  isCurrent: boolean
  isPinned: boolean
  deletePending: boolean
  restoredFromVersionId: string | null
  createdAt: string
  createdBy: string | null
}
```

Version list should support pagination. Normal Drive item listing should not load version rows. If needed, it may expose lightweight `versionCount` or `hasVersions` later.

## MCP And Built-In Skill Updates

Drive MCP should expose version management through explicit tools:

- `drive_file_version_list`
- `drive_file_version_download_create`
- `drive_file_version_restore`
- `drive_file_version_delete`
- `drive_file_version_pin_update`

Safety:

- Restore and delete require clear user intent.
- Batch organization flows must not silently delete historical versions.
- MCP responses must not include storage keys, signed URLs, Authorization headers, COS credentials, or raw internal cleanup diagnostics.
- Download tools may write selected historical versions to the local filesystem and should follow existing file write permission rules.

The built-in `synapse-drive-mcp` skill and capability registry must be updated alongside the API and MCP tool surface.

## Access And Sharing Rules

Historical versions are owner-only.

Existing share links always resolve to the current version of the shared file or folder. They do not expose version history, historical downloads, or restore actions.

Folder zip downloads include only current versions of files. Historical versions are excluded.

Admin Drive views may later inspect version storage usage, but first implementation should focus on owner management unless explicitly scoped otherwise.

## Error Handling

- Missing item or version returns the same owner-facing not found behavior as other Drive owner APIs.
- Attempting to delete the current version returns a validation error.
- Attempting to restore a deleted version returns a validation error.
- Quota shortage during upload, edit save, or restore returns the existing Drive quota error pattern.
- Object copy, head, or delete failures must be recorded without leaking storage keys or signed URLs to UI or MCP.
- Cleanup failures must not roll back a completed current-version switch.

## Migration

Active files created before this feature may not have version rows.

Acceptable migration strategy:

1. Add the version table.
2. Backfill one current `DriveFileVersion` row for every active file with a non-null `storageKey`.
3. Use each file's current `storageKey`, `size`, `mimeType`, and `updatedAt`.
4. Set `versionNumber=1`, `source=upload`, and `isPinned=false`.
5. Do not copy existing objects during migration unless key normalization is required.

If a full backfill is too expensive for deployment, the service must lazily create the missing current-version row before the first overwrite or restore for that file.

## Testing

Server tests:

- New file upload creates `v1` and points `DriveItem.storageKey` at `v1`.
- Same-name overwrite creates `v2`, keeps the old version downloadable, preserves item id and share id, and points current reads at `v2`.
- Folder upload overwrite generates versions for overwritten child files.
- Restore `v1` creates `v3`, records `restoredFromVersionId`, and points current reads at `v3`.
- Restore fails when quota is insufficient.
- Delete non-current version releases quota.
- Delete current version is rejected.
- Pinned versions are skipped by automatic cleanup.
- Cleanup over 100 versions deletes only eligible non-current, non-pinned versions.
- Cleanup over 180 days deletes only eligible non-current, non-pinned versions.
- Concurrent overwrite completions produce unique increasing version numbers and last completed current pointer.
- Object copy/delete failures leave retry state without corrupting the current file.
- Share preview, share download, owner preview, owner download, and folder zip use only current versions.

Renderer tests:

- File row more-actions includes `历史版本`.
- Single-file reader exposes `历史版本`.
- Version dialog/drawer lists current and historical versions newest first.
- Restore and delete require confirmation.
- Current version delete action is disabled or rejected.
- Pin/unpin updates the row without changing current file content.
- UI uses existing shadcn/Radix components and Tailwind tokens.

MCP and capability tests:

- New Drive version tools are registered with stable capability ids.
- Restore and delete are marked mutating.
- Version download writes to local path and does not expose signed URLs.
- Built-in Drive MCP skill documents version tools and safety rules.

## Acceptance Criteria

- Users can browse a Drive file's history.
- Upload overwrite and future file-change paths generate versions automatically.
- Users can download, restore, pin, unpin, and delete historical versions.
- Restore creates a new current version and never destroys the selected historical version.
- Historical versions count toward quota, and deleting them releases quota.
- Automatic cleanup prevents unbounded per-file history growth while preserving current and pinned versions.
- Public shares and folder zip behavior continue to expose only current file content.
- The implementation reserves a clean online-edit save path without implementing online editing now.
