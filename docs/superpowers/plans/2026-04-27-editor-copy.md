# Editor Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single-item `复制到编辑器` from the IDE scan detail dialog so one local Rule or Skill can be copied into another editor while leaving the source untouched.

**Architecture:** Add a focused main-process editor copy service for local scan items, then expose it through a narrow IPC/bridge surface. The renderer adds one copy dialog under `editor-scan`, reusing existing editor adapter target resolution, shadcn components, and project selection patterns without changing the existing import-to-repository flow.

**Tech Stack:** Electron main process, React, TypeScript, Vitest, zod IPC modules, shadcn/ui + Radix, Tailwind token utilities.

---

## File Plan

| File | Action | Responsibility |
|---|---|---|
| `desktop/src/types/editor-copy.ts` | Create | Shared copy request, resolved target, and result types. |
| `desktop/electron/services/editor-copy-service.ts` | Create | Resolve copy targets and copy one local scan item to a target editor. |
| `desktop/electron/services/__tests__/editor-copy-service.test.ts` | Create | Main-process tests for Rule copy, Skill copy, conflicts, same-path defense, and attachment filtering. |
| `desktop/electron/modules/editor-copy/ipc.ts` | Create | IPC methods for resolving a copy target and executing copy. |
| `desktop/scripts/generate-ipc.mjs` | Modify | Add `editor-copy` to IPC codegen sources. |
| `desktop/electron/generated/ipc-channels.generated.ts` | Regenerate | Add generated `editor-copy` channel constants. |
| `desktop/electron/bootstrap/ipc-registry.ts` | Modify | Register the new IPC module. |
| `desktop/electron/preload.ts` | Modify | Expose `window.synapse.editorCopy`. |
| `desktop/src/types/bridge.ts` | Modify | Add typed renderer bridge surface for `editorCopy`. |
| `desktop/src/app-shell/editor-copy.ts` | Create | Small renderer wrapper around the bridge methods. |
| `desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx` | Create | Target editor, scope, project path, target preview, overwrite confirm, and copy action UI. |
| `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx` | Modify | Add footer `复制到编辑器` button and mount the copy dialog. |
| `desktop/src/modules/editor-scan/index.tsx` | Modify | Refresh scan data after copy succeeds. |
| `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts` | Modify | Assert footer includes copy wording and keeps import/detail wording. |
| `desktop/src/modules/editor-scan/__tests__/editor-copy-dialog-layout.test.ts` | Create | Static renderer tests for copy dialog wording and overwrite wording. |

## Task 0: Prepare The Branch

**Files:**
- No source files

- [ ] **Step 1: Confirm clean worktree**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 2: Create the feature branch**

Run:

```bash
git switch -c codex/editor-copy
```

Expected: branch switches to `codex/editor-copy`.

## Task 1: Add Shared Editor Copy Types

**Files:**
- Create: `desktop/src/types/editor-copy.ts`

- [ ] **Step 1: Create shared types**

Create `desktop/src/types/editor-copy.ts`:

```ts
import type { SynapseContentType } from "./content"
import type { EditorScanScope } from "./editor-scan"
import type {
  SynapseEditorId,
  SynapseEditorInstallFormValues,
  SynapseEditorInstallScope,
  SynapseEditorInstallTargetKind,
  SynapseEditorResolvedTargetStatus,
} from "./editor"

export type SynapseEditorCopySource = {
  itemType: Extract<SynapseContentType, "rule" | "skill">
  itemPath: string
  itemName: string
  editorId: SynapseEditorId
  editorLabel: string
  scope: EditorScanScope
  projectName?: string
  content?: string
  metadata?: Record<string, string>
}

export type SynapseResolveEditorCopyTargetPayload = {
  source: SynapseEditorCopySource
  targetEditorId: SynapseEditorId
  targetScope: SynapseEditorInstallScope
  targetProjectPath?: string
}

export type SynapseCopyToEditorPayload = SynapseResolveEditorCopyTargetPayload & {
  installFormValues?: SynapseEditorInstallFormValues
  overwriteConfirmed?: boolean
}

export type SynapseEditorCopyResolvedTarget =
  | {
      status: "ready"
      editorId: SynapseEditorId
      label: string
      scope: SynapseEditorInstallScope
      contentType: Extract<SynapseContentType, "rule" | "skill">
      targetKind: SynapseEditorInstallTargetKind
      targetPath: string
      targetExists: boolean
      message: string | null
    }
  | {
      status: "conflict"
      editorId: SynapseEditorId
      label: string
      scope: SynapseEditorInstallScope
      contentType: Extract<SynapseContentType, "rule" | "skill">
      targetKind: SynapseEditorInstallTargetKind
      targetPath: string
      targetExists: true
      message: string
    }
  | {
      status: Exclude<SynapseEditorResolvedTargetStatus, "ready" | "conflict">
      editorId: SynapseEditorId
      label: string
      scope: SynapseEditorInstallScope
      contentType: Extract<SynapseContentType, "rule" | "skill">
      targetKind: null
      targetPath: null
      targetExists: false
      message: string
    }

export type SynapseEditorCopyResult =
  | {
      status: "copied"
      editorId: SynapseEditorId
      label: string
      scope: SynapseEditorInstallScope
      contentType: Extract<SynapseContentType, "rule" | "skill">
      targetKind: SynapseEditorInstallTargetKind
      targetPath: string
      overwritten: boolean
    }
  | {
      status: "conflict"
      editorId: SynapseEditorId
      label: string
      scope: SynapseEditorInstallScope
      contentType: Extract<SynapseContentType, "rule" | "skill">
      targetKind: SynapseEditorInstallTargetKind
      targetPath: string
      message: string
    }
```

