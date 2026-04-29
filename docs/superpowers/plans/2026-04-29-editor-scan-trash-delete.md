# Editor Scan Trash Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, single-item “move to trash” action for locally scanned IDE Rule and Skill entries.

**Architecture:** The renderer only asks the typed preload bridge to trash the currently open scan item. The Electron main process owns all filesystem work, recomputes deletion safety from scan metadata, uses `PermissionGuard` and `AuditSink`, and either calls Electron `shell.trashItem` for standalone paths or atomically rewrites shared Rule files to remove one Synapse marker block.

**Tech Stack:** Electron, React, TypeScript, Vitest, zod, shadcn/ui, lucide-react, pnpm monorepo scripts.

---

## File Structure

- Modify `desktop/src/types/editor-scan.ts`
  - Add trash metadata, IPC request, and IPC result types.
  - Add `trash` to `EditorScanSkillItem`, `EditorScanRuleItem`, and `ScanItemForDetail`.
- Modify `desktop/src/definitions/editor/shared-rule-scanners.ts`
  - Mark standalone Rule files as path-trashable.
  - Mark Synapse marker blocks inside shared Rule files as section-trashable.
  - Mark shared-file external handwritten Rule sections as unsupported.
- Modify `desktop/electron/services/editor-scan-service.ts`
  - Add Skill trash metadata during skill directory scan.
  - Add `trashScanItem` main-process operation.
  - Add helpers for path validation, Synapse marker removal, permission checks, and audit records.
- Modify `desktop/electron/modules/editor-scan/ipc.ts`
  - Add zod schemas for trash metadata, request, and result.
  - Register `trashItem` and wire security deps from `ctx`.
- Modify `desktop/electron/generated/ipc-channels.generated.ts`
  - Regenerate through `pnpm desktop:generate:ipc`.
- Modify `desktop/electron/preload.ts`
  - Expose `window.synapse.editorScan.trashItem`.
- Modify `desktop/src/types/bridge.ts`
  - Add bridge signature for `trashItem`.
- Modify `desktop/src/modules/editor-scan/index.tsx`
  - Pass trash metadata into the detail item.
  - Rename the detail callback from copy-specific wording to a general change callback.
- Modify `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
  - Add delete button in the footer.
  - Add confirmation dialog, busy state, error state, tooltip for unsupported items, and success refresh flow.
- Modify `desktop/electron/services/__tests__/editor-scan-service.test.ts`
  - Cover scan trash metadata and main-process trash behavior.
- Modify `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`
  - Cover UI wording and the detail-only delete entry.

---

## Task 1: Add Trash Metadata To Scan Types And Scanners

**Files:**
- Modify: `desktop/src/types/editor-scan.ts`
- Modify: `desktop/src/definitions/editor/shared-rule-scanners.ts`
- Modify: `desktop/electron/services/editor-scan-service.ts`
- Test: `desktop/electron/services/__tests__/editor-scan-service.test.ts`

- [ ] **Step 1: Write failing tests for scan trash metadata**

Add these assertions to `desktop/electron/services/__tests__/editor-scan-service.test.ts`.

In the “merges Codex global skill directories” test, extend the existing `expect` block:

```ts
expect(result.skills.find((skill) => skill.name === "reviewer")?.trash).toEqual({
  mode: "path",
})
```

In the “keeps the exact content for each Codex rule segment” test, extend the existing assertions:

```ts
expect(items.find((item) => item.name === "first")?.trash).toEqual({
  mode: "rule-section",
  ruleId: "first",
})
expect(items.find((item) => item.name === "second")?.trash).toEqual({
  mode: "rule-section",
  ruleId: "second",
})
```

Add a new test near the Codex rule tests:

```ts
it("marks shared-file handwritten Codex rules as unsupported for trash", async () => {
  const root = await createTempDir()
  const filePath = path.join(root, "AGENTS.md")
  await writeFile(
    filePath,
    [
      "# Handwritten Rule",
      "",
      "Keep this section because it has no Synapse marker boundary.",
    ].join("\n"),
  )

  const items = await scanCodexRules(filePath)

  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({
    name: "Handwritten Rule",
    trash: {
      mode: "unsupported",
      disabledReason: "当前 Rule 没有明确边界，请在 Finder 中处理。",
    },
  })
})
```

Add a new test near the Cursor scanner tests:

```ts
it("marks standalone Cursor rule files as path-trashable", async () => {
  const root = await createTempDir()
  const rulePath = path.join(root, "project.mdc")
  await writeFile(rulePath, "---\ndescription: Project rule\n---\n# Rule\n")

  const items = await scanCursorRules(root)

  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({
    path: rulePath,
    trash: { mode: "path" },
  })
})
```

- [ ] **Step 2: Run metadata tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-scan-service.test.ts
```

