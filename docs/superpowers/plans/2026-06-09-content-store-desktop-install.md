# Content Store Desktop Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Dashboard Skill/Rule install buttons wake the local Synapse desktop app through `synapse://content-install?session=...`, open an independent install window, download and validate the immutable package, then reuse the existing editor-selection and Skill/Rule install flow.

**Architecture:** Add a content-install protocol route in Electron main process, a managed independent install window, a narrow preload IPC surface, and a main-process service that resolves the install session through the logged-in account, downloads the package from server, validates SHA-256 and manifest, materializes files in a temporary local source, and hands the result to the existing `ContentInstallDialog` flow. Dashboard never asks for editor choice; Desktop owns that flow.

**Tech Stack:** Electron main/preload/renderer, existing IPC registry, existing content install services, AccountService authenticated HTTP, Node streams/crypto/fs, React, shadcn/Radix components, Vitest.

---

## Dependencies

This plan depends on:

- `docs/superpowers/plans/2026-06-09-content-store-server-foundation.md`
- `docs/superpowers/plans/2026-06-09-content-store-dashboard-store.md`

The Dashboard editor plan is not required for installing already-published server content.

## Hard Rules

- Desktop store browsing is not part of this phase.
- Desktop only handles the independent install window.
- Dashboard install uses protocol wakeup. It must not choose editor.
- The install window must be a separate `BrowserWindow`, not a modal in the existing main window.
- Initial install window state is blank/loading with a spinner.
- Skill and Rule install through this path. Prompt does not install.
- Client installs only immutable packages and validates package SHA-256 plus manifest before showing editor selection.
- Reuse existing Skill/Rule install flow from editor selection onward.
- Sensitive file writes and editor replacements remain governed by existing permission, backup, and audit behavior.

## Files

- Modify: `shared/src/content-store.ts`
- Modify: `server/src/content-store/content-store.service.ts`
- Modify: `server/src/content-store/content-store.controller.ts`
- Modify: `server/src/content-store/content-store.service.spec.ts`
- Modify: `server/src/content-store/content-store.controller.spec.ts`
- Create: `desktop/electron/services/content-store-install-service.ts`
- Create: `desktop/electron/services/__tests__/content-store-install-service.test.ts`
- Create: `desktop/electron/services/content-store-install-window-service.ts`
- Create: `desktop/electron/services/__tests__/content-store-install-window-service.test.ts`
- Create: `desktop/electron/modules/content-store-install/ipc.ts`
- Create: `desktop/electron/modules/content-store-install/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/main.ts`
- Modify: `desktop/electron/bootstrap/app-events.ts`
- Modify: `desktop/electron/bootstrap/__tests__/app-events.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Create: `desktop/src/types/content-store-install.ts`
- Modify: `desktop/src/lib/content-window.ts`
- Create: `desktop/src/lib/content-store-install-window.ts`
- Create: `desktop/src/lib/content-store-install-window.test.ts`
- Modify: `desktop/src/App.tsx`
- Create: `desktop/src/modules/content-store-install/content-store-install-window-page.tsx`
- Create: `desktop/src/modules/content-store-install/content-store-install-loading.tsx`
- Create: `desktop/src/modules/content-store-install/use-content-store-install.ts`
- Create: `desktop/src/modules/content-store-install/__tests__/content-store-install-window-page.test.tsx`

## Server Gap to Close

The server currently resolves install sessions but does not expose a binary package download endpoint. Add it before Desktop work:

- `GET /api/content-store/install-sessions/:id/package`
- Requires the same logged-in user as the session owner.
- Reuses `resolveInstallSession`.
- Streams the package object from `ContentStoreStoragePort.getObjectStream`.
- Sets `Content-Type: application/zip`, `Content-Length` when known, and `Content-Disposition: attachment; filename="<sessionId>.zip"`.
- Does not mark install complete. Completion remains `POST /complete`.

---

### Task 1: Server Package Download Endpoint

**Files:**
- Modify server files listed above.

- [x] No shared binary DTO was needed for package download metadata.
- [x] Add `ContentStoreService.openInstallPackage(userId, sessionId)` returning stream, size, contentType, packageSha256, and type/title metadata.
- [x] Add controller method `GET /api/content-store/install-sessions/:id/package`.
- [x] Use `@Res({ passthrough: false })` only if needed for streaming; keep validation and error behavior consistent with existing Nest controllers.
- [x] Test:
  - owner can download pending non-expired session package
  - another user cannot download
  - expired session cannot download
  - Prompt sessions cannot exist/download
  - missing storage object returns a controlled error

### Task 2: Desktop Protocol Parsing

**Files:**
- Modify: `desktop/electron/main.ts`
- Modify: `desktop/electron/bootstrap/app-events.ts`
- Modify: `desktop/electron/bootstrap/__tests__/app-events.test.ts`
- Create: `desktop/src/lib/content-store-install-window.ts`
- Create: `desktop/src/lib/content-store-install-window.test.ts`

- [x] Add pure parser for `synapse://content-install?session=<id>`.
- [x] Keep existing auth callback behavior unchanged.
- [x] `drainProtocolUrls` must route auth callbacks to `accountService.handleAuthCallback` and content-install URLs to the new install window service.
- [x] Second-instance behavior should focus existing app only for generic launches; content-install opens/focuses the independent install window.
- [x] Invalid content-install URL should log warn and focus/create main window.
- [x] Tests cover auth callback, valid content-install, missing session, malformed URL, and multiple pending URLs.

