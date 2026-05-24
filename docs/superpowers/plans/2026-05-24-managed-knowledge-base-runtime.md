# Managed Knowledge Base Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert new Knowledge Base projects into Synapse-managed black-box projects initialized from an embedded `claude-obsidian` template, with no SDK runtime injection on the normal Agent path.

**Architecture:** Store managed Knowledge Base projects as normal Synapse projects with `capabilities.knowledgeBase.managed === true` and a virtual public `path`, while Electron resolves their real backing directory under `app.getPath("userData")/knowledge-bases/<projectId>`. Agent chat opens the project container with the real backing directory; renderer UI never asks for or displays a real path for managed knowledge bases.

**Tech Stack:** Electron main services, React renderer, TypeScript, pnpm scripts, Vitest, shadcn/Radix UI.

---

## Scope

This plan implements the first managed-runtime slice:

- Root `package.json` command for syncing the upstream template.
- Managed Knowledge Base project creation by name only.
- Hidden backing directory resolution in Electron main.
- Agent chat runs with `cwd` set to the managed backing directory.
- Source manager uses `projectId` and resolves the backing path in main.
- Knowledge Base quick UI remains available only for Knowledge Base projects.
- Old SDK plugin/skill/hook/agent injection is removed from the normal path.

This plan does not implement import/export, automatic migration of old visible vaults, or deletion of managed backing directories.

## Files And Responsibilities

- `package.json`: expose the developer command `kb:sync-template`.
- `scripts/sync-claude-obsidian-template.mjs`: sync `AgriciDaniel/claude-obsidian` into a committed resource template directory.
- `desktop/resources/knowledge-base/claude-obsidian-template/`: committed developer-synced template source used to initialize managed knowledge bases.
- `desktop/src/types/config.ts`: represent managed Knowledge Base capability without exposing a real backing path.
- `desktop/src/lib/config.ts`: sanitize and preserve the managed Knowledge Base capability.
- `desktop/src/types/knowledge-base.ts`: replace path-based create/source payloads with project-id-based managed payloads.
- `desktop/electron/services/knowledge-base/managed-path.ts`: resolve virtual public paths and real backing paths.
- `desktop/electron/services/knowledge-base/knowledge-base-service.ts`: create managed knowledge bases and route source operations by project id.
- `desktop/electron/modules/knowledge-base/ipc.ts`: expose managed Knowledge Base IPC without accepting renderer-provided backing paths.
- `desktop/electron/services/knowledge-base/source-manager-window-service.ts`: open source manager windows with project id/name only.
- `desktop/src/modules/knowledge-base/source-manager-window.tsx`: call source APIs by project id.
- `desktop/src/modules/settings/components/project-list-editor.tsx`: create Knowledge Base projects by name only and hide path editing for managed KB projects.
- `desktop/src/modules/agent/index.tsx`: preserve Knowledge Base quick UI while removing projectPath dependence.
- `desktop/electron/modules/agent/ipc-shared.ts`: resolve managed Knowledge Base projects to their backing paths before opening the Agent project container.
- `desktop/electron/services/agent-runtime/index.ts`: remove Knowledge Base SDK injection/contribution wiring.
- `desktop/electron/services/knowledge-base/agent-contribution.ts` and related old injection tests: delete or retire once no longer referenced.
- `docs/agent-guides/knowledge-base.md`: update stale visible-vault guidance to point at the managed runtime spec.

---

### Task 1: Add The Template Sync Command

**Files:**
- Modify: `package.json`
- Create: `scripts/sync-claude-obsidian-template.mjs`
- Create/Update: `desktop/resources/knowledge-base/claude-obsidian-template/SOURCE.json`
- Test: manual command verification

- [ ] **Step 1: Add the root package script**

Modify the `scripts` object in `package.json` to include:

```json
"kb:sync-template": "node scripts/sync-claude-obsidian-template.mjs"
```

Keep the existing script order grouped with other root utility commands:

```json
{
  "scripts": {
    "dev:website": "pnpm --filter @synapse/website run dev",
    "dev:desktop": "pnpm --filter @synapse/desktop run dev",
    "dev:server": "docker compose --env-file server/.env -f server/compose.yml up -d postgres && node scripts/run-with-server-env.mjs --filter @synapse/server run dev",
    "quit": "node scripts/quit.mjs",
    "quit:website": "node scripts/quit-processes.mjs dev:website",
    "quit:desktop": "node scripts/quit-processes.mjs dev:desktop",
    "quit:server": "node scripts/quit-processes.mjs dev:server && pnpm run quit:docker",
    "quit:docker": "APP_PUBLIC_URL=${APP_PUBLIC_URL:-http://localhost:3000} docker compose --env-file server/.env -f server/compose.yml down",
    "quit:processes": "node scripts/quit-processes.mjs",
    "kb:sync-template": "node scripts/sync-claude-obsidian-template.mjs",
    "desktop:bump:commit:push": "pnpm --filter @synapse/desktop run bump:commit:push",
    "auto": "pnpm --filter @synapse/auto run start"
  }
}
```

- [ ] **Step 2: Create the sync script**

Create `scripts/sync-claude-obsidian-template.mjs`:

```js
import { mkdtemp, rm, cp, mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const repoUrl = "https://github.com/AgriciDaniel/claude-obsidian.git"
const templateDir = path.resolve("desktop/resources/knowledge-base/claude-obsidian-template")
const keepFiles = new Set(["SOURCE.json"])

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`)
  }
}

