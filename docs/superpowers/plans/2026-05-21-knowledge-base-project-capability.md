# Knowledge Base Project Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Knowledge Base capability to Synapse projects so users can create/open an Obsidian-compatible local vault while Synapse keeps advanced ingest/query/save/lint behavior internal.

**Architecture:** A knowledge base is a project capability, not a repository and not a new chat system. Project config stores the capability flag, an Electron service initializes/repairs the vault folder, renderer UI exposes project actions, and Agent runtime receives project-scoped contributions only when the active project has the knowledge base capability.

**Tech Stack:** Electron IpcModule, React, TypeScript, shadcn/ui, Node `fs/promises`, existing Synapse config store, existing Agent command router.

---

## File Structure

- Modify `desktop/src/types/config.ts`: add `SynapseProjectCapabilities` and optional `capabilities` on `SynapseProjectConfig`.
- Modify `desktop/src/lib/config.ts`: normalize and preserve project capabilities.
- Modify `desktop/src/lib/__tests__/config.test.ts`: cover knowledge base capability normalization.
- Create `desktop/src/types/knowledge-base.ts`: shared renderer/main payload and result types.
- Create `desktop/electron/services/knowledge-base/knowledge-base-service.ts`: inspect, initialize, repair, and open `.raw`.
- Create `desktop/electron/services/knowledge-base/index.ts`: export the service and constants.
- Create template files under `desktop/resources/knowledge-base/templates/`.
- Create prompt files under `desktop/resources/knowledge-base/prompts/`.
- Create `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`: service tests.
- Create `desktop/electron/modules/knowledge-base/ipc.ts`: IpcModule wrapping the service.
- Create `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`: IPC schema and handler tests.
- Modify `desktop/package.json`: package knowledge base resources into the Electron app.
- Modify `desktop/electron/bootstrap/ipc-registry.ts`: register the knowledge base IPC module.
- Modify `desktop/electron/preload.ts`: expose `window.synapse.knowledgeBase`.
- Modify `desktop/src/types/bridge.ts`: type the new bridge namespace.
- Modify `desktop/src/modules/settings/components/project-list-editor.tsx`: add knowledge base badge/actions and dialogs.
- Create or update `desktop/src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx`: renderer interaction tests.
- Create `desktop/electron/services/agent-runtime/project-contributions.ts`: generic contribution types.
- Create `desktop/electron/services/knowledge-base/agent-contribution.ts`: knowledge base command and message augmentation contribution.
- Modify `desktop/electron/services/agent-runtime/agent-runtime-service.ts`: accept optional message preparation and project prompt commands.
- Modify `desktop/electron/services/agent-runtime/conversation-router.ts`: apply prepared message to the live turn while preserving original user history.
- Modify `desktop/electron/services/agent-runtime/index.ts`: compose knowledge base contributions when creating project-scoped Agent runtime.
- Create or update Agent runtime tests for ordinary projects and knowledge base projects.

---

### Task 1: Project Config Capability