- [ ] **Step 2: Run typecheck to confirm this standalone file compiles**

Run:

```bash
pnpm desktop:typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

Run:

```bash
git add desktop/src/types/editor-copy.ts
git commit -m "feat: add editor copy shared types"
```

Expected: commit succeeds.

## Task 2: Add Main-Process Copy Service Tests

**Files:**
- Create: `desktop/electron/services/__tests__/editor-copy-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `desktop/electron/services/__tests__/editor-copy-service.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-editor-copy-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

import { InMemoryAuditSink, createPermissionGuard } from "../../runtime/security"
import {
  copyEditorItem,
  resolveEditorCopyTarget,
} from "../editor-copy-service"

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-editor-copy-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  delete process.env.CODEX_HOME
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function deps() {
  return {
    auditSink: new InMemoryAuditSink(),
    permissionGuard: createPermissionGuard(),
  }
}

describe("editor copy service", () => {
  it("copies a project rule into a Claude Code project rule file", async () => {
    const root = await createTempDir()
    const sourcePath = path.join(root, "AGENTS.md")
    const projectPath = path.join(root, "target-project")
    await mkdir(projectPath, { recursive: true })
    await writeFile(sourcePath, "# Release Rule\n\nUse before release.")

    const result = await copyEditorItem({
      source: {
        itemType: "rule",
        itemPath: sourcePath,
        itemName: "Release Rule.md",
        editorId: "codex",
        editorLabel: "Codex",
        scope: "project",
        content: "# Release Rule\n\nUse before release.",
      },
      targetEditorId: "claude-code",
      targetScope: "project",
      targetProjectPath: projectPath,
      installFormValues: { paths: "src/**/*.ts" },
      overwriteConfirmed: true,
    }, deps())

    expect(result).toMatchObject({
      status: "copied",
      label: "Claude Code",
      targetPath: path.join(projectPath, ".claude", "rules", "release-rule.md"),
    })
    await expect(readFile(path.join(projectPath, ".claude", "rules", "release-rule.md"), "utf8"))
      .resolves.toContain("paths: src/**/*.ts")
  })

  it("copies a rule into Codex AGENTS.md and replaces the matching section", async () => {
    const root = await createTempDir()
    const codexHome = path.join(root, ".codex")
    process.env.CODEX_HOME = codexHome
    await mkdir(codexHome, { recursive: true })
    await writeFile(path.join(codexHome, "AGENTS.md"), [
      "Keep this header.",
      "",
      "<!-- synapse-rule:release-rule:begin -->",
      "Old release rule.",
      "<!-- synapse-rule:release-rule:end -->",
      "",
      "Keep this footer.",
    ].join("\n"))
    const sourcePath = path.join(root, "release-rule.md")
    await writeFile(sourcePath, "# Release Rule\n\nNew release rule.")

    const conflict = await copyEditorItem({
      source: {
        itemType: "rule",
        itemPath: sourcePath,
        itemName: "Release Rule.md",
        editorId: "claude-code",
        editorLabel: "Claude Code",
        scope: "project",
        content: "# Release Rule\n\nNew release rule.",
      },
      targetEditorId: "codex",
      targetScope: "global",
    }, deps())

    expect(conflict).toMatchObject({
      status: "conflict",
      targetPath: path.join(codexHome, "AGENTS.md"),
    })

    const copied = await copyEditorItem({
      source: {
        itemType: "rule",
        itemPath: sourcePath,
        itemName: "Release Rule.md",
        editorId: "claude-code",
        editorLabel: "Claude Code",
        scope: "project",
        content: "# Release Rule\n\nNew release rule.",
      },
      targetEditorId: "codex",
      targetScope: "global",
      overwriteConfirmed: true,
    }, deps())

    expect(copied.status).toBe("copied")
    const next = await readFile(path.join(codexHome, "AGENTS.md"), "utf8")
    expect(next).toContain("Keep this header.")
    expect(next).toContain("# Release Rule\n\nNew release rule.")
    expect(next).not.toContain("Old release rule.")
  })

  it("copies a skill directory with attachments and excludes Synapse metadata", async () => {
    const root = await createTempDir()
    const sourceSkill = path.join(root, "release-helper")
    const projectPath = path.join(root, "target-project")
    await mkdir(path.join(sourceSkill, "assets"), { recursive: true })
    await mkdir(projectPath, { recursive: true })
    await writeFile(path.join(sourceSkill, "SKILL.md"), "---\nname: release-helper\ndescription: Release helper.\n---\n\n# Release Helper\n")
    await writeFile(path.join(sourceSkill, ".synapse.json"), "{\"id\":\"skill-1\"}")
    await writeFile(path.join(sourceSkill, "assets", "template.txt"), "template")

    const result = await copyEditorItem({
      source: {
        itemType: "skill",
        itemPath: sourceSkill,
        itemName: "release-helper",
        editorId: "codex",
        editorLabel: "Codex",
        scope: "global",
      },
      targetEditorId: "cursor",
      targetScope: "project",
      targetProjectPath: projectPath,
    }, deps())

    expect(result).toMatchObject({
      status: "copied",
      targetPath: path.join(projectPath, ".cursor", "skills", "release-helper"),
    })
    await expect(readFile(path.join(projectPath, ".cursor", "skills", "release-helper", "SKILL.md"), "utf8"))
      .resolves.toContain("# Release Helper")
    await expect(readFile(path.join(projectPath, ".cursor", "skills", "release-helper", "assets", "template.txt"), "utf8"))
      .resolves.toBe("template")
    await expect(readFile(path.join(projectPath, ".cursor", "skills", "release-helper", ".synapse.json"), "utf8"))
      .rejects.toThrow()
  })

  it("returns conflict before overwriting an existing target skill and replaces after confirmation", async () => {
    const root = await createTempDir()
    const sourceSkill = path.join(root, "release-helper")
    const projectPath = path.join(root, "target-project")
    const targetSkill = path.join(projectPath, ".cursor", "skills", "release-helper")
    await mkdir(sourceSkill, { recursive: true })
    await mkdir(targetSkill, { recursive: true })
    await writeFile(path.join(sourceSkill, "SKILL.md"), "# New Skill\n")
    await writeFile(path.join(targetSkill, "SKILL.md"), "# Old Skill\n")

    const conflict = await copyEditorItem({
      source: {
        itemType: "skill",
        itemPath: sourceSkill,
        itemName: "release-helper",
        editorId: "codex",
        editorLabel: "Codex",
        scope: "global",
      },
      targetEditorId: "cursor",
      targetScope: "project",
      targetProjectPath: projectPath,
    }, deps())

    expect(conflict).toMatchObject({
      status: "conflict",
      targetPath: targetSkill,
    })

    const copied = await copyEditorItem({
      source: {
        itemType: "skill",
        itemPath: sourceSkill,
        itemName: "release-helper",
        editorId: "codex",
        editorLabel: "Codex",
        scope: "global",
      },
      targetEditorId: "cursor",
      targetScope: "project",
      targetProjectPath: projectPath,
      overwriteConfirmed: true,
    }, deps())

    expect(copied).toMatchObject({
      status: "copied",
      overwritten: true,
    })
    await expect(readFile(path.join(targetSkill, "SKILL.md"), "utf8")).resolves.toContain("# New Skill")
  })

  it("rejects a target path that matches the source path", async () => {
    const root = await createTempDir()
    const sourceSkill = path.join(root, ".agents", "skills", "release-helper")
    await mkdir(sourceSkill, { recursive: true })
    await writeFile(path.join(sourceSkill, "SKILL.md"), "# Release Helper\n")

    await expect(copyEditorItem({
      source: {
        itemType: "skill",
        itemPath: sourceSkill,
        itemName: "release-helper",
        editorId: "codex",
        editorLabel: "Codex",
        scope: "project",
      },
      targetEditorId: "codex",
      targetScope: "project",
      targetProjectPath: root,
      overwriteConfirmed: true,
    }, deps())).rejects.toThrow("目标位置与源位置相同")
  })

  it("marks Cursor global Rule as unsupported", async () => {
    const root = await createTempDir()
    const sourcePath = path.join(root, "rule.md")
    await writeFile(sourcePath, "# Rule\n")

    const target = await resolveEditorCopyTarget({
      source: {
        itemType: "rule",
        itemPath: sourcePath,
        itemName: "rule.md",
        editorId: "codex",
        editorLabel: "Codex",
        scope: "global",
        content: "# Rule\n",
      },
      targetEditorId: "cursor",
      targetScope: "global",
    })

    expect(target).toMatchObject({
      status: "unsupported",
      label: "Cursor",
    })
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-copy-service.test.ts
```

