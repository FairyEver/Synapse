# Knowledge Base AI Chat MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Synapse-only Knowledge Base AI chat MVP: resilient hot-cache rehydration, image/vision ingestion, and upstream-aligned `/wiki research`.

**Architecture:** Keep user vaults as clean Obsidian-compatible data folders. Add Synapse-owned Electron services and Agent project contributions that inject hot cache, stage image intake records, and orchestrate research prompts/reports only for local renderer Knowledge Base conversations. Preserve the existing deterministic ingest and manifest finalization path.

**Tech Stack:** Electron main process, React renderer, TypeScript, Claude Code SDK project contributions, shadcn/Radix renderer UI, Vitest.

---

## Reference Documents

- Check: `docs/superpowers/specs/2026-05-24-knowledge-base-ai-chat-mvp-check.md`
- Existing design: `docs/superpowers/specs/2026-05-21-knowledge-base-project-capability-design.md`
- Existing deterministic ingest design: `docs/superpowers/specs/2026-05-24-knowledge-base-deterministic-manifest-finalization-design.md`
- Existing boundary scoring design: `docs/superpowers/specs/2026-05-24-dragonscale-boundary-scoring-design.md`

## Files And Responsibilities

- `desktop/electron/services/knowledge-base/hot-cache-state.ts` — persist per-conversation hot-cache injection metadata.
- `desktop/electron/services/knowledge-base/agent-contribution.ts` — inject hot cache on new/stale/changed sessions; route research finalization.
- `desktop/electron/services/knowledge-base/source-staging.ts` — stage image files as immutable `.raw/images/...md` intake records and copy originals to `_attachments/images/...`.
- `desktop/electron/services/knowledge-base/source-scan.ts` — ensure `.raw/images/*.md` intake records are scanned like other Markdown sources.
- `desktop/electron/services/knowledge-base/ingest-coordinator.ts` — append image-specific ingest instructions when changed sources include image intake records.
- `desktop/electron/services/knowledge-base/research-coordinator.ts` — prepare research turns, require report contract, validate report, and run post-turn warnings.
- `desktop/electron/services/knowledge-base/research-report.ts` — parse and validate `synapse_kb_research_report`.
- `desktop/electron/services/knowledge-base/research-preflight.ts` — keep explicit-topic and boundary-candidate behavior; expose stable appendix.
- `desktop/electron/services/knowledge-base/wiki-command-prompts.ts` — route `/wiki research` through the coordinator.
- `desktop/resources/knowledge-base/prompts/research.md` — align prompt with upstream autoresearch loop and Synapse report contract.
- `desktop/resources/knowledge-base/prompts/ingest.md` — instruct image intake behavior without editing `.raw/images/*.md`.
- `desktop/src/modules/knowledge-base/source-manager-window.tsx` — no major UI redesign; verify image files upload through existing file picker/drop flow.
- Tests under `desktop/electron/services/knowledge-base/__tests__/` and `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`.

## Task 1: Hot Cache Rehydration State

**Files:**
- Create: `desktop/electron/services/knowledge-base/hot-cache-state.ts`
- Modify: `desktop/electron/services/knowledge-base/index.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/hot-cache-state.test.ts`

- [ ] **Step 1: Write state-store tests**

Create `desktop/electron/services/knowledge-base/__tests__/hot-cache-state.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { KnowledgeBaseHotCacheStateStore } from "../hot-cache-state"

describe("KnowledgeBaseHotCacheStateStore", () => {
  it("requires injection when there is no prior state", async () => {
    const store = new KnowledgeBaseHotCacheStateStore()
    await expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-a",
      nowMs: 1_000,
      staleAfterMs: 4 * 60 * 60 * 1000,
    })).resolves.toBe(true)
  })

  it("does not require injection when hash is unchanged and state is fresh", async () => {
    const store = new KnowledgeBaseHotCacheStateStore()
    await store.markInjected({ conversationId: "conv-1", hotHash: "hash-a", injectedAtMs: 1_000 })
    await expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-a",
      nowMs: 2_000,
      staleAfterMs: 4 * 60 * 60 * 1000,
    })).resolves.toBe(false)
  })

  it("requires injection when hot cache changed", async () => {
    const store = new KnowledgeBaseHotCacheStateStore()
    await store.markInjected({ conversationId: "conv-1", hotHash: "hash-a", injectedAtMs: 1_000 })
    await expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-b",
      nowMs: 2_000,
      staleAfterMs: 4 * 60 * 60 * 1000,
    })).resolves.toBe(true)
  })

  it("requires injection when prior state is stale", async () => {
    const store = new KnowledgeBaseHotCacheStateStore()
    await store.markInjected({ conversationId: "conv-1", hotHash: "hash-a", injectedAtMs: 1_000 })
    await expect(store.shouldInject({
      conversationId: "conv-1",
      hotHash: "hash-a",
      nowMs: 1_000 + 5 * 60 * 60 * 1000,
      staleAfterMs: 4 * 60 * 60 * 1000,
    })).resolves.toBe(true)
  })
})
```

