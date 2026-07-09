# Synapse Skill Batch Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build public targeted and batch Skill installation support, then use it in the Synapse Skill system App for row-level install/update, path opening, one-click install missing targets, and one-click update outdated targets.

**Architecture:** Keep file writing in `EditorInstallCore`; add batch orchestration in `EditorInstallService` and the `installers` IPC bridge. Add a package fingerprint to prepared Synapse Skill sources, persist it in installed `.synapse.json` metadata, and let `EditorInstallStatusService` report `needs_update` when fingerprints differ. The renderer remains a thin state-driven UI that calls public helpers instead of duplicating installer logic.

**Tech Stack:** Electron 41, Vite 8, React 19, TypeScript 6, shadcn/ui, Vitest, existing Synapse IPC modules and preload bridge.

## Global Constraints

- Do not add dependencies.
- Do not modify unrelated dirty worktree changes.
- UI must use existing shadcn/Radix components and Tailwind token classes only.
- No inline `style={{...}}`, custom colors, hex/rgb/hsl literals, decorative gradients, glow, emoji headings, or card nesting.
- Production code must not use `console.log`; use existing structured loggers.
- Batch installation must run targets sequentially, not concurrently.
- Default batch install must exclude `conflict` and `external_same_name`; replacing external content requires explicit single-target confirmation.
- Reuse `EditorInstallCore`; do not duplicate file write, permission, audit, backup, or atomic replacement logic.
- User-facing or release-visible changes must update `RELEASE_NOTES_PENDING.md`.

---

## File Structure

- Modify `desktop/src/types/installers.ts`: add batch target payload/result types and optional `sourceFingerprint` on installer sources.
- Modify `desktop/src/types/editor-install-status.ts`: add optional `sourceFingerprint` to status payload.
- Modify `desktop/src/types/editor-scan.ts`: add optional `sourceFingerprint` to scanned Skill items.
- Modify `desktop/src/types/bridge.ts`: expose `installSourceToEditorTargets` on `window.synapse.installers`.
- Modify `desktop/electron/modules/installers/ipc.ts`: add schema and IPC handler for batch install.
- Modify `desktop/electron/preload.ts`: expose the new installers bridge method.
- Modify `desktop/electron/generated/ipc-channels.generated.ts`: add the channel if generator output is not automatically updated by the test command.
- Modify `desktop/src/app-shell/installers.ts`: add renderer helper `installSourceToEditorTargets`.
- Modify `desktop/electron/services/editor-install-service.ts`: add batch orchestration method.
- Modify `desktop/electron/services/__tests__/editor-install-service-prepared-source.test.ts` or create `desktop/electron/services/__tests__/editor-install-service-batch.test.ts`: cover batch install behavior.
- Modify `desktop/app-capabilities/synapse-skill/shared/schema.ts`: require `sourceFingerprint` in prepared Synapse Skill source schema.
- Modify `desktop/app-capabilities/synapse-skill/main/service.ts`: compute stable package fingerprint and return it.
- Modify `desktop/src/definitions/editor/shared-skill-directory.ts`: write `sourceFingerprint` into `.synapse.json` when present.
- Modify `desktop/electron/services/editor-scan-service.ts`: read `sourceFingerprint` from `.synapse.json`.
- Modify `desktop/electron/services/editor-install-status-service.ts`: compare fingerprints for prepared Synapse Skill update detection.
- Modify relevant tests:
  - `desktop/src/definitions/editor/__tests__/shared-skill-directory.test.ts`
  - `desktop/electron/services/__tests__/editor-scan-service.test.ts`
  - `desktop/electron/services/__tests__/editor-install-status-service.test.ts`
  - `desktop/app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx`
- Modify `desktop/src/modules/installers/shared/shared-installer-flow.tsx` only if `initialSelection` needs a direct global target fix; otherwise leave it unchanged.
- Modify `desktop/app-capabilities/synapse-skill/renderer/index.tsx`: implement row actions, path opening, source preparation before status, and batch actions.
- Modify `RELEASE_NOTES_PENDING.md`: add release-facing note.

---

### Task 1: Public Batch Installer IPC

