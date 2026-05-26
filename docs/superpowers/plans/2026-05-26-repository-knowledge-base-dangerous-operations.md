# Repository Knowledge Base Dangerous Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect repository initialization and Knowledge Base raw file operations from accidental destructive changes.

**Architecture:** Add a focused repository initialization safety helper that produces deterministic preview tokens, denies obviously dangerous paths, and moves old content into a local backup directory before scaffolding. Keep Knowledge Base operations inside the existing managed `.raw/` service boundary, add operation summaries, and require renderer confirmation for batch or directory raw moves/trashes.

**Tech Stack:** Electron main process, React renderer, TypeScript, Vitest, shadcn/Radix UI primitives.

---

## File Map

- Create `desktop/electron/services/repository-initialization-safety.ts`: pure-ish helpers for repository initialization previews, deterministic operation tokens, deny checks, and backup directory naming.
- Modify `desktop/src/types/repository.ts`: extend initialization preview/options with operation token and danger flags.
- Modify `desktop/electron/services/repository-structure-service.ts`: use the safety helper, make validation read-only, verify confirmed token, and move existing entries into a backup directory.
- Modify `desktop/electron/modules/repository/ipc.ts`: validate the new initialization option fields.
- Modify `desktop/src/modules/settings/components/repository-list-editor.tsx`: pass preview operation token on confirm.
- Modify `desktop/src/app-shell/components/empty-repository-state.tsx`: pass preview operation token on confirm and keep empty initialization working.
- Modify `desktop/electron/services/__tests__/repository-structure-service.test.ts`: cover read-only validation, token mismatch, denied paths, and backup behavior.
- Modify `desktop/electron/services/knowledge-base/knowledge-base-service.ts`: log raw mutation summaries without exposing real backing paths.
- Modify `desktop/electron/services/knowledge-base/raw-file-manager.ts`: preserve boundary checks and return precise skipped reasons for symlink/invalid paths.
- Modify `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`: cover raw mutation logging and symlink/descendant move protection.
- Modify `desktop/src/modules/knowledge-base/source-manager-window.tsx`: add confirmation for directory or multi-item raw move/trash.
- Modify `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`: cover new confirmations.
- Modify `RELEASE_NOTES_PENDING.md`: record the user-visible safety change.

---

### Task 1: Repository Initialization Types and Safety Helper

**Files:**
- Create: `desktop/electron/services/repository-initialization-safety.ts`
- Modify: `desktop/src/types/repository.ts`
- Test: `desktop/electron/services/__tests__/repository-structure-service.test.ts`

- [ ] **Step 1: Write failing tests for preview token and read-only validation**

Add these tests to `desktop/electron/services/__tests__/repository-structure-service.test.ts`:

```ts
it("returns a deterministic initialization token when validating a non-Synapse directory", async () => {
  const { repositoryStructureService } = await import("../repository-structure-service")
  const localPath = await makeTempRepositoryPath()
  await writeFile(path.join(localPath, "notes.md"), "# Notes", "utf8")

  const first = await repositoryStructureService.validateDirectoryStructure(localPath)
  const second = await repositoryStructureService.validateDirectoryStructure(localPath)

  expect(first.initializationPreview.operationToken).toBeTruthy()
  expect(first.initializationPreview.operationToken).toBe(second.initializationPreview.operationToken)
  expect(first.initializationPreview.nonGitEntries).toEqual(["notes.md"])
  expect(first.initializationPreview.dangerFlags).toEqual([])
})

it("does not create missing content directories while validating", async () => {
  const { repositoryStructureService } = await import("../repository-structure-service")
  const localPath = await makeTempRepositoryPath()
  await mkdir(path.join(localPath, "system", "users"), { recursive: true })
  await mkdir(path.join(localPath, "system", "blobs"), { recursive: true })

  await repositoryStructureService.validateDirectoryStructure(localPath)

  await expect(access(path.join(localPath, "rules"))).rejects.toThrow()
  await expect(access(path.join(localPath, "skills"))).rejects.toThrow()
  await expect(access(path.join(localPath, "prompts"))).rejects.toThrow()
})
```

Add `mkdir` to the existing fs import:

```ts
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises"
```

