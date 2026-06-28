# Drive Local Sync Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Drive local sync as a user-usable feature: safe binding, file and folder initialization, bidirectional sync, watcher catch-up, remote cursor polling, conflicts, exclude rules, and UI management.

**Architecture:** Extend the existing Phase 1 infrastructure instead of replacing it. `DriveSyncService` remains the desktop main-process owner, gains small focused collaborators for filesystem inspection, exclude matching, baseline storage, planning, transfer execution, watcher events, remote change polling, and conflict resolution. Existing `AccountService` Drive APIs provide upload/download/move/trash operations; renderer talks only through `window.synapse.driveSync`.

**Tech Stack:** Electron main IPC, DataRepository, Node `fs`/`path`/`crypto`, Electron `shell.trashItem`, React 19, shadcn/Radix UI, Tailwind tokens, Vitest, TypeScript 6, existing Synapse Drive server APIs, existing Drive change cursor API, pnpm monorepo.

---

## Scope

This is the full remaining implementation plan after the completed infrastructure slice:

- Binding wizard and row-level Drive sync actions.
- Safe initial file binding in both directions.
- Safe initial folder binding in both directions.
- Baseline snapshot persistence.
- Forced and editable per-binding exclude rules.
- `.git/` forced exclusion everywhere.
- Optional one-time `.gitignore` import during folder binding.
- Local filesystem scan and watcher.
- Remote change polling by cursor.
- Sync planning for create, update, delete, restore, rename, and move.
- Upload/download/trash/move execution.
- Conflict records and conflict resolution actions.
- Sync status details UI.
- Tests, release notes, and verification.

This plan does not add shared-item sync, background sync after app exit, initial two-sided merge, Git operations, or raw storage key exposure.

## Existing Code To Reuse

- `desktop/electron/services/drive-sync-service.ts`
  - Current binding, operation, conflict, snapshot shell.
- `desktop/electron/runtime/data-repo/schemas/drive-sync.ts`
  - Current bindings, operations, conflicts, state schemas.
- `desktop/electron/modules/drive-sync/ipc.ts`
  - Current snapshot/create/remove IPC module.
- `desktop/electron/services/account-service.ts`
  - Reuse `downloadDriveFile`, `downloadDriveFolderZip`, `prepareDriveUpload`, `completeDriveUpload`, `uploadDriveLocalItems`, `createDriveFolder`, `renameDriveItem`, `moveDriveItem`, `deleteDriveItem`, `listDriveItemTree`, `ensureDriveFolderPath`.
- `server/src/drive/drive-change-log.ts`
  - Remote cursor source.
- `desktop/src/modules/drive/index.tsx`
  - Current Drive module and toolbar status entry.

## New File Structure

### Shared

- Modify `shared/src/drive.ts`
  - Add binding preview, creation, settings, conflict resolution, and sync status DTOs.
- Modify `shared/src/drive.test.ts`
  - Add stable value tests for new enums.

### Desktop Main

- Modify `desktop/electron/runtime/data-repo/schemas/drive-sync.ts`
  - Add baseline namespace and richer binding settings.
- Modify `desktop/electron/runtime/data-repo/schemas/index.ts`
  - Register baseline schema.
- Modify `desktop/electron/runtime/data-repo/index.ts`
  - Export baseline entry type.
- Modify `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`
  - Validate baseline and settings records.
- Create `desktop/electron/services/drive-sync-paths.ts`
  - Normalize binding paths, relative paths, containment, case keys, and safe local write paths.
- Create `desktop/electron/services/drive-sync-excludes.ts`
  - Forced/default/user/imported rule matching for scans, watcher, transfer, and conflicts.
- Create `desktop/electron/services/drive-sync-local-snapshot.ts`
  - Inspect files/folders, compute size/mtime/hash, scan folder trees.
- Create `desktop/electron/services/drive-sync-binding-validator.ts`
  - Validate initial binding matrix and local path state.
- Create `desktop/electron/services/drive-sync-baseline.ts`
  - Upsert/list/remove baseline entries.
- Create `desktop/electron/services/drive-sync-planner.ts`
  - Convert local/remote/baseline state into operations or conflicts.
- Create `desktop/electron/services/drive-sync-executor.ts`
  - Execute upload/download/delete/move/rename and update baseline.
- Create `desktop/electron/services/drive-sync-watcher.ts`
  - Watch active folder bindings, debounce events, ignore self writes.
- Create `desktop/electron/services/drive-sync-remote-poller.ts`
  - Pull `GET /api/drive/changes` through `AccountService` and advance binding cursors.
- Create `desktop/electron/services/__tests__/drive-sync-paths.test.ts`
- Create `desktop/electron/services/__tests__/drive-sync-excludes.test.ts`
- Create `desktop/electron/services/__tests__/drive-sync-local-snapshot.test.ts`
- Create `desktop/electron/services/__tests__/drive-sync-binding-validator.test.ts`
- Create `desktop/electron/services/__tests__/drive-sync-baseline.test.ts`
- Create `desktop/electron/services/__tests__/drive-sync-planner.test.ts`
- Create `desktop/electron/services/__tests__/drive-sync-executor.test.ts`
- Create `desktop/electron/services/__tests__/drive-sync-watcher.test.ts`
- Create `desktop/electron/services/__tests__/drive-sync-remote-poller.test.ts`
- Modify `desktop/electron/services/drive-sync-service.ts`
  - Compose collaborators and expose user-facing methods.
- Modify `desktop/electron/services/__tests__/drive-sync-service.test.ts`
  - Cover integrated lifecycle.
- Modify `desktop/electron/bootstrap/descriptors.ts`
  - Add dependencies: `account.service`, `core.window-manager`, and logger as needed.

### IPC And Preload