**Files:**
- Modify: `desktop/src/types/installers.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/app-shell/installers.ts`
- Modify: `desktop/electron/modules/installers/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify if needed: `desktop/electron/generated/ipc-channels.generated.ts`
- Test: `desktop/electron/modules/installers/__tests__/ipc.test.ts`
- Test: `desktop/electron/__tests__/preload.test.ts`

**Interfaces:**
- Consumes: existing `SynapseInstallSourceToEditorPayload`, `SynapseInstallerSource`, `SynapseContentInstallResult`.
- Produces:
  - `SynapseInstallSourceTarget`
  - `SynapseInstallSourceToEditorTargetsPayload`
  - `SynapseInstallSourceTargetResult`
  - `SynapseInstallSourceToEditorTargetsResult`
  - renderer helper `installSourceToEditorTargets(payload)`
  - bridge method `window.synapse.installers.installSourceToEditorTargets(payload)`

- [ ] **Step 1: Add failing IPC test**

In `desktop/electron/modules/installers/__tests__/ipc.test.ts`, add a test beside the existing `installSourceToEditor` tests:

```ts
it("routes batch source installs to the editor install service", async () => {
  mocks.installSourceToEditorTargets.mockResolvedValue({
    results: [{
      target: { editorId: "codex", scope: "global" },
      status: "installed",
      result: {
        editorId: "codex",
        label: "Codex",
        scope: "global",
        contentType: "skill",
        contentId: "synapse-skill",
        targetKind: "directory",
        targetPath: "/Users/test/.agents/skills/synapse-skill",
      },
    }],
  })

  const result = await harness.invoke("synapse:installers:install-source-to-editor-targets", {
    mode: "install",
    source: {
      kind: "skill",
      origin: "prepared",
      sourceIdentity: "synapse-skill",
      name: "synapse-skill",
      title: "Synapse Skill",
      description: "Synapse MCP 使用指南",
      preparedSourceId: "synapse-skill:test",
      mainContent: "# Synapse Skill",
      sourceFingerprint: "sha256:test",
    },
    targets: [{ editorId: "codex", scope: "global" }],
  })

  expect(result.results).toHaveLength(1)
  expect(mocks.installSourceToEditorTargets).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "install",
      targets: [{ editorId: "codex", scope: "global" }],
    }),
    expect.objectContaining({
      actor: { kind: "user" },
    }),
  )
})
```

If the test mock object lacks `installSourceToEditorTargets`, add it to the hoisted mocks:

```ts
installSourceToEditorTargets: vi.fn(),
```

- [ ] **Step 2: Run IPC test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/installers/__tests__/ipc.test.ts
```

Expected: FAIL because `installSourceToEditorTargets` and its IPC channel do not exist.

- [ ] **Step 3: Add public types**

In `desktop/src/types/installers.ts`, add `sourceFingerprint?: string` to `SynapseInstallerSourceBase`:

```ts
export type SynapseInstallerSourceBase = {
  kind: SynapseInstallerKind
  origin: SynapseInstallerOrigin
  sourceIdentity: string
  name: string
  title?: string
  description?: string
  sourceFingerprint?: string
}
```

Add these exports after `SynapseInstallSourceToEditorPayload`:

```ts
export type SynapseInstallSourceTarget = {
  editorId: SynapseEditorId
  scope: SynapseEditorInstallScope
  projectPath?: string
}

export type SynapseInstallSourceToEditorTargetsPayload = {
  source: SynapseInstallerSource
  targets: SynapseInstallSourceTarget[]
  mode: "install" | "reinstall" | "update"
  overwriteConfirmed?: boolean
  replaceConfirmed?: boolean
  variableSubstitutions?: Record<string, string>
}

export type SynapseInstallSourceTargetResult = {
  target: SynapseInstallSourceTarget
  status: "installed" | "failed"
  result?: SynapseContentInstallResult
  error?: string
}

export type SynapseInstallSourceToEditorTargetsResult = {
  results: SynapseInstallSourceTargetResult[]
}
```

- [ ] **Step 4: Add IPC schema and handler**

In `desktop/electron/modules/installers/ipc.ts`, extend imports:

```ts
import type {
  SynapseInstallSourceToEditorPayload,
  SynapseInstallSourceToEditorTargetsPayload,
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
} from "../../../src/types/installers"
```

Add `sourceFingerprint` to `installerSourceBaseSchema`:

```ts
const installerSourceBaseSchema = z.object({
  description: z.string().optional(),
  name: z.string(),
  sourceFingerprint: z.string().optional(),
  sourceIdentity: z.string().min(1),
  title: z.string().optional(),
}).strict()
```

Add target and batch schemas after `installSourceToEditorSchema`:

```ts
const installSourceTargetSchema = z.object({
  editorId: z.string().min(1),
  projectPath: z.string().optional(),
  scope: z.enum(["global", "project"]),
}).strict()

const installSourceToEditorTargetsSchema = z.object({
  mode: z.enum(["install", "reinstall", "update"]),
  overwriteConfirmed: z.boolean().optional(),
  replaceConfirmed: z.boolean().optional(),
  source: installerSourceSchema,
  targets: z.array(installSourceTargetSchema),
  variableSubstitutions: z.record(z.string(), z.string()).optional(),
}).strict()
```

Add method:

```ts
installSourceToEditorTargets: {
  kind: "invoke",
  channel: "synapse:installers:install-source-to-editor-targets",
  request: installSourceToEditorTargetsSchema,
  handler: async (ctx, payload: SynapseInstallSourceToEditorTargetsPayload) => {
    const result = await editorInstallService.installSourceToEditorTargets(payload, {
      actor: { kind: "user" },
      auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
      permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
    })

    const eventBus = ctx.resolve<EventBus>("core.event-bus")
    const contentId = payload.source.origin === "repository" && payload.source.repositoryContentId
      ? payload.source.repositoryContentId
      : payload.source.sourceIdentity

    await notifyInstallStatusChanged(eventBus, contentId, {
      logger,
      warningMessage: "Failed to refresh install status after batch installer install.",
    })

    return result
  },
},
```

- [ ] **Step 5: Add renderer bridge and helper**

