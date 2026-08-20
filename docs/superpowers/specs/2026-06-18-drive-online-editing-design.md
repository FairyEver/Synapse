# Drive Online Editing Design

Date: 2026-06-18
Scope: `server/`, `dashboard/`, `desktop/`, `shared/`, `docs/`

## Goal

Add online editing as a Drive file capability. The first implementation uses the existing code renderer to edit text-like files, but the product and service model must treat editing as a common file capability that future renderers can consume.

Editing is not Markdown-specific. Markdown, plain text, JSON, CSV, code files, images, Office files, and other formats all remain Drive files with the same ownership, sharing, versioning, quota, and audit model. Individual renderers decide whether they can edit the current file.

## Product Decisions

- File editing is a shared Drive capability, not a Markdown feature.
- The file browser provides every renderer with edit context and save methods.
- Renderers decide whether to expose editing UI based on the shared context.
- The first editable renderer is the existing Monaco-based code renderer.
- The first editable file set is text-like files whose full content is available in preview.
- Text renderers do not impose a smaller file-size limit than Drive itself.
- Truncated previews are read-only to prevent saving partial content over the full file.
- Saving is explicit. There is no real-time collaborative editing and no auto-save version creation in the first version.
- Every successful save creates a new file version with `source=online_edit`.
- Version `createdBy` records the logged-in editor. The file owner remains the Drive item owner.
- Versions and saved bytes count toward the owner's Drive quota.
- Saving edited content does not rename the file.
- Text editing preserves the file's existing MIME type in the first version.
- Changing share permission mode updates the existing share link and does not create a new `shareId`.

## Architecture Posture

This feature should not be implemented as patches scattered across the current Drive code. Drive has little existing user dependency, so structural changes are allowed when they keep the product model cleaner.

Allowed adjustments:

- Add new tables for share access rules, specified editors, edit sessions, or save attempts when they make ownership and permission clearer.
- Add a dedicated Drive editing service/module rather than embedding save logic in upload, share, browser, or renderer code.
- Refactor existing Drive share creation and browser snapshot code if the current shape would make editable share behavior awkward.
- Replace ad hoc UI branches with a clearer share settings form and renderer capability contract.
- Extract common permission, ancestry, version, and text-edit helpers instead of duplicating checks across owner and share endpoints.
- Adjust the Drive file browser UI to fit editing as a first-class capability, as long as file management and file reading boundaries stay clear.

Implementation should optimize for a clean long-term Drive architecture, not the smallest diff.

## Product Model

Drive has four separate concepts that should not be collapsed in UI or code:

- **Owner**: the user whose Drive contains the file. The owner can manage the file, share settings, and versions.
- **Reader**: a person who can open the link and read or download content according to password and expiry settings.
- **Editor**: a logged-in user who can save content changes through an editable renderer.
- **Renderer**: the UI implementation that displays a file and may optionally consume edit capability.

Editing changes file content only. It does not imply permission to rename, move, delete, upload, change share settings, view owner-only version history, or manage folder structure.

## Share Editing Options

The share dialog uses a single permission selector with these options:

| Option | Label | Default | Read access | Edit access |
| --- | --- | --- | --- | --- |
| `link_read` | 获取链接的人可阅读 | Yes | Anyone with the valid share link and required password can read. | Owner only. |
| `link_edit` | 获取链接的人可编辑 | No | Anyone with the valid share link and required password can read. | Any logged-in user with the valid share link and required password can edit supported files. |
| `specified_users_edit` | 指定用户可编辑 | No | Anyone with the valid share link and required password can read. | Only logged-in users whose email is listed on the share can edit supported files. |

`specified_users_edit` requires an email list field in the share dialog. The user can enter multiple target user emails. The first version only needs email input and validation; it does not need a user picker, invitation workflow, role management UI, or team selector.

If an entered email does not belong to a registered user, the share can still be saved. Editing becomes available after a user logs in with that email. This avoids making share creation depend on account lookup timing and allows owners to prepare links before recipients sign up.

`specified_users_edit` requires at least one valid email. An empty editor list is treated as an invalid configuration, not as a valid "nobody can edit" state.

