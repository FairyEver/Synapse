# Knowledge Base File Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add natural Knowledge Base raw file management: folder upload, row and batch export, and internal drag-to-folder movement.

**Architecture:** Extend the existing Knowledge Base raw file manager rather than creating a parallel service. New import and export operations stay in Electron, go through typed IPC and preload bridge methods, validate raw-relative paths, and keep the renderer away from real managed backing paths. The renderer remains the existing two-pane source manager and adds only focused controls and drag state.

**Tech Stack:** Electron main process, TypeScript, React, shadcn/Radix UI, lucide-react, Vitest, pnpm IPC codegen.

---

## Scope Notes

- Source spec: `docs/superpowers/specs/2026-06-02-knowledge-base-file-management-design.md`.
- Existing `moveRawEntries`, `renameRawEntry`, and `trashRawEntries` currently synchronize manifest state in `KnowledgeBaseService`. This plan does not change those existing behaviors. New `uploadRawItems`, `selectAndUploadRawDirectory`, and `exportRawEntries` must not convert files, ingest sources, update `wiki/`, or add manifest writes.
- Existing unrelated untracked preview files under `docs/superpowers/previews/` are not part of this work.

## File Structure

- Modify `desktop/src/types/knowledge-base.ts`: add typed payloads for raw item upload and raw entry export; extend skip reasons.
- Modify `desktop/src/types/bridge.ts`: expose the new Knowledge Base bridge methods.
- Modify `desktop/electron/services/knowledge-base/raw-file-manager.ts`: add recursive copy helpers, `uploadItems`, and `exportEntries`.
- Modify `desktop/electron/services/knowledge-base/knowledge-base-service.ts`: add service wrappers for `uploadRawItems` and `exportRawEntries`.
- Modify `desktop/electron/modules/knowledge-base/ipc.ts`: add schemas and guarded IPC handlers for upload items, folder picker upload, and export.
- Modify `desktop/electron/preload.ts`: add IPC channel constants and bridge wrappers.
- Generated: `desktop/electron/generated/ipc-channels.generated.ts`, updated by `pnpm --filter @synapse/desktop run generate:ipc`.
- Modify `desktop/src/modules/knowledge-base/source-manager-window.tsx`: add `上传文件夹`, export actions, upload items path, and internal drag move behavior.
- Modify `desktop/electron/services/knowledge-base/__tests__/raw-file-manager.test.ts`: add service-level recursive copy/export coverage.
- Modify `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`: add service wrapper coverage.
- Modify `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`: add IPC permission/dialog coverage.
- Modify `desktop/electron/__tests__/preload.test.ts`: add bridge channel coverage for the new Knowledge Base methods.
- Modify `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`: add renderer behavior coverage.
- Modify `RELEASE_NOTES_PENDING.md`: add user-facing release note after implementation.

---

### Task 1: Raw File Manager Recursive Copy And Export

**Files:**
- Modify: `desktop/electron/services/knowledge-base/raw-file-manager.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/raw-file-manager.test.ts`

- [ ] **Step 1: Write failing tests for recursive upload and skipped entries**

First update the top import in `desktop/electron/services/knowledge-base/__tests__/raw-file-manager.test.ts`:

```ts
import { mkdir, readFile, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
```

Append these tests inside `describe("KnowledgeBaseRawFileManager", () => { ... })`.

```ts

it("uploads folders recursively while preserving structure and skipping system noise", async () => {
  const rawRoot = await tempDir()
  const sourceRoot = await tempDir()
  const folder = path.join(sourceRoot, "会议资料")
  await mkdir(path.join(folder, "访谈"), { recursive: true })
  await writeFile(path.join(folder, "01.pdf"), "pdf\n", "utf8")
  await writeFile(path.join(folder, ".DS_Store"), "noise\n", "utf8")
  await writeFile(path.join(folder, "访谈", ".gitignore"), "keep\n", "utf8")
  await writeFile(path.join(folder, "访谈", "a.md"), "note\n", "utf8")
  const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

  const result = await manager.uploadItems(rawRoot, "项目A", [folder])

  expect(result.skipped).toEqual([{ path: path.join(folder, ".DS_Store"), reason: "system-noise" }])
  expect(result.entries.map((entry) => entry.relativePath).sort()).toEqual([
    "项目A/会议资料",
    "项目A/会议资料/01.pdf",
    "项目A/会议资料/访谈",
    "项目A/会议资料/访谈/.gitignore",
    "项目A/会议资料/访谈/a.md",
  ])
  await expect(readFile(path.join(rawRoot, "项目A", "会议资料", "访谈", ".gitignore"), "utf8"))
    .resolves.toBe("keep\n")
})

it("merges folder collisions and renames colliding files during recursive upload", async () => {
  const rawRoot = await tempDir()
  await mkdir(path.join(rawRoot, "项目A", "会议资料"), { recursive: true })
  await writeFile(path.join(rawRoot, "项目A", "会议资料", "01.pdf"), "old\n", "utf8")
  const sourceRoot = await tempDir()
  const folder = path.join(sourceRoot, "会议资料")
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, "01.pdf"), "new\n", "utf8")
  const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

  const result = await manager.uploadItems(rawRoot, "项目A", [folder])

  expect(result.skipped).toEqual([])
  expect(result.entries.map((entry) => entry.relativePath).sort()).toEqual([
    "项目A/会议资料",
    "项目A/会议资料/01-2.pdf",
  ])
  await expect(readFile(path.join(rawRoot, "项目A", "会议资料", "01.pdf"), "utf8"))
    .resolves.toBe("old\n")
  await expect(readFile(path.join(rawRoot, "项目A", "会议资料", "01-2.pdf"), "utf8"))
    .resolves.toBe("new\n")
})

it("skips symlinks during recursive upload", async () => {
  const rawRoot = await tempDir()
  const sourceRoot = await tempDir()
  const folder = path.join(sourceRoot, "资料")
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(sourceRoot, "real.md"), "real\n", "utf8")
  await symlink(path.join(sourceRoot, "real.md"), path.join(folder, "link.md"))
  const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

  const result = await manager.uploadItems(rawRoot, "", [folder])

  expect(result.entries.map((entry) => entry.relativePath)).toEqual(["资料"])
  expect(result.skipped).toEqual([{ path: path.join(folder, "link.md"), reason: "symlink" }])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/raw-file-manager.test.ts
```

