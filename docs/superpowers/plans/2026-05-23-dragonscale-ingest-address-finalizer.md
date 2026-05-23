# DragonScale Ingest Address Finalizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/wiki ingest` and natural-language ingest requests receive DragonScale `c-NNNNNN` addresses through Synapse-owned services after the Agent writes wiki pages.

**Architecture:** Add a minimal Agent project-contribution `afterTurn` hook, then wire only knowledge-base projects to a `KnowledgeBaseIngestFinalizer`. The finalizer scans eligible wiki pages, reuses existing addresses, allocates missing addresses with `DragonScaleAddressService`, inserts `address:` frontmatter, and writes `.raw/.manifest.json` `address_map`.

**Tech Stack:** Electron main process, TypeScript, Node filesystem APIs, Vitest, existing Synapse Agent Runtime project contributions, existing Knowledge Base services.

---

## File Map

- Modify: `desktop/electron/services/knowledge-base/dragonscale/address-service.ts`
  - Make the allocation lock process-wide across service instances.
- Modify: `desktop/electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts`
  - Add a cross-instance concurrency regression test.
- Modify: `desktop/electron/services/knowledge-base/manifest.ts`
  - Add a safe manifest writer.
- Create: `desktop/electron/services/knowledge-base/__tests__/manifest-writer.test.ts`
  - Cover safe writes, preservation, path normalization, and symlink rejection.
- Create: `desktop/electron/services/knowledge-base/wiki-page-addresses.ts`
  - Provide wiki page scanning, eligibility, frontmatter address read/write helpers.
- Create: `desktop/electron/services/knowledge-base/__tests__/wiki-page-addresses.test.ts`
  - Cover eligibility and address insertion behavior.
- Create: `desktop/electron/services/knowledge-base/ingest-intent.ts`
  - Detect `/wiki ingest` and natural-language ingest requests.
- Create: `desktop/electron/services/knowledge-base/__tests__/ingest-intent.test.ts`
  - Cover positive and negative trigger phrases.
- Create: `desktop/electron/services/knowledge-base/ingest-finalizer.ts`
  - Implement deterministic post-turn DragonScale address finalization.
- Create: `desktop/electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts`
  - Cover page updates, manifest `address_map`, exclusions, and invalid manifest behavior.
- Modify: `desktop/electron/services/agent-runtime/project-contributions.ts`
  - Add and merge `afterTurn`.
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
  - Invoke `afterTurn` after live turns without hiding Agent results.
- Modify: `desktop/electron/services/agent-runtime/index.ts`
  - Pass project contribution `afterTurn` into the runtime service.
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
  - Accept `afterTurn` dependency.
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
  - Verify KB contribution finalizer wiring.
- Modify: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`
  - Verify runtime calls `afterTurn`.
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
  - Wire intent detection and finalizer into KB contribution only.
- Modify: `desktop/electron/services/knowledge-base/index.ts`
  - Export new helper/services where useful for tests and future phases.
- Modify: `desktop/electron/services/knowledge-base/wiki-command-copy.ts`
  - Update ingest appendix copy so the Agent knows Synapse owns DragonScale addresses.
- Modify: `desktop/resources/knowledge-base/prompts/ingest.md`
  - Remove Agent-side address allocation wording; state finalizer ownership.
- Modify: `desktop/resources/knowledge-base/claude-plugin/skills/wiki-ingest/SKILL.md`
  - Same finalizer ownership instructions for natural-language skill routing.
- Modify: `desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts`
  - Verify prompt copy mentions Synapse finalizer and `.vault-meta` restriction.

---

### Task 1: Make DragonScale Address Locks Process-Wide

**Files:**
- Modify: `desktop/electron/services/knowledge-base/dragonscale/address-service.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts`

- [ ] **Step 1: Add a failing cross-instance concurrency test**

Append this test inside `describe("DragonScaleAddressService", ...)`:

```ts
it("serializes concurrent allocations across service instances", async () => {
  const root = await tempDir()
  await mkdir(path.join(root, ".vault-meta"), { recursive: true })
  await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "1\n")

  const results = await Promise.all([
    new DragonScaleAddressService().allocate(root),
    new DragonScaleAddressService().allocate(root),
    new DragonScaleAddressService().allocate(root),
  ])

  expect(results.map((result) => result.address).sort()).toEqual([
    "c-000001",
    "c-000002",
    "c-000003",
  ])
  await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8"))
    .resolves.toBe("4\n")
})
```

- [ ] **Step 2: Run the test to verify it fails or flakes without the shared lock**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts --testNamePattern "across service instances"
```

Expected before implementation: FAIL with duplicate addresses or an incorrect final counter.