- [ ] **Step 2: Run the failing repository tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/repository-structure-service.test.ts
```

Expected: FAIL because `operationToken` and `dangerFlags` are not on `initializationPreview`, and validation currently creates content directories in some cases.

- [ ] **Step 3: Extend repository initialization types**

Update `desktop/src/types/repository.ts`:

```ts
export type SynapseRepositoryInitializationDangerFlag =
  | "home"
  | "desktop"
  | "documents"
  | "downloads"
  | "filesystem-root"
  | "synapse-source-checkout"
  | "source-repository"

export type SynapseRepositoryInitializationPreview = {
  isEmpty: boolean
  nonGitEntries: string[]
  operationToken: string
  dangerFlags: SynapseRepositoryInitializationDangerFlag[]
}

export type SynapseRepositoryInitializationOptions = {
  confirmedOperationToken?: string
}
```

- [ ] **Step 4: Create the safety helper**

Create `desktop/electron/services/repository-initialization-safety.ts`:

```ts
import { createHash } from "node:crypto"
import type { Dirent } from "node:fs"
import { lstat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type {
  SynapseRepositoryInitializationDangerFlag,
  SynapseRepositoryInitializationPreview,
} from "../../src/types/repository"

const BACKUP_PREFIX = ".synapse-init-backup-"

export function isInitializationBackupEntry(entryName: string): boolean {
  return entryName.startsWith(BACKUP_PREFIX)
}

export function createInitializationBackupDirectoryName(date: Date): string {
  const stamp = [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("")
  return `${BACKUP_PREFIX}${stamp}`
}

export async function createRepositoryInitializationPreview(input: {
  readonly repositoryUuid?: string
  readonly localPath: string
  readonly entries: readonly Dirent[]
}): Promise<SynapseRepositoryInitializationPreview> {
  const nonGitEntries = input.entries
    .filter((entry) => entry.name !== ".git")
    .filter((entry) => !isInitializationBackupEntry(entry.name))
  const fingerprints = await Promise.all(nonGitEntries.map(async (entry) => {
    const entryPath = path.join(input.localPath, entry.name)
    const stat = await lstat(entryPath)
    return {
      name: entry.name,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other",
      size: stat.size,
      modifiedMs: Math.trunc(stat.mtimeMs),
    }
  }))
  const normalized = fingerprints.sort((left, right) => left.name.localeCompare(right.name))
  return {
    isEmpty: normalized.length === 0,
    nonGitEntries: normalized.map((entry) => entry.type === "directory" ? `${entry.name}/` : entry.name),
    operationToken: hashInitializationPreview({
      localPath: path.resolve(input.localPath),
      repositoryUuid: input.repositoryUuid ?? "",
      entries: normalized,
    }),
    dangerFlags: detectDangerFlags(input.localPath, input.entries),
  }
}

export function assertRepositoryInitializationAllowed(preview: SynapseRepositoryInitializationPreview): void {
  if (preview.dangerFlags.length > 0) {
    throw new Error("该目录位置风险较高，不能直接初始化。请选择空目录或新建本地仓库。")
  }
}

function detectDangerFlags(localPath: string, entries: readonly Dirent[]): SynapseRepositoryInitializationDangerFlag[] {
  const flags = new Set<SynapseRepositoryInitializationDangerFlag>()
  const resolved = path.resolve(localPath)
  const home = path.resolve(os.homedir())
  const deniedUserDirs = [
    ["home", home],
    ["desktop", path.join(home, "Desktop")],
    ["documents", path.join(home, "Documents")],
    ["downloads", path.join(home, "Downloads")],
  ] as const
  for (const [flag, deniedPath] of deniedUserDirs) {
    if (resolved === path.resolve(deniedPath)) flags.add(flag)
  }
  if (path.parse(resolved).root === resolved) flags.add("filesystem-root")
  const cwd = path.resolve(process.cwd())
  if (resolved === cwd || cwd.startsWith(`${resolved}${path.sep}`)) flags.add("synapse-source-checkout")
  const names = new Set(entries.map((entry) => entry.name))
  const looksLikeSourceRepo = names.has("package.json")
    || names.has("pnpm-workspace.yaml")
    || names.has("src")
    || names.has("desktop")
  if (looksLikeSourceRepo && !names.has("system")) flags.add("source-repository")
  return Array.from(flags)
}

function hashInitializationPreview(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
```

- [ ] **Step 5: Wire preview generation without changing initialization yet**

In `desktop/electron/services/repository-structure-service.ts`, import the helper:

```ts
import {
  assertRepositoryInitializationAllowed,
  createRepositoryInitializationPreview,
  isInitializationBackupEntry,
} from "./repository-initialization-safety"
```

Replace direct `nonGitEntryNames` preview construction in `validateDirectoryStructure()` and `checkInitializationPreview()` with:

```ts
const initializationPreview = await createRepositoryInitializationPreview({
  localPath,
  entries,
})
const nonGitEntryNames = initializationPreview.nonGitEntries
```

and:

```ts
return createRepositoryInitializationPreview({
  repositoryUuid: repository.uuid,
  localPath: repository.localPath,
  entries,
})
```

Update `getNonGitEntries()`:

```ts
function getNonGitEntries(entries: Dirent[]): Dirent[] {
  return entries.filter((entry) => !isGitDirectory(entry) && !isInitializationBackupEntry(entry.name))
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/repository-structure-service.test.ts
```

Expected: PASS for preview-token tests. Existing initialization tests may still fail until Task 2 updates confirmation behavior.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/types/repository.ts desktop/electron/services/repository-initialization-safety.ts desktop/electron/services/repository-structure-service.ts desktop/electron/services/__tests__/repository-structure-service.test.ts
git commit -m "feat: add repository initialization safety preview"
```

---

### Task 2: Backup-Based Repository Initialization

**Files:**
- Modify: `desktop/electron/services/repository-structure-service.ts`
- Modify: `desktop/electron/services/__tests__/repository-structure-service.test.ts`

- [ ] **Step 1: Replace old deletion expectation with backup behavior**

Replace the existing test named `initializes a non-empty directory after the confirmed preview matches current entries` with:

```ts
it("moves non-empty directory contents into a backup before initialization", async () => {
  const { repositoryStructureService } = await import("../repository-structure-service")
  const localPath = await makeTempRepositoryPath()
  const filePath = path.join(localPath, "notes.md")
  await writeFile(filePath, "# Notes", "utf8")
  const preview = await repositoryStructureService.checkInitializationPreview({
    contentDirs: {},
    localPath,
    name: "Repo",
    uuid: "repo-1",
  })

  await expect(repositoryStructureService.initializeStructure({
    contentDirs: {},
    localPath,
    name: "Repo",
    uuid: "repo-1",
  }, {
    confirmedOperationToken: preview.operationToken,
  })).resolves.toEqual(expect.objectContaining({
    message: "初始化完成。",
  }))

  await expect(access(filePath)).rejects.toThrow()
  await expect(access(path.join(localPath, "rules", ".gitkeep"))).resolves.toBeUndefined()
  const entries = await readdir(localPath)
  const backupName = entries.find((entry) => entry.startsWith(".synapse-init-backup-"))
  expect(backupName).toBeTruthy()
  await expect(access(path.join(localPath, backupName!, "notes.md"))).resolves.toBeUndefined()
  expect(mocks.contentIndexService.clearIndex).toHaveBeenCalledTimes(1)
})
```

Add `readdir` to the test import:

```ts
import { access, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises"
```

- [ ] **Step 2: Add stale token and deny-path tests**

Add:

```ts
it("rejects initialization when the confirmed token no longer matches current contents", async () => {
  const { repositoryStructureService } = await import("../repository-structure-service")
  const localPath = await makeTempRepositoryPath()
  await writeFile(path.join(localPath, "notes.md"), "# Notes", "utf8")
  const preview = await repositoryStructureService.checkInitializationPreview({
    contentDirs: {},
    localPath,
    name: "Repo",
    uuid: "repo-1",
  })
  await writeFile(path.join(localPath, "new.md"), "# New", "utf8")

  await expect(repositoryStructureService.initializeStructure({
    contentDirs: {},
    localPath,
    name: "Repo",
    uuid: "repo-1",
  }, {
    confirmedOperationToken: preview.operationToken,
  })).rejects.toThrow("目录内容已变化")

  await expect(access(path.join(localPath, "notes.md"))).resolves.toBeUndefined()
  await expect(access(path.join(localPath, "new.md"))).resolves.toBeUndefined()
})

it("rejects initialization for source-like directories", async () => {
  const { repositoryStructureService } = await import("../repository-structure-service")
  const localPath = await makeTempRepositoryPath()
  await writeFile(path.join(localPath, "package.json"), "{}\n", "utf8")
  const preview = await repositoryStructureService.checkInitializationPreview({
    contentDirs: {},
    localPath,
    name: "Repo",
    uuid: "repo-1",
  })

  expect(preview.dangerFlags).toContain("source-repository")
  await expect(repositoryStructureService.initializeStructure({
    contentDirs: {},
    localPath,
    name: "Repo",
    uuid: "repo-1",
  }, {
    confirmedOperationToken: preview.operationToken,
  })).rejects.toThrow("不能直接初始化")
})
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/repository-structure-service.test.ts
```

Expected: FAIL because initialization still accepts `confirmedNonGitEntries` and deletes entries directly.

- [ ] **Step 4: Implement token verification and backup moves**

In `desktop/electron/services/repository-structure-service.ts`, import backup helper:

```ts
import {
  assertRepositoryInitializationAllowed,
  createInitializationBackupDirectoryName,
  createRepositoryInitializationPreview,
  isInitializationBackupEntry,
} from "./repository-initialization-safety"
```

Add helper functions near `writeGitkeep()`:

```ts
async function moveExistingEntriesToInitializationBackup(
  repositoryPath: string,
  entries: Dirent[],
): Promise<string | null> {
  const movableEntries = getNonGitEntries(entries)
  if (movableEntries.length === 0) return null

  const backupPath = path.join(repositoryPath, createInitializationBackupDirectoryName(new Date()))
  await mkdir(backupPath, { recursive: false })

  try {
    for (const entry of movableEntries) {
      await rename(path.join(repositoryPath, entry.name), path.join(backupPath, entry.name))
    }
    return backupPath
  } catch (error) {
    logger.error("Failed to move repository contents into initialization backup.", {
      backupName: path.basename(backupPath),
      error,
    })
    throw new Error("备份旧目录内容失败，未初始化。", { cause: error })
  }
}

function assertConfirmedInitializationToken(
  preview: SynapseRepositoryInitializationPreview,
  options: SynapseRepositoryInitializationOptions,
): void {
  if (preview.isEmpty) return
  if (!options.confirmedOperationToken || options.confirmedOperationToken !== preview.operationToken) {
    throw new Error("目录内容已变化，请重新确认初始化清单。")
  }
}
```

Replace the old confirmation block and deletion loop in `initializeStructure()` with:

```ts
const preview = await createRepositoryInitializationPreview({
  repositoryUuid: repository.uuid,
  localPath: repository.localPath,
  entries,
})

assertRepositoryInitializationAllowed(preview)
assertConfirmedInitializationToken(preview, options)

const backupPath = await moveExistingEntriesToInitializationBackup(repository.localPath, entries)
if (backupPath) {
  logger.info("Moved repository contents into initialization backup.", {
    backupName: path.basename(backupPath),
    repositoryUuid: repository.uuid,
  })
}
```

Keep the skeleton creation loop after this block.

- [ ] **Step 5: Run repository tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/repository-structure-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/repository-structure-service.ts desktop/electron/services/__tests__/repository-structure-service.test.ts
git commit -m "feat: back up repository contents before initialization"
```

---

### Task 3: Repository IPC and Renderer Confirmation Wiring

**Files:**
- Modify: `desktop/electron/modules/repository/ipc.ts`
- Modify: `desktop/src/modules/settings/components/repository-list-editor.tsx`
- Modify: `desktop/src/app-shell/components/empty-repository-state.tsx`
- Test: `desktop/src/app-shell/components/__tests__/empty-repository-state.test.tsx`

- [ ] **Step 1: Update IPC schema**

In `desktop/electron/modules/repository/ipc.ts`, replace the current initialization options schema:

```ts
const initializationOptionsSchema = z.object({
  confirmedNonGitEntries: z.array(z.string()).optional(),
}).optional()
```

with:

```ts
const initializationOptionsSchema = z.object({
  confirmedOperationToken: z.string().optional(),
}).optional()
```

- [ ] **Step 2: Wire Settings initialization confirmation**

In `desktop/src/modules/settings/components/repository-list-editor.tsx`, replace:

```ts
confirmedNonGitEntries: preview.nonGitEntries,
```

with:

```ts
confirmedOperationToken: preview.operationToken,
```

- [ ] **Step 3: Wire empty state initialization confirmation**

In `desktop/src/app-shell/components/empty-repository-state.tsx`, replace:

```ts
confirmedNonGitEntries: preview.nonGitEntries,
```

with:

```ts
confirmedOperationToken: preview.operationToken,
```

- [ ] **Step 4: Add or update renderer test expectation**

In `desktop/src/app-shell/components/__tests__/empty-repository-state.test.tsx`, update the mocked preview object used for initialization to include:

```ts
initializationPreview: {
  isEmpty: false,
  nonGitEntries: ["notes.md"],
  operationToken: "token-1",
  dangerFlags: [],
},
```

Update the initialize expectation to:

```ts
expect(repositoryActions.initializeRepository).toHaveBeenCalledWith(expect.any(String), {
  confirmedOperationToken: "token-1",
})
```

- [ ] **Step 5: Run renderer and repository tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/app-shell/components/__tests__/empty-repository-state.test.tsx electron/services/__tests__/repository-structure-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/modules/repository/ipc.ts desktop/src/modules/settings/components/repository-list-editor.tsx desktop/src/app-shell/components/empty-repository-state.tsx desktop/src/app-shell/components/__tests__/empty-repository-state.test.tsx
git commit -m "feat: confirm repository initialization with operation token"
```

---

### Task 4: Knowledge Base Raw Operation Summaries

**Files:**
- Modify: `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
- Modify: `desktop/electron/services/knowledge-base/raw-file-manager.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`

- [ ] **Step 1: Add logging tests**

At the top of `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`, add a hoisted logger mock if the file does not already have one:

```ts
const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("../../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))
```

Add this test:

```ts
it("logs raw mutation summaries without full external upload paths", async () => {
  const sourcePath = path.join(await tempDir(), "secret-client-name.md")
  await writeFile(sourcePath, "alpha\n")
  const { projectId, service } = await managedFixture()

  await service.uploadRawFiles({
    projectId,
    targetDirectoryPath: "",
    filePaths: [sourcePath],
  })

  expect(mocks.logger.info).toHaveBeenCalledWith("Knowledge Base raw mutation completed.", expect.objectContaining({
    affectedCount: 1,
    operation: "uploadRawFiles",
    projectId,
    skippedCount: 0,
  }))
  expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain(sourcePath)
})
```

- [ ] **Step 2: Add symlink and descendant move tests**

Add:

```ts
it("skips raw moves that target a directory inside itself", async () => {
  const { projectId, projectPath, service } = await managedFixture()
  await mkdir(path.join(projectPath, ".raw", "folder", "child"), { recursive: true })

  const result = await service.moveRawEntries({
    projectId,
    relativePaths: ["folder"],
    targetDirectoryPath: "folder/child",
  })

  expect(result.entries).toEqual([])
  expect(result.skipped).toEqual([{ path: "folder", reason: "invalid-path" }])
})

it("rejects raw rename through a symlink path", async () => {
  const { projectId, projectPath, service } = await managedFixture()
  const outsidePath = await tempDir()
  await symlink(outsidePath, path.join(projectPath, ".raw", "linked"))

  await expect(service.renameRawEntry({
    projectId,
    relativePath: "linked/file.md",
    newName: "renamed.md",
  })).rejects.toThrow("符号链接")
})
```

Add `symlink` to the fs import:

```ts
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
```

- [ ] **Step 3: Run failing Knowledge Base service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: FAIL until logging is added. The descendant move test may already pass.

- [ ] **Step 4: Add raw mutation logging in service**

In `desktop/electron/services/knowledge-base/knowledge-base-service.ts`, import logger:

```ts
import { createMainLogger } from "../log-store"
```

Add near constants:

```ts
const logger = createMainLogger("service.knowledge-base")
```

Add method inside `KnowledgeBaseService`:

```ts
private recordRawMutation(
  operation: string,
  projectId: string,
  result: Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">,
): void {
  const skippedReasons = result.skipped.reduce<Record<string, number>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1
    return counts
  }, {})
  logger.info("Knowledge Base raw mutation completed.", {
    affectedCount: result.entries.length,
    operation,
    projectId,
    skippedCount: result.skipped.length,
    skippedReasons,
  })
}
```

Call it before each raw mutation return:

```ts
const result = await this.rawFileManager.uploadFiles(rawRoot, payload.targetDirectoryPath, payload.filePaths)
this.recordRawMutation("uploadRawFiles", payload.projectId, result)
return { projectId: payload.projectId, ...result }
```

Apply the same pattern to `createRawFolder`, `renameRawEntry`, `moveRawEntries`, and `trashRawEntries`. For single-entry methods, build:

```ts
const result = { entries: [entry], skipped: [] }
this.recordRawMutation("renameRawEntry", payload.projectId, result)
return { projectId: payload.projectId, ...result }
```

- [ ] **Step 5: Tighten symlink skipped reason only where partial failure is expected**

In `desktop/electron/services/knowledge-base/raw-file-manager.ts`, keep throwing for single-target `renameEntry`. In `moveEntries()` and `trashEntries()`, when `assertNoSymlinkInRawPath` throws, push:

```ts
skipped.push({ path: relativePath, reason: "invalid-path" })
```

instead of `read-error` or `trash-error`. Preserve `trash-error` for failures from `this.trashItem(target)`.

- [ ] **Step 6: Run Knowledge Base service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/knowledge-base/knowledge-base-service.ts desktop/electron/services/knowledge-base/raw-file-manager.ts desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
git commit -m "feat: log knowledge base raw mutations"
```

---

### Task 5: Knowledge Base Raw Batch Confirmation UI

**Files:**
- Modify: `desktop/src/modules/knowledge-base/source-manager-window.tsx`
- Modify: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Add tests for batch and directory confirmation**

In `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`, add this local fixture near the new tests:

```ts
const directoryEntry = {
  name: "客户",
  relativePath: "客户",
  kind: "directory" as const,
  size: null,
  modifiedAt: "2026-05-26T00:00:00.000Z",
}
```

Add:

```ts
it("asks for confirmation before trashing a selected directory", async () => {
  bridgeMocks.knowledgeBase.listRawDirectory.mockResolvedValue({
    projectId: "project-1",
    directoryPath: "",
    entries: [directoryEntry],
  })
  renderWindow()
  await waitForExpectation(() => expect(document.body.textContent).toContain("客户"))

  await act(async () => {
    buttonByLabel("选择 客户").click()
  })
  await act(async () => {
    buttonByLabel("移到废纸篓").click()
  })

  expect(document.body.textContent).toContain("移到废纸篓？")
  expect(document.body.textContent).toContain("客户")
  expect(bridgeMocks.knowledgeBase.trashRawEntries).not.toHaveBeenCalled()
})

it("asks for confirmation before moving multiple selected entries", async () => {
  bridgeMocks.knowledgeBase.listRawDirectory.mockResolvedValue({
    projectId: "project-1",
    directoryPath: "",
    entries: [
      {
        name: "a.md",
        relativePath: "a.md",
        kind: "file" as const,
        size: 12,
        modifiedAt: "2026-05-26T00:00:00.000Z",
      },
      {
        name: "b.md",
        relativePath: "b.md",
        kind: "file" as const,
        size: 14,
        modifiedAt: "2026-05-26T00:00:00.000Z",
      },
      directoryEntry,
    ],
  })
  renderWindow()
  await waitForExpectation(() => expect(document.body.textContent).toContain("a.md"))

  await act(async () => {
    buttonByLabel("选择 a.md").click()
    buttonByLabel("选择 b.md").click()
  })
  await act(async () => {
    buttonByLabel("移动所选").click()
  })
  await act(async () => {
    buttonByLabel("选择目标文件夹 客户").click()
    await Promise.resolve()
  })
  await act(async () => {
    buttonByLabel("确认移动").click()
  })

  expect(document.body.textContent).toContain("确认移动？")
  expect(bridgeMocks.knowledgeBase.moveRawEntries).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run failing source manager tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: FAIL until move confirmation is added.

- [ ] **Step 3: Add confirmation state**

In `desktop/src/modules/knowledge-base/source-manager-window.tsx`, add local state:

```ts
type PendingRawMutation =
  | { kind: "move"; relativePaths: string[]; targetDirectoryPath: string }
  | { kind: "trash"; relativePaths: string[] }

const [pendingRawMutation, setPendingRawMutation] = useState<PendingRawMutation | null>(null)
```

Add helper:

```ts
function needsRawMutationConfirmation(
  entries: SynapseKnowledgeBaseRawEntry[],
  relativePaths: string[],
): boolean {
  if (relativePaths.length > 1) return true
  const selected = new Set(relativePaths)
  return entries.some((entry) => selected.has(entry.relativePath) && entry.kind === "directory")
}
```

- [ ] **Step 4: Gate move and trash through confirmation**

Where trash currently calls `bridge.knowledgeBase.trashRawEntries`, change to:

```ts
if (needsRawMutationConfirmation(entries, selectedPaths)) {
  setPendingRawMutation({ kind: "trash", relativePaths: selectedPaths })
  return
}
await runTrashRawEntries(selectedPaths)
```

Where move currently calls `bridge.knowledgeBase.moveRawEntries`, change to:

```ts
if (needsRawMutationConfirmation(entries, selectedPaths)) {
  setPendingRawMutation({ kind: "move", relativePaths: selectedPaths, targetDirectoryPath })
  return
}
await runMoveRawEntries(selectedPaths, targetDirectoryPath)
```

Extract the existing mutation calls into `runTrashRawEntries()` and `runMoveRawEntries()` functions so the dialog confirm button can reuse them.

- [ ] **Step 5: Render concise confirmation dialog**

Use existing dialog/alert primitives already imported in the file. If missing, import from `@/components/ui/alert-dialog`.

Render:

```tsx
<AlertDialog open={pendingRawMutation !== null} onOpenChange={(open) => {
  if (!open) setPendingRawMutation(null)
}}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>
        {pendingRawMutation?.kind === "move" ? "确认移动？" : "移到废纸篓？"}
      </AlertDialogTitle>
      <AlertDialogDescription asChild>
        <div className="flex flex-col gap-2">
          {pendingRawMutation ? pendingRawMutation.relativePaths.slice(0, 5).map((relativePath) => (
            <span key={relativePath} className="break-all">{relativePath}</span>
          )) : null}
          {pendingRawMutation && pendingRawMutation.relativePaths.length > 5 ? (
            <span>还有 {pendingRawMutation.relativePaths.length - 5} 项</span>
          ) : null}
        </div>
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>取消</AlertDialogCancel>
      <AlertDialogAction onClick={() => {
        const pending = pendingRawMutation
        setPendingRawMutation(null)
        if (!pending) return
        if (pending.kind === "move") {
          void runMoveRawEntries(pending.relativePaths, pending.targetDirectoryPath)
        } else {
          void runTrashRawEntries(pending.relativePaths)
        }
      }}>
        确认
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Keep wording concise and do not show managed runtime paths.

- [ ] **Step 6: Run source manager tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/knowledge-base/source-manager-window.tsx desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
git commit -m "feat: confirm risky knowledge base raw actions"
```

---

### Task 6: Release Notes and Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update release notes**

Add a short bullet under the pending user-facing changes section:

```md
- 仓库初始化不再直接清空已有内容，会先备份旧文件并在执行前校验目录未变化；知识库资料的批量移动和删除也会增加确认，降低误操作风险。
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/repository-structure-service.test.ts electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts src/modules/knowledge-base/__tests__/source-manager-window.test.tsx src/app-shell/components/__tests__/empty-repository-state.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note repository and knowledge base safety updates"
```

---

## Self-Review

- Spec coverage: repository initialization token, backup-based initialization, read-only validation, Knowledge Base raw boundary/logging, batch UI confirmation, and release notes are covered.
- Scope check: no editor install, editor scan trash, app reset, workflow output, or content download changes are included.
- Type consistency: `confirmedOperationToken`, `operationToken`, and `dangerFlags` are introduced in Task 1 and used consistently in Tasks 2 and 3.
- Verification: focused Vitest commands and desktop typecheck are included.