Expected: FAIL because `uploadItems` is not defined.

- [ ] **Step 3: Implement recursive copy helpers and `uploadItems`**

In `desktop/electron/services/knowledge-base/raw-file-manager.ts`, update imports:

```ts
import { access, copyFile, lstat, mkdir, readdir, rename } from "node:fs/promises"
```

Add `uploadItems` inside `KnowledgeBaseRawFileManager` after `uploadFiles`:

```ts
  async uploadItems(
    rawRoot: string,
    targetDirectoryPath: string,
    itemPaths: readonly string[],
  ): Promise<Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">> {
    const targetDirectory = resolveRawPath(rawRoot, targetDirectoryPath)
    await assertNoSymlinkInRawPath(rawRoot, targetDirectoryPath)
    await mkdir(targetDirectory, { recursive: true })
    const entries: SynapseKnowledgeBaseRawEntry[] = []
    const skipped: SynapseKnowledgeBaseRawMutationResult["skipped"] = []
    for (const itemPath of itemPaths) {
      await this.copyExternalItem(rawRoot, itemPath, targetDirectory, entries, skipped)
    }
    return { entries: sortEntries(entries), skipped }
  }
```

Add these private methods inside the class:

```ts
  private async copyExternalItem(
    rawRoot: string,
    sourcePath: string,
    targetDirectory: string,
    entries: SynapseKnowledgeBaseRawEntry[],
    skipped: SynapseKnowledgeBaseRawMutationResult["skipped"],
  ): Promise<void> {
    try {
      const resolvedSource = path.resolve(sourcePath)
      const stat = await lstat(resolvedSource)
      if (isSystemNoiseFile(path.basename(resolvedSource))) {
        skipped.push({ path: sourcePath, reason: "system-noise" })
        return
      }
      if (stat.isSymbolicLink()) {
        skipped.push({ path: sourcePath, reason: "symlink" })
        return
      }
      if (stat.isFile()) {
        const targetPath = await copyFileToAvailablePath(resolvedSource, targetDirectory, path.basename(resolvedSource))
        entries.push(await entryForPath(rawRoot, targetPath, "file"))
        return
      }
      if (stat.isDirectory()) {
        await this.copyExternalDirectory(rawRoot, resolvedSource, targetDirectory, entries, skipped)
        return
      }
      skipped.push({ path: sourcePath, reason: "read-error" })
    } catch (error) {
      knowledgeBaseLogger.warn("Knowledge Base raw item upload skipped.", {
        itemName: path.basename(sourcePath),
        reason: "read-error",
        ...knowledgeBaseErrorMeta(error),
      })
      skipped.push({ path: sourcePath, reason: "read-error" })
    }
  }

  private async copyExternalDirectory(
    rawRoot: string,
    sourceDirectory: string,
    targetDirectory: string,
    entries: SynapseKnowledgeBaseRawEntry[],
    skipped: SynapseKnowledgeBaseRawMutationResult["skipped"],
  ): Promise<void> {
    const targetPath = path.join(targetDirectory, path.basename(sourceDirectory))
    await mkdir(targetPath, { recursive: true })
    entries.push(await entryForPath(rawRoot, targetPath, "directory"))
    const children = await readdir(sourceDirectory, { withFileTypes: true })
    for (const child of children) {
      await this.copyExternalItem(rawRoot, path.join(sourceDirectory, child.name), targetPath, entries, skipped)
    }
  }
```

Add helper:

```ts
function isSystemNoiseFile(name: string): boolean {
  return name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini"
}
```

- [ ] **Step 4: Run raw manager upload tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/raw-file-manager.test.ts
```

Expected: PASS for upload tests.

- [ ] **Step 5: Write failing tests for export**

Append:

```ts
it("exports a file to an external directory with collision-safe names", async () => {
  const rawRoot = await tempDir()
  const exportRoot = await tempDir()
  await writeFile(path.join(rawRoot, "brief.md"), "new\n", "utf8")
  await writeFile(path.join(exportRoot, "brief.md"), "old\n", "utf8")
  const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

  const result = await manager.exportEntries(rawRoot, ["brief.md"], exportRoot)

  expect(result.skipped).toEqual([])
  expect(result.entries.map((entry) => entry.relativePath)).toEqual(["brief.md"])
  await expect(readFile(path.join(exportRoot, "brief.md"), "utf8")).resolves.toBe("old\n")
  await expect(readFile(path.join(exportRoot, "brief-2.md"), "utf8")).resolves.toBe("new\n")
})