- Modify `desktop/electron/modules/drive-sync/ipc.ts`
  - Add preview, choose path, create safe binding, pause, resume, update excludes, rescan, retry, resolve conflict, open local path.
- Modify `desktop/electron/modules/drive-sync/__tests__/ipc.test.ts`
  - Add schema and handler tests.
- Modify `desktop/electron/preload.ts`
  - Expose new bridge methods.
- Modify `desktop/electron/generated/ipc-channels.generated.ts`
  - Regenerate using `corepack pnpm --filter @synapse/desktop run generate:ipc`.
- Modify `desktop/electron/__tests__/preload.test.ts`
  - Assert channel wiring.
- Modify `desktop/src/types/bridge.ts`
  - Add bridge types.

### Renderer

- Create `desktop/src/modules/drive/drive-sync-dialog.tsx`
  - Binding wizard, status details, conflicts, settings.
- Create `desktop/src/modules/drive/drive-sync-status.tsx`
  - Small status label helpers for rows and toolbar.
- Create `desktop/src/modules/drive/__tests__/drive-sync-dialog.test.tsx`
- Create `desktop/src/modules/drive/__tests__/drive-sync-status.test.tsx`
- Modify `desktop/src/modules/drive/index.tsx`
  - Add row-level actions and open dialogs.
- Modify `desktop/src/modules/drive/__tests__/drive-module.test.tsx`
  - Cover row entry, wizard opening, status summary, and conflict summary.

### Docs

- Modify `RELEASE_NOTES_PENDING.md`
  - Add user-facing Drive local sync completion note.

---

## Task 1: Shared DTOs For Full Sync

**Files:**
- Modify: `shared/src/drive.ts`
- Modify: `shared/src/drive.test.ts`

- [ ] **Step 1: Write failing tests for sync value exports**

Add tests for:

```ts
expect(DRIVE_SYNC_INITIAL_DIRECTIONS).toEqual(["remote_to_local", "local_to_remote"])
expect(DRIVE_SYNC_BINDING_PREVIEW_STATUSES).toEqual(["ready", "blocked", "warning"])
expect(DRIVE_SYNC_CONFLICT_RESOLUTIONS).toEqual(["keep_local", "keep_remote", "keep_both", "confirm_delete", "skip"])
```

- [ ] **Step 2: Run shared tests and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: FAIL because the constants are not exported.

- [ ] **Step 3: Add DTOs**

Add to `shared/src/drive.ts`:

```ts
export const DRIVE_SYNC_INITIAL_DIRECTIONS = ["remote_to_local", "local_to_remote"] as const
export type DriveSyncInitialDirection = typeof DRIVE_SYNC_INITIAL_DIRECTIONS[number]

export const DRIVE_SYNC_BINDING_PREVIEW_STATUSES = ["ready", "blocked", "warning"] as const
export type DriveSyncBindingPreviewStatus = typeof DRIVE_SYNC_BINDING_PREVIEW_STATUSES[number]

export const DRIVE_SYNC_CONFLICT_RESOLUTIONS = ["keep_local", "keep_remote", "keep_both", "confirm_delete", "skip"] as const
export type DriveSyncConflictResolutionAction = typeof DRIVE_SYNC_CONFLICT_RESOLUTIONS[number]

export interface DriveSyncBindingPreviewDto {
  readonly status: DriveSyncBindingPreviewStatus
  readonly direction: DriveSyncInitialDirection | null
  readonly reason: string | null
  readonly localPath: string
  readonly localKind: "missing" | "file" | "folder" | "other"
  readonly localEmpty: boolean | null
  readonly forcedExcludeRules: readonly string[]
  readonly defaultExcludeRules: readonly string[]
  readonly importedGitignoreRules: readonly string[]
}

export interface DriveSyncCreateSafeBindingInput {
  readonly driveItemId: string
  readonly driveItemName: string
  readonly kind: "file" | "folder"
  readonly drivePathHint?: string | null
  readonly localPath: string
  readonly direction: DriveSyncInitialDirection
  readonly excludeRules?: readonly string[]
  readonly importGitignore?: boolean
}

export interface DriveSyncExcludeRulesDto {
  readonly forced: readonly string[]
  readonly defaults: readonly string[]
  readonly importedGitignore: readonly string[]
  readonly user: readonly string[]
}

export interface DriveSyncConflictResolutionInput {
  readonly conflictId: string
  readonly action: DriveSyncConflictResolutionAction
}
```

- [ ] **Step 4: Run shared tests and confirm GREEN**

Run:

```bash
corepack pnpm --filter @synapse/shared test -- drive.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/drive.ts shared/src/drive.test.ts
git commit -m "feat: add drive sync completion DTOs"
```

---

## Task 2: Baseline DataRepository Schema

**Files:**
- Modify: `desktop/electron/runtime/data-repo/schemas/drive-sync.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Modify: `desktop/electron/runtime/data-repo/index.ts`
- Modify: `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests that validate:

- `drive.sync.baseline` exists and uses sqlite.
- Valid baseline entries include `bindingId`, `relativePath`, `kind`, `remoteItemId`, `remoteVersionId`, `remoteEtag`, `localSize`, `localMtimeMs`, `localHash`, `lastSyncedAt`, `deletedAt`.
- Invalid entries reject path traversal in `relativePath`.
- Binding entries keep forced/default/imported/user exclude groups instead of only a flat string array.

- [ ] **Step 2: Run schema tests and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: FAIL because baseline schema and grouped exclude settings do not exist.

- [ ] **Step 3: Add baseline and grouped rules**

Extend `DriveSyncBindingEntryV1` with:

```ts
excludeRules: {
  readonly forced: readonly string[]
  readonly defaults: readonly string[]
  readonly importedGitignore: readonly string[]
  readonly user: readonly string[]
}
```