Expected: FAIL because `../editor-copy-service` does not exist.

## Task 3: Implement Main-Process Copy Service

**Files:**
- Create: `desktop/electron/services/editor-copy-service.ts`
- Test: `desktop/electron/services/__tests__/editor-copy-service.test.ts`

- [ ] **Step 1: Create the copy service**

Create `desktop/electron/services/editor-copy-service.ts`:

```ts
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseCopyToEditorPayload,
  SynapseEditorCopyResolvedTarget,
  SynapseEditorCopyResult,
  SynapseResolveEditorCopyTargetPayload,
} from "../../src/types/editor-copy"
import type { SynapseInstallToEditorPayload } from "../../src/types/editor"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import { editorAdapterService } from "./editor-adapter-service"
import { editorInstallStrategyById } from "./ide-definitions/generated/main-registry"
import { prepareQuickPublishDraft } from "./editor-scan-service"
import { isFileNotFoundError, isPermissionError, pathExists } from "./fs-utils"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.editor-copy")
const COPY_CONFLICT_MESSAGE = "目标位置已有内容，复制后会被替换。"

type EditorCopyServiceDeps = {
  permissionGuard?: PermissionGuard
  auditSink?: AuditSink
}

function normalizeMarkdownContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`
}

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.(md|mdc)$/i, "")
}

function toCopyIdentifier(value: string, fallback: string): string {
  const normalized = stripMarkdownExtension(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "")

  return normalized || fallback
}

