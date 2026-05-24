# Knowledge Base Raw File Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Knowledge Base source manager with a pure `.raw/` file manager that supports folder navigation, file upload, create folder, rename, move, multi-select, and system Trash deletion.

**Architecture:** Add deterministic `.raw` file operations in Electron, expose them through narrow Knowledge Base IPC/preload APIs, and replace the renderer window with a single-column file browser. The implementation deliberately does not update `.raw/.manifest.json`, does not modify `wiki/`, and does not invoke Claude Code.

**Tech Stack:** Electron main process, React, TypeScript, shadcn/Radix UI, Vitest, Node `fs/promises`, Electron `dialog` and `shell.trashItem`.

---

## Scope And File Structure

Create or modify these files:

- Create `desktop/electron/services/knowledge-base/raw-file-manager.ts`  
  Pure raw-directory operations: list, create folder, upload files, rename, move, trash, path validation, collision-safe names, symlink rejection.

- Modify `desktop/electron/services/knowledge-base/knowledge-base-service.ts`  
  Resolve managed project id to runtime path, then delegate raw-manager operations to `.raw`.

- Modify `desktop/src/types/knowledge-base.ts`  
  Add raw-manager request/response types while keeping existing create-managed/open-manager types.

- Modify `desktop/electron/modules/knowledge-base/ipc.ts`  
  Add zod schemas and guarded IPC handlers for raw-manager methods.

- Modify `desktop/electron/preload.ts`  
  Add IPC channel constants and bridge methods under `window.synapse.knowledgeBase`.

- Modify `desktop/src/types/bridge.ts`  
  Add bridge method signatures.

- Modify `desktop/src/modules/knowledge-base/source-manager-window.tsx`  
  Replace the flat source-status UI with the raw file browser.

- Modify tests:
  - `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`
  - `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`
  - `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

---

## Task 1: Add Raw File Manager Types And Service Tests

**Files:**

- Modify: `desktop/src/types/knowledge-base.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`

- [ ] **Step 1: Add shared raw-manager types**

Append these types to `desktop/src/types/knowledge-base.ts` after the existing upload result types:

```ts
export type SynapseKnowledgeBaseRawEntryKind = "file" | "directory"

export type SynapseKnowledgeBaseRawEntry = {
  name: string
  relativePath: string
  kind: SynapseKnowledgeBaseRawEntryKind
  size: number | null
  modifiedAt: string
}

export type SynapseKnowledgeBaseListRawDirectoryPayload = {
  projectId: string
  directoryPath: string
}

export type SynapseKnowledgeBaseListRawDirectoryResult = {
  projectId: string
  directoryPath: string
  entries: SynapseKnowledgeBaseRawEntry[]
}

export type SynapseKnowledgeBaseCreateRawFolderPayload = {
  projectId: string
  parentDirectoryPath: string
  name: string
}

export type SynapseKnowledgeBaseUploadRawFilesPayload = {
  projectId: string
  targetDirectoryPath: string
  filePaths: string[]
}

export type SynapseKnowledgeBaseRawMutationResult = {
  projectId: string
  entries: SynapseKnowledgeBaseRawEntry[]
  skipped: Array<{
    path: string
    reason: "not-file" | "not-directory" | "read-error" | "invalid-path" | "collision" | "trash-error"
  }>
}

export type SynapseKnowledgeBaseRenameRawEntryPayload = {
  projectId: string
  relativePath: string
  newName: string
}

export type SynapseKnowledgeBaseMoveRawEntriesPayload = {
  projectId: string
  relativePaths: string[]
  targetDirectoryPath: string
}

export type SynapseKnowledgeBaseTrashRawEntriesPayload = {
  projectId: string
  relativePaths: string[]
}
```

- [ ] **Step 2: Write failing service tests for raw listing and upload target directories**

Add this test to `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts` inside `describe("KnowledgeBaseService", ...)`:

```ts
it("lists raw directory entries without source import statuses", async () => {
  const { projectId, projectPath, service } = await managedFixture()
  await mkdir(path.join(projectPath, ".raw", "projects"), { recursive: true })
  await writeFile(path.join(projectPath, ".raw", "brief.md"), "alpha\n")
  await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{}}\n")

  const result = await service.listRawDirectory({
    projectId,
    directoryPath: "",
  })

  expect(result).toMatchObject({
    projectId,
    directoryPath: "",
  })
  expect(result.entries.map((entry) => ({
    name: entry.name,
    relativePath: entry.relativePath,
    kind: entry.kind,
    size: entry.size,
  }))).toEqual([
    { name: "projects", relativePath: "projects", kind: "directory", size: null },
    { name: "brief.md", relativePath: "brief.md", kind: "file", size: 6 },
  ])
  expect(result.entries.some((entry) => entry.name === ".manifest.json")).toBe(false)
})