In `desktop/src/types/bridge.ts`, import the new types from `./installers` if the import block is explicit, then add:

```ts
installSourceToEditorTargets: (
  payload: SynapseInstallSourceToEditorTargetsPayload,
) => Promise<SynapseInstallSourceToEditorTargetsResult>
```

inside `installers`.

In `desktop/electron/preload.ts`, add:

```ts
installSourceToEditorTargets: invoke(IPC_CHANNELS.installers.installSourceToEditorTargets),
```

inside the `installers` bridge object.

In `desktop/electron/generated/ipc-channels.generated.ts`, add the channel to `installers` if generation has not already done it:

```ts
"installSourceToEditorTargets": "synapse:installers:install-source-to-editor-targets",
```

In `desktop/src/app-shell/installers.ts`, import the new payload/result types and add:

```ts
async function installSourceToEditorTargets(
  payload: SynapseInstallSourceToEditorTargetsPayload,
): Promise<SynapseInstallSourceToEditorTargetsResult> {
  return requireInstallersBridge().installSourceToEditorTargets(payload)
}
```

Export it with the existing installer helpers.

- [ ] **Step 6: Run IPC and preload tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/installers/__tests__/ipc.test.ts electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add desktop/src/types/installers.ts desktop/src/types/bridge.ts desktop/src/app-shell/installers.ts desktop/electron/modules/installers/ipc.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/modules/installers/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts
git commit -m "feat: expose batch editor installer ipc"
```

---

### Task 2: Batch Install Service Orchestration

**Files:**
- Modify: `desktop/electron/services/editor-install-service.ts`
- Test: `desktop/electron/services/__tests__/editor-install-service-batch.test.ts`

**Interfaces:**
- Consumes: Task 1 public batch payload/result types.
- Produces: `EditorInstallService.installSourceToEditorTargets(payload, security?)`.

- [ ] **Step 1: Write failing service tests**

Create `desktop/electron/services/__tests__/editor-install-service-batch.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import type { SynapseContentInstallResult, SynapseEditorResolvedTarget } from "../../../src/types/editor"
import { EditorInstallService } from "../editor-install-service"

const readyTarget = (editorId: string): SynapseEditorResolvedTarget => ({
  editorId: editorId as SynapseEditorResolvedTarget["editorId"],
  label: editorId,
  scope: "global",
  contentType: "skill",
  message: null,
  status: "ready",
  targetExists: false,
  targetKind: "directory",
  targetPath: `/tmp/${editorId}/skills/synapse-skill`,
})

vi.mock("../editor-adapter-service", () => ({
  editorAdapterService: {
    resolveTarget: vi.fn(async (payload: { editorId: string }) => readyTarget(payload.editorId)),
  },
}))

vi.mock("../config-store", () => ({
  configStore: {
    load: vi.fn(async () => ({ global: { projects: [] } })),
  },
}))

vi.mock("../editor-install-core", () => ({
  EditorInstallCore: class {
    async installSourceToEditor(payload: { editorId: string }): Promise<SynapseContentInstallResult> {
      if (payload.editorId === "broken") {
        throw new Error("install failed")
      }
      return {
        editorId: payload.editorId as SynapseContentInstallResult["editorId"],
        label: payload.editorId,
        scope: "global",
        contentType: "skill",
        contentId: "synapse-skill",
        targetKind: "directory",
        targetPath: `/tmp/${payload.editorId}/skills/synapse-skill`,
      }
    }
  },
}))

describe("EditorInstallService batch source install", () => {
  it("installs each target sequentially and returns per-target results", async () => {
    const service = new EditorInstallService()

    const result = await service.installSourceToEditorTargets({
      mode: "install",
      source: {
        kind: "skill",
        origin: "prepared",
        sourceIdentity: "synapse-skill",
        name: "synapse-skill",
        title: "Synapse Skill",
        description: "Synapse MCP 使用指南",
        preparedSourceId: "synapse-skill:test",
        mainContent: "# Synapse Skill",
        sourceFingerprint: "sha256:test",
      },
      targets: [
        { editorId: "codex" as never, scope: "global" },
        { editorId: "cursor" as never, scope: "global" },
      ],
    })

    expect(result.results).toEqual([
      expect.objectContaining({ status: "installed", target: { editorId: "codex", scope: "global" } }),
      expect.objectContaining({ status: "installed", target: { editorId: "cursor", scope: "global" } }),
    ])
  })

  it("keeps installing after one target fails", async () => {
    const service = new EditorInstallService()

    const result = await service.installSourceToEditorTargets({
      mode: "update",
      source: {
        kind: "skill",
        origin: "prepared",
        sourceIdentity: "synapse-skill",
        name: "synapse-skill",
        title: "Synapse Skill",
        description: "Synapse MCP 使用指南",
        preparedSourceId: "synapse-skill:test",
        mainContent: "# Synapse Skill",
        sourceFingerprint: "sha256:test",
      },
      targets: [
        { editorId: "broken" as never, scope: "global" },
        { editorId: "codex" as never, scope: "global" },
      ],
    })

    expect(result.results).toEqual([
      {
        target: { editorId: "broken", scope: "global" },
        status: "failed",
        error: "install failed",
      },
      expect.objectContaining({
        target: { editorId: "codex", scope: "global" },
        status: "installed",
      }),
    ])
  })
})
```

- [ ] **Step 2: Run service test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-install-service-batch.test.ts
```