If the owner enters their own email in the specified editor list, keep it like any other valid email. Owner edit rights still come from ownership, not the email list.

### Share Dialog Behavior

The share dialog keeps existing access protection controls and adds the permission selector:

- Permission selector:
  - `获取链接的人可阅读`
  - `获取链接的人可编辑`
  - `指定用户可编辑`
- Existing controls:
  - `需要密码`
  - `有效时长`
- Conditional field:
  - `可编辑用户` appears only for `指定用户可编辑`.
  - It accepts multiple emails.
  - It validates email format before saving.
  - It de-duplicates normalized emails.

If the owner switches away from `指定用户可编辑`, the saved editor list should be cleared or ignored. The UI should not show inactive editor emails in the result dialog or public links list.

The share result dialog continues to focus on link and password actions. It may show the selected permission mode as short metadata, but should not add explanatory copy.

Changing permission mode, password, expiry, or specified editor emails updates the same share record. The copied link remains stable unless the owner disables the share and creates a separate new share through existing share lifecycle behavior.

## Share Permission Semantics

The permission selector controls edit rights only. It does not replace existing password, expiry, enablement, or link-read behavior.

- `link_read` is the default and preserves current sharing behavior.
- `link_edit` requires login for saving, even if the user can read anonymously.
- `specified_users_edit` requires login and email match for saving.
- Password and expiry still apply before reading or editing.
- Disabled shares cannot be read or edited.
- Share edit permission applies only inside the shared root item subtree.
- Folder shares can grant edit rights to files inside the shared folder tree, but the first version should only support editing existing files. Creating, deleting, renaming, moving, and uploading through an editable share are out of scope.

## User Behavior Boundaries

### Owner

The owner can:

- Open and edit supported files from their own Drive.
- Create shares in any of the three permission modes.
- Change a share from one permission mode to another.
- Add, remove, or replace specified editor emails.
- View version history and see versions created by link editors.
- Restore, pin, delete, and download historical versions according to existing version rules.

The owner always keeps edit rights, even when the active share is `link_read` or lists different editor emails.

The owner is not notified in the first version when a share editor saves. The edit is visible through version history and audit records.

### Anonymous Link Visitor

An anonymous visitor can:

- Open a valid link when password and expiry allow it.
- Read and download content according to existing share behavior.

An anonymous visitor cannot:

- Save changes.
- See edit controls.
- View version history.
- Discover the editor email list.

When an anonymous visitor opens an editable share, the UI can show a concise `登录后编辑` action only if the app already has a normal login path for that surface. If no login route is available in that context, the file remains read-only.

### Logged-In Link Visitor

A logged-in visitor can read any valid share they can open.

For editing:

- `link_read`: no edit rights.
- `link_edit`: can edit supported files.
- `specified_users_edit`: can edit only when their normalized account email matches the share editor list.

A logged-in visitor who lacks edit rights should see the file in read-only mode. The UI should not show disabled editing controls merely to explain permissions.

### Specified Editor

A specified editor can:

- Edit supported existing files under the shared root.
- Save explicit changes as new versions owned by the file owner.

A specified editor cannot:

- Change the share permission mode.
- See or manage the specified editor list.
- Delete, rename, move, upload, or create files through the share.
- Restore or delete historical versions.
- Rename the file or change its MIME type through text save.

### Unsupported Or Unsafe File States

Editing is unavailable when:

- The current item is a folder.
- The file type has no editable renderer.
- The text preview is truncated.
- The file is deleted, pending upload, failed, or not active.
- The share is expired, disabled, missing, or password access fails.
- Owner quota cannot accept a new saved version.
- The renderer loaded an old `baseVersionId` and the file has changed.

The reader still behaves normally when read access is valid.

## User Reachability Checklist

Every product capability in this feature must be reachable from a normal user workflow. A backend rule, DTO field, or service method is not complete unless there is a clear UI path, visible state, and recovery behavior.

### Owner Creates Editable Share

Entry points:

- Drive file/folder row `分享`.
- Public links center edit/settings action for an existing share.

Required reachable actions:

- Select `获取链接的人可阅读`.
- Select `获取链接的人可编辑`.
- Select `指定用户可编辑`.
- Add multiple editor emails.
- Remove an editor email before saving.
- Save share settings.
- Copy the resulting link.
- Copy password when enabled.

Required visible states:

- Default mode is visibly `获取链接的人可阅读`.
- `可编辑用户` appears only when `指定用户可编辑` is selected.
- Empty specified-editor list blocks save with a short error.
- Invalid email blocks save with a short error.
- Duplicate email is handled without confusing duplicate chips or rows.
- Existing share settings reopen with the saved permission mode and email list.

### Owner Manages Existing Shares

Entry points:

- Public links center.
- Shared-state entry from the Drive item row if the item is already shared.

Required reachable actions:

- See whether a share is read-only, link-editable, or specified-user-editable.
- Open share settings.
- Change permission mode without changing the link.
- Add or remove specified editor emails.
- Disable the share.

Required visible states:

- Public links list shows permission summary such as `可阅读`, `链接可编辑`, or `3 人可编辑`.
- Full editor emails are visible only inside owner share settings.
- Disabled or expired shares are not presented as editable.

### Owner Edits Own File

Entry points:

- Open a supported file from Drive.
- Switch to the code renderer when the default renderer is a preview renderer such as Markdown.

Required reachable actions:

- Edit text in Monaco.
- Save.
- Reload current cloud version.
- Download local unsaved version when a save failure may lose work.
- Open version history after saving.

Required visible states:

- Editable text files show a compact toolbar.
- Dirty state is visible.
- Save progress is visible.
- Save success returns to a clean state.
- Unsupported files remain read-only without misleading edit controls.
- Truncated text files clearly cannot be edited.

### Anonymous Visitor Opens Editable Link

Entry points:

- Shared link URL.
- Password form when required.

Required reachable actions:

- Read/download when access conditions allow it.
- Use `登录后编辑` when the share mode supports editing.

Required visible states:

- Anonymous users do not see the editor toolbar.
- The page does not expose specified editor emails.
- If login return is supported, the user returns to the same shared file after login.

### Logged-In Link Editor Edits Shared File

Entry points:

- Shared link after login.
- `登录后编辑` return flow.

Required reachable actions:

- Open supported shared file.
- Switch to the code renderer if needed.
- Edit text.
- Save.
- Download local unsaved version on conflict or permission failure.

Required visible states:

- Authorized editors see the same compact editing affordance as owner edit, scoped to content only.
- Unlisted users see a normal read-only page.
- Share editors do not see share management, file management, or version management actions.
- Save failures preserve local content.

### Conflict And Failure Recovery

Entry points:

- Save conflict.
- Permission loss.
- Login loss.
- Quota failure.
- Network failure.

Required reachable actions:

- Download local edited version.
- Cancel and keep editing locally.
- Reload cloud version after confirmation.
- Re-authenticate when login or password state is missing and the route supports it.

Required visible states:

- Dialog tells the user there is a newer cloud version.
- Dialog tells the user their local edits are still kept.
- Reload is clearly destructive for local edits.
- No failure path silently clears the Monaco content.

### Reachability Acceptance Rule

Implementation is incomplete if any of these are true:

- A permission mode exists in API but cannot be selected in the share UI.
- A saved setting cannot be viewed or changed later.
- A save error can discard local edits without a download path.
- A user must guess they need to switch renderer to edit, without an obvious route from the file reader.
- Share editors can technically save through API but have no visible edit entry point.
- Owner can see versions but cannot identify an online edit as coming from an editor.
- UI shows an action that always fails because the corresponding permission, login, password, quota, or file-type requirement is not reachable.
- Owner can change share permission mode but cannot later see which mode is active.

## Permission And Failure Boundaries

The browser snapshot is only a UI hint. Every save must re-check write permission on the server at save time. A stale page, cached snapshot, manually edited request, or old tab must never be enough to write Drive content.

### Permission Changes While Editing

If the owner changes share permissions while another user is editing:

- `link_edit` -> `link_read`: the editor can keep typing locally, but save returns `403`.
- `specified_users_edit` removes the actor email: save returns `403`.
- Share password changes: the existing password cookie becomes insufficient, and save requires re-authentication through the share access flow.
- Share expires or is disabled: save returns `404` or the same not-found shape used by share access.
- Share is deleted or source item is deleted: save fails and keeps local editor content.