Expected: FAIL with type or assertion errors because `trash` is not present yet.

- [ ] **Step 3: Add trash types**

Update `desktop/src/types/editor-scan.ts` with these type additions and fields:

```ts
export type EditorScanTrashInfo =
  | { mode: "path" }
  | { mode: "rule-section"; ruleId: string }
  | { mode: "unsupported"; disabledReason: string }

export type EditorScanTrashMode = EditorScanTrashInfo["mode"]

export type EditorScanTrashRequest = {
  itemType: "skill" | "rule"
  itemName: string
  itemPath: string
  editorId: SynapseEditorId
  scope: EditorScanScope
  source: EditorScanItemSource
  trash: EditorScanTrashInfo
  synapseContentId?: string | null
}

export type EditorScanTrashResult = {
  trashed: true
  mode: EditorScanTrashMode
  path: string
}
```

Add `trash: EditorScanTrashInfo` to `EditorScanSkillItem`, `EditorScanRuleItem`, and `ScanItemForDetail`.

- [ ] **Step 4: Add trash metadata in Rule scanners**

In `desktop/src/definitions/editor/shared-rule-scanners.ts`, add constants near the existing marker regex:

```ts
const RULE_TRASH_UNSUPPORTED_REASON = "当前 Rule 没有明确边界，请在 Finder 中处理。"
const PATH_TRASH = { mode: "path" } as const

function createRuleSectionTrash(ruleId: string) {
  return { mode: "rule-section", ruleId } as const
}

function createUnsupportedRuleTrash() {
  return {
    mode: "unsupported",
    disabledReason: RULE_TRASH_UNSUPPORTED_REASON,
  } as const
}
```

Add `trash: PATH_TRASH` to items created in `scanClaudeCodeRules` and `scanCursorRules`.

Add `trash: createRuleSectionTrash(ruleId)` to Synapse marker items created in `scanCodexRules`.

Add `trash: createUnsupportedRuleTrash()` to the unmarked heading and unmarked fallback items created in `scanCodexRules`.

- [ ] **Step 5: Add trash metadata in Skill scans**

In `desktop/electron/services/editor-scan-service.ts`, add `trash: { mode: "path" }` to each `EditorScanSkillItem` pushed by `scanSkillsDirectory`:

```ts
items.push({
  name: entry.name,
  path: skillDir,
  source,
  synapseContentId: meta?.id ?? null,
  preview,
  fileCount: children.length,
  trash: { mode: "path" },
})
```

