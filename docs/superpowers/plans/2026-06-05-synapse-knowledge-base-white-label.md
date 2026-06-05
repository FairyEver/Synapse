# Synapse Knowledge Base White Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `claude-obsidian` implementation identity with Synapse Knowledge Base while preserving Knowledge Base behavior and upstream sync.

**Architecture:** Keep upstream sync as a developer-only source concern, then transform the copied runtime into a Synapse-branded template before it is committed or packaged. Runtime code resolves the new template path by default, keeps an explicit one-version fallback for the old path, and leaves slash command behavior unchanged.

**Tech Stack:** Node.js ESM scripts, Electron main process TypeScript, React renderer TypeScript, Vitest, pnpm monorepo.

---

## File Map

- Create: `scripts/lib/synapse-knowledge-base-template-branding.mjs`
  - Pure ESM helpers for path constants, text replacement, plugin metadata rewriting, allowed-hit checks, and template validation.
- Create: `scripts/__tests__/synapse-knowledge-base-template-branding.test.mjs`
  - Node test coverage for branding helpers without cloning the upstream repository.
- Rename: `scripts/sync-claude-obsidian-template.mjs` -> `scripts/sync-synapse-knowledge-base-template.mjs`
  - Developer sync command that clones upstream and runs the branding helpers.
- Modify: `package.json`
  - Point `kb:sync-template` at the renamed script.
- Rename: `desktop/resources/knowledge-base/claude-obsidian-template/` -> `desktop/resources/knowledge-base/synapse-knowledge-base-template/`
  - Committed runtime template path.
- Modify: `desktop/resources/knowledge-base/synapse-knowledge-base-template/.claude-plugin/plugin.json`
  - Synapse runtime plugin identity.
- Modify: `desktop/resources/knowledge-base/synapse-knowledge-base-template/CLAUDE.md`
  - Synapse runtime instructions used by managed Knowledge Base Agent sessions.
- Modify: `desktop/resources/knowledge-base/synapse-knowledge-base-template/AGENTS.md`
  - Synapse runtime instructions for agent-compatible tools.
- Modify: `desktop/resources/knowledge-base/synapse-knowledge-base-template/GEMINI.md`
  - Synapse runtime instructions for Gemini-compatible tools.
- Modify: `desktop/resources/knowledge-base/synapse-knowledge-base-template/README.md`
  - Developer-facing Synapse template note.
- Modify: `desktop/resources/knowledge-base/synapse-knowledge-base-template/SOURCE.json`
  - Add `templateName: "synapse-knowledge-base"` and update notes.
- Modify: `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
  - Resolve the new canonical template path with old-path fallback.
- Modify: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`
  - Cover template path resolution and fallback behavior.
- Modify: `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`
  - Update template source fixture identity.
- Modify: `desktop/src/modules/agent/knowledge-base-commands.ts`
  - Remove user-facing `Obsidian` wording from static descriptions.
- Modify: `desktop/src/modules/agent/__tests__/slash-menu.test.ts`
  - Update descriptions while preserving command names and insert text.
- Modify: `docs/agent-guides/knowledge-base.md`
  - Point current guidance to the new canonical template path.
- Modify: `docs/superpowers/specs/2026-05-24-managed-knowledge-base-runtime-design.md`
  - Add a superseding note that template naming is now defined by the white-label design.
- Modify: `RELEASE_NOTES_PENDING.md`
  - Add a user-facing release note after implementation.

## Task 1: Add Sync Branding Helper Tests

**Files:**
- Create: `scripts/__tests__/synapse-knowledge-base-template-branding.test.mjs`
- Create later in Task 2: `scripts/lib/synapse-knowledge-base-template-branding.mjs`

- [ ] **Step 1: Write failing tests for plugin metadata, text branding, and allowed hits**

Create `scripts/__tests__/synapse-knowledge-base-template-branding.test.mjs`:

```js
import test from "node:test"
import assert from "node:assert/strict"

import {
  SYNAPSE_KB_TEMPLATE_NAME,
  brandTemplateText,
  findDisallowedBrandHits,
  rewritePluginManifest,
} from "../lib/synapse-knowledge-base-template-branding.mjs"

test("rewritePluginManifest gives the runtime a Synapse identity", () => {
  const rewritten = rewritePluginManifest({
    name: "claude-obsidian",
    version: "1.6.0",
    description: "Claude + Obsidian knowledge companion.",
    homepage: "https://github.com/AgriciDaniel/claude-obsidian",
    repository: "https://github.com/AgriciDaniel/claude-obsidian",
    keywords: ["obsidian", "knowledge-base", "wiki"],
  })

  assert.equal(rewritten.name, SYNAPSE_KB_TEMPLATE_NAME)
  assert.equal(rewritten.version, "1.6.0")
  assert.match(rewritten.description, /Synapse Knowledge Base/)
  assert.equal(rewritten.homepage, undefined)
  assert.equal(rewritten.repository, undefined)
  assert.deepEqual(rewritten.keywords, ["knowledge-base", "wiki", "markdown", "synapse"])
})

test("brandTemplateText replaces upstream runtime branding", () => {
  const input = [
    "# claude-obsidian — Claude + Obsidian Wiki Vault",
    "Install with claude-obsidian@claude-obsidian-marketplace.",
    "The claude-obsidian runtime keeps wiki notes.",
  ].join("\n")

  const output = brandTemplateText(input)

  assert.match(output, /# Synapse Knowledge Base/)
  assert.match(output, /Synapse Knowledge Base runtime keeps wiki notes/)
  assert.doesNotMatch(output, /claude-obsidian/)
  assert.doesNotMatch(output, /Claude \+ Obsidian/)
})

test("findDisallowedBrandHits ignores source and license files only", () => {
  const hits = findDisallowedBrandHits([
    {
      relativePath: "SOURCE.json",
      content: "https://github.com/AgriciDaniel/claude-obsidian",
    },
    {
      relativePath: "LICENSE",
      content: "claude-obsidian attribution",
    },
    {
      relativePath: "skills/wiki/SKILL.md",
      content: "Use claude-obsidian here",
    },
    {
      relativePath: "CLAUDE.md",
      content: "Synapse Knowledge Base",
    },
  ])

  assert.deepEqual(hits, [{
    relativePath: "skills/wiki/SKILL.md",
    match: "claude-obsidian",
  }])
})
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
node --test scripts/__tests__/synapse-knowledge-base-template-branding.test.mjs
```

Expected: FAIL with module-not-found for `scripts/lib/synapse-knowledge-base-template-branding.mjs`.

## Task 2: Implement Branding Helpers

**Files:**
- Create: `scripts/lib/synapse-knowledge-base-template-branding.mjs`
- Test: `scripts/__tests__/synapse-knowledge-base-template-branding.test.mjs`

- [ ] **Step 1: Add the branding helper module**

Create `scripts/lib/synapse-knowledge-base-template-branding.mjs`:

```js
import { existsSync } from "node:fs"
import { readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

export const SYNAPSE_KB_TEMPLATE_NAME = "synapse-knowledge-base"
export const SYNAPSE_KB_TEMPLATE_DIR = "desktop/resources/knowledge-base/synapse-knowledge-base-template"
export const LEGACY_KB_TEMPLATE_DIR = "desktop/resources/knowledge-base/claude-obsidian-template"

const BRAND_PATTERNS = [
  /claude-obsidian/gi,
  /Claude \+ Obsidian/g,
  /Claude Code plugin and an Obsidian vault/g,
  /Obsidian Wiki Vault/g,
]

const ALLOWED_BRAND_PATHS = [
  /^SOURCE\.json$/,
  /^LICENSE(?:\.md)?$/,
  /^NOTICE(?:\.md)?$/,
  /^ATTRIBUTION(?:\.md)?$/,
]

export function rewritePluginManifest(manifest) {
  return {
    ...manifest,
    name: SYNAPSE_KB_TEMPLATE_NAME,
    description: "Synapse Knowledge Base managed runtime. Provides wiki, source ingestion, query, save, lint, research, canvas, and maintenance skills for Synapse-managed knowledge bases.",
    homepage: undefined,
    repository: undefined,
    keywords: ["knowledge-base", "wiki", "markdown", "synapse"],
  }
}

export function brandTemplateText(content) {
  return BRAND_PATTERNS.reduce((current, pattern) => {
    if (pattern.source === "claude-obsidian") {
      return current.replace(pattern, SYNAPSE_KB_TEMPLATE_NAME)
    }
    if (pattern.source === "Claude \\+ Obsidian") {
      return current.replace(pattern, "Synapse Knowledge Base")
    }
    if (pattern.source === "Claude Code plugin and an Obsidian vault") {
      return current.replace(pattern, "Synapse-managed Knowledge Base runtime")
    }
    return current.replace(pattern, "Synapse Knowledge Base")
  }, content)
}

export function findDisallowedBrandHits(files) {
  const hits = []
  for (const file of files) {
    if (ALLOWED_BRAND_PATHS.some((pattern) => pattern.test(file.relativePath))) {
      continue
    }
    const match = file.content.match(/claude-obsidian|Claude \+ Obsidian/i)
    if (match?.[0]) {
      hits.push({ relativePath: file.relativePath, match: match[0] })
    }
  }
  return hits
}

export async function rewriteTemplateFiles(templateDir) {
  await rewritePluginFile(path.join(templateDir, ".claude-plugin", "plugin.json"))
  await writeRuntimeInstructionFiles(templateDir)
  await rewriteTextFiles(templateDir)
}

export async function validateTemplateBranding(templateDir) {
  const files = await readTextFiles(templateDir)
  const hits = findDisallowedBrandHits(files)
  if (hits.length > 0) {
    const summary = hits.map((hit) => `${hit.relativePath}: ${hit.match}`).join("\n")
    throw new Error(`Synapse Knowledge Base template contains upstream branding outside allowed files:\n${summary}`)
  }
}

async function rewritePluginFile(pluginPath) {
  const parsed = JSON.parse(await readFile(pluginPath, "utf8"))
  const rewritten = rewritePluginManifest(parsed)
  const withoutUndefined = Object.fromEntries(Object.entries(rewritten).filter(([, value]) => value !== undefined))
  await writeFile(pluginPath, `${JSON.stringify(withoutUndefined, null, 2)}\n`, "utf8")
}

async function writeRuntimeInstructionFiles(templateDir) {
  const runtimeInstructions = `# Synapse Knowledge Base Runtime

This directory is a Synapse-managed Knowledge Base runtime.

Use the wiki, source ingestion, query, save, lint, research, and canvas skills only for this managed knowledge base. Source files live in .raw, maintained knowledge lives in wiki, and runtime metadata lives in .vault-meta.

Do not expose the backing directory path to users. Do not treat ordinary projects as Knowledge Base runtimes.
`
  await writeFile(path.join(templateDir, "CLAUDE.md"), runtimeInstructions, "utf8")
  await writeFile(path.join(templateDir, "AGENTS.md"), runtimeInstructions, "utf8")
  await writeFile(path.join(templateDir, "GEMINI.md"), runtimeInstructions, "utf8")
  await writeFile(path.join(templateDir, "README.md"), `# Synapse Knowledge Base Template

Developer-synced runtime template for managed Synapse Knowledge Base projects.