function buildInstallPayload(payload: SynapseCopyToEditorPayload): SynapseInstallToEditorPayload {
  const contentId = toCopyIdentifier(payload.source.itemName, payload.source.itemType)
  const copiedName = toCopyIdentifier(payload.source.itemName, payload.source.itemType)

  return {
    contentId,
    contentType: payload.source.itemType,
    editorId: payload.targetEditorId,
    installFormValues: payload.installFormValues,
    projectPath: payload.targetScope === "project" ? payload.targetProjectPath : undefined,
    replaceConfirmed: payload.overwriteConfirmed,
    ruleName: payload.source.itemType === "rule" ? copiedName : undefined,
    scope: payload.targetScope,
    skillName: payload.source.itemType === "skill" ? copiedName : undefined,
    skillTitle: payload.source.itemType === "skill" ? payload.source.itemName : undefined,
  }
}

async function readExistingTextFile(targetPath: string): Promise<string> {
  try {
    return await readFile(targetPath, "utf8")
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return ""
    }

    throw error
  }
}

async function swapPathAtomically(replacementPath: string, targetPath: string): Promise<void> {
  const parentDirectoryPath = path.dirname(targetPath)
  const targetName = path.basename(targetPath)
  const backupPath = path.join(parentDirectoryPath, `.synapse-copy-backup-${targetName}-${Date.now()}`)
  const hadExistingTarget = await pathExists(targetPath)
  let movedExistingTarget = false
  let movedReplacement = false

  await mkdir(parentDirectoryPath, { recursive: true })

  try {
    if (hadExistingTarget) {
      await rename(targetPath, backupPath)
      movedExistingTarget = true
    }

    await rename(replacementPath, targetPath)
    movedReplacement = true
  } catch (error) {
    if (movedExistingTarget && !movedReplacement) {
      await rename(backupPath, targetPath).catch((err) => logger.warn("Failed to restore editor copy backup", err))
    }

    throw error
  } finally {
    if (movedExistingTarget && movedReplacement) {
      await rm(backupPath, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean editor copy backup", err))
    }
  }
}

async function replaceFileAtomically(targetPath: string, content: string): Promise<void> {
  const parentDirectoryPath = path.dirname(targetPath)

  await mkdir(parentDirectoryPath, { recursive: true })

  const tempDirectoryPath = await mkdtemp(path.join(parentDirectoryPath, ".synapse-copy-file-"))
  const tempFilePath = path.join(tempDirectoryPath, path.basename(targetPath))

  try {
    await writeFile(tempFilePath, normalizeMarkdownContent(content), "utf8")
    await swapPathAtomically(tempFilePath, targetPath)
  } finally {
    await rm(tempDirectoryPath, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean editor copy file staging", err))
  }
}

async function replaceDirectoryAtomically(
  targetPath: string,
  populate: (stagingDirectoryPath: string) => Promise<void>,
): Promise<void> {
  const parentDirectoryPath = path.dirname(targetPath)

  await mkdir(parentDirectoryPath, { recursive: true })

  const stagingDirectoryPath = await mkdtemp(path.join(parentDirectoryPath, ".synapse-copy-dir-"))

  try {
    await populate(stagingDirectoryPath)
    await swapPathAtomically(stagingDirectoryPath, targetPath)
  } catch (error) {
    await rm(stagingDirectoryPath, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean editor copy directory staging", err))
    throw error
  }
}

function toCopyResolvedTarget(
  target: Awaited<ReturnType<typeof editorAdapterService.resolveTarget>>,
  targetExists: boolean,
): SynapseEditorCopyResolvedTarget {
  if (target.status === "ready") {
    return {
      ...target,
      contentType: target.contentType as "rule" | "skill",
      targetExists,
    }
  }

  if (target.status === "conflict") {
    return {
      editorId: target.editorId,
      label: target.label,
      scope: target.scope,
      contentType: target.contentType as "rule" | "skill",
      message: target.message ?? COPY_CONFLICT_MESSAGE,
      status: "conflict",
      targetExists: true,
      targetKind: target.targetKind,
      targetPath: target.targetPath,
    }
  }

  return {
    editorId: target.editorId,
    label: target.label,
    scope: target.scope,
    contentType: target.contentType as "rule" | "skill",
    message: target.message ?? "当前编辑器暂时不能复制到这个位置。",
    status: target.status,
    targetExists: false,
    targetKind: null,
    targetPath: null,
  }
}

function isSamePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right)
}

async function resolveEditorCopyTarget(
  payload: SynapseResolveEditorCopyTargetPayload,
): Promise<SynapseEditorCopyResolvedTarget> {
  const installPayload = buildInstallPayload({ ...payload, overwriteConfirmed: false })
  const target = await editorAdapterService.resolveTarget(installPayload)

  if (target.status !== "ready" && target.status !== "conflict") {
    return toCopyResolvedTarget(target, false)
  }

  if (isSamePath(target.targetPath, payload.source.itemPath)) {
    return {
      editorId: target.editorId,
      label: target.label,
      scope: target.scope,
      contentType: target.contentType as "rule" | "skill",
      message: "目标位置与源位置相同",
      status: "unavailable",
      targetExists: false,
      targetKind: null,
      targetPath: null,
    }
  }

  const targetExists = target.status === "conflict" ? true : await pathExists(target.targetPath)
  return toCopyResolvedTarget(target, targetExists)
}

async function checkWritePermission(
  targetPath: string,
  payload: SynapseCopyToEditorPayload,
  deps: EditorCopyServiceDeps,
): Promise<void> {
  const actor = { kind: "user" as const }
  const metadata = {
    contentType: payload.source.itemType,
    sourceEditorId: payload.source.editorId,
    targetEditorId: payload.targetEditorId,
    targetScope: payload.targetScope,
  }

  const permission = await deps.permissionGuard?.check({
    action: "fs.write",
    actor,
    context: metadata,
    resource: targetPath,
  })

  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "fs.write",
      actor,
      metadata,
      outcome: "denied",
      resource: targetPath,
    })
    throw new Error(permission.reason)
  }

  deps.auditSink?.record({
    action: "fs.write",
    actor,
    metadata,
    outcome: "allowed",
    resource: targetPath,
  })
}