### Task 3: Independent Install Window Service

**Files:**
- Create: `desktop/electron/services/content-store-install-window-service.ts`
- Create: `desktop/electron/services/__tests__/content-store-install-window-service.test.ts`
- Modify: `desktop/src/App.tsx`
- Create: `desktop/src/types/content-store-install.ts`

- [x] Implement a managed `BrowserWindow` similar to `content-window-service` but keyed by install session id.
- [x] Window query params:
  - `synapseWindow=content-store-install`
  - `session=<sessionId>`
- [x] Bounds should be suitable for editor selection and install dialog. Use existing content editor bounds as a reference.
- [x] Existing same-session window is focused instead of duplicated.
- [x] Renderer health tracking follows existing content-window pattern.
- [x] `App.tsx` detects the new window kind and renders `ContentStoreInstallWindowPage`.
- [x] Tests cover create, focus existing, cleanup on close, and query construction.

### Task 4: Authenticated Desktop Install Service

**Files:**
- Create: `desktop/electron/services/content-store-install-service.ts`
- Create: `desktop/electron/services/__tests__/content-store-install-service.test.ts`
- Modify: `desktop/electron/services/account-service.ts` if a reusable authenticated binary fetch helper is needed.

- [x] Add methods:
  - `resolveInstallSession(sessionId)`
  - `downloadInstallPackage(sessionId)`
  - `recordInstall(sessionId, clientInstanceId)`
- [x] Use AccountService credentials and API base URL. If user is not logged in, return a typed unauthenticated state for renderer.
- [x] Download package to an app-managed temporary directory.
- [x] Compute SHA-256 while streaming and compare with server `packageSha256`.
- [x] Extract zip only after package hash matches.
- [x] Validate `manifest.json`:
  - `schemaVersion === 1`
  - type is `skill` or `rule`
  - contentId/versionId match resolved session
  - every listed file exists inside `content/`
  - no path escapes, absolute paths, or duplicate paths
  - file hashes and sizes match extracted files
  - Skill main file is `content/SKILL.md`
  - Rule main file is `content/RULE.md`
- [x] Return a local install source payload compatible with existing content install components.
- [x] Clean temporary files on failure and when the install window closes if no install is in progress.

### Task 5: IPC Surface

**Files:**
- Create: `desktop/electron/modules/content-store-install/ipc.ts`
- Create: `desktop/electron/modules/content-store-install/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`

- [x] Register IPC through `IpcRegistry`; do not use bare `ipcMain.handle`.
- [x] Expose narrow methods:
  - `window.synapse.contentStoreInstall.resolve(sessionId)`
  - `window.synapse.contentStoreInstall.prepare(sessionId)`
  - `window.synapse.contentStoreInstall.recordComplete(sessionId)`
- [x] Validate all payloads with zod.
- [x] Do not expose raw package bytes to renderer.
- [x] Tests cover schema validation, unauthenticated error mapping, and service errors.

### Task 6: Renderer Install Window

**Files:**
- Create: `desktop/src/modules/content-store-install/content-store-install-window-page.tsx`
- Create: `desktop/src/modules/content-store-install/content-store-install-loading.tsx`
- Create: `desktop/src/modules/content-store-install/use-content-store-install.ts`
- Create tests.

- [x] Initial render is a centered spinner/loading state with no extra explanatory copy.
- [x] Resolve session and prepare local package through IPC.
- [x] If unauthenticated, show a concise state with a login action that uses existing account login bridge.
- [x] If package is removed/expired/mismatched, show a concise error and no editor selector.
- [x] Once prepared, render the existing `ContentInstallDialog` path with:
  - item metadata from package/session
  - local source files from prepared package
  - initial editor selection empty
- [x] From editor selection onward, behavior must match existing local Skill/Rule installation.
- [x] After install succeeds, call `recordComplete` and refresh install status cache.

### Task 7: Verification

- [x] Run:

```bash
pnpm --filter @synapse/shared run build
pnpm --filter @synapse/server run test -- content-store
pnpm --filter @synapse/server run build
pnpm --filter @synapse/desktop run test -- content-store-install
pnpm --filter @synapse/desktop run test -- content-window content-install-service
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
```

- [x] Inspect forbidden renderer UI patterns:

```bash
rg "style=\\{\\{|#[0-9A-Fa-f]{3,8}|rgb\\(|hsl\\(|from-|to-|via-|✨|🚀|⚡" desktop/src/modules/content-store-install
```

- [x] Update `RELEASE_NOTES_PENDING.md`.
- [x] Commit:

```bash
git add shared/src/content-store.ts server/src/content-store desktop/electron desktop/src RELEASE_NOTES_PENDING.md
git commit -m "feat(desktop): install content store packages"
```
