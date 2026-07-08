# Synapse Skill App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class `Synapse Skill` system App that owns and installs the packaged Synapse Skill, while removing Resource Repository built-in content.

**Architecture:** `Synapse Skill` moves from `desktop/resources/templates/skills/synapse-skill/` into `desktop/app-capabilities/synapse-skill/skill-package/` as a real installable Skill directory. A main-process service exposes a prepared installer source with stable identity `synapse-skill`, the renderer App displays global editor status from the centralized editor adapter registry, and install actions reuse `SharedInstallerFlow`. Resource Repository stops merging built-in templates and no longer exposes a built-in category.

**Tech Stack:** Electron 41, Vite 8, React 19, TypeScript 6, shadcn/ui, Tailwind CSS 4, Vitest, pnpm.

## Global Constraints

- Do not add new dependencies.
- Do not use custom colors, hex/rgb/hsl literals, Tailwind arbitrary colors, inline styles, nested cards, decorative gradients, glow, or marketing copy.
- The App checks global editor status only; project-scope installation remains inside `SharedInstallerFlow`.
- `Synapse Skill` stable identity is `sourceIdentity: "synapse-skill"`, `name: "synapse-skill"`, `title: "Synapse Skill"`.
- Do not use `prepareLocalSkillSource()` for the system package; use a prepared source provider.
- Editor and agent/editor lists must come from the existing editor adapter registry, not hard-coded arrays.
- Update `AGENTS.md` and `RELEASE_NOTES_PENDING.md` for this user-visible capability change.
- Remove the generic Resource Repository built-in content concept, while preserving unrelated `builtin` terminology in Automation, Agent personas, model price presets, and runtime assets.

---

## File Structure

Create:

- `desktop/app-capabilities/synapse-skill/shared/capability.ts`: stable App id, service id, and package identity constants.
- `desktop/app-capabilities/synapse-skill/shared/schema.ts`: zod schemas for the prepare-install IPC response.
- `desktop/app-capabilities/synapse-skill/main/service.ts`: resolves and validates the system Skill package, returns installer sources, and reads prepared detail.
- `desktop/app-capabilities/synapse-skill/main/prepared-source-provider.ts`: implements `PreparedContentInstallSourceProvider` for `synapse-skill`.
- `desktop/app-capabilities/synapse-skill/main/ipc.ts`: exposes `prepareInstallSource`.
- `desktop/app-capabilities/synapse-skill/main/__tests__/service.test.ts`: service and prepared provider tests.
- `desktop/app-capabilities/synapse-skill/main/__tests__/ipc.test.ts`: IPC channel and handler tests.
- `desktop/app-capabilities/synapse-skill/renderer/app-definition.ts`: system App definition.
- `desktop/app-capabilities/synapse-skill/renderer/app-manifest.ts`: App manifest with icon.
- `desktop/app-capabilities/synapse-skill/renderer/index.tsx`: App UI.
- `desktop/app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx`: renderer tests.
- `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md`: installable Skill main file moved from the old template content.
- `desktop/app-capabilities/synapse-skill/skill-package/<domain>/*.md`: installable domain guide files moved from old template attachments.

Modify:

- `desktop/electron/bootstrap/ipc-registry.ts`: register the new IPC module.
- `desktop/electron/bootstrap/app-ready.ts`: register the new prepared source provider in `initializeReadyApp()` before `createIpcRegistry(ipcCtx)`.
- `desktop/electron/preload.ts`, `desktop/electron/generated/ipc-channels.generated.ts`, `desktop/src/types/bridge.ts`: expose `window.synapse.synapseSkill.prepareInstallSource`.
- `desktop/src/modules/apps/types.ts`: add `synapse-skill` App id and `synapse_skill` namespace.
- `desktop/src/modules/apps/registry.ts`: register `synapseSkillAppManifest`.
- `desktop/src/modules/apps/components/system-app-content.tsx`: render `SynapseSkillModule`.
- `desktop/electron/services/content-service.ts`: stop merging built-in content.
- `desktop/electron/services/content-download-service.ts`, `desktop/electron/services/editor-install-core.ts`, `desktop/electron/services/content-submission-service.ts`: remove Resource Repository built-in branches.
- `desktop/src/lib/content-categories.ts`: remove `SYNAPSE_BUILTIN_CATEGORY_ID` and built-in category stats.
- `desktop/resources/templates/**`: delete obsolete built-in templates.
- `desktop/package.json`: replace `resources/templates` extraResource with `app-capabilities/synapse-skill/skill-package`.
- `desktop/tests/unit/packaged-asar.test.ts`: require `resources/synapse-skill/SKILL.md`.
- `desktop/tests/unit/api-mcp-capability-surface.test.ts`: update Synapse Skill docs path.
- `AGENTS.md`: update long-term MCP docs rule.
- `RELEASE_NOTES_PENDING.md`: add user-facing release note.

---

### Task 1: Create The System Synapse Skill Package

