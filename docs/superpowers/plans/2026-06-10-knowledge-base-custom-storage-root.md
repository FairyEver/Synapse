# Knowledge Base Custom Storage Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global custom storage root for Synapse-managed Knowledge Bases with transactional migration, blocking UI, recovery, diagnostics, and tests.

**Architecture:** The Electron main process owns storage-root resolution, migration locking, journaling, cancellation, recovery, and audit. Renderer-visible projects keep `synapse-kb://<runtimeId>` while the app shell renders a global blocking migration dialog from main-process migration state. Existing Knowledge Base service APIs are guarded by the storage gate so custom-root unavailability or migration prevents writes and sessions from forking data.

**Tech Stack:** Electron, TypeScript, React, Radix/shadcn UI, Tailwind token classes, Vitest, pnpm workspace scripts.

---

## File Structure

- Modify `desktop/src/types/config.ts`
  - Add `SynapseKnowledgeBaseStorageConfig` and `knowledgeBaseStorage` under `SynapseGlobalConfig`.
- Modify `desktop/src/constants/defaults.ts`
  - Add default `{ mode: "default" }` storage config.
- Modify `desktop/src/lib/config.ts`
  - Sanitize persisted custom storage config.
- Modify `desktop/src/types/knowledge-base.ts`
  - Add storage status, migration state, migration payload, and recheck result types.
- Modify `desktop/electron/services/knowledge-base/managed-path.ts`
  - Resolve runtime paths from a `KnowledgeBaseStorageConfig`, not only `userData`.
- Create `desktop/electron/services/knowledge-base/storage-root.ts`
  - Central resolver, validation helpers, and status checks.
- Create `desktop/electron/services/knowledge-base/storage-migration-service.ts`
  - Migration lock, journal, cancellation, copy, verification, config switch, trash cleanup, recovery, and subscriptions.
- Modify `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
  - Inject storage resolver/gate; block operations during migration and unavailable custom roots.
- Modify `desktop/electron/services/knowledge-base/source-manager-window-service.ts`
  - Track active windows and active mutations; close idle windows; block opening during migration.
- Modify `desktop/electron/modules/knowledge-base/ipc.ts`
  - Add storage root IPC methods/events and route raw mutations through source-manager activity tracking.
- Modify `desktop/electron/preload.ts` and `desktop/src/types/bridge.ts`
  - Expose storage status, choose root, start migration, cancel migration, recheck, and migration events.
- Modify `desktop/electron/bootstrap/descriptors.ts`
  - Register `knowledge-base.storage-migration-service`.
- Modify `desktop/electron/bootstrap/before-quit.ts` and tests
  - Check migration gate before existing pending-push flow; never force-quit during active migration.
- Modify `desktop/electron/services/agent-runtime/conversation-router.ts` or the existing project resolver call site
  - Block Knowledge Base session launch when storage gate is closed and ensure sessions resolve from current root.
- Create `desktop/src/app-shell/components/knowledge-base-storage-migration-dialog.tsx`
  - App-shell blocking dialog with progress and cancellation.
- Modify `desktop/src/App.tsx`
  - Mount migration dialog globally.
- Create `desktop/src/modules/settings/components/knowledge-base-storage-panel.tsx`
  - Settings UI for current root, change location, restore default, and recheck.
- Modify `desktop/src/modules/settings/index.tsx`
  - Render the storage panel in the projects settings category near `ProjectListEditor`.
- Modify `desktop/electron/services/diagnostics-service.ts` and renderer diagnostics tests
  - Add storage-root, runtime, and old absolute path diagnostics.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add user-facing release note.

## Task 1: Config Types And Sanitization

**Files:**
- Modify: `desktop/src/types/config.ts`
- Modify: `desktop/src/constants/defaults.ts`
- Modify: `desktop/src/lib/config.ts`
- Test: `desktop/src/lib/__tests__/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Add tests to `desktop/src/lib/__tests__/config.test.ts`:

```ts
import { createDefaultConfig, sanitizeSynapseConfig } from "../config"

describe("knowledgeBaseStorage config", () => {
  it("defaults knowledge base storage to userData mode", () => {
    expect(createDefaultConfig().global.knowledgeBaseStorage).toEqual({ mode: "default" })
  })

  it("keeps a trimmed custom knowledge base storage root", () => {
    const config = sanitizeSynapseConfig({
      global: {
        knowledgeBaseStorage: {
          mode: "custom",
          rootPath: "  /Volumes/Data/SynapseData  ",
        },
      },
    })

    expect(config.global.knowledgeBaseStorage).toEqual({
      mode: "custom",
      rootPath: "/Volumes/Data/SynapseData",
    })
  })

  it("falls back to default mode when custom root is empty", () => {
    const config = sanitizeSynapseConfig({
      global: {
        knowledgeBaseStorage: {
          mode: "custom",
          rootPath: "   ",
        },
      },
    })

    expect(config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
  })
})
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/lib/__tests__/config.test.ts
```

Expected: FAIL because `knowledgeBaseStorage` does not exist.

- [ ] **Step 3: Add config types and defaults**

In `desktop/src/types/config.ts`, add:

```ts
export type SynapseKnowledgeBaseStorageConfig =
  | { mode: "default" }
  | { mode: "custom"; rootPath: string }
```

Then extend `SynapseGlobalConfig`:

```ts
export type SynapseGlobalConfig = {
  themeMode: SynapseThemeMode
  projects: SynapseProjectConfig[]
  quickInputs: SynapseQuickInput[]
  defaultQuickInputsSeededVersion: string | null
  favorites: SynapseFavorites
  recentlyViewed: SynapseRecentlyViewed
  contentSortOrder: SynapseContentSortOrder
  variables: SynapseVariable[]
  knowledgeBaseStorage: SynapseKnowledgeBaseStorageConfig
}
```

In `desktop/src/constants/defaults.ts`, import the type and add:

```ts
export const DEFAULT_KNOWLEDGE_BASE_STORAGE = {
  mode: "default",
} as const satisfies SynapseKnowledgeBaseStorageConfig
```