it("exports a folder shell and merges destination folder collisions", async () => {
  const rawRoot = await tempDir()
  const exportRoot = await tempDir()
  await mkdir(path.join(rawRoot, "会议资料", "访谈"), { recursive: true })
  await writeFile(path.join(rawRoot, "会议资料", "01.pdf"), "new\n", "utf8")
  await mkdir(path.join(exportRoot, "会议资料"), { recursive: true })
  await writeFile(path.join(exportRoot, "会议资料", "01.pdf"), "old\n", "utf8")
  const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

  const result = await manager.exportEntries(rawRoot, ["会议资料"], exportRoot)

  expect(result.skipped).toEqual([])
  expect(result.entries.map((entry) => entry.relativePath).sort()).toEqual([
    "会议资料",
    "会议资料/01.pdf",
    "会议资料/访谈",
  ])
  await expect(readFile(path.join(exportRoot, "会议资料", "01.pdf"), "utf8")).resolves.toBe("old\n")
  await expect(readFile(path.join(exportRoot, "会议资料", "01-2.pdf"), "utf8")).resolves.toBe("new\n")
})

it("rejects raw path traversal during export", async () => {
  const rawRoot = await tempDir()
  const exportRoot = await tempDir()
  const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

  const result = await manager.exportEntries(rawRoot, ["../secret.md"], exportRoot)

  expect(result.entries).toEqual([])
  expect(result.skipped).toEqual([{ path: "../secret.md", reason: "invalid-path" }])
})
```

- [ ] **Step 6: Run tests to verify export tests fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/raw-file-manager.test.ts
```

Expected: FAIL because `exportEntries` is not defined.

- [ ] **Step 7: Implement `exportEntries`**

Add inside `KnowledgeBaseRawFileManager`:

```ts
  async exportEntries(
    rawRoot: string,
    relativePaths: readonly string[],
    targetDirectoryPath: string,
  ): Promise<Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">> {
    const targetDirectory = path.resolve(targetDirectoryPath)
    await mkdir(targetDirectory, { recursive: true })
    const entries: SynapseKnowledgeBaseRawEntry[] = []
    const skipped: SynapseKnowledgeBaseRawMutationResult["skipped"] = []
    for (const relativePath of relativePaths) {
      try {
        const source = resolveRawPath(rawRoot, relativePath)
        await assertNoSymlinkInRawPath(rawRoot, relativePath)
        await this.copyRawEntryForExport(rawRoot, source, targetDirectory, entries, skipped)
      } catch (error) {
        const reason = isInvalidRawPathError(error) ? "invalid-path" : "export-error"
        knowledgeBaseLogger.warn("Knowledge Base raw entry export skipped.", {
          reason,
          relativePath,
          ...knowledgeBaseErrorMeta(error),
        })
        skipped.push({ path: relativePath, reason })
      }
    }
    return { entries: sortEntries(entries), skipped }
  }

  private async copyRawEntryForExport(
    rawRoot: string,
    sourcePath: string,
    targetDirectory: string,
    entries: SynapseKnowledgeBaseRawEntry[],
    skipped: SynapseKnowledgeBaseRawMutationResult["skipped"],
  ): Promise<void> {
    const stat = await lstat(sourcePath)
    if (isSystemNoiseFile(path.basename(sourcePath))) {
      skipped.push({ path: normalizeRelativePath(path.relative(rawRoot, sourcePath)), reason: "system-noise" })
      return
    }
    if (stat.isSymbolicLink()) {
      skipped.push({ path: normalizeRelativePath(path.relative(rawRoot, sourcePath)), reason: "symlink" })
      return
    }
    if (stat.isFile()) {
      await copyFileToAvailablePath(sourcePath, targetDirectory, path.basename(sourcePath))
      entries.push(await entryForPath(rawRoot, sourcePath, "file"))
      return
    }
    if (stat.isDirectory()) {
      const targetPath = path.join(targetDirectory, path.basename(sourcePath))
      await mkdir(targetPath, { recursive: true })
      entries.push(await entryForPath(rawRoot, sourcePath, "directory"))
      const children = await readdir(sourcePath, { withFileTypes: true })
      for (const child of children) {
        await this.copyRawEntryForExport(rawRoot, path.join(sourcePath, child.name), targetPath, entries, skipped)
      }
    }
  }
```

- [ ] **Step 8: Run raw manager tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/raw-file-manager.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit raw manager changes**

Run:

```bash
git add desktop/electron/services/knowledge-base/raw-file-manager.ts desktop/electron/services/knowledge-base/__tests__/raw-file-manager.test.ts
git commit -m "feat(desktop): add knowledge base raw recursive copy"
```

Expected: commit succeeds.

---

### Task 2: Knowledge Base Types And Service Wrappers

**Files:**
- Modify: `desktop/src/types/knowledge-base.ts`
- Modify: `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`

- [ ] **Step 1: Write failing service wrapper tests**

Append to `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts` near existing raw file manager tests:

```ts
it("uploads raw items without invoking source conversion", async () => {
  const projectPath = await createManagedKnowledgeBaseFixture()
  const externalRoot = await tempDir()
  const folder = path.join(externalRoot, "会议资料")
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, "01.pdf"), "pdf\n", "utf8")
  const convert = vi.fn()
  const service = new KnowledgeBaseService({
    loadConfig: async () => createConfigForManagedProject(projectPath),
    fileConversionService: { convert },
  })

  const result = await service.uploadRawItems({
    projectId: "kb-1",
    targetDirectoryPath: "",
    itemPaths: [folder],
  })

  expect(result.projectId).toBe("kb-1")
  expect(result.entries.map((entry) => entry.relativePath)).toContain("会议资料/01.pdf")
  expect(convert).not.toHaveBeenCalled()
})

it("exports raw entries through the raw file manager", async () => {
  const projectPath = await createManagedKnowledgeBaseFixture()
  const targetRoot = await tempDir()
  await mkdir(path.join(projectPath, ".raw"), { recursive: true })
  await writeFile(path.join(projectPath, ".raw", "brief.md"), "brief\n", "utf8")
  const service = new KnowledgeBaseService({
    loadConfig: async () => createConfigForManagedProject(projectPath),
  })

  const result = await service.exportRawEntries({
    projectId: "kb-1",
    relativePaths: ["brief.md"],
    targetDirectoryPath: targetRoot,
  })

  expect(result).toEqual(expect.objectContaining({
    projectId: "kb-1",
    skipped: [],
  }))
  await expect(readFile(path.join(targetRoot, "brief.md"), "utf8")).resolves.toBe("brief\n")
})
```

Add this helper near the existing test helpers:

```ts
function createConfigForManagedProject(projectPath: string): SynapseConfig {
  return {
    activeRepoUuid: "kb-1",
    repositories: [],
    global: {
      projects: [{
        id: "kb-1",
        name: "Knowledge",
        path: "synapse-kb://kb-1",
        capabilities: {
          knowledgeBase: {
            enabled: true,
            schemaVersion: 1,
            templateVersion: "2026-05-24",
            managed: true,
            runtimeId: "kb-1",
          },
        },
      }],
    },
    agent: { defaultPermissionMode: "default", defaultProviderModel: null },
  }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: FAIL because `uploadRawItems` and `exportRawEntries` service methods are missing.

- [ ] **Step 3: Add public types**

In `desktop/src/types/knowledge-base.ts`, extend skip reasons:

```ts
export type SynapseKnowledgeBaseRawSkipReason =
  | "not-file"
  | "not-directory"
  | "read-error"
  | "invalid-path"
  | "collision"
  | "trash-error"
  | "symlink"
  | "system-noise"
  | "export-error"
```

Replace the inline `reason` union in `SynapseKnowledgeBaseRawMutationResult`:

```ts
export type SynapseKnowledgeBaseRawMutationResult = {
  projectId: string
  entries: SynapseKnowledgeBaseRawEntry[]
  skipped: Array<{
    path: string
    reason: SynapseKnowledgeBaseRawSkipReason
  }>
}
```

Add payloads:

```ts
export type SynapseKnowledgeBaseUploadRawItemsPayload = {
  projectId: string
  targetDirectoryPath: string
  itemPaths: string[]
}

export type SynapseKnowledgeBaseSelectAndUploadRawDirectoryPayload = {
  projectId: string
  targetDirectoryPath: string
}

export type SynapseKnowledgeBaseExportRawEntriesPayload = {
  projectId: string
  relativePaths: string[]
  targetDirectoryPath: string
}
```

- [ ] **Step 4: Add service wrappers**

Update imports in `desktop/electron/services/knowledge-base/knowledge-base-service.ts` to include new payload types. Add these methods after `uploadRawFiles`:

```ts
  async uploadRawItems(payload: SynapseKnowledgeBaseUploadRawItemsPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const result = await this.rawFileManager.uploadItems(rawRoot, payload.targetDirectoryPath, payload.itemPaths)
    this.recordRawMutation("uploadRawItems", payload.projectId, result)
    return { projectId: payload.projectId, ...result }
  }

  async exportRawEntries(payload: SynapseKnowledgeBaseExportRawEntriesPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const result = await this.rawFileManager.exportEntries(rawRoot, payload.relativePaths, payload.targetDirectoryPath)
    this.recordRawMutation("exportRawEntries", payload.projectId, result)
    return { projectId: payload.projectId, ...result }
  }
```

- [ ] **Step 5: Run focused service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts electron/services/knowledge-base/__tests__/raw-file-manager.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit service and type changes**

Run:

```bash
git add desktop/src/types/knowledge-base.ts desktop/electron/services/knowledge-base/knowledge-base-service.ts desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
git commit -m "feat(desktop): add knowledge base raw import export service"
```

Expected: commit succeeds.

---

### Task 3: IPC, Preload, And Bridge

**Files:**
- Modify: `desktop/electron/modules/knowledge-base/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Generated: `desktop/electron/generated/ipc-channels.generated.ts`
- Test: `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`
- Test: `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Write failing IPC tests**

Append to `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`:

```ts
it("uploads raw items through guarded external read and managed write permissions", async () => {
  const uploadRawItems = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
  const { harness, permissionGuard } = createHarness({ service: { uploadRawItems } })

  await harness.invoke("synapse:knowledge-base:upload-raw-items", {
    projectId: "kb-1",
    targetDirectoryPath: "client-a",
    itemPaths: ["/tmp/folder"],
  })

  expect(uploadRawItems).toHaveBeenCalledWith({
    projectId: "kb-1",
    targetDirectoryPath: "client-a",
    itemPaths: ["/tmp/folder"],
  })
  expect(permissionGuard.check).toHaveBeenNthCalledWith(1, {
    action: "fs.read.outside-userdata",
    actor: { kind: "user" },
    resource: "/tmp/folder",
    context: { source: "knowledgeBase.uploadRawItems.read" },
  })
  expect(permissionGuard.check).toHaveBeenNthCalledWith(2, {
    action: "fs.write",
    actor: { kind: "user" },
    resource: "managed-knowledge-base:kb-1",
    context: { source: "knowledgeBase.uploadRawItems" },
  })
})