function formatCopyFailure(error: unknown, targetPath: string): Error {
  if (isPermissionError(error)) {
    return new Error(`目标位置不可写：${targetPath}`)
  }

  if (error instanceof Error) {
    return error
  }

  return new Error("复制失败。")
}

function assertPortableAttachmentPath(stagingDirectoryPath: string, relativeName: string): string {
  const targetPath = path.join(stagingDirectoryPath, relativeName)
  const resolvedStagingPath = path.resolve(stagingDirectoryPath)
  const resolvedTargetPath = path.resolve(targetPath)

  if (resolvedTargetPath !== resolvedStagingPath && !resolvedTargetPath.startsWith(`${resolvedStagingPath}${path.sep}`)) {
    throw new Error(`附件路径无效：${relativeName}`)
  }

  return targetPath
}

async function copyRule(
  payload: SynapseCopyToEditorPayload,
  targetPath: string,
): Promise<void> {
  const ruleBody = payload.source.content ?? await readFile(payload.source.itemPath, "utf8")
  const installPayload = buildInstallPayload(payload)
  const installStrategy = editorInstallStrategyById.get(payload.targetEditorId)
  const content = installStrategy
    ? await installStrategy.prepareRuleFileContent({
        payload: installPayload,
        readExistingTextFile,
        ruleBody,
        targetPath,
      })
    : ruleBody

  await replaceFileAtomically(targetPath, content)
}

async function copySkill(
  payload: SynapseCopyToEditorPayload,
  targetPath: string,
): Promise<void> {
  const draft = await prepareQuickPublishDraft({
    itemName: payload.source.itemName,
    itemPath: payload.source.itemPath,
    itemType: "skill",
    metadata: payload.source.metadata,
  })

  if (draft.itemType !== "skill") {
    throw new Error("Skill 复制内容无效。")
  }

  await replaceDirectoryAtomically(targetPath, async (stagingDirectoryPath) => {
    await writeFile(
      path.join(stagingDirectoryPath, "SKILL.md"),
      normalizeMarkdownContent(draft.content),
      "utf8",
    )

    for (const file of draft.files) {
      const attachmentTargetPath = assertPortableAttachmentPath(stagingDirectoryPath, file.originalName)
      await mkdir(path.dirname(attachmentTargetPath), { recursive: true })
      await writeFile(attachmentTargetPath, file.bytes)
    }
  })
}

async function copyEditorItem(
  payload: SynapseCopyToEditorPayload,
  deps: EditorCopyServiceDeps = {},
): Promise<SynapseEditorCopyResult> {
  const target = await resolveEditorCopyTarget(payload)

  if (target.status !== "ready" && target.status !== "conflict") {
    throw new Error(target.message)
  }

  const targetExists = target.status === "conflict" || target.targetExists

  if (targetExists && !payload.overwriteConfirmed) {
    return {
      contentType: target.contentType,
      editorId: target.editorId,
      label: target.label,
      message: COPY_CONFLICT_MESSAGE,
      scope: target.scope,
      status: "conflict",
      targetKind: target.targetKind,
      targetPath: target.targetPath,
    }
  }

  await checkWritePermission(target.targetPath, payload, deps)

  try {
    if (payload.source.itemType === "rule") {
      await copyRule(payload, target.targetPath)
    } else {
      await copySkill(payload, target.targetPath)
    }
  } catch (error) {
    deps.auditSink?.record({
      action: "fs.write",
      actor: { kind: "user" },
      metadata: {
        contentType: payload.source.itemType,
        sourceEditorId: payload.source.editorId,
        targetEditorId: payload.targetEditorId,
        targetScope: payload.targetScope,
      },
      outcome: "failed",
      resource: target.targetPath,
    })
    throw formatCopyFailure(error, target.targetPath)
  }

  logger.info("Editor item copied.", {
    contentType: payload.source.itemType,
    sourceEditorId: payload.source.editorId,
    targetEditorId: payload.targetEditorId,
    targetPath: target.targetPath,
    targetScope: target.scope,
  })

  return {
    contentType: target.contentType,
    editorId: target.editorId,
    label: target.label,
    overwritten: targetExists,
    scope: target.scope,
    status: "copied",
    targetKind: target.targetKind,
    targetPath: target.targetPath,
  }
}

