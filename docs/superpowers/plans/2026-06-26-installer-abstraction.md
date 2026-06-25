# Installer Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build launchable Skill and Rule installer apps, and route existing Skill/Rule install actions through reusable installer flows instead of editor dropdowns.

**Architecture:** Introduce installer source types and a shared editor install core that accepts normalized sources with `sourceIdentity`. Keep existing editor adapter behavior, backup/restore, variable substitution, and Rule forms intact by extracting rather than rewriting the current content install flow.

**Tech Stack:** Electron 41 main/preload IPC, React 19, TypeScript 6, shadcn/ui, Vitest.

---

## File Structure

Create these focused files:

- `desktop/src/types/installers.ts`: shared renderer/main-facing installer source and payload types.
- `desktop/electron/services/installer-source-identity.ts`: deterministic `sourceIdentity` helpers.
- `desktop/electron/services/editor-install-core.ts`: shared core extracted from `content-install-service`.
- `desktop/electron/services/installer-source-service.ts`: local Skill directory and inline Rule source preparation.
- `desktop/electron/modules/installers/ipc.ts`: IPC handlers for installer source preparation and install calls.
- `desktop/src/app-shell/installers.ts`: renderer bridge helpers.
- `desktop/src/modules/installers/shared/use-installer-flow.ts`: shared install flow state and actions.
- `desktop/src/modules/installers/shared/shared-installer-flow.tsx`: editor selection, target selection, variable dialogs, install footer.
- `desktop/src/modules/installers/skill/index.tsx`: standalone Skill Installer app.
- `desktop/src/modules/installers/skill/skill-installer-modal.tsx`: embedded Skill installer modal.
- `desktop/src/modules/installers/skill/app-definition.ts`: Skill Installer app registration.
- `desktop/src/modules/installers/skill/app-manifest.ts`: Skill Installer manifest.
- `desktop/src/modules/installers/rule/index.tsx`: standalone Rule Installer app.
- `desktop/src/modules/installers/rule/rule-installer-modal.tsx`: embedded Rule installer modal.
- `desktop/src/modules/installers/rule/app-definition.ts`: Rule Installer app registration.
- `desktop/src/modules/installers/rule/app-manifest.ts`: Rule Installer manifest.

Modify these existing files:

- `desktop/electron/services/content-install-service.ts`: delegate to `editor-install-core`.
- `desktop/electron/modules/content/ipc.ts`: keep existing content install IPC compatible.
- `desktop/electron/preload.ts`: expose installer bridge.
- `desktop/src/types/bridge.ts`: add installer bridge types.
- `desktop/electron/generated/ipc-channels.generated.ts`: regenerate after IPC change.
- `desktop/src/modules/apps/types.ts`: add `skill-installer` and `rule-installer` app ids and namespaces.
- `desktop/src/modules/apps/definitions.ts`: register app definitions.
- `desktop/src/modules/apps/registry.ts`: register app manifests.
- `desktop/src/modules/apps/components/system-app-content.tsx`: render the two new apps.
- `desktop/src/modules/content/hooks/use-content-download-actions.tsx`: replace editor dropdown install items with installer modals.
- `desktop/src/modules/content/components/content-action-split-button.tsx`: render single install button.
- `desktop/src/modules/content-store-install/content-store-install-window-page.tsx`: delegate ready install UI to installer flow.
- `desktop/src/modules/content-store-install/__tests__/content-store-install-window-page.test.tsx`: update expectations.
- `desktop/src/modules/content/__tests__/content-action-split-button.test.tsx`: update install button behavior.
- `desktop/src/modules/content/__tests__/content-install-dialog.test.tsx`: keep only compatibility coverage or move assertions to installer tests.
- `desktop/src/modules/apps/__tests__/registry.test.ts`: add app registration expectations.
- `RELEASE_NOTES_PENDING.md`: user-facing release note.

---

### Task 1: Add Installer Source Types and Deterministic Identities

**Files:**
- Create: `desktop/src/types/installers.ts`
- Create: `desktop/electron/services/installer-source-identity.ts`
- Test: `desktop/electron/services/__tests__/installer-source-identity.test.ts`

- [ ] **Step 1: Write failing identity tests**

Create `desktop/electron/services/__tests__/installer-source-identity.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  createInlineRuleSourceIdentity,
  createLocalSkillSourceIdentity,
} from "../installer-source-identity"

describe("installer-source-identity", () => {
  it("creates deterministic inline rule identities without exposing body text", () => {
    const first = createInlineRuleSourceIdentity("Release.Rule", "# Release\nUse checks.")
    const second = createInlineRuleSourceIdentity("release.rule", "# Release\nUse checks.")

    expect(first).toBe(second)
    expect(first).toMatch(/^inline-rule:[a-f0-9]{64}$/)
    expect(first).not.toContain("Release")
    expect(first).not.toContain("checks")
  })

  it("creates deterministic local skill identities without exposing the path", () => {
    const identity = createLocalSkillSourceIdentity("/Users/example/skills/demo")

    expect(identity).toMatch(/^local-skill:[a-f0-9]{64}$/)
    expect(identity).not.toContain("/Users/example")
    expect(identity).not.toContain("demo")
  })
})
```

- [ ] **Step 2: Run identity test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/installer-source-identity.test.ts
```

Expected: FAIL because `installer-source-identity.ts` does not exist.

- [ ] **Step 3: Add shared installer types**

Create `desktop/src/types/installers.ts`:

```ts
import type { SynapseContentType } from "./content"
import type {
  SynapseEditorId,
  SynapseEditorInstallFormValues,
  SynapseEditorInstallScope,
} from "./editor"

export type SynapseInstallerOrigin =
  | "repository"
  | "prepared"
  | "local-directory"
  | "inline"

export type SynapseInstallerKind = Extract<SynapseContentType, "skill" | "rule">

export type SynapseInstallerSourceBase = {
  kind: SynapseInstallerKind
  origin: SynapseInstallerOrigin
  sourceIdentity: string
  name: string
  title?: string
  description?: string
}

export type SynapseSkillInstallerSource = SynapseInstallerSourceBase & {
  kind: "skill"
  mainContent?: string
  preparedSourceId?: string
  repositoryContentId?: string
  localSourceId?: string
}

export type SynapseRuleInstallerSource = SynapseInstallerSourceBase & {
  kind: "rule"
  body?: string
  preparedSourceId?: string
  repositoryContentId?: string
  inlineSourceId?: string
}

export type SynapseInstallerSource =
  | SynapseSkillInstallerSource
  | SynapseRuleInstallerSource