Expected: FAIL because `installSourceToEditorTargets` does not exist.

- [ ] **Step 3: Implement batch method**

In `desktop/electron/services/editor-install-service.ts`, import:

```ts
import type {
  SynapseInstallSourceToEditorPayload,
  SynapseInstallSourceToEditorTargetsPayload,
  SynapseInstallSourceToEditorTargetsResult,
} from "../../src/types/installers"
```

Add method to `EditorInstallService` after `installSourceToEditor`:

```ts
async installSourceToEditorTargets(
  payload: SynapseInstallSourceToEditorTargetsPayload,
  security?: EditorWriteSecurityDeps,
): Promise<SynapseInstallSourceToEditorTargetsResult> {
  const results: SynapseInstallSourceToEditorTargetsResult["results"] = []

  for (const target of payload.targets) {
    const singlePayload: SynapseInstallSourceToEditorPayload = {
      editorId: target.editorId,
      installFormValues: undefined,
      overwriteConfirmed: payload.overwriteConfirmed,
      projectPath: target.projectPath,
      replaceConfirmed: payload.replaceConfirmed,
      scope: target.scope,
      source: payload.source,
      variableSubstitutions: payload.variableSubstitutions,
    }

    try {
      const result = await this.installSourceToEditor(singlePayload, security)
      results.push({ target, status: "installed", result })
    } catch (error) {
      results.push({
        target,
        status: "failed",
        error: error instanceof Error ? error.message : "安装失败",
      })
    }
  }

  return { results }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-install-service-batch.test.ts electron/modules/installers/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add desktop/electron/services/editor-install-service.ts desktop/electron/services/__tests__/editor-install-service-batch.test.ts
git commit -m "feat: add batch editor install service"
```

---

### Task 3: Synapse Skill Fingerprint And Status Detection

**Files:**
- Modify: `desktop/app-capabilities/synapse-skill/shared/schema.ts`
- Modify: `desktop/app-capabilities/synapse-skill/main/service.ts`
- Modify: `desktop/src/definitions/editor/shared-skill-directory.ts`
- Modify: `desktop/electron/services/editor-scan-service.ts`
- Modify: `desktop/src/types/editor-scan.ts`
- Modify: `desktop/src/types/editor-install-status.ts`
- Modify: `desktop/electron/services/editor-install-status-service.ts`
- Test: `desktop/app-capabilities/synapse-skill/main/__tests__/service.test.ts` if present, otherwise create it.
- Test: `desktop/src/definitions/editor/__tests__/shared-skill-directory.test.ts`
- Test: `desktop/electron/services/__tests__/editor-scan-service.test.ts`
- Test: `desktop/electron/services/__tests__/editor-install-status-service.test.ts`

**Interfaces:**
- Consumes: Task 1 optional `sourceFingerprint` installer source field.
- Produces: `sourceFingerprint` on prepared Synapse Skill source, `.synapse.json.sourceFingerprint`, scanned `EditorScanSkillItem.sourceFingerprint`, status payload `sourceFingerprint`, and `needs_update` detection.

- [ ] **Step 1: Write failing status tests**

In `desktop/electron/services/__tests__/editor-install-status-service.test.ts`, add:

```ts
it("marks a Synapse Skill with a different fingerprint as needing update", async () => {
  mocks.scanAll.mockResolvedValue({
    global: [{
      editorId: "codex",
      editorLabel: "Codex",
      status: "detected",
      rules: [],
      rulesSupported: true,
      skills: [{
        name: "synapse-skill",
        path: "/global/skills/synapse-skill",
        source: "synapse",
        synapseContentId: "synapse-skill",
        repositoryVersion: null,
        sourceFingerprint: "sha256:old",
        preview: "Use Synapse MCP tools.",
        fileCount: 2,
        trash: { mode: "path" },
      }],
      duplicateSkillNames: [],
    }],
    projects: [],
  })

  const result = await new EditorInstallStatusService().resolveForContent({
    contentType: "skill",
    contentId: "synapse-skill",
    contentName: "synapse-skill",
    title: "Synapse Skill",
    sourceFingerprint: "sha256:new",
    projects: [],
  })

  expect(result.entries).toContainEqual(expect.objectContaining({
    editorId: "codex",
    scope: "global",
    status: "needs_update",
  }))
})

it("marks an old Synapse Skill without fingerprint as needing update", async () => {
  mocks.scanAll.mockResolvedValue({
    global: [{
      editorId: "codex",
      editorLabel: "Codex",
      status: "detected",
      rules: [],
      rulesSupported: true,
      skills: [{
        name: "synapse-skill",
        path: "/global/skills/synapse-skill",
        source: "synapse",
        synapseContentId: "builtin__skill__synapse-skill",
        repositoryVersion: null,
        preview: "Use Synapse MCP tools.",
        fileCount: 2,
        trash: { mode: "path" },
      }],
      duplicateSkillNames: [],
    }],
    projects: [],
  })

  const result = await new EditorInstallStatusService().resolveForContent({
    contentType: "skill",
    contentId: "synapse-skill",
    contentName: "synapse-skill",
    title: "Synapse Skill",
    sourceFingerprint: "sha256:new",
    projects: [],
  })

  expect(result.entries).toContainEqual(expect.objectContaining({
    editorId: "codex",
    scope: "global",
    status: "needs_update",
  }))
})
```