**Files:**
- Modify: `desktop/src/types/config.ts`
- Modify: `desktop/src/lib/config.ts`
- Test: `desktop/src/lib/__tests__/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Add these tests to `desktop/src/lib/__tests__/config.test.ts`:

```ts
describe("Synapse project capabilities", () => {
  it("preserves valid knowledge base capability config", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [{
          id: "project-1",
          name: "KB",
          path: "/Users/example/kb",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-21",
            },
          },
        }],
      },
    })

    expect(config.global.projects[0]?.capabilities?.knowledgeBase).toEqual({
      enabled: true,
      schemaVersion: 1,
      templateVersion: "2026-05-21",
    })
  })

  it("drops malformed knowledge base capability config", () => {
    const config = sanitizeSynapseConfig({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "light",
        projects: [{
          id: "project-1",
          name: "Project",
          path: "/Users/example/project",
          capabilities: {
            knowledgeBase: {
              enabled: false,
              schemaVersion: 2,
              templateVersion: "",
            },
          },
        }],
      },
    })

    expect(config.global.projects[0]?.capabilities).toBeUndefined()
  })

  it("applies project capability patches without dropping existing project fields", () => {
    const current = createDefaultConfig()
    const next = applySynapseConfigPatch(current, {
      global: {
        projects: [{
          id: "project-1",
          name: "KB",
          path: "/Users/example/kb",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-21",
            },
          },
        }],
      },
    })

    expect(next.global.projects).toHaveLength(1)
    expect(next.global.projects[0]?.name).toBe("KB")
    expect(next.global.projects[0]?.capabilities?.knowledgeBase?.enabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run config tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/lib/__tests__/config.test.ts
```

Expected: FAIL because `capabilities` is not part of `SynapseProjectConfig` and normalization drops the field.

- [ ] **Step 3: Add project capability types**

In `desktop/src/types/config.ts`, replace the current `SynapseProjectConfig` definition with:

```ts
export type SynapseKnowledgeBaseProjectCapability = {
  enabled: true
  schemaVersion: 1
  templateVersion: string
}

export type SynapseProjectCapabilities = {
  knowledgeBase?: SynapseKnowledgeBaseProjectCapability
}

export type SynapseProjectConfig = {
  id: string
  name: string
  path: string
  capabilities?: SynapseProjectCapabilities
}
```

- [ ] **Step 4: Normalize project capabilities**

In `desktop/src/lib/config.ts`, add these helpers near `normalizeProjectConfig`:

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

  return {
    knowledgeBase: {
      enabled: true,
      schemaVersion: 1,
      templateVersion,
    },
  }
}
```

Then update `normalizeProjectConfig` to include:

```ts
  const capabilities = normalizeKnowledgeBaseCapability(value.capabilities)

  return {
    id,
    name,
    path: projectPath,
    ...(capabilities ? { capabilities } : undefined),
  }
```

- [ ] **Step 5: Run config tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/lib/__tests__/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add desktop/src/types/config.ts desktop/src/lib/config.ts desktop/src/lib/__tests__/config.test.ts
git commit -m "feat: add project knowledge base capability config"
```

---

### Task 2: Knowledge Base Templates And Service

**Files:**
- Create: `desktop/src/types/knowledge-base.ts`
- Create: `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
- Create: `desktop/electron/services/knowledge-base/index.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`
- Create: `desktop/resources/knowledge-base/templates/.synapse-kb.json`
- Create: `desktop/resources/knowledge-base/templates/.raw/.manifest.json`
- Create: `desktop/resources/knowledge-base/templates/wiki/index.md`
- Create: `desktop/resources/knowledge-base/templates/wiki/hot.md`
- Create: `desktop/resources/knowledge-base/templates/wiki/log.md`
- Create: `desktop/resources/knowledge-base/templates/wiki/overview.md`
- Create: `desktop/resources/knowledge-base/templates/wiki/sources/_index.md`
- Create: `desktop/resources/knowledge-base/templates/wiki/concepts/_index.md`
- Create: `desktop/resources/knowledge-base/templates/wiki/entities/_index.md`
- Create: `desktop/resources/knowledge-base/templates/wiki/questions/_index.md`
- Create: `desktop/resources/knowledge-base/prompts/bootstrap.md`
- Create: `desktop/resources/knowledge-base/prompts/ingest.md`
- Create: `desktop/resources/knowledge-base/prompts/query.md`
- Create: `desktop/resources/knowledge-base/prompts/save.md`
- Create: `desktop/resources/knowledge-base/prompts/lint.md`
- Create: `desktop/resources/knowledge-base/prompts/hot-cache.md`
- Modify: `desktop/package.json`

- [ ] **Step 1: Write failing service tests**

Create `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`:

```ts
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { KnowledgeBaseService, KNOWLEDGE_BASE_TEMPLATE_VERSION } from "../knowledge-base-service"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseService", () => {
  it("initializes the vault structure without runnable agent files", async () => {
    const targetPath = await tempDir()
    const service = new KnowledgeBaseService()

    const result = await service.initialize({ projectPath: targetPath, mode: "create" })

    expect(result.templateVersion).toBe(KNOWLEDGE_BASE_TEMPLATE_VERSION)
    await expect(readFile(path.join(targetPath, ".synapse-kb.json"), "utf8")).resolves.toContain("synapse.knowledgeBase")
    await expect(readFile(path.join(targetPath, ".raw", ".manifest.json"), "utf8")).resolves.toContain("\"sources\"")
    await expect(readFile(path.join(targetPath, "wiki", "hot.md"), "utf8")).resolves.toContain("# Hot Cache")
    await expect(readFile(path.join(targetPath, ".agents", "skills", "wiki", "SKILL.md"), "utf8")).rejects.toThrow()
  })

  it("repairs missing files without overwriting existing wiki content", async () => {
    const targetPath = await tempDir()
    const service = new KnowledgeBaseService()
    await service.initialize({ projectPath: targetPath, mode: "create" })
    await writeFile(path.join(targetPath, "wiki", "hot.md"), "# Custom Hot\n")

    const result = await service.initialize({ projectPath: targetPath, mode: "repair" })

    expect(result.createdFiles).not.toContain("wiki/hot.md")
    await expect(readFile(path.join(targetPath, "wiki", "hot.md"), "utf8")).resolves.toBe("# Custom Hot\n")
  })

  it("detects existing knowledge base folders by metadata or folder shape", async () => {
    const targetPath = await tempDir()
    const service = new KnowledgeBaseService()
    await service.initialize({ projectPath: targetPath, mode: "create" })

    await expect(service.inspect(targetPath)).resolves.toMatchObject({
      isKnowledgeBase: true,
      hasMetadata: true,
      hasRequiredShape: true,
    })
  })

  it("returns the raw directory after ensuring it exists", async () => {
    const targetPath = await tempDir()
    const service = new KnowledgeBaseService()

    const result = await service.openRawDirectory(targetPath)

    expect(result.rawPath).toBe(path.join(targetPath, ".raw"))
    await expect(access(path.join(targetPath, ".raw"))).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run service tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Add shared knowledge base types**

Create `desktop/src/types/knowledge-base.ts`:

```ts
export type SynapseKnowledgeBaseInitMode = "create" | "repair"

export type SynapseKnowledgeBaseInitializePayload = {
  projectPath: string
  mode: SynapseKnowledgeBaseInitMode
}

export type SynapseKnowledgeBaseInitializeResult = {
  projectPath: string
  templateVersion: string
  createdFiles: string[]
  existingFiles: string[]
}

export type SynapseKnowledgeBaseInspection = {
  projectPath: string
  isKnowledgeBase: boolean
  hasMetadata: boolean
  hasRequiredShape: boolean
  missingRequiredPaths: string[]
  templateVersion?: string
}

export type SynapseKnowledgeBaseOpenRawResult = {
  rawPath: string
}
```

- [ ] **Step 4: Add template resources**

Create the template files with these exact contents.

`desktop/resources/knowledge-base/templates/.synapse-kb.json`:

```json
{
  "type": "synapse.knowledgeBase",
  "schemaVersion": 1,
  "templateVersion": "2026-05-21",
  "createdBy": "Synapse"
}
```

`desktop/resources/knowledge-base/templates/.raw/.manifest.json`:

```json
{
  "version": 1,
  "sources": {}
}
```

`desktop/resources/knowledge-base/templates/wiki/index.md`:

```md
---
type: meta
title: "Wiki Index"
status: active
tags:
  - meta
---

# Wiki Index

## Sources

## Concepts

## Entities

## Questions
```

`desktop/resources/knowledge-base/templates/wiki/hot.md`:

```md
---
type: meta
title: "Hot Cache"
status: active
tags:
  - meta
---

# Hot Cache

## Last Updated

No knowledge has been ingested yet.

## Key Recent Facts

## Recent Changes

## Active Threads
```

`desktop/resources/knowledge-base/templates/wiki/log.md`:

```md
---
type: meta
title: "Knowledge Log"
status: active
tags:
  - meta
---

# Knowledge Log
```

`desktop/resources/knowledge-base/templates/wiki/overview.md`:

```md
---
type: meta
title: "Overview"
status: seed
tags:
  - meta
---

# Overview

No overview has been generated yet.
```

Each `_index.md` under `sources`, `concepts`, `entities`, and `questions` should use this pattern with the matching title:

```md
---
type: meta
title: "Sources Index"
status: active
tags:
  - meta
---

# Sources
```

- [ ] **Step 5: Add internal prompt resources**

Create concise internal prompts:

`desktop/resources/knowledge-base/prompts/bootstrap.md`:

```md
You are working inside a Synapse Knowledge Base project.

The project folder is an Obsidian-compatible Markdown vault.

Rules:
- `.raw/` contains user-maintained source files. Do not modify source files under `.raw/` except `.raw/.manifest.json`.
- `wiki/` contains maintained knowledge pages.
- Read `wiki/hot.md` first for recent context.
- Read `wiki/index.md` before creating or updating pages.
- Prefer wikilinks like `[[Page Name]]`.
- Keep `wiki/index.md`, `wiki/hot.md`, and `wiki/log.md` current after maintenance operations.
- If the user asks ordinary project questions unrelated to the knowledge base, answer normally.
```

`desktop/resources/knowledge-base/prompts/ingest.md`:

```md
Run Knowledge Base ingest for this Synapse project.

Process source files under `.raw/` that are missing from `.raw/.manifest.json` or whose hash changed. Do not edit source files. For each changed source, create or update a source page in `wiki/sources/`, relevant concept pages in `wiki/concepts/`, relevant entity pages in `wiki/entities/`, then update `wiki/index.md`, `wiki/hot.md`, and `wiki/log.md`.

Use Markdown frontmatter with `type`, `title`, `status`, and `tags`. Use wikilinks for cross references. Report created pages, updated pages, skipped unchanged sources, and any conflicts.
```

`desktop/resources/knowledge-base/prompts/query.md`:

```md
Answer from this Synapse Knowledge Base.

Read `wiki/hot.md` first. If it is not enough, read `wiki/index.md`, then the most relevant pages under `wiki/`. Answer only from the vault when the question is about this knowledge base. Cite pages with wikilinks. If coverage is missing, say what is missing and suggest adding a source.
```

`desktop/resources/knowledge-base/prompts/save.md`:

```md
Save valuable conversation content into this Synapse Knowledge Base.

Choose the best destination under `wiki/questions/` or `wiki/meta/`. Create or update one Markdown page with frontmatter, declarative present-tense content, wikilinks, and citations to existing wiki pages when relevant. Update `wiki/index.md`, append a new entry at the top of `wiki/log.md`, and refresh `wiki/hot.md`.
```

`desktop/resources/knowledge-base/prompts/lint.md`:

```md
Run a Knowledge Base health check.

Scan `wiki/` for dead wikilinks, orphan pages, missing required frontmatter, empty sections, stale index entries, and missing cross references. Write a report to `wiki/meta/lint-report-YYYY-MM-DD.md`. Do not auto-fix issues unless the user explicitly asks.
```

`desktop/resources/knowledge-base/prompts/hot-cache.md`:

```md
Refresh `wiki/hot.md`.

Keep it under 500 words. Include Last Updated, Key Recent Facts, Recent Changes, and Active Threads. It is a cache, not a journal.
```

- [ ] **Step 6: Implement the service**

Create `desktop/electron/services/knowledge-base/knowledge-base-service.ts`:

```ts
import { constants } from "node:fs"
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseKnowledgeBaseInitializePayload,
  SynapseKnowledgeBaseInitializeResult,
  SynapseKnowledgeBaseInspection,
  SynapseKnowledgeBaseOpenRawResult,
} from "../../../src/types/knowledge-base"