export type SynapsePrepareLocalSkillSourcePayload = {
  sourceDirectoryPath: string
}

export type SynapsePrepareInlineRuleSourcePayload = {
  name: string
  body: string
}

export type SynapseInstallSourceToEditorPayload = {
  source: SynapseInstallerSource
  editorId: SynapseEditorId
  scope: SynapseEditorInstallScope
  projectPath?: string
  installFormValues?: SynapseEditorInstallFormValues
  overwriteConfirmed?: boolean
  replaceConfirmed?: boolean
  replacedSourceIdentity?: string
  variableSubstitutions?: Record<string, string>
}
```

- [ ] **Step 4: Add identity helpers**

Create `desktop/electron/services/installer-source-identity.ts`:

```ts
import { createHash } from "node:crypto"
import { normalizeContentNameInput } from "../../src/lib/content-name-input"

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function createLocalSkillSourceIdentity(realSourceDirectoryPath: string): string {
  return `local-skill:${sha256(realSourceDirectoryPath)}`
}

export function createInlineRuleSourceIdentity(name: string, body: string): string {
  const normalizedName = normalizeContentNameInput(name)
  return `inline-rule:${sha256(`${normalizedName}\0${body}`)}`
}
```

- [ ] **Step 5: Run identity test to verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/installer-source-identity.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/types/installers.ts desktop/electron/services/installer-source-identity.ts desktop/electron/services/__tests__/installer-source-identity.test.ts
git commit -m "feat(installer): add source identity types"
```

---

### Task 2: Extract Shared Editor Install Core

**Files:**
- Create: `desktop/electron/services/editor-install-core.ts`
- Modify: `desktop/electron/services/content-install-service.ts`
- Test: `desktop/electron/services/__tests__/content-install-service-security.test.ts`
- Test: `desktop/electron/services/__tests__/content-install-service-prepared-source.test.ts`

- [ ] **Step 1: Add regression test for source identity through existing service**

In `desktop/electron/services/__tests__/content-install-service-prepared-source.test.ts`, add an assertion to an existing Rule prepared-source install test that the editor strategy still receives the original content id as `payload.contentId`:

```ts
expect(mocks.prepareRuleFileContent).toHaveBeenCalledWith(expect.objectContaining({
  payload: expect.objectContaining({
    contentId: "rule-1",
    contentType: "rule",
  }),
  ruleBody: "# Store Rule\n",
}))
```

Use the existing prepared Rule test case so this remains a compatibility regression, not a new behavior test.

- [ ] **Step 2: Run compatibility tests before extraction**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/content-install-service-prepared-source.test.ts electron/services/__tests__/content-install-service-security.test.ts
```

Expected: PASS before extraction.

- [ ] **Step 3: Create `editor-install-core.ts` by moving install internals**

Create `desktop/electron/services/editor-install-core.ts` with the public API:

```ts
import type {
  SynapseContentInstallResult,
  SynapseInstallToEditorPayload,
  SynapseResolveEditorTargetPayload,
} from "../../src/types/editor"
import type { EditorWriteSecurityDeps } from "../runtime/security"
import { contentInstallService } from "./content-install-service"

export type EditorInstallCoreSourceProvider = {
  beginPreparedInstall(sourceId: string, contentId: string): Promise<void>
  endPreparedInstall(sourceId: string, contentId: string): Promise<void>
  markPreparedInstalled(sourceId: string, contentId: string): Promise<void>
  readPreparedRule(sourceId: string, contentId: string): Promise<string>
  readPreparedSkill(sourceId: string, contentId: string): Promise<import("../../src/types/content").SynapseContentDetail<"skill">>
  copyPreparedSkillAttachment(
    sourceId: string,
    contentId: string,
    originalName: string,
    targetPath: string,
  ): Promise<void>
}

export type EditorInstallCoreDeps = {
  preparedSourceProvider: EditorInstallCoreSourceProvider
  resolveEditorInstallTarget(payload: SynapseResolveEditorTargetPayload): Promise<import("../../src/types/editor").SynapseEditorResolvedTarget>
}

export class EditorInstallCore {
  constructor(private readonly deps: EditorInstallCoreDeps) {}

  async installToEditor(
    payload: SynapseInstallToEditorPayload,
    security?: EditorWriteSecurityDeps,
  ): Promise<SynapseContentInstallResult> {
    return contentInstallService.installToEditor(payload, security)
  }
}
```

This first pass intentionally delegates back to the current service. The next step moves logic out of `content-install-service` while preserving behavior.

- [ ] **Step 4: Move the body of `ContentInstallService.installToEditor` into `EditorInstallCore.installToEditor`**

Replace the delegating body from Step 3 with the current implementation body from `desktop/electron/services/content-install-service.ts`.

When moving code, keep these imports in `editor-install-core.ts`:

```ts
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { getContentTypeDefinition } from "../../src/config/content-types"
import type { SynapseContentDetail } from "../../src/types/content"
import type {
  SynapseContentInstallResult,
  SynapseInstallToEditorPayload,
} from "../../src/types/editor"
import { applyVariableSubstitutions } from "../../src/lib/variable-substitution"
import {
  editorInstallStrategyById,
} from "./definitions/generated/main-registry"
```

Move helper functions used only by install execution with it. Keep target-resolution helpers in `content-install-service.ts` until Task 3.

- [ ] **Step 5: Delegate `content-install-service` to the core**

In `desktop/electron/services/content-install-service.ts`, construct a core in `installToEditor`:

```ts
const core = new EditorInstallCore({
  preparedSourceProvider: this.preparedSourceProvider,
  resolveEditorInstallTarget: (nextPayload) => this.resolveEditorInstallTarget(nextPayload),
})
return core.installToEditor(payload, security)
```

Keep `resolveEditorInstallTarget` and `readEditorInstallFormValues` public methods unchanged.

- [ ] **Step 6: Run compatibility tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/content-install-service-prepared-source.test.ts electron/services/__tests__/content-install-service-security.test.ts electron/services/__tests__/content-install-service-path-security.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/editor-install-core.ts desktop/electron/services/content-install-service.ts desktop/electron/services/__tests__/content-install-service-prepared-source.test.ts
git commit -m "refactor(installer): extract editor install core"
```

---

### Task 3: Add Installer Source Service for Local Skill and Inline Rule

**Files:**
- Create: `desktop/electron/services/installer-source-service.ts`
- Test: `desktop/electron/services/__tests__/installer-source-service.test.ts`
- Modify: `desktop/electron/services/content-skill-source-service.ts`