- [ ] **Step 2: Run the failing test**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/hot-cache-state.test.ts
```

Expected: fail because `hot-cache-state.ts` does not exist.

- [ ] **Step 3: Implement the state store**

Create `desktop/electron/services/knowledge-base/hot-cache-state.ts`:

```ts
export interface KnowledgeBaseHotCacheState {
  readonly conversationId: string
  readonly hotHash: string
  readonly injectedAtMs: number
}

export interface KnowledgeBaseHotCacheShouldInjectInput {
  readonly conversationId: string
  readonly hotHash: string
  readonly nowMs: number
  readonly staleAfterMs: number
}

export class KnowledgeBaseHotCacheStateStore {
  private readonly states = new Map<string, KnowledgeBaseHotCacheState>()

  async shouldInject(input: KnowledgeBaseHotCacheShouldInjectInput): Promise<boolean> {
    const state = this.states.get(input.conversationId)
    if (!state) return true
    if (state.hotHash !== input.hotHash) return true
    return input.nowMs - state.injectedAtMs >= input.staleAfterMs
  }

  async markInjected(state: KnowledgeBaseHotCacheState): Promise<void> {
    this.states.set(state.conversationId, state)
  }
}
```

Modify `desktop/electron/services/knowledge-base/index.ts` to export it:

```ts
export {
  KnowledgeBaseHotCacheStateStore,
  type KnowledgeBaseHotCacheShouldInjectInput,
  type KnowledgeBaseHotCacheState,
} from "./hot-cache-state"
```

- [ ] **Step 4: Verify the test passes**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/hot-cache-state.test.ts
```

Expected: pass.

## Task 2: Inject Hot Cache On Stale Or Changed Resumes

**Files:**
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

- [ ] **Step 1: Add tests for stale and changed hot cache**

Add tests to `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts` near the existing hot-cache tests:

```ts
it("injects hot cache for a reused conversation when the cache changed", async () => {
  const projectPath = await createKnowledgeBaseProject()
  const hotPath = path.join(projectPath, "wiki", "hot.md")
  await writeFile(hotPath, "# Hot\n\nFirst fact.\n")
  const contribution = await createKnowledgeBaseAgentContribution({
    project: knowledgeBaseProject(projectPath),
    nowMs: () => 1_000,
  })

  await contribution?.prepareMessage?.(baseMessage("first"), {
    isNewLiveSession: true,
    conversationId: "conv-1",
    turnId: "turn-1",
  })

  await writeFile(hotPath, "# Hot\n\nSecond fact.\n")
  const prepared = await contribution?.prepareMessage?.(baseMessage("resume"), {
    isNewLiveSession: false,
    conversationId: "conv-1",
    turnId: "turn-2",
  })

  expect(prepared?.content).toContain("Second fact.")
  expect(prepared?.content).toContain("User message:")
})

it("injects hot cache for a reused conversation when prior injection is stale", async () => {
  const projectPath = await createKnowledgeBaseProject()
  await writeFile(path.join(projectPath, "wiki", "hot.md"), "# Hot\n\nStale refresh fact.\n")
  let now = 1_000
  const contribution = await createKnowledgeBaseAgentContribution({
    project: knowledgeBaseProject(projectPath),
    nowMs: () => now,
    hotCacheStaleAfterMs: 4 * 60 * 60 * 1000,
  })

  await contribution?.prepareMessage?.(baseMessage("first"), {
    isNewLiveSession: true,
    conversationId: "conv-1",
    turnId: "turn-1",
  })

  now += 5 * 60 * 60 * 1000
  const prepared = await contribution?.prepareMessage?.(baseMessage("afternoon"), {
    isNewLiveSession: false,
    conversationId: "conv-1",
    turnId: "turn-2",
  })

  expect(prepared?.content).toContain("Stale refresh fact.")
  expect(prepared?.content).toContain("afternoon")
})
```