Add:

```ts
export interface DriveSyncBaselineEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  bindingId: string
  relativePath: string
  kind: "file" | "folder"
  remoteItemId: string
  remoteVersionId: string | null
  remoteEtag: string | null
  localSize: number | null
  localMtimeMs: number | null
  localHash: string | null
  lastSyncedAt: string
  deletedAt: string | null
}
```

Add `driveSyncBaselineSchema` with name `drive.sync.baseline`, backend `sqlite`, version `1`, and strict validation.

- [ ] **Step 4: Register exports**

Register and export `driveSyncBaselineSchema` and `DriveSyncBaselineEntryV1` from the schema index and data repo index.

- [ ] **Step 5: Run schema tests and confirm GREEN**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/runtime/data-repo/schemas/drive-sync.ts desktop/electron/runtime/data-repo/schemas/index.ts desktop/electron/runtime/data-repo/index.ts desktop/electron/runtime/data-repo/__tests__/schemas.test.ts
git commit -m "feat: add drive sync baseline schema"
```

---

## Task 3: Path And Exclude Utilities

**Files:**
- Create: `desktop/electron/services/drive-sync-paths.ts`
- Create: `desktop/electron/services/drive-sync-excludes.ts`
- Test: `desktop/electron/services/__tests__/drive-sync-paths.test.ts`
- Test: `desktop/electron/services/__tests__/drive-sync-excludes.test.ts`

- [ ] **Step 1: Write failing path tests**

Cover:

- `toBindingRelativePath(root, child)` returns POSIX-style relative paths.
- Path traversal outside root throws.
- Empty relative path represents binding root.
- Case keys normalize only for collision checks, not stored paths.
- Symlink escape targets are rejected when realpath is available.

- [ ] **Step 2: Write failing exclude tests**

Cover:

- `.git/` is always excluded.
- Sync temp files are always excluded.
- Defaults exclude `node_modules/`, `dist/`, `build/`, `coverage/`, `.cache/`, `.tmp/`, `.DS_Store`, and `*.log`.
- User rules can exclude extra paths.
- Imported `.gitignore` rules are copied into binding settings and do not re-read `.gitignore`.

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-paths.test.ts electron/services/__tests__/drive-sync-excludes.test.ts
```

Expected: FAIL because the files do not exist.

- [ ] **Step 4: Implement path utilities**

Export:

```ts
export function normalizeLocalPath(input: string): string
export function assertInsideBindingRoot(rootPath: string, targetPath: string): string
export function toDriveSyncRelativePath(rootPath: string, targetPath: string): string
export function resolveBindingChildPath(rootPath: string, relativePath: string): string
export function pathCollisionKey(relativePath: string): string
```

- [ ] **Step 5: Implement exclude utilities**

Export:

```ts
export const DRIVE_SYNC_FORCED_EXCLUDES = [".git/**", ".git", ".synapse-sync/**", "*.synapse-sync-tmp"] as const
export const DRIVE_SYNC_DEFAULT_EXCLUDES = ["node_modules/**", "vendor/**", "dist/**", "build/**", "coverage/**", ".cache/**", ".tmp/**", ".DS_Store", "*.log"] as const

export function createDefaultDriveSyncExcludeRules(): DriveSyncExcludeRulesDto
export function isDriveSyncExcluded(relativePath: string, rules: DriveSyncExcludeRulesDto): boolean
export function parseGitignoreForDriveSync(content: string): readonly string[]
```

Use simple glob matching implemented locally. Do not add dependencies.

- [ ] **Step 6: Run tests and confirm GREEN**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-paths.test.ts electron/services/__tests__/drive-sync-excludes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/drive-sync-paths.ts desktop/electron/services/drive-sync-excludes.ts desktop/electron/services/__tests__/drive-sync-paths.test.ts desktop/electron/services/__tests__/drive-sync-excludes.test.ts
git commit -m "feat: add drive sync path and exclude utilities"
```

---

## Task 4: Local Snapshot And Binding Validation

**Files:**
- Create: `desktop/electron/services/drive-sync-local-snapshot.ts`
- Create: `desktop/electron/services/drive-sync-binding-validator.ts`
- Test: `desktop/electron/services/__tests__/drive-sync-local-snapshot.test.ts`
- Test: `desktop/electron/services/__tests__/drive-sync-binding-validator.test.ts`

- [ ] **Step 1: Write failing local snapshot tests**

Use temporary directories. Cover:

- Missing path returns `{ kind: "missing" }`.
- File path returns file size and mtime.
- Empty folder returns folder kind and empty tree.
- Non-empty folder lists included files and folders.
- `.git/` and default excludes are skipped.
- Symlinks are skipped with a warning.

- [ ] **Step 2: Write failing binding validation tests**

Cover matrix:

- Remote file + missing local file => `remote_to_local` ready.
- Local file + new remote target => `local_to_remote` ready.
- Remote file + existing local file => blocked.
- Remote folder + missing local folder => `remote_to_local` ready.
- Remote folder + empty local folder => `remote_to_local` ready.
- Remote folder + non-empty local folder => blocked.
- Local folder + new remote target => `local_to_remote` ready.
- Local file selected for remote folder => blocked.
- Local folder selected for remote file => blocked.
- Duplicate drive item or duplicate local path => blocked.
- Nested duplicate paths are blocked: a binding cannot be created inside another active binding root or have another active binding inside its root.
- Permission denied local path => blocked with a visible reason.
- Disk-unwritable target parent => blocked with a visible reason.
- Cloud item deleted or unavailable before binding => blocked with a visible reason and no local writes.
- `.gitignore` import returns copied rules when requested.

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-local-snapshot.test.ts electron/services/__tests__/drive-sync-binding-validator.test.ts
```