- [ ] **Step 1: Write failing local Skill and inline Rule tests**

Create `desktop/electron/services/__tests__/installer-source-service.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { InstallerSourceService } from "../installer-source-service"

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "synapse-installer-source-"))
}

describe("InstallerSourceService", () => {
  it("prepares a local Skill source from a root SKILL.md", async () => {
    const root = await createTempDir()
    await mkdir(path.join(root, "references"))
    await writeFile(path.join(root, "SKILL.md"), [
      "---",
      "name: release-helper",
      "description: Release checks",
      "---",
      "",
      "# Release Helper",
      "",
    ].join("\n"), "utf8")
    await writeFile(path.join(root, "references", "notes.md"), "# Notes\n", "utf8")

    const service = new InstallerSourceService()
    const source = await service.prepareLocalSkillSource({ sourceDirectoryPath: root })

    expect(source.kind).toBe("skill")
    expect(source.origin).toBe("local-directory")
    expect(source.name).toBe("release-helper")
    expect(source.description).toBe("Release checks")
    expect(source.sourceIdentity).toMatch(/^local-skill:[a-f0-9]{64}$/)
    expect(source.localSourceId).toBeTruthy()
  })

  it("rejects local Skill directories without root SKILL.md", async () => {
    const root = await createTempDir()
    await writeFile(path.join(root, "README.md"), "# Readme only\n", "utf8")

    const service = new InstallerSourceService()

    await expect(service.prepareLocalSkillSource({ sourceDirectoryPath: root }))
      .rejects.toThrow("Skill 安装器需要根目录 SKILL.md。")
  })

  it("prepares an inline Rule source with normalized name", async () => {
    const service = new InstallerSourceService()
    const source = await service.prepareInlineRuleSource({
      name: "Team.Rule",
      body: "# Team Rule\nUse project conventions.",
    })

    expect(source.kind).toBe("rule")
    expect(source.origin).toBe("inline")
    expect(source.name).toBe("team.rule")
    expect(source.body).toBe("# Team Rule\nUse project conventions.")
    expect(source.sourceIdentity).toMatch(/^inline-rule:[a-f0-9]{64}$/)
    expect(source.inlineSourceId).toBeTruthy()
  })

  it("rejects invalid inline Rule names", async () => {
    const service = new InstallerSourceService()

    await expect(service.prepareInlineRuleSource({
      name: "Bad Name",
      body: "# Body",
    })).rejects.toThrow("只能使用小写字母、数字、连字符、点号；首尾必须是字母或数字。")
  })

  it("rejects empty inline Rule body", async () => {
    const service = new InstallerSourceService()

    await expect(service.prepareInlineRuleSource({
      name: "team.rule",
      body: "   ",
    })).rejects.toThrow("Rule 正文不能为空。")
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/installer-source-service.test.ts
```

Expected: FAIL because `installer-source-service.ts` does not exist.

- [ ] **Step 3: Export strict main file helper**

Modify `desktop/electron/services/content-skill-source-service.ts` to export a strict root-SKILL helper:

```ts
async function resolveRootSkillMainFile(dirPath: string): Promise<string | null> {
  return resolveTrustedSkillMainFile(dirPath, path.join(dirPath, "SKILL.md"))
}
```

Add it to the export list:

```ts
export {
  assertDirectoryExists,
  readSkillDraftFromDirectory,
  resolveRootSkillMainFile,
  resolveSkillMainFile,
  SYNAPSE_SKILL_ID_FILE,
  type ContentSkillSourceDraft,
  type ContentSkillSourceSecurityDeps,
}
```

- [ ] **Step 4: Implement installer source service**

Create `desktop/electron/services/installer-source-service.ts`:

```ts
import { randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import path from "node:path"
import type {
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
  SynapseRuleInstallerSource,
  SynapseSkillInstallerSource,
} from "../../src/types/installers"
import { normalizeContentNameInput, validateContentNameInput } from "../../src/lib/content-name-input"
import { normalizeSkillNameInput, validateSkillNameInput } from "../../src/lib/skill-name-input"
import { slugifySkillName } from "../../src/definitions/editor/shared-skill-frontmatter"
import {
  readSkillDraftFromDirectory,
  resolveRootSkillMainFile,
  type ContentSkillSourceDraft,
} from "./content-skill-source-service"
import {
  createInlineRuleSourceIdentity,
  createLocalSkillSourceIdentity,
} from "./installer-source-identity"

type StoredLocalSkillSource = {
  draft: ContentSkillSourceDraft
  source: SynapseSkillInstallerSource
}

type StoredInlineRuleSource = {
  source: SynapseRuleInstallerSource
}

export class InstallerSourceService {
  private readonly localSkills = new Map<string, StoredLocalSkillSource>()
  private readonly inlineRules = new Map<string, StoredInlineRuleSource>()

  async prepareLocalSkillSource(
    payload: SynapsePrepareLocalSkillSourcePayload,
  ): Promise<SynapseSkillInstallerSource> {
    const rootMainFile = await resolveRootSkillMainFile(payload.sourceDirectoryPath)
    if (!rootMainFile || path.basename(rootMainFile) !== "SKILL.md") {
      throw new Error("Skill 安装器需要根目录 SKILL.md。")
    }

    const draft = await readSkillDraftFromDirectory(payload.sourceDirectoryPath)
    const realSourceDirectoryPath = await realpath(draft.sourceDirectoryPath)
    const fallbackName = slugifySkillName(path.basename(realSourceDirectoryPath), "synapse-skill")
    const metadataName = normalizeSkillNameInput(draft.metadata.name ?? "")
    const name = validateSkillNameInput(metadataName) === null
      ? metadataName
      : fallbackName
    const nameError = validateSkillNameInput(name)
    if (nameError) {
      throw new Error(nameError)
    }

    const localSourceId = randomUUID()
    const source: SynapseSkillInstallerSource = {
      kind: "skill",
      origin: "local-directory",
      sourceIdentity: createLocalSkillSourceIdentity(realSourceDirectoryPath),
      localSourceId,
      name,
      title: draft.metadata.title?.trim() || name,
      description: draft.metadata.description?.trim() ?? "",
      mainContent: draft.content,
    }

    this.localSkills.set(localSourceId, { draft, source })
    return source
  }

  async prepareInlineRuleSource(
    payload: SynapsePrepareInlineRuleSourcePayload,
  ): Promise<SynapseRuleInstallerSource> {
    const name = normalizeContentNameInput(payload.name)
    const nameError = validateContentNameInput(name)
    if (nameError) {
      throw new Error(nameError)
    }

    const body = payload.body.trim()
    if (!body) {
      throw new Error("Rule 正文不能为空。")
    }

    const inlineSourceId = randomUUID()
    const source: SynapseRuleInstallerSource = {
      kind: "rule",
      origin: "inline",
      sourceIdentity: createInlineRuleSourceIdentity(name, body),
      inlineSourceId,
      name,
      title: name,
      description: "",
      body,
    }

    this.inlineRules.set(inlineSourceId, { source })
    return source
  }

  getLocalSkill(localSourceId: string): StoredLocalSkillSource {
    const stored = this.localSkills.get(localSourceId)
    if (!stored) {
      throw new Error("本地 Skill 安装源不可用。")
    }
    return stored
  }

  getInlineRule(inlineSourceId: string): StoredInlineRuleSource {
    const stored = this.inlineRules.get(inlineSourceId)
    if (!stored) {
      throw new Error("Rule 安装源不可用。")
    }
    return stored
  }
}

export const installerSourceService = new InstallerSourceService()
```