- [ ] **Step 2: Run status tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-install-status-service.test.ts
```

Expected: FAIL because `sourceFingerprint` is not part of scan/status logic yet.

- [ ] **Step 3: Add fingerprint fields to types and schema**

In `desktop/app-capabilities/synapse-skill/shared/schema.ts`, add:

```ts
sourceFingerprint: z.string().min(1),
```

inside `synapseSkillInstallerSourceSchema`.

In `desktop/src/types/editor-install-status.ts`, add:

```ts
sourceFingerprint?: string
```

to `SynapseResolveEditorInstallStatusPayload`.

In `desktop/src/types/editor-scan.ts`, add:

```ts
sourceFingerprint?: string | null
```

to `EditorScanSkillItem`.

- [ ] **Step 4: Compute source fingerprint**

In `desktop/app-capabilities/synapse-skill/main/service.ts`, extend imports:

```ts
import { readdir, readFile } from "node:fs/promises"
```

Add helpers near `sha256`:

```ts
async function listPackageFiles(rootPath: string, currentPath = rootPath): Promise<string[]> {
  const entries = await readdir(currentPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(currentPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listPackageFiles(rootPath, fullPath))
    } else if (entry.isFile()) {
      files.push(path.relative(rootPath, fullPath).split(path.sep).join("/"))
    }
  }

  return files.sort((left, right) => left.localeCompare(right))
}