Expected: FAIL because services do not exist.

- [ ] **Step 4: Implement local snapshot**

Export:

```ts
export interface DriveSyncLocalSnapshotEntry {
  readonly relativePath: string
  readonly kind: "file" | "folder"
  readonly size: number | null
  readonly mtimeMs: number | null
  readonly hash: string | null
}

export async function inspectDriveSyncLocalPath(path: string): Promise<{ kind: "missing" | "file" | "folder" | "other"; empty: boolean | null }>
export async function scanDriveSyncLocalTree(input: { rootPath: string; rules: DriveSyncExcludeRulesDto; hashFiles?: boolean }): Promise<readonly DriveSyncLocalSnapshotEntry[]>
export async function hashDriveSyncFile(filePath: string): Promise<string>
```

- [ ] **Step 5: Implement binding validator**

Export:

```ts
export async function previewDriveSyncBinding(input: {
  driveItemId: string
  driveItemName: string
  kind: "file" | "folder"
  localPath: string
  remoteExists: boolean
  directionHint?: DriveSyncInitialDirection | null
  activeBindings: readonly DriveSyncBindingEntryV1[]
  importGitignore?: boolean
}): Promise<DriveSyncBindingPreviewDto>
```

- [ ] **Step 6: Run tests and confirm GREEN**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-local-snapshot.test.ts electron/services/__tests__/drive-sync-binding-validator.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/drive-sync-local-snapshot.ts desktop/electron/services/drive-sync-binding-validator.ts desktop/electron/services/__tests__/drive-sync-local-snapshot.test.ts desktop/electron/services/__tests__/drive-sync-binding-validator.test.ts
git commit -m "feat: add drive sync binding validation"
```

---

## Task 5: Baseline Store

**Files:**
- Create: `desktop/electron/services/drive-sync-baseline.ts`
- Test: `desktop/electron/services/__tests__/drive-sync-baseline.test.ts`

- [ ] **Step 1: Write failing baseline tests**

Cover:

- Upserting file baseline by binding and relative path.
- Listing active baseline entries by binding.
- Marking deleted entries without removing identity.
- Removing all baseline entries for a binding when binding is removed.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-baseline.test.ts
```

Expected: FAIL because the baseline store does not exist.

- [ ] **Step 3: Implement baseline store**

Export:

```ts
export function createDriveSyncBaselineStore(deps: {
  readonly baseline: DataNamespace<DriveSyncBaselineEntryV1>
  readonly now?: () => Date
}) {
  return {
    listByBinding(bindingId: string): Promise<readonly DriveSyncBaselineEntryV1[]>
    upsert(entry: Omit<DriveSyncBaselineEntryV1, "id" | "schemaVersion" | "lastSyncedAt"> & { readonly lastSyncedAt?: string }): Promise<DriveSyncBaselineEntryV1>
    markDeleted(bindingId: string, relativePath: string): Promise<DriveSyncBaselineEntryV1>
    removeBinding(bindingId: string): Promise<void>
  }
}
```

- [ ] **Step 4: Run tests and confirm GREEN**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-baseline.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/drive-sync-baseline.ts desktop/electron/services/__tests__/drive-sync-baseline.test.ts
git commit -m "feat: add drive sync baseline store"
```

---

## Task 6: Safe Binding Creation With Initial File And Folder Transfer

**Files:**
- Modify: `desktop/electron/services/drive-sync-service.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/services/__tests__/drive-sync-service.test.ts`
- Modify: `desktop/electron/bootstrap/__tests__/registry.test.ts`

- [ ] **Step 1: Write failing service integration tests**

Cover:

- `previewBinding` reports remote file to missing local file as ready.
- `createSafeBinding` downloads remote file, writes baseline, records succeeded download operation.
- `createSafeBinding` uploads local file, creates remote item, writes baseline, records succeeded upload operation.
- Remote folder to empty local folder downloads folder zip into a safe temp location, extracts included files, writes baseline.
- Local folder to new remote target uploads included files only, excludes `.git/`.
- If transfer fails, binding is not active and operation is error.
- Permission failures, disk write failures, and missing remote item failures settle into visible operation errors without leaving a half-active binding.
- `removeBinding` also removes baseline entries.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-service.test.ts electron/bootstrap/__tests__/registry.test.ts
```

Expected: FAIL because the methods and dependencies do not exist.

- [ ] **Step 3: Add service dependencies**

Extend `DriveSyncServiceDeps`:

```ts
readonly baseline: DataNamespace<DriveSyncBaselineEntryV1>
readonly accountService: Pick<AccountService,
  | "downloadDriveFile"
  | "downloadDriveFolderZip"
  | "uploadDriveLocalItems"
  | "createDriveFolder"
  | "renameDriveItem"
  | "moveDriveItem"
  | "deleteDriveItem"
  | "listDriveItemTree"
  | "ensureDriveFolderPath"
>
readonly trashItem?: (targetPath: string) => Promise<void>
readonly logger?: Pick<StructuredLogger, "warn" | "error" | "info" | "child">
```

Update `coreDriveSyncDescriptor.dependsOn` to include `core.data-repository` and `account.service`.

- [ ] **Step 4: Add service methods**

Expose:

```ts
previewBinding(input): Promise<DriveSyncBindingPreviewDto>
createSafeBinding(input: DriveSyncCreateSafeBindingInput): Promise<DriveSyncBindingDto>
pauseBinding(id: string): Promise<DriveSyncBindingDto>
resumeBinding(id: string): Promise<DriveSyncBindingDto>
updateExcludeRules(input): Promise<DriveSyncBindingDto>
rescanBinding(id: string): Promise<DriveSyncSnapshotDto>
retryBinding(id: string): Promise<DriveSyncSnapshotDto>
```