- [ ] **Step 5: Run source service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/installer-source-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run existing skill source tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/content-skill-source-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/installer-source-service.ts desktop/electron/services/content-skill-source-service.ts desktop/electron/services/__tests__/installer-source-service.test.ts
git commit -m "feat(installer): prepare local skill and inline rule sources"
```

---

### Task 4: Wire Installer IPC and Renderer Bridge

**Files:**
- Create: `desktop/electron/modules/installers/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/app-shell/installers.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Test: `desktop/electron/modules/installers/__tests__/ipc.test.ts`

- [ ] **Step 1: Write failing IPC tests**

Create `desktop/electron/modules/installers/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { installerIpcHandlers } from "../ipc"

describe("installer ipc", () => {
  it("prepares inline Rule sources through the service", async () => {
    const prepareInlineRuleSource = vi.fn(async () => ({
      kind: "rule" as const,
      origin: "inline" as const,
      sourceIdentity: "inline-rule:abc",
      inlineSourceId: "source-1",
      name: "team.rule",
      body: "# Rule",
    }))

    const handlers = installerIpcHandlers({
      installerSourceService: {
        prepareInlineRuleSource,
        prepareLocalSkillSource: vi.fn(),
      },
    })

    const result = await handlers.prepareInlineRuleSource.handler({} as never, {
      name: "team.rule",
      body: "# Rule",
    })

    expect(result.name).toBe("team.rule")
    expect(prepareInlineRuleSource).toHaveBeenCalledWith({
      name: "team.rule",
      body: "# Rule",
    })
  })
})
```

- [ ] **Step 2: Run IPC test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/installers/__tests__/ipc.test.ts
```

Expected: FAIL because installer IPC module does not exist.

- [ ] **Step 3: Implement installer IPC handlers**

Create `desktop/electron/modules/installers/ipc.ts`:

```ts
import { z } from "zod"
import type {
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
} from "../../../src/types/installers"
import { defineIpcHandlers } from "../../ipc/define-ipc-handlers"
import { installerSourceService as defaultInstallerSourceService } from "../../services/installer-source-service"

const prepareLocalSkillSourceSchema = z.object({
  sourceDirectoryPath: z.string().min(1),
}).strict()

const prepareInlineRuleSourceSchema = z.object({
  name: z.string(),
  body: z.string(),
}).strict()

type InstallerIpcDeps = {
  installerSourceService?: {
    prepareLocalSkillSource(payload: SynapsePrepareLocalSkillSourcePayload): Promise<unknown>
    prepareInlineRuleSource(payload: SynapsePrepareInlineRuleSourcePayload): Promise<unknown>
  }
}

export function installerIpcHandlers(deps: InstallerIpcDeps = {}) {
  const sourceService = deps.installerSourceService ?? defaultInstallerSourceService

  return defineIpcHandlers({
    prepareLocalSkillSource: {
      schema: prepareLocalSkillSourceSchema,
      handler: async (_ctx, payload) => sourceService.prepareLocalSkillSource(payload),
    },
    prepareInlineRuleSource: {
      schema: prepareInlineRuleSourceSchema,
      handler: async (_ctx, payload) => sourceService.prepareInlineRuleSource(payload),
    },
  })
}
```

- [ ] **Step 4: Register IPC module**

Find the existing IPC bootstrap registration pattern in `desktop/electron/modules/content/ipc.ts` and nearby module registration. Add `installerIpcHandlers()` to the same registry. The registered channel names must be:

```ts
{
  "prepareLocalSkillSource": "synapse:installers:prepare-local-skill-source",
  "prepareInlineRuleSource": "synapse:installers:prepare-inline-rule-source"
}
```

Then run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` includes the new installer channels.

- [ ] **Step 5: Add bridge types**

In `desktop/src/types/bridge.ts`, add installer bridge methods to the `window.synapse` type:

```ts
installers: {
  prepareLocalSkillSource(
    payload: SynapsePrepareLocalSkillSourcePayload,
  ): Promise<SynapseSkillInstallerSource>
  prepareInlineRuleSource(
    payload: SynapsePrepareInlineRuleSourcePayload,
  ): Promise<SynapseRuleInstallerSource>
}
```

Import the needed types from `./installers`.

- [ ] **Step 6: Expose bridge in preload**

In `desktop/electron/preload.ts`, expose:

```ts
installers: {
  prepareLocalSkillSource: invoke(IPC_CHANNELS.installers.prepareLocalSkillSource),
  prepareInlineRuleSource: invoke(IPC_CHANNELS.installers.prepareInlineRuleSource),
},
```

- [ ] **Step 7: Add renderer helper**

Create `desktop/src/app-shell/installers.ts`:

```ts
import type {
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
  SynapseRuleInstallerSource,
  SynapseSkillInstallerSource,
} from "@/types/installers"

function requireInstallersBridge() {
  const bridge = window.synapse?.installers
  if (!bridge) {
    throw new Error("当前页面没有加载 Synapse 安装器桥接。")
  }
  return bridge
}

export async function prepareLocalSkillSource(
  payload: SynapsePrepareLocalSkillSourcePayload,
): Promise<SynapseSkillInstallerSource> {
  return requireInstallersBridge().prepareLocalSkillSource(payload)
}

export async function prepareInlineRuleSource(
  payload: SynapsePrepareInlineRuleSourcePayload,
): Promise<SynapseRuleInstallerSource> {
  return requireInstallersBridge().prepareInlineRuleSource(payload)
}
```