The target file already defines `tempDir()`, `knowledgeBaseProject(projectPath)`, and `baseMessage(content)` helpers; use those helper names exactly.

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts --testNamePattern "hot cache"
```

Expected: fail because contribution deps do not yet accept `nowMs`, `hotCacheStaleAfterMs`, or stateful resume injection.

- [ ] **Step 3: Update contribution dependencies**

Modify `desktop/electron/services/knowledge-base/agent-contribution.ts`:

```ts
import { createHash } from "node:crypto"
import { KnowledgeBaseHotCacheStateStore } from "./hot-cache-state"
```

Extend `CreateKnowledgeBaseAgentContributionInput`:

```ts
readonly hotCacheStateStore?: KnowledgeBaseHotCacheStateStore
readonly hotCacheStaleAfterMs?: number
readonly nowMs?: () => number
```

In `createKnowledgeBaseAgentContribution`, create:

```ts
const hotCacheStateStore = input.hotCacheStateStore ?? new KnowledgeBaseHotCacheStateStore()
const hotCacheStaleAfterMs = input.hotCacheStaleAfterMs ?? 4 * 60 * 60 * 1000
const nowMs = input.nowMs ?? (() => Date.now())
```

Replace the `context.isNewLiveSession`-only block with:

```ts
const hotCache = await readOptional(hotCachePath)
const hotHash = hashHotCache(hotCache)
const shouldInjectHot = context.isNewLiveSession || await hotCacheStateStore.shouldInject({
  conversationId: context.conversationId,
  hotHash,
  nowMs: nowMs(),
  staleAfterMs: hotCacheStaleAfterMs,
})
if (shouldInjectHot) {
  await hotCacheStateStore.markInjected({
    conversationId: context.conversationId,
    hotHash,
    injectedAtMs: nowMs(),
  })
  next = prependBootstrap(message, bootstrap, hotCache)
}
```

Add helper:

```ts
function hashHotCache(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}
```

When natural-language ingest also prepends bootstrap, reuse the already computed `hotCache` and `shouldInjectHot` state so it does not double-read or skip changed cache.

- [ ] **Step 4: Verify focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts --testNamePattern "hot cache"
```

Expected: pass.

## Task 3: Image Source Staging

**Files:**
- Modify: `desktop/electron/services/knowledge-base/source-staging.ts`
- Modify: `desktop/src/types/knowledge-base.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/source-staging-image.test.ts`

- [ ] **Step 1: Write image staging tests**

Create `desktop/electron/services/knowledge-base/__tests__/source-staging-image.test.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { stageKnowledgeBaseSources } from "../source-staging"

describe("stageKnowledgeBaseSources image intake", () => {
  it("copies image originals to attachments and creates immutable raw intake records", async () => {
    const root = await makeTempKnowledgeBase()
    const imagePath = path.join(root, "source.png")
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await stageKnowledgeBaseSources({
      projectPath: root,
      filePaths: [imagePath],
      now: () => new Date("2026-05-24T10:00:00.000Z"),
      converter: {
        convert: async () => {
          throw new Error("converter should not be called for images")
        },
      },
    })

    expect(result.skipped).toEqual([])
    expect(result.uploaded).toHaveLength(1)
    expect(result.uploaded[0]?.relativePath).toBe(".raw/images/2026/05/24/source.md")
    expect(result.uploaded[0]?.originalRelativePath).toBe("_attachments/images/2026/05/24/source.png")

    const intake = await readFile(path.join(root, ".raw/images/2026/05/24/source.md"), "utf8")
    expect(intake).toContain("source_type: image")
    expect(intake).toContain("attachment: _attachments/images/2026/05/24/source.png")
    expect(intake).toContain("source_format: png")
  })
})

async function makeTempKnowledgeBase(): Promise<string> {
  const root = path.join(process.cwd(), "tmp", `kb-image-${crypto.randomUUID()}`)
  await mkdir(root, { recursive: true })
  return root
}
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/source-staging-image.test.ts
```

Expected: fail because image staging is not implemented.

- [ ] **Step 3: Add image extension handling**

Modify `desktop/electron/services/knowledge-base/source-staging.ts`:

```ts
const IMAGE_SOURCE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"])
```

Before text-source handling, add:

```ts
if (IMAGE_SOURCE_EXTENSIONS.has(extension)) {
  const imageRelativeDir = path.join("_attachments", "images", ...datePathSegments(input.now()))
  const imageDir = assertInside(projectPath, path.join(projectPath, imageRelativeDir))
  await assertNoSymlinkInRelativePath(projectPath, imageRelativeDir)
  await mkdir(imageDir, { recursive: true })
  const imageTargetPath = await resolveCollisionPath(imageDir, path.basename(sourcePath))
  await copyFile(sourcePath, imageTargetPath)
  const imageRelativePath = normalizeRelativePath(path.relative(projectPath, imageTargetPath))

  const rawRelativeDir = path.join(".raw", "images", ...datePathSegments(input.now()))
  const rawDir = assertInside(projectPath, path.join(projectPath, rawRelativeDir))
  await assertNoSymlinkInRelativePath(projectPath, rawRelativeDir)
  await mkdir(rawDir, { recursive: true })
  const intakePath = await resolveCollisionPath(rawDir, `${path.parse(sourcePath).name}.md`)
  const intakeRelativePath = normalizeRelativePath(path.relative(projectPath, intakePath))
  await writeFile(intakePath, imageIntakeMarkdown({
    title: path.parse(sourcePath).name,
    originalPath: filePath,
    attachment: imageRelativePath,
    format: extension.slice(1),
    stagedAt: input.now().toISOString(),
  }), "utf8")

  uploaded.push({
    originalPath: filePath,
    relativePath: intakeRelativePath,
    originalRelativePath: imageRelativePath,
    name: path.basename(intakePath),
    size: sourceStat.size,
  })
  continue
}
```

Add helper:

```ts
function imageIntakeMarkdown(input: {
  readonly title: string
  readonly originalPath: string
  readonly attachment: string
  readonly format: string
  readonly stagedAt: string
}): string {
  return [
    "---",
    "source_type: image",
    `title: "${input.title.replaceAll("\"", "\\\"")}"`,
    `original_file: "${input.originalPath.replaceAll("\"", "\\\"")}"`,
    `attachment: ${input.attachment}`,
    `source_format: ${input.format}`,
    `staged_at: ${input.stagedAt}`,
    "---",
    "",
    `# Image Intake: ${input.title}`,
    "",
    `Attachment: ![[${input.attachment}]]`,
    "",
    "Synapse image intake record. During `/wiki ingest`, read the attachment image and create the durable visual/OCR description under `wiki/sources/`.",
    "",
  ].join("\n")
}
```

- [ ] **Step 4: Verify image staging test**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/source-staging-image.test.ts
```

Expected: pass.

## Task 4: Image-Aware Ingest Prompt

**Files:**
- Modify: `desktop/electron/services/knowledge-base/ingest-coordinator.ts`
- Modify: `desktop/resources/knowledge-base/prompts/ingest.md`
- Test: `desktop/electron/services/knowledge-base/__tests__/ingest-coordinator-image.test.ts`

- [ ] **Step 1: Write image prompt test**

Create `desktop/electron/services/knowledge-base/__tests__/ingest-coordinator-image.test.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { KnowledgeBaseIngestCoordinator } from "../ingest-coordinator"

describe("KnowledgeBaseIngestCoordinator image intake", () => {
  it("adds image intake instructions when changed sources include image records", async () => {
    const root = await makeImageVault()
    const coordinator = new KnowledgeBaseIngestCoordinator({
      readPrompt: async () => "执行知识库导入。",
    })

    const output = await coordinator.prepareTurn({
      projectPath: root,
      turnId: "turn-1",
      originalContent: "/wiki ingest",
      force: false,
    })

    expect(output.kind).toBe("prompt")
    if (output.kind !== "prompt") throw new Error("expected prompt")
    expect(output.content).toContain("Image Intake Sources")
    expect(output.content).toContain("_attachments/images/2026/05/24/diagram.png")
    expect(output.content).toContain("Do not edit `.raw/images/")
  })
})

async function makeImageVault(): Promise<string> {
  const root = path.join(process.cwd(), "tmp", `kb-image-ingest-${crypto.randomUUID()}`)
  await mkdir(path.join(root, ".raw/images/2026/05/24"), { recursive: true })
  await mkdir(path.join(root, "_attachments/images/2026/05/24"), { recursive: true })
  await mkdir(path.join(root, "wiki"), { recursive: true })
  await writeFile(path.join(root, ".raw/.manifest.json"), JSON.stringify({ version: 1, sources: {}, address_map: {} }))
  await writeFile(path.join(root, "wiki/index.md"), "# Index\n")
  await writeFile(path.join(root, "wiki/hot.md"), "# Hot\n")
  await writeFile(path.join(root, "wiki/log.md"), "# Log\n")
  await writeFile(path.join(root, "_attachments/images/2026/05/24/diagram.png"), Buffer.from([0x89, 0x50]))
  await writeFile(path.join(root, ".raw/images/2026/05/24/diagram.md"), [
    "---",
    "source_type: image",
    "attachment: _attachments/images/2026/05/24/diagram.png",
    "source_format: png",
    "---",
    "",
    "# Image Intake: diagram",
    "",
  ].join("\n"))
  return root
}
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-coordinator-image.test.ts
```

Expected: fail because image-specific instructions are absent.

- [ ] **Step 3: Implement image appendix**

In `desktop/electron/services/knowledge-base/ingest-coordinator.ts`, after `wikiIngestAppendixCopy(...)`, append an image appendix when changed sources include `.raw/images/`:

```ts
const imageSources = changedSources.filter((source) => source.relativePath.startsWith(".raw/images/"))
const imageAppendix = imageSources.length > 0
  ? imageIntakeAppendixCopy(imageSources.map((source) => source.relativePath))
  : ""