it("selects one raw directory into the requested folder", async () => {
  electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/folder"] })
  const uploadRawItems = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
  const { harness } = createHarness({ service: { uploadRawItems } })

  await harness.invoke("synapse:knowledge-base:select-and-upload-raw-directory", {
    projectId: "kb-1",
    targetDirectoryPath: "client-a",
  })

  expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
    properties: ["openDirectory"],
  }))
  expect(uploadRawItems).toHaveBeenCalledWith({
    projectId: "kb-1",
    targetDirectoryPath: "client-a",
    itemPaths: ["/tmp/folder"],
  })
})

it("exports raw entries to a selected external directory", async () => {
  electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/export"] })
  const exportRawEntries = vi.fn().mockResolvedValue({ projectId: "kb-1", entries: [], skipped: [] })
  const { harness, permissionGuard } = createHarness({ service: { exportRawEntries } })

  await harness.invoke("synapse:knowledge-base:export-raw-entries", {
    projectId: "kb-1",
    relativePaths: ["brief.md", "folder"],
  })

  expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
    properties: ["openDirectory", "createDirectory"],
  }))
  expect(exportRawEntries).toHaveBeenCalledWith({
    projectId: "kb-1",
    relativePaths: ["brief.md", "folder"],
    targetDirectoryPath: "/tmp/export",
  })
  expect(permissionGuard.check).toHaveBeenNthCalledWith(1, {
    action: "fs.read.outside-userdata",
    actor: { kind: "user" },
    resource: "managed-knowledge-base:kb-1",
    context: { source: "knowledgeBase.exportRawEntries.read" },
  })
  expect(permissionGuard.check).toHaveBeenNthCalledWith(2, {
    action: "fs.write",
    actor: { kind: "user" },
    resource: "/tmp/export",
    context: { source: "knowledgeBase.exportRawEntries.write" },
  })
})

it("returns an empty export result when directory selection is canceled", async () => {
  electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
  const exportRawEntries = vi.fn()
  const { harness } = createHarness({ service: { exportRawEntries } })

  const result = await harness.invoke("synapse:knowledge-base:export-raw-entries", {
    projectId: "kb-1",
    relativePaths: ["brief.md"],
  })

  expect(exportRawEntries).not.toHaveBeenCalled()
  expect(result).toEqual({ projectId: "kb-1", entries: [], skipped: [] })
})
```

- [ ] **Step 2: Run IPC tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/knowledge-base/__tests__/ipc.test.ts
```

Expected: FAIL because new IPC channels are missing.

- [ ] **Step 3: Add IPC schemas and handlers**

In `desktop/electron/modules/knowledge-base/ipc.ts`, extend `rawMutationResultSchema` reason enum:

```ts
reason: z.enum([
  "not-file",
  "not-directory",
  "read-error",
  "invalid-path",
  "collision",
  "trash-error",
  "symlink",
  "system-noise",
  "export-error",
])
```

Add schemas:

```ts
const uploadRawItemsPayloadSchema = z.object({
  projectId: z.string().min(1),
  targetDirectoryPath: z.string(),
  itemPaths: z.array(z.string().min(1)),
})

const selectAndUploadRawDirectoryPayloadSchema = z.object({
  projectId: z.string().min(1),
  targetDirectoryPath: z.string(),
})

const exportRawEntriesPayloadSchema = z.object({
  projectId: z.string().min(1),
  relativePaths: z.array(z.string().min(1)),
})
```

Add methods to `knowledgeBaseIpcModule.methods`:

```ts
    uploadRawItems: {
      kind: "invoke",
      channel: "synapse:knowledge-base:upload-raw-items",
      request: uploadRawItemsPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; targetDirectoryPath: string; itemPaths: string[] }) => runGuardedKnowledgeBaseFileUpload({
        ctx,
        projectId: request.projectId,
        filePaths: request.itemPaths,
        readSource: "knowledgeBase.uploadRawItems.read",
        writeSource: "knowledgeBase.uploadRawItems",
        run: () => service(ctx).uploadRawItems(request),
      }),
    },
    selectAndUploadRawDirectory: {
      kind: "invoke",
      channel: "synapse:knowledge-base:select-and-upload-raw-directory",
      request: selectAndUploadRawDirectoryPayloadSchema,
      response: rawMutationResultSchema,
      handler: async (ctx, request: { projectId: string; targetDirectoryPath: string }) => {
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory"],
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { projectId: request.projectId, entries: [], skipped: [] }
        }
        return runGuardedKnowledgeBaseFileUpload({
          ctx,
          projectId: request.projectId,
          filePaths: result.filePaths.slice(0, 1),
          readSource: "knowledgeBase.selectAndUploadRawDirectory.read",
          writeSource: "knowledgeBase.selectAndUploadRawDirectory",
          run: () => service(ctx).uploadRawItems({
            projectId: request.projectId,
            targetDirectoryPath: request.targetDirectoryPath,
            itemPaths: result.filePaths.slice(0, 1),
          }),
        })
      },
    },
    exportRawEntries: {
      kind: "invoke",
      channel: "synapse:knowledge-base:export-raw-entries",
      request: exportRawEntriesPayloadSchema,
      response: rawMutationResultSchema,
      handler: async (ctx, request: { projectId: string; relativePaths: string[] }) => {
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { projectId: request.projectId, entries: [], skipped: [] }
        }
        return runGuardedKnowledgeBaseOperation({
          ctx,
          action: "fs.read.outside-userdata",
          resource: `managed-knowledge-base:${request.projectId}`,
          source: "knowledgeBase.exportRawEntries.read",
          run: () => runGuardedKnowledgeBaseOperation({
            ctx,
            action: "fs.write",
            resource: result.filePaths[0]!,
            source: "knowledgeBase.exportRawEntries.write",
            run: () => service(ctx).exportRawEntries({
              projectId: request.projectId,
              relativePaths: request.relativePaths,
              targetDirectoryPath: result.filePaths[0]!,
            }),
          }),
        })
      },
    },
```