export { copyEditorItem, resolveEditorCopyTarget }
export type { EditorCopyServiceDeps }
```

- [ ] **Step 2: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-copy-service.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

Run:

```bash
git add desktop/electron/services/editor-copy-service.ts desktop/electron/services/__tests__/editor-copy-service.test.ts
git commit -m "feat: copy scanned editor items"
```

Expected: commit succeeds.

## Task 4: Add IPC And Preload Bridge

**Files:**
- Create: `desktop/electron/modules/editor-copy/ipc.ts`
- Modify: `desktop/scripts/generate-ipc.mjs`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Create: `desktop/src/app-shell/editor-copy.ts`
- Regenerate: `desktop/electron/generated/ipc-channels.generated.ts`

- [ ] **Step 1: Add IPC module**

Create `desktop/electron/modules/editor-copy/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type {
  SynapseCopyToEditorPayload,
  SynapseResolveEditorCopyTargetPayload,
} from "../../../src/types/editor-copy"
import {
  copyEditorItem,
  resolveEditorCopyTarget,
} from "../../services/editor-copy-service"

const editorCopySourceSchema = z.object({
  itemType: z.enum(["rule", "skill"]),
  itemPath: z.string(),
  itemName: z.string(),
  editorId: z.string(),
  editorLabel: z.string(),
  scope: z.enum(["global", "project"]),
  projectName: z.string().optional(),
  content: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
})

const resolveEditorCopyTargetSchema = z.object({
  source: editorCopySourceSchema,
  targetEditorId: z.string(),
  targetScope: z.enum(["global", "project"]),
  targetProjectPath: z.string().optional(),
})

const copyToEditorSchema = resolveEditorCopyTargetSchema.extend({
  installFormValues: z.record(z.string(), z.unknown()).optional(),
  overwriteConfirmed: z.boolean().optional(),
})

const anySchema = z.any()

export const editorCopyIpcModule: IpcModule = {
  id: "editor-copy",
  methods: {
    resolveTarget: {
      kind: "invoke",
      channel: "synapse:editor-copy:resolve-target",
      request: resolveEditorCopyTargetSchema,
      response: anySchema,
      handler: async (_ctx, request: SynapseResolveEditorCopyTargetPayload) => {
        return resolveEditorCopyTarget(request)
      },
    },
    copy: {
      kind: "invoke",
      channel: "synapse:editor-copy:copy",
      request: copyToEditorSchema,
      response: anySchema,
      handler: async (ctx, request: SynapseCopyToEditorPayload) => {
        return copyEditorItem(request, {
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        })
      },
    },
  },
  events: {},
}
```

- [ ] **Step 2: Register IPC source for codegen**

Modify `desktop/scripts/generate-ipc.mjs` and add the source after `editor-scan`:

```js
  { id: "editor-scan", importPath: "../electron/modules/editor-scan/ipc.ts" },
  { id: "editor-copy", importPath: "../electron/modules/editor-copy/ipc.ts" },
  { id: "editor", importPath: "../electron/modules/editor/ipc.ts" },
```

- [ ] **Step 3: Register module in bootstrap IPC registry**

Modify `desktop/electron/bootstrap/ipc-registry.ts`:

```ts
import { editorCopyIpcModule } from "../modules/editor-copy/ipc"
```

Register it after `editorScanIpcModule`:

```ts
  registry.register(editorScanIpcModule, ctx)
  registry.register(editorCopyIpcModule, ctx)
  registry.register(editorIpcModule, ctx)
```

Add it to `registeredIpcModules` after `editorScanIpcModule`:

```ts
  editorScanIpcModule,
  editorCopyIpcModule,
  editorIpcModule,
```

- [ ] **Step 4: Regenerate IPC channels**

Run:

```bash
pnpm desktop:generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` includes:

```ts
  "editor-copy": {
    "resolveTarget": "synapse:editor-copy:resolve-target",
    "copy": "synapse:editor-copy:copy",
  },
```

- [ ] **Step 5: Add preload bridge methods**

Modify `desktop/electron/preload.ts` inside the exposed bridge object:

```ts
  editorCopy: {
    resolveTarget: (payload) =>
      invoke(IPC_CHANNELS["editor-copy"].resolveTarget)(payload),
    copy: (payload) =>
      invoke(IPC_CHANNELS["editor-copy"].copy)(payload),
  },
```

Place it after `editorScan`.

- [ ] **Step 6: Add bridge types**

Modify `desktop/src/types/bridge.ts` imports:

```ts
import type {
  SynapseCopyToEditorPayload,
  SynapseEditorCopyResolvedTarget,
  SynapseEditorCopyResult,
  SynapseResolveEditorCopyTargetPayload,
} from "./editor-copy"
```

Add the domain after `editorScan`:

```ts
  editorCopy: {
    resolveTarget: (
      payload: SynapseResolveEditorCopyTargetPayload,
    ) => Promise<SynapseEditorCopyResolvedTarget>
    copy: (
      payload: SynapseCopyToEditorPayload,
    ) => Promise<SynapseEditorCopyResult>
  }
```

- [ ] **Step 7: Add renderer wrapper**

Create `desktop/src/app-shell/editor-copy.ts`:

```ts
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type {
  SynapseCopyToEditorPayload,
  SynapseEditorCopyResolvedTarget,
  SynapseEditorCopyResult,
  SynapseResolveEditorCopyTargetPayload,
} from "@/types/editor-copy"