Then include it in `DEFAULT_GLOBAL_CONFIG`:

```ts
knowledgeBaseStorage: DEFAULT_KNOWLEDGE_BASE_STORAGE,
```

- [ ] **Step 4: Add sanitizer**

In `desktop/src/lib/config.ts`, import `SynapseKnowledgeBaseStorageConfig`, then add:

```ts
function normalizeKnowledgeBaseStorage(value: unknown): SynapseKnowledgeBaseStorageConfig {
  if (!isRecord(value)) {
    return DEFAULT_GLOBAL_CONFIG.knowledgeBaseStorage
  }

  if (value.mode === "custom") {
    const rootPath = asTrimmedString(value.rootPath)
    return rootPath ? { mode: "custom", rootPath } : DEFAULT_GLOBAL_CONFIG.knowledgeBaseStorage
  }

  return DEFAULT_GLOBAL_CONFIG.knowledgeBaseStorage
}
```

In the function that assembles `SynapseGlobalConfig`, add:

```ts
knowledgeBaseStorage: normalizeKnowledgeBaseStorage(global.knowledgeBaseStorage),
```

Update `hasGlobalConfigFormatError` so malformed `knowledgeBaseStorage` is recoverable:

```ts
if (hasOwnKey(value, "knowledgeBaseStorage") && !isRecord(value.knowledgeBaseStorage)) {
  return true
}
```

- [ ] **Step 5: Verify config tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/lib/__tests__/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/types/config.ts desktop/src/constants/defaults.ts desktop/src/lib/config.ts desktop/src/lib/__tests__/config.test.ts
git commit -m "feat(kb): add storage root config"
```

## Task 2: Storage Resolver And Path Tests

**Files:**
- Modify: `desktop/electron/services/knowledge-base/managed-path.ts`
- Create: `desktop/electron/services/knowledge-base/storage-root.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/managed-path.test.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/storage-root.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Add to `managed-path.test.ts`:

```ts
it("resolves managed paths from a custom storage root", () => {
  const project = managedProject("kb-1")

  expect(resolveManagedKnowledgeBasePath(project, {
    userDataPath: "/Users/me/Library/Application Support/Synapse",
    storage: { mode: "custom", rootPath: "/Volumes/Data/SynapseData" },
  })).toBe("/Volumes/Data/SynapseData/knowledge-bases/kb-1")
})
```

Create `storage-root.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { resolveKnowledgeBaseStorageRoot, isPathInside } from "../storage-root"

describe("knowledge base storage root", () => {
  it("uses userData for default mode", () => {
    expect(resolveKnowledgeBaseStorageRoot({
      userDataPath: "/tmp/userData",
      storage: { mode: "default" },
    })).toBe("/tmp/userData")
  })

  it("uses the custom root for custom mode", () => {
    expect(resolveKnowledgeBaseStorageRoot({
      userDataPath: "/tmp/userData",
      storage: { mode: "custom", rootPath: "/Volumes/Data/SynapseData" },
    })).toBe("/Volumes/Data/SynapseData")
  })

  it("detects a child path", () => {
    expect(isPathInside("/tmp/root/knowledge-bases/kb-1", "/tmp/root/knowledge-bases")).toBe(true)
    expect(isPathInside("/tmp/root-other", "/tmp/root/knowledge-bases")).toBe(false)
  })
})
```

- [ ] **Step 2: Run failing resolver tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/knowledge-base/__tests__/managed-path.test.ts desktop/electron/services/knowledge-base/__tests__/storage-root.test.ts
```

Expected: FAIL because `storage-root.ts` and the new resolver signature do not exist.

- [ ] **Step 3: Implement storage-root helpers**

Create `desktop/electron/services/knowledge-base/storage-root.ts`:

```ts
import path from "node:path"
import type { SynapseKnowledgeBaseStorageConfig } from "../../../src/types/config"

export type KnowledgeBaseStorageRootInput = {
  userDataPath: string
  storage: SynapseKnowledgeBaseStorageConfig
}

export function resolveKnowledgeBaseStorageRoot(input: KnowledgeBaseStorageRootInput): string {
  return input.storage.mode === "custom"
    ? path.resolve(input.storage.rootPath)
    : input.userDataPath
}

export function resolveKnowledgeBasesDirectory(input: KnowledgeBaseStorageRootInput): string {
  return path.join(resolveKnowledgeBaseStorageRoot(input), "knowledge-bases")
}

export function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath))
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}
```

- [ ] **Step 4: Update managed path resolver**

Change `resolveManagedKnowledgeBasePath` in `managed-path.ts` to accept either the legacy string or the new object:

```ts
type ManagedPathResolveOptions =
  | string
  | {
      userDataPath?: string
      storage?: SynapseKnowledgeBaseStorageConfig
    }

function normalizeManagedPathResolveOptions(options?: ManagedPathResolveOptions): {
  userDataPath: string
  storage: SynapseKnowledgeBaseStorageConfig
} {
  if (typeof options === "string") {
    return { userDataPath: options, storage: { mode: "default" } }
  }

  const userDataPath = options?.userDataPath ?? defaultKnowledgeBaseUserDataPath()
  return {
    userDataPath,
    storage: options?.storage ?? { mode: "default" },
  }
}
```

Then use `resolveKnowledgeBasesDirectory`:

```ts
const options = normalizeManagedPathResolveOptions(resolveOptions)
return path.join(resolveKnowledgeBasesDirectory(options), runtimeId)
```

- [ ] **Step 5: Verify resolver tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/knowledge-base/__tests__/managed-path.test.ts desktop/electron/services/knowledge-base/__tests__/storage-root.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/knowledge-base/managed-path.ts desktop/electron/services/knowledge-base/storage-root.ts desktop/electron/services/knowledge-base/__tests__/managed-path.test.ts desktop/electron/services/knowledge-base/__tests__/storage-root.test.ts
git commit -m "feat(kb): resolve managed paths from storage root"
```

## Task 3: Storage Gate In KnowledgeBaseService