```

Add `imageAppendix` before `reportContractCopy()`.

Add helper:

```ts
function imageIntakeAppendixCopy(sourcePaths: readonly string[]): string {
  return [
    "## Image Intake Sources",
    "",
    "These `.raw/images/...md` files are immutable intake records for image attachments.",
    "For each image intake source:",
    "- Read the intake Markdown.",
    "- Read the referenced attachment image with the Agent image-reading capability.",
    "- Extract visible text, diagram structure, key entities, concepts, and data.",
    "- Write the durable description and source summary under `wiki/sources/`.",
    "- Create or update related `wiki/concepts/`, `wiki/entities/`, and `wiki/questions/` pages when useful.",
    "- Do not edit `.raw/images/*.md`.",
    "",
    ...sourcePaths.map((sourcePath) => `- ${sourcePath}`),
  ].join("\n")
}
```

Update `desktop/resources/knowledge-base/prompts/ingest.md` with the same rule in natural language:

```md
图片来源规则：
- `.raw/images/...md` 是不可变 intake record。
- 读取其中的 attachment 路径后，用 Agent 图片读取能力抽取可见文字、图表结构、实体、概念和数据。
- 把持久描述写到 `wiki/sources/`，不要改写 `.raw/images/...md`。
```

- [ ] **Step 4: Verify image prompt test**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-coordinator-image.test.ts
```

Expected: pass.

## Task 5: Research Report Parser

**Files:**
- Create: `desktop/electron/services/knowledge-base/research-report.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/research-report.test.ts`

- [ ] **Step 1: Write parser tests**

Create `desktop/electron/services/knowledge-base/__tests__/research-report.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseKnowledgeBaseResearchReport } from "../research-report"

describe("parseKnowledgeBaseResearchReport", () => {
  it("parses one valid research report", () => {
    const result = parseKnowledgeBaseResearchReport([
      "Done.",
      "```synapse_kb_research_report",
      JSON.stringify({
        schema: "synapse.kb.research.report.v1",
        topic: "Graph databases",
        rounds: 2,
        searches: 8,
        pages_created: ["wiki/questions/Research - Graph databases.md"],
        pages_updated: ["wiki/index.md", "wiki/hot.md", "wiki/log.md"],
        sources: ["wiki/sources/Example.md"],
      }),
      "```",
    ].join("\n"))

    expect(result.status).toBe("valid")
    if (result.status !== "valid") throw new Error("expected valid")
    expect(result.report.topic).toBe("Graph databases")
  })

  it("rejects missing reports", () => {
    expect(parseKnowledgeBaseResearchReport("plain text").status).toBe("invalid")
  })
})
```

- [ ] **Step 2: Run parser tests and verify failure**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/research-report.test.ts
```

Expected: fail because parser file does not exist.

- [ ] **Step 3: Implement parser**

Create `desktop/electron/services/knowledge-base/research-report.ts`:

```ts
export const KNOWLEDGE_BASE_RESEARCH_REPORT_SCHEMA = "synapse.kb.research.report.v1"

export interface KnowledgeBaseResearchReport {
  readonly schema: typeof KNOWLEDGE_BASE_RESEARCH_REPORT_SCHEMA
  readonly topic: string
  readonly rounds: number
  readonly searches: number
  readonly pagesCreated: readonly string[]
  readonly pagesUpdated: readonly string[]
  readonly sources: readonly string[]
}

export type KnowledgeBaseResearchReportParseResult =
  | { readonly status: "valid"; readonly report: KnowledgeBaseResearchReport }
  | { readonly status: "invalid"; readonly warnings: readonly { readonly code: string; readonly message: string }[] }

const REPORT_RE = /```synapse_kb_research_report\s*([\s\S]*?)```/g

export function parseKnowledgeBaseResearchReport(text: string): KnowledgeBaseResearchReportParseResult {
  const matches = [...text.matchAll(REPORT_RE)]
  if (matches.length === 0) return invalid("report-missing", "Missing synapse_kb_research_report block.")
  if (matches.length > 1) return invalid("report-multiple", "Multiple synapse_kb_research_report blocks found.")
  let raw: unknown
  try {
    raw = JSON.parse(matches[0]?.[1] ?? "")
  } catch {
    return invalid("report-json", "Research report is not valid JSON.")
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("report-object", "Research report must be a JSON object.")
  }
  const record = raw as Record<string, unknown>
  if (record.schema !== KNOWLEDGE_BASE_RESEARCH_REPORT_SCHEMA) {
    return invalid("report-schema", "Research report schema mismatch.")
  }
  if (typeof record.topic !== "string" || !record.topic.trim()) {
    return invalid("report-topic", "Research report topic is required.")
  }
  if (typeof record.rounds !== "number" || record.rounds < 1 || record.rounds > 3) {
    return invalid("report-rounds", "Research report rounds must be 1-3.")
  }
  if (typeof record.searches !== "number" || record.searches < 0) {
    return invalid("report-searches", "Research report searches must be non-negative.")
  }
  const pagesCreated = stringArray(record.pages_created)
  const pagesUpdated = stringArray(record.pages_updated)
  const sources = stringArray(record.sources)
  if (!pagesCreated || !pagesUpdated || !sources) {
    return invalid("report-arrays", "Research report page and source fields must be string arrays.")
  }
  return {
    status: "valid",
    report: {
      schema: KNOWLEDGE_BASE_RESEARCH_REPORT_SCHEMA,
      topic: record.topic,
      rounds: record.rounds,
      searches: record.searches,
      pagesCreated,
      pagesUpdated,
      sources,
    },
  }
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null
}

function invalid(code: string, message: string): KnowledgeBaseResearchReportParseResult {
  return { status: "invalid", warnings: [{ code, message }] }
}
```