- [ ] **Step 4: Generate IPC channels**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` includes `uploadRawItems`, `selectAndUploadRawDirectory`, and `exportRawEntries`.

- [ ] **Step 5: Add preload and bridge types**

In `desktop/src/types/bridge.ts`, add imports and bridge methods:

```ts
uploadRawItems: (
  payload: SynapseKnowledgeBaseUploadRawItemsPayload,
) => Promise<SynapseKnowledgeBaseRawMutationResult>
selectAndUploadRawDirectory: (
  payload: SynapseKnowledgeBaseSelectAndUploadRawDirectoryPayload,
) => Promise<SynapseKnowledgeBaseRawMutationResult>
exportRawEntries: (
  payload: Omit<SynapseKnowledgeBaseExportRawEntriesPayload, "targetDirectoryPath">,
) => Promise<SynapseKnowledgeBaseRawMutationResult>
```

In `desktop/electron/preload.ts`, add the three manual channel constants in `IPC_CHANNELS["knowledge-base"]` and bridge wrappers:

```ts
    uploadRawItems: "synapse:knowledge-base:upload-raw-items",
    selectAndUploadRawDirectory: "synapse:knowledge-base:select-and-upload-raw-directory",
    exportRawEntries: "synapse:knowledge-base:export-raw-entries",
```

```ts
    uploadRawItems: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].uploadRawItems)(payload),
    selectAndUploadRawDirectory: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].selectAndUploadRawDirectory)(payload),
    exportRawEntries: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].exportRawEntries)(payload),
```

- [ ] **Step 6: Run IPC, preload, and codegen checks**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/knowledge-base/__tests__/ipc.test.ts electron/__tests__/preload.test.ts electron/runtime/ipc/__tests__/codegen.test.ts
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 7: Commit IPC and bridge changes**

Run:

```bash
git add desktop/electron/modules/knowledge-base/ipc.ts desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts desktop/electron/preload.ts desktop/electron/__tests__/preload.test.ts desktop/electron/generated/ipc-channels.generated.ts desktop/src/types/bridge.ts
git commit -m "feat(desktop): expose knowledge base raw import export ipc"
```

Expected: commit succeeds.

---

### Task 4: Renderer Folder Upload And Export Actions

**Files:**
- Modify: `desktop/src/modules/knowledge-base/source-manager-window.tsx`
- Test: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Write failing renderer tests for upload folder and export actions**

Update `createBridgeMocks()` in `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`:

```ts
      uploadRawItems: vi.fn<(payload: { projectId: string; targetDirectoryPath: string; itemPaths: string[] }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      selectAndUploadRawDirectory: vi.fn<(payload: { projectId: string; targetDirectoryPath: string }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
      exportRawEntries: vi.fn<(payload: { projectId: string; relativePaths: string[] }) => Promise<SynapseKnowledgeBaseRawMutationResult>>()
        .mockResolvedValue(emptyMutation),
```

Add tests:

```ts
it("renders separate upload file and folder actions", async () => {
  renderWindow()

  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("brief.md")
  })

  expect(buttonByLabel("上传文件")).not.toBeNull()
  expect(buttonByLabel("上传文件夹")).not.toBeNull()
})

it("uploads a selected folder into the current directory", async () => {
  renderWindow()
  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("brief.md")
  })

  await act(async () => {
    buttonByLabel("上传文件夹").click()
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.selectAndUploadRawDirectory).toHaveBeenCalledWith({
    projectId: "project-1",
    targetDirectoryPath: "",
  })
})

it("sends dropped files and folders through uploadRawItems", async () => {
  bridgeMocks.knowledgeBase.filePathForDroppedFile.mockReturnValue("/tmp/会议资料")
  renderWindow()
  await waitForExpectation(() => {
    expect(document.querySelector('[aria-label="拖拽上传资料"]')).not.toBeNull()
  })
  const dropTarget = document.querySelector<HTMLElement>('[aria-label="资料文件"]')
  if (!dropTarget) throw new Error("Drop target missing")
  const file = new File([""], "会议资料")

  await act(async () => {
    dropTarget.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      dataTransfer: {
        files: [file],
      } as unknown as DataTransfer,
    }))
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.uploadRawItems).toHaveBeenCalledWith({
    projectId: "project-1",
    targetDirectoryPath: "",
    itemPaths: ["/tmp/会议资料"],
  })
})

it("exports one entry from the row menu", async () => {
  renderWindow()
  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("brief.md")
  })

  await act(async () => {
    buttonByLabel("更多 brief.md").click()
  })
  const exportItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((item) => item.textContent?.includes("导出"))
  if (!exportItem) throw new Error("Export menu item missing")
  await act(async () => {
    exportItem.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.exportRawEntries).toHaveBeenCalledWith({
    projectId: "project-1",
    relativePaths: ["brief.md"],
  })
})