**Files:**
- Create: `desktop/app-capabilities/synapse-skill/shared/capability.ts`
- Create: `desktop/app-capabilities/synapse-skill/shared/schema.ts`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/app/index.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/app/api-reference.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/automation/index.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/automation/api-reference.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/content/index.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/content/api-reference.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/database/index.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/database/api-reference.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/drive/index.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/drive/api-reference.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/model-price/index.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/model-price/api-reference.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/repository/index.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/repository/api-reference.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/skill-repository/index.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/skill-repository/api-reference.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/variable/index.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/variable/api-reference.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/workflow/index.md`
- Create: `desktop/app-capabilities/synapse-skill/skill-package/workflow/api-reference.md`
- Test: `desktop/app-capabilities/synapse-skill/main/__tests__/service.test.ts`

**Interfaces:**
- Produces: `SYNAPSE_SKILL_APP_ID = "synapse-skill"`, `SYNAPSE_SKILL_SOURCE_IDENTITY = "synapse-skill"`, `SYNAPSE_SKILL_NAME = "synapse-skill"`, `SYNAPSE_SKILL_TITLE = "Synapse Skill"`.
- Produces: `synapseSkillInstallerSourceSchema` for renderer bridge typing.
- Consumes: existing old package files under `desktop/resources/templates/skills/synapse-skill/`.

- [ ] **Step 1: Create stable shared constants**

Create `desktop/app-capabilities/synapse-skill/shared/capability.ts`:

```ts
export const SYNAPSE_SKILL_APP_ID = "synapse-skill" as const
export const SYNAPSE_SKILL_SERVICE_ID = "core.synapse-skill" as const
export const SYNAPSE_SKILL_SOURCE_IDENTITY = "synapse-skill" as const
export const SYNAPSE_SKILL_NAME = "synapse-skill" as const
export const SYNAPSE_SKILL_TITLE = "Synapse Skill" as const
export const SYNAPSE_SKILL_PREPARED_SOURCE_PREFIX = "synapse-skill:" as const
```

- [ ] **Step 2: Create bridge schema**

Create `desktop/app-capabilities/synapse-skill/shared/schema.ts`:

```ts
import { z } from "zod"

export const synapseSkillInstallerSourceSchema = z.object({
  kind: z.literal("skill"),
  origin: z.literal("prepared"),
  sourceIdentity: z.literal("synapse-skill"),
  name: z.literal("synapse-skill"),
  title: z.literal("Synapse Skill"),
  description: z.string(),
  preparedSourceId: z.string().min(1),
  mainContent: z.string(),
})

export type SynapseSkillInstallerSource = z.infer<typeof synapseSkillInstallerSourceSchema>
```

- [ ] **Step 3: Move the existing Skill files into the package**

Run:

```bash
mkdir -p desktop/app-capabilities/synapse-skill/skill-package
cp desktop/resources/templates/skills/synapse-skill/content.md desktop/app-capabilities/synapse-skill/skill-package/SKILL.md
cp -R desktop/resources/templates/skills/synapse-skill/files/. desktop/app-capabilities/synapse-skill/skill-package/
```

Expected: `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md` exists, and domain files such as `desktop/app-capabilities/synapse-skill/skill-package/database/index.md` exist.

- [ ] **Step 4: Update package routing paths inside `SKILL.md`**

Edit `desktop/app-capabilities/synapse-skill/skill-package/SKILL.md` so the routing section references direct sibling domain files:

```md
- Database, tables, rows, columns, choices, SQL, table folders, mutation logs -> `database/index.md`
- Drive files, folders, upload, download, preview, share links, public assets, trash, versions -> `drive/index.md`
- Workflow definitions, nodes, edges, DAG validation, layout, variables, providers, workflow runs -> `workflow/index.md`
- Automation items, schedules, cron/interval triggers, executors, enablement, manual runs, active runs, run history -> `automation/index.md`
- Cloud Skill repositories, local Skill upload, cloud Skill repository update, repository management URL -> `skill-repository/index.md`
- Rule, Skill, Prompt publishing and Resource Repository management -> `content/index.md`
- Model price rules and used-model pricing -> `model-price/index.md`
- Settings variables -> `variable/index.md`
- Settings repositories -> `repository/index.md`
- App-provided capabilities such as document generation -> `app/index.md`
```

- [ ] **Step 5: Verify package shape**

Run:

```bash
test -f desktop/app-capabilities/synapse-skill/skill-package/SKILL.md
test -f desktop/app-capabilities/synapse-skill/skill-package/database/index.md
test -f desktop/app-capabilities/synapse-skill/skill-package/automation/api-reference.md
rg -n 'files/' desktop/app-capabilities/synapse-skill/skill-package/SKILL.md
```

Expected: first three commands exit 0; `rg` exits 1 because `SKILL.md` no longer points at old template attachment paths.

- [ ] **Step 6: Commit**

```bash
git add desktop/app-capabilities/synapse-skill/shared desktop/app-capabilities/synapse-skill/skill-package
git commit -m "feat: add synapse skill package"
```

---

### Task 2: Implement The Prepared Install Source

**Files:**
- Create: `desktop/app-capabilities/synapse-skill/main/service.ts`
- Create: `desktop/app-capabilities/synapse-skill/main/prepared-source-provider.ts`
- Create: `desktop/app-capabilities/synapse-skill/main/__tests__/service.test.ts`

**Interfaces:**
- Consumes: constants and schema from Task 1.
- Produces: `createSynapseSkillService(deps?: SynapseSkillServiceDeps): SynapseSkillService`.
- Produces: `synapseSkillPreparedSourceProvider`, compatible with `PreparedContentInstallSourceProvider`.
- Produces: `prepareInstallSource(): Promise<SynapseSkillInstallerSource>`.

- [ ] **Step 1: Write failing service tests**

Create `desktop/app-capabilities/synapse-skill/main/__tests__/service.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { SYNAPSE_SKILL_SOURCE_IDENTITY } from "../../shared/capability"
import { createSynapseSkillService } from "../service"