This directory is packaged with Synapse and copied into app-managed Knowledge Base runtime directories. It is not a user-selected project folder.
`, "utf8")
}

async function rewriteTextFiles(templateDir) {
  for (const file of await readTextFiles(templateDir)) {
    if (ALLOWED_BRAND_PATHS.some((pattern) => pattern.test(file.relativePath))) {
      continue
    }
    const branded = brandTemplateText(file.content)
    if (branded !== file.content) {
      await writeFile(path.join(templateDir, file.relativePath), branded, "utf8")
    }
  }
}

async function readTextFiles(rootDir) {
  const files = []
  await walk(rootDir, async (filePath) => {
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join("/")
    if (!isTextFile(relativePath)) return
    const content = await readFile(filePath, "utf8")
    files.push({ relativePath, content })
  })
  return files
}

async function walk(dir, visit) {
  if (!existsSync(dir)) return
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(entryPath, visit)
    } else if (entry.isFile()) {
      await visit(entryPath)
    }
  }
}

function isTextFile(relativePath) {
  return /\.(json|md|mdc|txt|sh|py|base|canvas|css|yml|yaml)$/.test(relativePath)
}
```

- [ ] **Step 2: Run the helper tests**

Run:

```bash
node --test scripts/__tests__/synapse-knowledge-base-template-branding.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Commit branding helpers**

Run:

```bash
git add scripts/lib/synapse-knowledge-base-template-branding.mjs scripts/__tests__/synapse-knowledge-base-template-branding.test.mjs
git commit -m "test(kb): cover template white-label helpers"
```

Expected: commit succeeds.

## Task 3: Rename Sync Script And Template Path

**Files:**
- Rename: `scripts/sync-claude-obsidian-template.mjs` -> `scripts/sync-synapse-knowledge-base-template.mjs`
- Modify: `scripts/sync-synapse-knowledge-base-template.mjs`
- Modify: `package.json`
- Rename: `desktop/resources/knowledge-base/claude-obsidian-template/` -> `desktop/resources/knowledge-base/synapse-knowledge-base-template/`
- Modify: `desktop/resources/knowledge-base/synapse-knowledge-base-template/SOURCE.json`

- [ ] **Step 1: Rename the script and template directory**

Run:

```bash
git mv scripts/sync-claude-obsidian-template.mjs scripts/sync-synapse-knowledge-base-template.mjs
git mv desktop/resources/knowledge-base/claude-obsidian-template desktop/resources/knowledge-base/synapse-knowledge-base-template
```

Expected: `git status --short` shows two renames.

- [ ] **Step 2: Update the sync script to write the new path and run branding validation**

In `scripts/sync-synapse-knowledge-base-template.mjs`, replace the constants and add imports:

```js
import {
  SYNAPSE_KB_TEMPLATE_DIR,
  rewriteTemplateFiles,
  validateTemplateBranding,
} from "./lib/synapse-knowledge-base-template-branding.mjs"

const repoUrl = "https://github.com/AgriciDaniel/claude-obsidian.git"
const sourceRepoUrl = "https://github.com/AgriciDaniel/claude-obsidian"
const templateDir = path.resolve(SYNAPSE_KB_TEMPLATE_DIR)
const preservedFiles = new Set(["SOURCE.json"])
```

After `await preserveLicenseIfPresent(tmp)`, add:

```js
    await rewriteTemplateFiles(templateDir)
```

When writing `SOURCE.json`, use:

```js
    await writeFile(path.join(templateDir, "SOURCE.json"), `${JSON.stringify({
      templateName: "synapse-knowledge-base",
      repo: sourceRepoUrl,
      commit,
      syncedAt,
      notes: "Upstream source metadata for developer sync and attribution only.",
    }, null, 2)}\n`, "utf8")

    await validateTemplateBranding(templateDir)