it("exports selected entries from the batch bar", async () => {
  renderWindow()
  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("brief.md")
  })
  await act(async () => {
    buttonByLabel("选择 brief.md").click()
  })

  await act(async () => {
    buttonByLabel("导出所选").click()
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.exportRawEntries).toHaveBeenCalledWith({
    projectId: "project-1",
    relativePaths: ["brief.md"],
  })
})
```

- [ ] **Step 2: Run renderer tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: FAIL because controls and bridge calls are missing.

- [ ] **Step 3: Add toolbar upload folder and upload item handlers**

In `desktop/src/modules/knowledge-base/source-manager-window.tsx`, add `FolderUp` and `Download` imports from `lucide-react`.

Update `SourceManagerToolbarProps`:

```ts
  onUploadFiles: () => void
  onUploadFolder: () => void
```

Update toolbar buttons:

```tsx
        <Button type="button" variant="outline" onClick={onUploadFiles} aria-label="上传文件">
          <Upload data-icon="inline-start" />
          上传文件
        </Button>
        <Button type="button" variant="outline" onClick={onUploadFolder} aria-label="上传文件夹">
          <FolderUp data-icon="inline-start" />
          上传文件夹
        </Button>
```

Rename existing `uploadFiles` callback to `uploadItems` and use `bridge.knowledgeBase.uploadRawItems`:

```ts
  const uploadItems = useCallback(async (itemPaths: string[]) => {
    if (!payload || !bridge || itemPaths.length === 0) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.uploadRawItems({
          projectId: payload.projectId,
          targetDirectoryPath: currentDirectory,
          itemPaths,
        })
        await refreshDirectory()
        return result
      },
      {
        loading: "正在上传",
        success: (result) => sourceUploadSuccessMessage(result, "没有可上传的文件"),
        error: "上传失败",
      },
    )
  }, [bridge, currentDirectory, payload, promise, refreshDirectory])
```

Keep `chooseFiles` calling `selectAndUploadRawFiles`, but update button label to `上传文件`.

Add:

```ts
  const chooseFolder = useCallback(async () => {
    if (!payload || !bridge) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.selectAndUploadRawDirectory({
          projectId: payload.projectId,
          targetDirectoryPath: currentDirectory,
        })
        await refreshDirectory()
        return result
      },
      {
        loading: "正在上传",
        success: (result) => sourceUploadSuccessMessage(result, null),
        error: "上传失败",
      },
    )
  }, [bridge, currentDirectory, payload, promise, refreshDirectory])
```

Update drop handler to call `uploadItems(filePaths)`.

- [ ] **Step 4: Add export callbacks and UI actions**

Update `SourceSelectionBarProps`:

```ts
  onExport: () => void
```

Update `SourceSelectionBar`:

```tsx
        <Button type="button" variant="outline" size="sm" onClick={onExport} aria-label="导出所选">
          <Download data-icon="inline-start" />
          导出
        </Button>
```

Update `SourceEntryListProps`:

```ts
  onExportEntry: (entry: SynapseKnowledgeBaseRawEntry) => void
```

Add row menu item before delete:

```tsx
                <DropdownMenuItem onSelect={() => onExportEntry(entry)}>
                  <Download />
                  导出
                </DropdownMenuItem>
```

Add callback:

```ts
  const exportEntries = useCallback(async (relativePaths: string[]) => {
    if (!payload || !bridge || relativePaths.length === 0) return
    await promise(
      async () => bridge.knowledgeBase.exportRawEntries({
        projectId: payload.projectId,
        relativePaths,
      }),
      {
        loading: "正在导出",
        success: "已导出",
        error: "导出失败",
      },
    )
  }, [bridge, payload, promise])
```

Wire:

```tsx
              onExport={() => void exportEntries(selectedList)}
```

```tsx
              onExportEntry={(entry) => void exportEntries([entry.relativePath])}
```

- [ ] **Step 5: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit renderer import/export actions**

Run:

```bash
git add desktop/src/modules/knowledge-base/source-manager-window.tsx desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
git commit -m "feat(desktop): add knowledge base folder upload export actions"
```

Expected: commit succeeds.

---

### Task 5: Renderer Internal Drag-To-Folder Move

**Files:**
- Modify: `desktop/src/modules/knowledge-base/source-manager-window.tsx`
- Test: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Write failing renderer drag move tests**

Add tests:

```ts
it("moves one unselected entry when dragged to a folder row", async () => {
  renderWindow()
  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("brief.md")
  })
  const source = document.querySelector<HTMLElement>('[data-raw-path="brief.md"]')
  const target = document.querySelector<HTMLElement>('[data-raw-drop-target="客户"]')
  if (!source || !target) throw new Error("Drag fixtures missing")

  await act(async () => {
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true }))
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true }))
    target.dispatchEvent(new DragEvent("drop", { bubbles: true }))
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.moveRawEntries).toHaveBeenCalledWith({
    projectId: "project-1",
    relativePaths: ["brief.md"],
    targetDirectoryPath: "客户",
  })
})

it("moves selected entries as a group when dragging a selected item", async () => {
  renderWindow()
  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("brief.md")
  })
  await act(async () => {
    buttonByLabel("选择 brief.md").click()
  })
  const source = document.querySelector<HTMLElement>('[data-raw-path="brief.md"]')
  const target = document.querySelector<HTMLElement>('[data-raw-drop-target="客户"]')
  if (!source || !target) throw new Error("Drag fixtures missing")

  await act(async () => {
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true }))
    target.dispatchEvent(new DragEvent("drop", { bubbles: true }))
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.moveRawEntries).toHaveBeenCalledWith({
    projectId: "project-1",
    relativePaths: ["brief.md"],
    targetDirectoryPath: "客户",
  })
})