The renderer should preserve unsaved content on these failures and offer local download when the user may lose work.

### Item Changes While Editing

If the file changes after the editor opens:

- Content changed: save returns `409` based on `baseVersionId`.
- File moved within the same shared root: save can still succeed if the item remains inside the shared subtree and permission still holds.
- File moved outside the shared root: share save returns `403` or `404`.
- File renamed: save can still succeed, but the latest name should be used after refresh.
- File deleted, upload-pending, failed, or storage-missing: save fails and keeps local editor content.
- Owner restores an older version while editor is open: the restore becomes the current version, so save returns `409`.

### Identity Changes While Editing

If the browser session changes user identity while the editor is open:

- Logged out: save returns `401`.
- Logged in as another account: save is evaluated against the new account only.
- Account email changed: `specified_users_edit` checks the current normalized account email at save time.
- Owner account always resolves by `actorUserId === item.userId`, not by email list.

Do not trust an email passed from the renderer. The server must read the authenticated user's account email.

### Local Work Preservation

Any failed save that might leave the user with unsaved edits should keep the Monaco content in memory. The UI should offer local download for:

- `409` conflict.
- `401` login loss.
- `403` permission loss.
- `404` share or item no longer available.
- quota failure.
- network failure.

Only `重新加载` should discard local editor content, and dirty reload needs confirmation.

Quota failure copy:

- Owner save may show normal Drive quota guidance.
- Share editor save should show only `云盘空间不足` and must not expose the owner's quota size, usage, billing state, or account details.

### Anti-Bypass Rules

- `canEdit` in `DriveBrowserSnapshotDto` is never authorization.
- Save endpoints must not accept `ownerUserId`, `createdBy`, `accessMode`, `editorEmails`, `storageKey`, `versionNumber`, or quota fields from the request body.
- Share save must verify share validity, password/cookie validity, access mode, actor identity, and subtree membership in one server-side path.
- Owner save must verify ownership in the same service path, not through a separate weaker implementation.
- `specified_users_edit` compares normalized stored emails to the authenticated account email only.
- Folder share subtree checks must use Drive item ancestry, not path strings or browser breadcrumbs.
- Public read/render/download endpoints must not expose write-only metadata such as editor email lists.
- Historical versions are not reachable through share URLs, even when the share is editable.
- Local text download in the conflict dialog downloads the renderer's in-memory text only; it must not call a privileged Drive download endpoint.
- A non-owner editing a single-file Markdown share cannot add a Drive-relative image target that the current version did not already authorize. A folder-share editor can add one only when it resolves inside the shared root subtree. This check runs before version creation; external image URLs remain allowed.
- Markdown relative-image read access is derived from the current file version and Drive tree. It does not expand normal file-share browsing, annotation, ZIP, rename, move, upload, or history permissions.

## Data Model

`DriveShare` should store an access mode:

```prisma
accessMode String @default("link_read") @db.VarChar(32)
```

Allowed values:

- `link_read`
- `link_edit`
- `specified_users_edit`

Specific editor emails should be stored separately so they can be normalized, indexed, audited, and updated without parsing JSON:

```prisma
model DriveShareEditor {
  id        String     @id @default(cuid())
  shareId   String
  share     DriveShare @relation(fields: [shareId], references: [id], onDelete: Cascade)
  email     String     @db.VarChar(255)
  createdAt DateTime   @default(now())

  @@unique([shareId, email])
  @@index([email])
}
```

Emails are normalized by trimming and lowercasing. Invalid email strings are rejected by API validation before storage. Duplicate emails collapse into one entry.

The API and DTOs should expose the mode and email list as:

```ts
type DriveShareAccessMode = "link_read" | "link_edit" | "specified_users_edit"

type DriveShareAccessInput = {
  readonly passwordEnabled: boolean
  readonly expiresIn: DriveAccessExpiresIn
  readonly accessMode: DriveShareAccessMode
  readonly editorEmails?: readonly string[]
}
```