```

- [ ] **Step 3: Update the root sync command**

In `package.json`, change:

```json
"kb:sync-template": "node scripts/sync-claude-obsidian-template.mjs"
```

to:

```json
"kb:sync-template": "node scripts/sync-synapse-knowledge-base-template.mjs"
```

- [ ] **Step 4: Update existing `SOURCE.json` in the renamed template**

Edit `desktop/resources/knowledge-base/synapse-knowledge-base-template/SOURCE.json` to:

```json
{
  "templateName": "synapse-knowledge-base",
  "repo": "https://github.com/AgriciDaniel/claude-obsidian",
  "commit": "75d3b6feb77b96c6bb16599c4550cc9703553d87",
  "syncedAt": "2026-05-24",
  "notes": "Upstream source metadata for developer sync and attribution only."
}
```

- [ ] **Step 5: Run script tests and inspect renames**

Run:

```bash
node --test scripts/__tests__/synapse-knowledge-base-template-branding.test.mjs
git status --short | sed -n '1,80p'
```

Expected: tests pass; status shows script rename, package update, and template directory rename.

- [ ] **Step 6: Commit script and path rename**

Run:

```bash
git add -A package.json scripts desktop/resources/knowledge-base
git commit -m "chore(kb): rename managed runtime template"
```

Expected: commit succeeds.

## Task 4: White-Label Committed Runtime Template

**Files:**
- Modify: `desktop/resources/knowledge-base/synapse-knowledge-base-template/.claude-plugin/plugin.json`
- Modify: `desktop/resources/knowledge-base/synapse-knowledge-base-template/CLAUDE.md`
- Modify: `desktop/resources/knowledge-base/synapse-knowledge-base-template/AGENTS.md`
- Modify: `desktop/resources/knowledge-base/synapse-knowledge-base-template/GEMINI.md`
- Modify: `desktop/resources/knowledge-base/synapse-knowledge-base-template/README.md`
- Modify: text files under `desktop/resources/knowledge-base/synapse-knowledge-base-template/skills/`, `commands/`, `hooks/`, `scripts/`, `bin/`, `.cursor/`, `.windsurf/`

- [ ] **Step 1: Run the branding pass on the committed template**

Run:

```bash
node --input-type=module -e 'import { rewriteTemplateFiles, validateTemplateBranding } from "./scripts/lib/synapse-knowledge-base-template-branding.mjs"; await rewriteTemplateFiles("desktop/resources/knowledge-base/synapse-knowledge-base-template"); await validateTemplateBranding("desktop/resources/knowledge-base/synapse-knowledge-base-template");'
```

Expected: command exits 0.

- [ ] **Step 2: Check that plugin metadata is Synapse-branded**

Run:

```bash
node --input-type=module -e 'const fs = await import("node:fs/promises"); const p = JSON.parse(await fs.readFile("desktop/resources/knowledge-base/synapse-knowledge-base-template/.claude-plugin/plugin.json", "utf8")); if (p.name !== "synapse-knowledge-base") throw new Error(`bad plugin name: ${p.name}`); console.log(p.name)'
```

Expected output:

```text
synapse-knowledge-base
```

- [ ] **Step 3: Run the allowlisted brand scan**

Run:

```bash
rg -n "claude-obsidian|Claude \\+ Obsidian" desktop/resources/knowledge-base/synapse-knowledge-base-template \
  --glob '!SOURCE.json' \
  --glob '!LICENSE*' \
  --glob '!NOTICE*' \
  --glob '!ATTRIBUTION*'
```

Expected: no output and exit code 1 from `rg`.

- [ ] **Step 4: Verify required runtime assets still exist**

Run:

```bash
test -d desktop/resources/knowledge-base/synapse-knowledge-base-template/.claude-plugin
test -d desktop/resources/knowledge-base/synapse-knowledge-base-template/skills/wiki-ingest
test -f desktop/resources/knowledge-base/synapse-knowledge-base-template/commands/save.md
test -d desktop/resources/knowledge-base/synapse-knowledge-base-template/hooks
test -d desktop/resources/knowledge-base/synapse-knowledge-base-template/scripts
test -f desktop/resources/knowledge-base/synapse-knowledge-base-template/CLAUDE.md
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit white-labeled template content**

Run:

```bash
git add desktop/resources/knowledge-base/synapse-knowledge-base-template
git commit -m "chore(kb): white-label runtime template"
```

Expected: commit succeeds.

## Task 5: Update KnowledgeBaseService Template Resolution

**Files:**
- Modify: `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`

- [ ] **Step 1: Write failing tests for new default path and legacy fallback**