**Files:**
- Modify: `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Add tests:

```ts
it("creates managed runtimes under the configured custom storage root", async () => {
  const { service, templateRoot, userDataPath, tmpDir } = await managedFixture()
  const customRoot = path.join(tmpDir, "external-root")
  const customService = new KnowledgeBaseService({
    managedTemplateRoot: templateRoot,
    userDataPath,
    loadConfig: async () => configWithStorage({ mode: "custom", rootPath: customRoot }),
  })

  const result = await customService.createManaged({ projectId: "kb-1", name: "Knowledge" })

  expect(result.runtimePath).toBe(path.join(customRoot, "knowledge-bases", "kb-1"))
  await expect(pathExists(path.join(customRoot, "knowledge-bases", "kb-1", "CLAUDE.md"))).resolves.toBe(true)
})

it("blocks managed operations when custom storage root is unavailable", async () => {
  const missingRoot = path.join(userDataPath, "missing-disk")
  const service = new KnowledgeBaseService({
    managedTemplateRoot: templateRoot,
    userDataPath,
    loadConfig: async () => configWithStorage({ mode: "custom", rootPath: missingRoot }),
  })

  await expect(service.createManaged({ projectId: "kb-1", name: "Knowledge" }))
    .rejects.toThrow("知识库存储位置不可用。")
})
```

Add helper in the test file:

```ts
function configWithStorage(storage: SynapseKnowledgeBaseStorageConfig): SynapseConfig {
  return {
    activeRepoUuid: null,
    repositories: [],
    global: {
      ...DEFAULT_GLOBAL_CONFIG,
      knowledgeBaseStorage: storage,
    },
    agent: DEFAULT_AGENT_GLOBAL_CONFIG,
  }
}
```

- [ ] **Step 2: Run failing service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: FAIL because service still uses constructor `userDataPath` only.

- [ ] **Step 3: Add storage config resolution to service**

In `KnowledgeBaseService`, add:

```ts
private async resolveStorageOptions(): Promise<{
  userDataPath: string
  storage: SynapseKnowledgeBaseStorageConfig
}> {
  const config = await this.loadConfig()
  return {
    userDataPath: this.userDataPath,
    storage: config.global.knowledgeBaseStorage,
  }
}
```

In `createManagedUnlocked`, replace:

```ts
const runtimePath = resolveManagedKnowledgeBasePath(project, this.userDataPath)
```

with:

```ts
const runtimePath = resolveManagedKnowledgeBasePath(project, await this.resolveStorageOptions())
```

In `resolveRuntimePath` and `resolveProjectPath`, use the same `await this.resolveStorageOptions()` object.

- [ ] **Step 4: Add custom-root availability check**

Add a helper near service private methods:

```ts
private async assertStorageAvailable(): Promise<void> {
  const { storage } = await this.resolveStorageOptions()
  if (storage.mode !== "custom") return
  try {
    await access(storage.rootPath, constants.R_OK | constants.W_OK)
  } catch (error) {
    logger.warn("Knowledge Base custom storage root is unavailable.", {
      rootPath: storage.rootPath,
      ...knowledgeBaseErrorMeta(error),
    })
    throw new Error("知识库存储位置不可用。")
  }
}
```

Call `await this.assertStorageAvailable()` at the start of public methods that read or write managed runtime data:

```ts
createManaged
deleteManaged
listSources
addUrlSource
listRawDirectory
createRawFolder
uploadRawFiles
uploadRawItems
exportRawEntries
renameRawEntry
moveRawEntries
trashRawEntries
```

- [ ] **Step 5: Verify service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/knowledge-base/knowledge-base-service.ts desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
git commit -m "feat(kb): use configured storage root"
```

## Task 4: Migration Service Core

**Files:**
- Create: `desktop/electron/services/knowledge-base/storage-migration-service.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/storage-migration-service.test.ts`

- [ ] **Step 1: Write failing migration service tests**

Create `storage-migration-service.test.ts` with cases:

```ts
describe("KnowledgeBaseStorageMigrationService", () => {
  it("copies all runtimes, switches config, and trashes the old directory", async () => {
    const harness = await migrationHarness()
    await harness.seedRuntime("kb-1")

    const result = await harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })

    expect(result.status).toBe("completed")
    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "custom", rootPath: harness.newRoot })
    await expect(pathExists(path.join(harness.newRoot, "knowledge-bases", "kb-1", "CLAUDE.md"))).resolves.toBe(true)
    expect(harness.trashed).toEqual([path.join(harness.oldRoot, "knowledge-bases")])
  })

  it("keeps old config and old data when verification fails", async () => {
    const harness = await migrationHarness({ failVerify: true })
    await harness.seedRuntime("kb-1")

    await expect(harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })).rejects.toThrow("知识库存储迁移校验失败。")

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
    await expect(pathExists(path.join(harness.oldRoot, "knowledge-bases", "kb-1", "CLAUDE.md"))).resolves.toBe(true)
  })

  it("keeps new config when trashing the old directory fails", async () => {
    const harness = await migrationHarness({ trashError: new Error("trash unavailable") })
    await harness.seedRuntime("kb-1")

    const result = await harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })

    expect(result.status).toBe("completed-with-warning")
    expect(result.warningCode).toBe("old-copy-not-trashed")
    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "custom", rootPath: harness.newRoot })
  })
})
```

- [ ] **Step 2: Run failing migration tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/knowledge-base/__tests__/storage-migration-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Define migration types and service skeleton**

In `storage-migration-service.ts`, add:

```ts
export type KnowledgeBaseStorageMigrationPhase =
  | "idle"
  | "preparing"
  | "copying"
  | "verifying"
  | "switching"
  | "cleaning"
  | "completed"
  | "completed-with-warning"
  | "failed"
  | "cancelled"
  | "recovering"

export type KnowledgeBaseStorageMigrationState = {
  active: boolean
  phase: KnowledgeBaseStorageMigrationPhase
  cancellable: boolean
  progress: { copiedBytes: number; totalBytes: number | null }
  message: string
  warningCode?: "free-space-unknown" | "old-copy-not-trashed"
  errorMessage?: string
}

export type KnowledgeBaseStorageMigrationTarget =
  | { mode: "default" }
  | { mode: "custom"; rootPath: string }

export type KnowledgeBaseStorageMigrationResult =
  | { status: "completed" }
  | { status: "completed-with-warning"; warningCode: "old-copy-not-trashed" }
  | { status: "cancelled" }
```