When `accessMode !== "specified_users_edit"`, `editorEmails` is ignored or stored as an empty list.

`DriveShareDto` and `DriveShareListItemDto` should include:

```ts
readonly accessMode: DriveShareAccessMode
readonly editorEmails: readonly string[]
```

The public share snapshot should not expose `editorEmails`.

## Browser To Renderer Contract

The file browser should pass every renderer the same context. Renderers must not reconstruct permissions from route shape or share URLs.

```ts
type DriveRendererContext = {
  readonly current: DriveBrowserItemDto
  readonly preview: DriveBrowserPreviewDto | null
  readonly access: {
    readonly context: "owner" | "share"
    readonly canDownload: boolean
    readonly canEdit: boolean
  }
  readonly edit: {
    readonly editable: boolean
    readonly editorKind: "text" | "replace" | "none"
    readonly currentVersionId: string | null
    readonly saving: boolean
    readonly saveText: (input: {
      readonly text: string
      readonly baseVersionId: string
    }) => Promise<void>
    readonly reload: () => void
  }
}
```

The browser is the capability provider. The renderer is the capability consumer.

`DriveBrowserSnapshotDto` should include enough data to build this context:

```ts
edit: {
  readonly canEdit: boolean
  readonly editorKind: "text" | "replace" | "none"
  readonly currentVersionId: string | null
  readonly reason?: "unsupported" | "truncated" | "login_required" | "permission_denied" | "quota" | null
} | null
```

`reason` is for renderer decisions only. Keep user-facing copy short and local to the renderer.

## Code Renderer Behavior

The code renderer uses Monaco as the first text editor.

- Read-only files keep the current read-only Monaco behavior.
- Editable text files make Monaco editable and show a compact toolbar.
- Toolbar actions: `保存`, `重新加载`.
- `保存` is enabled only when the content is dirty and not saving.
- `重新加载` discards local edits after confirmation when dirty.
- Save success refreshes the browser snapshot and resets dirty state.
- Save failure keeps local edits in the editor.
- `409 Conflict` means the file changed after the editor loaded. The renderer should keep local edits and open a conflict dialog.
- Truncated content disables editing and shows a short read-only state.
- Unsupported files or permission-denied files remain visually identical to normal read-only code preview.

Do not add Markdown-specific editing controls in this stage. Markdown can still use rendered preview for reading and code renderer for editing source text.

### Save Conflict Dialog

When save returns `409`, the dialog should make two facts clear:

- The cloud file already has a newer version.
- The user's current unsaved edits are still kept locally in the editor.

Dialog actions:

- `下载本地版本`: downloads the editor's current text content to the user's local machine.
- `重新加载`: reloads the latest cloud version and discards local edits after confirmation.
- `取消`: closes the dialog and keeps the editor unchanged.

The first version does not need diff merge or forced overwrite. Downloading the local version is the escape hatch that lets users preserve their work before reloading.

Suggested local filename:

```text
<original-name>.local-edit.<YYYYMMDD-HHmmss>.<extension>
```

If the original name already has an extension, place `.local-edit.<timestamp>` before the extension.

## Save API

Owner edit:

```text
PUT /api/drive/items/:itemId/content
```

Share edit:

```text
PUT /api/drive/browser/shares/:shareId/items/:itemId/content
```

For a share whose root is a file, `itemId` may be omitted by a root save endpoint if route ergonomics need it:

```text
PUT /api/drive/browser/shares/:shareId/content
```

Request:

```ts
type DriveFileTextUpdateInput = {
  readonly contentType: "text"
  readonly text: string
  readonly baseVersionId: string
}
```

Response:

```ts
type DriveFileContentUpdateResult = {
  readonly item: DriveItemDto
  readonly version: DriveFileVersionDto
}
```

Errors:

- `401`: save requires login.
- `403`: logged-in user lacks edit rights.
- `404`: share or item is not available.
- `409`: base version is stale.
- `413`: submitted text exceeds the Drive single-file limit.
- `422`: file type or current preview state is not editable.

The `409` response should not include the user's submitted text. The renderer already has the local text and is responsible for offering the local download.

## Save Service