Keep existing `createBinding` as an internal primitive for tests and migrations. Renderer and IPC must call only `createSafeBinding`.

- [ ] **Step 5: Implement initial transfers**

Rules:

- Remote file to missing local file: ensure parent directory, call `accountService.downloadDriveFile({ itemId, outputPath })`, then baseline root file.
- Local file to new remote target: call `accountService.uploadDriveLocalItems` with one file, then fetch the parent Drive tree by parent/name to identify the created remote item before writing baseline.
- Remote folder to missing/empty local folder: create folder, download folder zip, extract into temp dir, move into root, skip excluded paths, baseline entries.
- Local folder to new remote target: scan tree excluding rules, call `accountService.uploadDriveLocalItems`, baseline included entries.
- Any `.git/` content is excluded before transfer and baseline.

- [ ] **Step 6: Run tests and confirm GREEN**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-service.test.ts electron/bootstrap/__tests__/registry.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/drive-sync-service.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/services/__tests__/drive-sync-service.test.ts desktop/electron/bootstrap/__tests__/registry.test.ts
git commit -m "feat: create safe drive sync bindings"
```

---

## Task 7: Sync Planner

**Files:**
- Create: `desktop/electron/services/drive-sync-planner.ts`
- Test: `desktop/electron/services/__tests__/drive-sync-planner.test.ts`

- [ ] **Step 1: Write failing planner tests**

Cover:

- Local-only file create => upload operation.
- Remote-only file create => download operation.
- Local content changed only => upload operation.
- Remote content changed only => download operation.
- Both content changed => `both_modified` conflict.
- Local delete only => remote trash operation.
- Remote trash only => local trash operation.
- Local delete and remote edit => conflict.
- Remote delete and local edit => conflict.
- Same rename proven by identity => baseline update.
- Different rename/move on both sides => path conflict.
- Folder/file type mismatch => type mismatch conflict.
- Case-only path collisions on case-insensitive filesystems => path conflict.
- Remote change type `created` becomes download/create-local planning.
- Remote change type `content_updated` becomes download/update-local planning.
- Remote change types `renamed` and `moved` become local rename/move planning when identity is known.
- Remote change type `trashed` becomes recoverable local trash planning.
- Remote change type `restored` becomes local restore/download planning.
- Remote change type `deleted` becomes baseline tombstone or resync-required planning.
- Excluded path produces no operation and no conflict.

- [ ] **Step 2: Run planner test and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-planner.test.ts
```

Expected: FAIL because planner does not exist.

- [ ] **Step 3: Implement planner**

Export:

```ts
export type DriveSyncPlannedOperation =
  | { kind: "upload"; bindingId: string; relativePath: string; localPath: string; driveItemId: string | null }
  | { kind: "download"; bindingId: string; relativePath: string; localPath: string; driveItemId: string }
  | { kind: "delete_remote"; bindingId: string; relativePath: string; driveItemId: string }
  | { kind: "delete_local"; bindingId: string; relativePath: string; localPath: string }
  | { kind: "move_remote"; bindingId: string; relativePath: string; driveItemId: string; targetRelativePath: string }
  | { kind: "move_local"; bindingId: string; relativePath: string; localPath: string; targetRelativePath: string }

export type DriveSyncPlannedConflict = {
  readonly bindingId: string
  readonly relativePath: string
  readonly type: DriveSyncConflictEntryV1["type"]
  readonly localSnapshot: Record<string, unknown> | null
  readonly remoteSnapshot: Record<string, unknown> | null
}

export function planDriveSyncChanges(input: {
  readonly binding: DriveSyncBindingEntryV1
  readonly baseline: readonly DriveSyncBaselineEntryV1[]
  readonly local: readonly DriveSyncLocalSnapshotEntry[]
  readonly remote: readonly DriveSyncRemoteSnapshotEntry[]
}): { operations: readonly DriveSyncPlannedOperation[]; conflicts: readonly DriveSyncPlannedConflict[] }
```

- [ ] **Step 4: Run planner tests and confirm GREEN**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-planner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/drive-sync-planner.ts desktop/electron/services/__tests__/drive-sync-planner.test.ts
git commit -m "feat: add drive sync planner"
```

---

## Task 8: Sync Executor

**Files:**
- Create: `desktop/electron/services/drive-sync-executor.ts`
- Test: `desktop/electron/services/__tests__/drive-sync-executor.test.ts`
- Modify: `desktop/electron/services/drive-sync-service.ts`
- Modify: `desktop/electron/services/__tests__/drive-sync-service.test.ts`

- [ ] **Step 1: Write failing executor tests**

Cover:

- Download writes through temp file then renames into target.
- Upload calls account upload API and records baseline.
- Local folder create calls Drive folder creation APIs before uploading children.
- Local file content update uploads a new Drive version and updates baseline.
- Local delete calls `trashItem`; failure records operation error and leaves baseline active.
- Remote delete calls Drive trash API.
- Move local stays inside binding root.
- Move remote calls Drive move/rename APIs.
- Any failed operation records `error` with redacted message.
- Retryable network/server failures record `retry_wait` and can be retried through `retryBinding`.
- Non-retryable auth, permission, quota, type mismatch, and disk errors record `error`.
- Same binding and path operations run serially.

- [ ] **Step 2: Run executor tests and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-executor.test.ts
```

Expected: FAIL because executor does not exist.

- [ ] **Step 3: Implement executor**

Export:

```ts
export function createDriveSyncExecutor(deps: {
  readonly accountService: DriveSyncAccountService
  readonly baselineStore: DriveSyncBaselineStore
  readonly recordOperation: (input: DriveSyncRecordOperationInput) => Promise<DriveSyncOperationDto>
  readonly recordConflict: (input: DriveSyncRecordConflictInput) => Promise<DriveSyncConflictDto>
  readonly trashItem: (targetPath: string) => Promise<void>
  readonly now?: () => Date
}) {
  return {
    execute(binding: DriveSyncBindingEntryV1, operation: DriveSyncPlannedOperation): Promise<void>
    resolveConflict(binding: DriveSyncBindingEntryV1, conflict: DriveSyncConflictEntryV1, action: DriveSyncConflictResolutionAction): Promise<void>
  }
}
```

- [ ] **Step 4: Wire executor into service**

Add:

```ts
runSyncPass(bindingId?: string): Promise<DriveSyncSnapshotDto>
resolveConflict(input: DriveSyncConflictResolutionInput): Promise<DriveSyncSnapshotDto>
```

- [ ] **Step 5: Run executor and service tests**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-executor.test.ts electron/services/__tests__/drive-sync-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/drive-sync-executor.ts desktop/electron/services/__tests__/drive-sync-executor.test.ts desktop/electron/services/drive-sync-service.ts desktop/electron/services/__tests__/drive-sync-service.test.ts
git commit -m "feat: execute drive sync operations"
```

---

## Task 9: Remote Change Poller

**Files:**
- Create: `desktop/electron/services/drive-sync-remote-poller.ts`
- Test: `desktop/electron/services/__tests__/drive-sync-remote-poller.test.ts`
- Modify: `desktop/electron/services/account-service.ts`
- Test: `desktop/electron/services/__tests__/account-service.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:

- Fetches `/api/drive/changes?cursor=&limit=`.
- Advances binding cursor after successful page.
- Does not advance cursor when planning/execution fails.
- Handles pagination until `hasMore` false.
- Marks binding error when `resyncRequired` is true.
- Duplicate changes are idempotent.
- Cursor loss or server cursor expiration marks the binding for rescan instead of replaying from zero unsafely.
- Folder subtree changes preserve sequence order and process parent changes before children when possible.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-remote-poller.test.ts
```

Expected: FAIL because poller does not exist.

- [ ] **Step 3: Add AccountService method**

Add:

```ts
async listDriveChanges(input: DriveChangeListInput): Promise<DriveChangeListPageDto>
```

It calls `/drive/changes` with cursor and limit.

- [ ] **Step 4: Implement poller**

Export:

```ts
export function createDriveSyncRemotePoller(deps: {
  readonly accountService: Pick<AccountService, "listDriveChanges" | "listDriveItemTree">
  readonly runSyncPass: (bindingId: string) => Promise<void>
  readonly updateBindingCursor: (bindingId: string, cursor: string | null) => Promise<void>
  readonly markBindingError: (bindingId: string, message: string) => Promise<void>
}) {
  return {
    pollBinding(binding: DriveSyncBindingEntryV1): Promise<void>
    pollAll(bindings: readonly DriveSyncBindingEntryV1[]): Promise<void>
  }
}
```

- [ ] **Step 5: Run tests and confirm GREEN**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-remote-poller.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/account-service.ts desktop/electron/services/drive-sync-remote-poller.ts desktop/electron/services/__tests__/drive-sync-remote-poller.test.ts
git commit -m "feat: poll drive changes for sync"
```

---

## Task 10: Local Watcher And Restart Catch-Up

**Files:**
- Create: `desktop/electron/services/drive-sync-watcher.ts`
- Test: `desktop/electron/services/__tests__/drive-sync-watcher.test.ts`
- Modify: `desktop/electron/services/drive-sync-service.ts`
- Test: `desktop/electron/services/__tests__/drive-sync-service.test.ts`

- [ ] **Step 1: Write failing watcher tests**

Cover:

- Starts watcher for active folder bindings.
- Does not watch paused/conflict/error/removed bindings.
- Debounces bursts into one sync pass.
- Batches create/modify/delete/rename/move events that arrive within the debounce window.
- Ignores paths excluded by rules.
- Ignores self writes registered by executor.
- Stops old watcher when binding is removed.
- Startup scan detects changes made while app was closed.

- [ ] **Step 2: Run watcher tests and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-watcher.test.ts
```

Expected: FAIL because watcher does not exist.

- [ ] **Step 3: Implement watcher**

Use Node `fs.watch` recursively where supported. For unsupported recursive watching, use scan-on-interval only for active bindings and keep tests dependency-free by injecting a watcher factory.

Export:

```ts
export function createDriveSyncWatcher(deps: {
  readonly listActiveBindings: () => Promise<readonly DriveSyncBindingEntryV1[]>
  readonly runSyncPass: (bindingId: string) => Promise<void>
  readonly isExcluded: (binding: DriveSyncBindingEntryV1, relativePath: string) => boolean
  readonly watch?: typeof import("node:fs").watch
  readonly debounceMs?: number
}) {
  return {
    start(): Promise<void>
    stop(): Promise<void>
    refresh(): Promise<void>
    ignoreSelfWrite(bindingId: string, relativePath: string, fn: () => Promise<void>): Promise<void>
  }
}
```

- [ ] **Step 4: Wire watcher into service lifecycle**

`DriveSyncService` starts watcher on creation only after DataRepository is available, refreshes when binding status changes, and exposes `rescanBinding`.

- [ ] **Step 5: Run tests and confirm GREEN**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-watcher.test.ts electron/services/__tests__/drive-sync-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/drive-sync-watcher.ts desktop/electron/services/__tests__/drive-sync-watcher.test.ts desktop/electron/services/drive-sync-service.ts desktop/electron/services/__tests__/drive-sync-service.test.ts
git commit -m "feat: watch local drive sync folders"
```

---

## Task 11: IPC, Preload, And Bridge