it("does not move a folder into itself", async () => {
  renderWindow()
  await waitForExpectation(() => {
    expect(document.body.textContent).toContain("客户")
  })
  const source = document.querySelector<HTMLElement>('[data-raw-path="客户"]')
  const target = document.querySelector<HTMLElement>('[data-raw-drop-target="客户"]')
  if (!source || !target) throw new Error("Drag fixtures missing")

  await act(async () => {
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true }))
    target.dispatchEvent(new DragEvent("drop", { bubbles: true }))
    await Promise.resolve()
  })

  expect(bridgeMocks.knowledgeBase.moveRawEntries).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run renderer tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: FAIL because row drag data attributes and handlers are missing.

- [ ] **Step 3: Add drag state and target validation**

In `KnowledgeBaseSourceManagerWindow`, add state:

```ts
  const [internalDragPaths, setInternalDragPaths] = useState<string[]>([])
  const [internalDropTarget, setInternalDropTarget] = useState<string | null>(null)
```

Add helpers near existing path helpers:

```ts
function canMoveRawPathsToTarget(relativePaths: readonly string[], targetDirectoryPath: string): boolean {
  return relativePaths.length > 0 && relativePaths.every((relativePath) => (
    relativePath !== targetDirectoryPath && !targetDirectoryPath.startsWith(`${relativePath}/`)
  ))
}
```

Add callbacks:

```ts
  const startInternalDrag = useCallback((entry: SynapseKnowledgeBaseRawEntry) => {
    const paths = selectedPaths.has(entry.relativePath) ? selectedList : [entry.relativePath]
    setInternalDragPaths(paths)
  }, [selectedList, selectedPaths])

  const dropInternalDrag = useCallback(async (targetDirectoryPath: string) => {
    const paths = internalDragPaths
    setInternalDropTarget(null)
    setInternalDragPaths([])
    if (!canMoveRawPathsToTarget(paths, targetDirectoryPath)) return
    await runMoveRawEntries(paths, targetDirectoryPath)
  }, [internalDragPaths, runMoveRawEntries])
```

- [ ] **Step 4: Wire right-pane folder row drag targets**

Extend `SourceEntryListProps`:

```ts
  internalDropTarget: string | null
  onDragEntry: (entry: SynapseKnowledgeBaseRawEntry) => void
  onDragEnd: () => void
  onDropOnDirectory: (targetDirectoryPath: string) => void
  onInternalDragOverDirectory: (targetDirectoryPath: string | null) => void
```

In each row wrapper:

```tsx
            data-raw-path={entry.relativePath}
            data-raw-drop-target={entry.kind === "directory" ? entry.relativePath : undefined}
            draggable
            onDragStart={(event) => {
              event.stopPropagation()
              onDragEntry(entry)
            }}
            onDragEnd={onDragEnd}
            onDragOver={(event) => {
              if (entry.kind !== "directory") return
              event.preventDefault()
              onInternalDragOverDirectory(entry.relativePath)
            }}
            onDrop={(event) => {
              if (entry.kind !== "directory") return
              event.preventDefault()
              event.stopPropagation()
              onDropOnDirectory(entry.relativePath)
            }}
```

Add target highlight with token classes:

```tsx
className={cn(
  "grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-1 py-2",
  internalDropTarget === entry.relativePath && "bg-accent",
)}
```

- [ ] **Step 5: Wire left tree folder drag targets**

In `renderTreeItems`, add to the folder button or wrapping row:

```tsx
                data-raw-drop-target={entry.relativePath}
                onDragOver={(event) => {
                  event.preventDefault()
                  setInternalDropTarget(entry.relativePath)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void dropInternalDrag(entry.relativePath)
                }}
```

Wire root button as a target too:

```tsx
          data-raw-drop-target="root"
          onDragOver={(event) => {
            event.preventDefault()
            setInternalDropTarget("")
          }}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void dropInternalDrag("")
          }}
```

- [ ] **Step 6: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit internal drag move**

Run:

```bash
git add desktop/src/modules/knowledge-base/source-manager-window.tsx desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
git commit -m "feat(desktop): support knowledge base drag move"
```

Expected: commit succeeds.

---

### Task 6: Release Notes And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add this bullet under the pending desktop/user-facing section in `RELEASE_NOTES_PENDING.md`:

```md
- 知识库资料管理支持上传文件夹、批量导出，以及拖拽整理文件；文件夹结构会保留，同名文件会自动保留副本，避免覆盖。
```

- [ ] **Step 2: Run focused Knowledge Base verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/knowledge-base/__tests__/raw-file-manager.test.ts \
  electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts \
  electron/modules/knowledge-base/__tests__/ipc.test.ts \
  src/modules/knowledge-base/__tests__/source-manager-window.test.tsx \
  electron/__tests__/preload.test.ts \
  electron/runtime/ipc/__tests__/codegen.test.ts
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 3: Run type and hard-constraint checks**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Inspect diff scope**

Run:

```bash
git diff --stat
git diff -- desktop/src/types/knowledge-base.ts desktop/src/types/bridge.ts desktop/electron/services/knowledge-base desktop/electron/modules/knowledge-base desktop/electron/preload.ts desktop/src/modules/knowledge-base RELEASE_NOTES_PENDING.md
```

Expected: changes are limited to Knowledge Base raw file management, preload/bridge wiring, tests, generated IPC channels, and release notes.

- [ ] **Step 5: Commit release note and final fixes**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note knowledge base file management improvements"
```

Expected: commit succeeds.