All content updates should converge on one service operation:

```ts
commitDriveFileChange(input)
```

Responsibilities:

1. Resolve write access for owner or editable share.
2. Verify the target is an active file.
3. Verify `baseVersionId` matches the current version.
4. Verify content type, size, and text edit eligibility.
5. Write the new object to durable version storage.
6. Create `DriveFileVersion` with `source=online_edit`.
7. Update `DriveItem.storageKey`, `size`, and `updatedAt` while preserving the existing `mimeType`.
8. Charge owner quota.
9. Record audit with owner, actor, item, share when applicable, and version id.
10. Trigger file-version cleanup.

The service must not accept storage keys, object keys, version numbers, owner ids, or quota deltas from renderer input.

For first-version text saves, the service must preserve the existing file name and existing MIME type. Future renderers that need to change MIME type must introduce an explicit renderer-specific design instead of reusing plain text save as a metadata update path.

## Write Access Resolution

Use a common resolver for all edit saves:

```ts
resolveDriveWriteAccess(input)
```

It returns:

```ts
{
  readonly ownerUserId: string
  readonly actorUserId: string
  readonly item: DriveItem
  readonly accessKind: "owner" | "editable_share"
  readonly shareId?: string
}
```

Rules:

- Owner edit requires the actor to own the file.
- Share edit requires a logged-in actor.
- Share edit requires a valid share, password access when configured, and non-expired state.
- `link_edit` allows any logged-in actor with access to the link.
- `specified_users_edit` allows only actors whose normalized account email is in `DriveShareEditor`.
- Share edit must verify the target item belongs to the shared root subtree.
- Reading may remain anonymous; saving never does.

## Architecture Changes

These changes should be treated as a small Drive editing subsystem, not as one-off code added to existing handlers.

### Shared Types

Update `shared/src/drive.ts`:

- Add `DriveShareAccessMode`.
- Extend share creation input with `accessMode` and `editorEmails`.
- Extend share DTOs with owner-visible `accessMode` and `editorEmails`.
- Extend `DriveBrowserSnapshotDto` with edit capability metadata.
- Add request and response types for text content update.

### Server Data And Migration

Add a migration that:

- Adds `DriveShare.accessMode` with default `link_read`.
- Creates `DriveShareEditor`.
- Backfills all existing enabled and disabled shares as `link_read`.
- Keeps current password and expiry data untouched.

The migration must not change existing share URLs or disable existing shares.

### Server Services

Add or modify service responsibilities:

- Introduce a Drive editing service or clearly separated service layer for content update flows.
- Share creation/update validates `accessMode` and normalized email list.
- Share listing returns owner-visible permission metadata.
- Public share browser snapshot computes `canEdit` without exposing specified emails.
- Owner browser snapshot computes owner edit capability.
- `resolveDriveWriteAccess()` centralizes owner and share edit checks.
- `commitDriveFileChange()` centralizes version creation, item pointer update, quota charge, audit, and cleanup.
- Existing upload overwrite and restore flows should remain compatible with the version service; do not fork separate version logic for online edit.
- Save-time validation always reads fresh share, item, user, and current-version state from the database.
- Stale `baseVersionId`, revoked permission, deleted items, expired shares, and moved-out-of-subtree items must fail before writing a new storage object.

Preferred module boundaries:

- `drive-share-access`: share permission mode, password/expiry compatibility, specified editor checks.
- `drive-write-access`: owner/share write authorization and subtree validation.
- `drive-file-change`: common content-change commit path, version creation, quota, audit, cleanup.
- `drive-editable-preview`: file type and preview-size rules used to decide whether a renderer may edit.

The exact filenames can follow repository conventions, but these responsibilities should not be interleaved inside controller methods or renderer components.

### Server Controllers

Add owner save endpoint and share save endpoint. The share save endpoint must use user authentication in addition to share password and expiry checks.

The public read endpoints can remain anonymous. Do not make the whole share browser require login just because the share is editable.

### Dashboard UI

The UI may be redesigned around the new capability instead of patching the current dialog. The goal is a coherent Drive sharing and editing experience, not a minimal control inserted into the old form.

Update share dialog:

- Add the permission selector.
- Show multi-email input only for `指定用户可编辑`.
- Keep password and expiry controls unchanged.
- Keep default selection at `获取链接的人可阅读`.
- Use existing shadcn/Radix controls and Tailwind tokens; no custom color system, decorative gradients, nested cards, or explanatory filler copy.
- Keep the permission selector visually primary enough that users understand they are choosing the share's collaboration behavior.

Update public links center:

- Show permission mode in the list or detail area with short labels.
- Allow opening the share settings dialog to change mode and editor emails if that edit surface already exists.

Update file browser:

- Build renderer context from snapshot edit metadata.
- Pass the same context to all renderers.
- Refresh snapshot after save.

Update code renderer:

- Add toolbar and dirty-state handling.
- Enable Monaco editing only for editable text context.
- Preserve local edits after save failures and conflicts.
- On `409`, show the save conflict dialog with local-version download, reload, and cancel actions.
- On permission, login, quota, not-found, and network failures, keep local edits and expose local download before any reload or navigation discards them.

### UI Design Review Gate

Before final implementation, run the `impeccable` workflow against the Drive sharing and file browser surfaces. Use it to review:

- Share dialog information architecture.
- Permission selector clarity.
- Multi-email input behavior.
- Public links list density and privacy.
- Code renderer toolbar placement.
- Conflict dialog actions and copy.
- Empty, loading, disabled, permission-denied, and dirty states.

The review should explicitly check that the UI does not look like a patched old form and that editing reads as a first-class Drive capability. Any UI changes must still follow Synapse's existing shadcn/Radix and Tailwind-token discipline.

The implementation review must also walk through the User Reachability Checklist above. Passing API tests is not enough if a user cannot discover, operate, recover from, or later revise the feature from the UI.

### Desktop And MCP Surface

If Drive share creation is exposed through desktop bridge or MCP tools, update the capability schema, built-in Drive skill guidance, and API descriptions to include:

- `accessMode`
- `editorEmails`

Do not expose a Drive content update MCP tool in the first UI-focused version unless explicitly requested. If it is added later, it must use the same `commitDriveFileChange()` service and mutating-tool permission/audit patterns.

### Audit And Observability

Audit records should distinguish:

- owner edit
- link editor edit
- specified editor edit
- share permission change
- specified editor email list change

Audit details may include normalized editor emails for owner/admin audit surfaces, but public share responses and renderer context must not expose the list to non-owners.

### Query And Cache Behavior

After save:

- Invalidate the current browser snapshot.
- Invalidate file version list for the item.
- Invalidate Drive item list entries that show size, updated time, or shared metadata.
- Keep the current renderer selected where possible.

After share permission change:

- Invalidate share list.
- Invalidate active share browser snapshots for that share.

## Implementation Plan

Implement in phases that each leave the product in a coherent state. Do not ship a phase where API behavior exists but the user cannot discover or operate it.

### Phase 1: Share Access Foundation

Scope:

- Add `DriveShare.accessMode`.
- Add `DriveShareEditor`.
- Update share DTOs and validation.
- Update share create/update/list services.
- Preserve existing share links and password/expiry behavior.

Acceptance:

- Existing shares continue to behave as `获取链接的人可阅读`.
- Owner can create each of the three share modes.
- Owner can reopen share settings and see the saved mode.
- `指定用户可编辑` cannot save with an empty editor list.
- Public share responses do not expose specified editor emails.

This phase is not complete if `accessMode` exists only in the database or API but is not visible and editable in the owner UI.

### Phase 2: Write Access And File Change Foundation

Scope:

- Add `resolveDriveWriteAccess()`.
- Add `commitDriveFileChange()`.
- Add text-save request/response types.
- Add owner and share save endpoints.
- Reuse existing version history storage strategy.

Acceptance:

- Owner text save creates an `online_edit` version.
- Authorized share text save creates an `online_edit` version under the owner file.
- Save-time checks re-read current share, user, item, ancestry, and version state.
- Text save preserves file name and MIME type.
- Stale base version returns `409`.
- Permission, login, expiry, password, subtree, deletion, and quota failures happen before writing a durable new version object.