export const KNOWLEDGE_BASE_TEMPLATE_VERSION = "2026-05-21"

const REQUIRED_PATHS = [
  ".synapse-kb.json",
  ".raw/.manifest.json",
  "wiki/index.md",
  "wiki/hot.md",
  "wiki/log.md",
  "wiki/overview.md",
  "wiki/sources/_index.md",
  "wiki/concepts/_index.md",
  "wiki/entities/_index.md",
  "wiki/questions/_index.md",
] as const

type KnowledgeBaseServiceDeps = {
  templateRoot?: string
}

export class KnowledgeBaseService {
  private readonly templateRoot: string

  constructor(deps: KnowledgeBaseServiceDeps = {}) {
    this.templateRoot = deps.templateRoot ?? resolveTemplateRoot()
  }

  async inspect(projectPath: string): Promise<SynapseKnowledgeBaseInspection> {
    const missingRequiredPaths: string[] = []
    for (const relativePath of REQUIRED_PATHS) {
      if (!await pathExists(path.join(projectPath, relativePath))) {
        missingRequiredPaths.push(relativePath)
      }
    }

    const metadata = await readMetadata(projectPath)
    const hasRequiredShape = missingRequiredPaths.length === 0
    const hasMetadata = metadata !== null

    return {
      projectPath,
      isKnowledgeBase: hasMetadata || hasRequiredShape,
      hasMetadata,
      hasRequiredShape,
      missingRequiredPaths,
      ...(metadata?.templateVersion ? { templateVersion: metadata.templateVersion } : undefined),
    }
  }

  async initialize(payload: SynapseKnowledgeBaseInitializePayload): Promise<SynapseKnowledgeBaseInitializeResult> {
    const projectPath = path.resolve(payload.projectPath)
    await mkdir(projectPath, { recursive: true })

    const createdFiles: string[] = []
    const existingFiles: string[] = []
    for (const relativePath of REQUIRED_PATHS) {
      const targetPath = assertInside(projectPath, path.join(projectPath, relativePath))
      const templatePath = path.join(this.templateRoot, relativePath)
      await mkdir(path.dirname(targetPath), { recursive: true })
      if (await pathExists(targetPath)) {
        existingFiles.push(relativePath)
        continue
      }
      if (await pathExists(templatePath)) {
        await copyFile(templatePath, targetPath)
      } else {
        await writeFile(targetPath, defaultTemplateFor(relativePath), "utf8")
      }
      createdFiles.push(relativePath)
    }

    await mkdir(assertInside(projectPath, path.join(projectPath, "_attachments")), { recursive: true })
    await mkdir(assertInside(projectPath, path.join(projectPath, "wiki", "meta")), { recursive: true })

    return {
      projectPath,
      templateVersion: KNOWLEDGE_BASE_TEMPLATE_VERSION,
      createdFiles,
      existingFiles,
    }
  }

  async openRawDirectory(projectPath: string): Promise<SynapseKnowledgeBaseOpenRawResult> {
    const rawPath = assertInside(projectPath, path.join(projectPath, ".raw"))
    await mkdir(rawPath, { recursive: true })
    return { rawPath }
  }
}

function resolveTemplateRoot(): string {
  if (process.env.SYNAPSE_KB_TEMPLATE_ROOT) {
    return process.env.SYNAPSE_KB_TEMPLATE_ROOT
  }
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    return path.join(resourcesPath, "knowledge-base", "templates")
  }
  const cwd = path.resolve(process.cwd())
  const desktopRoot = path.basename(cwd) === "desktop" ? cwd : path.join(cwd, "desktop")
  return path.join(desktopRoot, "resources", "knowledge-base", "templates")
}

function assertInside(rootPath: string, targetPath: string): string {
  const root = path.resolve(rootPath)
  const target = path.resolve(targetPath)
  const relative = path.relative(root, target)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("目标路径不在项目目录中。")
  }
  return target
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readMetadata(projectPath: string): Promise<{ templateVersion?: string } | null> {
  try {
    const content = await readFile(path.join(projectPath, ".synapse-kb.json"), "utf8")
    const parsed = JSON.parse(content) as Record<string, unknown>
    if (parsed.type !== "synapse.knowledgeBase" || parsed.schemaVersion !== 1) {
      return null
    }
    return {
      templateVersion: typeof parsed.templateVersion === "string" ? parsed.templateVersion : undefined,
    }
  } catch {
    return null
  }
}