- [ ] **Step 3: Change the lock map to process-wide**

In `desktop/electron/services/knowledge-base/dragonscale/address-service.ts`, replace the instance field:

```ts
export class DragonScaleAddressService {
  private readonly locks = new Map<string, Promise<void>>()
```

with a module-level map:

```ts
const vaultLocks = new Map<string, Promise<void>>()

export class DragonScaleAddressService {
```

Then update `withVaultLock` to use `vaultLocks`:

```ts
  private async withVaultLock<T>(vaultPath: string, work: () => Promise<T>): Promise<T> {
    const key = path.resolve(vaultPath)
    const previous = vaultLocks.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => current)
    vaultLocks.set(key, queued)
    await previous.catch(() => undefined)
    try {
      return await work()
    } finally {
      release()
      if (vaultLocks.get(key) === queued) {
        vaultLocks.delete(key)
      }
    }
  }
```

- [ ] **Step 4: Run address service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts
```

Expected: PASS.

### Task 2: Add Safe Manifest Writer

**Files:**
- Modify: `desktop/electron/services/knowledge-base/manifest.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/manifest-writer.test.ts`

- [ ] **Step 1: Write failing manifest writer tests**

Create `desktop/electron/services/knowledge-base/__tests__/manifest-writer.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  readKnowledgeBaseManifest,
  writeKnowledgeBaseManifest,
  type KnowledgeBaseManifest,
} from "../manifest"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-manifest-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("writeKnowledgeBaseManifest", () => {
  it("writes pretty JSON and preserves manifest fields", async () => {
    const root = await tempDir()
    const manifest: KnowledgeBaseManifest = {
      version: 1,
      created: "2026-05-23",
      description: "Ingest delta tracker and address map for the Synapse knowledge base.",
      sources: {
        ".raw/a.md": {
          hash: "hash-a",
          ingested_at: "2026-05-23T00:00:00.000Z",
          pages_created: ["wiki/sources/a.md"],
          pages_updated: ["wiki/index.md"],
        },
      },
      address_map: {
        "wiki\\concepts\\Alpha.md": "c-000001",
      },
    }

    await writeKnowledgeBaseManifest(root, manifest)

    await expect(readFile(path.join(root, ".raw", ".manifest.json"), "utf8"))
      .resolves.toContain("\"wiki/concepts/Alpha.md\": \"c-000001\"")
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      status: "valid",
      manifest: {
        created: "2026-05-23",
        sources: manifest.sources,
        address_map: {
          "wiki/concepts/Alpha.md": "c-000001",
        },
      },
    })
  })

  it("rejects symlinked raw directories", async () => {
    const root = await tempDir()
    const outside = await tempDir()
    await symlink(outside, path.join(root, ".raw"), "dir")

    await expect(writeKnowledgeBaseManifest(root, {
      version: 1,
      sources: {},
      address_map: {},
    })).rejects.toThrow("符号链接")
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/manifest-writer.test.ts
```

Expected: FAIL because `writeKnowledgeBaseManifest` does not exist.

- [ ] **Step 3: Implement manifest writer**

In `desktop/electron/services/knowledge-base/manifest.ts`, update imports:

```ts
import { constants } from "node:fs"
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises"
```

Add this exported function after `readKnowledgeBaseManifest`:

```ts
export async function writeKnowledgeBaseManifest(
  projectPath: string,
  manifest: KnowledgeBaseManifest,
): Promise<void> {
  const root = path.resolve(projectPath)
  const rawPath = assertInside(root, path.join(root, ".raw"))
  const manifestPath = assertInside(root, path.join(rawPath, ".manifest.json"))
  await assertNoSymlinkInPath(root, ".raw")
  await assertNoSymlinkInPath(root, ".raw/.manifest.json")
  await mkdir(rawPath, { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(normalizeManifest(manifest), null, 2)}\n`, "utf8")
}
```

Add these helpers near the bottom:

```ts
function normalizeManifest(manifest: KnowledgeBaseManifest): KnowledgeBaseManifest {
  return {
    version: 1,
    ...(manifest.created ? { created: manifest.created } : undefined),
    ...(manifest.description ? { description: manifest.description } : undefined),
    sources: manifest.sources,
    address_map: Object.fromEntries(
      Object.entries(manifest.address_map)
        .map(([pagePath, address]) => [pagePath.split("\\").join("/"), address] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  }
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

async function assertNoSymlinkInPath(projectPath: string, relativePath: string): Promise<void> {
  let currentPath = projectPath
  for (const segment of relativePath.split(/[\\/]/)) {
    currentPath = path.join(currentPath, segment)
    try {
      const stat = await lstat(currentPath)
      if (stat.isSymbolicLink()) {
        throw new Error(`知识库路径不能包含符号链接：${path.relative(projectPath, currentPath)}`)
      }
    } catch (error) {
      if (isMissingPathError(error)) return
      throw error
    }
  }
}
```

Remove unused imports if TypeScript reports any.

- [ ] **Step 4: Run manifest tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/manifest-writer.test.ts
```

Expected: PASS.

### Task 3: Add Wiki Page Address Helpers

**Files:**
- Create: `desktop/electron/services/knowledge-base/wiki-page-addresses.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/wiki-page-addresses.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `desktop/electron/services/knowledge-base/__tests__/wiki-page-addresses.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  insertAddressIntoWikiPage,
  readAddressedWikiPages,
} from "../wiki-page-addresses"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-pages-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("wiki page address helpers", () => {
  it("finds eligible pages and excludes meta pages", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki", "concepts"), { recursive: true })
    await mkdir(path.join(root, "wiki", "meta"), { recursive: true })
    await writeFile(path.join(root, "wiki", "concepts", "Alpha.md"), "---\ntype: concept\n---\n\n# Alpha\n")
    await writeFile(path.join(root, "wiki", "hot.md"), "# Hot\n")
    await writeFile(path.join(root, "wiki", "meta", "Report.md"), "# Report\n")

    const pages = await readAddressedWikiPages(root)

    expect(pages.map((page) => page.relativePath)).toEqual(["wiki/concepts/Alpha.md"])
  })

  it("reads existing addresses from frontmatter", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki", "entities"), { recursive: true })
    await writeFile(path.join(root, "wiki", "entities", "Team.md"), "---\ntype: entity\naddress: c-000009\n---\n\n# Team\n")

    const pages = await readAddressedWikiPages(root)

    expect(pages).toEqual([expect.objectContaining({
      relativePath: "wiki/entities/Team.md",
      address: "c-000009",
      eligible: true,
    })])
  })

  it("does not include pre-rollout legacy pages", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki", "concepts"), { recursive: true })
    await writeFile(path.join(root, "wiki", "concepts", "Legacy.md"), "---\ntype: concept\ncreated: 2026-04-01\n---\n\n# Legacy\n")

    await expect(readAddressedWikiPages(root)).resolves.toEqual([])
  })

  it("inserts an address into existing frontmatter", async () => {
    const root = await tempDir()
    const pagePath = path.join(root, "wiki", "concepts", "Alpha.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "---\ntype: concept\ntitle: Alpha\n---\n\n# Alpha\n")

    await insertAddressIntoWikiPage(pagePath, "c-000010")

    await expect(readFile(pagePath, "utf8")).resolves.toBe("---\ntype: concept\ntitle: Alpha\naddress: c-000010\n---\n\n# Alpha\n")
  })

  it("inserts minimal frontmatter when a page has none", async () => {
    const root = await tempDir()
    const pagePath = path.join(root, "wiki", "sources", "Note.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "# Note\n")

    await insertAddressIntoWikiPage(pagePath, "c-000011")

    await expect(readFile(pagePath, "utf8")).resolves.toBe("---\naddress: c-000011\n---\n\n# Note\n")
  })

  it("skips symlinked pages", async () => {
    const root = await tempDir()
    const outside = await tempDir()
    await mkdir(path.join(root, "wiki", "concepts"), { recursive: true })
    await writeFile(path.join(outside, "Outside.md"), "# Outside\n")
    await symlink(path.join(outside, "Outside.md"), path.join(root, "wiki", "concepts", "Outside.md"))

    await expect(readAddressedWikiPages(root)).resolves.toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/wiki-page-addresses.test.ts
```

Expected: FAIL because `wiki-page-addresses.ts` does not exist.

- [ ] **Step 3: Implement helpers**

Create `desktop/electron/services/knowledge-base/wiki-page-addresses.ts`:

```ts
import type { Dirent } from "node:fs"
import { lstat, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { DragonScaleAddress } from "./dragonscale/types"

export interface AddressedWikiPage {
  readonly relativePath: string
  readonly absolutePath: string
  readonly address?: DragonScaleAddress
  readonly eligible: boolean
}

const EXCLUDED_FILENAMES = new Set([
  "_index.md",
  "index.md",
  "log.md",
  "hot.md",
  "overview.md",
  "dashboard.md",
  "Wiki Map.md",
  "getting-started.md",
])

const EXCLUDED_PREFIXES = ["wiki/folds/", "wiki/meta/"]
const ROLLOUT_DATE = "2026-04-23"

export async function readAddressedWikiPages(projectPath: string): Promise<readonly AddressedWikiPage[]> {
  const root = path.resolve(projectPath)
  const wikiPath = path.join(root, "wiki")
  const pages = await walkWiki(root, wikiPath)
  return pages
    .filter((page) => page.eligible)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export async function insertAddressIntoWikiPage(pagePath: string, address: DragonScaleAddress): Promise<void> {
  const content = await readFile(pagePath, "utf8")
  const parsed = parseFrontmatter(content)
  if (!parsed) {
    await writeFile(pagePath, `---\naddress: ${address}\n---\n\n${content}`, "utf8")
    return
  }
  if (/^address:\s+c-[0-9]{6}\s*$/m.test(parsed.frontmatter)) return
  const nextFrontmatter = `${parsed.frontmatter.trimEnd()}\naddress: ${address}`
  await writeFile(pagePath, `---\n${nextFrontmatter}\n---\n${parsed.body}`, "utf8")
}

async function walkWiki(root: string, directoryPath: string): Promise<AddressedWikiPage[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
  const pages: AddressedWikiPage[] = []
  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)
    const relativePath = normalizeRelativePath(path.relative(root, absolutePath))
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      pages.push(...await walkWiki(root, absolutePath))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const stat = await lstat(absolutePath)
    if (stat.isSymbolicLink()) continue
    const content = await readFile(absolutePath, "utf8")
    const frontmatter = parseFrontmatter(content)?.frontmatter ?? ""
    const address = frontmatter.match(/^address:\s+(c-[0-9]{6})\s*$/m)?.[1] as DragonScaleAddress | undefined
    const eligible = isEligiblePage(relativePath, frontmatter)
    pages.push({ relativePath, absolutePath, ...(address ? { address } : undefined), eligible })
  }
  return pages
}

function isEligiblePage(relativePath: string, frontmatter: string): boolean {
  if (!relativePath.startsWith("wiki/")) return false
  if (EXCLUDED_FILENAMES.has(path.basename(relativePath))) return false
  if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return false
  const type = frontmatter.match(/^type:\s*([^ \n]+)/m)?.[1]
  if (type === "meta" || type === "fold") return false
  const created = frontmatter.match(/^created:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/m)?.[1]
  if (created && created < ROLLOUT_DATE) return false
  return true
}

function parseFrontmatter(content: string): { readonly frontmatter: string; readonly body: string } | null {
  if (!content.startsWith("---\n")) return null
  const end = content.indexOf("\n---", 4)
  if (end === -1) return null
  return {
    frontmatter: content.slice(4, end),
    body: content.slice(end + "\n---".length),
  }
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/")
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/wiki-page-addresses.test.ts
```

Expected: PASS.

### Task 4: Implement Ingest Intent Detection

**Files:**
- Create: `desktop/electron/services/knowledge-base/ingest-intent.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/ingest-intent.test.ts`

- [ ] **Step 1: Write failing intent tests**

Create `desktop/electron/services/knowledge-base/__tests__/ingest-intent.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { isKnowledgeBaseIngestIntent } from "../ingest-intent"

describe("isKnowledgeBaseIngestIntent", () => {
  it.each([
    "/wiki ingest",
    "/wiki ingest --force",
    "汲取知识",
    "提取知识",
    "导入这些来源",
    "把这些资料整理进知识库",
    "ingest sources",
    "process these sources",
    "add this to the wiki",
  ])("detects ingest intent: %s", (content) => {
    expect(isKnowledgeBaseIngestIntent(content)).toBe(true)
  })

  it.each([
    "/wiki query",
    "/wiki hot",
    "查询知识库",
    "刷新热点",
    "保存这段对话",
    "what does the wiki say about planning",
  ])("ignores non-ingest intent: %s", (content) => {
    expect(isKnowledgeBaseIngestIntent(content)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-intent.test.ts
```

Expected: FAIL because `ingest-intent.ts` does not exist.

- [ ] **Step 3: Implement detector**

Create `desktop/electron/services/knowledge-base/ingest-intent.ts`:

```ts
const NATURAL_INGEST_PATTERNS = [
  /汲取知识/,
  /提取知识/,
  /入库/,
  /导入.*(来源|资料|知识库|wiki)/,
  /整理.*(知识库|wiki)/,
  /\bingest\b/i,
  /\bprocess\b.*\bsource/i,
  /\badd\b.*\bwiki\b/i,
] as const

export function isKnowledgeBaseIngestIntent(content: string): boolean {
  const trimmed = content.trim()
  if (/^\/wiki\s+ingest(?:\s|$)/i.test(trimmed)) {
    return true
  }
  if (/^\/wiki\s+/i.test(trimmed)) {
    return false
  }
  return NATURAL_INGEST_PATTERNS.some((pattern) => pattern.test(trimmed))
}
```

- [ ] **Step 4: Run intent tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-intent.test.ts
```

Expected: PASS.

### Task 5: Implement KnowledgeBaseIngestFinalizer

**Files:**
- Create: `desktop/electron/services/knowledge-base/ingest-finalizer.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts`

- [ ] **Step 1: Write failing finalizer tests**

Create `desktop/electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { KnowledgeBaseIngestFinalizer } from "../ingest-finalizer"
import { readKnowledgeBaseManifest } from "../manifest"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-finalizer-"))
  roots.push(dir)
  return dir
}

async function writeManifest(root: string, manifest: object): Promise<void> {
  await mkdir(path.join(root, ".raw"), { recursive: true })
  await writeFile(path.join(root, ".raw", ".manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseIngestFinalizer", () => {
  it("allocates an address for an eligible page and updates address_map", async () => {
    const root = await tempDir()
    await writeManifest(root, { version: 1, sources: {}, address_map: {} })
    const pagePath = path.join(root, "wiki", "concepts", "Alpha.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "---\ntype: concept\ntitle: Alpha\n---\n\n# Alpha\n")

    const result = await new KnowledgeBaseIngestFinalizer().finalize(root)

    expect(result.assigned).toEqual([{ path: "wiki/concepts/Alpha.md", address: "c-000001" }])
    await expect(readFile(pagePath, "utf8")).resolves.toContain("address: c-000001")
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8")).resolves.toBe("2\n")
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      status: "valid",
      manifest: {
        address_map: { "wiki/concepts/Alpha.md": "c-000001" },
      },
    })
  })

  it("reuses an existing page address without incrementing the counter", async () => {
    const root = await tempDir()
    await writeManifest(root, { version: 1, sources: {}, address_map: {} })
    const pagePath = path.join(root, "wiki", "entities", "Team.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "---\ntype: entity\naddress: c-000009\n---\n\n# Team\n")

    const result = await new KnowledgeBaseIngestFinalizer().finalize(root)

    expect(result.reused).toEqual([{ path: "wiki/entities/Team.md", address: "c-000009" }])
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8")).rejects.toThrow()
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: {
        address_map: { "wiki/entities/Team.md": "c-000009" },
      },
    })
  })

  it("uses an existing address_map entry when the page lacks frontmatter address", async () => {
    const root = await tempDir()
    await writeManifest(root, {
      version: 1,
      sources: {},
      address_map: { "wiki/sources/Note.md": "c-000008" },
    })
    const pagePath = path.join(root, "wiki", "sources", "Note.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "---\ntype: source\n---\n\n# Note\n")

    const result = await new KnowledgeBaseIngestFinalizer().finalize(root)

    expect(result.reused).toEqual([{ path: "wiki/sources/Note.md", address: "c-000008" }])
    await expect(readFile(pagePath, "utf8")).resolves.toContain("address: c-000008")
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8")).rejects.toThrow()
  })

  it("preserves manifest sources while merging address_map", async () => {
    const root = await tempDir()
    await writeManifest(root, {
      version: 1,
      created: "2026-05-23",
      description: "Ingest delta tracker and address map for the Synapse knowledge base.",
      sources: {
        ".raw/a.md": {
          hash: "hash-a",
          ingested_at: "2026-05-23T00:00:00.000Z",
          pages_created: ["wiki/concepts/Alpha.md"],
          pages_updated: [],
        },
      },
      address_map: {},
    })
    const pagePath = path.join(root, "wiki", "concepts", "Alpha.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "---\ntype: concept\n---\n\n# Alpha\n")

    await new KnowledgeBaseIngestFinalizer().finalize(root)

    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: {
        created: "2026-05-23",
        sources: {
          ".raw/a.md": {
            hash: "hash-a",
            ingested_at: "2026-05-23T00:00:00.000Z",
            pages_created: ["wiki/concepts/Alpha.md"],
            pages_updated: [],
          },
        },
        address_map: { "wiki/concepts/Alpha.md": "c-000001" },
      },
    })
  })

  it("skips invalid manifests without writing addresses", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", ".manifest.json"), "{ bad json")
    const pagePath = path.join(root, "wiki", "concepts", "Alpha.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "---\ntype: concept\n---\n\n# Alpha\n")

    const result = await new KnowledgeBaseIngestFinalizer().finalize(root)

    expect(result.skippedReason).toBe("invalid-manifest")
    await expect(readFile(pagePath, "utf8")).resolves.not.toContain("address:")
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts
```

Expected: FAIL because `ingest-finalizer.ts` does not exist.

- [ ] **Step 3: Implement finalizer**

Create `desktop/electron/services/knowledge-base/ingest-finalizer.ts`:

```ts
import type { DragonScaleAddressService } from "./dragonscale/address-service"
import { DragonScaleAddressService as DefaultDragonScaleAddressService } from "./dragonscale/address-service"
import type { DragonScaleAddress } from "./dragonscale/types"
import { readKnowledgeBaseManifest, writeKnowledgeBaseManifest } from "./manifest"
import { insertAddressIntoWikiPage, readAddressedWikiPages } from "./wiki-page-addresses"

export interface KnowledgeBaseIngestFinalizerResult {
  readonly assigned: readonly { readonly path: string; readonly address: DragonScaleAddress }[]
  readonly reused: readonly { readonly path: string; readonly address: DragonScaleAddress }[]
  readonly skippedReason?: "invalid-manifest"
}

type KnowledgeBaseIngestFinalizerDeps = {
  readonly addressService?: DragonScaleAddressService
}

export class KnowledgeBaseIngestFinalizer {
  private readonly addressService: DragonScaleAddressService

  constructor(deps: KnowledgeBaseIngestFinalizerDeps = {}) {
    this.addressService = deps.addressService ?? new DefaultDragonScaleAddressService()
  }

  async finalize(projectPath: string): Promise<KnowledgeBaseIngestFinalizerResult> {
    const readResult = await readKnowledgeBaseManifest(projectPath)
    if (readResult.status === "invalid") {
      return { assigned: [], reused: [], skippedReason: "invalid-manifest" }
    }

    const manifest = readResult.manifest
    const nextAddressMap = { ...manifest.address_map }
    const assigned: { path: string; address: DragonScaleAddress }[] = []
    const reused: { path: string; address: DragonScaleAddress }[] = []
    const pages = await readAddressedWikiPages(projectPath)

    for (const page of pages) {
      const existing = page.address ?? nextAddressMap[page.relativePath] as DragonScaleAddress | undefined
      if (existing) {
        if (!page.address) {
          await insertAddressIntoWikiPage(page.absolutePath, existing)
        }
        nextAddressMap[page.relativePath] = existing
        reused.push({ path: page.relativePath, address: existing })
        continue
      }

      const allocation = await this.addressService.allocate(projectPath)
      await insertAddressIntoWikiPage(page.absolutePath, allocation.address)
      nextAddressMap[page.relativePath] = allocation.address
      assigned.push({ path: page.relativePath, address: allocation.address })
    }

    if (assigned.length > 0 || reused.length > 0) {
      await writeKnowledgeBaseManifest(projectPath, {
        ...manifest,
        address_map: nextAddressMap,
      })
    }

    return { assigned, reused }
  }
}
```

- [ ] **Step 4: Run finalizer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts
```

Expected: PASS.

### Task 6: Add Agent Runtime afterTurn Hook

**Files:**
- Modify: `desktop/electron/services/agent-runtime/project-contributions.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`

- [ ] **Step 1: Add a failing conversation-router test**

In `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`, add a test near the existing `prepareMessage` tests:

```ts
it("calls afterTurn after a live turn completes", async () => {
  const afterTurn = vi.fn()
  const session = new ScriptedSession([
    { type: "result", content: "reply", done: true, sdkSessionId: "sdk-1" },
  ], "sdk-1")
  const { router } = createRouter({ session, afterTurn })

  const result = await router.send(baseMessage("hello"))

  expect(afterTurn).toHaveBeenCalledWith(expect.objectContaining({
    message: expect.objectContaining({ content: "hello" }),
    result: expect.objectContaining({ resultText: "reply" }),
  }))
})
```

In the same test file, update the `createRouter` helper input type to include:

```ts
  readonly afterTurn?: ConversationRouterDeps["afterTurn"]
```

and pass it into `ConversationRouter` deps:

```ts
      afterTurn: input.afterTurn,
```

Do not alter production code before seeing this test fail.

- [ ] **Step 2: Run the focused test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts --testNamePattern "afterTurn"
```

Expected: FAIL because the runtime does not expose or call `afterTurn`.

- [ ] **Step 3: Extend contribution types**

In `desktop/electron/services/agent-runtime/project-contributions.ts`, import `AgentRuntimeTurnResult`:

```ts
import type { AgentMessage, AgentRuntimeTurnResult } from "./types"
```

Add:

```ts
export type AgentProjectAfterTurnInput = {
  readonly message: AgentMessage
  readonly result: AgentRuntimeTurnResult
  readonly conversationId: string
  readonly isNewLiveSession: boolean
}
```

Add to `AgentProjectContribution`:

```ts
  afterTurn?(input: AgentProjectAfterTurnInput): void | Promise<void>
```

Add to merged contribution:

```ts
    async afterTurn(input) {
      for (const contribution of contributions) {
        await Promise.resolve(contribution.afterTurn?.(input))
      }
    },
```

- [ ] **Step 4: Thread afterTurn through runtime deps**

In `desktop/electron/services/agent-runtime/agent-runtime-service.ts`, add the dependency type:

```ts
  readonly afterTurn?: (input: AgentProjectAfterTurnInput) => void | Promise<void>
```

Import `AgentProjectAfterTurnInput` from `project-contributions`.

When constructing `ConversationRouter`, pass:

```ts
afterTurn: deps.afterTurn,
```

In `desktop/electron/services/agent-runtime/conversation-router.ts`, add the dependency:

```ts
  readonly afterTurn?: (input: AgentProjectAfterTurnInput) => void | Promise<void>
```

Import `AgentProjectAfterTurnInput`.

Add a private helper:

```ts
  private async runAfterTurn(
    message: AgentMessage,
    result: AgentRuntimeTurnResult,
    conversationId: string,
    isNewLiveSession: boolean,
  ): Promise<void> {
    if (!this.deps.afterTurn) return
    try {
      await Promise.resolve(this.deps.afterTurn({ message, result, conversationId, isNewLiveSession }))
    } catch (error) {
      this.deps.logger?.warn("Agent afterTurn hook failed.", {
        boundary: "agent-runtime.after-turn",
        conversationId,
        error: errorMetadata(error),
      })
    }
  }
```

After each successful live turn result is built, call:

```ts
await this.runAfterTurn(message, result, conversation.id, sessionHandle.created)
```

Keep the Agent result unchanged even when `afterTurn` throws.

In `desktop/electron/services/agent-runtime/index.ts`, pass:

```ts
        afterTurn: async (input) => {
          const contribution = await resolveAgentProjectContribution(ctx.projectId)
          await contribution.afterTurn?.(input)
        },
```

- [ ] **Step 5: Run afterTurn tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts --testNamePattern "afterTurn"
```

Expected: PASS.

### Task 7: Wire Knowledge Base Contribution To Finalizer

**Files:**
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

- [ ] **Step 1: Add failing contribution tests**

In `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`, update the Vitest import:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
```

Then add these tests inside `describe("knowledge base Agent contribution", ...)`:

```ts
it("runs the ingest finalizer after natural-language ingest turns", async () => {
  const projectPath = await tempDir()
  const finalize = vi.fn(async () => ({ assigned: [], reused: [] }))

  const contribution = await createKnowledgeBaseAgentContribution({
    project: knowledgeBaseProject(projectPath),
    ingestFinalizer: { finalize },
  })

  await contribution?.afterTurn?.({
    message: baseMessage("汲取知识"),
    result: { conversationId: "conv-1", resultText: "done", events: [] },
    conversationId: "conv-1",
    isNewLiveSession: false,
  })

  expect(finalize).toHaveBeenCalledWith(projectPath)
})

it("does not run the ingest finalizer for query turns", async () => {
  const projectPath = await tempDir()
  const finalize = vi.fn(async () => ({ assigned: [], reused: [] }))

  const contribution = await createKnowledgeBaseAgentContribution({
    project: knowledgeBaseProject(projectPath),
    ingestFinalizer: { finalize },
  })

  await contribution?.afterTurn?.({
    message: baseMessage("/wiki query topic"),
    result: { conversationId: "conv-1", resultText: "done", events: [] },
    conversationId: "conv-1",
    isNewLiveSession: false,
  })

  expect(finalize).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run contribution tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts --testNamePattern "ingest finalizer"
```

Expected: FAIL because `createKnowledgeBaseAgentContribution` does not accept `ingestFinalizer` and does not define `afterTurn`.

- [ ] **Step 3: Wire finalizer**

In `desktop/electron/services/knowledge-base/agent-contribution.ts`, update imports:

```ts
import { KnowledgeBaseIngestFinalizer } from "./ingest-finalizer"
import { isKnowledgeBaseIngestIntent } from "./ingest-intent"
```

Update input type:

```ts
type CreateKnowledgeBaseAgentContributionInput = {
  readonly project: SynapseProjectConfig
  readonly ingestFinalizer?: Pick<KnowledgeBaseIngestFinalizer, "finalize">
}
```

Inside `createKnowledgeBaseAgentContribution`, create:

```ts
  const ingestFinalizer = input.ingestFinalizer ?? new KnowledgeBaseIngestFinalizer()
```

Add to the returned contribution:

```ts
    async afterTurn({ message, result }) {
      if (result.error) return
      if (!isKnowledgeBaseIngestIntent(message.content)) return
      await ingestFinalizer.finalize(input.project.path)
    },
```

- [ ] **Step 4: Run contribution tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts --testNamePattern "ingest finalizer"
```

Expected: PASS.

### Task 8: Update Ingest Prompt And Skill Ownership Wording

**Files:**
- Modify: `desktop/electron/services/knowledge-base/wiki-command-copy.ts`
- Modify: `desktop/resources/knowledge-base/prompts/ingest.md`
- Modify: `desktop/resources/knowledge-base/claude-plugin/skills/wiki-ingest/SKILL.md`
- Modify: `desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts`

- [ ] **Step 1: Add failing prompt copy assertions**

In `desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts`, update the ingest prompt test with:

```ts
    expect(content).toContain("Synapse 会在导入回合结束后补齐 DragonScale 地址")
    expect(content).toContain("不要编辑 `.vault-meta/address-counter.txt`")
```

- [ ] **Step 2: Run prompt test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts --testNamePattern "ingest prompt"
```

Expected: FAIL because the copy is not present.

- [ ] **Step 3: Update command appendix copy**

In `desktop/electron/services/knowledge-base/wiki-command-copy.ts`, add these lines to `wikiIngestAppendixCopy` under "## 清单更新要求":

```ts
    "- Synapse 会在导入回合结束后补齐 DragonScale 地址并更新 `address_map`。",
    "- 不要编辑 `.vault-meta/address-counter.txt`；地址计数器由 Synapse 内部服务维护。",
    "- 如果重写已有页面，保留页面中已有的 `address:` frontmatter。",
```

- [ ] **Step 4: Update `ingest.md`**

In `desktop/resources/knowledge-base/prompts/ingest.md`, replace the current address allocation bullet:

```md
- `address_map` 维护 wiki 页面路径到稳定地址的映射；已有页面复用原地址，新页面按现有最大 `c-NNNNNN` 递增分配。
```

with:

```md
- Synapse 会在导入回合结束后补齐 DragonScale 地址并更新 `address_map`。
- 不要编辑 `.vault-meta/address-counter.txt`，不要自行发明新的 `c-NNNNNN` 地址。
- 如果重写已有页面，保留页面中已有的 `address:` frontmatter。
```

- [ ] **Step 5: Update `wiki-ingest` skill**

In `desktop/resources/knowledge-base/claude-plugin/skills/wiki-ingest/SKILL.md`, replace the manifest/address section after ingest with:

```md
- Update `.raw/.manifest.json` using the claude-obsidian compatible shape: `version`, `created`, `description`, `sources`, and `address_map`.
- For each processed source, record `hash`, `ingested_at`, `pages_created`, and `pages_updated` when those facts are available.
- Do not edit `.vault-meta/address-counter.txt`.
- Do not invent new `c-NNNNNN` addresses.
- Preserve existing `address:` frontmatter when rewriting a page.
- Synapse runs a DragonScale address finalizer after ingest to assign missing addresses and merge `address_map`.
```

- [ ] **Step 6: Run prompt tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts
```

Expected: PASS.

### Task 9: Export New Knowledge Base Internals

**Files:**
- Modify: `desktop/electron/services/knowledge-base/index.ts`

- [ ] **Step 1: Export finalizer and helpers**

Append exports:

```ts
export {
  KnowledgeBaseIngestFinalizer,
} from "./ingest-finalizer"
export {
  isKnowledgeBaseIngestIntent,
} from "./ingest-intent"
export type {
  KnowledgeBaseIngestFinalizerResult,
} from "./ingest-finalizer"
```

- [ ] **Step 2: Run TypeScript typecheck for exports**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

### Task 10: Focused Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts \
  electron/services/knowledge-base/__tests__/manifest-writer.test.ts \
  electron/services/knowledge-base/__tests__/wiki-page-addresses.test.ts \
  electron/services/knowledge-base/__tests__/ingest-intent.test.ts \
  electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts \
  electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts \
  electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts \
  electron/services/agent-runtime/__tests__/conversation-router.test.ts
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

- [ ] **Step 4: Verify user vault templates stay clean**

Run:

```bash
find desktop/resources/knowledge-base/templates -maxdepth 5 -type f | sort | rg "(scripts/|allocate-address|boundary-score|tiling-check|SKILL.md|CLAUDE.md|hooks/|agents/|commands/)" || true
```

Expected: no output.

- [ ] **Step 5: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

---

## Self-Review

- This plan implements only DragonScale address finalization for ingest.
- It does not implement boundary scoring.
- It does not implement semantic tiling.
- It does not put scripts or runnable Agent resources into the user vault.
- It keeps source files under `.raw/` read-only except `.raw/.manifest.json`.
- It makes natural-language ingest and `/wiki ingest` share the same finalizer path.