- [ ] **Step 8: Run IPC and typecheck target**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/installers/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/modules/installers/ipc.ts desktop/electron/modules/installers/__tests__/ipc.test.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/src/app-shell/installers.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat(installer): expose source preparation ipc"
```

---

### Task 5: Build Shared Renderer Installer Flow

**Files:**
- Create: `desktop/src/modules/installers/shared/use-installer-flow.ts`
- Create: `desktop/src/modules/installers/shared/shared-installer-flow.tsx`
- Test: `desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx`
- Modify: `desktop/src/modules/content/components/content-install-dialog.tsx`

- [ ] **Step 1: Write failing shared flow test**

Create `desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { SynapseRuleInstallerSource } from "@/types/installers"
import type { SynapseEditorAdapterSummary } from "@/types/editor"
import { SharedInstallerFlow } from "../shared-installer-flow"

const editor: SynapseEditorAdapterSummary = {
  id: "codex" as SynapseEditorAdapterSummary["id"],
  label: "Codex",
  order: 1,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill", "prompt"],
}

const ruleSource: SynapseRuleInstallerSource = {
  kind: "rule",
  origin: "inline",
  sourceIdentity: "inline-rule:abc",
  inlineSourceId: "source-1",
  name: "team.rule",
  body: "# Rule",
}