Append these tests inside `describe("KnowledgeBaseService", () => { ... })` in `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`:

```ts
  it("uses the Synapse Knowledge Base template path by default", async () => {
    const userDataPath = await tempDir()
    const appRoot = await tempDir()
    const templateRoot = path.join(appRoot, "resources", "knowledge-base", "synapse-knowledge-base-template")
    await mkdir(path.join(templateRoot, "wiki"), { recursive: true })
    await mkdir(path.join(templateRoot, ".raw"), { recursive: true })
    await mkdir(path.join(templateRoot, ".vault-meta"), { recursive: true })
    await mkdir(path.join(templateRoot, ".claude-plugin"), { recursive: true })
    await writeFile(path.join(templateRoot, "wiki", "index.md"), "# Example Index\n", "utf8")
    await writeFile(path.join(templateRoot, ".claude-plugin", "plugin.json"), "{\"name\":\"synapse-knowledge-base\"}\n", "utf8")

    const service = new KnowledgeBaseService({
      userDataPath,
      getAppPathForTest: () => appRoot,
    })

    const result = await service.createManaged({ projectId: "kb-new-template", name: "Knowledge" })

    await expect(readFile(path.join(result.runtimePath, ".claude-plugin", "plugin.json"), "utf8"))
      .resolves.toContain("synapse-knowledge-base")
  })

  it("falls back to the legacy template path when the new template is absent", async () => {
    const userDataPath = await tempDir()
    const appRoot = await tempDir()
    const legacyTemplateRoot = path.join(appRoot, "resources", "knowledge-base", "claude-obsidian-template")
    await mkdir(path.join(legacyTemplateRoot, "wiki"), { recursive: true })
    await mkdir(path.join(legacyTemplateRoot, ".raw"), { recursive: true })
    await mkdir(path.join(legacyTemplateRoot, ".vault-meta"), { recursive: true })
    await mkdir(path.join(legacyTemplateRoot, ".claude-plugin"), { recursive: true })
    await writeFile(path.join(legacyTemplateRoot, "wiki", "index.md"), "# Example Index\n", "utf8")
    await writeFile(path.join(legacyTemplateRoot, ".claude-plugin", "plugin.json"), "{\"name\":\"legacy\"}\n", "utf8")

    const service = new KnowledgeBaseService({
      userDataPath,
      getAppPathForTest: () => appRoot,
    })

    const result = await service.createManaged({ projectId: "kb-legacy-template", name: "Knowledge" })

    await expect(readFile(path.join(result.runtimePath, ".claude-plugin", "plugin.json"), "utf8"))
      .resolves.toContain("legacy")
    expect(mocks.logger.warn).toHaveBeenCalledWith("Managed Knowledge Base template fell back to legacy path.", {
      legacyTemplateRoot,
    })
  })
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: FAIL because `getAppPathForTest` does not exist and the default resolver still points at the old path.

- [ ] **Step 3: Add injectable app path and fallback resolver**

In `desktop/electron/services/knowledge-base/knowledge-base-service.ts`, extend `KnowledgeBaseServiceDeps`:

```ts
  getAppPathForTest?: () => string
```

In the constructor, change managed template initialization to:

```ts
    this.managedTemplateRoot = deps.managedTemplateRoot ?? resolveManagedTemplateRoot(deps.getAppPathForTest)