Create `KnowledgeBaseStorageMigrationService` with constructor deps:

```ts
type Deps = {
  userDataPath: string
  loadConfig: () => Promise<SynapseConfig>
  updateConfig: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
  trashItem: (targetPath: string) => Promise<void>
  journalPath: string
  sourceManager: {
    hasActiveMutation: () => boolean
    closeIdleWindows: () => void
    setMigrationBlocked: (blocked: boolean) => void
  }
  hasActiveKnowledgeBaseSession: () => Promise<boolean>
}
```

- [ ] **Step 4: Implement validation, copy, verify, switch, and trash**

Implement these private methods in the service:

```ts
private async validateTarget(target: KnowledgeBaseStorageMigrationTarget): Promise<ResolvedTarget>
private async writeJournal(journal: MigrationJournal): Promise<void>
private async clearJournal(): Promise<void>
private async copyTree(source: string, target: string): Promise<void>
private async verifyTree(source: string, target: string, projectIds: readonly string[]): Promise<void>
private emitState(patch: Partial<KnowledgeBaseStorageMigrationState>): void
```

Required validation behavior:

```ts
if (this.activeState.active) throw new Error("知识库存储迁移正在进行。")
if (await deps.hasActiveKnowledgeBaseSession()) throw new Error("请先停止正在运行的知识库会话。")
if (deps.sourceManager.hasActiveMutation()) throw new Error("资料操作仍在进行。")
```

Use `fs.promises.cp(source, target, { recursive: true, force: false, errorOnExist: true })` for the first implementation. If byte-level progress is not available from `cp`, set `totalBytes` before copy and update phase-level progress; add byte-progress refinement in Task 5.

- [ ] **Step 5: Verify migration service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/knowledge-base/__tests__/storage-migration-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/knowledge-base/storage-migration-service.ts desktop/electron/services/knowledge-base/__tests__/storage-migration-service.test.ts
git commit -m "feat(kb): add storage migration service"
```

## Task 5: Cancellation, Journal Recovery, And Space Validation

**Files:**
- Modify: `desktop/electron/services/knowledge-base/storage-migration-service.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/storage-migration-service.test.ts`

- [ ] **Step 1: Add failing cancellation and recovery tests**

Add tests:

```ts
it("cancels during copy and keeps the old config", async () => {
  const harness = await migrationHarness({ pauseAfterFirstCopy: true })
  await harness.seedRuntime("kb-1")
  const migration = harness.service.startMigration({
    target: { mode: "custom", rootPath: harness.newRoot },
    requestedBy: "test",
  })

  await harness.waitForPhase("copying")
  await harness.service.cancelMigration()

  await expect(migration).resolves.toEqual({ status: "cancelled" })
  expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
})

it("does not cancel after switching begins", async () => {
  const harness = await migrationHarness({ pauseAtSwitching: true })
  await harness.seedRuntime("kb-1")
  const migration = harness.service.startMigration({
    target: { mode: "custom", rootPath: harness.newRoot },
    requestedBy: "test",
  })

  await harness.waitForPhase("switching")
  await expect(harness.service.cancelMigration()).rejects.toThrow("当前阶段不能取消。")
  harness.resume()
  await expect(migration).resolves.toMatchObject({ status: "completed" })
})

it("recovers an interrupted pre-switch journal to the old root", async () => {
  const harness = await migrationHarness()
  await harness.writeJournal({ phase: "copying", switchStarted: false, newRootVerified: false })

  await harness.service.recoverIfNeeded()

  expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
})

it("keeps a verified new root during recovery", async () => {
  const harness = await migrationHarness()
  await harness.seedRuntime("kb-1", harness.newRoot)
  await harness.writeJournal({ phase: "cleaning", switchStarted: true, newRootVerified: true })
  harness.config.global.knowledgeBaseStorage = { mode: "custom", rootPath: harness.newRoot }

  await harness.service.recoverIfNeeded()

  expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "custom", rootPath: harness.newRoot })
})
```

- [ ] **Step 2: Run failing recovery tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/knowledge-base/__tests__/storage-migration-service.test.ts
```

Expected: FAIL because cancellation and recovery APIs are incomplete.

- [ ] **Step 3: Implement cancellation**

Add state:

```ts
private cancelRequested = false
private nonCancellable = false
```

Add public method:

```ts
async cancelMigration(): Promise<void> {
  if (!this.state.active) return
  if (!this.state.cancellable || this.nonCancellable) {
    throw new Error("当前阶段不能取消。")
  }
  this.cancelRequested = true
}
```

Check cancellation between copy entries and before verification:

```ts
private assertNotCancelled(): void {
  if (this.cancelRequested) {
    throw new MigrationCancelledError()
  }
}
```

Catch `MigrationCancelledError`, cleanup temp, emit `cancelled`, return `{ status: "cancelled" }`.

- [ ] **Step 4: Implement journal recovery**

Use a JSON journal shaped as:

```ts
type MigrationJournal = {
  version: 1
  oldStorage: SynapseKnowledgeBaseStorageConfig
  targetStorage: SynapseKnowledgeBaseStorageConfig
  oldRoot: string
  newRoot: string
  tempPath: string
  phase: KnowledgeBaseStorageMigrationPhase
  switchStarted: boolean
  newRootVerified: boolean
  startedAt: string
}
```

Implement:

```ts
async recoverIfNeeded(): Promise<void> {
  const journal = await this.readJournal()
  if (!journal) return
  this.emitState({ active: true, phase: "recovering", cancellable: false, message: "正在恢复知识库存储迁移" })
  if (!journal.switchStarted) {
    await this.updateConfig({ global: { knowledgeBaseStorage: journal.oldStorage } })
    await rm(journal.tempPath, { recursive: true, force: true })
    await this.clearJournal()
    this.emitState({ active: false, phase: "completed", cancellable: false, message: "知识库存储已恢复" })
    return
  }
  if (journal.newRootVerified || await this.verifyConfiguredRoot(journal.targetStorage)) {
    await this.updateConfig({ global: { knowledgeBaseStorage: journal.targetStorage } })
    await this.clearJournal()
    this.emitState({ active: false, phase: "completed", cancellable: false, message: "知识库存储已恢复" })
    return
  }
  await this.updateConfig({ global: { knowledgeBaseStorage: journal.oldStorage } })
  await this.clearJournal()
  this.emitState({ active: false, phase: "failed", cancellable: false, message: "知识库存储恢复失败", errorMessage: "已恢复旧位置。" })
}
```

- [ ] **Step 5: Implement space validation**

Add injected optional dep:

```ts
getAvailableBytes?: (targetRoot: string) => Promise<number | null>
```

Add validation:

```ts
const totalBytes = await this.measureTreeBytes(oldKnowledgeBasesDir)
const availableBytes = await this.getAvailableBytes(newRoot).catch(() => null)
const requiredBytes = totalBytes + Math.max(Math.ceil(totalBytes * 0.1), 1_073_741_824)
if (availableBytes !== null && availableBytes < requiredBytes) {
  throw new Error("目标位置空间不足。")
}
if (availableBytes === null) {
  this.emitState({ warningCode: "free-space-unknown", message: "无法确认目标位置剩余空间。" })
}
```

- [ ] **Step 6: Verify tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/knowledge-base/__tests__/storage-migration-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/knowledge-base/storage-migration-service.ts desktop/electron/services/knowledge-base/__tests__/storage-migration-service.test.ts
git commit -m "feat(kb): recover storage migration"
```

## Task 6: IPC, Preload, And Bridge Types

**Files:**
- Modify: `desktop/src/types/knowledge-base.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/modules/knowledge-base/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Test: `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`
- Test: `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Add failing IPC tests**

In `ipc.test.ts`, add:

```ts
it("starts storage migration through a guarded write operation", async () => {
  const { call, permissionGuard, auditEvents, migrationService } = createHarness()
  permissionGuard.check.mockResolvedValue({ allowed: true })
  migrationService.startMigration.mockResolvedValue({ status: "completed" })

  await call("startStorageMigration", { target: { mode: "custom", rootPath: "/Volumes/Data/SynapseData" } })

  expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
    action: "fs.write.outside-userdata",
    resource: "/Volumes/Data/SynapseData",
  }))
  expect(auditEvents).toContainEqual(expect.objectContaining({
    action: "fs.write.outside-userdata",
    outcome: "allowed",
  }))
})

it("returns current storage status", async () => {
  const { call, migrationService } = createHarness()
  migrationService.getStorageStatus.mockResolvedValue({
    mode: "default",
    rootPath: "/tmp/userData",
    knowledgeBasesPath: "/tmp/userData/knowledge-bases",
    available: true,
  })

  await expect(call("getStorageStatus", undefined)).resolves.toMatchObject({
    mode: "default",
    available: true,
  })
})
```

- [ ] **Step 2: Run failing IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts
```

Expected: FAIL because channels do not exist.

- [ ] **Step 3: Add shared types**

In `desktop/src/types/knowledge-base.ts`, add:

```ts
export type SynapseKnowledgeBaseStorageStatus = {
  mode: "default" | "custom"
  rootPath: string
  knowledgeBasesPath: string
  available: boolean
  unavailableReason?: string
  oldAbsoluteReferenceCount?: number
}

export type SynapseKnowledgeBaseStorageMigrationPayload = {
  target: { mode: "default" } | { mode: "custom"; rootPath: string }
}

export type SynapseKnowledgeBaseStorageMigrationProgress = {
  active: boolean
  phase: "idle" | "preparing" | "copying" | "verifying" | "switching" | "cleaning" | "completed" | "completed-with-warning" | "failed" | "cancelled" | "recovering"
  cancellable: boolean
  copiedBytes: number
  totalBytes: number | null
  message: string
  warningCode?: "free-space-unknown" | "old-copy-not-trashed"
  errorMessage?: string
}
```

- [ ] **Step 4: Add IPC methods**

In `knowledge-base/ipc.ts`, define schemas:

```ts
const storageTargetSchema = z.union([
  z.object({ mode: z.literal("default") }),
  z.object({ mode: z.literal("custom"), rootPath: z.string().min(1) }),
])

const storageMigrationPayloadSchema = z.object({ target: storageTargetSchema })
```

Add methods:

```ts
getStorageStatus: {
  kind: "invoke",
  channel: "synapse:knowledge-base:get-storage-status",
  request: z.void(),
  response: storageStatusSchema,
  handler: (ctx) => migrationService(ctx).getStorageStatus(),
},
startStorageMigration: {
  kind: "invoke",
  channel: "synapse:knowledge-base:start-storage-migration",
  request: storageMigrationPayloadSchema,
  response: storageMigrationResultSchema,
  handler: (ctx, request) => runGuardedKnowledgeBaseOperation({
    ctx,
    action: request.target.mode === "custom" ? "fs.write.outside-userdata" : "fs.write",
    resource: request.target.mode === "custom" ? request.target.rootPath : "managed-knowledge-base:default-storage",
    source: "knowledgeBase.startStorageMigration",
    run: () => migrationService(ctx).startMigration({ target: request.target, requestedBy: "settings" }),
  }),
},
cancelStorageMigration: {
  kind: "invoke",
  channel: "synapse:knowledge-base:cancel-storage-migration",
  request: z.void(),
  response: z.void(),
  handler: (ctx) => migrationService(ctx).cancelMigration(),
},
recheckStorage: {
  kind: "invoke",
  channel: "synapse:knowledge-base:recheck-storage",
  request: z.void(),
  response: storageStatusSchema,
  handler: (ctx) => migrationService(ctx).getStorageStatus(),
},
```

Add event:

```ts
events: {
  storageMigrationChanged: {
    channel: "synapse:knowledge-base:storage-migration-changed",
    payload: storageMigrationProgressSchema,
  },
}
```

- [ ] **Step 5: Update bridge and preload**

In `bridge.ts`, add to `knowledgeBase`:

```ts
getStorageStatus: () => Promise<SynapseKnowledgeBaseStorageStatus>
startStorageMigration: (payload: SynapseKnowledgeBaseStorageMigrationPayload) => Promise<KnowledgeBaseStorageMigrationResult>
cancelStorageMigration: () => Promise<void>
recheckStorage: () => Promise<SynapseKnowledgeBaseStorageStatus>
onStorageMigrationChanged: (listener: (payload: SynapseKnowledgeBaseStorageMigrationProgress) => void) => () => void
```

In `preload.ts`, wire methods with `invoke` and `createDomainEventPayloadSubscription`.

- [ ] **Step 6: Verify IPC and preload tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/types/knowledge-base.ts desktop/src/types/bridge.ts desktop/electron/modules/knowledge-base/ipc.ts desktop/electron/preload.ts desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts
git commit -m "feat(kb): expose storage migration bridge"
```

## Task 7: Main-Process Integration And Quit Gate

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/before-quit.ts`
- Modify: `desktop/electron/services/knowledge-base/source-manager-window-service.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Test: `desktop/electron/bootstrap/__tests__/before-quit.test.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/source-manager-window-service.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`

- [ ] **Step 1: Add failing integration tests**

In `before-quit.test.ts`, add:

```ts
it("blocks before-quit while knowledge base storage migration is active", async () => {
  const deps = createBeforeQuitHarness({
    storageMigration: { isActive: () => true, focusDialog: vi.fn() },
  })

  await deps.emitBeforeQuit()

  expect(deps.event.preventDefault).toHaveBeenCalled()
  expect(deps.storageMigration.focusDialog).toHaveBeenCalled()
  expect(deps.app.quit).not.toHaveBeenCalled()
})
```

In source-manager tests:

```ts
it("blocks opening while migration is active", async () => {
  const service = createKnowledgeBaseSourceManagerWindowService(testDeps())
  service.setMigrationBlocked(true)

  await expect(service.open({ projectId: "kb-1", projectName: "Knowledge" }))
    .rejects.toThrow("知识库存储迁移正在进行。")
})
```

- [ ] **Step 2: Run failing integration tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/bootstrap/__tests__/before-quit.test.ts desktop/electron/services/knowledge-base/__tests__/source-manager-window-service.test.ts desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Register migration service**

In `descriptors.ts`, add:

```ts
export const coreKnowledgeBaseStorageMigrationDescriptor: ServiceDescriptor<KnowledgeBaseStorageMigrationService> = {
  id: "knowledge-base.storage-migration-service",
  criticality: "degraded",
  create(ctx) {
    return new KnowledgeBaseStorageMigrationService({
      userDataPath: app.getPath("userData"),
      loadConfig: () => configStore.load(),
      updateConfig: (patch) => configStore.update(patch),
      trashItem: (targetPath) => shell.trashItem(targetPath),
      journalPath: path.join(app.getPath("userData"), "knowledge-base-storage-migration.json"),
      sourceManager: knowledgeBaseSourceManagerWindowService,
      hasActiveKnowledgeBaseSession: async () => ctx.registry.get<AgentRuntimeService>("agent-runtime.service").hasActiveKnowledgeBaseSession(),
    })
  },
}
```

Add the descriptor to the registry list in `desktop/electron/bootstrap/registry.ts`.

- [ ] **Step 4: Add source-manager tracking**

Extend `createKnowledgeBaseSourceManagerWindowService` return object:

```ts
let migrationBlocked = false
let activeMutationCount = 0

function setMigrationBlocked(blocked: boolean): void {
  migrationBlocked = blocked
}

function hasActiveMutation(): boolean {
  return activeMutationCount > 0
}

function closeIdleWindows(): void {
  if (activeMutationCount > 0) {
    throw new Error("资料操作仍在进行。")
  }
  for (const window of Array.from(sourceManagerWindows)) {
    if (!window.isDestroyed()) window.close()
  }
}

async function trackMutation<T>(run: () => Promise<T>): Promise<T> {
  activeMutationCount += 1
  try {
    return await run()
  } finally {
    activeMutationCount -= 1
  }
}
```

At the start of `open`, add:

```ts
if (migrationBlocked) {
  throw new Error("知识库存储迁移正在进行。")
}
```

Use `trackMutation` in IPC raw mutation handlers.

- [ ] **Step 5: Add quit gate**

Extend `BeforeQuitDeps`:

```ts
readonly knowledgeBaseStorageMigration?: {
  isActive: () => boolean
  focusDialog: () => void
}
```

At the top of `before-quit` handler after `event.preventDefault()`:

```ts
if (deps.knowledgeBaseStorageMigration?.isActive()) {
  deps.knowledgeBaseStorageMigration.focusDialog()
  logger.info("App quit blocked by active Knowledge Base storage migration.")
  return
}
```

Do this before `QUIT_FLOW_TIMEOUT_MS` is created.

- [ ] **Step 6: Block Agent sessions**

Add method to the runtime service or router:

```ts
hasActiveKnowledgeBaseSession(): boolean {
  return Array.from(this.states.entries()).some(([conversationId, state]) => {
    return state.busy && this.isKnowledgeBaseConversation(conversationId)
  })
}
```

At the Knowledge Base launch path, check:

```ts
if (await this.knowledgeBaseStorageGate?.isBlocked()) {
  throw new Error("知识库存储位置不可用。")
}
```

- [ ] **Step 7: Verify integration tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/bootstrap/__tests__/before-quit.test.ts desktop/electron/services/knowledge-base/__tests__/source-manager-window-service.test.ts desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/registry.ts desktop/electron/bootstrap/before-quit.ts desktop/electron/services/knowledge-base/source-manager-window-service.ts desktop/electron/modules/knowledge-base/ipc.ts desktop/electron/services/agent-runtime/conversation-router.ts desktop/electron/bootstrap/__tests__/before-quit.test.ts desktop/electron/services/knowledge-base/__tests__/source-manager-window-service.test.ts desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts
git commit -m "feat(kb): gate migration across app runtime"
```