function defaultTemplateFor(relativePath: string): string {
  if (relativePath === ".raw/.manifest.json") {
    return "{\n  \"version\": 1,\n  \"sources\": {}\n}\n"
  }
  if (relativePath === ".synapse-kb.json") {
    return `${JSON.stringify({
      type: "synapse.knowledgeBase",
      schemaVersion: 1,
      templateVersion: KNOWLEDGE_BASE_TEMPLATE_VERSION,
      createdBy: "Synapse",
    }, null, 2)}\n`
  }
  const title = path.basename(relativePath, ".md")
  return `---\ntype: meta\ntitle: "${title}"\nstatus: active\ntags:\n  - meta\n---\n\n# ${title}\n`
}
```

Create `desktop/electron/services/knowledge-base/index.ts`:

```ts
export {
  KnowledgeBaseService,
  KNOWLEDGE_BASE_TEMPLATE_VERSION,
} from "./knowledge-base-service"
```

Update `desktop/package.json` `build.extraResources` so packaged apps include the internal knowledge base resources:

```json
{
  "from": "resources/knowledge-base",
  "to": "knowledge-base"
}
```

- [ ] **Step 7: Run service tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add desktop/src/types/knowledge-base.ts desktop/electron/services/knowledge-base desktop/resources/knowledge-base desktop/package.json
git commit -m "feat: add knowledge base templates and service"
```

---

### Task 3: Knowledge Base IPC And Renderer Bridge

**Files:**
- Create: `desktop/electron/modules/knowledge-base/ipc.ts`
- Create: `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Write failing IPC tests**

Create `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { knowledgeBaseIpcModule } from "../ipc"

vi.mock("electron", () => ({
  shell: { showItemInFolder: vi.fn() },
}))

function createContext(service: unknown) {
  const permissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn().mockResolvedValue({ allowed: true }),
  }
  const auditSink = {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
  return {
    resolve: vi.fn((id: string) => {
      if (id === "knowledge-base.service") return service
      if (id === "core.permission-guard") return permissionGuard
      if (id === "core.audit-sink") return auditSink
      throw new Error(`Unknown service: ${id}`)
    }),
    permissionGuard,
    auditSink,
  }
}

describe("knowledgeBaseIpcModule", () => {
  it("initializes a knowledge base through the service", async () => {
    const initialize = vi.fn().mockResolvedValue({
      projectPath: "/tmp/kb",
      templateVersion: "2026-05-21",
      createdFiles: [".synapse-kb.json"],
      existingFiles: [],
    })
    const ctx = createContext({ initialize })

    const result = await knowledgeBaseIpcModule.methods.initialize.handler(ctx as never, {
      projectPath: "/tmp/kb",
      mode: "create",
    })

    expect(initialize).toHaveBeenCalledWith({ projectPath: "/tmp/kb", mode: "create" })
    expect(result.createdFiles).toEqual([".synapse-kb.json"])
  })

  it("opens raw directory through the service", async () => {
    const openRawDirectory = vi.fn().mockResolvedValue({ rawPath: "/tmp/kb/.raw" })
    const ctx = createContext({ openRawDirectory })

    const result = await knowledgeBaseIpcModule.methods.openRawDirectory.handler(ctx as never, {
      projectPath: "/tmp/kb",
    })

    expect(openRawDirectory).toHaveBeenCalledWith("/tmp/kb")
    expect(result.rawPath).toBe("/tmp/kb/.raw")
  })
})
```

- [ ] **Step 2: Run IPC tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- electron/modules/knowledge-base/__tests__/ipc.test.ts
```

Expected: FAIL because the IPC module does not exist.

- [ ] **Step 3: Add IPC module**

Create `desktop/electron/modules/knowledge-base/ipc.ts`:

```ts
import { z } from "zod"
import { shell } from "electron"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import type { KnowledgeBaseService } from "../../services/knowledge-base"
import { runGuardedShellOperation } from "../shell/guarded-shell"

const initializePayloadSchema = z.object({
  projectPath: z.string().min(1),
  mode: z.enum(["create", "repair"]),
})

const initializeResultSchema = z.object({
  projectPath: z.string(),
  templateVersion: z.string(),
  createdFiles: z.array(z.string()),
  existingFiles: z.array(z.string()),
})

const inspectionSchema = z.object({
  projectPath: z.string(),
  isKnowledgeBase: z.boolean(),
  hasMetadata: z.boolean(),
  hasRequiredShape: z.boolean(),
  missingRequiredPaths: z.array(z.string()),
  templateVersion: z.string().optional(),
})

const openRawResultSchema = z.object({
  rawPath: z.string(),
})

function service(ctx: IpcHandlerContext): KnowledgeBaseService {
  return ctx.resolve<KnowledgeBaseService>("knowledge-base.service")
}

async function runGuardedKnowledgeBaseOperation<T>(options: {
  ctx: IpcHandlerContext
  action: PermissionAction
  resource: string
  source: string
  run(): Promise<T>
}): Promise<T> {
  const actor = { kind: "user" } as const
  const permissionGuard = options.ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = options.ctx.resolve<AuditSink>("core.audit-sink")
  const permission = await permissionGuard.check({
    action: options.action,
    actor,
    resource: options.resource,
    context: { source: options.source },
  })
  if (!permission.allowed) {
    auditSink.record({
      action: options.action,
      actor,
      resource: options.resource,
      outcome: "denied",
      metadata: { source: options.source, reason: permission.reason, policyId: permission.policyId },
    })
    throw new Error(permission.reason)
  }
  try {
    const result = await options.run()
    auditSink.record({
      action: options.action,
      actor,
      resource: options.resource,
      outcome: "allowed",
      metadata: { source: options.source },
    })
    return result
  } catch (error) {
    auditSink.record({
      action: options.action,
      actor,
      resource: options.resource,
      outcome: "failed",
      metadata: {
        source: options.source,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      },
    })
    throw error
  }
}

export const knowledgeBaseIpcModule: IpcModule = {
  id: "knowledge-base",
  methods: {
    inspect: {
      kind: "invoke",
      channel: "synapse:knowledge-base:inspect",
      request: z.object({ projectPath: z.string().min(1) }),
      response: inspectionSchema,
      handler: (ctx, request: { projectPath: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.read.outside-userdata",
        resource: request.projectPath,
        source: "knowledgeBase.inspect",
        run: () => service(ctx).inspect(request.projectPath),
      }),
    },
    initialize: {
      kind: "invoke",
      channel: "synapse:knowledge-base:initialize",
      request: initializePayloadSchema,
      response: initializeResultSchema,
      handler: (ctx, request: { projectPath: string; mode: "create" | "repair" }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: request.projectPath,
        source: "knowledgeBase.initialize",
        run: () => service(ctx).initialize(request),
      }),
    },
    openRawDirectory: {
      kind: "invoke",
      channel: "synapse:knowledge-base:open-raw-directory",
      request: z.object({ projectPath: z.string().min(1) }),
      response: openRawResultSchema,
      handler: async (ctx, request: { projectPath: string }) => {
        const result = await runGuardedKnowledgeBaseOperation({
          ctx,
          action: "fs.write",
          resource: request.projectPath,
          source: "knowledgeBase.ensureRawDirectory",
          run: () => service(ctx).openRawDirectory(request.projectPath),
        })
        await runGuardedShellOperation({
          ctx,
          resource: result.rawPath,
          source: "knowledgeBase.openRawDirectory",
          run: () => shell.showItemInFolder(result.rawPath),
        })
        return result
      },
    },
  },
  events: {},
}
```