function output(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

async function emptyTemplateDir() {
  await mkdir(templateDir, { recursive: true })
  if (!existsSync(templateDir)) return
  const entries = await import("node:fs/promises").then((fs) => fs.readdir(templateDir))
  await Promise.all(entries
    .filter((entry) => !keepFiles.has(entry))
    .map((entry) => rm(path.join(templateDir, entry), { recursive: true, force: true })))
}

async function preserveLicenseIfPresent(sourceDir) {
  for (const name of ["LICENSE", "LICENSE.md", "NOTICE", "NOTICE.md"]) {
    const sourcePath = path.join(sourceDir, name)
    if (existsSync(sourcePath)) {
      await cp(sourcePath, path.join(templateDir, name), { recursive: true, force: true })
    }
  }
}

async function main() {
  const tmp = await mkdtemp(path.join(tmpdir(), "synapse-claude-obsidian-"))
  try {
    run("git", ["clone", "--depth", "1", repoUrl, tmp])
    const commit = output("git", ["rev-parse", "HEAD"], { cwd: tmp })
    const syncedAt = new Date().toISOString().slice(0, 10)
    await emptyTemplateDir()
    await cp(tmp, templateDir, {
      recursive: true,
      force: true,
      filter: (source) => !source.includes(`${path.sep}.git${path.sep}`) && !source.endsWith(`${path.sep}.git`),
    })
    await preserveLicenseIfPresent(tmp)
    await writeFile(path.join(templateDir, "SOURCE.json"), `${JSON.stringify({
      repo: "https://github.com/AgriciDaniel/claude-obsidian",
      commit,
      syncedAt,
      notes: "Developer-only template source for managed Synapse knowledge bases.",
    }, null, 2)}\n`, "utf8")
    const source = await readFile(path.join(templateDir, "SOURCE.json"), "utf8")
    console.log(source)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 3: Run the sync command**

Run:

```bash
pnpm run kb:sync-template
```

Expected:

```text
> synapse-workspace@0.0.0 kb:sync-template
> node scripts/sync-claude-obsidian-template.mjs

{
  "repo": "https://github.com/AgriciDaniel/claude-obsidian",
  "commit": "<40-char sha>",
  "syncedAt": "2026-05-24",
  "notes": "Developer-only template source for managed Synapse knowledge bases."
}
```

- [ ] **Step 4: Verify template shape**

Run:

```bash
test -f desktop/resources/knowledge-base/claude-obsidian-template/SOURCE.json
test -d desktop/resources/knowledge-base/claude-obsidian-template/wiki
test -d desktop/resources/knowledge-base/claude-obsidian-template/.claude-plugin
```

Expected: command exits with code `0`.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/sync-claude-obsidian-template.mjs desktop/resources/knowledge-base/claude-obsidian-template
git commit -m "chore: sync managed knowledge base template"
```

---

### Task 2: Add Managed Knowledge Base Config Shape

**Files:**
- Modify: `desktop/src/types/config.ts`
- Modify: `desktop/src/lib/config.ts`
- Test: `desktop/src/lib/__tests__/config.test.ts`

- [ ] **Step 1: Write config normalization tests**

Add tests to `desktop/src/lib/__tests__/config.test.ts`:

```ts
it("preserves managed knowledge base capability metadata", () => {
  const config = sanitizeSynapseConfig({
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
  })

  expect(config.global.projects[0]).toEqual(expect.objectContaining({
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
  }))
})

it("drops invalid managed knowledge base runtime ids", () => {
  const config = sanitizeSynapseConfig({
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
            runtimeId: "",
          },
        },
      }],
    },
  })

  expect(config.global.projects[0]?.capabilities).toBeUndefined()
})
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/config.test.ts
```

Expected: fails because `managed` and `runtimeId` are not preserved.

- [ ] **Step 3: Update shared config types**

Modify `desktop/src/types/config.ts`:

```ts
export type SynapseKnowledgeBaseProjectCapability = {
  enabled: true
  schemaVersion: 1
  templateVersion: string
  managed?: true
  runtimeId?: string
}
```

Managed KB projects use:

```ts
{
  path: `synapse-kb://${projectId}`,
  capabilities: {
    knowledgeBase: {
      enabled: true,
      schemaVersion: 1,
      templateVersion,
      managed: true,
      runtimeId: projectId,
    },
  },
}
```

- [ ] **Step 4: Update config sanitizer**

Modify `normalizeKnowledgeBaseCapability` in `desktop/src/lib/config.ts`:

```ts
function normalizeKnowledgeBaseCapability(value: unknown): SynapseProjectConfig["capabilities"] {
  if (!isRecord(value)) {
    return undefined
  }

  const rawKnowledgeBase = value.knowledgeBase
  if (!isRecord(rawKnowledgeBase)) {
    return undefined
  }

  const templateVersion = asTrimmedString(rawKnowledgeBase.templateVersion)
  if (
    rawKnowledgeBase.enabled !== true
    || rawKnowledgeBase.schemaVersion !== 1
    || !templateVersion
  ) {
    return undefined
  }

  const runtimeId = asTrimmedString(rawKnowledgeBase.runtimeId)
  if (rawKnowledgeBase.managed === true) {
    if (!runtimeId) {
      return undefined
    }
    return {
      knowledgeBase: {
        enabled: true,
        schemaVersion: 1,
        templateVersion,
        managed: true,
        runtimeId,
      },
    }
  }

  return {
    knowledgeBase: {
      enabled: true,
      schemaVersion: 1,
      templateVersion,
    },
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/config.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/types/config.ts desktop/src/lib/config.ts desktop/src/lib/__tests__/config.test.ts
git commit -m "feat: model managed knowledge base projects"
```

---

### Task 3: Add Managed Path Resolution

**Files:**
- Create: `desktop/electron/services/knowledge-base/managed-path.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/managed-path.test.ts`

- [ ] **Step 1: Write path resolver tests**

Create `desktop/electron/services/knowledge-base/__tests__/managed-path.test.ts`:

```ts
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  knowledgeBaseVirtualPath,
  resolveManagedKnowledgeBasePath,
  isManagedKnowledgeBaseProject,
} from "../managed-path"
import type { SynapseProjectConfig } from "../../../../src/types/config"

describe("managed knowledge base paths", () => {
  it("builds a virtual public path", () => {
    expect(knowledgeBaseVirtualPath("kb-1")).toBe("synapse-kb://kb-1")
  })

  it("resolves a managed project to userData-backed runtime path", () => {
    const project: SynapseProjectConfig = {
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
    }
    expect(resolveManagedKnowledgeBasePath(project, "/UserData")).toBe(path.join("/UserData", "knowledge-bases", "kb-1"))
  })

  it("does not treat legacy knowledge bases as managed", () => {
    const project: SynapseProjectConfig = {
      id: "legacy",
      name: "Legacy",
      path: "/Users/example/kb",
      capabilities: {
        knowledgeBase: {
          enabled: true,
          schemaVersion: 1,
          templateVersion: "2026-05-21",
        },
      },
    }
    expect(isManagedKnowledgeBaseProject(project)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/managed-path.test.ts
```

Expected: fails because `managed-path.ts` does not exist.

- [ ] **Step 3: Implement managed path helper**

Create `desktop/electron/services/knowledge-base/managed-path.ts`:

```ts
import path from "node:path"
import { app } from "electron"
import type { SynapseProjectConfig } from "../../../src/types/config"

const RUNTIME_ID_PATTERN = /^[A-Za-z0-9_-]+$/

export function knowledgeBaseVirtualPath(runtimeId: string): string {
  return `synapse-kb://${runtimeId}`
}

export function isManagedKnowledgeBaseProject(project: SynapseProjectConfig | null | undefined): boolean {
  return project?.capabilities?.knowledgeBase?.enabled === true
    && project.capabilities.knowledgeBase.managed === true
    && typeof project.capabilities.knowledgeBase.runtimeId === "string"
    && RUNTIME_ID_PATTERN.test(project.capabilities.knowledgeBase.runtimeId)
}

export function resolveManagedKnowledgeBasePath(
  project: SynapseProjectConfig,
  userDataPath = app.getPath("userData"),
): string {
  const runtimeId = project.capabilities?.knowledgeBase?.runtimeId
  if (!runtimeId || !RUNTIME_ID_PATTERN.test(runtimeId)) {
    throw new Error("Invalid managed knowledge base runtime id.")
  }
  return path.join(userDataPath, "knowledge-bases", runtimeId)
}

export function resolveProjectWorkspacePath(project: SynapseProjectConfig, userDataPath = app.getPath("userData")): string {
  return isManagedKnowledgeBaseProject(project)
    ? resolveManagedKnowledgeBasePath(project, userDataPath)
    : project.path
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/managed-path.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/knowledge-base/managed-path.ts desktop/electron/services/knowledge-base/__tests__/managed-path.test.ts
git commit -m "feat: resolve managed knowledge base paths"
```

---

### Task 4: Create Managed Knowledge Bases From Template

**Files:**
- Modify: `desktop/src/types/knowledge-base.ts`
- Modify: `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`

- [ ] **Step 1: Add service tests for managed creation**

Add to `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`:

```ts
it("creates managed knowledge base runtime from template", async () => {
  const templateRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-template-"))
  await mkdir(path.join(templateRoot, "wiki"), { recursive: true })
  await mkdir(path.join(templateRoot, ".claude-plugin"), { recursive: true })
  await writeFile(path.join(templateRoot, "wiki", "index.md"), "# Index\n", "utf8")
  await writeFile(path.join(templateRoot, ".claude-plugin", "plugin.json"), "{\"name\":\"kb\"}\n", "utf8")
  await writeFile(path.join(templateRoot, "SOURCE.json"), JSON.stringify({
    repo: "https://github.com/AgriciDaniel/claude-obsidian",
    commit: "75d3b6feb77b96c6bb16599c4550cc9703553d87",
    syncedAt: "2026-05-24",
  }), "utf8")

  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-userdata-"))
  const service = new KnowledgeBaseService({ templateRoot, userDataPath })
  const result = await service.createManaged({ projectId: "kb-1", name: "Knowledge" })

  expect(result.projectId).toBe("kb-1")
  expect(result.projectPath).toBe("synapse-kb://kb-1")
  expect(result.runtimePath).toBe(path.join(userDataPath, "knowledge-bases", "kb-1"))
  await expect(readFile(path.join(result.runtimePath, "wiki", "index.md"), "utf8")).resolves.toBe("# Index\n")
  await expect(readFile(path.join(result.runtimePath, ".claude-plugin", "plugin.json"), "utf8")).resolves.toContain("kb")
})
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: fails because `createManaged` and `userDataPath` do not exist.

- [ ] **Step 3: Update Knowledge Base types**

Modify `desktop/src/types/knowledge-base.ts`:

```ts
export type SynapseKnowledgeBaseCreateManagedPayload = {
  projectId: string
  name: string
}

export type SynapseKnowledgeBaseCreateManagedResult = {
  projectId: string
  projectPath: string
  runtimePath: string
  templateVersion: string
  templateSource?: {
    repo?: string
    commit?: string
    syncedAt?: string
  }
}
```

Keep legacy `SynapseKnowledgeBaseInitializePayload` until old tests and old visible-vault code are deleted in later tasks.

- [ ] **Step 4: Implement directory copy helper**

In `desktop/electron/services/knowledge-base/knowledge-base-service.ts`, add:

```ts
async function copyDirectoryContents(sourceRoot: string, targetRoot: string): Promise<void> {
  await mkdir(targetRoot, { recursive: true })
  const entries = await readdir(sourceRoot, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name)
    const targetPath = path.join(targetRoot, entry.name)
    if (entry.isSymbolicLink()) {
      continue
    }
    if (entry.isDirectory()) {
      await copyDirectoryContents(sourcePath, targetPath)
      continue
    }
    if (entry.isFile()) {
      await mkdir(path.dirname(targetPath), { recursive: true })
      await copyFile(sourcePath, targetPath)
    }
  }
}
```

- [ ] **Step 5: Implement `createManaged`**

Update `KnowledgeBaseServiceDeps`:

```ts
type KnowledgeBaseServiceDeps = {
  templateRoot?: string
  userDataPath?: string
  now?: () => Date
  fileConversionService?: Pick<FileConversionService, "convert">
  fetchUrl?: FetchUrl
}
```

Update the class:

```ts
private readonly userDataPath: string

constructor(deps: KnowledgeBaseServiceDeps = {}) {
  this.templateRoot = deps.templateRoot ?? resolveTemplateRoot()
  this.userDataPath = deps.userDataPath ?? app.getPath("userData")
  this.now = deps.now ?? (() => new Date())
  this.fileConversionService = deps.fileConversionService ?? createDefaultFileConversionService()
  this.fetchUrl = deps.fetchUrl ?? createGuardedFetchUrl()
}
```

Add method:

```ts
async createManaged(payload: SynapseKnowledgeBaseCreateManagedPayload): Promise<SynapseKnowledgeBaseCreateManagedResult> {
  const project: SynapseProjectConfig = {
    id: payload.projectId,
    name: payload.name,
    path: knowledgeBaseVirtualPath(payload.projectId),
    capabilities: {
      knowledgeBase: {
        enabled: true,
        schemaVersion: 1,
        templateVersion: KNOWLEDGE_BASE_TEMPLATE_VERSION,
        managed: true,
        runtimeId: payload.projectId,
      },
    },
  }
  const runtimePath = resolveManagedKnowledgeBasePath(project, this.userDataPath)
  if (await pathExists(runtimePath)) {
    throw new Error("知识库已存在。")
  }
  await copyDirectoryContents(this.templateRoot, runtimePath)
  const source = await readTemplateSource(this.templateRoot)
  return {
    projectId: payload.projectId,
    projectPath: knowledgeBaseVirtualPath(payload.projectId),
    runtimePath,
    templateVersion: KNOWLEDGE_BASE_TEMPLATE_VERSION,
    ...(source ? { templateSource: source } : undefined),
  }
}
```

Add helper:

```ts
async function readTemplateSource(templateRoot: string): Promise<SynapseKnowledgeBaseCreateManagedResult["templateSource"] | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path.join(templateRoot, "SOURCE.json"), "utf8")) as Record<string, unknown>
    return {
      ...(typeof parsed.repo === "string" ? { repo: parsed.repo } : undefined),
      ...(typeof parsed.commit === "string" ? { commit: parsed.commit } : undefined),
      ...(typeof parsed.syncedAt === "string" ? { syncedAt: parsed.syncedAt } : undefined),
    }
  } catch {
    return undefined
  }
}
```

- [ ] **Step 6: Update default template root**

Change `resolveTemplateRoot()` to use the managed template first:

```ts
return path.join(app.getAppPath(), "resources", "knowledge-base", "claude-obsidian-template")
```

For packaged builds, use:

```ts
return path.join(resourcesPath, "knowledge-base", "claude-obsidian-template")
```

Keep `SYNAPSE_KB_TEMPLATE_ROOT` override.

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/types/knowledge-base.ts desktop/electron/services/knowledge-base/knowledge-base-service.ts desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
git commit -m "feat: create managed knowledge base runtime"
```

---

### Task 5: Expose Managed Creation Through IPC

**Files:**
- Modify: `desktop/electron/modules/knowledge-base/ipc.ts`
- Modify: `desktop/src/types/bridge.ts`
- Test: `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts` if present; otherwise use focused type/runtime tests in existing IPC test location.

- [ ] **Step 1: Add IPC schema**

In `desktop/electron/modules/knowledge-base/ipc.ts`, add:

```ts
const createManagedPayloadSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
})

const createManagedResultSchema = z.object({
  projectId: z.string(),
  projectPath: z.string(),
  runtimePath: z.string(),
  templateVersion: z.string(),
  templateSource: z.object({
    repo: z.string().optional(),
    commit: z.string().optional(),
    syncedAt: z.string().optional(),
  }).optional(),
})
```

- [ ] **Step 2: Add IPC method**

Add to `knowledgeBaseIpcModule.methods`:

```ts
createManaged: {
  kind: "invoke",
  channel: "synapse:knowledge-base:create-managed",
  request: createManagedPayloadSchema,
  response: createManagedResultSchema,
  handler: (ctx, request: { projectId: string; name: string }) => runGuardedKnowledgeBaseOperation({
    ctx,
    action: "fs.write",
    resource: `managed-knowledge-base:${request.projectId}`,
    source: "knowledgeBase.createManaged",
    run: () => service(ctx).createManaged(request),
  }),
},
```

- [ ] **Step 3: Update bridge types**

Modify `desktop/src/types/bridge.ts` under `knowledgeBase`:

```ts
createManaged(payload: SynapseKnowledgeBaseCreateManagedPayload): Promise<SynapseKnowledgeBaseCreateManagedResult>
```

Remove no existing bridge method in this task.

- [ ] **Step 4: Regenerate IPC channel metadata if required**

If the repository has a generation command for `desktop/electron/generated/ipc-channels.generated.ts`, run that command. If there is no command, update the generated channel map manually to include:

```ts
"createManaged": "synapse:knowledge-base:create-managed"
```

- [ ] **Step 5: Run focused checks**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass, or fail only in files scheduled for subsequent tasks because renderer still calls old methods.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/modules/knowledge-base/ipc.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat: expose managed knowledge base creation"
```

---

### Task 6: Update Settings Project UI For Name-Only Creation

**Files:**
- Modify: `desktop/src/modules/settings/components/project-list-editor.tsx`
- Modify: `desktop/src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx`

- [ ] **Step 1: Update tests for name-only creation**

Modify `desktop/src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx` to assert:

```ts
it("creates a managed knowledge base with name only", async () => {
  bridge.knowledgeBase.createManaged.mockResolvedValue({
    projectId: "kb-1",
    projectPath: "synapse-kb://kb-1",
    runtimePath: "/UserData/knowledge-bases/kb-1",
    templateVersion: "2026-05-24",
  })

  render(<ProjectListEditor projects={[]} onSave={onSave} />)

  await user.click(screen.getByRole("button", { name: "新建知识库" }))
  await user.type(screen.getByLabelText("知识库名称"), "公司知识库")
  await user.click(screen.getByRole("button", { name: "创建" }))

  expect(bridge.knowledgeBase.createManaged).toHaveBeenCalledWith({
    projectId: expect.any(String),
    name: "公司知识库",
  })
  expect(onSave).toHaveBeenCalledWith([expect.objectContaining({
    name: "公司知识库",
    path: expect.stringMatching(/^synapse-kb:\/\//),
    capabilities: {
      knowledgeBase: {
        enabled: true,
        schemaVersion: 1,
        templateVersion: "2026-05-24",
        managed: true,
        runtimeId: expect.any(String),
      },
    },
  })])
})
```

Add assertions that the new Knowledge Base dialog does not contain `项目路径` or `浏览`.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx
```

Expected: fails because UI still asks for path and calls `initialize`.

- [ ] **Step 3: Remove path state from Knowledge Base creation**

In `project-list-editor.tsx`, remove:

```ts
const [knowledgeBasePath, setKnowledgeBasePath] = useState("")
const handleChooseKnowledgeBasePath = async () => { ... }
```

Update reset:

```ts
const resetKnowledgeBaseForm = () => {
  setKnowledgeBaseName("")
  setKnowledgeBaseError(null)
}
```

- [ ] **Step 4: Implement managed create handler**

Replace `handleCreateKnowledgeBase` with:

```ts
const handleCreateKnowledgeBase = async () => {
  const name = knowledgeBaseName.trim()
  if (!name) {
    setKnowledgeBaseError("知识库名称不能为空。")
    return
  }
  if (!window.synapse?.knowledgeBase?.createManaged) {
    setKnowledgeBaseError("知识库服务不可用。")
    return
  }

  const projectId = crypto.randomUUID()
  setIsCreatingKnowledgeBase(true)
  setKnowledgeBaseError(null)
  try {
    const result = await window.synapse.knowledgeBase.createManaged({ projectId, name })
    await onSave([
      ...projects,
      {
        id: projectId,
        name,
        path: result.projectPath,
        capabilities: {
          knowledgeBase: {
            enabled: true,
            schemaVersion: 1,
            templateVersion: result.templateVersion,
            managed: true,
            runtimeId: projectId,
          },
        },
      },
    ])
    setIsKnowledgeBaseDialogOpen(false)
    resetKnowledgeBaseForm()
  } catch (error) {
    logger.error("Failed to create managed knowledge base project.", { error, projectId })
    setKnowledgeBaseError(error instanceof Error ? error.message : "创建失败。")
  } finally {
    setIsCreatingKnowledgeBase(false)
  }
}
```

- [ ] **Step 5: Remove old visible-vault project actions from first slice**

Remove these user-facing actions:

```tsx
<Button ...>打开知识库</Button>
<Button ...>设为知识库</Button>
```

Keep normal `添加项目`.

- [ ] **Step 6: Hide managed Knowledge Base paths**

In the project card, replace direct path rendering:

```tsx
{isKnowledgeBaseProject(project) ? null : (
  <p className="text-sm text-muted-foreground break-all">
    {project.path}
  </p>
)}
```

For managed KB edit dialog, allow name edit only:

```tsx
const editingKnowledgeBase = editingProject ? isKnowledgeBaseProject(editingProject) : false
```

Render the path field only when `!editingKnowledgeBase`.

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/modules/settings/components/project-list-editor.tsx desktop/src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx
git commit -m "feat: create knowledge bases as managed projects"
```

---

### Task 7: Resolve Managed Knowledge Base Path For Agent Chat Only

**Files:**
- Modify: `desktop/electron/modules/agent/ipc-shared.ts`
- Test: `desktop/electron/modules/agent/__tests__/ipc-shared.test.ts` if present; otherwise add focused test beside existing agent IPC tests.

- [ ] **Step 1: Write resolver test**

Add a test that builds a config with:

```ts
{
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
}
```

Assert the resolved Agent project has:

```ts
expect(project).toEqual({
  uuid: "kb-1",
  name: "Knowledge",
  localPath: path.join(userDataPath, "knowledge-bases", "kb-1"),
})
```

- [ ] **Step 2: Run the test and verify failure**

Run the focused agent IPC test file.

Expected: fails because `resolveAgentProjectConfig` returns the virtual path.

- [ ] **Step 3: Update agent project resolution**

In `desktop/electron/modules/agent/ipc-shared.ts`, import:

```ts
import { resolveProjectWorkspacePath } from "../../services/knowledge-base/managed-path"
```

Update `resolveAgentProjectConfig`:

```ts
return {
  uuid: project.id,
  name: project.name,
  localPath: resolveProjectWorkspacePath(project),
}
```

Do not change Scheduler, Workflow, automation ingress, or side-channel project resolution in this task. This keeps Knowledge Base runtime behavior limited to the explicit Agent chat path.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/agent
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/modules/agent/ipc-shared.ts desktop/electron/modules/agent/__tests__
git commit -m "feat: resolve managed knowledge base cwd for agent chat"
```

---

### Task 8: Switch Source Manager To Project Id

**Files:**
- Modify: `desktop/src/types/knowledge-base.ts`
- Modify: `desktop/electron/modules/knowledge-base/ipc.ts`
- Modify: `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
- Modify: `desktop/electron/services/knowledge-base/source-manager-window-service.ts`
- Modify: `desktop/src/modules/knowledge-base/source-manager-window.tsx`
- Modify: `desktop/src/modules/agent/index.tsx`
- Test: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`
- Test: `desktop/electron/services/__tests__/knowledge-base-source-manager-window-service.test.ts`

- [ ] **Step 1: Update source manager tests**

Change renderer source manager payload tests so the URL contains:

```text
?window=knowledge-source-manager&projectId=kb-1&projectName=Knowledge
```

and no `projectPath`.

Update bridge mocks:

```ts
listSources: vi.fn<(projectId: string) => Promise<SynapseKnowledgeBaseListSourcesResult>>()
uploadSources: vi.fn<(payload: { projectId: string; filePaths: string[] }) => Promise<SynapseKnowledgeBaseUploadSourcesResult>>()
addUrlSource: vi.fn<(payload: { projectId: string; url: string }) => Promise<SynapseKnowledgeBaseUploadSourcesResult>>()
selectAndUploadSources: vi.fn<(projectId: string) => Promise<SynapseKnowledgeBaseUploadSourcesResult>>()
```

Remove expectations for `openRawDirectory`.

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx electron/services/__tests__/knowledge-base-source-manager-window-service.test.ts
```

Expected: fails because implementation still requires `projectPath`.

- [ ] **Step 3: Update shared Knowledge Base source types**

In `desktop/src/types/knowledge-base.ts`:

```ts
export type SynapseKnowledgeBaseOpenSourceManagerPayload = {
  projectId: string
  projectName: string
}

export type SynapseKnowledgeBaseListSourcesResult = {
  projectId: string
  sources: SynapseKnowledgeBaseSourceEntry[]
}

export type SynapseKnowledgeBaseUploadSourcesPayload = {
  projectId: string
  filePaths: string[]
}

export type SynapseKnowledgeBaseAddUrlSourcePayload = {
  projectId: string
  url: string
}

export type SynapseKnowledgeBaseUploadSourcesResult = {
  projectId: string
  uploaded: SynapseKnowledgeBaseUploadedSource[]
  skipped: Array<{
    path: string
    reason: "not-file" | "read-error" | "conversion-error"
  }>
}
```

- [ ] **Step 4: Resolve project id to backing path in service**

Add dependency to `KnowledgeBaseService`:

```ts
loadConfig?: () => Promise<SynapseConfig>
```

Add helper:

```ts
private async resolveProjectPath(projectId: string): Promise<string> {
  const config = await this.loadConfig()
  const project = config.global.projects.find((item) => item.id === projectId)
  if (!project) {
    throw new Error("找不到知识库项目。")
  }
  if (!isManagedKnowledgeBaseProject(project)) {
    throw new Error("当前项目不是托管知识库。")
  }
  return resolveManagedKnowledgeBasePath(project, this.userDataPath)
}
```

Update `listSources`, `uploadSources`, and `addUrlSource` to accept project id, resolve backing path internally, and return `projectId`.

- [ ] **Step 5: Update IPC schemas and handlers**

Replace source operation schemas so renderer sends `projectId`, not `projectPath`:

```ts
request: z.object({ projectId: z.string().min(1) })
```

and:

```ts
run: () => service(ctx).listSources(request.projectId)
```

For upload:

```ts
run: () => service(ctx).uploadSources(request)
```

The IPC resource string should be:

```ts
resource: `managed-knowledge-base:${request.projectId}`
```

- [ ] **Step 6: Update source manager window payload**

In `source-manager-window-service.ts`, remove `projectPath` from query params and log metadata:

```ts
searchParams.set("projectId", payload.projectId)
searchParams.set("projectName", payload.projectName)
```

- [ ] **Step 7: Update renderer source manager**

In `source-manager-window.tsx`, parse only:

```ts
const projectId = params.get("projectId")
const projectName = params.get("projectName")
```

Call:

```ts
bridge.knowledgeBase.listSources(payload.projectId)
bridge.knowledgeBase.uploadSources({ projectId: payload.projectId, filePaths })
bridge.knowledgeBase.addUrlSource({ projectId: payload.projectId, url })
bridge.knowledgeBase.selectAndUploadSources(payload.projectId)
```

Remove the normal user-facing raw directory open action.

- [ ] **Step 8: Update Agent page source manager entry**

In `desktop/src/modules/agent/index.tsx`, change:

```ts
await requireSynapseBridge().knowledgeBase.openSourceManager({
  projectId: selectedProject.id,
  projectName: selectedProject.name,
})
```

Remove `projectPath: selectedProject.path` from the payload.

- [ ] **Step 9: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx electron/services/__tests__/knowledge-base-source-manager-window-service.test.ts
```

Expected: pass.

- [ ] **Step 10: Commit**

```bash
git add desktop/src/types/knowledge-base.ts desktop/electron/modules/knowledge-base/ipc.ts desktop/electron/services/knowledge-base/knowledge-base-service.ts desktop/electron/services/knowledge-base/source-manager-window-service.ts desktop/src/modules/knowledge-base/source-manager-window.tsx desktop/src/modules/agent/index.tsx desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx desktop/electron/services/__tests__/knowledge-base-source-manager-window-service.test.ts
git commit -m "feat: manage knowledge sources by project id"
```

---

### Task 9: Remove Knowledge Base SDK Runtime Injection

**Files:**
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Modify: `desktop/electron/services/agent-runtime/project-contributions.ts`
- Delete: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Delete/Update: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
- Update: `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`
- Update: `desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts`

- [ ] **Step 1: Add regression test that managed KB sessions get no SDK plugins**

In `desktop/electron/services/agent-runtime/__tests__/index.test.ts`, add or update a test:

```ts
it("does not inject SDK plugins for managed knowledge base projects", async () => {
  const createSession = vi.fn(() => fakeLiveSession())
  const service = createRuntimeForProject({
    projectId: "kb-1",
    workDir: "/UserData/knowledge-bases/kb-1",
    createSession,
  })

  await service.sendMessage({
    projectId: "kb-1",
    sessionKey: "main",
    messageId: "m1",
    userId: "u1",
    userName: "User",
    content: "查询知识库",
    platform: "local",
  })

  expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
    cwd: "/UserData/knowledge-bases/kb-1",
    plugins: [],
    agents: {},
    subagentToolPolicies: {},
  }))
})
```

Use the existing helper names in the file. If helpers differ, keep the assertion shape exactly the same.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/index.test.ts
```

Expected: fails while project contributions still inject KB plugins/agents.

- [ ] **Step 3: Remove Knowledge Base imports and contribution resolver**

In `desktop/electron/services/agent-runtime/index.ts`, remove imports:

```ts
import { evaluateKnowledgeBaseWorkerToolPolicy } from "../knowledge-base/ingest-worker-policy"
import { KnowledgeBaseWorkerSessionRunner } from "../knowledge-base/ingest-worker-session-runner"
import { KnowledgeBaseParallelIngestRunner } from "../knowledge-base/parallel-ingest-runner"
import { createKnowledgeBaseAgentContribution } from "../knowledge-base/agent-contribution"
import { KnowledgeBaseIngestTurnStore, type KnowledgeBaseIngestTurnStoreEntry } from "../knowledge-base/ingest-turn-store"
```

Remove `createCachedAgentProjectContributionResolver`, `resolveAgentProjectContribution`, and `createKnowledgeBaseParallelIngestRunner`.

In `createAgentRuntimeProjectService`, replace dynamic contribution dependencies with empty defaults:

```ts
registeredPromptCommands: async () => [],
publishedProjectCommands: async () => [],
sdkPlugins: async () => [],
sdkAgents: async () => ({}),
sdkSubagentToolPolicies: async () => ({}),
```

Remove `prepareMessage` and `afterTurn` if they only delegate to the removed contribution.

- [ ] **Step 4: Remove unused project contribution SDK injection types if unused**

If `AgentProjectContribution` is no longer used anywhere after Step 3, delete `project-contributions.ts` and remove exports from `agent-runtime/index.ts`.

If non-KB code still imports it, keep the file but remove only KB-specific call sites.

- [ ] **Step 5: Delete KB contribution test file**

Delete:

```text
desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

This test asserts the old design and should not be rewritten.

- [ ] **Step 6: Update Claude SDK/session tests**

In `claude-sdk-session.test.ts` and `session-manager.test.ts`, remove expectations that KB plugin path or `synapse-kb-ingest-worker` agent definitions are injected by Synapse.

Keep tests that verify generic SDK options still pass through when explicitly provided by non-KB code.

- [ ] **Step 7: Run agent-runtime tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/agent-runtime desktop/electron/services/knowledge-base/agent-contribution.ts
git rm desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts desktop/electron/services/knowledge-base/agent-contribution.ts
git commit -m "refactor: remove knowledge base sdk injection"
```

---

### Task 10: Delete Old Synapse-Owned Upstream Reimplementation Code

**Files:**
- Candidate delete: `desktop/electron/services/knowledge-base/ingest-coordinator.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/ingest-finalizer.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/ingest-report.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/ingest-task-planner.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/ingest-turn-store.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/ingest-worker-agent.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/ingest-worker-policy.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/ingest-worker-report.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/ingest-worker-session-runner.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/manifest-finalizer.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/parallel-ingest-runner.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/research-coordinator.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/research-preflight.ts`
- Candidate delete: `desktop/electron/services/knowledge-base/research-report.ts`
- Candidate delete/update tests with matching names under `desktop/electron/services/knowledge-base/__tests__/`
- Keep: `source-scan.ts`, `source-staging.ts`, `manifest.ts`, `wiki-snapshot.ts`, `hot-cache-state.ts`, file conversion integration, source manager services.

- [ ] **Step 1: Confirm no remaining imports**

Run:

```bash
rg -n "ingest-coordinator|ingest-finalizer|ingest-report|ingest-task-planner|ingest-turn-store|ingest-worker|manifest-finalizer|parallel-ingest|research-coordinator|research-preflight|research-report" desktop/electron desktop/src
```

Expected: references are tests, barrel exports, or files scheduled for deletion.

- [ ] **Step 2: Remove exports from the KB barrel**

In `desktop/electron/services/knowledge-base/index.ts`, remove exports for deleted files. Keep exports for:

```ts
export { KnowledgeBaseService, KNOWLEDGE_BASE_TEMPLATE_VERSION } from "./knowledge-base-service"
export { scanKnowledgeBaseSources } from "./source-scan"
export { stageKnowledgeBaseSources, stageKnowledgeBaseUrlSource } from "./source-staging"
```

Add or keep exports for managed path helpers if needed:

```ts
export {
  isManagedKnowledgeBaseProject,
  knowledgeBaseVirtualPath,
  resolveManagedKnowledgeBasePath,
  resolveProjectWorkspacePath,
} from "./managed-path"
```

- [ ] **Step 3: Delete old implementation and test files**

Run:

```bash
git rm desktop/electron/services/knowledge-base/ingest-coordinator.ts \
  desktop/electron/services/knowledge-base/ingest-finalizer.ts \
  desktop/electron/services/knowledge-base/ingest-report.ts \
  desktop/electron/services/knowledge-base/ingest-task-planner.ts \
  desktop/electron/services/knowledge-base/ingest-turn-store.ts \
  desktop/electron/services/knowledge-base/ingest-worker-agent.ts \
  desktop/electron/services/knowledge-base/ingest-worker-policy.ts \
  desktop/electron/services/knowledge-base/ingest-worker-report.ts \
  desktop/electron/services/knowledge-base/ingest-worker-session-runner.ts \
  desktop/electron/services/knowledge-base/manifest-finalizer.ts \
  desktop/electron/services/knowledge-base/parallel-ingest-runner.ts \
  desktop/electron/services/knowledge-base/research-coordinator.ts \
  desktop/electron/services/knowledge-base/research-preflight.ts \
  desktop/electron/services/knowledge-base/research-report.ts
```

Also remove the matching tests:

```bash
git rm desktop/electron/services/knowledge-base/__tests__/agent-ingest-e2e.test.ts \
  desktop/electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts \
  desktop/electron/services/knowledge-base/__tests__/ingest-coordinator-image.test.ts \
  desktop/electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts \
  desktop/electron/services/knowledge-base/__tests__/ingest-report.test.ts \
  desktop/electron/services/knowledge-base/__tests__/ingest-task-planner.test.ts \
  desktop/electron/services/knowledge-base/__tests__/ingest-turn-store.test.ts \
  desktop/electron/services/knowledge-base/__tests__/ingest-worker-policy.test.ts \
  desktop/electron/services/knowledge-base/__tests__/ingest-worker-report.test.ts \
  desktop/electron/services/knowledge-base/__tests__/ingest-worker-session-runner.test.ts \
  desktop/electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts \
  desktop/electron/services/knowledge-base/__tests__/parallel-ingest-runner.test.ts \
  desktop/electron/services/knowledge-base/__tests__/research-coordinator.test.ts \
  desktop/electron/services/knowledge-base/__tests__/research-preflight.test.ts \
  desktop/electron/services/knowledge-base/__tests__/research-report.test.ts
```

- [ ] **Step 4: Run import scan**

Run:

```bash
rg -n "from \"\\.\\/(ingest-coordinator|ingest-finalizer|ingest-report|ingest-task-planner|ingest-turn-store|ingest-worker|manifest-finalizer|parallel-ingest-runner|research-coordinator|research-preflight|research-report)\"" desktop/electron
```

Expected: no output.

- [ ] **Step 5: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base
```

Expected: pass for remaining Knowledge Base tests.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/knowledge-base
git commit -m "refactor: remove old knowledge base ingest runtime"
```

---

### Task 11: Preserve Knowledge Base Quick UI Without Runtime Contributions

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`
- Modify: `desktop/src/modules/agent/slash-menu.ts`
- Test: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`
- Test: `desktop/src/modules/agent/__tests__/slash-menu.test.ts`

- [ ] **Step 1: Add renderer quick action tests**

In `agent-composer.test.tsx`, keep tests asserting that a Knowledge Base action trigger appears when `knowledgeBaseActions` are provided.

In `slash-menu.test.ts`, add:

```ts
it("can show static knowledge base commands without runtime project contribution", () => {
  const commands = knowledgeBaseStaticCommands()
  expect(commands.map((command) => command.name)).toEqual([
    "wiki query",
    "wiki ingest",
    "wiki save",
    "wiki lint",
    "wiki research",
    "wiki status",
  ])
})
```

- [ ] **Step 2: Implement static command list**

In `desktop/src/modules/agent/index.tsx`, add:

```ts
const KNOWLEDGE_BASE_STATIC_COMMANDS: SynapseAgentPublishedCommand[] = [
  {
    name: "wiki query",
    description: "查询知识库",
    source: "project",
    kind: "prompt",
    ui: { group: "knowledge-base", label: "查询知识库", insertText: "/wiki query " },
  },
  {
    name: "wiki ingest",
    description: "汲取资料",
    source: "project",
    kind: "prompt",
    ui: { group: "knowledge-base", label: "汲取资料", insertText: "/wiki ingest" },
  },
  {
    name: "wiki save",
    description: "保存对话",
    source: "project",
    kind: "prompt",
    ui: { group: "knowledge-base", label: "保存对话", insertText: "/save " },
  },
  {
    name: "wiki lint",
    description: "检查知识库",
    source: "project",
    kind: "prompt",
    ui: { group: "knowledge-base", label: "检查知识库", insertText: "/wiki lint" },
  },
  {
    name: "wiki research",
    description: "研究入库",
    source: "project",
    kind: "prompt",
    ui: { group: "knowledge-base", label: "研究入库", insertText: "/autoresearch " },
  },
  {
    name: "wiki status",
    description: "查看状态",
    source: "project",
    kind: "prompt",
    ui: { group: "knowledge-base", label: "查看状态", insertText: "/wiki status" },
  },
]
```

Then compute:

```ts
const runtimeCommands = chat.commands ?? []
const effectiveCommands = canManageKnowledgeSources
  ? [...runtimeCommands, ...KNOWLEDGE_BASE_STATIC_COMMANDS]
  : runtimeCommands
```

Use `effectiveCommands` for slash menu candidates and Knowledge Base action menu generation.

- [ ] **Step 3: Ensure ordinary projects do not show KB actions**

Keep:

```ts
const canManageKnowledgeSources = selectedProject?.capabilities?.knowledgeBase?.enabled === true
```

Do not show static commands when false.

- [ ] **Step 4: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx src/modules/agent/__tests__/slash-menu.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/index.tsx desktop/src/modules/agent/slash-menu.ts desktop/src/modules/agent/__tests__/agent-composer.test.tsx desktop/src/modules/agent/__tests__/slash-menu.test.ts
git commit -m "feat: keep knowledge base quick actions in renderer"
```

---

### Task 12: Update Documentation And Hard-Constraint Drift

**Files:**
- Modify: `docs/agent-guides/knowledge-base.md`
- Modify: `AGENTS.md`
- Optional Modify: `docs/superpowers/specs/2026-05-21-knowledge-base-project-capability-design.md`

- [ ] **Step 1: Update module guide**

Replace the opening statement in `docs/agent-guides/knowledge-base.md` with:

```md
The Knowledge Base feature now uses managed Synapse runtime directories for new knowledge bases. A knowledge base remains a project for Agent conversation routing, but users create it by name only and do not choose or see the backing directory. The backing runtime is initialized from the internal `claude-obsidian` template and may contain Agent plugin, skill, command, hook, prompt, and script files because it is not a user-owned vault.
```

Add:

```md
For the current source of truth, read `docs/superpowers/specs/2026-05-24-managed-knowledge-base-runtime-design.md`.
```

- [ ] **Step 2: Update hard-rule summary**

In `AGENTS.md`, update the Knowledge Base bullet that currently says user project directories must contain only data assets. Replace it with:

```md
- New Knowledge Base projects are Synapse-managed black-box projects. The visible project record must not expose the real backing directory; the backing directory lives under app-managed storage and may contain the full internal `claude-obsidian` runtime template. Exported user vaults, when implemented, should be clean data-oriented vaults unless the user explicitly asks for a full developer runtime export.
```

Keep the isolation rule:

```md
- Knowledge Base 专用 Agent 能力必须隔离在知识库模块或知识库专属资源目录内...
```

but adjust it to say the managed backing runtime is allowed.

- [ ] **Step 3: Mark old visible-vault spec superseded**

At the top of `docs/superpowers/specs/2026-05-21-knowledge-base-project-capability-design.md`, add:

```md
> Superseded for new knowledge bases by `2026-05-24-managed-knowledge-base-runtime-design.md`. This document only describes the earlier visible-vault direction.
```

- [ ] **Step 4: Run doc sanity search**

Run:

```bash
rg -n "user-selected|selects folder|visible vault|Do not write runnable Agent|SDK runtime injection|user knowledge-base folder" AGENTS.md docs/agent-guides docs/superpowers/specs
```

Expected: any remaining matches are explicitly framed as superseded or legacy.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/agent-guides/knowledge-base.md docs/superpowers/specs/2026-05-21-knowledge-base-project-capability-design.md
git commit -m "docs: update knowledge base managed runtime guidance"
```

---

### Task 13: Final Verification

**Files:**
- No source files unless fixes are required by failed checks.

- [ ] **Step 1: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: pass.

- [ ] **Step 2: Run focused desktop tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/lib/__tests__/config.test.ts \
  src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx \
  src/modules/knowledge-base/__tests__/source-manager-window.test.tsx \
  src/modules/agent/__tests__/agent-composer.test.tsx \
  src/modules/agent/__tests__/slash-menu.test.ts \
  electron/services/knowledge-base \
  electron/services/agent-runtime
```

Expected: pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass.

- [ ] **Step 4: Run import scan for removed SDK injection**

Run:

```bash
rg -n "createKnowledgeBaseAgentContribution|claude-plugin|sdkPlugins.*knowledge|synapse-kb-ingest-worker|KnowledgeBaseParallelIngestRunner|KnowledgeBaseWorkerSessionRunner" desktop/electron desktop/src
```

Expected: no matches in runtime code. Matches under committed template files are acceptable.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only intentional changes remain. Existing unrelated dirty files from before the task should not be reverted.

---

## Self-Review

- Spec coverage: the plan covers package command template sync, managed project creation, hidden backing path resolution, Agent chat cwd routing, source manager project-id routing, removal of SDK runtime injection, retention of quick UI, and documentation updates.
- Scope control: import/export and old visible-vault migration are intentionally excluded from this first slice.
- Type consistency: managed Knowledge Base config uses `managed: true`, `runtimeId`, and `synapse-kb://<runtimeId>` across config, service, renderer, and tests.
- Isolation: only Agent chat IPC resolves managed Knowledge Base projects to real backing paths; Scheduler, Workflow, automation, and ordinary projects are not changed to load Knowledge Base runtime behavior.