- [ ] **Step 6: Run metadata tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-scan-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add desktop/src/types/editor-scan.ts desktop/src/definitions/editor/shared-rule-scanners.ts desktop/electron/services/editor-scan-service.ts desktop/electron/services/__tests__/editor-scan-service.test.ts
git commit -m "feat: mark scanned IDE items with trash metadata"
```

---

## Task 2: Implement Main-Process Trash Operation

**Files:**
- Modify: `desktop/electron/services/editor-scan-service.ts`
- Test: `desktop/electron/services/__tests__/editor-scan-service.test.ts`

- [ ] **Step 1: Write failing main-process trash tests**

Update the Electron mock at the top of `desktop/electron/services/__tests__/editor-scan-service.test.ts`:

```ts
const trashItem = vi.hoisted(() => vi.fn())

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-editor-scan-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
  shell: {
    trashItem,
  },
}))
```

Update the service import:

```ts
import { prepareQuickPublishDraft, scanSkillDirectories, trashScanItem } from "../editor-scan-service"
```

Reset the mock in `afterEach`:

```ts
trashItem.mockReset()
```

Add this helper below `createTempDir`:

```ts
function createAllowingSecurity() {
  const auditEvents: Array<{
    action: string
    outcome: string
    resource: string
    metadata?: Record<string, unknown>
  }> = []

  return {
    auditEvents,
    security: {
      actor: { kind: "user" as const },
      auditSink: {
        record: vi.fn((event) => auditEvents.push(event)),
        list: vi.fn(() => auditEvents),
        clearForTests: vi.fn(),
      },
      permissionGuard: {
        registerPolicy: vi.fn(() => () => {}),
        check: vi.fn(async () => ({ allowed: true as const })),
      },
    },
  }
}
```

Add these tests near the existing `describe("editor scan quick publish", ...)` block or in a new `describe("editor scan trash", ...)` block:

```ts
describe("editor scan trash", () => {
  it("moves a skill directory to the system trash", async () => {
    const root = await createTempDir()
    const skillDir = path.join(root, "release-helper")
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, "SKILL.md"), "# Release Helper\n")
    trashItem.mockResolvedValue(undefined)
    const { auditEvents, security } = createAllowingSecurity()

    const result = await trashScanItem({
      itemType: "skill",
      itemName: "release-helper",
      itemPath: skillDir,
      editorId: "codex",
      scope: "global",
      source: "external",
      trash: { mode: "path" },
      synapseContentId: null,
    }, security)

    expect(trashItem).toHaveBeenCalledWith(skillDir)
    expect(result).toEqual({ trashed: true, mode: "path", path: skillDir })
    expect(auditEvents.at(-1)).toMatchObject({
      action: "fs.write",
      outcome: "allowed",
      resource: skillDir,
      metadata: {
        operation: "trash",
        contentType: "skill",
        editorId: "codex",
        scope: "global",
        source: "external",
        trashMode: "path",
      },
    })
  })

  it("moves a standalone rule file to the system trash", async () => {
    const root = await createTempDir()
    const rulePath = path.join(root, "project.mdc")
    await writeFile(rulePath, "# Rule\n")
    trashItem.mockResolvedValue(undefined)
    const { security } = createAllowingSecurity()

    await expect(trashScanItem({
      itemType: "rule",
      itemName: "project.mdc",
      itemPath: rulePath,
      editorId: "cursor",
      scope: "project",
      source: "external",
      trash: { mode: "path" },
      synapseContentId: null,
    }, security)).resolves.toMatchObject({
      trashed: true,
      mode: "path",
      path: rulePath,
    })

    expect(trashItem).toHaveBeenCalledWith(rulePath)
  })

  it("removes only the target Synapse rule section from a shared file", async () => {
    const root = await createTempDir()
    const filePath = path.join(root, "AGENTS.md")
    await writeFile(
      filePath,
      [
        "# Handwritten",
        "",
        "Keep this.",
        "",
        "<!-- synapse-rule:first:begin -->",
        "# First",
        "<!-- synapse-rule:first:end -->",
        "",
        "<!-- synapse-rule:second:begin -->",
        "# Second",
        "<!-- synapse-rule:second:end -->",
      ].join("\n"),
    )
    const { security } = createAllowingSecurity()

    await trashScanItem({
      itemType: "rule",
      itemName: "first",
      itemPath: filePath,
      editorId: "codex",
      scope: "global",
      source: "synapse",
      trash: { mode: "rule-section", ruleId: "first" },
      synapseContentId: "first",
    }, security)

    const nextContent = await readFile(filePath, "utf8")
    expect(nextContent).not.toContain("synapse-rule:first")
    expect(nextContent).toContain("# Handwritten")
    expect(nextContent).toContain("synapse-rule:second:begin")
    expect(trashItem).not.toHaveBeenCalled()
  })

  it("rejects unsupported shared-file handwritten rules", async () => {
    const root = await createTempDir()
    const filePath = path.join(root, "AGENTS.md")
    await writeFile(filePath, "# Handwritten\n")
    const { security } = createAllowingSecurity()

    await expect(trashScanItem({
      itemType: "rule",
      itemName: "Handwritten",
      itemPath: filePath,
      editorId: "codex",
      scope: "global",
      source: "external",
      trash: {
        mode: "unsupported",
        disabledReason: "当前 Rule 没有明确边界，请在 Finder 中处理。",
      },
      synapseContentId: null,
    }, security)).rejects.toThrow("当前 Rule 没有明确边界，请在 Finder 中处理。")

    expect(trashItem).not.toHaveBeenCalled()
  })

  it("does not trash when permission is denied", async () => {
    const root = await createTempDir()
    const rulePath = path.join(root, "project.md")
    await writeFile(rulePath, "# Rule\n")
    const auditEvents: Array<{ outcome: string; resource: string }> = []
    const security = {
      actor: { kind: "user" as const },
      auditSink: {
        record: vi.fn((event) => auditEvents.push(event)),
        list: vi.fn(() => auditEvents),
        clearForTests: vi.fn(),
      },
      permissionGuard: {
        registerPolicy: vi.fn(() => () => {}),
        check: vi.fn(async () => ({ allowed: false as const, reason: "denied" })),
      },
    }

    await expect(trashScanItem({
      itemType: "rule",
      itemName: "project.md",
      itemPath: rulePath,
      editorId: "claude-code",
      scope: "project",
      source: "external",
      trash: { mode: "path" },
      synapseContentId: null,
    }, security)).rejects.toThrow("没有写入该位置的权限。")

    expect(trashItem).not.toHaveBeenCalled()
    expect(auditEvents.at(-1)).toMatchObject({
      outcome: "denied",
      resource: rulePath,
    })
  })
})
```

- [ ] **Step 2: Run trash tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-scan-service.test.ts
```

