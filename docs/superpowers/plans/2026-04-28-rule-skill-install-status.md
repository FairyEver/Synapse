# Rule / Skill Install Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Rule / Skill install-status loop that shows editor target status in content details, keeps install/copy wording distinct, refreshes after writes, and audits editor-directory writes.

**Architecture:** Add a main-process install-status service that derives status from editor target resolution and existing IDE scan data. Keep write execution in the existing install/copy services, but pass permission/audit deps through IPC and tighten replacement failure behavior. In the renderer, add a focused install-status hook and panel, then thin the install/copy dialogs by giving the shared target selector action-aware labels.

**Tech Stack:** Electron main process, React 19, TypeScript, Vitest, Tailwind CSS, shadcn/ui + Radix, existing IPC registry, existing PermissionGuard/AuditSink.

---

## File Structure

- Create `desktop/src/types/editor-install-status.ts`
  - Shared renderer/main types for status payloads and entries.
- Modify `desktop/src/types/bridge.ts`
  - Add `editorInstallStatus.resolveForContent` to the preload bridge type.
- Create `desktop/src/app-shell/editor-install-status.ts`
  - Renderer wrapper around `window.synapse.editorInstallStatus`.
- Modify `desktop/electron/preload.ts`
  - Expose the new bridge method.
- Create `desktop/electron/services/editor-install-status-service.ts`
  - Main-process status calculation service.
- Create `desktop/electron/modules/editor-install-status/ipc.ts`
  - IPC module for status resolution.
- Modify `desktop/electron/bootstrap/ipc-registry.ts`
  - Register the new IPC module.
- Create `desktop/electron/services/__tests__/editor-install-status-service.test.ts`
  - Main-process status tests.
- Modify `desktop/electron/services/content-install-service.ts`
  - Accept optional security deps, audit writes, and block replacement when backup fails.
- Modify `desktop/electron/services/editor-copy-service.ts`
  - Accept optional security deps and audit writes.
- Modify `desktop/electron/modules/content/ipc.ts`
  - Pass PermissionGuard/AuditSink into install writes.
- Modify `desktop/electron/modules/editor-copy/ipc.ts`
  - Pass PermissionGuard/AuditSink into copy writes.
- Modify `desktop/electron/services/__tests__/editor-copy-service.test.ts`
  - Cover audit and copy wording-adjacent behavior at service level.
- Create `desktop/electron/services/__tests__/content-install-service-security.test.ts`
  - Cover backup failure and audit outcomes.
- Rename `desktop/src/modules/content/components/editor-install-target-selector.tsx` to `desktop/src/modules/content/components/editor-write-target-selector.tsx`
  - Keep target-selection behavior, add action-aware copy.
- Modify `desktop/src/modules/content/components/content-install-dialog.tsx`
  - Use `EditorWriteTargetSelector`, keep install wording, call `onInstalled`.
- Modify `desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx`
  - Use `EditorWriteTargetSelector`, switch visible copy-flow wording to copy.
- Modify `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`
  - Update wording guard to require copy wording and reject install wording in copy dialog.
- Create `desktop/src/modules/content/hooks/use-editor-install-status.ts`
  - Load and refresh install status for Rule / Skill details.
- Create `desktop/src/modules/content/components/editor-install-status-panel.tsx`
  - Display compact status rows with refresh/open/install/update actions.
- Modify `desktop/src/modules/content/components/content-detail-dialog.tsx`
  - Load status and render the panel for Rule / Skill only.
- Modify `desktop/src/modules/content/hooks/use-editor-adapters-for-content-type.ts`
  - Make editor-adapter loading awaitable so status-panel install actions can open the existing install dialog.
- Create `desktop/src/modules/content/__tests__/editor-install-status-panel.test.tsx`
  - Renderer tests for panel behavior.
- Create `desktop/src/modules/content/__tests__/content-detail-install-status-layout.test.ts`
  - Static layout tests for Rule / Skill vs Prompt behavior and callback wiring.

---

### Task 1: Add Install Status Types And Bridge Surface

**Files:**
- Create: `desktop/src/types/editor-install-status.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/preload.ts`
- Create: `desktop/src/app-shell/editor-install-status.ts`
- Test: `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Add shared install-status types**

Create `desktop/src/types/editor-install-status.ts`:

```ts
import type { SynapseContentType } from "./content"
import type { SynapseEditorId, SynapseEditorInstallScope } from "./editor"

export type SynapseEditorInstallStatusValue =
  | "not_installed"
  | "installed"
  | "needs_update"
  | "external_same_name"
  | "conflict"
  | "unsupported"
  | "unavailable"

export type SynapseEditorInstallStatusProject = {
  id: string
  name: string
  path: string
}

export type SynapseResolveEditorInstallStatusPayload = {
  contentType: Extract<SynapseContentType, "rule" | "skill">
  contentId: string
  contentName?: string
  title?: string
  content?: string
  projects: SynapseEditorInstallStatusProject[]
}

export type SynapseEditorInstallStatusEntry = {
  editorId: SynapseEditorId
  editorLabel: string
  scope: SynapseEditorInstallScope
  projectId?: string
  projectName?: string
  status: SynapseEditorInstallStatusValue
  targetPath: string | null
  message: string | null
}

export type SynapseEditorInstallStatusResult = {
  entries: SynapseEditorInstallStatusEntry[]
}
```

- [ ] **Step 2: Extend the bridge type**

In `desktop/src/types/bridge.ts`, import the new payload/result types and add a bridge section:

```ts
import type {
  SynapseEditorInstallStatusResult,
  SynapseResolveEditorInstallStatusPayload,
} from "./editor-install-status"
```

Add this property to the `SynapseBridge` shape next to `editorCopy` and `editorScan`:

```ts
editorInstallStatus: {
  resolveForContent: (
    payload: SynapseResolveEditorInstallStatusPayload,
  ) => Promise<SynapseEditorInstallStatusResult>
}
```

- [ ] **Step 3: Expose the preload bridge**

In `desktop/electron/preload.ts`, add a channel name:

```ts
"editor-install-status": {
  "resolveForContent": "synapse:editor-install-status:resolve-for-content",
},
```

Then expose it in the bridge object:

```ts
editorInstallStatus: {
  resolveForContent: invoke(IPC_CHANNELS["editor-install-status"].resolveForContent),
},
```

- [ ] **Step 4: Add renderer app-shell wrapper**

Create `desktop/src/app-shell/editor-install-status.ts`:

```ts
import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseEditorInstallStatusResult,
  SynapseResolveEditorInstallStatusPayload,
} from "@/types/editor-install-status"

const DEFAULT_EDITOR_INSTALL_STATUS_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的编辑器安装状态桥接。请确认你打开的是桌面应用窗口，而不是独立浏览器页面。"

type RendererEditorInstallStatusBridge =
  NonNullable<Window["synapse"]>["editorInstallStatus"]

function requireEditorInstallStatusBridge(): RendererEditorInstallStatusBridge {
  const bridge = getSynapseBridge()?.editorInstallStatus

  if (!bridge) {
    throw createMissingBridgeError(DEFAULT_EDITOR_INSTALL_STATUS_BRIDGE_ERROR_MESSAGE)
  }

  return bridge
}