- [ ] **Step 4: Register service and IPC module**

In `desktop/electron/bootstrap/descriptors.ts`, import `KnowledgeBaseService` and add a descriptor:

```ts
import { KnowledgeBaseService } from "../services/knowledge-base"

export const coreKnowledgeBaseDescriptor: ServiceDescriptor<KnowledgeBaseService> = {
  id: "knowledge-base.service",
  criticality: "degraded",
  create() {
    return new KnowledgeBaseService()
  },
}
```

In `desktop/electron/bootstrap/registry.ts`, register the descriptor before modules use it:

```ts
registry.register(coreKnowledgeBaseDescriptor)
```

In `desktop/electron/bootstrap/ipc-registry.ts`, import and register the module:

```ts
import { knowledgeBaseIpcModule } from "../modules/knowledge-base/ipc"
```

Add it to `createIpcRegistry`:

```ts
registry.register(knowledgeBaseIpcModule, ctx)
```

Add it to `registeredIpcModules`:

```ts
knowledgeBaseIpcModule,
```

- [ ] **Step 5: Expose preload bridge**

In `desktop/electron/preload.ts`, add channels:

```ts
"knowledge-base": {
  "inspect": "synapse:knowledge-base:inspect",
  "initialize": "synapse:knowledge-base:initialize",
  "openRawDirectory": "synapse:knowledge-base:open-raw-directory",
},
```

Add the bridge namespace:

```ts
knowledgeBase: {
  inspect: (projectPath: string) =>
    invoke(IPC_CHANNELS["knowledge-base"].inspect)({ projectPath }),
  initialize: (payload) =>
    invoke(IPC_CHANNELS["knowledge-base"].initialize)(payload),
  openRawDirectory: (projectPath: string) =>
    invoke(IPC_CHANNELS["knowledge-base"].openRawDirectory)({ projectPath }),
},
```

In `desktop/src/types/bridge.ts`, import the knowledge base types and add:

```ts
  knowledgeBase: {
    inspect: (projectPath: string) => Promise<SynapseKnowledgeBaseInspection>
    initialize: (
      payload: SynapseKnowledgeBaseInitializePayload,
    ) => Promise<SynapseKnowledgeBaseInitializeResult>
    openRawDirectory: (projectPath: string) => Promise<SynapseKnowledgeBaseOpenRawResult>
  }
```

- [ ] **Step 6: Regenerate IPC types**

Run:

```bash
pnpm --filter @synapse/desktop generate:ipc
```

Expected: generated IPC channel types include `knowledge-base`.

- [ ] **Step 7: Run IPC tests and codegen check**

Run:

```bash
pnpm --filter @synapse/desktop test -- electron/modules/knowledge-base/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop check:ipc-codegen
```

Expected: both PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add desktop/electron/modules/knowledge-base desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/registry.ts desktop/electron/bootstrap/ipc-registry.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated
git commit -m "feat: expose knowledge base project ipc"
```

---

### Task 4: Project Settings UI

**Files:**
- Modify: `desktop/src/modules/settings/components/project-list-editor.tsx`
- Create: `desktop/src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

Create `desktop/src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ProjectListEditor } from "../components/project-list-editor"
import type { SynapseProjectConfig } from "@/types/config"

const kbProject: SynapseProjectConfig = {
  id: "project-1",
  name: "Knowledge",
  path: "/Users/example/kb",
  capabilities: {
    knowledgeBase: {
      enabled: true,
      schemaVersion: 1,
      templateVersion: "2026-05-21",
    },
  },
}

beforeEach(() => {
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      repository: {
        chooseDirectory: vi.fn().mockResolvedValue("/Users/example/new-kb"),
      },
      knowledgeBase: {
        inspect: vi.fn().mockResolvedValue({
          projectPath: "/Users/example/new-kb",
          isKnowledgeBase: true,
          hasMetadata: true,
          hasRequiredShape: true,
          missingRequiredPaths: [],
          templateVersion: "2026-05-21",
        }),
        initialize: vi.fn().mockResolvedValue({
          projectPath: "/Users/example/new-kb",
          templateVersion: "2026-05-21",
          createdFiles: [],
          existingFiles: [],
        }),
        openRawDirectory: vi.fn().mockResolvedValue({ rawPath: "/Users/example/kb/.raw" }),
      },
      agent: {
        listSessions: vi.fn().mockResolvedValue([]),
      },
    },
  })
})

describe("ProjectListEditor knowledge base actions", () => {
  it("shows a knowledge base badge and maintenance action for knowledge base projects", async () => {
    render(<ProjectListEditor projects={[kbProject]} onSave={vi.fn()} />)

    expect(screen.getByText("知识库")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "维护文件" }))

    await waitFor(() => {
      expect(window.synapse?.knowledgeBase.openRawDirectory).toHaveBeenCalledWith("/Users/example/kb")
    })
  })

  it("creates a knowledge base project from the add dialog", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ProjectListEditor projects={[]} onSave={onSave} />)

    fireEvent.click(screen.getByRole("button", { name: "新建知识库" }))
    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Knowledge" } })
    fireEvent.click(screen.getByRole("button", { name: "浏览" }))
    await waitFor(() => expect(screen.getByLabelText("项目路径")).toHaveValue("/Users/example/new-kb"))
    fireEvent.click(screen.getByRole("button", { name: "创建" }))

    await waitFor(() => {
      expect(window.synapse?.knowledgeBase.initialize).toHaveBeenCalledWith({
        projectPath: "/Users/example/new-kb",
        mode: "create",
      })
      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({
          name: "Knowledge",
          path: "/Users/example/new-kb",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-21",
            },
          },
        }),
      ])
    })
  })

  it("marks an existing project as a knowledge base", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ProjectListEditor projects={[{ id: "project-1", name: "Plain", path: "/Users/example/plain" }]} onSave={onSave} />)

    fireEvent.click(screen.getByRole("button", { name: "设为知识库" }))

    await waitFor(() => {
      expect(window.synapse?.knowledgeBase.initialize).toHaveBeenCalledWith({
        projectPath: "/Users/example/plain",
        mode: "repair",
      })
      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "project-1",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-21",
            },
          },
        }),
      ])
    })
  })

  it("opens an existing knowledge base folder as a project", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ProjectListEditor projects={[]} onSave={onSave} />)

    fireEvent.click(screen.getByRole("button", { name: "打开知识库" }))

    await waitFor(() => {
      expect(window.synapse?.repository.chooseDirectory).toHaveBeenCalled()
      expect(window.synapse?.knowledgeBase.inspect).toHaveBeenCalledWith("/Users/example/new-kb")
      expect(window.synapse?.knowledgeBase.initialize).toHaveBeenCalledWith({
        projectPath: "/Users/example/new-kb",
        mode: "repair",
      })
      expect(onSave).toHaveBeenCalledWith([
        expect.objectContaining({
          name: "new-kb",
          path: "/Users/example/new-kb",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-21",
            },
          },
        }),
      ])
    })
  })
})
```