- [ ] **Step 4: Verify parser tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/research-report.test.ts
```

Expected: pass.

## Task 6: Research Coordinator And Prompt Contract

**Files:**
- Create: `desktop/electron/services/knowledge-base/research-coordinator.ts`
- Modify: `desktop/electron/services/knowledge-base/wiki-command-prompts.ts`
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Modify: `desktop/electron/services/knowledge-base/index.ts`
- Modify: `desktop/resources/knowledge-base/prompts/research.md`
- Test: `desktop/electron/services/knowledge-base/__tests__/research-coordinator.test.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts`

- [ ] **Step 1: Write coordinator tests**

Create `desktop/electron/services/knowledge-base/__tests__/research-coordinator.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { KnowledgeBaseResearchCoordinator } from "../research-coordinator"

describe("KnowledgeBaseResearchCoordinator", () => {
  it("builds an explicit-topic research prompt with report contract", async () => {
    const coordinator = new KnowledgeBaseResearchCoordinator({
      readPrompt: async () => "执行知识库研究入库。",
      researchPreflight: {
        prepare: async () => ({ mode: "explicit-topic", topic: "Graph databases" }),
      },
    })

    const output = await coordinator.prepareTurn({
      projectPath: "/vault",
      args: ["Graph", "databases"],
    })

    expect(output.kind).toBe("prompt")
    if (output.kind !== "prompt") throw new Error("expected prompt")
    expect(output.content).toContain("Graph databases")
    expect(output.content).toContain("synapse_kb_research_report")
    expect(output.content).toContain("Max rounds: 3")
  })

  it("finalizes only when the report is valid", async () => {
    const finalize = vi.fn(async () => ({ addressMap: {}, skippedReason: undefined }))
    const coordinator = new KnowledgeBaseResearchCoordinator({
      readPrompt: async () => "",
      addressFinalizer: { finalize },
    })

    const result = await coordinator.finalizeTurn({
      projectPath: "/vault",
      assistantText: [
        "```synapse_kb_research_report",
        JSON.stringify({
          schema: "synapse.kb.research.report.v1",
          topic: "Graph databases",
          rounds: 1,
          searches: 2,
          pages_created: ["wiki/questions/Research - Graph databases.md"],
          pages_updated: ["wiki/index.md", "wiki/hot.md", "wiki/log.md"],
          sources: ["wiki/sources/Example.md"],
        }),
        "```",
      ].join("\n"),
    })

    expect(result.status).toBe("finalized")
    expect(finalize).toHaveBeenCalledWith("/vault")
  })
})
```

- [ ] **Step 2: Run coordinator tests and verify failure**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/research-coordinator.test.ts
```

Expected: fail because coordinator does not exist.

- [ ] **Step 3: Implement coordinator**

Create `desktop/electron/services/knowledge-base/research-coordinator.ts`:

```ts
import type { RegisteredPromptCommandOutput } from "../agent-runtime/command-router"
import { KnowledgeBaseIngestFinalizer } from "./ingest-finalizer"
import { KnowledgeBaseResearchPreflightService, formatKnowledgeBaseResearchAppendix } from "./research-preflight"
import { KNOWLEDGE_BASE_RESEARCH_REPORT_SCHEMA, parseKnowledgeBaseResearchReport } from "./research-report"

type AddressFinalizerLike = Pick<KnowledgeBaseIngestFinalizer, "finalize">

export class KnowledgeBaseResearchCoordinator {
  private readonly readPrompt: (fileName: string) => Promise<string>
  private readonly researchPreflight: Pick<KnowledgeBaseResearchPreflightService, "prepare">
  private readonly addressFinalizer: AddressFinalizerLike

  constructor(deps: {
    readonly readPrompt: (fileName: string) => Promise<string>
    readonly researchPreflight?: Pick<KnowledgeBaseResearchPreflightService, "prepare">
    readonly addressFinalizer?: AddressFinalizerLike
  }) {
    this.readPrompt = deps.readPrompt
    this.researchPreflight = deps.researchPreflight ?? new KnowledgeBaseResearchPreflightService()
    this.addressFinalizer = deps.addressFinalizer ?? new KnowledgeBaseIngestFinalizer()
  }

  async prepareTurn(input: { readonly projectPath: string; readonly args: readonly string[] }): Promise<RegisteredPromptCommandOutput> {
    const topic = input.args.join(" ").trim()
    const preflight = await this.researchPreflight.prepare(input.projectPath, topic)
    return {
      kind: "prompt",
      content: [
        await this.readPrompt("research.md"),
        "",
        formatKnowledgeBaseResearchAppendix(preflight),
        "",
        researchLoopContractCopy(),
        "",
        researchReportContractCopy(),
      ].join("\n"),
    }
  }

  async finalizeTurn(input: { readonly projectPath: string; readonly assistantText: string }): Promise<{
    readonly status: "finalized" | "skipped"
    readonly message?: string
  }> {
    const parsed = parseKnowledgeBaseResearchReport(input.assistantText)
    if (parsed.status !== "valid") {
      return { status: "skipped", message: "知识库研究后置写入未完成：缺少有效 synapse_kb_research_report。" }
    }
    const result = await this.addressFinalizer.finalize(input.projectPath)
    return result.skippedReason
      ? { status: "skipped", message: "知识库研究后置写入未完成：manifest 无效。" }
      : { status: "finalized" }
  }
}

function researchLoopContractCopy(): string {
  return [
    "## Research Loop Contract",
    "",
    "- Max rounds: 3",
    "- Round 1: broad search across 3-5 angles.",
    "- Round 2: gap fill based on missing or contradictory findings.",
    "- Round 3: optional contradiction or synthesis check.",
    "- Use WebSearch and WebFetch only through the active Agent permission flow.",
    "- File results into wiki pages; do not return only a chat answer.",
  ].join("\n")
}

function researchReportContractCopy(): string {
  return [
    "最后必须输出一个 `synapse_kb_research_report` fenced JSON block。",
    "```synapse_kb_research_report",
    JSON.stringify({
      schema: KNOWLEDGE_BASE_RESEARCH_REPORT_SCHEMA,
      topic: "Example topic",
      rounds: 2,
      searches: 8,
      pages_created: ["wiki/questions/Research - Example topic.md"],
      pages_updated: ["wiki/index.md", "wiki/hot.md", "wiki/log.md"],
      sources: ["wiki/sources/Example source.md"],
    }, null, 2),
    "```",
  ].join("\n")
}
```

- [ ] **Step 4: Route `/wiki research` through the coordinator**

Modify `desktop/electron/services/knowledge-base/wiki-command-prompts.ts` so `buildResearchOutput` delegates to `KnowledgeBaseResearchCoordinator.prepareTurn`.

Modify `desktop/electron/services/knowledge-base/agent-contribution.ts` so `afterTurn` for research calls `researchCoordinator.finalizeTurn` instead of directly calling the address finalizer.

Export coordinator and report parser from `desktop/electron/services/knowledge-base/index.ts`.

- [ ] **Step 5: Update research prompt**

Modify `desktop/resources/knowledge-base/prompts/research.md` so it explicitly says:

```md
不要只回复聊天结论。研究完成后必须写入 wiki 页面。

输出位置：
- `wiki/sources/`：主要来源；
- `wiki/concepts/`：可复用概念；
- `wiki/entities/`：重要实体；
- `wiki/questions/Research - <Topic>.md`：综合页。

网络检索：
- 使用 Agent 的 WebSearch/WebFetch 能力。
- 遵守 Synapse 权限提示；不要试图绕过权限。
- 最多 3 轮：广泛搜索、补缺搜索、必要时矛盾核查。
```

- [ ] **Step 6: Verify research tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/research-report.test.ts electron/services/knowledge-base/__tests__/research-coordinator.test.ts electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts
```

Expected: pass.

