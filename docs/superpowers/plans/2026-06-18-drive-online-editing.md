# Drive Online Editing Development Plan

Date: 2026-06-18
Spec: `docs/superpowers/specs/2026-06-18-drive-online-editing-design.md`
Scope: `server/`, `dashboard/`, `desktop/`, `shared/`, `docs/`

## Intent

Build Drive online editing as a first-class Drive capability, not as a set of patches on the existing share dialog or code renderer.

The implementation should preserve current Drive read/share behavior while adding:

- share permission modes: `获取链接的人可阅读`, `获取链接的人可编辑`, `指定用户可编辑`;
- specified editor emails;
- save-time write authorization;
- text content save through the code renderer;
- full version history integration with `source=online_edit`;
- local work preservation on conflicts and failures.

## Current Code Map

The existing Drive feature crosses these surfaces:

- Shared contracts: `shared/src/drive.ts`, `shared/src/drive.test.ts`.
- Server data model: `server/prisma/schema.prisma`, existing Drive migrations.
- Server Drive module:
  - `server/src/drive/drive.service.ts`
  - `server/src/drive/drive.controller.ts`
  - `server/src/drive/drive-browser.ts`
  - `server/src/drive/drive-version-history.ts`
  - `server/src/drive/drive-access-protection.ts`
  - `server/src/drive/drive.types.ts`
- Dashboard API client: `dashboard/src/lib/api.ts`, `dashboard/src/lib/api.test.ts`.
- Dashboard Drive browser:
  - `dashboard/src/features/drive-browser/use-drive-browser.ts`
  - `dashboard/src/features/drive-browser/drive-browser-page.tsx`
  - `dashboard/src/features/drive-browser/finder/drive-finder.tsx`
  - `dashboard/src/features/drive-browser/renderers/drive-renderer-shell.tsx`
  - `dashboard/src/features/drive-browser/renderers/code-renderer.tsx`
  - `dashboard/src/features/drive-browser/renderers/drive-renderer-registry.ts`
  - `dashboard/src/features/drive-browser/drive-file-versions-dialog.tsx`
- User Drive console: `dashboard/src/features/drive-browser/drive-console-page.tsx`.
- Admin Drive page: `dashboard/src/features/drive/index.tsx`, likely only needs compatibility unless admin share metadata is later expanded.
- Desktop account bridge and MCP capability path:
  - `desktop/electron/services/account-service.ts`
  - `desktop/electron/modules/account/ipc.ts`
  - `desktop/electron/capabilities/drive-dispatcher.ts`
  - `desktop/synapse-capabilities/shared/drive-domain.ts`
  - `desktop/resources/templates/skills/synapse-drive-mcp/content.md`

The browser/rendering side is already close to the target architecture: `DriveFinder` owns the selected renderer, and `DriveRendererShell` is the common renderer host. The plan should extend that host into the editing capability provider instead of adding one-off edit state inside a single renderer path.

## Architecture Shape

The Drive editing subsystem should be organized around four service responsibilities.

`drive-share-access`

- Owns `DriveShare.accessMode`.
- Owns specified editor email normalization and validation.
- Owns owner-visible share permission DTO projection.
- Keeps public share responses from exposing editor email lists.
- Preserves existing password and expiry semantics.

`drive-write-access`

- Resolves owner edit and editable share edit through one path.
- Reads fresh user, item, share, password/cookie, and ancestry state at save time.
- Treats browser snapshot `canEdit` as UI state only, never authorization.
- Verifies folder share subtree membership by Drive item ancestry, not by path strings or breadcrumbs.

`drive-file-change`

- Commits content changes into a new durable Drive version.
- Creates `DriveFileVersion` with `source=online_edit`.
- Updates current file pointer, size, and updated time.
- Preserves file name and MIME type for first-version text saves.
- Charges owner quota.
- Records audit and triggers version cleanup.

`drive-editable-preview`

- Decides whether the current file can be edited by a renderer.
- Uses file type, preview kind, text availability, truncation state, storage state, and current access.
- Exposes edit capability metadata to browser snapshots.

These can be separate files under `server/src/drive/` or names aligned with repository conventions. The important boundary is that controllers do not contain business authorization and renderers do not reconstruct permissions.

## Data And Shared Contracts

Data model additions:

- Add `DriveShare.accessMode String @default("link_read") @db.VarChar(32)`.
- Add `DriveShareEditor` with `shareId`, normalized `email`, unique `[shareId, email]`, and `email` index.
- Add relation fields on `DriveShare` if Prisma needs them for includes.
- Backfill all existing shares to `link_read`.
- Do not change existing `shareId` values, URLs, password state, expiry state, or enabled state.

Shared type changes:

- Add `DriveShareAccessMode = "link_read" | "link_edit" | "specified_users_edit"`.
- Extend `DriveAccessSettingsInput` or replace it with a broader share settings type that includes:
  - `passwordEnabled`
  - `expiresIn`
  - `accessMode`
  - `editorEmails`
- Extend `DriveShareDto` and `DriveShareListItemDto` with owner-visible:
  - `accessMode`
  - `editorEmails`
- Extend `DriveBrowserSnapshotDto` with:
  - `edit.canEdit`
  - `edit.editorKind`
  - `edit.currentVersionId`
  - `edit.maxInlineEditBytes`
  - `edit.reason`
- Add `DriveFileTextUpdateInput` and `DriveFileContentUpdateResult`.

Compatibility rules:

- Existing share creation calls without `accessMode` default to `link_read`.
- Existing desktop/MCP clients continue to create readable shares unless they explicitly pass the new fields.
- Public share browser snapshots never include `editorEmails`.

## Server Work

Drive share creation and listing should become share-settings aware.

- Update request validation in `server/src/drive/drive.controller.ts` to parse `accessMode` and `editorEmails`.
- Reject `specified_users_edit` with no valid emails.
- Normalize emails by trim and lowercase.
- De-duplicate emails before persistence.
- Keep owner email as a normal list entry if provided.
- Updating an existing active share updates the same share record and does not regenerate the link.

Drive service changes should avoid growing `drive.service.ts` into a larger all-purpose file.

- Move or extract share-settings logic into a dedicated helper/service file.
- Add write-access resolver that takes either owner item id or share id plus target item id.
- Add ancestry helper if current subtree checks are embedded in private service methods.
- Add file-change committer that accepts server-derived owner, actor, item, source object/text, and base version.
- Ensure object write/copy happens in an order that avoids durable orphan objects on failed authorization.
- Ensure failed database transactions clean up newly written objects or mark them for cleanup.

Save endpoints:

- Owner save: `PUT /api/drive/items/:itemId/content`.
- Share root file save: `PUT /api/drive/browser/shares/:shareId/content`.
- Share child save: `PUT /api/drive/browser/shares/:shareId/items/:itemId/content`.
- Share save endpoints require user auth and share access validation.
- Public read, render, and download endpoints remain anonymous when share settings allow.

Save-time behavior:

- `401` when login is required or lost.
- `403` when the logged-in user lacks edit rights.
- `404` for unavailable share or item states where current public behavior hides existence.
- `409` for stale `baseVersionId`.
- `413` for text over edit limit.
- `422` for unsupported file/current preview state.
- Quota failures for share editors use `云盘空间不足` without owner quota details.

Version behavior:

- Text save creates `DriveFileVersion.source=online_edit`.
- `createdBy` is the actor user id.
- Owner version history can show edits created by share editors.
- Share readers and share editors cannot access version history endpoints.

## Dashboard UI Work

The UI should be redesigned where needed, using existing shadcn/Radix components and Tailwind tokens. Do not add custom colors, CSS modules, gradients, nested cards, or explanatory filler copy.

Share settings surface:

- Replace the current access settings shape with a share settings form that treats permission mode as a primary choice.
- Required controls:
  - permission mode selector;
  - password requirement;
  - expiry duration;
  - multi-email editor input for `指定用户可编辑`.
- Default is `获取链接的人可阅读`.
- The multi-email input appears only in specified-editor mode.
- Save is blocked with `至少添加一个邮箱` when specified-editor mode has no emails.
- Invalid email gets short validation copy.
- Duplicate email does not render duplicate chips/rows.
- Saved share settings reopen with the current mode and email list.

Public links center:

- Show permission summary:
  - `可阅读`
  - `链接可编辑`
  - `<n> 人可编辑`
- Do not show full emails in the list.
- Owner can open settings and update mode/emails without changing the link.

File browser and renderer contract:

- Build a `DriveRendererContext` from snapshot and mutation handlers.
- Pass it to every renderer through `DriveRendererShell`.
- Keep renderer selection in `DriveFinder` and preserve selected renderer after save where possible.
- Make the edit path discoverable. If the current default renderer is Markdown preview, users must have a clear way to switch to code/source editing without guessing.

Code renderer:

- Add a compact toolbar.
- Enable Monaco edit mode only when `context.edit.editable` and `editorKind === "text"`.
- Track dirty state.
- `保存` is enabled only when dirty and not saving.
- `重新加载` discards local content only after confirmation.
- Save success refreshes snapshot and clears dirty state.
- Save failure preserves local content.
- Conflict dialog offers:
  - `下载本地版本`
  - `重新加载`
  - `取消`
- Permission/login/quota/not-found/network failures also keep local content and offer local download before destructive reload or navigation.

Anonymous editable link behavior:

- If share mode supports editing and the user is anonymous, show `登录后编辑` only when the app can return the user to the same share route after login.
- Anonymous users do not see editor toolbar or specified editor emails.

## Desktop, MCP, And Built-In Guidance

Desktop account service and IPC:

- Update share create/list DTO handling in `desktop/electron/services/account-service.ts`.
- Update `desktop/electron/modules/account/ipc.ts` schemas if share APIs pass through desktop.
- Update `desktop/src/types/bridge.ts` if renderer bridge types expose share settings.

Capabilities and MCP:

- Update `desktop/synapse-capabilities/shared/drive-domain.ts` for `drive_share_create` schema:
  - `accessMode`
  - `editorEmails`
- Update capability tests.
- Update `desktop/electron/capabilities/drive-dispatcher.ts` only for share create/list metadata.
- Do not add a Drive content update MCP tool in this delivery unless explicitly requested.
- Update `desktop/resources/templates/skills/synapse-drive-mcp/content.md` so agents understand the three share modes and specified editor email behavior.

Capability documentation:

- Update `docs/reference/capability-naming-matrix.md` only if new MCP tools are added. If no content update MCP tool is added, the naming matrix can remain unchanged except for any schema-level docs elsewhere.

## UI Review And Reachability Gate

Run the `impeccable` review workflow before considering the UI complete.

Review targets:

- share settings form;
- public links center permission summary;
- multi-email input;
- file reader edit entry;
- code renderer toolbar;
- conflict dialog;
- permission-denied, login-required, quota, network, and stale-version states.

Reachability acceptance:

- Owner can create, inspect, modify, and disable each share mode.
- Owner can edit supported files and find version history after save.
- Anonymous visitor can understand editable links require login.
- Authorized editor can reach the editor and save.
- Unauthorized visitor sees normal read-only experience.
- Every failure that risks local work offers local download.
- No capability exists only in API without UI entry.

## Tests

Server tests:

- Prisma migration/backfill behavior.
- Share settings validation, normalization, de-duplication, and empty specified list rejection.
- Existing share URL stability across permission changes.
- Owner edit priority over email list.
- Link-edit save authorization.
- Specified-editor save authorization.
- Anonymous save rejection.
- Password, expiry, disabled share, deleted item, moved-out-of-subtree failures.
- Stale `baseVersionId` conflict.
- Text save creates `online_edit`, preserves file name and MIME type, charges owner quota.
- Share-editor quota failure redacts owner quota details.
- Public share snapshots do not expose editor emails.

Dashboard tests:

- Share settings form renders all three modes.
- Specified-editor email input validates empty, invalid, duplicate, add, remove, reopen.
- Public links center shows summaries without full email leak.
- Code renderer editable/read-only states.
- Toolbar dirty/save/reload behavior.
- Conflict dialog local download/reload/cancel behavior.
- Permission/login/quota/network failures keep Monaco content.
- Finder/header keeps edit route discoverable for Markdown/source editing.

Desktop/MCP tests:

- Account service passes share settings.
- IPC schemas accept and reject expected share settings.
- Capability schema includes access mode and editor emails.
- Built-in Drive MCP guidance mentions editable share modes.

Recommended validation commands:

```bash
pnpm --filter @synapse/server exec vitest run src/drive
pnpm --filter @synapse/dashboard exec vitest run src/features/drive-browser src/lib/api.test.ts
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/account-service.test.ts electron/capabilities/__tests__/drive-dispatcher.test.ts
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/dashboard run typecheck
pnpm --filter @synapse/server run typecheck
```

Adjust exact commands to the package scripts that exist at implementation time.

## Release Notes

This is user-visible. Update `RELEASE_NOTES_PENDING.md` when implementation lands.

Suggested release note direction:

- Drive shares can now be configured as readable links, editable links, or editable by specified emails.
- Supported text files can be edited from the Drive code view and saved as versioned updates.
- If a file changes while editing, Synapse keeps local edits and lets users download their local version before reloading.

Do not mention internal table names, service names, object keys, or implementation order.

## Main Risks

Patch-like service growth:

- Mitigation: extract share access, write access, file change, and editable-preview responsibilities before adding save endpoints.

Permission bypass through stale UI state:

- Mitigation: save-time resolver always reads fresh database state and ignores client-provided authorization fields.

Local work loss:

- Mitigation: Monaco content remains in memory on failures; conflict and failure surfaces offer local download.

Leaking specified editor emails:

- Mitigation: emails are owner-visible only; public snapshots and share pages never include them.

Hidden feature:

- Mitigation: user reachability checklist and impeccable review gate block completion if UI entry points are missing.

MCP scope creep:

- Mitigation: update share schemas and guidance, but do not expose content update MCP tool without a separate decision.