async function computePackageFingerprint(rootPath: string): Promise<string> {
  const files = await listPackageFiles(rootPath)
  const hash = createHash("sha256")

  for (const relativePath of files) {
    const bytes = await readFile(path.join(rootPath, relativePath))
    hash.update(relativePath)
    hash.update("\0")
    hash.update(String(bytes.byteLength))
    hash.update("\0")
    hash.update(bytes)
    hash.update("\0")
  }

  return `sha256:${hash.digest("hex")}`
}
```

In `prepareInstallSource()`, compute and include:

```ts
const sourceFingerprint = await computePackageFingerprint(this.packageRoot)
```

and add to `source`:

```ts
sourceFingerprint,
```

- [ ] **Step 5: Persist fingerprint into installed Skill metadata**

In `desktop/src/definitions/editor/shared-skill-directory.ts`, change `.synapse.json` writing to:

```ts
await writeTextFile(
  path.join(stagingDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME),
  JSON.stringify({
    id: detail.id,
    repositoryVersion: detail.latestHistoryDirname,
    ...(detail.sourceFingerprint ? { sourceFingerprint: detail.sourceFingerprint } : {}),
  }, null, 2),
)
```

If `SynapseContentDetail<"skill">` does not yet include `sourceFingerprint`, add optional field to the content detail type or use a local narrowed type:

```ts
const detailWithFingerprint = detail as typeof detail & { sourceFingerprint?: string }
```

Prefer adding the optional field to the shared type if TypeScript errors show the field is broadly useful to installer sources.

- [ ] **Step 6: Read fingerprint during scan**

In `desktop/electron/services/editor-scan-service.ts`, change `readSynapseSkillMeta` return type:

```ts
): Promise<{ id: string; repositoryVersion: string | null; sourceFingerprint: string | null } | null> {
```

Parse:

```ts
const meta = JSON.parse(raw) as {
  id?: unknown
  repositoryVersion?: unknown
  sourceFingerprint?: unknown
}
```

Return:

```ts
sourceFingerprint: typeof meta.sourceFingerprint === "string" && meta.sourceFingerprint.trim().length > 0
  ? meta.sourceFingerprint
  : null,
```

Set scan item:

```ts
sourceFingerprint: meta?.sourceFingerprint ?? null,
```

- [ ] **Step 7: Compare fingerprint in install status**

In `desktop/electron/services/editor-install-status-service.ts`, add helper:

```ts
function isSynapseSkillContentId(contentId: string | null | undefined): boolean {
  return contentId === "synapse-skill" || contentId === "builtin__skill__synapse-skill"
}
```

Update `statusFromSkill` before repositoryVersion comparison:

```ts
if (
  payload.sourceFingerprint
  && item.sourceFingerprint
  && item.sourceFingerprint !== payload.sourceFingerprint
) {
  return "needs_update"
}

if (
  payload.sourceFingerprint
  && !item.sourceFingerprint
  && isSynapseSkillContentId(payload.contentId)
  && isSynapseSkillContentId(item.synapseContentId)
) {
  return "needs_update"
}
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-install-status-service.test.ts electron/services/__tests__/editor-scan-service.test.ts src/definitions/editor/__tests__/shared-skill-directory.test.ts app-capabilities/synapse-skill/main/__tests__/service.test.ts
```

If `app-capabilities/synapse-skill/main/__tests__/service.test.ts` does not exist, omit it and cover fingerprint through renderer or IPC tests in Task 5.

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add desktop/app-capabilities/synapse-skill/shared/schema.ts desktop/app-capabilities/synapse-skill/main/service.ts desktop/src/definitions/editor/shared-skill-directory.ts desktop/electron/services/editor-scan-service.ts desktop/src/types/editor-scan.ts desktop/src/types/editor-install-status.ts desktop/electron/services/editor-install-status-service.ts desktop/src/definitions/editor/__tests__/shared-skill-directory.test.ts desktop/electron/services/__tests__/editor-scan-service.test.ts desktop/electron/services/__tests__/editor-install-status-service.test.ts desktop/app-capabilities/synapse-skill/main/__tests__/service.test.ts
git commit -m "feat: detect synapse skill package updates"
```

---

### Task 4: Single-Target Installer Flow From Status Rows

**Files:**
- Modify if needed: `desktop/src/modules/installers/shared/shared-installer-flow.tsx`
- Test: `desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx`

**Interfaces:**
- Consumes: existing `initialEditor` and `initialSelection`.
- Produces: status rows can launch the shared flow directly at target selection, skipping editor selection.

- [ ] **Step 1: Verify existing test covers direct target flow**

Read `desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx` and confirm this test still exists:

```ts
it("starts at the original target when an initial editor is provided", async () => {
  await renderFlowWithInitialTarget()

  expect(document.body.textContent).toContain("目标位置")
  expect(document.body.textContent).not.toContain("选择编辑器")
  expect(document.querySelector("[data-testid='initial-selection']")?.textContent).toBe("project:/tmp/project")
})
```

- [ ] **Step 2: Add global initial selection assertion**

Add:

```ts
async function renderFlowWithInitialGlobalTarget() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <SharedInstallerFlow
        mode="modal"
        source={repositorySkillSource}
        editors={[editor]}
        initialEditor={editor}
        initialSelection={{ scope: "global" }}
        projects={[]}
        onCancel={vi.fn()}
        onInstalled={vi.fn()}
      />,
    )
  })
}

it("starts at global target when an initial global selection is provided", async () => {
  await renderFlowWithInitialGlobalTarget()

  expect(document.body.textContent).toContain("目标位置")
  expect(document.body.textContent).not.toContain("选择编辑器")
  expect(document.querySelector("[data-testid='initial-selection']")?.textContent).toBe("global:")
})
```

- [ ] **Step 3: Run shared installer test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx
```

Expected: PASS. If it fails because `initialSelection` cannot omit `projectPath`, update the type to allow global selection without `projectPath` and rerun.

- [ ] **Step 4: Commit Task 4**

If no code change was needed except tests:

```bash
git add desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx
git commit -m "test: cover direct global installer target"
```

If implementation changed:

```bash
git add desktop/src/modules/installers/shared/shared-installer-flow.tsx desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx
git commit -m "fix: support direct global installer target"
```

---

### Task 5: Synapse Skill App Row Actions And Batch Actions

**Files:**
- Modify: `desktop/app-capabilities/synapse-skill/renderer/index.tsx`
- Modify: `desktop/app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes:
  - `installSourceToEditorTargets(payload)`
  - `SharedInstallerFlow initialEditor`
  - `SharedInstallerFlow initialSelection`
  - `source.sourceFingerprint`
  - `shell.showItemInFolder(path)`
- Produces: Synapse Skill UI with clickable paths, row-level install/update, and one-click batch install/update.

- [ ] **Step 1: Add failing renderer tests**

In `desktop/app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx`, add bridge mocks:

```ts
const installSourceToEditorTargets = vi.hoisted(() => vi.fn(async () => ({
  results: [{
    target: { editorId: "codex", scope: "global" },
    status: "installed",
  }],
})))

const showItemInFolder = vi.hoisted(() => vi.fn(async () => undefined))
```

Update installer mock:

```ts
vi.mock("@/app-shell/installers", () => ({
  installSourceToEditorTargets,
}))
```

Update electron bridge mock:

```ts
vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "synapseSkill") return synapseSkillBridge
    if (domain === "shell") return { showItemInFolder }
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))
```

Make prepared source include fingerprint:

```ts
sourceFingerprint: "sha256:current",
```

Add tests:

```ts
it("opens an editor Skill directory from the path row", async () => {
  await renderModule()

  await clickButton("/Users/test/.agents/skills/synapse-skill")

  expect(showItemInFolder).toHaveBeenCalledWith("/Users/test/.agents/skills/synapse-skill")
})

it("passes the Synapse Skill fingerprint to status resolution", async () => {
  await renderModule()

  expect(resolveEditorInstallStatus).toHaveBeenCalledWith(expect.objectContaining({
    sourceFingerprint: "sha256:current",
  }))
})

it("installs missing global targets in one batch", async () => {
  await renderModule()

  await clickButton("安装缺失项")

  expect(installSourceToEditorTargets).toHaveBeenCalledWith(expect.objectContaining({
    mode: "install",
    targets: [{ editorId: "codex", scope: "global" }],
  }))
})
```

If `clickButton` only matches exact text, replace it with:

```ts
async function clickButtonContaining(text: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent?.includes(text))
  await act(async () => {
    if (!button) throw new Error(`Button not found: ${text}`)
    button.click()
    await Promise.resolve()
  })
}
```

- [ ] **Step 2: Run renderer test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx
```

Expected: FAIL because the page does not yet open paths, pass fingerprint, or call batch install.

- [ ] **Step 3: Prepare source before status**

In `desktop/app-capabilities/synapse-skill/renderer/index.tsx`, keep a single prepared source for status and install. Add import:

```ts
import { installSourceToEditorTargets } from "../../../src/app-shell/installers"
import { MoreHorizontal } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../src/components/ui/dropdown-menu"
```

Change state:

```ts
const [source, setSource] = useState<SynapseSkillInstallerSource | null>(null)
const [flowSource, setFlowSource] = useState<SynapseSkillInstallerSource | null>(null)
const [initialEditor, setInitialEditor] = useState<SynapseEditorAdapterSummary | null>(null)
const [batchInstalling, setBatchInstalling] = useState(false)
```

Add source preparation helper:

```ts
const ensureSource = useCallback(async () => {
  if (source) return source
  const nextSource = await requireBridgeDomain("synapseSkill").prepareInstallSource()
  setSource(nextSource)
  return nextSource
}, [source])
```

Update `refreshStatus` to call `ensureSource()` and pass fingerprint:

```ts
const installSource = await ensureSource()
const result = await resolveEditorInstallStatus({
  contentId: "synapse-skill",
  contentName: "synapse-skill",
  contentType: "skill",
  projects: [],
  sourceFingerprint: installSource.sourceFingerprint,
  title: "Synapse Skill",
})
```

- [ ] **Step 4: Add row action helpers**

Add helpers near `statusBadgeVariant`:

```ts
function canBatchInstall(status: SynapseEditorInstallStatusEntry["status"] | undefined): boolean {
  return status === "not_installed" || status === "needs_update"
}

function getPrimaryBatchLabel(entries: SynapseEditorInstallStatusEntry[]): string {
  const hasMissing = entries.some((entry) => entry.status === "not_installed")
  const hasUpdate = entries.some((entry) => entry.status === "needs_update")
  if (hasMissing && hasUpdate) return "安装并更新"
  if (hasUpdate) return "更新已安装项"
  if (hasMissing) return "安装缺失项"
  return "全部已安装"
}

function getBatchMode(entries: SynapseEditorInstallStatusEntry[]): "install" | "update" {
  return entries.some((entry) => entry.status === "needs_update") ? "update" : "install"
}
```

Add open path handler:

```ts
const openTargetPath = async (targetPath: string) => {
  try {
    await requireBridgeDomain("shell").showItemInFolder(targetPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : "打开目录失败"
    logger.error("Failed to open Synapse Skill target path.", error)
    toast.error(message)
  }
}
```

Add single-target handler:

```ts
const openInstallFlowForEditor = async (editorId: SynapseEditorAdapterSummary["id"]) => {
  const editor = globalEditors.find((item) => item.id === editorId) ?? null
  if (!editor) return
  try {
    const installSource = await ensureSource()
    setInitialEditor(editor)
    setFlowSource(installSource)
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取 Synapse Skill 失败"
    logger.error("Failed to prepare Synapse Skill source.", error)
    toast.error(message)
  }
}
```

Add batch handler:

```ts
const runBatchInstall = async () => {
  const targets = statusEntries
    .filter((entry) => entry.scope === "global" && canBatchInstall(entry.status))
    .map((entry) => ({ editorId: entry.editorId, scope: entry.scope }))

  if (targets.length === 0 || batchInstalling) return

  setBatchInstalling(true)
  try {
    const installSource = await ensureSource()
    const result = await installSourceToEditorTargets({
      mode: getBatchMode(statusEntries),
      source: installSource,
      targets,
    })
    const failedCount = result.results.filter((entry) => entry.status === "failed").length
    if (failedCount === 0) {
      toast.success("安装完成")
    } else if (failedCount === result.results.length) {
      toast.error("安装失败")
    } else {
      toast.warning("部分安装失败")
    }
    await refreshStatus()
  } catch (error) {
    const message = error instanceof Error ? error.message : "安装失败"
    logger.error("Failed to batch install Synapse Skill.", error)
    toast.error(message)
  } finally {
    setBatchInstalling(false)
  }
}
```

- [ ] **Step 5: Render single-target flow**

Change the `if (source)` branch to `if (flowSource && initialEditor)`:

```tsx
if (flowSource && initialEditor) {
  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto w-full max-w-3xl p-3 sm:p-5">
          <Card className="py-0">
            <CardContent className="p-4 sm:p-5">
              <SharedInstallerFlow
                editors={globalEditors}
                initialEditor={initialEditor}
                initialSelection={{ scope: "global" }}
                kind="skill"
                mode="page"
                projects={config.global.projects}
                source={flowSource}
                onCancel={() => {
                  setFlowSource(null)
                  setInitialEditor(null)
                }}
                onInstalled={async () => {
                  toast.success("安装完成")
                  setFlowSource(null)
                  setInitialEditor(null)
                  await refreshStatus()
                }}
              />
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}
```

- [ ] **Step 6: Render row and batch actions**

Inside the row map, replace path `<p>` with a button when `entry.targetPath` exists:

```tsx
{entry?.targetPath ? (
  <Button
    type="button"
    variant="link"
    className="h-auto min-w-0 justify-start p-0 text-left text-sm text-muted-foreground hover:text-foreground"
    onClick={() => void openTargetPath(entry.targetPath)}
  >
    <span className="break-all">{entry.targetPath}</span>
  </Button>
) : entry?.message ? (
  <p className="break-all text-sm text-muted-foreground">{entry.message}</p>
) : null}
```

Add row action button near the badge:

```tsx
{entry?.status === "not_installed" || entry?.status === "needs_update" ? (
  <Button
    type="button"
    variant="outline"
    size="sm"
    disabled={batchInstalling || preparing}
    onClick={() => void openInstallFlowForEditor(editor.id)}
  >
    {entry.status === "needs_update" ? "更新" : "安装"}
  </Button>
) : entry?.status === "installed" ? (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`${editor.label} 更多操作`}>
        <MoreHorizontal />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => void openInstallFlowForEditor(editor.id)}>
        重新安装
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
) : null}
```

Replace the bottom button:

```tsx
const batchableEntries = statusEntries.filter((entry) => entry.scope === "global" && canBatchInstall(entry.status))
const batchLabel = getPrimaryBatchLabel(statusEntries.filter((entry) => entry.scope === "global"))
```

Use:

```tsx
<Button
  type="button"
  onClick={() => void runBatchInstall()}
  disabled={batchInstalling || statusLoading || adapters.isLoading || batchableEntries.length === 0}