Expected: FAIL because `trashScanItem` is not exported.

- [ ] **Step 3: Implement permission and audit helpers**

In `desktop/electron/services/editor-scan-service.ts`, update imports:

```ts
import { lstat, readFile, readdir, stat } from "node:fs/promises"
import { shell } from "electron"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import {
  formatEditorWriteFailure,
  replaceFileAtomically,
} from "./editor-file-write-utils"
```

Add these types and helpers near the existing helper section:

```ts
type EditorScanTrashSecurityDeps = {
  actor: ActorIdentity
  auditSink: AuditSink
  permissionGuard: PermissionGuard
}

const RULE_TRASH_UNSUPPORTED_REASON = "当前 Rule 没有明确边界，请在 Finder 中处理。"
const SAFE_RULE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function checkEditorTrashPermission(
  deps: EditorScanTrashSecurityDeps | undefined,
  resource: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!deps) return
  const permission = await deps.permissionGuard.check({
    action: "fs.write",
    actor: deps.actor,
    context: metadata,
    resource,
  })
  if (!permission.allowed) {
    deps.auditSink.record({
      action: "fs.write",
      actor: deps.actor,
      metadata,
      outcome: "denied",
      resource,
    })
    throw new Error("没有写入该位置的权限。")
  }
}

function recordEditorTrashAudit(
  deps: EditorScanTrashSecurityDeps | undefined,
  resource: string,
  outcome: "allowed" | "failed",
  metadata: Record<string, unknown>,
): void {
  deps?.auditSink.record({
    action: "fs.write",
    actor: deps.actor,
    metadata,
    outcome,
    resource,
  })
}
```

- [ ] **Step 4: Implement validation and section removal helpers**

Add these helpers in `desktop/electron/services/editor-scan-service.ts`:

```ts
async function assertTrashableSkillDirectory(dirPath: string): Promise<void> {
  let info
  try {
    info = await lstat(dirPath)
  } catch {
    throw new Error("目标不存在。")
  }

  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("目标类型不匹配。")
  }

  const mainFile = await resolveSkillMainFile(dirPath)
  const meta = await readSynapseSkillMeta(dirPath)
  if (!mainFile && !meta) {
    throw new Error("目标类型不匹配。")
  }
}

async function assertTrashableRuleFile(filePath: string): Promise<void> {
  let info
  try {
    info = await lstat(filePath)
  } catch {
    throw new Error("目标不存在。")
  }

  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error("目标类型不匹配。")
  }

  const extension = path.extname(filePath).toLowerCase()
  if (extension !== ".md" && extension !== ".mdc") {
    throw new Error("目标类型不匹配。")
  }
}

function removeSynapseRuleSection(existingContent: string, ruleId: string): string {
  if (!SAFE_RULE_ID_PATTERN.test(ruleId)) {
    throw new Error(RULE_TRASH_UNSUPPORTED_REASON)
  }

  const escapedId = escapeForRegex(ruleId)
  const sectionPattern = new RegExp(
    `\\n?<!--\\s*synapse-rule:${escapedId}:begin\\s*-->[\\s\\S]*?<!--\\s*synapse-rule:${escapedId}:end\\s*-->\\n?`,
    "u",
  )

  if (!sectionPattern.test(existingContent)) {
    throw new Error("目标不存在。")
  }

  const nextContent = existingContent.replace(sectionPattern, "\n")
  return nextContent.replace(/\n{3,}/gu, "\n\n").replace(/^\n+/u, "").replace(/\s+$/u, "")
}
```

- [ ] **Step 5: Implement `trashScanItem`**

Add the function in `desktop/electron/services/editor-scan-service.ts`:

```ts
async function trashScanItem(
  request: EditorScanTrashRequest,
  security?: EditorScanTrashSecurityDeps,
): Promise<EditorScanTrashResult> {
  const auditMetadata = {
    contentType: request.itemType,
    editorId: request.editorId,
    operation: "trash",
    scope: request.scope,
    source: request.source,
    trashMode: request.trash.mode,
  }

  await checkEditorTrashPermission(security, request.itemPath, auditMetadata)

  try {
    if (request.trash.mode === "unsupported") {
      throw new Error(request.trash.disabledReason)
    }

    if (request.trash.mode === "rule-section") {
      const existingContent = await readFile(request.itemPath, "utf8")
      const nextContent = removeSynapseRuleSection(existingContent, request.trash.ruleId)
      await replaceFileAtomically(request.itemPath, nextContent)
      recordEditorTrashAudit(security, request.itemPath, "allowed", auditMetadata)
      return {
        trashed: true,
        mode: request.trash.mode,
        path: request.itemPath,
      }
    }

    if (request.itemType === "skill") {
      await assertTrashableSkillDirectory(request.itemPath)
    } else {
      await assertTrashableRuleFile(request.itemPath)
    }

    await shell.trashItem(request.itemPath)
    recordEditorTrashAudit(security, request.itemPath, "allowed", auditMetadata)
    return {
      trashed: true,
      mode: request.trash.mode,
      path: request.itemPath,
    }
  } catch (error) {
    recordEditorTrashAudit(security, request.itemPath, "failed", auditMetadata)
    throw formatEditorWriteFailure(error, request.itemPath)
  }
}
```

Update the export list:

```ts
export {
  scanAll,
  readItemContent,
  listSkillFiles,
  prepareQuickPublishDraft,
  scanSkillDirectories,
  trashScanItem,
}
```