This phase is not complete if owner save and share save use separate business logic for version creation or authorization.

### Phase 3: Browser Capability Contract And Code Renderer

Scope:

- Add edit capability metadata to browser snapshots.
- Build a shared renderer context.
- Update renderer shell to pass the context to every renderer.
- Update code renderer to consume text edit capability.
- Add toolbar, dirty state, save, reload, and local download behavior.

Acceptance:

- Text-like supported files are editable in the code renderer.
- Unsupported, truncated, permission-denied, and anonymous states are read-only.
- Markdown can still render as preview, and source editing is reachable through the code renderer.
- Save success refreshes snapshot and version state.
- Save failure preserves Monaco content.
- Conflict dialog supports local version download, reload, and cancel.

This phase is not complete if users can save through a hidden API but cannot find the editing path in the file reader.

### Phase 4: End-To-End UX And Review

Scope:

- Public links center permission summary.
- Existing-share settings updates.
- Login-return path for `登录后编辑` where supported.
- Version history source/creator visibility for owner.
- Impeccable UI review and reachability walkthrough.

Acceptance:

- Owner can create, inspect, modify, and disable editable shares.
- Anonymous visitor can understand that editable links require login.
- Authorized editor can edit and recover local work on failures.
- Unauthorized visitor gets a normal read-only experience.
- Owner can identify online edits in version history.
- The User Reachability Checklist passes.

This phase is not complete if any supported product behavior requires a user to guess an unlabelled route, hidden renderer switch, or undocumented recovery path.

## Release And Migration Notes

- No existing share URL should change.
- Existing shares migrate to `link_read`.
- Password and expiry behavior must remain compatible.
- The first release should mention that Drive can create editable links and edit text files through the code view.
- Release notes should not mention internal table names, service names, or storage keys.
- If implementation touches Drive MCP or built-in Drive skill guidance, update those descriptions in the same change set.

## Non-Goals

- No real-time collaboration.
- No auto-save.
- No text diff or merge UI.
- No Markdown-specific editor in this stage.
- No anonymous editing.
- No share-based create, delete, rename, move, upload, or folder reorganization.
- No invitation emails or recipient account provisioning.
- No owner notification on share-editor save in the first version.
- No team role selector.
- No public exposure of historical versions through share links.
- No share-recipient management beyond owner-entered email strings in the first version.
- No filename or MIME type editing through the text save path.

## Testing

Focused coverage should include:

- Share creation defaults to `link_read`.
- Existing shares migrate to `link_read`.
- `link_edit` permits logged-in link visitors to save supported files.
- `specified_users_edit` permits only listed email users to save.
- Email input normalizes and de-duplicates specified editors.
- `specified_users_edit` rejects an empty editor email list.
- Owner email in the specified editor list does not affect owner-priority edit rights.
- Changing share permission mode does not change the share URL.
- Unlisted users can read but cannot save.
- Anonymous users can read eligible links but cannot save.
- Revoked share edit permission blocks save from an already-open editor.
- Disabled, expired, or password-changed shares block save from an already-open editor.
- Password and expiry block saving when they block access.
- Share subtree checks prevent editing files outside the shared root.
- Moving a file out of the shared folder blocks save from the old share editor.
- Owner restore or another editor save causes stale `baseVersionId` conflict.
- Server ignores forged owner, editor email, access mode, storage key, and version fields in save requests.
- Text save creates a new `online_edit` version and updates current file metadata.
- Text save preserves file name and MIME type.
- Share-editor quota failure does not expose owner quota details.
- Save conflict returns `409` when `baseVersionId` is stale.
- Save conflict dialog preserves editor content and can download the local edited version.
- Permission-loss and login-loss failures preserve editor content and can download the local edited version.
- Truncated previews do not expose editable context.
- Code renderer receives edit context and only enables Monaco editing when `editable=true`.
- Public share snapshots do not expose specified editor email lists.
- Architectural tests or focused service tests prove owner edit and share edit use the same write-access and file-change path.
- UI tests cover the redesigned share dialog and code renderer toolbar rather than only field-level additions.
- Manual or automated UI acceptance covers each User Reachability Checklist path.