- [ ] **Step 2: Run renderer tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx
```

Expected: FAIL because the UI does not expose knowledge base actions.

- [ ] **Step 3: Confirm component export**

Keep the existing named export at the bottom of `desktop/src/modules/settings/components/project-list-editor.tsx`:

```ts
export { ProjectListEditor }
```

- [ ] **Step 4: Add knowledge base state and handlers**

In `ProjectListEditor`, add state:

```ts
const [isKnowledgeBaseDialogOpen, setIsKnowledgeBaseDialogOpen] = useState(false)
const [knowledgeBaseName, setKnowledgeBaseName] = useState("")
const [knowledgeBasePath, setKnowledgeBasePath] = useState("")
const [knowledgeBaseError, setKnowledgeBaseError] = useState<string | null>(null)
const [isCreatingKnowledgeBase, setIsCreatingKnowledgeBase] = useState(false)
const [markingKnowledgeBaseProjectId, setMarkingKnowledgeBaseProjectId] = useState<string | null>(null)
```

Add helpers:

```ts
function isKnowledgeBaseProject(project: SynapseProjectConfig): boolean {
  return project.capabilities?.knowledgeBase?.enabled === true
}

async function handleChooseKnowledgeBasePath() {
  const selectedPath = await window.synapse?.repository?.chooseDirectory()
  if (!selectedPath) return
  setKnowledgeBasePath(selectedPath)
  setKnowledgeBaseName((current) => current.trim() ? current : getProjectNameFromPath(selectedPath))
  setKnowledgeBaseError(null)
}

async function handleCreateKnowledgeBase() {
  const name = knowledgeBaseName.trim()
  const projectPath = knowledgeBasePath.trim()
  if (!name || !projectPath) {
    setKnowledgeBaseError("项目名称和项目路径都不能为空。")
    return
  }
  if (!window.synapse?.knowledgeBase) {
    setKnowledgeBaseError("知识库服务不可用。")
    return
  }
  if (projects.some((project) => arePathsEqualForCompare(project.path, projectPath, { platform }))) {
    setKnowledgeBaseError("这个项目路径已经存在了。")
    return
  }

  setIsCreatingKnowledgeBase(true)
  setKnowledgeBaseError(null)
  try {
    const result = await window.synapse.knowledgeBase.initialize({ projectPath, mode: "create" })
    await onSave([
      ...projects,
      {
        id: crypto.randomUUID(),
        name,
        path: projectPath,
        capabilities: {
          knowledgeBase: {
            enabled: true,
            schemaVersion: 1,
            templateVersion: result.templateVersion,
          },
        },
      },
    ])
    setIsKnowledgeBaseDialogOpen(false)
    setKnowledgeBaseName("")
    setKnowledgeBasePath("")
  } catch (error) {
    setKnowledgeBaseError(error instanceof Error ? error.message : "创建失败。")
  } finally {
    setIsCreatingKnowledgeBase(false)
  }
}

async function handleOpenExistingKnowledgeBase() {
  const selectedPath = await window.synapse?.repository?.chooseDirectory()
  if (!selectedPath || !window.synapse?.knowledgeBase) return
  if (projects.some((project) => arePathsEqualForCompare(project.path, selectedPath, { platform }))) {
    setFormError("这个项目路径已经存在了。")
    return
  }
  const inspection = await window.synapse.knowledgeBase.inspect(selectedPath)
  if (!inspection.isKnowledgeBase) {
    setFormError("未识别为知识库目录。")
    return
  }
  const result = await window.synapse.knowledgeBase.initialize({
    projectPath: selectedPath,
    mode: "repair",
  })
  await onSave([
    ...projects,
    {
      id: crypto.randomUUID(),
      name: getProjectNameFromPath(selectedPath),
      path: selectedPath,
      capabilities: {
        knowledgeBase: {
          enabled: true,
          schemaVersion: 1,
          templateVersion: result.templateVersion,
        },
      },
    },
  ])
}

async function handleMarkProjectAsKnowledgeBase(project: SynapseProjectConfig) {
  if (!window.synapse?.knowledgeBase) return
  setMarkingKnowledgeBaseProjectId(project.id)
  try {
    const result = await window.synapse.knowledgeBase.initialize({
      projectPath: project.path,
      mode: "repair",
    })
    await onSave(projects.map((item) => item.id === project.id
      ? {
          ...item,
          capabilities: {
            ...item.capabilities,
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: result.templateVersion,
            },
          },
        }
      : item))
  } finally {
    setMarkingKnowledgeBaseProjectId(null)
  }
}
```

- [ ] **Step 5: Add badge and maintenance button**

Inside each project card title, add:

```tsx
{isKnowledgeBaseProject(project) ? (
  <Badge variant="secondary">知识库</Badge>
) : null}
```

Import `Badge` from `@/components/ui/badge`.

Inside `CardFooter`, before `修改`, add:

```tsx
{!isKnowledgeBaseProject(project) ? (
  <Button
    variant="ghost"
    size="sm"
    disabled={markingKnowledgeBaseProjectId === project.id}
    onClick={() => void handleMarkProjectAsKnowledgeBase(project)}
  >
    设为知识库
  </Button>
) : null}
{isKnowledgeBaseProject(project) ? (
  <Button
    variant="ghost"
    size="sm"
    onClick={() => {
      void window.synapse?.knowledgeBase?.openRawDirectory(project.path)
        .catch((error) => logger.error("Failed to open knowledge base raw directory.", { projectId: project.id, error }))
    }}
  >
    维护文件
  </Button>
) : null}
```

- [ ] **Step 6: Add create knowledge base dialog**

Next to the existing "添加项目" button, add:

```tsx
<Button variant="outline" onClick={() => void handleOpenExistingKnowledgeBase()}>
  打开知识库