async function resolveEditorCopyTarget(
  payload: SynapseResolveEditorCopyTargetPayload,
): Promise<SynapseEditorCopyResolvedTarget> {
  return requireBridgeDomain("editorCopy").resolveTarget(payload)
}

async function copyToEditor(
  payload: SynapseCopyToEditorPayload,
): Promise<SynapseEditorCopyResult> {
  return requireBridgeDomain("editorCopy").copy(payload)
}

export { copyToEditor, resolveEditorCopyTarget }
```

- [ ] **Step 8: Verify IPC codegen and typecheck**

Run:

```bash
pnpm desktop:check:ipc-codegen
pnpm desktop:typecheck
```

Expected: both PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add desktop/electron/modules/editor-copy/ipc.ts desktop/scripts/generate-ipc.mjs desktop/electron/generated/ipc-channels.generated.ts desktop/electron/bootstrap/ipc-registry.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/src/app-shell/editor-copy.ts
git commit -m "feat: expose editor copy bridge"
```

Expected: commit succeeds.

## Task 5: Add Renderer Copy Dialog Tests

**Files:**
- Create: `desktop/src/modules/editor-scan/__tests__/editor-copy-dialog-layout.test.ts`
- Modify: `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`

- [ ] **Step 1: Add dialog wording test**

Create `desktop/src/modules/editor-scan/__tests__/editor-copy-dialog-layout.test.ts`:

```ts
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("editor copy dialog layout", () => {
  it("uses copy and overwrite wording", async () => {
    const source = await readFile(
      new URL("../components/editor-copy-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("复制到编辑器")
    expect(source).toContain("目标编辑器")
    expect(source).toContain("目标位置")
    expect(source).toContain("覆盖目标？")
    expect(source).toContain("目标位置已有内容，复制后会被替换。")
    expect(source).not.toContain("转移")
    expect(source).not.toContain("迁移")
  })
})
```

- [ ] **Step 2: Extend detail dialog static test**

Modify `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts` by adding this assertion to `uses import wording for external scan items`:

```ts
    expect(source).toContain("复制到编辑器")
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/editor-copy-dialog-layout.test.ts src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
```

Expected: FAIL because `editor-copy-dialog.tsx` does not exist and `ScanItemDetailDialog` does not contain `复制到编辑器`.

## Task 6: Implement Renderer Copy Dialog

**Files:**
- Create: `desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx`
- Test: `desktop/src/modules/editor-scan/__tests__/editor-copy-dialog-layout.test.ts`

- [ ] **Step 1: Create the dialog component**

Create `desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx`. The component must:

- use `getEditorAdapters` from `@/app-shell/content`
- use `copyToEditor` and `resolveEditorCopyTarget` from `@/app-shell/editor-copy`
- use `useAppConfig` for configured project list
- use `useAppNotifications` for promise toasts
- use shadcn `Dialog`, `Button`, `Tabs`, `Select`, `Input`, `Label`, and `AlertDialog`
- filter target editors with `adapter.id !== item.editorId`
- show `全局` and `项目` scope tabs
- disable unsupported target states
- open overwrite confirm when `targetExists` or service returns `status: "conflict"`
- call `onCopied` after successful copy

Use these exact helper constants and functions in the file:

```ts
const CUSTOM_PROJECT_OPTION = "__custom__"

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.(md|mdc)$/i, "")
}

function createRuleMetaForInstallForm(item: ScanItemForDetail): SynapseContentMeta<"rule"> {
  const now = new Date(0).toISOString()
  const name = stripMarkdownExtension(item.name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "rule"

  return {
    attachmentCount: 0,
    category: "",
    createdAt: now,
    createdBy: "editor-copy",
    createdByDisplayName: "Editor Copy",
    deleted: false,
    description: item.preview.split("\n")[0] ?? "",
    icon: "file-text",
    iconBg: "",
    iconImage: "",
    iconType: "icon",
    id: name,
    isReadonly: true,
    latestHistoryDirname: "",
    modifiedAt: now,
    modifiedBy: "editor-copy",
    modifiedByDisplayName: "Editor Copy",
    name,
    source: "repository",
    title: stripMarkdownExtension(item.name),
    type: "rule",
  }
}
```

Use this source builder:

```ts
function toCopySource(item: ScanItemForDetail): SynapseEditorCopySource {
  return {
    content: item.content,
    editorId: item.editorId,
    editorLabel: item.editorLabel,
    itemName: item.name,
    itemPath: item.path,
    itemType: item.type,
    metadata: item.metadata,
    projectName: item.projectName,
    scope: item.scope,
  }
}
```

The footer buttons must be:

```tsx
<DialogFooter>
  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
    取消
  </Button>
  <Button type="button" disabled={!canCopy} onClick={() => void handleCopy()}>
    {isCopying ? <LoaderCircle className="animate-spin" /> : null}
    复制
  </Button>
</DialogFooter>
```

The overwrite dialog must use:

```tsx
<AlertDialogTitle>覆盖目标？</AlertDialogTitle>
<AlertDialogDescription>
  目标位置已有内容，复制后会被替换。
</AlertDialogDescription>
```