async function createPackageRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-skill-package-"))
  await mkdir(path.join(root, "database"), { recursive: true })
  await writeFile(path.join(root, "SKILL.md"), "---\nname: synapse-skill\ndescription: Test\n---\n# Synapse Skill\n", "utf8")
  await writeFile(path.join(root, "database", "index.md"), "# Database\n", "utf8")
  return root
}

describe("SynapseSkillService", () => {
  it("prepares a stable system installer source", async () => {
    const packageRoot = await createPackageRoot()
    const service = createSynapseSkillService({ packageRoot })

    const source = await service.prepareInstallSource()

    expect(source).toMatchObject({
      kind: "skill",
      origin: "prepared",
      sourceIdentity: SYNAPSE_SKILL_SOURCE_IDENTITY,
      name: "synapse-skill",
      title: "Synapse Skill",
    })
    expect(source.preparedSourceId).toMatch(/^synapse-skill:/)
    expect(source.mainContent).toContain("# Synapse Skill")
  })

  it("reads prepared skill detail with nested attachments", async () => {
    const packageRoot = await createPackageRoot()
    const service = createSynapseSkillService({ packageRoot })
    const source = await service.prepareInstallSource()

    const detail = await service.readPreparedSkill(source.preparedSourceId, source.sourceIdentity)

    expect(detail.id).toBe("synapse-skill")
    expect(detail.name).toBe("synapse-skill")
    expect(detail.attachments.map((item) => item.originalName)).toContain("database/index.md")
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/app-capabilities/synapse-skill/main/__tests__/service.test.ts
```

Expected: FAIL because `../service` does not exist.

- [ ] **Step 3: Implement service**

Create `desktop/app-capabilities/synapse-skill/main/service.ts`:

```ts
import { createHash, randomUUID } from "node:crypto"
import { copyFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { app } from "electron"
import type { SynapseContentDetail } from "../../../src/types/content"
import { readSkillDraftFromDirectory } from "../../../electron/services/content-skill-source-service"
import {
  SYNAPSE_SKILL_NAME,
  SYNAPSE_SKILL_PREPARED_SOURCE_PREFIX,
  SYNAPSE_SKILL_SOURCE_IDENTITY,
  SYNAPSE_SKILL_TITLE,
} from "../shared/capability"
import type { SynapseSkillInstallerSource } from "../shared/schema"

type SynapseSkillServiceDeps = {
  readonly createId?: () => string
  readonly packageRoot?: string
}

type PreparedSynapseSkill = {
  readonly packageRoot: string
  readonly source: SynapseSkillInstallerSource
}

function defaultPackageRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "synapse-skill")
  }
  return path.join(app.getAppPath(), "app-capabilities", "synapse-skill", "skill-package")
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

class SynapseSkillService {
  private readonly createId: () => string
  private readonly packageRoot: string
  private readonly preparedById = new Map<string, PreparedSynapseSkill>()

  constructor(deps: SynapseSkillServiceDeps = {}) {
    this.createId = deps.createId ?? randomUUID
    this.packageRoot = deps.packageRoot ?? defaultPackageRoot()
  }

  async prepareInstallSource(): Promise<SynapseSkillInstallerSource> {
    const draft = await readSkillDraftFromDirectory(this.packageRoot)
    const preparedSourceId = `${SYNAPSE_SKILL_PREPARED_SOURCE_PREFIX}${this.createId()}`
    const source: SynapseSkillInstallerSource = {
      kind: "skill",
      origin: "prepared",
      sourceIdentity: SYNAPSE_SKILL_SOURCE_IDENTITY,
      name: SYNAPSE_SKILL_NAME,
      title: SYNAPSE_SKILL_TITLE,
      description: draft.metadata.description?.trim() ?? "",
      preparedSourceId,
      mainContent: draft.content,
    }
    this.preparedById.set(preparedSourceId, { packageRoot: this.packageRoot, source })
    return source
  }

  hasPreparedSource(sourceId: string, contentId: string): boolean {
    return contentId === SYNAPSE_SKILL_SOURCE_IDENTITY && this.preparedById.has(sourceId)
  }

  async readPreparedSkill(sourceId: string, contentId: string): Promise<SynapseContentDetail<"skill">> {
    this.requirePrepared(sourceId, contentId)
    const draft = await readSkillDraftFromDirectory(this.packageRoot)
    const now = new Date(0).toISOString()
    return {
      attachmentCount: draft.files.length,
      attachments: draft.files.map((file) => ({
        originalName: file.originalName,
        sha256: file.sha256 ?? sha256(file.bytes ?? new Uint8Array()),
        size: file.size,
      })),
      category: "system",
      content: draft.content,
      createdAt: now,
      createdBy: "synapse",
      createdByDisplayName: "Synapse",
      deleted: false,
      description: draft.metadata.description?.trim() ?? "",
      icon: "",
      iconBg: "",
      id: SYNAPSE_SKILL_SOURCE_IDENTITY,
      latestHistoryDirname: "system",
      modifiedAt: now,
      modifiedBy: "synapse",
      modifiedByDisplayName: "Synapse",
      name: SYNAPSE_SKILL_NAME,
      title: SYNAPSE_SKILL_TITLE,
      type: "skill",
    }
  }

  async copyPreparedSkillAttachment(sourceId: string, contentId: string, relativePath: string, targetPath: string): Promise<void> {
    this.requirePrepared(sourceId, contentId)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(path.join(this.packageRoot, relativePath), targetPath)
  }

  beginPreparedInstall(sourceId: string, contentId: string): Promise<void> {
    this.requirePrepared(sourceId, contentId)
    return Promise.resolve()
  }

  endPreparedInstall(sourceId: string, contentId: string): Promise<void> {
    this.requirePrepared(sourceId, contentId)
    return Promise.resolve()
  }

  markPreparedInstalled(sourceId: string, contentId: string): Promise<void> {
    this.requirePrepared(sourceId, contentId)
    return Promise.resolve()
  }

  private requirePrepared(sourceId: string, contentId: string): PreparedSynapseSkill {
    const prepared = this.preparedById.get(sourceId)
    if (!prepared || contentId !== SYNAPSE_SKILL_SOURCE_IDENTITY) {
      throw new Error("Synapse Skill 安装源不可用。")
    }
    return prepared
  }
}

const synapseSkillService = new SynapseSkillService()

function createSynapseSkillService(deps?: SynapseSkillServiceDeps): SynapseSkillService {
  return new SynapseSkillService(deps)
}

export {
  SynapseSkillService,
  createSynapseSkillService,
  synapseSkillService,
  type SynapseSkillServiceDeps,
}
```

- [ ] **Step 4: Implement prepared source provider**

Create `desktop/app-capabilities/synapse-skill/main/prepared-source-provider.ts`:

```ts
import type { PreparedContentInstallSourceProvider } from "../../../electron/services/editor-install-service"
import { synapseSkillService } from "./service"

export const synapseSkillPreparedSourceProvider: PreparedContentInstallSourceProvider = {
  hasPreparedSource(sourceId, contentId) {
    return synapseSkillService.hasPreparedSource(sourceId, contentId)
  },
  async readPreparedRule() {
    throw new Error("Synapse Skill prepared source is not a Rule.")
  },
  readPreparedSkill(sourceId, contentId) {
    return synapseSkillService.readPreparedSkill(sourceId, contentId)
  },
  beginPreparedInstall(sourceId, contentId) {
    return synapseSkillService.beginPreparedInstall(sourceId, contentId)
  },
  endPreparedInstall(sourceId, contentId) {
    return synapseSkillService.endPreparedInstall(sourceId, contentId)
  },
  copyPreparedSkillAttachment(sourceId, contentId, relativePath, targetPath) {
    return synapseSkillService.copyPreparedSkillAttachment(sourceId, contentId, relativePath, targetPath)
  },
  markPreparedInstalled(sourceId, contentId) {
    return synapseSkillService.markPreparedInstalled(sourceId, contentId)
  },
}
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/app-capabilities/synapse-skill/main/__tests__/service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/app-capabilities/synapse-skill/main
git commit -m "feat: prepare synapse skill install source"
```

---

### Task 3: Expose IPC And Register The Prepared Provider

**Files:**
- Create: `desktop/app-capabilities/synapse-skill/main/ipc.ts`
- Create: `desktop/app-capabilities/synapse-skill/main/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/bootstrap/app-ready.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/src/types/bridge.ts`

**Interfaces:**
- Consumes: `synapseSkillService.prepareInstallSource()`.
- Produces bridge domain: `window.synapse.synapseSkill.prepareInstallSource(): Promise<SynapseSkillInstallerSource>`.
- Produces IPC module id: `synapseSkill`.

- [ ] **Step 1: Write failing IPC tests**

Create `desktop/app-capabilities/synapse-skill/main/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { synapseSkillIpcModule } from "../ipc"

vi.mock("../service", () => ({
  synapseSkillService: {
    prepareInstallSource: vi.fn(async () => ({
      kind: "skill",
      origin: "prepared",
      sourceIdentity: "synapse-skill",
      name: "synapse-skill",
      title: "Synapse Skill",
      description: "",
      preparedSourceId: "synapse-skill:test",
      mainContent: "# Synapse Skill",
    })),
  },
}))

describe("synapseSkillIpcModule", () => {
  it("exposes prepare install source", async () => {
    expect(synapseSkillIpcModule.id).toBe("synapseSkill")
    expect(synapseSkillIpcModule.methods.prepareInstallSource.channel).toBe("synapse:synapse-skill:install-source:prepare")

    const result = await synapseSkillIpcModule.methods.prepareInstallSource.handler({} as never, undefined)

    expect(result.sourceIdentity).toBe("synapse-skill")
    expect(synapseSkillIpcModule.methods.prepareInstallSource.response?.parse(result)).toEqual(result)
  })
})
```

- [ ] **Step 2: Run IPC test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/app-capabilities/synapse-skill/main/__tests__/ipc.test.ts
```

Expected: FAIL because `../ipc` does not exist.

- [ ] **Step 3: Implement IPC module**

Create `desktop/app-capabilities/synapse-skill/main/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import { synapseSkillInstallerSourceSchema } from "../shared/schema"
import { synapseSkillService } from "./service"

export const synapseSkillIpcModule: IpcModule = {
  id: "synapseSkill",
  methods: {
    prepareInstallSource: {
      channel: "synapse:synapse-skill:install-source:prepare",
      kind: "invoke",
      request: z.void().optional(),
      response: synapseSkillInstallerSourceSchema,
      handler: async () => synapseSkillService.prepareInstallSource(),
    },
  },
  events: {},
}
```

- [ ] **Step 4: Register IPC module**

Modify `desktop/electron/bootstrap/ipc-registry.ts`:

```ts
import { synapseSkillIpcModule } from "../../app-capabilities/synapse-skill/main/ipc"
```

Add `registry.register(synapseSkillIpcModule, ctx)` next to other App Capability modules.

Add `synapseSkillIpcModule` once to `registeredIpcModules`.

- [ ] **Step 5: Register prepared provider**

Modify `desktop/electron/bootstrap/app-ready.ts`.

Add imports:

```ts
import { editorInstallService } from "../services/editor-install-service"
import { synapseSkillPreparedSourceProvider } from "../../app-capabilities/synapse-skill/main/prepared-source-provider"
```

Inside `initializeReadyApp()`, place this line immediately before `createIpcRegistry(ipcCtx)`:

```ts
editorInstallService.addPreparedSourceProvider(synapseSkillPreparedSourceProvider)
```

- [ ] **Step 6: Expose bridge types and preload**

Modify `desktop/electron/generated/ipc-channels.generated.ts` to include:

```ts
"synapse-skill": {
  "prepareInstallSource": "synapse:synapse-skill:install-source:prepare",
},
```

Modify `desktop/electron/preload.ts` to expose:

```ts
synapseSkill: {
  prepareInstallSource: invoke(IPC_CHANNELS["synapse-skill"].prepareInstallSource),
},
```

Modify `desktop/src/types/bridge.ts` to include:

```ts
synapseSkill: {
  prepareInstallSource: () => Promise<import("../../app-capabilities/synapse-skill/shared/schema").SynapseSkillInstallerSource>
}
```

- [ ] **Step 7: Run IPC and preload tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/app-capabilities/synapse-skill/main/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/synapse-skill/main desktop/electron/bootstrap desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/src/types/bridge.ts
git commit -m "feat: expose synapse skill installer source"
```

---

### Task 4: Build The Synapse Skill System App UI

**Files:**
- Create: `desktop/app-capabilities/synapse-skill/renderer/app-definition.ts`
- Create: `desktop/app-capabilities/synapse-skill/renderer/app-manifest.ts`
- Create: `desktop/app-capabilities/synapse-skill/renderer/index.tsx`
- Create: `desktop/app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx`
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/registry.ts`
- Modify: `desktop/src/modules/apps/components/system-app-content.tsx`

**Interfaces:**
- Consumes: `window.synapse.synapseSkill.prepareInstallSource`.
- Consumes: `useEditorAdaptersForContentType({ contentType: "skill" })`.
- Consumes: `resolveEditorInstallStatus`.
- Produces App id `synapse-skill` and namespace `synapse_skill`.

- [ ] **Step 1: Write failing renderer test**

Create `desktop/app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { SynapseSkillModule } from "../index"

vi.mock("../../../../src/modules/content/hooks/use-editor-adapters-for-content-type", () => ({
  useEditorAdaptersForContentType: () => ({
    error: null,
    filteredAdapters: [
      {
        id: "codex",
        label: "Codex",
        order: 20,
        supportsGlobal: true,
        supportsProject: true,
        supportedContentTypes: ["skill"],
      },
    ],
    isLoading: false,
    load: vi.fn(async () => []),
  }),
}))

vi.mock("../../../../src/app-shell/config", () => ({
  useAppConfig: () => ({ config: { global: { projects: [] } } }),
}))

vi.mock("../../../../src/app-shell/editor-install-status", () => ({
  resolveEditorInstallStatus: vi.fn(async () => ({
    entries: [
      {
        editorId: "codex",
        editorLabel: "Codex",
        scope: "global",
        status: "not_installed",
        targetPath: "/Users/test/.agents/skills/synapse-skill",
        message: null,
      },
    ],
  })),
}))

vi.mock("../../../../src/modules/installers/shared/shared-installer-flow", () => ({
  SharedInstallerFlow: ({ source }: { source?: { name: string } }) => (
    <div data-testid="installer-flow">{source?.name}</div>
  ),
}))

describe("SynapseSkillModule", () => {
  it("shows global editor status and opens installer flow", async () => {
    window.synapse = {
      synapseSkill: {
        prepareInstallSource: vi.fn(async () => ({
          kind: "skill",
          origin: "prepared",
          sourceIdentity: "synapse-skill",
          name: "synapse-skill",
          title: "Synapse Skill",
          description: "",
          preparedSourceId: "synapse-skill:test",
          mainContent: "# Synapse Skill",
        })),
      },
    } as never

    render(<SynapseSkillModule />)

    expect(await screen.findByText("Codex")).toBeInTheDocument()
    expect(screen.getByText("未安装")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "安装 Synapse Skill" }))

    expect(await screen.findByTestId("installer-flow")).toHaveTextContent("synapse-skill")
  })
})
```

- [ ] **Step 2: Run renderer test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx
```

Expected: FAIL because renderer files do not exist.

- [ ] **Step 3: Add App definition and manifest**

Create `desktop/app-capabilities/synapse-skill/renderer/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { SYNAPSE_SKILL_APP_ID } from "../shared/capability"

export const synapseSkillAppDefinition = {
  id: SYNAPSE_SKILL_APP_ID,
  namespace: "synapse_skill",
  type: "system",
  name: "Synapse Skill",
  windowTitle: "Synapse Skill",
  dock: { pinnedByDefault: false, order: 290 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_synapse_skill",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/app-capabilities/synapse-skill/renderer/app-manifest.ts`:

```ts
import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "../../../src/modules/installers/assets/icon.png"
import { synapseSkillAppDefinition } from "./app-definition"

export const synapseSkillAppManifest = {
  ...synapseSkillAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

- [ ] **Step 4: Add App UI**

Create `desktop/app-capabilities/synapse-skill/renderer/index.tsx` with these exported names and behaviors:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { useAppConfig } from "../../../src/app-shell/config"
import { resolveEditorInstallStatus } from "../../../src/app-shell/editor-install-status"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { EditorIcon } from "../../../src/components/editor-icon"
import { Badge } from "../../../src/components/ui/badge"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent } from "../../../src/components/ui/card"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import { useEditorAdaptersForContentType } from "../../../src/modules/content/hooks/use-editor-adapters-for-content-type"
import { SharedInstallerFlow } from "../../../src/modules/installers/shared/shared-installer-flow"
import type { SynapseEditorInstallStatusEntry } from "../../../src/types/editor-install-status"
import type { SynapseSkillInstallerSource } from "../shared/schema"

const logger = createRendererLogger("synapse-skill.app")

const statusLabel = {
  conflict: "冲突",
  external_same_name: "外部同名",
  installed: "已安装",
  needs_update: "需更新",
  not_installed: "未安装",
  unavailable: "不可用",
  unsupported: "不支持",
} as const

export function SynapseSkillModule() {
  const { config } = useAppConfig()
  const [source, setSource] = useState<SynapseSkillInstallerSource | null>(null)
  const [statusEntries, setStatusEntries] = useState<SynapseEditorInstallStatusEntry[]>([])
  const [statusError, setStatusError] = useState("")
  const [statusLoading, setStatusLoading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const adapters = useEditorAdaptersForContentType({
    contentType: "skill",
    enabled: true,
    loggerName: "synapse-skill.editors",
  })
  const globalEditors = useMemo(
    () => adapters.filteredAdapters.filter((editor) => editor.supportsGlobal),
    [adapters.filteredAdapters],
  )

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true)
    setStatusError("")
    try {
      const result = await resolveEditorInstallStatus({
        contentId: "synapse-skill",
        contentName: "synapse-skill",
        contentType: "skill",
        projects: [],
        title: "Synapse Skill",
      })
      setStatusEntries(result.entries.filter((entry) => entry.scope === "global"))
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取安装状态失败"
      logger.error("Failed to load Synapse Skill install status.", error)
      setStatusError(message)
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    void adapters.load()
    void refreshStatus()
  }, [adapters.load, refreshStatus])

  const startInstall = async () => {
    setPreparing(true)
    try {
      const nextSource = await requireBridgeDomain("synapseSkill").prepareInstallSource()
      setSource(nextSource)
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取 Synapse Skill 失败"
      logger.error("Failed to prepare Synapse Skill source.", error)
      toast.error(message)
    } finally {
      setPreparing(false)
    }
  }

  if (source) {
    return (
      <SystemAppWindowShell>
        <ScrollArea className="h-full min-h-0">
          <div className="mx-auto w-full max-w-3xl p-3 sm:p-5">
            <Card className="py-0">
              <CardContent className="p-4 sm:p-5">
                <SharedInstallerFlow
                  editors={globalEditors}
                  kind="skill"
                  mode="page"
                  projects={config.global.projects}
                  source={source}
                  onCancel={() => setSource(null)}
                  onInstalled={async () => {
                    toast.success("安装完成")
                    setSource(null)
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

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center p-3 sm:p-5">
          <Card className="py-0">
            <CardContent className="grid gap-4 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">全局安装状态</p>
                <Button type="button" variant="ghost" size="sm" onClick={refreshStatus} disabled={statusLoading}>
                  {statusLoading ? <Spinner data-icon="inline-start" /> : <RefreshCw />}
                  刷新
                </Button>
              </div>
              {statusError ? <p className="text-sm text-destructive">{statusError}</p> : null}
              <div className="divide-y divide-border">
                {globalEditors.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">未检测到可安装的编辑器</p>
                ) : globalEditors.map((editor) => {
                  const entry = statusEntries.find((item) => item.editorId === editor.id)
                  return (
                    <div key={editor.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <EditorIcon editorId={editor.id} className="size-7" />
                          <p className="truncate font-medium">{editor.label}</p>
                        </div>
                        <Badge variant={entry?.status === "installed" ? "default" : "outline"}>
                          {entry ? statusLabel[entry.status] : "检测中"}
                        </Badge>
                      </div>
                      {entry?.targetPath || entry?.message ? (
                        <p className="break-all text-sm text-muted-foreground">{entry.targetPath ?? entry.message}</p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-center border-t pt-4">
                <Button type="button" onClick={startInstall} disabled={preparing || adapters.isLoading}>
                  {preparing ? <Spinner data-icon="inline-start" /> : null}
                  安装 Synapse Skill
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}
```

- [ ] **Step 5: Register App in system registry**

Modify `desktop/src/modules/apps/types.ts`:

```ts
export const SYSTEM_APP_IDS = [
  "agent",
  "agent-personas",
  "workflow",
  "drive",
  "automation",
  "launcher",
  "settings",
  "resource-repository",
  "git",
  "database",
  "document-template",
  "skill-installer",
  "synapse-skill",
  "rule-installer",
  "quick-input",
  "sound-notifier",
  "terminal",
  "screenshot",
  "editor-scan",
  "usage-monitor",
  "model-price",
  "swarm-task",
] as const
```

Add namespace union member:

```ts
| "synapse_skill"
```

Modify `desktop/src/modules/apps/registry.ts`:

```ts
import { synapseSkillAppManifest } from "../../../app-capabilities/synapse-skill/renderer/app-manifest"
```

Add `synapseSkillAppManifest` near installer Apps in `systemApps`.

Modify `desktop/src/modules/apps/components/system-app-content.tsx`:

```tsx
import { SynapseSkillModule } from "../../../../app-capabilities/synapse-skill/renderer"
```

Add:

```tsx
if (appId === "synapse-skill") return <SynapseSkillModule />
```

- [ ] **Step 6: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/app-capabilities/synapse-skill/renderer/__tests__/synapse-skill-module.test.tsx desktop/src/modules/apps/__tests__/system-app-content-launcher.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/app-capabilities/synapse-skill/renderer desktop/src/modules/apps
git commit -m "feat: add synapse skill app"
```

---

### Task 5: Remove Resource Repository Built-In Content

**Files:**
- Delete: `desktop/electron/services/builtin-content-service.ts`
- Delete: `desktop/resources/templates/`
- Modify: `desktop/electron/services/content-service.ts`
- Modify: `desktop/electron/services/content-download-service.ts`
- Modify: `desktop/electron/services/editor-install-core.ts`
- Modify: `desktop/electron/services/content-submission-service.ts`
- Modify: `desktop/src/lib/content-categories.ts`
- Modify tests under `desktop/electron/services/__tests__/` and `desktop/src/modules/content/**/__tests__/`

**Interfaces:**
- Consumes: Synapse Skill package from Task 1.
- Produces: Resource Repository lists only repository-backed user content.
- Removes: runtime id convention `builtin__<type>__<rawId>` for Resource Repository content.

- [ ] **Step 1: Write failing category test**

In `desktop/src/modules/content/__tests__/content-browser-utils.test.ts` or the existing content category test file, add:

```ts
import { buildCategoryStats } from "@/lib/content-categories"

it("does not create a built-in category", () => {
  const result = buildCategoryStats("skill", [])

  expect(result.items.map((item) => item.label)).not.toContain("内置资源")
})
```

- [ ] **Step 2: Write failing content-service test**

In `desktop/electron/services/__tests__/content-service.test.ts`, update the list-content test so it expects no builtin service calls and no built-in items:

```ts
it("lists repository content without merging built-in templates", async () => {
  mocks.contentIndexService.listContent.mockResolvedValue([
    { id: "skill-1", type: "skill", source: "repository", title: "User Skill" },
  ])

  const result = await contentService.listContent("skill")

  expect(result.map((item) => item.id)).toEqual(["skill-1"])
})
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/content-service.test.ts desktop/src/modules/content/__tests__/content-browser-utils.test.ts
```

Expected: FAIL because built-in category and built-in list merge still exist.

- [ ] **Step 4: Remove built-in merge from content service**

Modify `desktop/electron/services/content-service.ts`:

- Remove `import { builtinContentService } from "./builtin-content-service"`.
- In `listContent`, remove `const builtinItems = await builtinContentService.listContent(contentType)`.
- If no active repository exists, return `[]`.
- On repository load failure, return `[]`.
- Remove built-in branches from `getContent`, `getDetail`, `getAttachmentFile`, and `readIconImage`.

The new `listContent` shape should be:

```ts
async listContent<T extends SynapseContentType>(contentType: T): Promise<SynapseContentMeta<T>[]> {
  const context = await getActiveRepositoryContext()

  if (!context) {
    return []
  }

  try {
    await contentIndexService.syncIndex(context.repository)
    return await contentIndexService.listContent(context.repository, contentType) as SynapseContentMeta<T>[]
  } catch (error) {
    logger.warn("Failed to load repository content, returning empty list.", { contentType, error })
    return []
  }
}
```

- [ ] **Step 5: Remove built-in attachment paths**

Modify `desktop/electron/services/content-download-service.ts`:

- Remove `builtinContentService` import.
- In zip export, always resolve `repositoryRootPath` from active repository.
- Always copy attachments from `attachmentsPoolService.copyAttachmentToPath`.

Modify `desktop/electron/services/editor-install-core.ts`:

- Remove `builtinContentService` import.
- Remove `detailWithSubstitutions.source === "builtin"` branch from attachment copying.
- Keep prepared source and local-directory source branches intact.

Modify `desktop/electron/services/content-submission-service.ts`:

- Remove built-in id guard that rejects or special-cases `builtinContentService.isBuiltinContentId(contentId)`.
- Keep repository content submission validation intact.

- [ ] **Step 6: Remove built-in category**

Modify `desktop/src/lib/content-categories.ts`:

- Delete `SYNAPSE_BUILTIN_CATEGORY_ID`.
- Delete `createBuiltinCategoryItem`.
- Delete `item.source === "builtin"` special count.
- Delete built-in label branch from `getCategoryLabel`.
- Return category items as:

```ts
return {
  items: [createAllCategoryItem(contentType, items.length), ...viewItems],
  totalCount: items.length,
  unknownCategoryIds: [...unknownCategoryIds].sort((left, right) => left.localeCompare(right, "zh-CN")),
}
```

Modify `desktop/src/modules/content/components/content-browser-page.tsx`:

- Remove built-in category import.
- Remove `activeCategoryId === SYNAPSE_BUILTIN_CATEGORY_ID` branch.

- [ ] **Step 7: Delete obsolete built-in templates and service**

Run:

```bash
git rm -r desktop/resources/templates
git rm desktop/electron/services/builtin-content-service.ts
```

Then update tests that imported `builtinContentService` mocks so they assert repository-only behavior.

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/content-service.test.ts desktop/electron/services/__tests__/content-download-service.test.ts desktop/electron/services/__tests__/content-submission-service.test.ts desktop/src/modules/content
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/services desktop/src/lib/content-categories.ts desktop/src/modules/content desktop/electron/services/__tests__ desktop/src/modules/content/__tests__
git add -u desktop/resources/templates
git commit -m "refactor: remove resource repository built-ins"
```

---

### Task 6: Packaging, Docs, Release Notes, And Final Verification

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/tests/unit/packaged-asar.test.ts`
- Modify: `desktop/tests/unit/api-mcp-capability-surface.test.ts`
- Modify: `AGENTS.md`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes: `desktop/app-capabilities/synapse-skill/skill-package/`.
- Produces: packaged app resource `resources/synapse-skill/`.
- Produces: long-term docs rule pointing to the new package path.

- [ ] **Step 1: Update package extraResources**

Modify `desktop/package.json`:

```json
"extraResources": [
  {
    "from": "app-capabilities/synapse-skill/skill-package",
    "to": "synapse-skill"
  },
  {
    "from": "resources/knowledge-base",
    "to": "knowledge-base"
  },
  {
    "from": "dist-database",
    "to": "database"
  }
]
```

- [ ] **Step 2: Update packaged asar tests**

Modify `desktop/tests/unit/packaged-asar.test.ts`.

Change `writeExtraResourceFixtures` to:

```ts
async function writeExtraResourceFixtures(resourcesPath: string) {
  await writeUnpackedFixture(resourcesPath, ["synapse-skill", "SKILL.md"], "# Synapse Skill\n")
  await writeUnpackedFixture(resourcesPath, ["synapse-skill", "database", "index.md"], "# Database\n")
  await writeUnpackedFixture(resourcesPath, ["knowledge-base", "synapse-knowledge-base-template", "CLAUDE.md"], "# Knowledge Base\n")
  await writeUnpackedFixture(resourcesPath, ["database", "mcp", "index.js"], "module.exports = {}\n")
}
```

Update expected missing resource messages in the same file if they mention `templates`.

- [ ] **Step 3: Update MCP surface path test**

Modify `desktop/tests/unit/api-mcp-capability-surface.test.ts` so any URL or path pointing at:

```ts
new URL("resources/templates/skills/synapse-skill/", repoRoot)
```

becomes:

```ts
new URL("app-capabilities/synapse-skill/skill-package/", repoRoot)
```

- [ ] **Step 4: Update AGENTS.md**

Replace the old long-term rule:

```md
Synapse MCP 的内置 Skill 已合并为单一模板 `desktop/resources/templates/skills/synapse-skill/`。
```

with:

```md
Synapse MCP 的系统 Skill 由独立系统应用 `Synapse Skill` 管理，包目录为 `desktop/app-capabilities/synapse-skill/skill-package/`。修改 Database、Drive、Workflow、Automation、Content、Model Price、Variable、Repository、Skill Repository 或 App 等 MCP 域能力时，必须同步更新该包目录下对应 `<domain>/index.md` 和必要的 `<domain>/api-reference.md`；不要再新增或维护 Resource Repository 内置 Skill 模板。
```

Replace references to “内置资源模板” for Synapse Skill with “系统 Skill 包”.

- [ ] **Step 5: Update release notes**

Append to `RELEASE_NOTES_PENDING.md`:

```md
- Synapse Skill 现在作为独立系统应用提供安装入口，不再混在资源仓库的内置资源列表中；资源仓库也移除了通用内置资源分类。
```

- [ ] **Step 6: Run full focused verification**

Run:

```bash
pnpm --filter @synapse/desktop test -- synapse-skill
pnpm --filter @synapse/desktop test -- desktop/electron/services/__tests__/content-service.test.ts desktop/electron/services/__tests__/content-download-service.test.ts desktop/src/modules/content
pnpm --filter @synapse/desktop test -- desktop/tests/unit/packaged-asar.test.ts desktop/tests/unit/api-mcp-capability-surface.test.ts
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:packaged-asar
```

Expected: all commands PASS.

- [ ] **Step 7: Inspect git diff for scope**

Run:

```bash
git diff --stat
git diff -- AGENTS.md RELEASE_NOTES_PENDING.md desktop/package.json desktop/app-capabilities/synapse-skill desktop/src/modules/apps desktop/electron/bootstrap desktop/electron/services desktop/src/lib/content-categories.ts
```

Expected: changes are limited to the Synapse Skill App, Resource Repository built-in removal, package resource checks, docs, and release notes.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md RELEASE_NOTES_PENDING.md desktop/package.json desktop/tests/unit desktop/app-capabilities/synapse-skill desktop/electron/bootstrap desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/src/types/bridge.ts desktop/src/modules/apps desktop/electron/services desktop/src/lib/content-categories.ts
git add -u desktop/resources/templates
git commit -m "feat: make synapse skill a system app"
```