>
  {batchInstalling ? <Spinner data-icon="inline-start" /> : null}
  {batchLabel}
</Button>
```

- [ ] **Step 7: Update release notes**

Add one bullet under `## 功能优化` in `RELEASE_NOTES_PENDING.md`:

```md
- Synapse Skill 支持按编辑器直接安装、打开目标目录，并可一键安装缺失项或更新已安装项。
```

- [ ] **Step 8: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add desktop/app-capabilities/synapse-skill/renderer/index.tsx desktop/app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx RELEASE_NOTES_PENDING.md
git commit -m "feat: improve synapse skill installer app"
```

---

### Task 6: Full Verification

**Files:**
- No source files expected unless verification exposes a bug.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified implementation ready for review.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx \
  electron/modules/installers/__tests__/ipc.test.ts \
  electron/services/__tests__/editor-install-service-batch.test.ts \
  electron/services/__tests__/editor-install-status-service.test.ts \
  electron/services/__tests__/editor-scan-service.test.ts \
  src/definitions/editor/__tests__/shared-skill-directory.test.ts \
  src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck for desktop**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint or package check if available**

Inspect scripts:

```bash
pnpm --filter @synapse/desktop run
```

If `lint` exists, run:

```bash
pnpm --filter @synapse/desktop run lint
```

Expected: PASS.

- [ ] **Step 4: Check git diff scope**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files listed in this plan plus generated IPC output and tests are changed.

- [ ] **Step 5: Commit verification fixes only when they exist**

If Step 1-4 required fixes, inspect the exact changed files:

```bash
git status --short
```

Then stage only the files changed by those fixes. For this plan, the allowed verification-fix file set is:

```bash
git add desktop/src/types/installers.ts desktop/src/types/bridge.ts desktop/src/types/editor-install-status.ts desktop/src/types/editor-scan.ts desktop/src/app-shell/installers.ts desktop/electron/modules/installers/ipc.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/services/editor-install-service.ts desktop/electron/services/editor-scan-service.ts desktop/electron/services/editor-install-status-service.ts desktop/app-capabilities/synapse-skill/shared/schema.ts desktop/app-capabilities/synapse-skill/main/service.ts desktop/src/definitions/editor/shared-skill-directory.ts desktop/src/modules/installers/shared/shared-installer-flow.tsx desktop/app-capabilities/synapse-skill/renderer/index.tsx desktop/electron/modules/installers/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts desktop/electron/services/__tests__/editor-install-service-batch.test.ts desktop/electron/services/__tests__/editor-install-status-service.test.ts desktop/electron/services/__tests__/editor-scan-service.test.ts desktop/src/definitions/editor/__tests__/shared-skill-directory.test.ts desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx desktop/app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx RELEASE_NOTES_PENDING.md
git commit -m "test: verify synapse skill batch install"
```

If no fixes were required, do not stage anything and do not create an empty commit.

---

## Self-Review

- Spec coverage: public target and batch types are in Task 1; main service orchestration is in Task 2; fingerprint and update detection are in Task 3; direct single-target flow is in Task 4; row path opening, row install/update, one-click install/update, and release notes are in Task 5; verification is in Task 6.
- Placeholder scan: no red-flag placeholder phrases remain.
- Type consistency: `sourceFingerprint`, `SynapseInstallSourceTarget`, `SynapseInstallSourceToEditorTargetsPayload`, and `installSourceToEditorTargets` use the same names across tasks.