</Button>
```

Then add the create dialog:

```tsx
<Dialog open={isKnowledgeBaseDialogOpen} onOpenChange={setIsKnowledgeBaseDialogOpen}>
  <DialogTrigger asChild>
    <Button variant="outline">新建知识库</Button>
  </DialogTrigger>
  <DialogContent className="sm:max-w-[480px]">
    <DialogHeader>
      <DialogTitle>新建知识库</DialogTitle>
    </DialogHeader>
    <FieldGroup className="gap-2">
      <Field>
        <Label htmlFor="knowledge-base-name">项目名称</Label>
        <Input
          id="knowledge-base-name"
          value={knowledgeBaseName}
          onChange={(event) => setKnowledgeBaseName(event.target.value)}
          disabled={isCreatingKnowledgeBase}
        />
      </Field>
      <Field>
        <Label htmlFor="knowledge-base-path">项目路径</Label>
        <div className="flex gap-2">
          <Input
            id="knowledge-base-path"
            value={knowledgeBasePath}
            onChange={(event) => setKnowledgeBasePath(event.target.value)}
            disabled={isCreatingKnowledgeBase}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleChooseKnowledgeBasePath()}
            disabled={isCreatingKnowledgeBase}
          >
            浏览
          </Button>
        </div>
      </Field>
      <FieldError>{knowledgeBaseError}</FieldError>
    </FieldGroup>
    <DialogFooter>
      <Button variant="outline" onClick={() => setIsKnowledgeBaseDialogOpen(false)} disabled={isCreatingKnowledgeBase}>
        取消
      </Button>
      <Button onClick={() => void handleCreateKnowledgeBase()} disabled={isCreatingKnowledgeBase}>
        {isCreatingKnowledgeBase ? "创建中..." : "创建"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 7: Run renderer tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add desktop/src/modules/settings/components/project-list-editor.tsx desktop/src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx
git commit -m "feat: add knowledge base project actions"
```

---

### Task 5: Agent Project Contributions

**Files:**
- Create: `desktop/electron/services/agent-runtime/project-contributions.ts`
- Create: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Modify: `desktop/electron/services/agent-runtime/session-manager.ts`
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

- [ ] **Step 1: Write failing Agent contribution tests**

Create `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`:

```ts
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createKnowledgeBaseAgentContribution } from "../../knowledge-base/agent-contribution"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-agent-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("knowledge base Agent contribution", () => {
  it("returns no contribution for ordinary projects", async () => {
    const contribution = await createKnowledgeBaseAgentContribution({
      project: { id: "project-1", name: "Plain", path: "/tmp/plain" },
    })

    expect(contribution).toBeNull()
  })

  it("adds kb commands and hot cache bootstrap for knowledge base projects", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, "wiki"), { recursive: true })
    await writeFile(path.join(projectPath, "wiki", "hot.md"), "# Hot Cache\n\nRecent fact.\n")

    const contribution = await createKnowledgeBaseAgentContribution({
      project: {
        id: "project-1",
        name: "KB",
        path: projectPath,
        capabilities: {
          knowledgeBase: {
            enabled: true,
            schemaVersion: 1,
            templateVersion: "2026-05-21",
          },
        },
      },
    })

    expect(contribution?.commands.map((command) => command.name)).toEqual(["kb"])
    const prepared = await Promise.resolve(contribution?.prepareMessage({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local-renderer",
      content: "What changed?",
    }, { isNewLiveSession: true }))
    const unchanged = await Promise.resolve(contribution?.prepareMessage({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local-renderer",
      content: "What changed?",
    }, { isNewLiveSession: false }))

    expect(prepared?.content).toContain("Recent fact.")
    expect(unchanged?.content).toBe("What changed?")
  })

  it("expands /kb ingest into the internal ingest prompt", async () => {
    const projectPath = await tempDir()
    const contribution = await createKnowledgeBaseAgentContribution({
      project: {
        id: "project-1",
        name: "KB",
        path: projectPath,
        capabilities: {
          knowledgeBase: {
            enabled: true,
            schemaVersion: 1,
            templateVersion: "2026-05-21",
          },
        },
      },
    })

    const command = contribution?.commands[0]
    const prompt = await command?.buildPrompt(["ingest"], {
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local-renderer",
      content: "/kb ingest",
    })

    expect(prompt).toContain("Run Knowledge Base ingest")
  })
})
```

- [ ] **Step 2: Run Agent contribution tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: FAIL because the contribution module does not exist.

- [ ] **Step 3: Add generic project contribution types**

Create `desktop/electron/services/agent-runtime/project-contributions.ts`:

```ts
import type { AgentMessage } from "./types"
import type { RegisteredPromptCommand } from "./command-router"

export type AgentProjectMessageContext = {
  readonly isNewLiveSession: boolean
}

export type AgentProjectContribution = {
  readonly commands: readonly RegisteredPromptCommand[]
  prepareMessage?(message: AgentMessage, context: AgentProjectMessageContext): AgentMessage | Promise<AgentMessage>
}

export function mergeAgentProjectContributions(
  contributions: readonly AgentProjectContribution[],
): AgentProjectContribution {
  return {
    commands: contributions.flatMap((contribution) => contribution.commands),
    async prepareMessage(message, context) {
      let next = message
      for (const contribution of contributions) {
        next = await Promise.resolve(contribution.prepareMessage?.(next, context) ?? next)
      }
      return next
    },
  }
}
```

- [ ] **Step 4: Add knowledge base contribution**

Create `desktop/electron/services/knowledge-base/agent-contribution.ts`:

```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { SynapseProjectConfig } from "../../../src/types/config"
import type { AgentProjectContribution } from "../agent-runtime/project-contributions"
import type { AgentMessage } from "../agent-runtime/types"

type CreateKnowledgeBaseAgentContributionInput = {
  project: SynapseProjectConfig
}