async function resolveEditorInstallStatus(
  payload: SynapseResolveEditorInstallStatusPayload,
): Promise<SynapseEditorInstallStatusResult> {
  return requireEditorInstallStatusBridge().resolveForContent(payload)
}

export { resolveEditorInstallStatus }
```

- [ ] **Step 5: Run preload/codegen tests for the bridge surface**

Run:

```bash
pnpm desktop:test -- electron/__tests__/preload.test.ts
```

Expected before IPC registration/codegen is complete: fail on missing generated channel or preload expectation. Keep the failure; Task 2 completes the IPC registration.

---

### Task 2: Implement Main-Process Install Status Service

**Files:**
- Create: `desktop/electron/services/editor-install-status-service.ts`
- Create: `desktop/electron/services/__tests__/editor-install-status-service.test.ts`
- Modify: `desktop/electron/modules/editor-install-status/ipc.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`

- [ ] **Step 1: Write service tests for rule and skill statuses**

Create `desktop/electron/services/__tests__/editor-install-status-service.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-install-status-test-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

import { EditorInstallStatusService } from "../editor-install-status-service"

const roots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-install-status-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("EditorInstallStatusService", () => {
  it("marks a Codex project rule as installed when scan finds the same content id", async () => {
    const root = await createRoot()
    const projectPath = path.join(root, "project")
    await mkdir(projectPath, { recursive: true })
    await writeFile(
      path.join(projectPath, "AGENTS.md"),
      [
        "<!-- synapse-rule:rule-1:begin -->",
        "# Rule One",
        "",
        "Use this rule.",
        "<!-- synapse-rule:rule-1:end -->",
      ].join("\n"),
    )

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "rule",
      contentId: "rule-1",
      contentName: "rule-1",
      content: "# Rule One\n\nUse this rule.",
      projects: [{ id: "p1", name: "Project", path: projectPath }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      editorId: "codex",
      projectId: "p1",
      scope: "project",
      status: "installed",
      targetPath: path.join(projectPath, "AGENTS.md"),
    }))
  })

  it("marks a project rule as needs_update when the scanned body differs", async () => {
    const root = await createRoot()
    const projectPath = path.join(root, "project")
    await mkdir(projectPath, { recursive: true })
    await writeFile(
      path.join(projectPath, "AGENTS.md"),
      [
        "<!-- synapse-rule:rule-2:begin -->",
        "# Old",
        "<!-- synapse-rule:rule-2:end -->",
      ].join("\n"),
    )

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "rule",
      contentId: "rule-2",
      contentName: "rule-2",
      content: "# New",
      projects: [{ id: "p1", name: "Project", path: projectPath }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      editorId: "codex",
      projectId: "p1",
      scope: "project",
      status: "needs_update",
    }))
  })

  it("marks a skill directory with the same .synapse.json id as installed", async () => {
    const root = await createRoot()
    const projectPath = path.join(root, "project")
    const skillPath = path.join(projectPath, ".agents", "skills", "helper")
    await mkdir(skillPath, { recursive: true })
    await writeFile(path.join(skillPath, ".synapse.json"), JSON.stringify({ id: "skill-1" }))
    await writeFile(path.join(skillPath, "SKILL.md"), "# Helper\n")

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "skill",
      contentId: "skill-1",
      contentName: "helper",
      title: "Helper",
      content: "# Helper",
      projects: [{ id: "p1", name: "Project", path: projectPath }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      editorId: "codex",
      projectId: "p1",
      scope: "project",
      status: "installed",
      targetPath: skillPath,
    }))
  })

  it("marks an existing same-name skill without Synapse metadata as external_same_name", async () => {
    const root = await createRoot()
    const projectPath = path.join(root, "project")
    const skillPath = path.join(projectPath, ".agents", "skills", "helper")
    await mkdir(skillPath, { recursive: true })
    await writeFile(path.join(skillPath, "SKILL.md"), "# External Helper\n")

    const result = await new EditorInstallStatusService().resolveForContent({
      contentType: "skill",
      contentId: "skill-1",
      contentName: "helper",
      title: "Helper",
      content: "# Helper",
      projects: [{ id: "p1", name: "Project", path: projectPath }],
    })

    expect(result.entries).toContainEqual(expect.objectContaining({
      editorId: "codex",
      projectId: "p1",
      scope: "project",
      status: "external_same_name",
      targetPath: skillPath,
    }))
  })
})
```

- [ ] **Step 2: Run the new service tests and verify failure**

Run:

```bash
pnpm desktop:test -- electron/services/__tests__/editor-install-status-service.test.ts
```

Expected: fail because `editor-install-status-service.ts` does not exist.

- [ ] **Step 3: Implement the service**

Create `desktop/electron/services/editor-install-status-service.ts`:

```ts
import type {
  SynapseEditorInstallStatusEntry,
  SynapseEditorInstallStatusResult,
  SynapseResolveEditorInstallStatusPayload,
} from "../../src/types/editor-install-status"
import type { EditorScanRuleItem, EditorScanSkillItem } from "../../src/types/editor-scan"
import { editorAdapters } from "./editor-adapters"
import { editorAdapterService } from "./editor-adapter-service"
import { scanAll } from "./editor-scan-service"

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").trim()
}

function statusFromRule(
  scanItem: EditorScanRuleItem | undefined,
  currentContent: string | undefined,
): SynapseEditorInstallStatusEntry["status"] | null {
  if (!scanItem) return null
  if (scanItem.synapseContentId === null) return "external_same_name"
  if (currentContent && scanItem.content && normalizeMarkdown(scanItem.content) !== normalizeMarkdown(currentContent)) {
    return "needs_update"
  }
  return "installed"
}

function statusFromSkill(
  scanItem: EditorScanSkillItem | undefined,
  contentId: string,
): SynapseEditorInstallStatusEntry["status"] | null {
  if (!scanItem) return null
  if (scanItem.synapseContentId === contentId) return "installed"
  return "external_same_name"
}

class EditorInstallStatusService {
  async resolveForContent(
    payload: SynapseResolveEditorInstallStatusPayload,
  ): Promise<SynapseEditorInstallStatusResult> {
    const scan = await scanAll()
    const entries: SynapseEditorInstallStatusEntry[] = []

    for (const adapter of editorAdapters) {
      const globalTarget = await editorAdapterService.resolveTarget({
        contentId: payload.contentId,
        contentType: payload.contentType,
        editorId: adapter.id,
        ruleName: payload.contentType === "rule" ? payload.contentName : undefined,
        scope: "global",
        skillName: payload.contentType === "skill" ? payload.contentName : undefined,
        skillTitle: payload.contentType === "skill" ? payload.title : undefined,
      })
      const globalScan = scan.global.find((entry) => entry.editorId === adapter.id)
      entries.push(this.toEntry({
        content: payload.content,
        contentId: payload.contentId,
        scanItem: payload.contentType === "rule"
          ? globalScan?.rules.find((item) => item.synapseContentId === payload.contentId || item.name === payload.contentName)
          : globalScan?.skills.find((item) => item.synapseContentId === payload.contentId || item.name === payload.contentName),
        target: globalTarget,
      }))

      for (const project of payload.projects) {
        const target = await editorAdapterService.resolveTarget({
          contentId: payload.contentId,
          contentType: payload.contentType,
          editorId: adapter.id,
          projectPath: project.path,
          ruleName: payload.contentType === "rule" ? payload.contentName : undefined,
          scope: "project",
          skillName: payload.contentType === "skill" ? payload.contentName : undefined,
          skillTitle: payload.contentType === "skill" ? payload.title : undefined,
        })
        const projectScan = scan.projects
          .find((entry) => entry.projectPath === project.path)
          ?.editors.find((entry) => entry.editorId === adapter.id)
        entries.push({
          ...this.toEntry({
            content: payload.content,
            contentId: payload.contentId,
            scanItem: payload.contentType === "rule"
              ? projectScan?.rules.find((item) => item.synapseContentId === payload.contentId || item.name === payload.contentName)
              : projectScan?.skills.find((item) => item.synapseContentId === payload.contentId || item.name === payload.contentName),
            target,
          }),
          projectId: project.id,
          projectName: project.name,
        })
      }
    }

    return { entries }
  }