## Task 8: Settings UI And App-Shell Blocking Dialog

**Files:**
- Create: `desktop/src/app-shell/components/knowledge-base-storage-migration-dialog.tsx`
- Create: `desktop/src/app-shell/hooks/use-knowledge-base-storage-migration.ts`
- Create: `desktop/src/modules/settings/components/knowledge-base-storage-panel.tsx`
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/src/modules/settings/index.tsx`
- Test: `desktop/src/app-shell/components/__tests__/knowledge-base-storage-migration-dialog.test.tsx`
- Test: `desktop/src/modules/settings/__tests__/knowledge-base-storage-panel.test.tsx`

- [ ] **Step 1: Add failing UI tests**

Dialog test:

```tsx
it("prevents closing while migration is active", () => {
  renderDialog({
    progress: {
      active: true,
      phase: "copying",
      cancellable: true,
      copiedBytes: 10,
      totalBytes: 100,
      message: "正在复制",
    },
  })

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
  expect(screen.getByRole("dialog")).toBeInTheDocument()
  expect(screen.getByText("Cancel migration")).toBeInTheDocument()
})

it("disables cancellation during switching", () => {
  renderDialog({
    progress: {
      active: true,
      phase: "switching",
      cancellable: false,
      copiedBytes: 100,
      totalBytes: 100,
      message: "正在切换",
    },
  })

  expect(screen.getByRole("button", { name: "正在切换" })).toBeDisabled()
})
```

Settings panel test:

```tsx
it("shows recheck only when custom storage is unavailable", async () => {
  renderPanel({
    status: {
      mode: "custom",
      rootPath: "/Volumes/Data/SynapseData",
      knowledgeBasesPath: "/Volumes/Data/SynapseData/knowledge-bases",
      available: false,
      unavailableReason: "not-found",
    },
  })

  expect(screen.getByRole("button", { name: "重新检测" })).toBeEnabled()
  expect(screen.queryByRole("button", { name: "更改位置" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "恢复默认" })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run failing UI tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/app-shell/components/__tests__/knowledge-base-storage-migration-dialog.test.tsx desktop/src/modules/settings/__tests__/knowledge-base-storage-panel.test.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 3: Add migration hook**

Create `use-knowledge-base-storage-migration.ts`:

```ts
import { useEffect, useState } from "react"
import type { SynapseKnowledgeBaseStorageMigrationProgress } from "@/types/knowledge-base"

const idleProgress: SynapseKnowledgeBaseStorageMigrationProgress = {
  active: false,
  phase: "idle",
  cancellable: false,
  copiedBytes: 0,
  totalBytes: null,
  message: "",
}

export function useKnowledgeBaseStorageMigration() {
  const [progress, setProgress] = useState(idleProgress)

  useEffect(() => {
    const bridge = window.synapse?.knowledgeBase
    if (!bridge?.onStorageMigrationChanged) return
    return bridge.onStorageMigrationChanged(setProgress)
  }, [])

  return {
    progress,
    cancel: () => window.synapse?.knowledgeBase?.cancelStorageMigration?.(),
  }
}
```

- [ ] **Step 4: Add blocking dialog**

Create dialog component:

```tsx
function KnowledgeBaseStorageMigrationDialog({ progress, onCancel }: Props) {
  const isTerminal = ["completed", "completed-with-warning", "failed", "cancelled"].includes(progress.phase)
  const progressValue = progress.totalBytes && progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.copiedBytes / progress.totalBytes) * 100))
    : undefined

  return (
    <Dialog open={progress.active || isTerminal}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>迁移知识库存储</DialogTitle>
          <DialogDescription role="status" aria-live="polite">
            {progress.message}
          </DialogDescription>
        </DialogHeader>
        <Progress value={progressValue} aria-label="迁移进度" />
        <DialogFooter>
          {isTerminal ? (
            <Button type="button" onClick={() => undefined}>关闭</Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={!progress.cancellable}
              onClick={() => void onCancel()}
            >
              {progress.cancellable ? "取消迁移" : progress.message}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: Mount dialog in App**

In `App.tsx`, inside `MainApp`, call the hook:

```tsx
const knowledgeBaseStorageMigration = useKnowledgeBaseStorageMigration()
```

Inside `AppShellLayout`, after module content:

```tsx
<KnowledgeBaseStorageMigrationDialog
  progress={knowledgeBaseStorageMigration.progress}
  onCancel={knowledgeBaseStorageMigration.cancel}
/>
```

- [ ] **Step 6: Add settings panel**

Create `knowledge-base-storage-panel.tsx` with:

```tsx
function KnowledgeBaseStoragePanel() {
  const [status, setStatus] = useState<SynapseKnowledgeBaseStorageStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    setStatus(await window.synapse.knowledgeBase.getStorageStatus())
  }, [])

  const handleChangeLocation = async () => {
    const selectedPath = await window.synapse.repository.chooseDirectory()
    if (!selectedPath) return
    await window.synapse.knowledgeBase.startStorageMigration({
      target: { mode: "custom", rootPath: selectedPath },
    })
    await loadStatus()
  }

  const handleRestoreDefault = async () => {
    await window.synapse.knowledgeBase.startStorageMigration({ target: { mode: "default" } })
    await loadStatus()
  }

  if (!status) return null

  const unavailable = status.mode === "custom" && !status.available

  return (
    <Card>
      <CardHeader>
        <CardTitle>知识库存储</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground" data-allow-select="true">
          {status.rootPath}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
      <CardFooter className="gap-2">
        {unavailable ? (
          <Button type="button" variant="outline" onClick={loadStatus}>重新检测</Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={handleChangeLocation}>更改位置</Button>
            {status.mode === "custom" ? (
              <Button type="button" variant="outline" onClick={handleRestoreDefault}>恢复默认</Button>
            ) : null}
          </>
        )}
      </CardFooter>
    </Card>
  )
}
```

Use a confirmation `AlertDialog` before calling migration; keep copy short: `将迁移所有知识库，迁移期间不能使用知识库。`

- [ ] **Step 7: Render panel in settings**

In `settings/index.tsx`, in `activeCategory === "projects"`, render:

```tsx
<KnowledgeBaseStoragePanel />
<ProjectListEditor projects={config.global.projects} onSave={handleSaveProjects} />
```

- [ ] **Step 8: Verify UI tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/app-shell/components/__tests__/knowledge-base-storage-migration-dialog.test.tsx desktop/src/modules/settings/__tests__/knowledge-base-storage-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/app-shell/components/knowledge-base-storage-migration-dialog.tsx desktop/src/app-shell/hooks/use-knowledge-base-storage-migration.ts desktop/src/modules/settings/components/knowledge-base-storage-panel.tsx desktop/src/App.tsx desktop/src/modules/settings/index.tsx desktop/src/app-shell/components/__tests__/knowledge-base-storage-migration-dialog.test.tsx desktop/src/modules/settings/__tests__/knowledge-base-storage-panel.test.tsx
git commit -m "feat(kb): add storage migration UI"
```

## Task 9: Diagnostics, Release Notes, And Final Verification

**Files:**
- Modify: `desktop/electron/services/diagnostics-service.ts`
- Modify: `desktop/electron/services/__tests__/diagnostics-service.test.ts`
- Modify: `desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add failing diagnostics tests**

In diagnostics service test:

```ts
it("reports custom knowledge base storage status", async () => {
  const diagnostics = await service.getDiagnostics()

  expect(diagnostics.knowledgeBaseStorage).toMatchObject({
    mode: "custom",
    available: true,
    rootPath: "/Volumes/Data/SynapseData",
  })
})

it("reports old absolute path references without rewriting files", async () => {
  await writeFile(path.join(runtimePath, "wiki/index.md"), "/Users/me/Library/Application Support/Synapse/knowledge-bases/kb-1/wiki/old.md")

  const diagnostics = await service.getDiagnostics()

  expect(diagnostics.knowledgeBaseStorage.oldAbsoluteReferenceCount).toBe(1)
  await expect(readFile(path.join(runtimePath, "wiki/index.md"), "utf8")).resolves.toContain("/Users/me/Library/Application Support/Synapse")
})
```

- [ ] **Step 2: Run failing diagnostics tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/diagnostics-service.test.ts desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx
```

Expected: FAIL because diagnostics lack storage fields.

- [ ] **Step 3: Implement diagnostics fields**

Add to diagnostics result type:

```ts
knowledgeBaseStorage?: {
  mode: "default" | "custom"
  rootPath?: string
  knowledgeBasesPath?: string
  available: boolean
  runtimeCount: number
  missingRuntimeCount: number
  oldAbsoluteReferenceCount: number
}
```

In `diagnostics-service.ts`, compute:

```ts
const config = await configStore.load()
const storage = config.global.knowledgeBaseStorage
const rootPath = resolveKnowledgeBaseStorageRoot({ userDataPath: app.getPath("userData"), storage })
const knowledgeBasesPath = path.join(rootPath, "knowledge-bases")
const managedProjects = config.global.projects.filter(isManagedKnowledgeBaseProject)
```

For old absolute references, scan only text files under `wiki/` and `.raw/.manifest.json`; count matches for the old default knowledge-bases path. Do not write files.

- [ ] **Step 4: Update diagnostics renderer**

In the diagnostics panel component, add compact rows:

```tsx
<DiagnosticRow label="知识库存储" value={storage.mode === "custom" ? "自定义" : "默认"} />
<DiagnosticRow label="知识库存储状态" value={storage.available ? "可用" : "不可用"} />
```

If `oldAbsoluteReferenceCount > 0`, show: `发现旧绝对路径引用。`

- [ ] **Step 5: Add release note**

Append to `RELEASE_NOTES_PENDING.md`:

```md
- 知识库现在可以迁移到自定义存储位置。迁移会校验完整性，过程中锁定界面，失败时继续使用原位置，避免数据分叉。
```

- [ ] **Step 6: Run focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/src/lib/__tests__/config.test.ts \
  desktop/electron/services/knowledge-base/__tests__/managed-path.test.ts \
  desktop/electron/services/knowledge-base/__tests__/storage-root.test.ts \
  desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts \
  desktop/electron/services/knowledge-base/__tests__/storage-migration-service.test.ts \
  desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts \
  desktop/electron/bootstrap/__tests__/before-quit.test.ts \
  desktop/src/app-shell/components/__tests__/knowledge-base-storage-migration-dialog.test.tsx \
  desktop/src/modules/settings/__tests__/knowledge-base-storage-panel.test.tsx \
  desktop/electron/services/__tests__/diagnostics-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run hard constraints and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/diagnostics-service.ts desktop/electron/services/__tests__/diagnostics-service.test.ts desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx RELEASE_NOTES_PENDING.md
git commit -m "feat(kb): diagnose storage root"
```

## Self-Review

- Spec coverage:
  - Global config and resolver: Tasks 1 and 2.
  - Custom-root create/read/write blocking: Task 3.
  - Transactional migration, trash failure, cancellation, journal recovery, space validation: Tasks 4 and 5.
  - Permission/audit and bridge exposure: Task 6.
  - Source-manager, Agent sessions, before-quit gate: Task 7.
  - Blocking app-shell modal and settings panel with impeccable/product UI constraints: Task 8.
  - Diagnostics, old absolute paths, release note, verification: Task 9.
- Red-flag scan: no task uses unresolved markers or unspecified edge handling.
- Type consistency:
  - Renderer bridge types use `SynapseKnowledgeBaseStorageMigrationPayload` and `SynapseKnowledgeBaseStorageMigrationProgress`.
  - Main service state uses `KnowledgeBaseStorageMigrationState`.
  - Config uses `SynapseKnowledgeBaseStorageConfig`.