it("uploads raw files into the selected raw folder without conversion", async () => {
  const sourcePath = path.join(await tempDir(), "report.docx")
  await writeFile(sourcePath, "binary")
  const { projectId, projectPath, service } = await managedFixture()
  await mkdir(path.join(projectPath, ".raw", "client-a"), { recursive: true })

  const result = await service.uploadRawFiles({
    projectId,
    targetDirectoryPath: "client-a",
    filePaths: [sourcePath],
  })

  expect(result.entries).toEqual([expect.objectContaining({
    name: "report.docx",
    relativePath: "client-a/report.docx",
    kind: "file",
    size: 6,
  })])
  await expect(readFile(path.join(projectPath, ".raw", "client-a", "report.docx"), "utf8"))
    .resolves.toBe("binary")
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: TypeScript/test failure because `listRawDirectory` and `uploadRawFiles` are not implemented.

---

## Task 2: Implement Raw File Operations

**Files:**

- Create: `desktop/electron/services/knowledge-base/raw-file-manager.ts`
- Modify: `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`

- [ ] **Step 1: Create raw-file-manager implementation**

Create `desktop/electron/services/knowledge-base/raw-file-manager.ts`:

```ts
import { constants } from "node:fs"
import { access, copyFile, lstat, mkdir, readdir, rename } from "node:fs/promises"
import path from "node:path"

import type {
  SynapseKnowledgeBaseRawEntry,
  SynapseKnowledgeBaseRawMutationResult,
} from "../../../src/types/knowledge-base"

type TrashItem = (targetPath: string) => Promise<void>

export interface RawFileManagerDeps {
  readonly trashItem: TrashItem
}

export class KnowledgeBaseRawFileManager {
  private readonly trashItem: TrashItem

  constructor(deps: RawFileManagerDeps) {
    this.trashItem = deps.trashItem
  }

  async list(rawRoot: string, directoryPath: string): Promise<SynapseKnowledgeBaseRawEntry[]> {
    const directory = resolveRawPath(rawRoot, directoryPath)
    await assertNoSymlinkInRawPath(rawRoot, directoryPath)
    const stat = await lstat(directory)
    if (!stat.isDirectory()) throw new Error("目标不是文件夹。")
    const entries = await readdir(directory, { withFileTypes: true })
    const result: SynapseKnowledgeBaseRawEntry[] = []
    for (const entry of entries) {
      if (entry.name === ".manifest.json") continue
      if (entry.isSymbolicLink()) continue
      if (!entry.isFile() && !entry.isDirectory()) continue
      const absolutePath = path.join(directory, entry.name)
      const relativePath = normalizeRelativePath(path.relative(rawRoot, absolutePath))
      const entryStat = await lstat(absolutePath)
      result.push({
        name: entry.name,
        relativePath,
        kind: entry.isDirectory() ? "directory" : "file",
        size: entry.isDirectory() ? null : entryStat.size,
        modifiedAt: entryStat.mtime.toISOString(),
      })
    }
    return sortEntries(result)
  }

  async createFolder(rawRoot: string, parentDirectoryPath: string, name: string): Promise<SynapseKnowledgeBaseRawEntry> {
    validateEntryName(name)
    const parent = resolveRawPath(rawRoot, parentDirectoryPath)
    await assertNoSymlinkInRawPath(rawRoot, parentDirectoryPath)
    const target = resolveRawPath(rawRoot, joinRawPath(parentDirectoryPath, name))
    if (await pathExists(target)) throw new Error("文件夹已存在。")
    await mkdir(parent, { recursive: true })
    await mkdir(target)
    return entryForPath(rawRoot, target, "directory")
  }

  async uploadFiles(
    rawRoot: string,
    targetDirectoryPath: string,
    filePaths: readonly string[],
  ): Promise<Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">> {
    const targetDirectory = resolveRawPath(rawRoot, targetDirectoryPath)
    await assertNoSymlinkInRawPath(rawRoot, targetDirectoryPath)
    await mkdir(targetDirectory, { recursive: true })
    const entries: SynapseKnowledgeBaseRawEntry[] = []
    const skipped: SynapseKnowledgeBaseRawMutationResult["skipped"] = []
    for (const filePath of filePaths) {
      try {
        const sourcePath = path.resolve(filePath)
        const sourceStat = await lstat(sourcePath)
        if (!sourceStat.isFile()) {
          skipped.push({ path: filePath, reason: "not-file" })
          continue
        }
        const targetPath = await resolveCollisionPath(targetDirectory, path.basename(sourcePath))
        await copyFile(sourcePath, targetPath)
        entries.push(await entryForPath(rawRoot, targetPath, "file"))
      } catch {
        skipped.push({ path: filePath, reason: "read-error" })
      }
    }
    return { entries: sortEntries(entries), skipped }
  }

  async renameEntry(rawRoot: string, relativePath: string, newName: string): Promise<SynapseKnowledgeBaseRawEntry> {
    validateEntryName(newName)
    const source = resolveRawPath(rawRoot, relativePath)
    await assertNoSymlinkInRawPath(rawRoot, relativePath)
    const sourceStat = await lstat(source)
    const targetRelativePath = joinRawPath(path.posix.dirname(normalizeRawPath(relativePath)), newName)
    const target = resolveRawPath(rawRoot, targetRelativePath)
    if (await pathExists(target)) throw new Error("目标已存在。")
    await rename(source, target)
    return entryForPath(rawRoot, target, sourceStat.isDirectory() ? "directory" : "file")
  }

  async moveEntries(
    rawRoot: string,
    relativePaths: readonly string[],
    targetDirectoryPath: string,
  ): Promise<Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">> {
    const targetDirectory = resolveRawPath(rawRoot, targetDirectoryPath)
    await assertNoSymlinkInRawPath(rawRoot, targetDirectoryPath)
    const targetStat = await lstat(targetDirectory)
    if (!targetStat.isDirectory()) throw new Error("目标不是文件夹。")
    const entries: SynapseKnowledgeBaseRawEntry[] = []
    const skipped: SynapseKnowledgeBaseRawMutationResult["skipped"] = []
    for (const relativePath of relativePaths) {
      try {
        const source = resolveRawPath(rawRoot, relativePath)
        await assertNoSymlinkInRawPath(rawRoot, relativePath)
        const sourceStat = await lstat(source)
        if (sourceStat.isDirectory() && isSameOrDescendant(relativePath, targetDirectoryPath)) {
          skipped.push({ path: relativePath, reason: "invalid-path" })
          continue
        }
        const target = path.join(targetDirectory, path.basename(source))
        if (await pathExists(target)) {
          skipped.push({ path: relativePath, reason: "collision" })
          continue
        }
        await rename(source, target)
        entries.push(await entryForPath(rawRoot, target, sourceStat.isDirectory() ? "directory" : "file"))
      } catch {
        skipped.push({ path: relativePath, reason: "read-error" })
      }
    }
    return { entries: sortEntries(entries), skipped }
  }

  async trashEntries(
    rawRoot: string,
    relativePaths: readonly string[],
  ): Promise<Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">> {
    const entries: SynapseKnowledgeBaseRawEntry[] = []
    const skipped: SynapseKnowledgeBaseRawMutationResult["skipped"] = []
    for (const relativePath of relativePaths) {
      try {
        const target = resolveRawPath(rawRoot, relativePath)
        await assertNoSymlinkInRawPath(rawRoot, relativePath)
        const stat = await lstat(target)
        entries.push(await entryForPath(rawRoot, target, stat.isDirectory() ? "directory" : "file"))
        await this.trashItem(target)
      } catch {
        skipped.push({ path: relativePath, reason: "trash-error" })
      }
    }
    return { entries: sortEntries(entries), skipped }
  }
}

function resolveRawPath(rawRoot: string, rawRelativePath: string): string {
  const root = path.resolve(rawRoot)
  const normalized = normalizeRawPath(rawRelativePath)
  const target = path.resolve(root, normalized)
  const relative = path.relative(root, target)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("目标路径不在资料目录中。")
  }
  return target
}

function normalizeRawPath(value: string): string {
  return value.split("\\").join("/").replace(/^\/+/, "").replace(/\/+$/g, "")
}

function joinRawPath(parent: string, name: string): string {
  const normalizedParent = normalizeRawPath(parent)
  return normalizedParent ? `${normalizedParent}/${name}` : name
}

function validateEntryName(name: string): void {
  const trimmed = name.trim()
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/]/.test(trimmed)) {
    throw new Error("名称不可用。")
  }
}

async function assertNoSymlinkInRawPath(rawRoot: string, rawRelativePath: string): Promise<void> {
  const normalized = normalizeRawPath(rawRelativePath)
  if (!normalized) return
  let current = path.resolve(rawRoot)
  for (const segment of normalized.split("/")) {
    current = path.join(current, segment)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) throw new Error("资料路径不能包含符号链接。")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
  }
}

async function entryForPath(rawRoot: string, absolutePath: string, kind: SynapseKnowledgeBaseRawEntry["kind"]): Promise<SynapseKnowledgeBaseRawEntry> {
  const stat = await lstat(absolutePath)
  return {
    name: path.basename(absolutePath),
    relativePath: normalizeRelativePath(path.relative(rawRoot, absolutePath)),
    kind,
    size: kind === "directory" ? null : stat.size,
    modifiedAt: stat.mtime.toISOString(),
  }
}

function sortEntries(entries: SynapseKnowledgeBaseRawEntry[]): SynapseKnowledgeBaseRawEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1
    return left.name.localeCompare(right.name, "zh-CN")
  })
}

async function resolveCollisionPath(directoryPath: string, fileName: string): Promise<string> {
  const parsed = path.parse(fileName)
  let candidate = path.join(directoryPath, fileName)
  let index = 2
  while (await pathExists(candidate)) {
    candidate = path.join(directoryPath, `${parsed.name}-${index}${parsed.ext}`)
    index += 1
  }
  return candidate
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function isSameOrDescendant(sourcePath: string, targetDirectoryPath: string): boolean {
  const source = normalizeRawPath(sourcePath)
  const target = normalizeRawPath(targetDirectoryPath)
  return target === source || target.startsWith(`${source}/`)
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/")
}
```

- [ ] **Step 2: Wire raw manager into KnowledgeBaseService**

Modify imports in `desktop/electron/services/knowledge-base/knowledge-base-service.ts`:

```ts
import { shell } from "electron"
import { KnowledgeBaseRawFileManager } from "./raw-file-manager"
import type {
  SynapseKnowledgeBaseCreateManagedPayload,
  SynapseKnowledgeBaseCreateManagedResult,
  SynapseKnowledgeBaseAddUrlSourcePayload,
  SynapseKnowledgeBaseCreateRawFolderPayload,
  SynapseKnowledgeBaseListRawDirectoryPayload,
  SynapseKnowledgeBaseListRawDirectoryResult,
  SynapseKnowledgeBaseMoveRawEntriesPayload,
  SynapseKnowledgeBaseRawMutationResult,
  SynapseKnowledgeBaseRenameRawEntryPayload,
  SynapseKnowledgeBaseTrashRawEntriesPayload,
  SynapseKnowledgeBaseUploadRawFilesPayload,
  SynapseKnowledgeBaseListSourcesResult,
  SynapseKnowledgeBaseSourceEntry,
  SynapseKnowledgeBaseUploadSourcesPayload,
  SynapseKnowledgeBaseUploadSourcesResult,
} from "../../../src/types/knowledge-base"
```

Extend `KnowledgeBaseServiceDeps`:

```ts
rawFileManager?: KnowledgeBaseRawFileManager
```

Add class field and constructor default:

```ts
private readonly rawFileManager: KnowledgeBaseRawFileManager

this.rawFileManager = deps.rawFileManager ?? new KnowledgeBaseRawFileManager({
  trashItem: (targetPath) => shell.trashItem(targetPath),
})
```

Add methods before `private async resolveProjectPath`:

```ts
async listRawDirectory(payload: SynapseKnowledgeBaseListRawDirectoryPayload): Promise<SynapseKnowledgeBaseListRawDirectoryResult> {
  const projectPath = await this.resolveProjectPath(payload.projectId)
  const rawRoot = await this.ensureRawRoot(projectPath)
  const entries = await this.rawFileManager.list(rawRoot, payload.directoryPath)
  return { projectId: payload.projectId, directoryPath: payload.directoryPath, entries }
}

async createRawFolder(payload: SynapseKnowledgeBaseCreateRawFolderPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
  const projectPath = await this.resolveProjectPath(payload.projectId)
  const rawRoot = await this.ensureRawRoot(projectPath)
  const entry = await this.rawFileManager.createFolder(rawRoot, payload.parentDirectoryPath, payload.name)
  return { projectId: payload.projectId, entries: [entry], skipped: [] }
}

async uploadRawFiles(payload: SynapseKnowledgeBaseUploadRawFilesPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
  const projectPath = await this.resolveProjectPath(payload.projectId)
  const rawRoot = await this.ensureRawRoot(projectPath)
  const result = await this.rawFileManager.uploadFiles(rawRoot, payload.targetDirectoryPath, payload.filePaths)
  return { projectId: payload.projectId, ...result }
}

async renameRawEntry(payload: SynapseKnowledgeBaseRenameRawEntryPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
  const projectPath = await this.resolveProjectPath(payload.projectId)
  const rawRoot = await this.ensureRawRoot(projectPath)
  const entry = await this.rawFileManager.renameEntry(rawRoot, payload.relativePath, payload.newName)
  return { projectId: payload.projectId, entries: [entry], skipped: [] }
}

async moveRawEntries(payload: SynapseKnowledgeBaseMoveRawEntriesPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
  const projectPath = await this.resolveProjectPath(payload.projectId)
  const rawRoot = await this.ensureRawRoot(projectPath)
  const result = await this.rawFileManager.moveEntries(rawRoot, payload.relativePaths, payload.targetDirectoryPath)
  return { projectId: payload.projectId, ...result }
}

async trashRawEntries(payload: SynapseKnowledgeBaseTrashRawEntriesPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
  const projectPath = await this.resolveProjectPath(payload.projectId)
  const rawRoot = await this.ensureRawRoot(projectPath)
  const result = await this.rawFileManager.trashEntries(rawRoot, payload.relativePaths)
  return { projectId: payload.projectId, ...result }
}

private async ensureRawRoot(projectPath: string): Promise<string> {
  const rawPath = assertInside(projectPath, path.join(projectPath, ".raw"))
  await assertNoSymlinkInRequiredPath(projectPath, ".raw")
  await mkdir(rawPath, { recursive: true })
  return rawPath
}
```

- [ ] **Step 3: Add service tests for folder, rename, move, trash, symlink and non-mutation of manifest/wiki**

Add these tests to `knowledge-base-service.test.ts`:

```ts
it("creates, renames, and moves raw folders without touching manifest or wiki", async () => {
  const trashItem = vi.fn(async () => undefined)
  const { projectId, projectPath, service } = await managedFixture({
    rawFileManager: new KnowledgeBaseRawFileManager({ trashItem }),
  })
  await mkdir(path.join(projectPath, ".raw"), { recursive: true })
  await mkdir(path.join(projectPath, "wiki"), { recursive: true })
  await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "manifest")
  await writeFile(path.join(projectPath, "wiki", "index.md"), "# Index\n")

  await service.createRawFolder({ projectId, parentDirectoryPath: "", name: "client-a" })
  await service.renameRawEntry({ projectId, relativePath: "client-a", newName: "client-b" })
  await service.createRawFolder({ projectId, parentDirectoryPath: "", name: "archive" })
  await service.moveRawEntries({ projectId, relativePaths: ["client-b"], targetDirectoryPath: "archive" })

  const result = await service.listRawDirectory({ projectId, directoryPath: "archive" })
  expect(result.entries).toEqual([expect.objectContaining({
    name: "client-b",
    relativePath: "archive/client-b",
    kind: "directory",
  })])
  await expect(readFile(path.join(projectPath, ".raw", ".manifest.json"), "utf8")).resolves.toBe("manifest")
  await expect(readFile(path.join(projectPath, "wiki", "index.md"), "utf8")).resolves.toBe("# Index\n")
})

it("trashes selected raw entries through the injected trash boundary", async () => {
  const trashItem = vi.fn(async () => undefined)
  const { projectId, projectPath, service } = await managedFixture({
    rawFileManager: new KnowledgeBaseRawFileManager({ trashItem }),
  })
  await mkdir(path.join(projectPath, ".raw", "folder"), { recursive: true })
  await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")

  const result = await service.trashRawEntries({
    projectId,
    relativePaths: ["folder", "note.md"],
  })

  expect(result.entries.map((entry) => entry.relativePath)).toEqual(["folder", "note.md"])
  expect(trashItem).toHaveBeenCalledWith(path.join(projectPath, ".raw", "folder"))
  expect(trashItem).toHaveBeenCalledWith(path.join(projectPath, ".raw", "note.md"))
})

it("rejects raw path escapes and symlink traversal", async () => {
  const { projectId, projectPath, service } = await managedFixture()
  await mkdir(path.join(projectPath, ".raw"), { recursive: true })

  await expect(service.listRawDirectory({ projectId, directoryPath: "../wiki" }))
    .rejects.toThrow("目标路径不在资料目录中。")
})
```

Also add the missing import at the top:

```ts
import { KnowledgeBaseRawFileManager } from "../raw-file-manager"
```

- [ ] **Step 4: Run focused service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit service layer**

Run:

```bash
git add desktop/src/types/knowledge-base.ts desktop/electron/services/knowledge-base/knowledge-base-service.ts desktop/electron/services/knowledge-base/raw-file-manager.ts desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
git commit -m "feat: add knowledge base raw file operations"
```

---

## Task 3: Add IPC And Preload Bridge

**Files:**

- Modify: `desktop/electron/modules/knowledge-base/ipc.ts`
- Modify: `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`

- [ ] **Step 1: Add IPC schemas**

In `desktop/electron/modules/knowledge-base/ipc.ts`, add schemas near the existing source schemas:

```ts
const rawEntrySchema = z.object({
  name: z.string(),
  relativePath: z.string(),
  kind: z.enum(["file", "directory"]),
  size: z.number().nullable(),
  modifiedAt: z.string(),
})

const listRawDirectoryPayloadSchema = z.object({
  projectId: z.string().min(1),
  directoryPath: z.string(),
})

const listRawDirectoryResultSchema = z.object({
  projectId: z.string(),
  directoryPath: z.string(),
  entries: z.array(rawEntrySchema),
})

const createRawFolderPayloadSchema = z.object({
  projectId: z.string().min(1),
  parentDirectoryPath: z.string(),
  name: z.string().min(1),
})

const uploadRawFilesPayloadSchema = z.object({
  projectId: z.string().min(1),
  targetDirectoryPath: z.string(),
  filePaths: z.array(z.string().min(1)),
})

const renameRawEntryPayloadSchema = z.object({
  projectId: z.string().min(1),
  relativePath: z.string().min(1),
  newName: z.string().min(1),
})

const moveRawEntriesPayloadSchema = z.object({
  projectId: z.string().min(1),
  relativePaths: z.array(z.string().min(1)).min(1),
  targetDirectoryPath: z.string(),
})

const trashRawEntriesPayloadSchema = z.object({
  projectId: z.string().min(1),
  relativePaths: z.array(z.string().min(1)).min(1),
})

const rawMutationResultSchema = z.object({
  projectId: z.string(),
  entries: z.array(rawEntrySchema),
  skipped: z.array(z.object({
    path: z.string(),
    reason: z.enum(["not-file", "not-directory", "read-error", "invalid-path", "collision", "trash-error"]),
  })),
})
```

- [ ] **Step 2: Add IPC handlers**

Add methods to `knowledgeBaseIpcModule.methods`:

```ts
listRawDirectory: {
  kind: "invoke",
  channel: "synapse:knowledge-base:list-raw-directory",
  request: listRawDirectoryPayloadSchema,
  response: listRawDirectoryResultSchema,
  handler: (ctx, request) => runGuardedKnowledgeBaseOperation({
    ctx,
    action: "fs.read.outside-userdata",
    resource: `managed-knowledge-base:${request.projectId}`,
    source: "knowledgeBase.listRawDirectory",
    run: () => service(ctx).listRawDirectory(request),
  }),
},
createRawFolder: {
  kind: "invoke",
  channel: "synapse:knowledge-base:create-raw-folder",
  request: createRawFolderPayloadSchema,
  response: rawMutationResultSchema,
  handler: (ctx, request) => runGuardedKnowledgeBaseOperation({
    ctx,
    action: "fs.write",
    resource: `managed-knowledge-base:${request.projectId}`,
    source: "knowledgeBase.createRawFolder",
    run: () => service(ctx).createRawFolder(request),
  }),
},
uploadRawFiles: {
  kind: "invoke",
  channel: "synapse:knowledge-base:upload-raw-files",
  request: uploadRawFilesPayloadSchema,
  response: rawMutationResultSchema,
  handler: (ctx, request) => runGuardedKnowledgeBaseOperation({
    ctx,
    action: "fs.write",
    resource: `managed-knowledge-base:${request.projectId}`,
    source: "knowledgeBase.uploadRawFiles",
    run: () => service(ctx).uploadRawFiles(request),
  }),
},
renameRawEntry: {
  kind: "invoke",
  channel: "synapse:knowledge-base:rename-raw-entry",
  request: renameRawEntryPayloadSchema,
  response: rawMutationResultSchema,
  handler: (ctx, request) => runGuardedKnowledgeBaseOperation({
    ctx,
    action: "fs.write",
    resource: `managed-knowledge-base:${request.projectId}`,
    source: "knowledgeBase.renameRawEntry",
    run: () => service(ctx).renameRawEntry(request),
  }),
},
moveRawEntries: {
  kind: "invoke",
  channel: "synapse:knowledge-base:move-raw-entries",
  request: moveRawEntriesPayloadSchema,
  response: rawMutationResultSchema,
  handler: (ctx, request) => runGuardedKnowledgeBaseOperation({
    ctx,
    action: "fs.write",
    resource: `managed-knowledge-base:${request.projectId}`,
    source: "knowledgeBase.moveRawEntries",
    run: () => service(ctx).moveRawEntries(request),
  }),
},
trashRawEntries: {
  kind: "invoke",
  channel: "synapse:knowledge-base:trash-raw-entries",
  request: trashRawEntriesPayloadSchema,
  response: rawMutationResultSchema,
  handler: (ctx, request) => runGuardedKnowledgeBaseOperation({
    ctx,
    action: "fs.write",
    resource: `managed-knowledge-base:${request.projectId}`,
    source: "knowledgeBase.trashRawEntries",
    run: () => service(ctx).trashRawEntries(request),
  }),
},
selectAndUploadRawFiles: {
  kind: "invoke",
  channel: "synapse:knowledge-base:select-and-upload-raw-files",
  request: z.object({ projectId: z.string().min(1), targetDirectoryPath: z.string() }),
  response: rawMutationResultSchema,
  handler: (ctx, request) => runGuardedKnowledgeBaseOperation({
    ctx,
    action: "fs.write",
    resource: `managed-knowledge-base:${request.projectId}`,
    source: "knowledgeBase.selectAndUploadRawFiles",
    run: async () => {
      const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] })
      if (result.canceled || result.filePaths.length === 0) {
        return { projectId: request.projectId, entries: [], skipped: [] }
      }
      return service(ctx).uploadRawFiles({
        projectId: request.projectId,
        targetDirectoryPath: request.targetDirectoryPath,
        filePaths: result.filePaths,
      })
    },
  }),
},
```

- [ ] **Step 3: Add IPC tests**

In `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`, add tests:

```ts
it("lists raw directory through guarded read permission", async () => {
  const listRawDirectory = vi.fn().mockResolvedValue({
    projectId: "kb-1",
    directoryPath: "",
    entries: [{ name: "docs", relativePath: "docs", kind: "directory", size: null, modifiedAt: "2026-05-24T00:00:00.000Z" }],
  })
  const { harness, permissionGuard } = createHarness({ service: { listRawDirectory } })

  const result = await harness.invoke("synapse:knowledge-base:list-raw-directory", {
    projectId: "kb-1",
    directoryPath: "",
  }) as { entries: unknown[] }

  expect(listRawDirectory).toHaveBeenCalledWith({ projectId: "kb-1", directoryPath: "" })
  expect(result.entries).toHaveLength(1)
  expect(permissionGuard.check).toHaveBeenCalledWith({
    action: "fs.read.outside-userdata",
    actor: { kind: "user" },
    resource: "managed-knowledge-base:kb-1",
    context: { source: "knowledgeBase.listRawDirectory" },
  })
})

it("uploads selected raw files into the requested raw folder", async () => {
  const uploadRawFiles = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
  const { harness, permissionGuard } = createHarness({ service: { uploadRawFiles } })

  await harness.invoke("synapse:knowledge-base:select-and-upload-raw-files", {
    projectId: "kb-1",
    targetDirectoryPath: "docs",
  })

  expect(uploadRawFiles).toHaveBeenCalledWith({
    projectId: "kb-1",
    targetDirectoryPath: "docs",
    filePaths: ["/tmp/source.md"],
  })
  expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
    action: "fs.write",
    context: { source: "knowledgeBase.selectAndUploadRawFiles" },
  }))
})

it("moves and trashes raw entries through guarded write permission", async () => {
  const moveRawEntries = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
  const trashRawEntries = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
  const { harness } = createHarness({ service: { moveRawEntries, trashRawEntries } })

  await harness.invoke("synapse:knowledge-base:move-raw-entries", {
    projectId: "kb-1",
    relativePaths: ["a.md"],
    targetDirectoryPath: "docs",
  })
  await harness.invoke("synapse:knowledge-base:trash-raw-entries", {
    projectId: "kb-1",
    relativePaths: ["docs/a.md"],
  })

  expect(moveRawEntries).toHaveBeenCalledWith({ projectId: "kb-1", relativePaths: ["a.md"], targetDirectoryPath: "docs" })
  expect(trashRawEntries).toHaveBeenCalledWith({ projectId: "kb-1", relativePaths: ["docs/a.md"] })
})
```

- [ ] **Step 4: Update preload IPC channels and bridge**

In `desktop/electron/preload.ts`, add channel names under `"knowledge-base"`:

```ts
"listRawDirectory": "synapse:knowledge-base:list-raw-directory",
"createRawFolder": "synapse:knowledge-base:create-raw-folder",
"uploadRawFiles": "synapse:knowledge-base:upload-raw-files",
"selectAndUploadRawFiles": "synapse:knowledge-base:select-and-upload-raw-files",
"renameRawEntry": "synapse:knowledge-base:rename-raw-entry",
"moveRawEntries": "synapse:knowledge-base:move-raw-entries",
"trashRawEntries": "synapse:knowledge-base:trash-raw-entries",
```

Add bridge methods:

```ts
listRawDirectory: (payload) =>
  invoke(IPC_CHANNELS["knowledge-base"].listRawDirectory)(payload),
createRawFolder: (payload) =>
  invoke(IPC_CHANNELS["knowledge-base"].createRawFolder)(payload),
uploadRawFiles: (payload) =>
  invoke(IPC_CHANNELS["knowledge-base"].uploadRawFiles)(payload),
selectAndUploadRawFiles: (payload) =>
  invoke(IPC_CHANNELS["knowledge-base"].selectAndUploadRawFiles)(payload),
renameRawEntry: (payload) =>
  invoke(IPC_CHANNELS["knowledge-base"].renameRawEntry)(payload),
moveRawEntries: (payload) =>
  invoke(IPC_CHANNELS["knowledge-base"].moveRawEntries)(payload),
trashRawEntries: (payload) =>
  invoke(IPC_CHANNELS["knowledge-base"].trashRawEntries)(payload),
```

In `desktop/src/types/bridge.ts`, add matching methods to `knowledgeBase`:

```ts
listRawDirectory: (payload: SynapseKnowledgeBaseListRawDirectoryPayload) => Promise<SynapseKnowledgeBaseListRawDirectoryResult>
createRawFolder: (payload: SynapseKnowledgeBaseCreateRawFolderPayload) => Promise<SynapseKnowledgeBaseRawMutationResult>
uploadRawFiles: (payload: SynapseKnowledgeBaseUploadRawFilesPayload) => Promise<SynapseKnowledgeBaseRawMutationResult>
selectAndUploadRawFiles: (payload: { projectId: string; targetDirectoryPath: string }) => Promise<SynapseKnowledgeBaseRawMutationResult>
renameRawEntry: (payload: SynapseKnowledgeBaseRenameRawEntryPayload) => Promise<SynapseKnowledgeBaseRawMutationResult>
moveRawEntries: (payload: SynapseKnowledgeBaseMoveRawEntriesPayload) => Promise<SynapseKnowledgeBaseRawMutationResult>
trashRawEntries: (payload: SynapseKnowledgeBaseTrashRawEntriesPayload) => Promise<SynapseKnowledgeBaseRawMutationResult>
```

Add any missing imports from `@/types/knowledge-base`.

- [ ] **Step 5: Regenerate IPC channel file**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: generated IPC metadata updates cleanly.

- [ ] **Step 6: Run IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/knowledge-base/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit IPC and bridge**

Run:

```bash
git add desktop/electron/modules/knowledge-base/ipc.ts desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat: expose knowledge base raw file APIs"
```

---

## Task 4: Replace Renderer Tests For Raw File Manager UI

**Files:**

- Modify: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Replace bridge mocks with raw-manager methods**

Update imports:

```ts
import type {
  SynapseKnowledgeBaseListRawDirectoryResult,
  SynapseKnowledgeBaseRawMutationResult,
} from "@/types/knowledge-base"
```

Use this mock shape in `createBridgeMocks()`:

```ts
knowledgeBase: {
  listRawDirectory: vi.fn<(payload: { projectId: string; directoryPath: string }) => Promise<SynapseKnowledgeBaseListRawDirectoryResult>>()
    .mockResolvedValue({
      projectId: "project-1",
      directoryPath: "",
      entries: [
        { name: "项目A", relativePath: "项目A", kind: "directory", size: null, modifiedAt: "2026-05-24T10:00:00.000Z" },
        { name: "产品需求.md", relativePath: "产品需求.md", kind: "file", size: 43008, modifiedAt: "2026-05-23T14:20:00.000Z" },
      ],
    }),
  createRawFolder: vi.fn<(...args: never[]) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
    .mockResolvedValue({ projectId: "project-1", entries: [], skipped: [] }),
  uploadRawFiles: vi.fn<(...args: never[]) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
    .mockResolvedValue({ projectId: "project-1", entries: [], skipped: [] }),
  selectAndUploadRawFiles: vi.fn<(...args: never[]) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
    .mockResolvedValue({ projectId: "project-1", entries: [], skipped: [] }),
  renameRawEntry: vi.fn<(...args: never[]) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
    .mockResolvedValue({ projectId: "project-1", entries: [], skipped: [] }),
  moveRawEntries: vi.fn<(...args: never[]) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
    .mockResolvedValue({ projectId: "project-1", entries: [], skipped: [] }),
  trashRawEntries: vi.fn<(...args: never[]) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
    .mockResolvedValue({ projectId: "project-1", entries: [], skipped: [] }),
  filePathForDroppedFile: vi.fn<(file: File) => string | null>(() => null),
},
```

- [ ] **Step 2: Write tests for raw list, no status, and current-folder search**

Replace the first renderer test with:

```ts
it("renders a raw file browser without import statuses", async () => {
  renderWindow()

  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("产品需求.md")
  })

  expect(document.body.textContent).toContain("资料")
  expect(document.body.textContent).toContain("新建文件夹")
  expect(document.body.textContent).toContain("上传文件")
  expect(document.body.textContent).toContain("项目A")
  expect(document.body.textContent).not.toContain("新文件")
  expect(document.body.textContent).not.toContain("有更新")
  expect(document.body.textContent).not.toContain("已放入")
  expect(document.body.textContent).not.toContain("粘贴网页 URL")

  const searchInput = document.querySelector<HTMLInputElement>('input[placeholder="搜索当前文件夹"]')
  expect(searchInput).not.toBeNull()

  act(() => {
    changeInput(searchInput!, "产品")
  })

  expect(visibleRowsText()).toContain("产品需求.md")
  expect(visibleRowsText()).not.toContain("项目A")
})
```

- [ ] **Step 3: Write tests for folder navigation and upload target**

Add:

```ts
it("navigates into folders and uploads files to the current folder", async () => {
  bridgeMocks.knowledgeBase.listRawDirectory
    .mockResolvedValueOnce({
      projectId: "project-1",
      directoryPath: "",
      entries: [{ name: "项目A", relativePath: "项目A", kind: "directory", size: null, modifiedAt: "2026-05-24T10:00:00.000Z" }],
    })
    .mockResolvedValueOnce({
      projectId: "project-1",
      directoryPath: "项目A",
      entries: [],
    })
  renderWindow()

  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("项目A")
  })

  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="打开 项目A"]')?.click()
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.listRawDirectory).toHaveBeenLastCalledWith({
    projectId: "project-1",
    directoryPath: "项目A",
  })

  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="上传文件"]')?.click()
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.selectAndUploadRawFiles).toHaveBeenCalledWith({
    projectId: "project-1",
    targetDirectoryPath: "项目A",
  })
})
```

- [ ] **Step 4: Write tests for multi-select batch delete and dropped files**

Add:

```ts
it("supports multi-select batch trash", async () => {
  renderWindow()

  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("产品需求.md")
  })

  const checkboxes = [...document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')]
  expect(checkboxes.length).toBeGreaterThanOrEqual(2)

  await act(async () => {
    checkboxes[1]?.click()
    await Promise.resolve()
  })

  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="删除所选"]')?.click()
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.trashRawEntries).toHaveBeenCalledWith({
    projectId: "project-1",
    relativePaths: ["项目A"],
  })
})

it("uploads dropped files to the current raw directory", async () => {
  renderWindow()
  bridgeMocks.knowledgeBase.filePathForDroppedFile.mockReturnValue("/tmp/diagram.png")

  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("产品需求.md")
  })

  const dropTarget = document.querySelector<HTMLElement>('[aria-label="资料管理"]')
  if (!dropTarget) throw new Error("Drop target not found.")

  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", {
    value: { files: [new File(["image"], "diagram.png", { type: "image/png" })] },
  })

  await act(async () => {
    dropTarget.dispatchEvent(event)
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.uploadRawFiles).toHaveBeenCalledWith({
    projectId: "project-1",
    targetDirectoryPath: "",
    filePaths: ["/tmp/diagram.png"],
  })
})
```

- [ ] **Step 5: Run renderer test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: FAIL because the UI still renders source statuses and old upload APIs.

---

## Task 5: Implement Renderer Raw File Browser

**Files:**

- Modify: `desktop/src/modules/knowledge-base/source-manager-window.tsx`
- Modify: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Replace imports**

Use these imports in `source-manager-window.tsx`:

```tsx
import { type DragEvent, useCallback, useEffect, useMemo, useState } from "react"
import { ChevronRight, File, Folder, MoreHorizontal, Plus, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAppNotifications } from "@/app-shell/notifications"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { cn } from "@/lib/utils"
import type {
  SynapseKnowledgeBaseOpenSourceManagerPayload,
  SynapseKnowledgeBaseRawEntry,
} from "@/types/knowledge-base"
```

- [ ] **Step 2: Add renderer helpers**

Place these helpers above the component:

```tsx
function pathSegments(directoryPath: string): string[] {
  return directoryPath.split("/").filter(Boolean)
}

function pathForCrumb(segments: readonly string[], index: number): string {
  return segments.slice(0, index + 1).join("/")
}

function formatBytes(size: number | null): string {
  if (size === null) return "--"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatModifiedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function matchesSearch(entry: SynapseKnowledgeBaseRawEntry, keyword: string): boolean {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return true
  return `${entry.name}\n${entry.relativePath}`.toLowerCase().includes(normalized)
}
```

- [ ] **Step 3: Replace component state and data loading**

Inside `KnowledgeBaseSourceManagerWindow`, use:

```tsx
const { error: showError, promise } = useAppNotifications()
const [entries, setEntries] = useState<SynapseKnowledgeBaseRawEntry[]>([])
const [currentDirectory, setCurrentDirectory] = useState("")
const [query, setQuery] = useState("")
const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set())
const [isLoading, setIsLoading] = useState(false)
const [isDragging, setIsDragging] = useState(false)
const bridge = getSynapseBridge()

const refreshEntries = useCallback(async (directoryPath = currentDirectory) => {
  if (!payload || !bridge) return
  setIsLoading(true)
  try {
    const result = await bridge.knowledgeBase.listRawDirectory({
      projectId: payload.projectId,
      directoryPath,
    })
    setEntries(result.entries)
    setCurrentDirectory(result.directoryPath)
    setSelectedPaths(new Set())
  } catch (error) {
    logger.error("Failed to load knowledge base raw directory.", { error })
    showError("读取资料失败")
  } finally {
    setIsLoading(false)
  }
}, [bridge, currentDirectory, payload, showError])
```

Keep `useEffect(() => { void refreshEntries("") }, [refreshEntries])`.

- [ ] **Step 4: Add operation callbacks**

Add callbacks:

```tsx
const uploadFiles = useCallback(async (filePaths: string[]) => {
  if (!payload || !bridge || filePaths.length === 0) return
  await promise(
    async () => {
      const result = await bridge.knowledgeBase.uploadRawFiles({
        projectId: payload.projectId,
        targetDirectoryPath: currentDirectory,
        filePaths,
      })
      await refreshEntries(currentDirectory)
      return result
    },
    {
      loading: "正在上传",
      success: (result) => result.entries.length > 0 ? "已上传" : "没有可上传的文件",
      error: "上传失败",
    },
  )
}, [bridge, currentDirectory, payload, promise, refreshEntries])

const chooseFiles = useCallback(async () => {
  if (!payload || !bridge) return
  await promise(
    async () => {
      const result = await bridge.knowledgeBase.selectAndUploadRawFiles({
        projectId: payload.projectId,
        targetDirectoryPath: currentDirectory,
      })
      await refreshEntries(currentDirectory)
      return result
    },
    { loading: "正在上传", success: (result) => result.entries.length > 0 ? "已上传" : null, error: "上传失败" },
  )
}, [bridge, currentDirectory, payload, promise, refreshEntries])

```

- [ ] **Step 5: Add dialog and selection callbacks**

Add this state inside `KnowledgeBaseSourceManagerWindow`:

```tsx
const [createFolderOpen, setCreateFolderOpen] = useState(false)
const [createFolderName, setCreateFolderName] = useState("")
const [renameTarget, setRenameTarget] = useState<SynapseKnowledgeBaseRawEntry | null>(null)
const [renameValue, setRenameValue] = useState("")
const [moveTargetPaths, setMoveTargetPaths] = useState<string[]>([])
const [moveDestination, setMoveDestination] = useState("")
```

Add these callbacks inside `KnowledgeBaseSourceManagerWindow`:

```tsx
const visibleEntries = useMemo(
  () => entries.filter((entry) => matchesSearch(entry, query)),
  [entries, query],
)

const toggleSelected = useCallback((relativePath: string, selected: boolean) => {
  setSelectedPaths((current) => {
    const next = new Set(current)
    if (selected) {
      next.add(relativePath)
    } else {
      next.delete(relativePath)
    }
    return next
  })
}, [])

const createFolder = useCallback(async () => {
  if (!payload || !bridge) return
  const name = createFolderName.trim()
  if (!name) return
  await promise(
    async () => {
      const result = await bridge.knowledgeBase.createRawFolder({
        projectId: payload.projectId,
        parentDirectoryPath: currentDirectory,
        name,
      })
      setCreateFolderName("")
      setCreateFolderOpen(false)
      await refreshEntries(currentDirectory)
      return result
    },
    { loading: "正在创建", success: "已创建", error: "创建失败" },
  )
}, [bridge, createFolderName, currentDirectory, payload, promise, refreshEntries])

const openRenameDialog = useCallback((entry: SynapseKnowledgeBaseRawEntry) => {
  setRenameTarget(entry)
  setRenameValue(entry.name)
}, [])

const renameEntry = useCallback(async () => {
  if (!payload || !bridge || !renameTarget) return
  const newName = renameValue.trim()
  if (!newName) return
  await promise(
    async () => {
      const result = await bridge.knowledgeBase.renameRawEntry({
        projectId: payload.projectId,
        relativePath: renameTarget.relativePath,
        newName,
      })
      setRenameTarget(null)
      setRenameValue("")
      await refreshEntries(currentDirectory)
      return result
    },
    { loading: "正在重命名", success: "已重命名", error: "重命名失败" },
  )
}, [bridge, currentDirectory, payload, promise, refreshEntries, renameTarget, renameValue])

const openMoveDialog = useCallback((relativePaths: string[]) => {
  setMoveTargetPaths(relativePaths)
  setMoveDestination("")
}, [])

const moveEntries = useCallback(async () => {
  if (!payload || !bridge || moveTargetPaths.length === 0) return
  await promise(
    async () => {
      const result = await bridge.knowledgeBase.moveRawEntries({
        projectId: payload.projectId,
        relativePaths: moveTargetPaths,
        targetDirectoryPath: moveDestination.trim(),
      })
      setMoveTargetPaths([])
      setMoveDestination("")
      await refreshEntries(currentDirectory)
      return result
    },
    { loading: "正在移动", success: "已移动", error: "移动失败" },
  )
}, [bridge, currentDirectory, moveDestination, moveTargetPaths, payload, promise, refreshEntries])

const trashEntries = useCallback(async (relativePaths: string[]) => {
  if (!payload || !bridge || relativePaths.length === 0) return
  await promise(
    async () => {
      const result = await bridge.knowledgeBase.trashRawEntries({
        projectId: payload.projectId,
        relativePaths,
      })
      await refreshEntries(currentDirectory)
      return result
    },
    { loading: "正在删除", success: "已移到废纸篓", error: "删除失败" },
  )
}, [bridge, currentDirectory, payload, promise, refreshEntries])

const trashSelected = useCallback(async () => {
  await trashEntries([...selectedPaths])
}, [selectedPaths, trashEntries])

const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
  event.preventDefault()
  setIsDragging(false)
  if (!bridge) return
  const filePaths = Array.from(event.dataTransfer.files)
    .map((file) => bridge.knowledgeBase.filePathForDroppedFile(file))
    .filter((filePath): filePath is string => Boolean(filePath))
  void uploadFiles(filePaths)
}, [bridge, uploadFiles])
```

Add these dialogs inside the returned `<main>` after the list section:

```tsx
<Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>新建文件夹</DialogTitle>
    </DialogHeader>
    <Input value={createFolderName} onChange={(event) => setCreateFolderName(event.target.value)} />
    <DialogFooter>
      <Button type="button" variant="outline" onClick={() => setCreateFolderOpen(false)}>取消</Button>
      <Button type="button" onClick={createFolder}>创建</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

<Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>重命名</DialogTitle>
    </DialogHeader>
    <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
    <DialogFooter>
      <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>取消</Button>
      <Button type="button" onClick={renameEntry}>保存</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

<Dialog open={moveTargetPaths.length > 0} onOpenChange={(open) => !open && setMoveTargetPaths([])}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>移动到</DialogTitle>
    </DialogHeader>
    <Input
      value={moveDestination}
      onChange={(event) => setMoveDestination(event.target.value)}
      placeholder="目标文件夹，留空为资料"
    />
    <DialogFooter>
      <Button type="button" variant="outline" onClick={() => setMoveTargetPaths([])}>取消</Button>
      <Button type="button" onClick={moveEntries}>移动</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 6: Replace render structure**

Render a single full-window file manager:

```tsx
return (
  <main
    aria-label="资料管理"
    className={cn("flex h-screen flex-col bg-background text-foreground", isDragging && "bg-accent")}
    onDragOver={(event) => {
      event.preventDefault()
      setIsDragging(true)
    }}
    onDragLeave={() => setIsDragging(false)}
    onDrop={handleDrop}
  >
    <header className="flex shrink-0 items-center gap-2 border-b border-border p-3">
      <Button type="button" variant="ghost" size="sm" onClick={() => void refreshEntries("")}>资料</Button>
      {pathSegments(currentDirectory).map((segment, index, segments) => (
        <div key={pathForCrumb(segments, index)} className="flex items-center gap-2">
          <ChevronRight className="size-4 text-muted-foreground" />
          <Button type="button" variant="ghost" size="sm" onClick={() => void refreshEntries(pathForCrumb(segments, index))}>
            {segment}
          </Button>
        </div>
      ))}
    </header>

    <section className="flex shrink-0 items-center gap-2 border-b border-border p-3">
      <Button type="button" variant="outline" onClick={() => setCreateFolderOpen(true)}>
        <Plus data-icon="inline-start" />
        新建文件夹
      </Button>
      <Button type="button" onClick={chooseFiles} aria-label="上传文件">
        <Upload data-icon="inline-start" />
        上传文件
      </Button>
      {selectedPaths.size > 0 ? (
        <Button type="button" variant="outline" onClick={trashSelected} aria-label="删除所选">
          <Trash2 data-icon="inline-start" />
          删除
        </Button>
      ) : null}
      <Input
        className="ml-auto max-w-xs"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索当前文件夹"
      />
    </section>

    <section className="min-h-0 flex-1 overflow-auto p-4">
      <Table className="table-fixed">
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-24" />
          <col className="w-32" />
          <col className="w-12" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Checkbox
                checked={visibleEntries.length > 0 && visibleEntries.every((entry) => selectedPaths.has(entry.relativePath))}
                onCheckedChange={(checked) => setSelectedPaths(checked ? new Set(visibleEntries.map((entry) => entry.relativePath)) : new Set())}
              />
            </TableHead>
            <TableHead>名称</TableHead>
            <TableHead className="text-right">大小</TableHead>
            <TableHead className="text-right">修改时间</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleEntries.map((entry) => (
            <TableRow key={entry.relativePath}>
              <TableCell>
                <Checkbox
                  checked={selectedPaths.has(entry.relativePath)}
                  onCheckedChange={(checked) => toggleSelected(entry.relativePath, checked === true)}
                />
              </TableCell>
              <TableCell className="max-w-0 overflow-hidden">
                <button
                  type="button"
                  aria-label={entry.kind === "directory" ? `打开 ${entry.name}` : entry.name}
                  className="flex min-w-0 items-center gap-2"
                  onClick={() => entry.kind === "directory" ? void refreshEntries(entry.relativePath) : undefined}
                >
                  {entry.kind === "directory" ? <Folder className="size-4" /> : <File className="size-4" />}
                  <span className="truncate font-medium">{entry.name}</span>
                </button>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatBytes(entry.size)}</TableCell>
              <TableCell className="text-right text-muted-foreground">{formatModifiedAt(entry.modifiedAt)}</TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label={`${entry.name} 更多操作`}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openRenameDialog(entry)}>重命名</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openMoveDialog([entry.relativePath])}>移动到</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => void trashEntries([entry.relativePath])}>删除</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
          {visibleEntries.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5}>
                <Empty className="border-0">
                  <EmptyHeader>
                    <EmptyTitle>{isLoading ? "读取中" : query ? "没有匹配资料" : "没有文件"}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </section>
  </main>
)
```

- [ ] **Step 7: Add batch move to the toolbar**

Add a toolbar button next to batch delete:

```tsx
{selectedPaths.size > 0 ? (
  <Button type="button" variant="outline" onClick={() => openMoveDialog([...selectedPaths])} aria-label="移动所选">
    移动到
  </Button>
) : null}
```

- [ ] **Step 8: Run renderer test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit renderer UI**

Run:

```bash
git add desktop/src/modules/knowledge-base/source-manager-window.tsx desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
git commit -m "feat: make knowledge base manager browse raw files"
```

---

## Task 6: Final Verification And Constraint Checks

**Files:**

- Review all changed files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts electron/modules/knowledge-base/__tests__/ipc.test.ts src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect diff for excluded behavior**

Run:

```bash
git diff --stat
rg -n "manifest|wiki/|Claude Code|createSession|agent.send|status|新文件|有更新|已放入|粘贴网页 URL" desktop/src/modules/knowledge-base desktop/electron/services/knowledge-base desktop/electron/modules/knowledge-base desktop/src/types/knowledge-base.ts
```

Expected:

- No renderer source-manager UI labels for import status.
- No new code that writes `.raw/.manifest.json`.
- No new code that edits `wiki/`.
- No new code that launches Agent or Claude Code.

- [ ] **Step 5: Commit verification fixes when files changed**

When Step 1-4 require code changes, commit the exact files changed by those fixes:

```bash
git add desktop/electron/services/knowledge-base desktop/electron/modules/knowledge-base desktop/src/modules/knowledge-base desktop/src/types/knowledge-base.ts desktop/src/types/bridge.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "fix: harden knowledge base raw file manager"
```

When Step 1-4 pass with no file changes, skip this step.