  private toEntry(args: {
    content?: string
    contentId: string
    scanItem: EditorScanRuleItem | EditorScanSkillItem | undefined
    target: Awaited<ReturnType<typeof editorAdapterService.resolveTarget>>
  }): SynapseEditorInstallStatusEntry {
    if (args.target.status === "unsupported" || args.target.status === "unavailable") {
      return {
        editorId: args.target.editorId,
        editorLabel: args.target.label,
        message: args.target.message,
        scope: args.target.scope,
        status: args.target.status,
        targetPath: null,
      }
    }

    if (args.target.status === "conflict") {
      return {
        editorId: args.target.editorId,
        editorLabel: args.target.label,
        message: args.target.message,
        scope: args.target.scope,
        status: "conflict",
        targetPath: args.target.targetPath,
      }
    }

    const status = args.target.contentType === "rule"
      ? statusFromRule(args.scanItem as EditorScanRuleItem | undefined, args.content)
      : statusFromSkill(args.scanItem as EditorScanSkillItem | undefined, args.contentId)

    return {
      editorId: args.target.editorId,
      editorLabel: args.target.label,
      message: args.target.message,
      scope: args.target.scope,
      status: status ?? "not_installed",
      targetPath: args.target.targetPath,
    }
  }
}

const editorInstallStatusService = new EditorInstallStatusService()

export { EditorInstallStatusService, editorInstallStatusService }
```

- [ ] **Step 4: Add IPC module and registry registration**

Create `desktop/electron/modules/editor-install-status/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import { editorInstallStatusService } from "../../services/editor-install-status-service"
import type { SynapseResolveEditorInstallStatusPayload } from "../../../src/types/editor-install-status"

const requestSchema = z.object({
  contentType: z.enum(["rule", "skill"]),
  contentId: z.string(),
  contentName: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  projects: z.array(z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
  })),
})

export const editorInstallStatusIpcModule: IpcModule = {
  id: "editor-install-status",
  methods: {
    resolveForContent: {
      kind: "invoke",
      channel: "synapse:editor-install-status:resolve-for-content",
      request: requestSchema,
      response: z.object({ entries: z.array(z.any()) }),
      handler: async (_ctx, payload: SynapseResolveEditorInstallStatusPayload) => {
        return editorInstallStatusService.resolveForContent(payload)
      },
    },
  },
  events: {},
}
```

Modify `desktop/electron/bootstrap/ipc-registry.ts`:

```ts
import { editorInstallStatusIpcModule } from "../modules/editor-install-status/ipc"
```

Register it with the other modules:

```ts
registry.register(editorInstallStatusIpcModule, ctx)
```

Add it to the exported module list if that file exports registered modules for tests:

```ts
editorInstallStatusIpcModule,
```

- [ ] **Step 5: Generate IPC code and run focused tests**

Run:

```bash
pnpm desktop:generate:ipc
pnpm desktop:test -- electron/services/__tests__/editor-install-status-service.test.ts electron/__tests__/preload.test.ts
```

Expected: both focused test groups pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add desktop/src/types/editor-install-status.ts desktop/src/types/bridge.ts desktop/src/app-shell/editor-install-status.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/services/editor-install-status-service.ts desktop/electron/modules/editor-install-status/ipc.ts desktop/electron/bootstrap/ipc-registry.ts desktop/electron/services/__tests__/editor-install-status-service.test.ts desktop/electron/__tests__/preload.test.ts
git commit -m "feat: add editor install status bridge"
```

---

### Task 3: Add Write Security And Block Unsafe Skill Replacement

**Files:**
- Modify: `desktop/electron/services/content-install-service.ts`
- Modify: `desktop/electron/services/editor-copy-service.ts`
- Modify: `desktop/electron/modules/content/ipc.ts`
- Modify: `desktop/electron/modules/editor-copy/ipc.ts`
- Create: `desktop/electron/services/__tests__/content-install-service-security.test.ts`
- Modify: `desktop/electron/services/__tests__/editor-copy-service.test.ts`

- [ ] **Step 1: Add failing audit tests for editor copy**

Append to `desktop/electron/services/__tests__/editor-copy-service.test.ts`:

```ts
import { InMemoryAuditSink, createPermissionGuard } from "../../runtime/security"
```

Add this test inside `describe("EditorCopyService", () => { ... })`:

```ts
it("records audit events for successful editor copies", async () => {
  const root = await createTempRoot()
  const sourcePath = path.join(root, "source", "review-rule.md")
  const projectPath = path.join(root, "project")
  await mkdir(path.dirname(sourcePath), { recursive: true })
  await writeFile(sourcePath, "Review carefully.", "utf8")

  const auditSink = new InMemoryAuditSink()
  const service = new EditorCopyService()
  const result = await service.copy({
    source: createRuleSource(sourcePath),
    targetEditorId: "cursor",
    targetProjectPath: projectPath,
    targetScope: "project",
  }, {
    actor: { kind: "user" },
    auditSink,
    permissionGuard: createPermissionGuard(),
  })

  expect(result.targetPath).toContain(".cursor")
  expect(auditSink.list()).toContainEqual(expect.objectContaining({
    action: "fs.write",
    actor: { kind: "user" },
    outcome: "allowed",
    resource: result.targetPath,
  }))
})
```

- [ ] **Step 2: Add failing backup-failure test for content install**