export async function createKnowledgeBaseAgentContribution(
  input: CreateKnowledgeBaseAgentContributionInput,
): Promise<AgentProjectContribution | null> {
  if (input.project.capabilities?.knowledgeBase?.enabled !== true) {
    return null
  }

  const bootstrap = await readPrompt("bootstrap.md")
  const hotCache = await readOptional(path.join(input.project.path, "wiki", "hot.md"))

  return {
    commands: [{
      name: "kb",
      buildPrompt: (args) => buildKnowledgeBaseCommandPrompt(args),
    }],
    prepareMessage(message, context) {
      if (!context.isNewLiveSession) {
        return message
      }
      return prependBootstrap(message, bootstrap, hotCache)
    },
  }
}

function prependBootstrap(message: AgentMessage, bootstrap: string, hotCache: string): AgentMessage {
  return {
    ...message,
    content: [
      bootstrap.trim(),
      hotCache.trim() ? `Current wiki/hot.md:\n\n${hotCache.trim()}` : "",
      "User message:",
      message.content,
    ].filter(Boolean).join("\n\n---\n\n"),
  }
}

async function buildKnowledgeBaseCommandPrompt(args: readonly string[]): Promise<string> {
  const action = (args[0] ?? "status").toLowerCase()
  if (action === "ingest") return readPrompt("ingest.md")
  if (action === "save") return readPrompt("save.md")
  if (action === "lint") return readPrompt("lint.md")
  return [
    await readPrompt("bootstrap.md"),
    "",
    "Report the current knowledge base status. Mention available commands: `/kb ingest`, `/kb save`, `/kb lint`.",
  ].join("\n")
}

async function readPrompt(fileName: string): Promise<string> {
  return readFile(path.join(resolvePromptRoot(), fileName), "utf8")
}

async function readOptional(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return ""
  }
}

function resolvePromptRoot(): string {
  if (process.env.SYNAPSE_KB_PROMPT_ROOT) {
    return process.env.SYNAPSE_KB_PROMPT_ROOT
  }
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    return path.join(resourcesPath, "knowledge-base", "prompts")
  }
  const cwd = path.resolve(process.cwd())
  const desktopRoot = path.basename(cwd) === "desktop" ? cwd : path.join(cwd, "desktop")
  return path.join(desktopRoot, "resources", "knowledge-base", "prompts")
}
```

- [ ] **Step 5: Wire message preparation into Agent runtime**

In `desktop/electron/services/agent-runtime/agent-runtime-service.ts`, extend `AgentRuntimeServiceDeps`:

```ts
readonly prepareMessage?: (
  message: AgentMessage,
  context: { readonly isNewLiveSession: boolean },
) => AgentMessage | Promise<AgentMessage>
```

Pass it to `ConversationRouter` deps:

```ts
prepareMessage: deps.prepareMessage,
```

In `desktop/electron/services/agent-runtime/conversation-router.ts`, extend `ConversationRouterDeps`:

```ts
readonly prepareMessage?: (
  message: AgentMessage,
  context: { readonly isNewLiveSession: boolean },
) => AgentMessage | Promise<AgentMessage>
```

In `desktop/electron/services/agent-runtime/session-manager.ts`, change `getOrCreateSession` so it returns whether it created a new live session:

```ts
export type AgentLiveSessionHandle = {
  readonly liveSession: AgentLiveSession
  readonly created: boolean
}
```

Update the existing-session branch:

```ts
return { liveSession: input.state.liveSession, created: false }
```

Update the new-session branch:

```ts
return { liveSession, created: true }
```

Update existing `getOrCreateSession` call sites and tests to destructure `{ liveSession }`. In `processSideSessionWithTimeout`, keep sending the original side-session message and use only the destructured live session.

In `processTurn`, keep history with the original user message, create/reuse the live session, then prepare only the live message. This keeps Synapse's conversation history clean and injects the knowledge base bootstrap only once per new live Agent session.

```ts
conversation = await this.repository.appendHistory(conversation.id, "user", message.content)
this.emitConversationUpdated(conversation)

const sessionHandle = await this.sessionManager.getOrCreateSession({
  state,
  conversation,
  message,
  abortSignal,
})
const liveMessage = await Promise.resolve(this.deps.prepareMessage?.(message, {
  isNewLiveSession: sessionHandle.created,
}) ?? message)
const result = await this.processLiveTurn(
  state,
  liveMessage,
  conversation,
  sessionHandle.liveSession,
  turnId,
  abortSignal,
  liveEventTimeoutMs,
)
```

- [ ] **Step 6: Compose contributions in project service**

In `desktop/electron/services/agent-runtime/index.ts`, import:

```ts
import { configStore } from "../config-store"
import { createKnowledgeBaseAgentContribution } from "../knowledge-base/agent-contribution"
import { mergeAgentProjectContributions } from "./project-contributions"
```

Change `create(ctx)` to `async create(ctx)` and build contributions:

```ts
      const appConfig = await configStore.load()
      const project = appConfig.global.projects.find((item) => item.id === ctx.projectId)
      const contributions = [
        project ? await createKnowledgeBaseAgentContribution({ project }) : null,
      ].filter((item): item is NonNullable<typeof item> => item !== null)
      const contribution = mergeAgentProjectContributions(contributions)
```

Pass commands and message preparation to `AgentRuntimeService`:

```ts
        registeredPromptCommands: contribution.commands,
        prepareMessage: contribution.prepareMessage,
```

- [ ] **Step 7: Run Agent contribution tests and existing command tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
pnpm --filter @synapse/desktop test -- electron/services/agent-runtime/__tests__/command-router.test.ts
pnpm --filter @synapse/desktop test -- electron/services/agent-runtime/__tests__/session-manager.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add desktop/electron/services/agent-runtime desktop/electron/services/knowledge-base/agent-contribution.ts
git commit -m "feat: add knowledge base agent contributions"
```

---

### Task 6: Final Verification

**Files:**
- Modify only files needed to fix failures from verification.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/lib/__tests__/config.test.ts
pnpm --filter @synapse/desktop test -- electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
pnpm --filter @synapse/desktop test -- electron/modules/knowledge-base/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop test -- src/modules/settings/__tests__/project-list-editor-knowledge-base.test.tsx
pnpm --filter @synapse/desktop test -- electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: PASS for all targeted suites.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS. If it fails, fix only the reported rule violation.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run full desktop tests if targeted suites are green**

Run:

```bash
pnpm --filter @synapse/desktop test
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat
git diff --name-only
```

Expected: only knowledge base capability, config, IPC, packaging resources, project UI, Agent contribution, templates, prompts, and tests are changed.

- [ ] **Step 6: Commit verification fixes**

If Step 1-4 required fixes, commit them:

```bash
git add desktop/package.json desktop/src desktop/electron desktop/resources
git commit -m "fix: stabilize knowledge base project capability"
```

If no files changed after verification, do not create an empty commit.