## Task 7: End-To-End Knowledge Base Contribution Tests

**Files:**
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

- [ ] **Step 1: Add contribution-level coverage**

Add tests that verify:

```ts
it("publishes research action only for knowledge-base local renderer conversations", async () => {
  const contribution = await createKnowledgeBaseAgentContribution({
    project: knowledgeBaseProject(await createKnowledgeBaseProject()),
  })
  expect(contribution?.publishedCommands?.some((command) => command.name === "wiki research")).toBe(true)
})

it("does not inject hot cache into scheduled or non-local messages", async () => {
  const projectPath = await createKnowledgeBaseProject()
  await writeFile(path.join(projectPath, "wiki", "hot.md"), "# Hot\n\nPrivate recent fact.\n")
  const contribution = await createKnowledgeBaseAgentContribution({
    project: knowledgeBaseProject(projectPath),
  })
  const prepared = await contribution?.prepareMessage?.({
    ...baseMessage("hello"),
    platform: "scheduled",
  }, {
    isNewLiveSession: true,
    conversationId: "conv-1",
    turnId: "turn-1",
  })
  expect(prepared?.content).toBe("hello")
})
```

Use the actual platform literal supported by the local test helpers.

- [ ] **Step 2: Verify contribution tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: pass.

## Task 8: Source Manager Image Smoke Coverage

**Files:**
- Modify: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Add renderer smoke test**

Add a test that creates a dropped file with a mocked `filePathForDroppedFile` returning `/tmp/diagram.png`, then verifies `uploadSources` receives that path. The UI should not need new controls.

```ts
it("passes dropped image files to knowledge-base upload", async () => {
  render(<KnowledgeBaseSourceManagerWindow />)
  bridgeMocks.knowledgeBase.filePathForDroppedFile.mockReturnValue("/tmp/diagram.png")
  const dropZone = screen.getByText("放入资料").closest("div")
  if (!dropZone) throw new Error("missing drop zone")

  fireEvent.drop(dropZone, {
    dataTransfer: {
      files: [new File(["image"], "diagram.png", { type: "image/png" })],
    },
  })

  await waitFor(() => {
    expect(bridgeMocks.knowledgeBase.uploadSources).toHaveBeenCalledWith({
      projectPath: "/Users/example/kb",
      filePaths: ["/tmp/diagram.png"],
    })
  })
})
```

The target file already defines `renderWindow()`, `waitForExpectation(assertion)`, and `bridgeMocks`; use those helper names exactly.

- [ ] **Step 2: Verify renderer test**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: pass.

## Task 9: Final Boundary Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused Knowledge Base tests**

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/knowledge-base/__tests__/hot-cache-state.test.ts \
  electron/services/knowledge-base/__tests__/source-staging-image.test.ts \
  electron/services/knowledge-base/__tests__/ingest-coordinator-image.test.ts \
  electron/services/knowledge-base/__tests__/research-report.test.ts \
  electron/services/knowledge-base/__tests__/research-coordinator.test.ts \
  electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts \
  electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts \
  src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass.

- [ ] **Step 3: Verify vault template cleanliness**

```bash
find desktop/resources/knowledge-base/templates -maxdepth 6 -type f | rg "(SKILL.md|\\.claude|\\.agents|\\.codex|commands/|hooks/|plugin|script|\\.obsidian|dashboard\\.base|\\.base|templates/)" || true
```

Expected: no matches.

- [ ] **Step 4: Verify ordinary systems are not coupled to Knowledge Base chat**

```bash
rg -n "knowledge-base|KnowledgeBase|wiki/hot|wiki research|source-staging" desktop/electron/services/task-scheduler desktop/electron/services/workflow desktop/action-packages || true
```

Expected: no production matches that load Knowledge Base chat behavior from Scheduler, Workflow, or action packages.

- [ ] **Step 5: Verify common file conversion remains Knowledge Base independent**

```bash
rg -n "knowledge-base|KnowledgeBase|\\.raw|wiki/|manifest" desktop/electron/services/file-conversion || true
```

Expected: no production coupling from common conversion service to Knowledge Base internals.

## Self-Review

- Spec coverage: hot cache resume, image/vision ingest, research loop, vault cleanliness, and ordinary-project isolation are mapped to tasks.
- Scope exclusions: URL ingest, canvas, automatic Git, Obsidian scaffold assets, and wiki-fold are intentionally excluded.
- Type consistency: new types use `KnowledgeBaseHotCache*`, `KnowledgeBaseResearch*`, and existing `RegisteredPromptCommandOutput` conventions.
- Boundary check: all AI behavior remains in Synapse resources and project contributions; user vault templates stay data-only.