describe("SharedInstallerFlow", () => {
  it("starts embedded sources at editor selection", async () => {
    const user = userEvent.setup()
    render(
      <SharedInstallerFlow
        mode="modal"
        source={ruleSource}
        editors={[editor]}
        projects={[]}
        onCancel={vi.fn()}
        onInstalled={vi.fn()}
      />,
    )

    expect(screen.getByText("选择编辑器")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Codex" }))
    expect(screen.getByText("目标位置")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run shared flow test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx
```

Expected: FAIL because shared flow files do not exist.

- [ ] **Step 3: Implement `use-installer-flow.ts`**

Create `desktop/src/modules/installers/shared/use-installer-flow.ts`:

```ts
import { useCallback, useMemo, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseInstallerSource } from "@/types/installers"
import type { SynapseEditorAdapterSummary } from "@/types/editor"

export type InstallerStep = "editor" | "target" | "success"

export function useInstallerFlow(source: SynapseInstallerSource) {
  const logger = useMemo(
    () => createRendererLogger(`installer.${source.kind}`),
    [source.kind],
  )
  const [step, setStep] = useState<InstallerStep>("editor")
  const [selectedEditor, setSelectedEditor] = useState<SynapseEditorAdapterSummary | null>(null)

  const selectEditor = useCallback((editor: SynapseEditorAdapterSummary) => {
    logger.info("Installer editor selected.", {
      editorId: editor.id,
      sourceKind: source.kind,
      sourceOrigin: source.origin,
    })
    setSelectedEditor(editor)
    setStep("target")
  }, [logger, source.kind, source.origin])

  const markInstalled = useCallback(() => {
    setStep("success")
  }, [])

  return {
    markInstalled,
    selectedEditor,
    selectEditor,
    setStep,
    step,
  }
}
```

- [ ] **Step 4: Implement initial `SharedInstallerFlow` shell**

Create `desktop/src/modules/installers/shared/shared-installer-flow.tsx`:

```tsx
import { CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseEditorAdapterSummary } from "@/types/editor"
import type { SynapseInstallerSource } from "@/types/installers"
import { EditorWriteTargetSelector } from "@/modules/content/components/editor-write-target-selector"
import { useInstallerFlow } from "./use-installer-flow"

type SharedInstallerFlowProps = {
  mode: "standalone" | "modal"
  source: SynapseInstallerSource
  editors: SynapseEditorAdapterSummary[]
  projects: SynapseProjectConfig[]
  onCancel: () => void
  onInstalled: () => Promise<void> | void
}

export function SharedInstallerFlow({
  mode,
  source,
  editors,
  projects,
  onCancel,
  onInstalled,
}: SharedInstallerFlowProps) {
  const flow = useInstallerFlow(source)

  if (flow.step === "success") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
          <CheckCircle2 />
        </div>
        <h2 className="text-sm font-medium text-foreground">已安装</h2>
        {mode === "standalone" ? (
          <Button variant="outline" onClick={onCancel}>继续安装</Button>
        ) : null}
      </div>
    )
  }

  if (flow.step === "editor") {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">选择编辑器</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {editors.map((editor) => (
            <Button
              key={editor.id}
              type="button"
              variant="outline"
              className="h-auto justify-start py-3 text-left"
              onClick={() => flow.selectEditor(editor)}
            >
              {editor.label}
            </Button>
          ))}
        </div>
      </div>
    )
  }

  if (!flow.selectedEditor) {
    return null
  }

  return (
    <div className="flex flex-col gap-5">
      <EditorWriteTargetSelector
        actionKind="install"
        contentType={source.kind}
        editor={flow.selectedEditor}
        loggerName={`installer.${source.kind}`}
        onSelectionChange={() => {}}
        open
        projects={projects}
        resolveTarget={async () => {
          throw new Error("Installer target resolution is wired in Task 6.")
        }}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
        <Button
          type="button"
          onClick={() => {
            void Promise.resolve(onInstalled()).then(flow.markInstalled)
          }}
        >
          安装
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run shared flow test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/installers/shared/use-installer-flow.ts desktop/src/modules/installers/shared/shared-installer-flow.tsx desktop/src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx
git commit -m "feat(installer): add shared renderer flow"
```

---

### Task 6: Implement Skill and Rule Installer Apps

**Files:**
- Create: `desktop/src/modules/installers/skill/index.tsx`
- Create: `desktop/src/modules/installers/skill/skill-installer-modal.tsx`
- Create: `desktop/src/modules/installers/skill/app-definition.ts`
- Create: `desktop/src/modules/installers/skill/app-manifest.ts`
- Create: `desktop/src/modules/installers/rule/index.tsx`
- Create: `desktop/src/modules/installers/rule/rule-installer-modal.tsx`
- Create: `desktop/src/modules/installers/rule/app-definition.ts`
- Create: `desktop/src/modules/installers/rule/app-manifest.ts`
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/definitions.ts`
- Modify: `desktop/src/modules/apps/registry.ts`
- Modify: `desktop/src/modules/apps/components/system-app-content.tsx`
- Test: `desktop/src/modules/apps/__tests__/registry.test.ts`

- [ ] **Step 1: Add failing registry expectations**

In `desktop/src/modules/apps/__tests__/registry.test.ts`, add:

```ts
expect(listSystemApps().map((app) => app.id)).toContain("skill-installer")
expect(listSystemApps().map((app) => app.id)).toContain("rule-installer")
expect(listLaunchableSystemApps().map((app) => app.id)).toContain("skill-installer")
expect(listLaunchableSystemApps().map((app) => app.id)).toContain("rule-installer")
expect(getSystemAppManifest("skill-installer")?.name).toBe("Skill 安装器")
expect(getSystemAppManifest("rule-installer")?.name).toBe("Rule 安装器")
```

- [ ] **Step 2: Run registry test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/registry.test.ts
```

Expected: FAIL because app ids are not registered.

- [ ] **Step 3: Add app ids and namespaces**

Modify `desktop/src/modules/apps/types.ts`:

```ts
export const SYSTEM_APP_IDS = [
  "agent",
  "workflow",
  "drive",
  "automation",
  "launcher",
  "settings",
  "resource-repository",
  "skill-installer",
  "rule-installer",
  "git",
  "database",
  "document-template",
  "quick-input",
  "terminal",
  "screenshot",
  "editor-scan",
  "usage-monitor",
  "model-price",
] as const
```

Add namespaces:

```ts
  | "skill_installer"
  | "rule_installer"
```

- [ ] **Step 4: Add app definitions and manifests**

Create `desktop/src/modules/installers/skill/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "@/modules/apps/types"

export const skillInstallerAppDefinition = {
  id: "skill-installer",
  namespace: "skill_installer",
  type: "system",
  name: "Skill 安装器",
  windowTitle: "Skill 安装器",
  dock: { pinnedByDefault: false, order: 220 },
  window: { openable: true },
  capabilities: { primaryMcpPrefix: "app_skill_installer" },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/src/modules/installers/rule/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "@/modules/apps/types"

export const ruleInstallerAppDefinition = {
  id: "rule-installer",
  namespace: "rule_installer",
  type: "system",
  name: "Rule 安装器",
  windowTitle: "Rule 安装器",
  dock: { pinnedByDefault: false, order: 221 },
  window: { openable: true },
  capabilities: { primaryMcpPrefix: "app_rule_installer" },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Use the resource repository icon for the first version to avoid adding assets:

```ts
import icon from "@/modules/resource-repository/assets/icon.png"
```

Create both `app-manifest.ts` files with the same pattern as resource repository manifests.

- [ ] **Step 5: Add standalone app shells**

Create `desktop/src/modules/installers/skill/index.tsx`:

```tsx
import { useState } from "react"
import { FolderOpen } from "lucide-react"
import { prepareLocalSkillSource } from "@/app-shell/installers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"
import { SharedInstallerFlow } from "@/modules/installers/shared/shared-installer-flow"
import { useAppConfig } from "@/app-shell/config"
import { useEditorAdaptersForContentType } from "@/modules/content/hooks/use-editor-adapters-for-content-type"
import type { SynapseSkillInstallerSource } from "@/types/installers"

export function SkillInstallerModule() {
  const { config } = useAppConfig()
  const [path, setPath] = useState("")
  const [source, setSource] = useState<SynapseSkillInstallerSource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const adapters = useEditorAdaptersForContentType({
    contentType: "skill",
    enabled: true,
    loggerName: "installer.skill.editors",
  })

  const chooseDirectory = async () => {
    const selected = await window.synapse?.repository.chooseDirectory()
    if (selected) setPath(selected)
  }

  const prepare = async () => {
    try {
      setError(null)
      setSource(await prepareLocalSkillSource({ sourceDirectoryPath: path }))
      await adapters.load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取 Skill 目录失败。")
    }
  }

  return (
    <SystemAppWindowShell>
      <main className="flex h-full min-h-0 bg-surface px-6 py-8">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
          {!source ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="skill-installer-path">Skill 目录</Label>
                <div className="flex gap-2">
                  <Input id="skill-installer-path" value={path} onChange={(event) => setPath(event.target.value)} />
                  <Button type="button" variant="outline" onClick={chooseDirectory}>
                    <FolderOpen data-icon="inline-start" />
                    浏览
                  </Button>
                </div>
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div className="flex justify-end">
                <Button type="button" disabled={!path.trim()} onClick={prepare}>下一步</Button>
              </div>
            </>
          ) : (
            <SharedInstallerFlow
              mode="standalone"
              source={source}
              editors={adapters.filteredAdapters}
              projects={config.global.projects}
              onCancel={() => setSource(null)}
              onInstalled={() => undefined}
            />
          )}
        </div>
      </main>
    </SystemAppWindowShell>
  )
}
```

Create `desktop/src/modules/installers/rule/index.tsx` with name and textarea inputs, calling `prepareInlineRuleSource`.

- [ ] **Step 6: Render apps in system app content**

Modify `desktop/src/modules/apps/components/system-app-content.tsx`:

```tsx
import { SkillInstallerModule } from "@/modules/installers/skill"
import { RuleInstallerModule } from "@/modules/installers/rule"
```

Add branches:

```tsx
if (appId === "skill-installer") {
  return <SkillInstallerModule />
}

if (appId === "rule-installer") {
  return <RuleInstallerModule />
}
```

- [ ] **Step 7: Register definitions and manifests**

Modify `desktop/src/modules/apps/definitions.ts` and `desktop/src/modules/apps/registry.ts` to include both installer apps after resource repository.

- [ ] **Step 8: Run registry and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/registry.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/modules/installers desktop/src/modules/apps/types.ts desktop/src/modules/apps/definitions.ts desktop/src/modules/apps/registry.ts desktop/src/modules/apps/components/system-app-content.tsx desktop/src/modules/apps/__tests__/registry.test.ts
git commit -m "feat(installer): add launchable installer apps"
```

---

### Task 7: Replace Resource Repository Install Dropdown with Installer Modals

**Files:**
- Modify: `desktop/src/modules/content/hooks/use-content-download-actions.tsx`
- Modify: `desktop/src/modules/content/components/content-action-split-button.tsx`
- Create: `desktop/src/modules/installers/skill/skill-installer-modal.tsx`
- Create: `desktop/src/modules/installers/rule/rule-installer-modal.tsx`
- Test: `desktop/src/modules/content/__tests__/content-action-split-button.test.tsx`

- [ ] **Step 1: Update failing content action test**

In `desktop/src/modules/content/__tests__/content-action-split-button.test.tsx`, replace editor dropdown expectation with:

```tsx
it("opens installer modal from the install button without listing editors", async () => {
  const user = userEvent.setup()
  render(<ContentActionSplitButton item={skillItem} />)

  await user.click(screen.getByRole("button", { name: /安装/ }))

  expect(screen.queryByText("Codex")).not.toBeInTheDocument()
  expect(screen.getByText("选择编辑器")).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content/__tests__/content-action-split-button.test.tsx
```

Expected: FAIL because current button opens an editor dropdown.

- [ ] **Step 3: Add installer modals**

Create `desktop/src/modules/installers/skill/skill-installer-modal.tsx`:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SharedInstallerFlow } from "@/modules/installers/shared/shared-installer-flow"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseEditorAdapterSummary } from "@/types/editor"
import type { SynapseSkillInstallerSource } from "@/types/installers"

type SkillInstallerModalProps = {
  open: boolean
  source: SynapseSkillInstallerSource | null
  editors: SynapseEditorAdapterSummary[]
  projects: SynapseProjectConfig[]
  onOpenChange: (open: boolean) => void
  onInstalled?: () => Promise<void> | void
}

export function SkillInstallerModal({
  open,
  source,
  editors,
  projects,
  onOpenChange,
  onInstalled,
}: SkillInstallerModalProps) {
  if (!source) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Skill 安装器</DialogTitle>
        </DialogHeader>
        <SharedInstallerFlow
          mode="modal"
          source={source}
          editors={editors}
          projects={projects}
          onCancel={() => onOpenChange(false)}
          onInstalled={async () => {
            await onInstalled?.()
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
```

Create `rule-installer-modal.tsx` with `Rule 安装器` and `SynapseRuleInstallerSource`.

- [ ] **Step 4: Map repository item to installer source**

In `desktop/src/modules/content/hooks/use-content-download-actions.tsx`, replace editor dropdown item generation for install with a single modal source builder:

```ts
const installerSource = useMemo(() => {
  if (item.type === "skill") {
    return {
      kind: "skill" as const,
      origin: "repository" as const,
      repositoryContentId: item.id,
      sourceIdentity: item.id,
      name: item.name ?? item.id,
      title: item.title,
      description: item.description,
    }
  }
  if (item.type === "rule") {
    return {
      kind: "rule" as const,
      origin: "repository" as const,
      repositoryContentId: item.id,
      sourceIdentity: item.id,
      name: item.name ?? item.id,
      title: item.title,
      description: item.description,
    }
  }
  return null
}, [item])
```

- [ ] **Step 5: Change install action to open modal**

Return one install action:

```ts
const installAction = canInstall
  ? {
      key: "install",
      label: "安装",
      disabled: isBusy,
      onSelect: () => {
        void loadInstallTargets()
        setIsInstallDialogOpen(true)
      },
    }
  : null
```

Remove `installMenuItems` from the public return type and return `installDialog` as either `SkillInstallerModal` or `RuleInstallerModal`.

- [ ] **Step 6: Simplify split button**

In `desktop/src/modules/content/components/content-action-split-button.tsx`, replace the install dropdown with:

```tsx
<Button
  variant="outline"
  size="sm"
  disabled={isBusy}
  onClick={() => {
    installAction?.onSelect?.()
  }}
>
  <PackagePlus data-icon="inline-start" />
  安装
</Button>
```

Keep the separate “more actions” dropdown for download/copy actions.

- [ ] **Step 7: Run content action tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content/__tests__/content-action-split-button.test.tsx src/modules/content/__tests__/content-install-dialog.test.tsx
```

Expected: PASS after updating tests for the new install modal behavior.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/modules/content/hooks/use-content-download-actions.tsx desktop/src/modules/content/components/content-action-split-button.tsx desktop/src/modules/installers/skill/skill-installer-modal.tsx desktop/src/modules/installers/rule/rule-installer-modal.tsx desktop/src/modules/content/__tests__/content-action-split-button.test.tsx desktop/src/modules/content/__tests__/content-install-dialog.test.tsx
git commit -m "feat(installer): route repository installs through installers"
```

---

### Task 8: Route Content Store Ready State Through Installer Flow

**Files:**
- Modify: `desktop/src/modules/content-store-install/content-store-install-window-page.tsx`
- Modify: `desktop/src/modules/content-store-install/__tests__/content-store-install-window-page.test.tsx`

- [ ] **Step 1: Update failing Content Store test**

In `desktop/src/modules/content-store-install/__tests__/content-store-install-window-page.test.tsx`, replace the expectation that clicking an editor opens `ContentInstallDialog` with:

```tsx
expect(screen.getByText("选择编辑器")).toBeInTheDocument()
expect(screen.getByRole("button", { name: "Codex" })).toBeInTheDocument()
```

Assert that completion is recorded after `onInstalled` from the installer flow.

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content-store-install/__tests__/content-store-install-window-page.test.tsx
```

Expected: FAIL because the page still owns editor selection and opens `ContentInstallDialog`.

- [ ] **Step 3: Convert prepared source to installer source**

In `desktop/src/modules/content-store-install/content-store-install-window-page.tsx`, replace `toContentMeta` install usage with:

```ts
const installerSource = useMemo(() => {
  if (!source) return null
  if (source.type === "skill") {
    return {
      kind: "skill" as const,
      origin: "prepared" as const,
      preparedSourceId: source.id,
      sourceIdentity: source.contentId,
      name: source.title,
      title: source.title,
      description: "",
      mainContent: source.mainContent,
    }
  }
  return {
    kind: "rule" as const,
    origin: "prepared" as const,
    preparedSourceId: source.id,
    sourceIdentity: source.contentId,
    name: source.title,
    title: source.title,
    description: "",
    body: source.mainContent,
  }
}, [source])
```

Normalize `name` with existing validation helpers before passing to the flow. If invalid, show the existing error state with the message returned by validation.

- [ ] **Step 4: Render shared installer flow**

Replace the ready-state editor grid and `ContentInstallDialog` with:

```tsx
{source && installerSource && state.status === "ready" ? (
  <SharedInstallerFlow
    mode="standalone"
    source={installerSource}
    editors={filteredAdapters}
    projects={config.global.projects}
    onCancel={() => undefined}
    onInstalled={handleInstalled}
  />
) : null}
```

Keep loading, unauthenticated, error, and completed states unchanged.

- [ ] **Step 5: Run Content Store tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/content-store-install/__tests__/content-store-install-window-page.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/content-store-install/content-store-install-window-page.tsx desktop/src/modules/content-store-install/__tests__/content-store-install-window-page.test.tsx
git commit -m "feat(installer): use installer flow for content store installs"
```

---

### Task 9: Connect Shared Flow to Main Install Core

**Files:**
- Modify: `desktop/electron/services/editor-install-core.ts`
- Modify: `desktop/electron/services/installer-source-service.ts`
- Modify: `desktop/electron/modules/installers/ipc.ts`
- Modify: `desktop/src/app-shell/installers.ts`
- Modify: `desktop/src/modules/installers/shared/shared-installer-flow.tsx`
- Test: `desktop/electron/services/__tests__/editor-install-core-installer-source.test.ts`

- [ ] **Step 1: Write failing core tests for inline Rule**

Create `desktop/electron/services/__tests__/editor-install-core-installer-source.test.ts` using the same mocks and temp-dir style from `content-install-service-security.test.ts`. The key assertion:

```ts
expect(mocks.prepareRuleFileContent).toHaveBeenCalledWith(expect.objectContaining({
  payload: expect.objectContaining({
    contentId: "inline-rule:abc",
    contentType: "rule",
    ruleName: "team.rule",
  }),
  ruleBody: "# Team Rule",
}))
```

- [ ] **Step 2: Run core installer-source test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-install-core-installer-source.test.ts
```

Expected: FAIL because installer source install API does not exist.

- [ ] **Step 3: Add install API to installer IPC**

Extend `desktop/electron/modules/installers/ipc.ts` with schema:

```ts
const installSourceToEditorSchema = z.object({
  source: z.record(z.string(), z.unknown()),
  editorId: z.string().min(1),
  scope: z.enum(["global", "project"]),
  projectPath: z.string().optional(),
  installFormValues: z.record(z.string(), z.unknown()).optional(),
  overwriteConfirmed: z.boolean().optional(),
  replaceConfirmed: z.boolean().optional(),
  replacedSourceIdentity: z.string().optional(),
  variableSubstitutions: z.record(z.string(), z.string()).optional(),
}).strict()
```

Add handler:

```ts
installSourceToEditor: {
  schema: installSourceToEditorSchema,
  handler: async (ctx, payload) => installerInstallService.installSourceToEditor(payload, ctx.security.editorWrite),
}
```

- [ ] **Step 4: Implement source-to-content payload conversion**

In `editor-install-core.ts`, add:

```ts
import type { SynapseInstallSourceToEditorPayload } from "../../src/types/installers"

function toInstallToEditorPayload(payload: SynapseInstallSourceToEditorPayload): SynapseInstallToEditorPayload {
  return {
    editorId: payload.editorId,
    scope: payload.scope,
    projectPath: payload.projectPath,
    contentType: payload.source.kind,
    contentId: payload.source.sourceIdentity,
    skillName: payload.source.kind === "skill" ? payload.source.name : undefined,
    skillTitle: payload.source.kind === "skill" ? payload.source.title : undefined,
    ruleName: payload.source.kind === "rule" ? payload.source.name : undefined,
    installFormValues: payload.installFormValues,
    overwriteConfirmed: payload.overwriteConfirmed,
    replaceConfirmed: payload.replaceConfirmed,
    replacedContentId: payload.replacedSourceIdentity,
    variableSubstitutions: payload.variableSubstitutions,
    preparedSourceId: payload.source.preparedSourceId,
  }
}
```

Add `installSourceToEditor()` that uses converted payload and source-aware readers for local Skill / inline Rule.

- [ ] **Step 5: Add renderer bridge method**

Extend `desktop/src/app-shell/installers.ts`:

```ts
export async function installSourceToEditor(
  payload: SynapseInstallSourceToEditorPayload,
): Promise<SynapseContentInstallResult> {
  return requireInstallersBridge().installSourceToEditor(payload)
}
```

Update `bridge.ts` and `preload.ts` accordingly.

- [ ] **Step 6: Wire SharedInstallerFlow install button**

In `shared-installer-flow.tsx`, replace the temporary `onInstalled()` install button body with:

```ts
const result = await installSourceToEditor({
  source,
  editorId: flow.selectedEditor.id,
  scope: selection.scope,
  projectPath: selection.scope === "project" ? selection.projectPath : undefined,
  variableSubstitutions: pendingSubstitutionsRef.current,
})
```

Reuse the current `ContentInstallDialog` confirmation sequence for:

- variable substitution
- variable save prompt
- Rule global/project forms
- Skill overwrite confirmation
- Skill conflict replacement

Move code from `ContentInstallDialog` into shared flow rather than keeping two divergent implementations.

- [ ] **Step 7: Run targeted tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/editor-install-core-installer-source.test.ts src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx src/modules/content/__tests__/content-install-dialog.test.tsx
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/editor-install-core.ts desktop/electron/services/installer-source-service.ts desktop/electron/modules/installers/ipc.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/src/app-shell/installers.ts desktop/src/modules/installers/shared/shared-installer-flow.tsx desktop/electron/services/__tests__/editor-install-core-installer-source.test.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat(installer): install normalized sources to editors"
```

---

### Task 10: Release Notes and Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a user-facing entry to `RELEASE_NOTES_PENDING.md`:

```md
- 资源仓库里的 Skill 和 Rule 安装入口改为统一安装器流程；点击安装后先选择编辑器，再选择全局或项目目标，同时新增可独立打开的 Skill 安装器和 Rule 安装器。
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/installer-source-identity.test.ts electron/services/__tests__/installer-source-service.test.ts electron/services/__tests__/editor-install-core-installer-source.test.ts electron/services/__tests__/content-install-service-prepared-source.test.ts electron/services/__tests__/content-install-service-security.test.ts src/modules/apps/__tests__/registry.test.ts src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx src/modules/content/__tests__/content-action-split-button.test.tsx src/modules/content-store-install/__tests__/content-store-install-window-page.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full desktop validation**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
```

Expected: both PASS.

- [ ] **Step 4: Check generated IPC and hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:ipc-codegen
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note installer workflow update"
```

---

## Self-Review Checklist

- Spec coverage:
  - Two launchable apps: Task 6.
  - Shared source model and identities: Task 1 and Task 3.
  - Main install core reuse: Task 2 and Task 9.
  - Local Skill directory behavior: Task 3.
  - Inline Rule behavior: Task 3 and Task 9.
  - Resource repository button change: Task 7.
  - Content Store delegation: Task 8.
  - Tests and release notes: Task 10.
- Placeholder scan: no open-ended implementation steps.
- Type consistency: all source types are defined in `desktop/src/types/installers.ts`; IPC, renderer bridge, and shared flow refer to those names.