- [ ] **Step 6: Run trash tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-scan-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add desktop/electron/services/editor-scan-service.ts desktop/electron/services/__tests__/editor-scan-service.test.ts
git commit -m "feat: trash scanned IDE items in main process"
```

---

## Task 3: Wire IPC, Preload, And Bridge Types

**Files:**
- Modify: `desktop/electron/modules/editor-scan/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`

- [ ] **Step 1: Add IPC schemas and handler**

In `desktop/electron/modules/editor-scan/ipc.ts`, update imports:

```ts
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type {
  EditorScanQuickPublishRequest,
  EditorScanTrashRequest,
} from "../../../src/types/editor-scan"
import {
  scanAll,
  readItemContent,
  listSkillFiles,
  prepareQuickPublishDraft,
  trashScanItem,
} from "../../services/editor-scan-service"
```

Add schemas near the existing quick publish schemas:

```ts
const editorScanTrashInfoSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("path") }),
  z.object({ mode: z.literal("rule-section"), ruleId: z.string() }),
  z.object({ mode: z.literal("unsupported"), disabledReason: z.string() }),
])

const trashRequestSchema = z.object({
  itemType: z.enum(["skill", "rule"]),
  itemName: z.string(),
  itemPath: z.string(),
  editorId: z.string(),
  scope: z.enum(["global", "project"]),
  source: editorScanItemSourceSchema,
  trash: editorScanTrashInfoSchema,
  synapseContentId: z.string().nullable().optional(),
})

const trashResultSchema = z.object({
  trashed: z.literal(true),
  mode: z.enum(["path", "rule-section", "unsupported"]),
  path: z.string(),
})
```

Update `editorScanSkillItemSchema`:

```ts
const editorScanSkillItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  source: editorScanItemSourceSchema,
  synapseContentId: z.string().nullable(),
  preview: z.string(),
  fileCount: z.number(),
  trash: editorScanTrashInfoSchema,
})
```

Update `editorScanRuleItemSchema`:

```ts
const editorScanRuleItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  source: editorScanItemSourceSchema,
  synapseContentId: z.string().nullable(),
  preview: z.string(),
  metadata: z.record(z.string(), z.string()),
  content: z.string().optional(),
  trash: editorScanTrashInfoSchema,
})
```

Add the method inside `methods`:

```ts
trashItem: {
  kind: "invoke",
  channel: "synapse:editor-scan:trash-item",
  request: trashRequestSchema,
  response: trashResultSchema,
  handler: async (ctx, request: EditorScanTrashRequest) => {
    return trashScanItem(request, {
      actor: { kind: "user" },
      auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
      permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
    })
  },
},
```

- [ ] **Step 2: Regenerate IPC channels**

Run:

```bash
pnpm desktop:generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` includes:

```ts
"trashItem": "synapse:editor-scan:trash-item",
```

- [ ] **Step 3: Add preload method**

In `desktop/electron/preload.ts`, add to `editorScan`:

```ts
trashItem: (request) =>
  invoke(IPC_CHANNELS["editor-scan"].trashItem)(request),
```

- [ ] **Step 4: Add bridge type**

In `desktop/src/types/bridge.ts`, update imports from `./editor-scan` to include `EditorScanTrashRequest` and `EditorScanTrashResult`, then add to `editorScan`:

```ts
trashItem: (request: EditorScanTrashRequest) => Promise<EditorScanTrashResult>
```

- [ ] **Step 5: Verify IPC codegen and typecheck**

Run:

```bash
pnpm desktop:check:ipc-codegen
pnpm desktop:typecheck
```

Expected:

- `IPC codegen output is in sync with electron/generated/ipc-channels.generated.ts`
- TypeScript completes without errors.

- [ ] **Step 6: Commit Task 3**

```bash
git add desktop/electron/modules/editor-scan/ipc.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat: expose editor scan trash IPC"
```

---

## Task 4: Add Detail Dialog Trash UI

**Files:**
- Modify: `desktop/src/modules/editor-scan/index.tsx`
- Modify: `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
- Test: `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`

- [ ] **Step 1: Write failing renderer source tests**

Append these tests to `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`:

```ts
it("offers trash only from scan item details", async () => {
  const detailSource = await readFile(
    new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
    "utf8",
  )
  const cardSource = await readFile(
    new URL("../components/scan-item-card.tsx", import.meta.url),
    "utf8",
  )

  expect(detailSource).toContain("移到废纸篓")
  expect(detailSource).toContain("editor-scan-trash-confirm")
  expect(detailSource).toContain("已移到废纸篓")
  expect(cardSource).not.toContain("移到废纸篓")
  expect(cardSource).not.toContain("Trash2")
})

it("uses the scan trash bridge from the detail dialog", async () => {
  const source = await readFile(
    new URL("../components/scan-item-detail-dialog.tsx", import.meta.url),
    "utf8",
  )

  expect(source).toContain("bridge.editorScan.trashItem")
  expect(source).toContain("item.trash.mode === \"unsupported\"")
  expect(source).toContain("当前 Rule 没有明确边界，请在 Finder 中处理。")
})
```

- [ ] **Step 2: Run renderer source tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
```

Expected: FAIL because the detail dialog does not contain the trash UI yet.

- [ ] **Step 3: Pass trash metadata into the detail item**

In `desktop/src/modules/editor-scan/index.tsx`, add `trash: item.trash` in `handleItemClick`:

```ts
setDetailItem({
  type,
  name: item.name,
  path: item.path,
  source: item.source,
  preview: item.preview,
  fileCount: "fileCount" in item ? item.fileCount : undefined,
  metadata: "metadata" in item ? item.metadata : undefined,
  synapseContentId: item.synapseContentId,
  editorId: context.editorId,
  editorLabel: context.editorLabel,
  scope: context.scope,
  projectName: context.projectName,
  content: "content" in item ? item.content : undefined,
  trash: item.trash,
})
```

Rename the detail prop in this file:

```tsx
<ScanItemDetailDialog
  item={detailItem}
  onChanged={refresh}
  open={detailOpen}
  onOpenChange={setDetailOpen}