- [ ] **Step 2: Render target path state**

Inside the component, render target state with this structure:

```tsx
<div className="rounded-lg border border-border bg-muted/20 px-3 py-3">
  <div className="flex flex-col gap-1 text-sm">
    <p className="font-medium text-foreground">目标位置</p>
    {targetState.isLoading ? (
      <p className="flex items-center gap-2 text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        正在解析复制路径
      </p>
    ) : targetState.error ? (
      <p className="text-destructive">{targetState.error}</p>
    ) : target?.status === "ready" ? (
      <>
        <p className="break-all text-muted-foreground">{target.targetPath}</p>
        {target.targetExists ? (
          <p className="text-xs text-muted-foreground">目标位置已有内容。</p>
        ) : null}
      </>
    ) : target?.status === "conflict" ? (
      <>
        <p className="break-all text-muted-foreground">{target.targetPath}</p>
        <p className="text-xs text-muted-foreground">目标位置已有内容。</p>
      </>
    ) : target ? (
      <p className="text-muted-foreground">{target.message}</p>
    ) : (
      <p className="text-muted-foreground">先选择目标编辑器。</p>
    )}
  </div>
</div>
```

- [ ] **Step 3: Run renderer static test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/editor-copy-dialog-layout.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx desktop/src/modules/editor-scan/__tests__/editor-copy-dialog-layout.test.ts
git commit -m "feat: add editor copy dialog"
```

Expected: commit succeeds.

## Task 7: Wire Footer Button And Refresh

**Files:**
- Modify: `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
- Modify: `desktop/src/modules/editor-scan/index.tsx`
- Test: `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`

- [ ] **Step 1: Add dialog import and prop**

In `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`, import:

```ts
import { EditorCopyDialog } from "./editor-copy-dialog"
```

Extend props:

```ts
type ScanItemDetailDialogProps = {
  item: ScanItemForDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCopied?: () => Promise<void> | void
}
```

Extend function args:

```ts
function ScanItemDetailDialog({ item, open, onOpenChange, onCopied }: ScanItemDetailDialogProps) {
```

- [ ] **Step 2: Add copy dialog state**

Add local state near the existing `useState` calls:

```ts
  const [copyDialogOpen, setCopyDialogOpen] = useState(false)
```

Reset it when the detail closes:

```ts
    if (!open) {
      setViewMode("rendered")
      setContentReady(false)
      setQuickPublishError(null)
      setFallbackReason(null)
      setCopyDialogOpen(false)
      return
    }
```

- [ ] **Step 3: Add footer button**

In the footer button area, keep the existing path button. Replace the single right-side action area with:

```tsx
<div className="flex shrink-0 items-center gap-2">
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isQuickPublishBusy || disabledReason !== null}
            onClick={() => void handlePrimaryAction()}
          >
            {isQuickPublishBusy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
            {primaryActionLabel}
          </Button>
        </span>
      </TooltipTrigger>
      {disabledReason ? (
        <TooltipContent>{disabledReason}</TooltipContent>
      ) : null}
    </Tooltip>
  </TooltipProvider>
  <Button
    type="button"
    size="sm"
    onClick={() => setCopyDialogOpen(true)}
  >
    复制到编辑器
  </Button>
</div>
```

This keeps `导入到仓库` / `查看仓库内容` available while making `复制到编辑器` the primary button.

- [ ] **Step 4: Mount the copy dialog**

Mount after the detail `Dialog`:

```tsx
<EditorCopyDialog
  item={item}
  open={copyDialogOpen}
  onCopied={onCopied}
  onOpenChange={setCopyDialogOpen}
/>
```

- [ ] **Step 5: Refresh after copy**

In `desktop/src/modules/editor-scan/index.tsx`, pass a refresh callback:

```tsx
<ScanItemDetailDialog
  item={detailItem}
  open={detailOpen}
  onCopied={() => {
    void refresh().catch(() => {})
  }}
  onOpenChange={setDetailOpen}
/>
```

- [ ] **Step 6: Run renderer static tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts src/modules/editor-scan/__tests__/editor-copy-dialog-layout.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx desktop/src/modules/editor-scan/index.tsx desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
git commit -m "feat: add copy action to editor scan detail"
```

Expected: commit succeeds.

## Task 8: Full Verification

**Files:**
- No new source files

- [ ] **Step 1: Run focused service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-copy-service.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts src/modules/editor-scan/__tests__/editor-copy-dialog-layout.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm desktop:check:hard-constraints
```

Expected: PASS. In particular, there must be no bare `ipcMain.handle/on` outside runtime IPC and no direct `ipcRenderer` in renderer code.

- [ ] **Step 4: Run IPC codegen check**

Run:

```bash
pnpm desktop:check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
pnpm desktop:typecheck
```

Expected: PASS.

- [ ] **Step 6: Inspect UI/style constraints by source**

Run:

```bash
rg -n "style=|styled\\.|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|from-|to-|via-|转移|迁移" desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx desktop/src/app-shell/editor-copy.ts desktop/src/types/editor-copy.ts
```

Expected: no matches for custom style/color/gradient wording. The word `复制` is allowed; `转移` and `迁移` must not appear in the feature UI source.

- [ ] **Step 7: Run final status check**

Run:

```bash
git status --short
```

Expected: no output.