```

Replace `resolveManagedTemplateRoot()` with:

```ts
function resolveManagedTemplateRoot(getAppPathForTest?: () => string): string {
  if (process.env.SYNAPSE_KB_MANAGED_TEMPLATE_ROOT) {
    return process.env.SYNAPSE_KB_MANAGED_TEMPLATE_ROOT
  }

  const resourcesRoot = isElectronAppPackaged()
    ? (process as NodeJS.Process & { resourcesPath: string }).resourcesPath
    : path.join(getAppPathForTest?.() ?? getElectronAppPath(), "resources")
  const canonicalRoot = path.join(resourcesRoot, "knowledge-base", "synapse-knowledge-base-template")
  if (existsSync(canonicalRoot)) {
    return canonicalRoot
  }

  const legacyRoot = path.join(resourcesRoot, "knowledge-base", "claude-obsidian-template")
  if (existsSync(legacyRoot)) {
    logger.warn("Managed Knowledge Base template fell back to legacy path.", {
      legacyTemplateRoot: legacyRoot,
    })
    return legacyRoot
  }

  return canonicalRoot
}
```

Add `existsSync` to the `node:fs` import:

```ts
import { constants, existsSync } from "node:fs"
```

- [ ] **Step 4: Run KnowledgeBaseService tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit service resolver update**

Run:

```bash
git add desktop/electron/services/knowledge-base/knowledge-base-service.ts desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
git commit -m "fix(kb): resolve Synapse runtime template path"
```

Expected: commit succeeds.

## Task 6: Update Knowledge Base UI Catalog Text And Tests

**Files:**
- Modify: `desktop/src/modules/agent/knowledge-base-commands.ts`
- Modify: `desktop/src/modules/agent/__tests__/slash-menu.test.ts`

- [ ] **Step 1: Write the expected description changes in the slash menu test**

In `desktop/src/modules/agent/__tests__/slash-menu.test.ts`, update expected descriptions for the two retained compatibility names:

```ts
{
  name: "obsidian-bases",
  description: "创建或编辑知识库表格视图",
  kind: "knowledgeBase",
  insertText: "/obsidian-bases ",
},
{
  name: "obsidian-markdown",
  description: "按知识库 Markdown 语法编写页面",
  kind: "knowledgeBase",
  insertText: "/obsidian-markdown ",
},
```

- [ ] **Step 2: Run the slash menu test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts
```

Expected: FAIL because implementation descriptions still mention `Obsidian`.

- [ ] **Step 3: Update the catalog descriptions without renaming commands**

In `desktop/src/modules/agent/knowledge-base-commands.ts`, change:

```ts
  knowledgeBaseCapability("obsidian-bases", "创建或编辑 Obsidian Bases"),
  knowledgeBaseCapability("obsidian-markdown", "按 Obsidian 语法编写页面"),
```

to:

```ts
  knowledgeBaseCapability("obsidian-bases", "创建或编辑知识库表格视图"),
  knowledgeBaseCapability("obsidian-markdown", "按知识库 Markdown 语法编写页面"),
```

- [ ] **Step 4: Run slash menu tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit catalog text update**

Run:

```bash
git add desktop/src/modules/agent/knowledge-base-commands.ts desktop/src/modules/agent/__tests__/slash-menu.test.ts
git commit -m "fix(kb): remove upstream wording from command catalog"
```

Expected: commit succeeds.

## Task 7: Update Docs, Release Notes, And Fixtures

**Files:**
- Modify: `docs/agent-guides/knowledge-base.md`
- Modify: `docs/superpowers/specs/2026-05-24-managed-knowledge-base-runtime-design.md`
- Modify: `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/source-scan.test.ts`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update current Knowledge Base guide**

In `docs/agent-guides/knowledge-base.md`, replace the purpose paragraph that names the old template with:

```md
The backing directory is initialized from `desktop/resources/knowledge-base/synapse-knowledge-base-template/`. That template is Synapse-branded runtime state synced from an upstream developer source by `pnpm run kb:sync-template`. It may contain Claude Code plugin, command, hook, skill, script, prompt, and wiki files because it is Synapse-owned runtime state, not a user-selected visible folder.
```

Replace the implementation note:

```md
- `pnpm run kb:sync-template` refreshes the developer template from the upstream runtime source and applies Synapse Knowledge Base branding before committing the template.
```

- [ ] **Step 2: Add superseding note to managed runtime design**

At the top of `docs/superpowers/specs/2026-05-24-managed-knowledge-base-runtime-design.md`, after the H1, add:

```md
> Template naming update: `docs/superpowers/specs/2026-06-05-synapse-knowledge-base-white-label-design.md` supersedes the `claude-obsidian-template` path and branding in this historical design. Current implementation work should use `synapse-knowledge-base-template` and keep upstream references isolated to sync metadata and attribution.
```

- [ ] **Step 3: Update tests and fixture text for current behavior**

In `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts` and `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`, update template source fixtures to include:

```ts
templateName: "synapse-knowledge-base",
repo: "https://github.com/AgriciDaniel/claude-obsidian",
```

In `desktop/electron/services/knowledge-base/__tests__/source-scan.test.ts`, rename the test title from:

```ts
it("preserves claude-obsidian manifest metadata and raw-relative source entries", async () => {
```

to:

```ts
it("preserves knowledge base manifest metadata and raw-relative source entries", async () => {
```

- [ ] **Step 4: Add release note**

Append this bullet to `RELEASE_NOTES_PENDING.md` in the current pending section:

```md
- 知识库内置运行模板统一改为 Synapse Knowledge Base 身份，避免在新建知识库、会话上下文和内置资源中暴露上游模板名称；现有知识库能力和命令保持不变。
```

- [ ] **Step 5: Run focused docs and fixture scans**

Run:

```bash
rg -n "claude-obsidian-template|Claude \\+ Obsidian" docs/agent-guides desktop/src package.json
rg -n "claude-obsidian-template" desktop/electron scripts --glob '!desktop/electron/services/knowledge-base/knowledge-base-service.ts' --glob '!scripts/lib/synapse-knowledge-base-template-branding.mjs'
```

Expected: no output. The service fallback and script helper are excluded because they intentionally keep the legacy path as a compatibility constant.

- [ ] **Step 6: Commit docs and fixtures**

Run:

```bash
git add docs/agent-guides/knowledge-base.md docs/superpowers/specs/2026-05-24-managed-knowledge-base-runtime-design.md desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts desktop/electron/services/knowledge-base/__tests__/source-scan.test.ts RELEASE_NOTES_PENDING.md
git commit -m "docs(kb): document Synapse runtime template identity"
```

Expected: commit succeeds.

## Task 8: Final Verification And Cleanup

**Files:**
- Inspect all modified files from previous tasks.

- [ ] **Step 1: Run script tests**

Run:

```bash
node --test scripts/__tests__/synapse-knowledge-base-template-branding.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run focused Knowledge Base Electron tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base electron/modules/knowledge-base/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run focused Agent slash tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/slash-menu.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the final brand scan**

Run:

```bash
rg -n "claude-obsidian|Claude \\+ Obsidian" \
  --glob '!desktop/resources/knowledge-base/synapse-knowledge-base-template/SOURCE.json' \
  --glob '!desktop/resources/knowledge-base/synapse-knowledge-base-template/LICENSE*' \
  --glob '!desktop/resources/knowledge-base/synapse-knowledge-base-template/NOTICE*' \
  --glob '!desktop/resources/knowledge-base/synapse-knowledge-base-template/ATTRIBUTION*'
```

Expected: remaining hits are limited to:

```text
scripts/sync-synapse-knowledge-base-template.mjs
scripts/lib/synapse-knowledge-base-template-branding.mjs
docs/superpowers/specs/2026-06-05-synapse-knowledge-base-white-label-design.md
docs/superpowers/plans/2026-06-05-synapse-knowledge-base-white-label.md
docs/superpowers/specs/2026-05-24-managed-knowledge-base-runtime-design.md
historical docs under docs/superpowers/plans or docs/superpowers/specs that describe old work
```

No hits should appear in current UI code, current Electron runtime code, package script command values, or non-allowed template runtime files.

- [ ] **Step 5: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 6: Commit final verification adjustments if any files changed**

If Step 4 or Step 5 required edits, run:

```bash
git add -A
git commit -m "chore(kb): finalize Synapse template white-labeling"
```

Expected: commit succeeds only when there are actual changes.

- [ ] **Step 7: Report final status**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: worktree is clean or contains only user-approved uncommitted files; recent commits show the task sequence.