/>
```

- [ ] **Step 4: Add detail dialog state and handler**

In `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`, update imports:

```ts
import { File, FolderOpen, LoaderCircle, Trash2 } from "lucide-react"
```

Rename props:

```ts
type ScanItemDetailDialogProps = {
  item: ScanItemForDetail | null
  onChanged?: () => Promise<void> | void
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ScanItemDetailDialog({ item, onChanged, open, onOpenChange }: ScanItemDetailDialogProps) {
```

Add state near the existing quick publish state:

```ts
const [trashError, setTrashError] = useState<string | null>(null)
const [isTrashConfirmOpen, setIsTrashConfirmOpen] = useState(false)
const [isTrashBusy, setIsTrashBusy] = useState(false)
```

Reset state in the existing `useEffect` when `!open`:

```ts
setTrashError(null)
setIsTrashConfirmOpen(false)
setIsTrashBusy(false)
```

Add derived state and handler after `handleOpenInFinder`:

```ts
const trashDisabledReason = item?.trash.mode === "unsupported"
  ? item.trash.disabledReason
  : null

const handleTrashConfirm = useCallback(async () => {
  if (!item || trashDisabledReason) return
  setIsTrashBusy(true)
  setTrashError(null)

  try {
    const bridge = getSynapseBridge()
    if (!bridge) {
      throw new Error("当前窗口无法处理本机内容。")
    }

    await bridge.editorScan.trashItem({
      itemType: item.type,
      itemName: item.name,
      itemPath: item.path,
      editorId: item.editorId,
      scope: item.scope,
      source: item.source,
      trash: item.trash,
      synapseContentId: item.synapseContentId ?? null,
    })

    success("已移到废纸篓")
    logger.info("Scan item moved to trash.", {
      editorId: item.editorId,
      itemType: item.type,
      path: item.path,
      scope: item.scope,
      trashMode: item.trash.mode,
    })
    setIsTrashConfirmOpen(false)
    onOpenChange(false)
    await onChanged?.()
  } catch (error) {
    logger.error("Scan item trash failed.", { path: item.path, error })
    setTrashError(error instanceof Error ? error.message : "移到废纸篓失败。")
  } finally {
    setIsTrashBusy(false)
  }
}, [item, onChanged, onOpenChange, success, trashDisabledReason])
```

- [ ] **Step 5: Add confirmation dialog and footer button**

In `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`, add this `AlertDialog` before the existing `fallbackReason` alert dialog:

```tsx
<AlertDialog
  open={isTrashConfirmOpen}
  onOpenChange={(nextOpen) => {
    if (!isTrashBusy) setIsTrashConfirmOpen(nextOpen)
  }}
  data-track="editor-scan-trash-confirm"
>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>移到废纸篓？</AlertDialogTitle>
      <AlertDialogDescription>
        {item.name}
        <br />
        {item.path}
        <br />
        可从系统废纸篓恢复。
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel disabled={isTrashBusy}>取消</AlertDialogCancel>
      <AlertDialogAction
        data-track="editor-scan-trash-confirm-submit"
        disabled={isTrashBusy}
        onClick={(event) => {
          event.preventDefault()
          void handleTrashConfirm()
        }}
      >
        {isTrashBusy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
        移到废纸篓
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Render `trashError` beside `quickPublishError`:

```tsx
{trashError ? (
  <Alert variant="destructive">
    <AlertDescription>{trashError}</AlertDescription>
  </Alert>
) : null}
```

Add the footer button before `复制到其它编辑器`:

```tsx
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isTrashBusy || trashDisabledReason !== null}
          onClick={() => setIsTrashConfirmOpen(true)}
        >
          <Trash2 data-icon="inline-start" />
          移到废纸篓
        </Button>
      </span>
    </TooltipTrigger>
    {trashDisabledReason ? (
      <TooltipContent>{trashDisabledReason}</TooltipContent>
    ) : null}
  </Tooltip>
</TooltipProvider>
```

Keep the existing `EditorCopyDialog` wired to the renamed callback:

```tsx
<EditorCopyDialog
  content={content}
  item={item}
  onCopied={onChanged}
  open={isEditorCopyOpen}
  onOpenChange={setIsEditorCopyOpen}
/>
```

- [ ] **Step 6: Run renderer source tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add desktop/src/modules/editor-scan/index.tsx desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
git commit -m "feat: add editor scan trash action UI"
```

---

## Task 5: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-scan-service.test.ts src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run IPC codegen check**

Run:

```bash
pnpm desktop:check:ipc-codegen
```

Expected:

```text
IPC codegen output is in sync with electron/generated/ipc-channels.generated.ts
```

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm desktop:check:hard-constraints
```

Expected: PASS. This verifies the new IPC method stays inside `desktop/electron/modules/editor-scan/ipc.ts`, renderer capabilities remain through `window.synapse`, and no forbidden Electron patterns were introduced.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm desktop:typecheck
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat HEAD~4..HEAD
git diff --check HEAD~4..HEAD
```

Expected:

- Diff only touches files listed in this plan.
- `git diff --check` prints no whitespace errors.

- [ ] **Step 6: Commit any verification-only fix**

If a verification step required a small fix, commit it:

```bash
git add <fixed-files>
git commit -m "fix: complete editor scan trash verification"
```

If no fix was needed, do not create an empty commit.

---

## Plan Self-Review

Spec coverage:

- Detail-only entry is covered by Task 4.
- Skill directory trash is covered by Tasks 1 and 2.
- Standalone Rule file trash is covered by Tasks 1 and 2.
- Shared Synapse Rule section deletion is covered by Tasks 1 and 2.
- Unsupported shared handwritten Rule behavior is covered by Tasks 1, 2, and 4.
- Permission and audit requirements are covered by Tasks 2 and 3.
- IPC and bridge boundaries are covered by Task 3.
- Focused and broader verification are covered by Task 5.

Placeholder scan:

- The plan contains concrete file paths, commands, snippets, and expected outcomes.
- No unspecified implementation steps are required to complete the feature.

Type consistency:

- `EditorScanTrashInfo`, `EditorScanTrashRequest`, and `EditorScanTrashResult` are defined before IPC, preload, bridge, and UI steps use them.
- The renderer passes exactly the fields accepted by `trashScanItem`.
- `onChanged` replaces the detail dialog’s copy-specific refresh callback while preserving `EditorCopyDialog`’s existing `onCopied` prop.