Create `desktop/electron/services/__tests__/content-install-service-security.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-content-install-security-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

vi.mock("../content-service", () => ({
  contentService: {
    getSkillDetail: vi.fn(async () => ({
      id: "skill-1",
      type: "skill",
      source: "builtin",
      title: "Helper",
      name: "helper",
      description: "Helper skill",
      content: "# Helper\n",
      attachments: [],
    })),
  },
}))

import { InMemoryAuditSink, createPermissionGuard } from "../../runtime/security"
import { ContentInstallService } from "../content-install-service"

const roots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-install-security-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("ContentInstallService security", () => {
  it("stops skill replacement when backup cannot be created", async () => {
    const root = await createRoot()
    const projectPath = path.join(root, "project")
    const targetPath = path.join(projectPath, ".agents", "skills", "helper")
    const backupPath = `${targetPath}-backup`
    await mkdir(targetPath, { recursive: true })
    await mkdir(backupPath, { recursive: true })
    await writeFile(path.join(targetPath, "SKILL.md"), "# Existing\n", "utf8")
    await writeFile(path.join(backupPath, "SKILL.md"), "# Backup already exists\n", "utf8")

    const auditSink = new InMemoryAuditSink()
    const service = new ContentInstallService()

    await expect(service.installToEditor({
      contentId: "skill-1",
      contentType: "skill",
      editorId: "codex",
      projectPath,
      replaceConfirmed: true,
      scope: "project",
      skillName: "helper",
      skillTitle: "Helper",
    }, {
      actor: { kind: "user" },
      auditSink,
      permissionGuard: createPermissionGuard(),
    })).rejects.toThrow("备份旧 Skill 失败，未替换目标。")

    expect(auditSink.list()).toContainEqual(expect.objectContaining({
      action: "fs.write",
      outcome: "failed",
      resource: targetPath,
    }))
  })
})
```

- [ ] **Step 3: Run the security tests and verify failure**

Run:

```bash
pnpm desktop:test -- electron/services/__tests__/editor-copy-service.test.ts electron/services/__tests__/content-install-service-security.test.ts
```

Expected: fail because services do not accept security deps yet and backup failure still continues.

- [ ] **Step 4: Add shared security deps locally in both services**

In both `desktop/electron/services/content-install-service.ts` and `desktop/electron/services/editor-copy-service.ts`, import security types:

```ts
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
```

Add local type and helper functions near the logger:

```ts
type EditorWriteSecurityDeps = {
  actor: ActorIdentity
  auditSink: AuditSink
  permissionGuard: PermissionGuard
}

async function checkEditorWritePermission(
  deps: EditorWriteSecurityDeps | undefined,
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

function recordEditorWriteAudit(
  deps: EditorWriteSecurityDeps | undefined,
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

- [ ] **Step 5: Thread security deps through `EditorCopyService.copy`**

Change the signature in `desktop/electron/services/editor-copy-service.ts`:

```ts
async copy(
  payload: SynapseCopyToEditorPayload,
  security?: EditorWriteSecurityDeps,
): Promise<SynapseEditorCopyResult> {
```

Before the try block, after `target.status` and overwrite checks:

```ts
const auditMetadata = {
  contentType: payload.source.itemType,
  editorId: payload.targetEditorId,
  operation: "copy",
  scope: payload.targetScope,
  sourceEditorId: payload.source.editorId,
}

await checkEditorWritePermission(security, target.targetPath, auditMetadata)
```

In the success path before `return`:

```ts
recordEditorWriteAudit(security, target.targetPath, "allowed", auditMetadata)
```

In the catch block:

```ts
recordEditorWriteAudit(security, target.targetPath, "failed", auditMetadata)
```

- [ ] **Step 6: Thread security deps through `ContentInstallService.installToEditor`**

Export the class in `desktop/electron/services/content-install-service.ts`:

```ts
export class ContentInstallService {
```

Change the method signature:

```ts
async installToEditor(
  payload: SynapseInstallToEditorPayload,
  security?: EditorWriteSecurityDeps,
): Promise<SynapseContentInstallResult> {
```

After target readiness validation:

```ts
const auditMetadata = {
  contentId: payload.contentId,
  contentType: payload.contentType,
  editorId: payload.editorId,
  operation: "install",
  scope: payload.scope,
}

await checkEditorWritePermission(security, target.targetPath, auditMetadata)
```

Record allowed after the write switch succeeds:

```ts
recordEditorWriteAudit(security, target.targetPath, "allowed", auditMetadata)
```

Record failed in the catch block before throwing:

```ts
recordEditorWriteAudit(security, target.targetPath, "failed", auditMetadata)
```

- [ ] **Step 7: Block backup failures**

Replace the backup block in `content-install-service.ts` with:

```ts
if (payload.contentType === "skill" && payload.replaceConfirmed) {
  const targetExists = await pathExists(target.targetPath)
  if (targetExists && target.targetPath !== previousSkillDirectoryPath) {
    const backupPath = `${target.targetPath}-backup`
    try {
      await rename(target.targetPath, backupPath)
    } catch (error) {
      logger.warn("Failed to backup existing skill directory.", {
        backupPath,
        error,
        targetPath: target.targetPath,
      })
      throw new Error("备份旧 Skill 失败，未替换目标。")
    }
  }
}
```

- [ ] **Step 8: Pass security deps from IPC handlers**

In `desktop/electron/modules/content/ipc.ts`, import the types:

```ts
import type { AuditSink, PermissionGuard } from "../../runtime/security"
```

In `installToEditor.handler`, replace the service call:

```ts
const permissionGuard = _ctx.resolve<PermissionGuard>("core.permission-guard")
const auditSink = _ctx.resolve<AuditSink>("core.audit-sink")
return contentInstallService.installToEditor(payload, {
  actor: { kind: "user" },
  auditSink,
  permissionGuard,
})
```

In `desktop/electron/modules/editor-copy/ipc.ts`, import the same types and replace the service call:

```ts
const permissionGuard = _ctx.resolve<PermissionGuard>("core.permission-guard")
const auditSink = _ctx.resolve<AuditSink>("core.audit-sink")
return editorCopyService.copy(payload, {
  actor: { kind: "user" },
  auditSink,
  permissionGuard,
})
```

- [ ] **Step 9: Run focused security tests**

Run:

```bash
pnpm desktop:test -- electron/services/__tests__/editor-copy-service.test.ts electron/services/__tests__/content-install-service-security.test.ts
```

Expected: pass.

- [ ] **Step 10: Commit Task 3**

```bash
git add desktop/electron/services/content-install-service.ts desktop/electron/services/editor-copy-service.ts desktop/electron/modules/content/ipc.ts desktop/electron/modules/editor-copy/ipc.ts desktop/electron/services/__tests__/content-install-service-security.test.ts desktop/electron/services/__tests__/editor-copy-service.test.ts
git commit -m "feat: audit editor writes"
```

---

### Task 4: Generalize Target Selector And Fix Copy Wording

**Files:**
- Rename: `desktop/src/modules/content/components/editor-install-target-selector.tsx` to `desktop/src/modules/content/components/editor-write-target-selector.tsx`
- Modify: `desktop/src/modules/content/components/content-install-dialog.tsx`
- Modify: `desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx`
- Modify: `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`

- [ ] **Step 1: Update static wording test**

Modify the last test in `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`:

```ts
it("uses copy wording in the editor copy dialog", async () => {
  const source = await readFile(
    new URL("../components/editor-copy-dialog.tsx", import.meta.url),
    "utf8",
  )

  expect(source).toContain("EditorWriteTargetSelector")
  expect(source).toContain("copyToEditor")
  expect(source).toContain("复制到")
  expect(source).toContain("复制失败。")
  expect(source).toContain("复制后会被替换")
  expect(source).not.toContain("正在安装到")
  expect(source).not.toContain("安装失败。")
})
```

- [ ] **Step 2: Run the wording test and verify failure**

Run:

```bash
pnpm desktop:test -- src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
```

Expected: fail because the dialog still imports `EditorInstallTargetSelector` and contains install wording.

- [ ] **Step 3: Rename and adjust the selector exports**

Rename the file:

```bash
git mv desktop/src/modules/content/components/editor-install-target-selector.tsx desktop/src/modules/content/components/editor-write-target-selector.tsx
```

Inside the renamed file, rename the component and exported types:

```ts
type EditorWriteTargetSelection = {
  activeTarget: SynapseEditorResolvedTarget | null
  activeTargetState: InstallTargetState
  projectPath: string
  scope: SynapseEditorInstallScope
}

type EditorWriteTargetSelectorProps = {
  actionKind: "install" | "copy"
  contentType: Extract<SynapseContentType, "rule" | "skill">
  editor: SynapseEditorAdapterSummary
  loggerName: string
  onError?: (message: string) => void
  onSelectionChange: (selection: EditorWriteTargetSelection) => void
  open: boolean
  projects: SynapseProjectConfig[]
  resolveTarget: (input: ResolveEditorTargetInput) => Promise<SynapseEditorResolvedTarget>
}
```

Rename the function:

```ts
function EditorWriteTargetSelector({
  actionKind,
  contentType,
  editor,
  loggerName,
  onError,
  onSelectionChange,
  open,
  projects,
  resolveTarget,
}: EditorWriteTargetSelectorProps) {
```

Change the loading line to use action-aware wording:

```ts
{actionKind === "install" ? "正在解析安装路径" : "正在解析复制路径"}
```

Change the idle line:

```ts
{actionKind === "install" ? "先选择一个可用的安装范围。" : "先选择一个可用的复制范围。"}
```

Export:

```ts
export { EditorWriteTargetSelector }
export type { EditorWriteTargetSelection, ResolveEditorTargetInput }
```

- [ ] **Step 4: Update install dialog imports and types**

In `desktop/src/modules/content/components/content-install-dialog.tsx`, replace imports:

```ts
import {
  EditorWriteTargetSelector,
  type EditorWriteTargetSelection,
  type ResolveEditorTargetInput,
} from "./editor-write-target-selector"
```

Replace state type:

```ts
const [selection, setSelection] = useState<EditorWriteTargetSelection | null>(null)
```

Replace JSX:

```tsx
<EditorWriteTargetSelector
  actionKind="install"
  contentType={item.type}
  editor={editor}
  loggerName={`content.install.${item.type}`}
  onError={setInstallError}
  onSelectionChange={setSelection}
  open={open}
  projects={projects}
  resolveTarget={resolveInstallTarget}
/>
```

- [ ] **Step 5: Update copy dialog imports, labels, and toast**

In `desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx`, replace imports:

```ts
import {
  EditorWriteTargetSelector,
  type EditorWriteTargetSelection,
  type ResolveEditorTargetInput,
} from "@/modules/content/components/editor-write-target-selector"
```

Replace state type:

```ts
const [selection, setSelection] = useState<EditorWriteTargetSelection | null>(null)
```

Replace copy toast messages:

```ts
{
  loading: `正在复制到 ${selectedEditor.label}...`,
  success: () => `已复制到 ${selectedEditor.label}`,
  error: (error) => error instanceof Error ? error.message : "复制失败。",
}
```

Replace overwrite description:

```tsx
目标位置已有内容，复制后会被替换。
```

Replace dialog title and primary button:

```tsx
<DialogTitle>复制到 {selectedEditor?.label}</DialogTitle>
```

```tsx
复制
```

Replace selector JSX:

```tsx
<EditorWriteTargetSelector
  actionKind="copy"
  contentType={item.type}
  editor={selectedEditor}
  loggerName="editor-scan.copy"
  onError={setCopyError}
  onSelectionChange={setSelection}
  open={open}
  projects={config.global.projects}
  resolveTarget={resolveTarget}
/>
```

- [ ] **Step 6: Run wording tests**

Run:

```bash
pnpm desktop:test -- src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit Task 4**

```bash
git add desktop/src/modules/content/components/editor-write-target-selector.tsx desktop/src/modules/content/components/content-install-dialog.tsx desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
git add -u desktop/src/modules/content/components/editor-install-target-selector.tsx
git commit -m "fix: separate editor copy wording"
```

---

### Task 5: Add Renderer Install Status Hook

**Files:**
- Create: `desktop/src/modules/content/hooks/use-editor-install-status.ts`
- Test: `desktop/src/modules/content/__tests__/content-detail-install-status-layout.test.ts`

- [ ] **Step 1: Write static hook usage test**

Create `desktop/src/modules/content/__tests__/content-detail-install-status-layout.test.ts`:

```ts
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("content detail install status layout", () => {
  it("wires editor install status into the content detail dialog", async () => {
    const source = await readFile(
      new URL("../components/content-detail-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("useEditorInstallStatus")
    expect(source).toContain("EditorInstallStatusPanel")
    expect(source).toContain("onInstallStatusRefresh")
  })

  it("keeps install status out of prompt detail windows", async () => {
    const source = await readFile(
      new URL("../components/content-detail-window-page.tsx", import.meta.url),
      "utf8",
    )

    expect(source).not.toContain("EditorInstallStatusPanel")
  })
})
```

- [ ] **Step 2: Run the static test and verify failure**

Run:

```bash
pnpm desktop:test -- src/modules/content/__tests__/content-detail-install-status-layout.test.ts
```

Expected: fail because the hook and panel are not wired yet.

- [ ] **Step 3: Implement `useEditorInstallStatus`**

Create `desktop/src/modules/content/hooks/use-editor-install-status.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from "react"
import { resolveEditorInstallStatus } from "@/app-shell/editor-install-status"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseContentDetail, SynapseContentMeta } from "@/types/content"
import type {
  SynapseEditorInstallStatusEntry,
  SynapseEditorInstallStatusProject,
} from "@/types/editor-install-status"

type UseEditorInstallStatusInput = {
  content: string | null
  detail: SynapseContentDetail<"rule" | "skill"> | null
  item: SynapseContentMeta | null
  open: boolean
  projects: SynapseProjectConfig[]
  refreshSignal?: number
}

type UseEditorInstallStatusResult = {
  entries: SynapseEditorInstallStatusEntry[]
  error: string | null
  isLoading: boolean
  refresh: () => Promise<void>
}

function toStatusProjects(projects: SynapseProjectConfig[]): SynapseEditorInstallStatusProject[] {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path,
  }))
}

function useEditorInstallStatus({
  content,
  detail,
  item,
  open,
  projects,
  refreshSignal = 0,
}: UseEditorInstallStatusInput): UseEditorInstallStatusResult {
  const logger = useMemo(() => createRendererLogger("content.install-status"), [])
  const [entries, setEntries] = useState<SynapseEditorInstallStatusEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const canLoad = open && detail && (detail.type === "rule" || detail.type === "skill")

  const refresh = useCallback(async () => {
    if (!canLoad || !detail) {
      setEntries([])
      setError(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const result = await resolveEditorInstallStatus({
        content: content ?? detail.content,
        contentId: detail.id,
        contentName: detail.name,
        contentType: detail.type,
        projects: toStatusProjects(projects),
        title: detail.title,
      })
      setEntries(result.entries)
      logger.info("Editor install status refreshed.", {
        contentId: detail.id,
        contentType: detail.type,
        total: result.entries.length,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "读取安装状态失败。"
      setError(message)
      logger.error("Failed to refresh editor install status.", {
        contentId: item?.id ?? detail.id,
        contentType: detail.type,
        error: err,
      })
    } finally {
      setIsLoading(false)
    }
  }, [canLoad, content, detail, item?.id, logger, projects])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshSignal])

  return { entries, error, isLoading, refresh }
}

export { useEditorInstallStatus }
export type { UseEditorInstallStatusResult }
```

- [ ] **Step 4: Run typecheck for hook shape**

Run:

```bash
pnpm desktop:typecheck
```

Expected at this point: may fail because `ContentDetailDialog` has not yet imported the hook. Type errors inside the hook itself must be fixed before proceeding.

- [ ] **Step 5: Commit Task 5**

```bash
git add desktop/src/modules/content/hooks/use-editor-install-status.ts desktop/src/modules/content/__tests__/content-detail-install-status-layout.test.ts
git commit -m "feat: add editor install status hook"
```

---

### Task 6: Add Install Status Panel UI

**Files:**
- Create: `desktop/src/modules/content/components/editor-install-status-panel.tsx`
- Create: `desktop/src/modules/content/__tests__/editor-install-status-panel.test.tsx`

- [ ] **Step 1: Write panel rendering tests**

Create `desktop/src/modules/content/__tests__/editor-install-status-panel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { EditorInstallStatusPanel } from "../components/editor-install-status-panel"
import type { SynapseEditorInstallStatusEntry } from "@/types/editor-install-status"

const entries: SynapseEditorInstallStatusEntry[] = [
  {
    editorId: "codex",
    editorLabel: "Codex",
    message: null,
    scope: "global",
    status: "installed",
    targetPath: "/tmp/.codex/AGENTS.md",
  },
  {
    editorId: "cursor",
    editorLabel: "Cursor",
    message: "Cursor 官方文档未公布固定的全局 Rule 磁盘路径。",
    scope: "global",
    status: "unsupported",
    targetPath: null,
  },
]

describe("EditorInstallStatusPanel", () => {
  it("shows editor status labels without marketing copy", () => {
    render(
      <EditorInstallStatusPanel
        entries={entries}
        error={null}
        isLoading={false}
        onOpenInstallTarget={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )

    expect(screen.getByText("安装状态")).toBeTruthy()
    expect(screen.getByText("Codex")).toBeTruthy()
    expect(screen.getByText("已安装")).toBeTruthy()
    expect(screen.getByText("Cursor")).toBeTruthy()
    expect(screen.getByText("不支持")).toBeTruthy()
    expect(screen.queryByText(/此页面用于/)).toBeNull()
  })

  it("shows retry when status loading fails", () => {
    render(
      <EditorInstallStatusPanel
        entries={[]}
        error="刷新失败"
        isLoading={false}
        onOpenInstallTarget={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )

    expect(screen.getByText("刷新失败")).toBeTruthy()
    expect(screen.getByText("重试")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run panel tests and verify failure**

Run:

```bash
pnpm desktop:test -- src/modules/content/__tests__/editor-install-status-panel.test.tsx
```

Expected: fail because the panel component does not exist.

- [ ] **Step 3: Implement panel component**

Create `desktop/src/modules/content/components/editor-install-status-panel.tsx`:

```tsx
import { FolderOpen, LoaderCircle, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { SynapseEditorInstallStatusEntry } from "@/types/editor-install-status"

type EditorInstallStatusPanelProps = {
  entries: SynapseEditorInstallStatusEntry[]
  error: string | null
  isLoading: boolean
  onOpenInstallTarget: (entry: SynapseEditorInstallStatusEntry) => void
  onRefresh: () => void
}

const statusLabel: Record<SynapseEditorInstallStatusEntry["status"], string> = {
  conflict: "冲突",
  external_same_name: "外部同名",
  installed: "已安装",
  needs_update: "需更新",
  not_installed: "未安装",
  unavailable: "不可用",
  unsupported: "不支持",
}

function canWrite(entry: SynapseEditorInstallStatusEntry): boolean {
  return entry.status === "not_installed" || entry.status === "needs_update"
}

function EditorInstallStatusPanel({
  entries,
  error,
  isLoading,
  onOpenInstallTarget,
  onRefresh,
}: EditorInstallStatusPanelProps) {
  if (error) {
    return (
      <section className="rounded-lg border border-border bg-background px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">安装状态</p>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw data-icon="inline-start" />
            重试
          </Button>
        </div>
        <p className="mt-2 text-sm text-destructive">{error}</p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-border bg-background px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">安装状态</p>
        <Button type="button" variant="ghost" size="sm" disabled={isLoading} onClick={onRefresh}>
          {isLoading ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
          刷新
        </Button>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {entries.map((entry) => (
          <Collapsible key={`${entry.editorId}-${entry.scope}-${entry.projectId ?? "global"}`}>
            <div className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-2">
              <CollapsibleTrigger className="min-w-0 flex flex-1 items-center gap-2 text-left">
                <span className="truncate text-sm text-foreground">{entry.editorLabel}</span>
                <span className="text-xs text-muted-foreground">
                  {entry.scope === "global" ? "全局" : entry.projectName ?? "项目"}
                </span>
              </CollapsibleTrigger>
              <Badge variant={entry.status === "installed" ? "default" : "secondary"}>
                {statusLabel[entry.status]}
              </Badge>
            </div>
            <CollapsibleContent>
              <div className="flex items-center justify-between gap-2 px-2 py-2">
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {entry.targetPath ?? entry.message ?? "目标不可用"}
                </p>
                {entry.targetPath ? (
                  <Button type="button" variant="ghost" size="sm" title="打开位置">
                    <FolderOpen data-icon="inline-start" />
                    打开位置
                  </Button>
                ) : null}
                {canWrite(entry) ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => onOpenInstallTarget(entry)}>
                    {entry.status === "needs_update" ? "更新" : "安装"}
                  </Button>
                ) : null}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </section>
  )
}

export { EditorInstallStatusPanel }
```

- [ ] **Step 4: Wire open location**

In `editor-install-status-panel.tsx`, import the bridge helper:

```ts
import { getSynapseBridge } from "@/lib/electron-bridge"
```

Add a local handler:

```ts
function openTargetPath(path: string): void {
  getSynapseBridge()?.shell.showItemInFolder(path)
}
```

Change the `打开位置` button:

```tsx
<Button
  type="button"
  variant="ghost"
  size="sm"
  title="打开位置"
  onClick={() => openTargetPath(entry.targetPath!)}
>
```

- [ ] **Step 5: Run panel tests**

Run:

```bash
pnpm desktop:test -- src/modules/content/__tests__/editor-install-status-panel.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit Task 6**

```bash
git add desktop/src/modules/content/components/editor-install-status-panel.tsx desktop/src/modules/content/__tests__/editor-install-status-panel.test.tsx
git commit -m "feat: add editor install status panel"
```

---

### Task 7: Wire Status Panel Into Content Details And Refresh After Writes

**Files:**
- Modify: `desktop/src/modules/content/components/content-detail-dialog.tsx`
- Modify: `desktop/src/modules/content/components/content-detail-menubar.tsx`
- Modify: `desktop/src/modules/content/hooks/use-content-download-actions.tsx`
- Modify: `desktop/src/modules/content/hooks/use-editor-adapters-for-content-type.ts`
- Modify: `desktop/src/modules/content/components/content-install-dialog.tsx`
- Modify: `desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
- Modify: `desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx`
- Modify: `desktop/src/modules/content/__tests__/content-detail-install-status-layout.test.ts`

- [ ] **Step 1: Make editor target loading awaitable**

In `desktop/src/modules/content/hooks/use-editor-adapters-for-content-type.ts`, add this helper above the hook:

```ts
function filterAdaptersForContentType(
  adapters: SynapseEditorAdapterSummary[],
  contentType: SynapseContentType,
): SynapseEditorAdapterSummary[] {
  return adapters.filter((adapter) => (
    adapter.supportedContentTypes.includes(contentType)
  ))
}
```

Replace `filteredAdapters` with:

```ts
const filteredAdapters = useMemo(
  () => adapters ? filterAdaptersForContentType(adapters, contentType) : [],
  [adapters, contentType],
)
```

Replace `load` with:

```ts
const load = useCallback(async (): Promise<SynapseEditorAdapterSummary[]> => {
  if (!enabled) {
    return []
  }

  if (adapters) {
    return filterAdaptersForContentType(adapters, contentType)
  }

  if (isLoading) {
    return filteredAdapters
  }

  setIsLoading(true)
  setError(null)
  const startedAt = performance.now()

  logger.info("Loading editor targets.", { contentType })

  try {
    const nextAdapters = await getEditorAdapters()
    const nextFilteredAdapters = filterAdaptersForContentType(nextAdapters, contentType)
    setAdapters(nextAdapters)
    logger.info("Editor targets loaded.", {
      adapterCount: nextAdapters.length,
      contentType,
      elapsedMs: Math.round(performance.now() - startedAt),
      supportedCount: nextFilteredAdapters.length,
    })
    return nextFilteredAdapters
  } catch (err) {
    setError(err instanceof Error ? err.message : "读取编辑器列表失败。")
    logger.error("Failed to load editor targets.", {
      contentType,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: err,
    })
    return []
  } finally {
    setIsLoading(false)
  }
}, [adapters, contentType, enabled, filteredAdapters, isLoading, logger])
```

- [ ] **Step 2: Add install success callback and initial target selection**

In `ContentInstallDialogProps`:

```ts
initialSelection?: EditorWriteTargetInitialSelection | null
onInstalled?: () => Promise<void> | void
```

After install succeeds in `runInstall`, before closing:

```ts
await onInstalled?.()
```

In the selector file renamed by Task 4, add:

```ts
type EditorWriteTargetInitialSelection = {
  projectId?: string
  projectPath?: string
  scope: SynapseEditorInstallScope
}
```

Add this prop to `EditorWriteTargetSelectorProps`:

```ts
initialSelection?: EditorWriteTargetInitialSelection | null
```

Use the initial selection in the selector reset effect:

```ts
const initialProjectSelection =
  initialSelection?.projectId && projects.some((project) => project.id === initialSelection.projectId)
    ? initialSelection.projectId
    : initialSelection?.projectPath
      ? CUSTOM_PROJECT_OPTION
      : projects[0]?.id ?? CUSTOM_PROJECT_OPTION

setScope(initialSelection?.scope ?? (editor.supportsGlobal ? "global" : "project"))
setProjectSelection(initialProjectSelection)
setCustomProjectPath(initialSelection?.projectPath ?? "")
```

Export the new selector type:

```ts
export type {
  EditorWriteTargetInitialSelection,
  EditorWriteTargetSelection,
  ResolveEditorTargetInput,
}
```

Pass the prop from `ContentInstallDialog` into `EditorWriteTargetSelector`:

```tsx
initialSelection={initialSelection}
```

- [ ] **Step 3: Add status-panel opener to the content action hook**

In `UseContentDownloadActionsProps`:

```ts
onInstalled?: () => Promise<void> | void
```

Update the editor type import:

```ts
import type {
  SynapseEditorAdapterSummary,
  SynapseEditorId,
} from "@/types/editor"
```

Import the initial selection type:

```ts
import type { EditorWriteTargetInitialSelection } from "@/modules/content/components/editor-write-target-selector"
```

Add state next to `selectedEditor`:

```ts
const [initialInstallSelection, setInitialInstallSelection] =
  useState<EditorWriteTargetInitialSelection | null>(null)
```

Add this callback after `openInstallDialog`:

```ts
const openInstallDialogForEditorId = useCallback(async ({
  editorId,
  initialSelection,
}: {
  editorId: SynapseEditorId
  initialSelection?: EditorWriteTargetInitialSelection | null
}): Promise<boolean> => {
  if (!canInstall) {
    return false
  }

  const adapters = filteredAdapters.length > 0 ? filteredAdapters : await loadInstallTargets()
  const adapter = adapters.find((candidate) => candidate.id === editorId)

  if (!adapter) {
    logger.warn("Install target requested but adapter is unavailable.", {
      contentId: item.id,
      contentType: item.type,
      editorId,
    })
    return false
  }

  setInitialInstallSelection(initialSelection ?? null)
  openInstallDialog(adapter)
  return true
}, [canInstall, filteredAdapters, item.id, item.type, loadInstallTargets, logger, openInstallDialog])
```

When the install dialog closes, clear the stored initial selection:

```ts
if (!nextOpen) {
  setInitialInstallSelection(null)
}
```

Pass callbacks into `ContentInstallDialog`:

```tsx
initialSelection={initialInstallSelection}
onInstalled={onInstalled}
```

Return the opener:

```ts
openInstallDialogForEditorId,
```

- [ ] **Step 4: Let the detail menubar consume status-panel install requests**

In `desktop/src/modules/content/components/content-detail-menubar.tsx`, update imports:

```ts
import { useCallback, useEffect, useState } from "react"
import type {
  SynapseEditorId,
  SynapseEditorInstallScope,
} from "@/types/editor"
```

Add and export this type above `ContentDetailMenubarProps`:

```ts
type ContentInstallTargetRequest = {
  editorId: SynapseEditorId
  projectId?: string
  projectPath?: string
  scope: SynapseEditorInstallScope
}
```

In `ContentDetailMenubarProps`:

```ts
installTargetRequest?: ContentInstallTargetRequest | null
onInstallTargetRequestConsumed?: () => void
onInstalled?: () => Promise<void> | void
```

Destructure the new hook return value:

```ts
openInstallDialogForEditorId,
} = useContentDownloadActions({ item, onInstalled })
```

Add this effect before the return:

```ts
useEffect(() => {
  if (!installTargetRequest) {
    return
  }

  let cancelled = false

  void openInstallDialogForEditorId({
    editorId: installTargetRequest.editorId,
    initialSelection: {
      projectId: installTargetRequest.projectId,
      projectPath: installTargetRequest.projectPath,
      scope: installTargetRequest.scope,
    },
  }).finally(() => {
    if (!cancelled) {
      onInstallTargetRequestConsumed?.()
    }
  })

  return () => {
    cancelled = true
  }
}, [installTargetRequest, onInstallTargetRequestConsumed, openInstallDialogForEditorId])
```

Export the type at the bottom:

```ts
export { ContentDetailMenubar }
export type { ContentInstallTargetRequest }
```

- [ ] **Step 5: Use the status hook in content detail dialog**

In `desktop/src/modules/content/components/content-detail-dialog.tsx`, import:

```ts
import { useAppConfig } from "@/app-shell/config"
import { EditorInstallStatusPanel } from "@/modules/content/components/editor-install-status-panel"
import {
  ContentDetailMenubar,
  type ContentInstallTargetRequest,
} from "@/modules/content/components/content-detail-menubar"
import { useEditorInstallStatus } from "@/modules/content/hooks/use-editor-install-status"
```

Add state:

```ts
const { config } = useAppConfig()
const [installStatusRefreshSignal, setInstallStatusRefreshSignal] = useState(0)
const [installTargetRequest, setInstallTargetRequest] =
  useState<ContentInstallTargetRequest | null>(null)
const handleInstallStatusRefresh = useCallback(() => {
  setInstallStatusRefreshSignal((value) => value + 1)
}, [])
```

Add hook after detail state:

```ts
const installStatus = useEditorInstallStatus({
  content: displayedVersion?.content ?? detail?.content ?? null,
  detail: detail && (detail.type === "rule" || detail.type === "skill") ? detail : null,
  item,
  open,
  projects: config.global.projects,
  refreshSignal: installStatusRefreshSignal,
})
```

- [ ] **Step 6: Render panel between header and preview**

In the JSX where `ContentDetailMenubar` is rendered, pass:

```tsx
installTargetRequest={installTargetRequest}
onInstallTargetRequestConsumed={() => {
  setInstallTargetRequest(null)
}}
onInstalled={handleInstallStatusRefresh}
```

Inside the body wrapper before `ContentDetailPanel`, render:

```tsx
{detail && (detail.type === "rule" || detail.type === "skill") ? (
  <div className="mb-4">
    <EditorInstallStatusPanel
      entries={installStatus.entries}
      error={installStatus.error}
      isLoading={installStatus.isLoading}
      onOpenInstallTarget={(entry) => {
        const project = entry.projectId
          ? config.global.projects.find((candidate) => candidate.id === entry.projectId)
          : null
        logger.info("Install requested from status panel.", {
          contentId: detail.id,
          contentType: detail.type,
          editorId: entry.editorId,
          projectId: entry.projectId ?? null,
          scope: entry.scope,
        })
        setInstallTargetRequest({
          editorId: entry.editorId,
          projectId: entry.projectId,
          projectPath: project?.path,
          scope: entry.scope,
        })
      }}
      onRefresh={() => {
        void installStatus.refresh()
      }}
    />
  </div>
) : null}
```

- [ ] **Step 7: Refresh IDE scan after editor copy**

`ScanItemDetailDialog` passes `onCopied={refresh}` from `EditorScanModule`. Keep that prop. In `EditorCopyDialog`, keep exactly one success callback invocation after the copy operation completes:

```ts
await onCopied?.()
```

Add this static assertion to `desktop/src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`:

```ts
expect(source).toContain("await onCopied?.()")
```

- [ ] **Step 8: Run layout tests**

Run:

```bash
pnpm desktop:test -- src/modules/content/__tests__/content-detail-install-status-layout.test.ts src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit Task 7**

```bash
git add desktop/src/modules/content/components/content-detail-dialog.tsx desktop/src/modules/content/components/content-detail-menubar.tsx desktop/src/modules/content/hooks/use-content-download-actions.tsx desktop/src/modules/content/hooks/use-editor-adapters-for-content-type.ts desktop/src/modules/content/components/content-install-dialog.tsx desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx desktop/src/modules/editor-scan/components/editor-copy-dialog.tsx desktop/src/modules/content/__tests__/content-detail-install-status-layout.test.ts
git commit -m "feat: show editor install status in details"
```

---

### Task 8: Final Verification And Hard Constraints

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run generated IPC check**

Run:

```bash
pnpm desktop:generate:ipc
pnpm desktop:check:ipc-codegen
```

Expected: pass.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm desktop:check:hard-constraints
```

Expected: pass with no bare IPC, webContents, fs writes, or runtime imports outside the allowed infrastructure files.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm desktop:typecheck
```

Expected: pass.

- [ ] **Step 4: Run full tests**

Run:

```bash
pnpm desktop:test
```

Expected: pass.

- [ ] **Step 5: Inspect UI/style constraints statically**

Run:

```bash
rg -n "style=\\{|#[0-9A-Fa-f]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|gradient|from-.*purple|to-.*pink" desktop/src/modules/content desktop/src/modules/editor-scan
```

Expected: no new violations from this work. Existing unrelated hits should not be edited in this task.

- [ ] **Step 6: Review git diff**

Run:

```bash
git diff --stat
git diff --check
```

Expected: `git diff --check` has no output. Diff stat should only include files listed in this plan plus generated IPC channels.

---

## Self-Review

Spec coverage:

- Installation status panel: Task 5, Task 6, Task 7.
- Status calculation from target resolution and scan data: Task 2.
- Install/copy wording separation: Task 4.
- Refresh after writes: Task 7.
- PermissionGuard/AuditSink and backup failure: Task 3.
- Tests and hard constraints: Task 8.

Scope check:

- This plan intentionally does not implement batch distribution, cross-device sync, or editor runtime reload detection.
- The install/update button inside the status panel opens the same `ContentInstallDialog` through `openInstallDialogForEditorId`, with scope/project preselected from the status row.

Type consistency:

- Shared status types live in `desktop/src/types/editor-install-status.ts`.
- Renderer wrapper is `resolveEditorInstallStatus`.
- Main service method is `resolveForContent`.
- Renderer panel uses `SynapseEditorInstallStatusEntry`.
- Target preselection uses `EditorWriteTargetInitialSelection`.
- Content-detail install requests use `ContentInstallTargetRequest`.
- The action hook exposes `openInstallDialogForEditorId`.

Verification commands:

- `pnpm desktop:test -- electron/services/__tests__/editor-install-status-service.test.ts`
- `pnpm desktop:test -- electron/services/__tests__/editor-copy-service.test.ts electron/services/__tests__/content-install-service-security.test.ts`
- `pnpm desktop:test -- src/modules/content/__tests__/editor-install-status-panel.test.tsx src/modules/content/__tests__/content-detail-install-status-layout.test.ts src/modules/editor-scan/__tests__/scan-item-detail-dialog-layout.test.ts`
- `pnpm desktop:generate:ipc`
- `pnpm desktop:check:ipc-codegen`
- `pnpm desktop:check:hard-constraints`
- `pnpm desktop:typecheck`
- `pnpm desktop:test`