**Files:**
- Modify: `desktop/electron/modules/drive-sync/ipc.ts`
- Modify: `desktop/electron/modules/drive-sync/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/__tests__/preload.test.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`

- [ ] **Step 1: Write failing IPC tests**

Cover methods:

- `previewBinding`
- `chooseLocalPath`
- `createSafeBinding`
- `pauseBinding`
- `resumeBinding`
- `updateExcludeRules`
- `rescanBinding`
- `retryBinding`
- `resolveConflict`
- `openLocalPath`

- [ ] **Step 2: Run IPC tests and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/modules/drive-sync/__tests__/ipc.test.ts electron/__tests__/preload.test.ts
```

Expected: FAIL because methods and channels do not exist.

- [ ] **Step 3: Implement IPC handlers**

Rules:

- `chooseLocalPath` uses Electron dialog and returns `string | null`.
- `openLocalPath` goes through guarded shell/open path behavior and permission/audit conventions already used by shell IPC where possible.
- All request schemas use zod.
- All responses avoid raw storage keys or auth data.

- [ ] **Step 4: Update preload and bridge types**

Add matching methods under `window.synapse.driveSync`.

- [ ] **Step 5: Regenerate IPC channels**

Run:

```bash
corepack pnpm --filter @synapse/desktop run generate:ipc
```

If this script does not exist, run:

```bash
corepack pnpm --filter @synapse/desktop exec node scripts/build/generate-ipc.mjs
```

- [ ] **Step 6: Run IPC tests and confirm GREEN**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/modules/drive-sync/__tests__/ipc.test.ts electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/modules/drive-sync/ipc.ts desktop/electron/modules/drive-sync/__tests__/ipc.test.ts desktop/electron/preload.ts desktop/electron/__tests__/preload.test.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat: expose drive sync controls"
```

---

## Task 12: Renderer Binding Wizard And Status Details

**Files:**
- Create: `desktop/src/modules/drive/drive-sync-dialog.tsx`
- Create: `desktop/src/modules/drive/drive-sync-status.tsx`
- Create: `desktop/src/modules/drive/__tests__/drive-sync-dialog.test.tsx`
- Create: `desktop/src/modules/drive/__tests__/drive-sync-status.test.tsx`
- Modify: `desktop/src/modules/drive/index.tsx`
- Modify: `desktop/src/modules/drive/__tests__/drive-module.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

Cover:

- Row menu shows `同步到本机` for unbound Drive file/folder.
- Bound row shows status label and settings action.
- Wizard chooses local path and calls preview.
- Wizard blocks submit when preview is blocked.
- Wizard calls `createSafeBinding` when preview is ready.
- Status dialog lists bindings, operations, conflicts, and errors.
- Conflict row exposes `使用本地`, `使用云端`, `保留两份`, `稍后处理`.
- Settings dialog edits per-binding exclude rules.
- Settings dialog exposes pause, resume, remove binding, rescan, retry, and open local path actions.
- UI does not use inline styles, custom colors, or marketing copy.

- [ ] **Step 2: Run renderer tests and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run src/modules/drive/__tests__/drive-sync-dialog.test.tsx src/modules/drive/__tests__/drive-sync-status.test.tsx src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: FAIL because components and actions do not exist.

- [ ] **Step 3: Implement status helpers**

Keep labels minimal:

- `未同步`
- `同步中`
- `已同步`
- `已暂停`
- `有冲突`
- `需要处理`

Use existing `Badge`, `Button`, `Dialog`, `DropdownMenu`, `Input`, `Textarea`, `Table`, and Tailwind token classes only.

- [ ] **Step 4: Implement dialog**

Views:

- `bind`
- `details`
- `settings`
- `conflicts`

No nested cards. No explanatory paragraphs. Only necessary titles, labels, statuses, and actions.

- [ ] **Step 5: Wire Drive rows and toolbar**

Add `onSyncItem`, `onOpenSyncDetails`, and dialog state to `DriveModuleContent`.

- [ ] **Step 6: Run renderer tests and confirm GREEN**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run src/modules/drive/__tests__/drive-sync-dialog.test.tsx src/modules/drive/__tests__/drive-sync-status.test.tsx src/modules/drive/__tests__/drive-module.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/drive/drive-sync-dialog.tsx desktop/src/modules/drive/drive-sync-status.tsx desktop/src/modules/drive/__tests__/drive-sync-dialog.test.tsx desktop/src/modules/drive/__tests__/drive-sync-status.test.tsx desktop/src/modules/drive/index.tsx desktop/src/modules/drive/__tests__/drive-module.test.tsx
git commit -m "feat: add drive sync UI"
```

---

## Task 13: Conflict Resolution End To End

**Files:**
- Modify: `desktop/electron/services/drive-sync-executor.ts`
- Modify: `desktop/electron/services/drive-sync-service.ts`
- Modify: `desktop/electron/services/__tests__/drive-sync-executor.test.ts`
- Modify: `desktop/electron/services/__tests__/drive-sync-service.test.ts`
- Modify: `desktop/src/modules/drive/drive-sync-dialog.tsx`
- Modify: `desktop/src/modules/drive/__tests__/drive-sync-dialog.test.tsx`

- [ ] **Step 1: Write failing end-to-end conflict tests**

Cover:

- `keep_local` uploads local current content and updates baseline.
- `keep_remote` downloads remote current content and updates baseline.
- `keep_both` writes a conflict copy and preserves both files.
- `confirm_delete` propagates delete only after explicit action.
- `skip` marks the conflict as `ignored` and leaves both local and remote content unchanged.
- Resolving last open conflict resumes binding from `conflict` to `active`.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-executor.test.ts electron/services/__tests__/drive-sync-service.test.ts src/modules/drive/__tests__/drive-sync-dialog.test.tsx
```

Expected: FAIL for missing resolution behavior.

- [ ] **Step 3: Implement resolution behavior**

Rules:

- Never log file content.
- Conflict copy names use `filename (Synapse conflict YYYYMMDD-HHMMSS).ext`.
- Writes stay inside binding root.
- After resolution, close conflict, update baseline, and emit snapshot.

- [ ] **Step 4: Run tests and confirm GREEN**

Run:

```bash
corepack pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/drive-sync-executor.test.ts electron/services/__tests__/drive-sync-service.test.ts src/modules/drive/__tests__/drive-sync-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/drive-sync-executor.ts desktop/electron/services/drive-sync-service.ts desktop/electron/services/__tests__/drive-sync-executor.test.ts desktop/electron/services/__tests__/drive-sync-service.test.ts desktop/src/modules/drive/drive-sync-dialog.tsx desktop/src/modules/drive/__tests__/drive-sync-dialog.test.tsx
git commit -m "feat: resolve drive sync conflicts"
```

---

## Task 14: Release Notes And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update release notes**

Add a user-facing note:

```md
- 云盘支持把自己的文件或文件夹同步到本机，包含安全绑定、自动同步、冲突提示、排除规则和本地状态管理；`.git/` 会强制排除，避免把 Git 仓库元数据传到云盘。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
corepack pnpm --filter @synapse/shared test -- drive.test.ts
corepack pnpm --filter @synapse/server exec vitest run src/drive/drive-change-log.spec.ts src/drive/drive.controller.spec.ts src/drive/drive.service.spec.ts src/drive/drive-lifecycle.service.spec.ts
corepack pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/schemas.test.ts electron/services/__tests__/drive-sync-paths.test.ts electron/services/__tests__/drive-sync-excludes.test.ts electron/services/__tests__/drive-sync-local-snapshot.test.ts electron/services/__tests__/drive-sync-binding-validator.test.ts electron/services/__tests__/drive-sync-baseline.test.ts electron/services/__tests__/drive-sync-planner.test.ts electron/services/__tests__/drive-sync-executor.test.ts electron/services/__tests__/drive-sync-watcher.test.ts electron/services/__tests__/drive-sync-remote-poller.test.ts electron/services/__tests__/drive-sync-service.test.ts electron/modules/drive-sync/__tests__/ipc.test.ts electron/__tests__/preload.test.ts electron/bootstrap/__tests__/registry.test.ts src/modules/drive/__tests__/drive-sync-dialog.test.tsx src/modules/drive/__tests__/drive-sync-status.test.tsx src/modules/drive/__tests__/drive-module.test.tsx
```

The focused test run must include cases for:

- Initial binding matrix: remote file to missing local file, local file to new remote target, both files existing, remote folder to missing or empty local folder, remote folder to non-empty local folder, local folder to new remote target, path missing, permission denied, and disk unwritable.
- Bidirectional sync matrix: create, content update, delete, restore, rename, and move in both directions.
- Git repository behavior: binding a repository root excludes `.git/`, syncs ordinary worktree files, and never invokes Git.
- Conflict matrix: modify/modify, delete/modify, rename/modify, folder/file type mismatch, and case-insensitive path collision.
- Failure recovery: operation error, retry, app restart state restoration, and startup scan catch-up.
- Cursor behavior: pagination, duplicate pull idempotency, cursor loss, cursor expiration, `resyncRequired`, and folder subtree event ordering.
- Renderer behavior: status entry, binding wizard, conflict list, per-binding exclude management, pause/resume/remove, retry, and rescan.

- [ ] **Step 3: Run typechecks**

Run:

```bash
corepack pnpm --filter @synapse/server run typecheck
corepack pnpm --filter @synapse/desktop run typecheck
```

- [ ] **Step 4: Run packaged boundary check if Electron package files changed**

If `desktop/package.json`, worker runtime files, native binaries, or Electron package resource boundaries changed, run:

```bash
corepack pnpm --filter @synapse/desktop run check:packaged-asar
```

Expected: PASS. If package boundaries did not change, document that this check was not required.

- [ ] **Step 5: Review git diff**

Run:

```bash
git status --short
git diff --stat
```

Confirm only Drive sync, release notes, and generated IPC files changed.

- [ ] **Step 6: Commit final notes**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: update drive sync release notes"
```

---

## Execution Notes

- Use TDD for every task: write failing tests, run them, implement, run them green.
- Do not push.
- Do not start the dev server unless a UI verification step explicitly needs a running app.
- Do not add dependencies.
- Do not use custom UI colors, inline styles, nested cards, marketing copy, or decorative emoji.
- Do not run Git commands from Drive sync code.
- Always exclude `.git/`.
- Prefer safe conflict over guessed overwrite.
- Keep commits at task boundaries so a failing large phase can be isolated.

## Plan Self-Review

- Spec coverage: This plan covers binding, file sync, folder sync, watcher, remote cursor, operations, conflicts, excludes, UI, release notes, and verification.
- User checklist coverage: The plan explicitly covers the 8 requested groups: binding constraints, local watcher, remote cursor loop, transfer executor, conflict handling, exclude rules, UI completion, and automation test matrices.
- Scope: The plan is intentionally large because the requested execution target is the whole remaining Drive local sync feature.
- Known hard part: remote folder download reuses existing folder zip download; implement a local extraction helper without adding dependencies and test path traversal protection before writing files into the binding root.
- Known hard part: remote item identity after local upload is resolved by querying the parent Drive tree by parent/name after upload completion, then writing baseline from the returned Drive item metadata.
- Safety: destructive local deletes use the injected `trashItem` dependency backed by Electron `shell.trashItem`; permanent deletes are not used for sync propagation.
- No placeholders: Every task has concrete files, tests, commands, and behavior.
