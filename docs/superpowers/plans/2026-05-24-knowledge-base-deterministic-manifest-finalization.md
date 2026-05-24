# Knowledge Base Deterministic Manifest Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Knowledge Base ingest fully deterministic by having Synapse, not the Agent, perform final `.raw/.manifest.json` `sources` and `address_map` writes.

**Architecture:** Keep semantic wiki writing in Claude Code, but route both `/wiki ingest` and natural-language ingest through a Synapse-owned ingest coordinator. The coordinator stores source preflight snapshots, injects a strict report contract, validates the Agent's post-turn report, updates manifest `sources`, runs DragonScale address finalization, and writes one normalized manifest.

**Tech Stack:** Electron main process, TypeScript, Node filesystem APIs, existing Agent Runtime project contributions, Claude Code SDK local plugins, Vitest.

---

## Related Design

- `docs/superpowers/specs/2026-05-24-knowledge-base-deterministic-manifest-finalization-design.md`
- `docs/agent-guides/knowledge-base.md`
- `docs/superpowers/specs/2026-05-23-dragonscale-ingest-address-finalizer-design.md`
- `docs/superpowers/specs/2026-05-21-wiki-phase1-design.md`

## File Map

- Modify: `desktop/electron/services/agent-runtime/project-contributions.ts`
  - Add `conversationId` and `turnId` to message preparation context.
- Modify: `desktop/electron/services/agent-runtime/command-router.ts`
  - Pass the same `turnId` into registered prompt command builders.
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
  - Create one turn id before command routing; pass it to command builders, `prepareMessage`, live turn processing, and `afterTurn`.
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
  - Carry the expanded context types through runtime deps.
- Modify: `desktop/electron/services/agent-runtime/index.ts`
  - Create a stable Knowledge Base contribution resolver per runtime service so ingest preflight state survives from `prepareMessage` to `afterTurn`.
- Modify: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`
  - Verify context propagation and afterTurn `turnId`.
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
  - Verify natural-language ingest receives source preflight and afterTurn finalizes manifest sources.
- Create: `desktop/electron/services/knowledge-base/wiki-snapshot.ts`
  - Snapshot wiki Markdown before and after an ingest turn.
- Create: `desktop/electron/services/knowledge-base/__tests__/wiki-snapshot.test.ts`
  - Cover created and updated page classification.
- Create: `desktop/electron/services/knowledge-base/ingest-report.ts`
  - Parse and validate the fenced `synapse_kb_ingest_report` JSON contract.
- Create: `desktop/electron/services/knowledge-base/__tests__/ingest-report.test.ts`
  - Cover valid report parsing and rejection cases.
- Create: `desktop/electron/services/knowledge-base/ingest-turn-store.ts`
  - Store preflight snapshots keyed by turn id inside the runtime-owned KB coordinator.
- Create: `desktop/electron/services/knowledge-base/manifest-finalizer.ts`
  - Merge trusted source hashes, validated report paths, and DragonScale address map into a single manifest write.
- Create: `desktop/electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts`
  - Cover source writes, preservation, invalid reports, invalid manifest, and address map merge.
- Create: `desktop/electron/services/knowledge-base/ingest-coordinator.ts`
  - Own prepare/finalize flow for both slash and natural-language ingest.
- Create: `desktop/electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts`
  - Cover end-to-end prepare/finalize behavior without launching Claude.
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
  - Route ingest message preparation and after-turn handling through the coordinator.
- Modify: `desktop/electron/services/knowledge-base/wiki-command-prompts.ts`
  - Delegate `/wiki ingest` prompt building to the coordinator using the real runtime `turnId`.
- Modify: `desktop/electron/services/knowledge-base/wiki-command-copy.ts`
  - Add report-contract prompt text and remove Agent-owned manifest-source write wording.
- Modify: `desktop/resources/knowledge-base/prompts/ingest.md`
  - State that Synapse writes manifest; require the report contract.
- Modify: `desktop/resources/knowledge-base/claude-plugin/skills/wiki-ingest/SKILL.md`
  - Same contract for natural-language skill routing.
- Modify: `desktop/resources/knowledge-base/prompts/bootstrap.md`
  - Mention that manifest facts are finalized by Synapse.
- Modify: `desktop/electron/services/knowledge-base/index.ts`
  - Export new services and types used by tests.
- Modify: `docs/agent-guides/knowledge-base.md`
  - Update design baseline: Agent writes wiki, Synapse writes manifest facts.

## Implementation Notes

- Keep all Knowledge Base-specific logic under `desktop/electron/services/knowledge-base/` or `desktop/resources/knowledge-base/`.
- Do not add renderer behavior.
- Do not add dependencies.
- Do not start the app or browser for verification.
- Use `writeKnowledgeBaseManifest` for all manifest writes.
- Preserve existing `address_map` finalizer behavior while moving the final manifest write into `ManifestFinalizer`.
- Use structured logger warnings for finalizer issues. Do not throw finalizer warnings back into the Agent result unless the existing runtime path already surfaces them.

---

### Task 1: Expand Agent Project Turn Context

**Files:**
- Modify: `desktop/electron/services/agent-runtime/project-contributions.ts`
- Modify: `desktop/electron/services/agent-runtime/command-router.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`

- [ ] **Step 1: Add failing context propagation tests**

Add a test near the existing `prepareMessage` tests in `conversation-router.test.ts`:

```ts
it("passes conversationId and turnId into prepareMessage and afterTurn", async () => {
  const seenPrepare: Array<{ conversationId?: string; turnId?: string }> = []
  const seenAfter: Array<{ conversationId?: string; turnId?: string }> = []
  const prepareMessage = vi.fn((message: AgentMessage, context: {
    readonly isNewLiveSession: boolean
    readonly conversationId: string
    readonly turnId: string
  }) => {
    seenPrepare.push({ conversationId: context.conversationId, turnId: context.turnId })
    return message
  })
  const afterTurn = vi.fn((input: { readonly conversationId: string; readonly turnId: string }) => {
    seenAfter.push({ conversationId: input.conversationId, turnId: input.turnId })
  })
  const { router } = createRouter({ prepareMessage, afterTurn })

  await router.send(baseMessage({ content: "hello", conversationId: "conv-ctx" }))

  expect(seenPrepare).toHaveLength(1)
  expect(seenAfter).toHaveLength(1)
  expect(seenPrepare[0]?.conversationId).toBe("conv-ctx")
  expect(seenAfter[0]?.conversationId).toBe("conv-ctx")
  expect(seenPrepare[0]?.turnId).toMatch(/[0-9a-f-]{36}/)
  expect(seenAfter[0]?.turnId).toBe(seenPrepare[0]?.turnId)
})
```

Add a second test proving registered prompt commands receive the same turn id:

```ts
it("passes the same turnId to registered prompt commands and afterTurn", async () => {
  const commandTurnIds: string[] = []
  const afterTurnIds: string[] = []
  const registeredPromptCommands = [{
    name: "test",
    buildPrompt: vi.fn((_args: readonly string[], _message: AgentMessage, context: { readonly turnId: string }) => {
      commandTurnIds.push(context.turnId)
      return { kind: "prompt" as const, content: "expanded" }
    }),
  }]
  const afterTurn = vi.fn((input: { readonly turnId: string }) => {
    afterTurnIds.push(input.turnId)
  })
  const { router } = createRouter({ registeredPromptCommands, afterTurn })

  await router.send(baseMessage({ content: "/test", conversationId: "conv-command" }))

  expect(commandTurnIds).toHaveLength(1)
  expect(afterTurnIds).toEqual(commandTurnIds)
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts --testNamePattern "passes conversationId and turnId"
```

Expected: FAIL because the context does not yet include `conversationId` and `turnId`.

- [ ] **Step 3: Update contribution context types**

In `project-contributions.ts`, change `AgentProjectMessageContext` and `AgentProjectAfterTurnInput` to:

```ts
export type AgentProjectMessageContext = {
  readonly isNewLiveSession: boolean
  readonly conversationId: string
  readonly turnId: string
}

export type AgentProjectAfterTurnInput = {
  readonly message: AgentMessage
  readonly result: AgentRuntimeTurnResult
  readonly conversationId: string
  readonly turnId: string
  readonly isNewLiveSession: boolean
}
```

- [ ] **Step 4: Add command route context**

In `command-router.ts`, add a route context type:

```ts
export interface AgentCommandRouteContext {
  readonly turnId: string
}
```

Update `RegisteredPromptCommand.buildPrompt`:

```ts
buildPrompt(
  args: readonly string[],
  message: AgentMessage,
  context: AgentCommandRouteContext,
): Promise<RegisteredPromptCommandOutput> | RegisteredPromptCommandOutput
```

Update `AgentCommandRouter.handle`:

```ts
async handle(
  message: AgentMessage,
  conversation: ConversationEntryV1,
  context: AgentCommandRouteContext,
): Promise<AgentCommandRouterResult | null> {
```

When invoking registered prompt commands:

```ts
const output = await Promise.resolve(promptCommand.buildPrompt(parsed.args, message, context))
```

- [ ] **Step 5: Create the turn id before command routing**

In `ConversationRouter.enqueueTurn`, create the turn id before `commandRouter.handle`:

```ts
const turnId = randomUUID()
let liveMessage = message
const commandResult = await this.commandRouter?.handle(message, conversation, { turnId })
```

In the direct command-result branch, remove the local `const turnId = randomUUID()` and reuse the existing `turnId`.

- [ ] **Step 6: Pass context in `ConversationRouter`**

In `processTurn`, update the `prepareMessage` call:

```ts
const preparedMessage = await Promise.resolve(this.deps.prepareMessage?.(liveMessage, {
  isNewLiveSession: sessionHandle.created,
  conversationId: conversation.id,
  turnId,
}) ?? liveMessage)
```

Update `runAfterTurn` signature and call:

```ts
await this.runAfterTurn(message, result, conversation.id, turnId, sessionHandle.created)
```

```ts
private async runAfterTurn(
  message: AgentMessage,
  result: AgentRuntimeTurnResult,
  conversationId: string,
  turnId: string,
  isNewLiveSession: boolean,
): Promise<void> {
  if (!this.deps.afterTurn) return
  try {
    await Promise.resolve(this.deps.afterTurn({ message, result, conversationId, turnId, isNewLiveSession }))
  } catch (error) {
    this.deps.logger?.warn("Agent afterTurn hook failed.", {
      boundary: "agent-runtime.after-turn",
      conversationId,
      turnId,
      error: errorMetadata(error),
    })
  }
}
```

- [ ] **Step 7: Pass the pre-created turn id into live processing**

Change `processTurn` to accept `turnId` instead of creating one internally:

```ts
private async processTurn(
  state: RuntimeSessionState,
  message: AgentMessage,
  liveMessage: AgentMessage,
  conversationId: string,
  turnId: string,
  abortSignal?: AbortSignal,
  liveEventTimeoutMs?: number,
): Promise<AgentRuntimeTurnResult> {
```

Remove the inner `const turnId = randomUUID()` from `processTurn`.

Update the call site in `enqueueTurn` so it passes the same `turnId` that was given to the command router:

```ts
return this.processTurn(state, message, liveMessage, conversation.id, turnId, options.abortSignal, options.liveEventTimeoutMs)
```

- [ ] **Step 8: Update runtime service dep types**

In `agent-runtime-service.ts`, update the local dependency types for `prepareMessage` and `afterTurn` so they use the expanded `AgentProjectMessageContext` and `AgentProjectAfterTurnInput`.

- [ ] **Step 9: Run router tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add desktop/electron/services/agent-runtime/project-contributions.ts \
        desktop/electron/services/agent-runtime/command-router.ts \
        desktop/electron/services/agent-runtime/conversation-router.ts \
        desktop/electron/services/agent-runtime/agent-runtime-service.ts \
        desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts
git commit -m "feat(agent): include turn context in project contributions"
```

---

### Task 2: Add Wiki Snapshot Service

**Files:**
- Create: `desktop/electron/services/knowledge-base/wiki-snapshot.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/wiki-snapshot.test.ts`
- Modify: `desktop/electron/services/knowledge-base/index.ts`

- [ ] **Step 1: Write failing snapshot tests**

Create `wiki-snapshot.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { diffWikiSnapshots, snapshotWikiMarkdown } from "../wiki-snapshot"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-snapshot-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("wiki snapshots", () => {
  it("detects created and updated wiki pages", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(root, "wiki", "sources", "old.md"), "# Old\n")
    const before = await snapshotWikiMarkdown(root)

    await writeFile(path.join(root, "wiki", "sources", "old.md"), "# Old\n\nUpdated\n")
    await writeFile(path.join(root, "wiki", "sources", "new.md"), "# New\n")
    const after = await snapshotWikiMarkdown(root)

    expect(diffWikiSnapshots(before, after)).toEqual({
      created: ["wiki/sources/new.md"],
      updated: ["wiki/sources/old.md"],
    })
  })

  it("ignores symlinked wiki paths", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki"), { recursive: true })
    await writeFile(path.join(root, "wiki", "index.md"), "# Index\n")

    await expect(snapshotWikiMarkdown(root)).resolves.toEqual(expect.objectContaining({
      files: expect.objectContaining({ "wiki/index.md": expect.any(Object) }),
    }))
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/wiki-snapshot.test.ts
```

Expected: FAIL because `wiki-snapshot.ts` does not exist.

- [ ] **Step 3: Implement snapshot service**

Create `wiki-snapshot.ts`:

```ts
import { createHash } from "node:crypto"
import type { Dirent } from "node:fs"
import { lstat, readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

export interface WikiSnapshotFile {
  readonly path: string
  readonly hash: string
  readonly size: number
  readonly mtimeMs: number
}

export interface WikiSnapshot {
  readonly files: Record<string, WikiSnapshotFile>
}

export interface WikiSnapshotDiff {
  readonly created: readonly string[]
  readonly updated: readonly string[]
}

export async function snapshotWikiMarkdown(projectPath: string): Promise<WikiSnapshot> {
  const root = path.resolve(projectPath)
  const wikiPath = path.join(root, "wiki")
  const files: Record<string, WikiSnapshotFile> = {}
  await walk(root, wikiPath, files)
  return { files }
}

export function diffWikiSnapshots(before: WikiSnapshot, after: WikiSnapshot): WikiSnapshotDiff {
  const created: string[] = []
  const updated: string[] = []
  for (const [relativePath, afterFile] of Object.entries(after.files)) {
    const beforeFile = before.files[relativePath]
    if (!beforeFile) {
      created.push(relativePath)
      continue
    }
    if (beforeFile.hash !== afterFile.hash) {
      updated.push(relativePath)
    }
  }
  return {
    created: created.sort((a, b) => a.localeCompare(b)),
    updated: updated.sort((a, b) => a.localeCompare(b)),
  }
}

async function walk(root: string, directoryPath: string, files: Record<string, WikiSnapshotFile>): Promise<void> {
  let entries: Dirent[]
  try {
    const directoryStat = await lstat(directoryPath)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return
    throw error
  }

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)
    const relativePath = normalizeRelativePath(path.relative(root, absolutePath))
    if (!isInside(root, absolutePath)) continue
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      await walk(root, absolutePath, files)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const content = await readFile(absolutePath)
    const fileStat = await stat(absolutePath)
    files[relativePath] = {
      path: relativePath,
      hash: createHash("sha256").update(content).digest("hex"),
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
    }
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, path.resolve(target))
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
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

- [ ] **Step 4: Export snapshot helpers**

In `knowledge-base/index.ts`, export:

```ts
export {
  diffWikiSnapshots,
  snapshotWikiMarkdown,
  type WikiSnapshot,
  type WikiSnapshotDiff,
  type WikiSnapshotFile,
} from "./wiki-snapshot"
```

- [ ] **Step 5: Run snapshot tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/wiki-snapshot.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/knowledge-base/wiki-snapshot.ts \
        desktop/electron/services/knowledge-base/__tests__/wiki-snapshot.test.ts \
        desktop/electron/services/knowledge-base/index.ts
git commit -m "feat(kb): add wiki snapshot diffing"
```

---

### Task 3: Add Ingest Report Parser

**Files:**
- Create: `desktop/electron/services/knowledge-base/ingest-report.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/ingest-report.test.ts`
- Modify: `desktop/electron/services/knowledge-base/index.ts`

- [ ] **Step 1: Write failing parser tests**

Create `ingest-report.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { parseKnowledgeBaseIngestReport } from "../ingest-report"

describe("parseKnowledgeBaseIngestReport", () => {
  it("parses the fenced report contract", () => {
    const text = [
      "done",
      "```synapse_kb_ingest_report",
      JSON.stringify({
        schema: "synapse.kb.ingest.report.v1",
        processed_sources: [{
          source: ".raw/a.md",
          pages_created: ["wiki/sources/a.md"],
          pages_updated: ["wiki/index.md"],
        }],
        skipped_sources: [{ source: ".raw/b.md", reason: "unchanged" }],
      }, null, 2),
      "```",
    ].join("\n")

    expect(parseKnowledgeBaseIngestReport(text)).toMatchObject({
      status: "valid",
      report: {
        processedSources: [{
          source: ".raw/a.md",
          pagesCreated: ["wiki/sources/a.md"],
          pagesUpdated: ["wiki/index.md"],
        }],
      },
    })
  })

  it("rejects missing reports", () => {
    expect(parseKnowledgeBaseIngestReport("done")).toEqual({
      status: "missing",
      warnings: [{ code: "report-missing", message: "Missing synapse_kb_ingest_report block." }],
    })
  })

  it("rejects multiple reports", () => {
    const block = "```synapse_kb_ingest_report\n{\"schema\":\"synapse.kb.ingest.report.v1\",\"processed_sources\":[]}\n```"
    expect(parseKnowledgeBaseIngestReport(`${block}\n${block}`)).toMatchObject({
      status: "invalid",
      warnings: [{ code: "report-multiple" }],
    })
  })

  it("rejects invalid schema", () => {
    const text = "```synapse_kb_ingest_report\n{\"schema\":\"bad\",\"processed_sources\":[]}\n```"
    expect(parseKnowledgeBaseIngestReport(text)).toMatchObject({
      status: "invalid",
      warnings: [{ code: "report-schema" }],
    })
  })
})
```

- [ ] **Step 2: Run the failing parser tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-report.test.ts
```

Expected: FAIL because `ingest-report.ts` does not exist.

- [ ] **Step 3: Implement parser**

Create `ingest-report.ts`:

```ts
export const KNOWLEDGE_BASE_INGEST_REPORT_SCHEMA = "synapse.kb.ingest.report.v1"

export interface KnowledgeBaseIngestReportSource {
  readonly source: string
  readonly pagesCreated: readonly string[]
  readonly pagesUpdated: readonly string[]
}

export interface KnowledgeBaseIngestReport {
  readonly processedSources: readonly KnowledgeBaseIngestReportSource[]
  readonly skippedSources: readonly { readonly source: string; readonly reason: string }[]
}

export interface KnowledgeBaseIngestReportWarning {
  readonly code: string
  readonly message: string
}

export type KnowledgeBaseIngestReportParseResult =
  | { readonly status: "valid"; readonly report: KnowledgeBaseIngestReport; readonly warnings: readonly KnowledgeBaseIngestReportWarning[] }
  | { readonly status: "missing" | "invalid"; readonly warnings: readonly KnowledgeBaseIngestReportWarning[] }

export function parseKnowledgeBaseIngestReport(content: string): KnowledgeBaseIngestReportParseResult {
  const blocks = [...content.matchAll(/```synapse_kb_ingest_report\s*\n([\s\S]*?)\n```/g)]
  if (blocks.length === 0) {
    return { status: "missing", warnings: [{ code: "report-missing", message: "Missing synapse_kb_ingest_report block." }] }
  }
  if (blocks.length > 1) {
    return { status: "invalid", warnings: [{ code: "report-multiple", message: "Multiple synapse_kb_ingest_report blocks found." }] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(blocks[0]?.[1] ?? "")
  } catch (error) {
    return {
      status: "invalid",
      warnings: [{ code: "report-json", message: error instanceof Error ? error.message : String(error) }],
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "invalid", warnings: [{ code: "report-object", message: "Report must be an object." }] }
  }
  const record = parsed as Record<string, unknown>
  if (record.schema !== KNOWLEDGE_BASE_INGEST_REPORT_SCHEMA) {
    return { status: "invalid", warnings: [{ code: "report-schema", message: "Unsupported ingest report schema." }] }
  }

  const processed = Array.isArray(record.processed_sources) ? record.processed_sources : []
  const skipped = Array.isArray(record.skipped_sources) ? record.skipped_sources : []
  const warnings: KnowledgeBaseIngestReportWarning[] = []
  const processedSources: KnowledgeBaseIngestReportSource[] = []
  for (const item of processed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      warnings.push({ code: "report-source-invalid", message: "Processed source entry must be an object." })
      continue
    }
    const source = item as Record<string, unknown>
    if (typeof source.source !== "string") {
      warnings.push({ code: "report-source-path", message: "Processed source is missing source path." })
      continue
    }
    processedSources.push({
      source: source.source,
      pagesCreated: Array.isArray(source.pages_created) ? source.pages_created.filter(isString) : [],
      pagesUpdated: Array.isArray(source.pages_updated) ? source.pages_updated.filter(isString) : [],
    })
  }

  return {
    status: "valid",
    report: {
      processedSources,
      skippedSources: skipped.flatMap((item) => parseSkippedSource(item)),
    },
    warnings,
  }
}

function parseSkippedSource(value: unknown): { readonly source: string; readonly reason: string }[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  if (typeof record.source !== "string" || typeof record.reason !== "string") return []
  return [{ source: record.source, reason: record.reason }]
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}
```

- [ ] **Step 4: Export parser types**

In `knowledge-base/index.ts`, export:

```ts
export {
  KNOWLEDGE_BASE_INGEST_REPORT_SCHEMA,
  parseKnowledgeBaseIngestReport,
  type KnowledgeBaseIngestReport,
  type KnowledgeBaseIngestReportParseResult,
  type KnowledgeBaseIngestReportSource,
  type KnowledgeBaseIngestReportWarning,
} from "./ingest-report"
```

- [ ] **Step 5: Run parser tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-report.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/knowledge-base/ingest-report.ts \
        desktop/electron/services/knowledge-base/__tests__/ingest-report.test.ts \
        desktop/electron/services/knowledge-base/index.ts
git commit -m "feat(kb): parse ingest report contract"
```

---

### Task 4: Add Ingest Turn Store

**Files:**
- Create: `desktop/electron/services/knowledge-base/ingest-turn-store.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/ingest-turn-store.test.ts`
- Modify: `desktop/electron/services/knowledge-base/index.ts`

- [ ] **Step 1: Write failing store tests**

Create `ingest-turn-store.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { KnowledgeBaseIngestTurnStore } from "../ingest-turn-store"

describe("KnowledgeBaseIngestTurnStore", () => {
  it("stores and consumes turn state once", () => {
    const store = new KnowledgeBaseIngestTurnStore()
    store.set("turn-1", {
      projectPath: "/tmp/kb",
      generatedAt: "2026-05-24T00:00:00.000Z",
      force: false,
      changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
      skippedSources: [],
      wikiBefore: { files: {} },
    })

    expect(store.consume("turn-1")?.changedSources).toHaveLength(1)
    expect(store.consume("turn-1")).toBeNull()
  })

  it("returns null for unknown turns", () => {
    expect(new KnowledgeBaseIngestTurnStore().consume("missing")).toBeNull()
  })
})
```

- [ ] **Step 2: Run the failing store tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-turn-store.test.ts
```

Expected: FAIL because `ingest-turn-store.ts` does not exist.

- [ ] **Step 3: Implement turn store**

Create `ingest-turn-store.ts`:

```ts
import type { KnowledgeBaseSkippedSource, KnowledgeBaseSourceScanItem } from "./source-scan"
import type { WikiSnapshot } from "./wiki-snapshot"

export interface KnowledgeBaseIngestTurnState {
  readonly projectPath: string
  readonly generatedAt: string
  readonly force: boolean
  readonly changedSources: readonly KnowledgeBaseSourceScanItem[]
  readonly skippedSources: readonly KnowledgeBaseSkippedSource[]
  readonly wikiBefore: WikiSnapshot
}

export class KnowledgeBaseIngestTurnStore {
  private readonly states = new Map<string, KnowledgeBaseIngestTurnState>()

  set(turnId: string, state: KnowledgeBaseIngestTurnState): void {
    this.states.set(turnId, state)
  }

  consume(turnId: string): KnowledgeBaseIngestTurnState | null {
    const state = this.states.get(turnId)
    if (!state) return null
    this.states.delete(turnId)
    return state
  }

  clear(turnId: string): void {
    this.states.delete(turnId)
  }
}
```

- [ ] **Step 4: Export store types**

In `knowledge-base/index.ts`, export:

```ts
export {
  KnowledgeBaseIngestTurnStore,
  type KnowledgeBaseIngestTurnState,
} from "./ingest-turn-store"
```

- [ ] **Step 5: Run store tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-turn-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/knowledge-base/ingest-turn-store.ts \
        desktop/electron/services/knowledge-base/__tests__/ingest-turn-store.test.ts \
        desktop/electron/services/knowledge-base/index.ts
git commit -m "feat(kb): store ingest turn preflight state"
```

---

### Task 5: Add Manifest Finalizer

**Files:**
- Create: `desktop/electron/services/knowledge-base/manifest-finalizer.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts`
- Modify: `desktop/electron/services/knowledge-base/index.ts`

- [ ] **Step 1: Write failing manifest finalizer tests**

Create `manifest-finalizer.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { KnowledgeBaseManifestFinalizer } from "../manifest-finalizer"
import { readKnowledgeBaseManifest } from "../manifest"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-manifest-finalizer-"))
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

describe("KnowledgeBaseManifestFinalizer", () => {
  it("writes sources from trusted preflight hashes and validated report pages", async () => {
    const root = await tempDir()
    await writeManifest(root, { version: 1, sources: {}, address_map: {} })
    await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(root, "wiki", "sources", "a.md"), "# A\n")
    await writeFile(path.join(root, "wiki", "index.md"), "# Index\n")

    const result = await new KnowledgeBaseManifestFinalizer({
      now: () => "2026-05-24T00:00:00.000Z",
      addressFinalizer: {
        finalize: vi.fn(async () => ({
          assigned: [],
          reused: [],
          addressMap: { "wiki/sources/a.md": "c-000001" },
        })),
      },
    }).finalize({
      projectPath: root,
      conversationId: "conv-1",
      turnId: "turn-1",
      preflight: {
        projectPath: root,
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
      report: {
        processedSources: [{
          source: ".raw/a.md",
          pagesCreated: ["wiki/sources/a.md"],
          pagesUpdated: ["wiki/index.md"],
        }],
        skippedSources: [],
      },
    })

    expect(result.writtenSources).toEqual([".raw/a.md"])
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: {
        sources: {
          ".raw/a.md": {
            hash: "hash-a",
            ingested_at: "2026-05-24T00:00:00.000Z",
            pages_created: ["wiki/sources/a.md"],
            pages_updated: ["wiki/index.md"],
          },
        },
        address_map: { "wiki/sources/a.md": "c-000001" },
      },
    })
  })

  it("preserves unrelated sources", async () => {
    const root = await tempDir()
    await writeManifest(root, {
      version: 1,
      sources: { ".raw/old.md": { hash: "old-hash", ingested_at: "2026-05-01T00:00:00.000Z" } },
      address_map: {},
    })
    await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(root, "wiki", "sources", "a.md"), "# A\n")

    await new KnowledgeBaseManifestFinalizer({
      now: () => "2026-05-24T00:00:00.000Z",
      addressFinalizer: { finalize: vi.fn(async () => ({ assigned: [], reused: [], addressMap: {} })) },
    }).finalize({
      projectPath: root,
      conversationId: "conv-1",
      turnId: "turn-1",
      preflight: {
        projectPath: root,
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
      report: {
        processedSources: [{ source: ".raw/a.md", pagesCreated: ["wiki/sources/a.md"], pagesUpdated: [] }],
        skippedSources: [],
      },
    })

    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: {
        sources: {
          ".raw/old.md": { hash: "old-hash", ingested_at: "2026-05-01T00:00:00.000Z" },
          ".raw/a.md": { hash: "hash-a" },
        },
      },
    })
  })

  it("does not write sources when report has no valid processed entries", async () => {
    const root = await tempDir()
    await writeManifest(root, { version: 1, sources: {}, address_map: {} })

    const result = await new KnowledgeBaseManifestFinalizer({
      addressFinalizer: { finalize: vi.fn(async () => ({ assigned: [], reused: [], addressMap: {} })) },
    }).finalize({
      projectPath: root,
      conversationId: "conv-1",
      turnId: "turn-1",
      preflight: {
        projectPath: root,
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
      report: {
        processedSources: [{ source: ".raw/missing.md", pagesCreated: ["wiki/sources/a.md"], pagesUpdated: [] }],
        skippedSources: [],
      },
    })

    expect(result.warnings.map((warning) => warning.code)).toContain("source-not-in-preflight")
    await expect(readFile(path.join(root, ".raw", ".manifest.json"), "utf8")).resolves.toContain("\"sources\": {}")
  })
})
```

- [ ] **Step 2: Run the failing manifest finalizer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts
```

Expected: FAIL because `manifest-finalizer.ts` does not exist.

- [ ] **Step 3: Update address finalizer return shape**

Modify `ingest-finalizer.ts` so `KnowledgeBaseIngestFinalizerResult` includes `addressMap`:

```ts
export interface KnowledgeBaseIngestFinalizerResult {
  readonly assigned: readonly { readonly path: string; readonly address: DragonScaleAddress }[]
  readonly reused: readonly { readonly path: string; readonly address: DragonScaleAddress }[]
  readonly addressMap: Record<string, string>
  readonly skippedReason?: "invalid-manifest"
}
```

Return `{ assigned, reused, addressMap: nextAddressMap }` when successful and `{ assigned: [], reused: [], addressMap: {}, skippedReason: "invalid-manifest" }` when invalid.

- [ ] **Step 4: Implement manifest finalizer**

Create `manifest-finalizer.ts`:

```ts
import { access } from "node:fs/promises"
import path from "node:path"

import type { KnowledgeBaseIngestReport } from "./ingest-report"
import type { KnowledgeBaseIngestTurnState } from "./ingest-turn-store"
import type { KnowledgeBaseIngestFinalizer } from "./ingest-finalizer"
import { KnowledgeBaseIngestFinalizer as DefaultAddressFinalizer } from "./ingest-finalizer"
import { readKnowledgeBaseManifest, writeKnowledgeBaseManifest, type KnowledgeBaseManifest } from "./manifest"
import { diffWikiSnapshots, snapshotWikiMarkdown } from "./wiki-snapshot"

export interface KnowledgeBaseManifestFinalizerWarning {
  readonly code: string
  readonly message: string
}

export interface KnowledgeBaseManifestFinalizerInput {
  readonly projectPath: string
  readonly conversationId: string
  readonly turnId: string
  readonly preflight: KnowledgeBaseIngestTurnState
  readonly report: KnowledgeBaseIngestReport
}

export interface KnowledgeBaseManifestFinalizerResult {
  readonly writtenSources: readonly string[]
  readonly warnings: readonly KnowledgeBaseManifestFinalizerWarning[]
}

type AddressFinalizerLike = Pick<KnowledgeBaseIngestFinalizer, "finalize">

export class KnowledgeBaseManifestFinalizer {
  private readonly addressFinalizer: AddressFinalizerLike
  private readonly now: () => string

  constructor(deps: { readonly addressFinalizer?: AddressFinalizerLike; readonly now?: () => string } = {}) {
    this.addressFinalizer = deps.addressFinalizer ?? new DefaultAddressFinalizer()
    this.now = deps.now ?? (() => new Date().toISOString())
  }

  async finalize(input: KnowledgeBaseManifestFinalizerInput): Promise<KnowledgeBaseManifestFinalizerResult> {
    const warnings: KnowledgeBaseManifestFinalizerWarning[] = []
    const readResult = await readKnowledgeBaseManifest(input.projectPath)
    if (readResult.status === "invalid") {
      return {
        writtenSources: [],
        warnings: [{ code: "manifest-invalid", message: readResult.error }],
      }
    }

    const changedByPath = new Map(input.preflight.changedSources.map((source) => [source.relativePath, source]))
    const wikiAfter = await snapshotWikiMarkdown(input.projectPath)
    const diff = diffWikiSnapshots(input.preflight.wikiBefore, wikiAfter)
    const writtenSources: string[] = []
    const nextSources: KnowledgeBaseManifest["sources"] = { ...readResult.manifest.sources }

    for (const source of input.report.processedSources) {
      const preflightSource = changedByPath.get(source.source)
      if (!preflightSource) {
        warnings.push({ code: "source-not-in-preflight", message: `Source was not in ingest preflight: ${source.source}` })
        continue
      }
      const pagesCreated = await filterExistingWikiPages(input.projectPath, normalizePageList(source.pagesCreated, diff.created, "created", warnings))
      const pagesUpdated = await filterExistingWikiPages(input.projectPath, normalizePageList(source.pagesUpdated, diff.updated, "updated", warnings))
      if (pagesCreated.length === 0 && pagesUpdated.length === 0) {
        warnings.push({ code: "source-no-valid-pages", message: `Source produced no validated wiki pages: ${source.source}` })
        continue
      }
      nextSources[source.source] = {
        hash: preflightSource.hash,
        ingested_at: this.now(),
        pages_created: pagesCreated,
        pages_updated: pagesUpdated,
      }
      writtenSources.push(source.source)
    }

    const addressResult = await this.addressFinalizer.finalize(input.projectPath)
    if (addressResult.skippedReason) {
      warnings.push({ code: "address-finalizer-skipped", message: addressResult.skippedReason })
    }

    if (writtenSources.length > 0 || !addressResult.skippedReason) {
      await writeKnowledgeBaseManifest(input.projectPath, {
        ...readResult.manifest,
        sources: nextSources,
        address_map: {
          ...readResult.manifest.address_map,
          ...addressResult.addressMap,
        },
      })
    }

    return {
      writtenSources: writtenSources.sort((a, b) => a.localeCompare(b)),
      warnings,
    }
  }
}

function normalizePageList(
  paths: readonly string[],
  allowed: readonly string[],
  kind: "created" | "updated",
  warnings: KnowledgeBaseManifestFinalizerWarning[],
): string[] {
  const allowedSet = new Set(allowed)
  const result: string[] = []
  for (const item of paths) {
    const normalized = item.split("\\").join("/")
    if (!normalized.startsWith("wiki/") || !normalized.endsWith(".md") || normalized.includes("../")) {
      warnings.push({ code: "page-path-invalid", message: `Invalid wiki page path: ${item}` })
      continue
    }
    if (!allowedSet.has(normalized) && !isCanonicalMaintenancePage(normalized)) {
      warnings.push({ code: `page-not-${kind}`, message: `Page was not verified as ${kind}: ${normalized}` })
      continue
    }
    if (!result.includes(normalized)) result.push(normalized)
  }
  return result.sort((a, b) => a.localeCompare(b))
}

async function filterExistingWikiPages(projectPath: string, pages: readonly string[]): Promise<string[]> {
  const root = path.resolve(projectPath)
  const result: string[] = []
  for (const page of pages) {
    const absolutePath = path.resolve(root, page)
    const relative = path.relative(root, absolutePath)
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue
    try {
      await access(absolutePath)
      result.push(page)
    } catch {
      continue
    }
  }
  return result
}

function isCanonicalMaintenancePage(page: string): boolean {
  return page === "wiki/index.md" || page === "wiki/hot.md" || page === "wiki/log.md"
}
```

- [ ] **Step 5: Export manifest finalizer**

In `knowledge-base/index.ts`, export:

```ts
export {
  KnowledgeBaseManifestFinalizer,
  type KnowledgeBaseManifestFinalizerInput,
  type KnowledgeBaseManifestFinalizerResult,
  type KnowledgeBaseManifestFinalizerWarning,
} from "./manifest-finalizer"
```

- [ ] **Step 6: Run manifest finalizer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts
```

Expected: PASS after updating existing `ingest-finalizer` assertions for the new `addressMap` property.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/knowledge-base/manifest-finalizer.ts \
        desktop/electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts \
        desktop/electron/services/knowledge-base/ingest-finalizer.ts \
        desktop/electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts \
        desktop/electron/services/knowledge-base/index.ts
git commit -m "feat(kb): finalize manifest sources in Synapse"
```

---

### Task 6: Add Ingest Coordinator

**Files:**
- Create: `desktop/electron/services/knowledge-base/ingest-coordinator.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts`
- Modify: `desktop/electron/services/knowledge-base/index.ts`

- [ ] **Step 1: Write failing coordinator tests**

Create `ingest-coordinator.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { KnowledgeBaseIngestCoordinator } from "../ingest-coordinator"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-ingest-coordinator-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseIngestCoordinator", () => {
  it("prepares a natural-language ingest prompt with source hashes and report contract", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{},\"address_map\":{}}\n")
    await writeFile(path.join(root, ".raw", "a.md"), "Alpha\n")

    const coordinator = new KnowledgeBaseIngestCoordinator({
      readPrompt: async () => "INGEST PROMPT",
    })
    const result = await coordinator.prepareTurn({
      projectPath: root,
      turnId: "turn-1",
      originalContent: "汲取知识",
      force: false,
    })

    expect(result.status).toBe("prompt")
    expect(result.content).toContain("INGEST PROMPT")
    expect(result.content).toContain(".raw/a.md")
    expect(result.content).toContain("synapse_kb_ingest_report")
  })

  it("finalizes a turn by parsing the report and delegating manifest writes", async () => {
    const finalize = vi.fn(async () => ({ writtenSources: [".raw/a.md"], warnings: [] }))
    const coordinator = new KnowledgeBaseIngestCoordinator({
      readPrompt: async () => "INGEST PROMPT",
      manifestFinalizer: { finalize },
    })
    coordinator.store.set("turn-1", {
      projectPath: "/tmp/kb",
      generatedAt: "2026-05-24T00:00:00.000Z",
      force: false,
      changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
      skippedSources: [],
      wikiBefore: { files: {} },
    })

    await coordinator.finalizeTurn({
      projectPath: "/tmp/kb",
      conversationId: "conv-1",
      turnId: "turn-1",
      assistantText: "```synapse_kb_ingest_report\n{\"schema\":\"synapse.kb.ingest.report.v1\",\"processed_sources\":[{\"source\":\".raw/a.md\",\"pages_created\":[\"wiki/sources/a.md\"],\"pages_updated\":[]}],\"skipped_sources\":[]}\n```",
    })

    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: "/tmp/kb",
      turnId: "turn-1",
    }))
  })
})
```

- [ ] **Step 2: Run the failing coordinator tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts
```

Expected: FAIL because `ingest-coordinator.ts` does not exist.

- [ ] **Step 3: Implement coordinator**

Create `ingest-coordinator.ts`:

```ts
import type { RegisteredPromptCommandOutput } from "../agent-runtime/command-router"
import { KNOWLEDGE_BASE_INGEST_REPORT_SCHEMA, parseKnowledgeBaseIngestReport } from "./ingest-report"
import { KnowledgeBaseIngestTurnStore } from "./ingest-turn-store"
import { KnowledgeBaseManifestFinalizer } from "./manifest-finalizer"
import type { KnowledgeBaseManifestFinalizer as ManifestFinalizer } from "./manifest-finalizer"
import { scanKnowledgeBaseSources } from "./source-scan"
import { snapshotWikiMarkdown } from "./wiki-snapshot"
import {
  wikiIngestAppendixCopy,
  wikiInvalidManifestCopy,
  wikiNoIngestChangesCopy,
} from "./wiki-command-copy"

type ManifestFinalizerLike = Pick<ManifestFinalizer, "finalize">

export interface KnowledgeBaseIngestCoordinatorPrepareInput {
  readonly projectPath: string
  readonly turnId: string
  readonly originalContent: string
  readonly force: boolean
}

export interface KnowledgeBaseIngestCoordinatorFinalizeInput {
  readonly projectPath: string
  readonly conversationId: string
  readonly turnId: string
  readonly assistantText: string
}

export class KnowledgeBaseIngestCoordinator {
  readonly store: KnowledgeBaseIngestTurnStore
  private readonly readPrompt: (fileName: string) => Promise<string>
  private readonly manifestFinalizer: ManifestFinalizerLike

  constructor(deps: {
    readonly readPrompt: (fileName: string) => Promise<string>
    readonly manifestFinalizer?: ManifestFinalizerLike
    readonly store?: KnowledgeBaseIngestTurnStore
  }) {
    this.readPrompt = deps.readPrompt
    this.manifestFinalizer = deps.manifestFinalizer ?? new KnowledgeBaseManifestFinalizer()
    this.store = deps.store ?? new KnowledgeBaseIngestTurnStore()
  }

  async prepareTurn(input: KnowledgeBaseIngestCoordinatorPrepareInput): Promise<RegisteredPromptCommandOutput> {
    const scan = await scanKnowledgeBaseSources(input.projectPath, { force: input.force })
    if (scan.manifest.status === "invalid") {
      return { kind: "result", error: true, content: wikiInvalidManifestCopy(scan.manifest.error) }
    }

    const changedSources = scan.sources.filter((source) => source.state !== "unchanged")
    if (changedSources.length === 0) {
      return {
        kind: "result",
        content: wikiNoIngestChangesCopy({ sources: scan.sources.length, skipped: scan.skippedSources.length }),
      }
    }

    this.store.set(input.turnId, {
      projectPath: input.projectPath,
      generatedAt: new Date().toISOString(),
      force: input.force,
      changedSources,
      skippedSources: scan.skippedSources,
      wikiBefore: await snapshotWikiMarkdown(input.projectPath),
    })

    return {
      kind: "prompt",
      content: [
        await this.readPrompt("ingest.md"),
        "",
        wikiIngestAppendixCopy({
          projectPath: input.projectPath,
          changedSources,
          skippedSources: scan.skippedSources,
        }),
        "",
        reportContractCopy(),
      ].join("\n"),
    }
  }

  async finalizeTurn(input: KnowledgeBaseIngestCoordinatorFinalizeInput): Promise<void> {
    const preflight = this.store.consume(input.turnId)
    if (!preflight) return
    const parsed = parseKnowledgeBaseIngestReport(input.assistantText)
    if (parsed.status !== "valid") return
    await this.manifestFinalizer.finalize({
      projectPath: input.projectPath,
      conversationId: input.conversationId,
      turnId: input.turnId,
      preflight,
      report: parsed.report,
    })
  }
}

export function reportContractCopy(): string {
  return [
    "最后必须输出一个 `synapse_kb_ingest_report` fenced JSON block，Synapse 将只信任这个结构化报告来写 `.raw/.manifest.json`。",
    "```synapse_kb_ingest_report",
    JSON.stringify({
      schema: KNOWLEDGE_BASE_INGEST_REPORT_SCHEMA,
      processed_sources: [{
        source: ".raw/example.md",
        pages_created: ["wiki/sources/example.md"],
        pages_updated: ["wiki/index.md", "wiki/hot.md", "wiki/log.md"],
      }],
      skipped_sources: [{ source: ".raw/unchanged.md", reason: "unchanged" }],
    }, null, 2),
    "```",
  ].join("\n")
}
```

- [ ] **Step 4: Export coordinator**

In `knowledge-base/index.ts`, export:

```ts
export {
  KnowledgeBaseIngestCoordinator,
  reportContractCopy,
  type KnowledgeBaseIngestCoordinatorFinalizeInput,
  type KnowledgeBaseIngestCoordinatorPrepareInput,
} from "./ingest-coordinator"
```

- [ ] **Step 5: Run coordinator tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/knowledge-base/ingest-coordinator.ts \
        desktop/electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts \
        desktop/electron/services/knowledge-base/index.ts
git commit -m "feat(kb): coordinate deterministic ingest turns"
```

---

### Task 7: Wire Coordinator Into Knowledge Base Contribution

**Files:**
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Modify: `desktop/electron/services/knowledge-base/wiki-command-prompts.ts`
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts`

- [ ] **Step 1: Add failing natural-language preflight test**

In `knowledge-base-contribution.test.ts`, add:

```ts
it("injects ingest preflight for natural-language ingest turns", async () => {
  const projectPath = await tempDir()
  await mkdir(path.join(projectPath, ".raw"), { recursive: true })
  await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{},\"address_map\":{}}\n")
  await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
  const contribution = await createKnowledgeBaseAgentContribution({
    project: knowledgeBaseProject(projectPath),
  })

  const prepared = await Promise.resolve(contribution?.prepareMessage?.({
    ...baseMessage("汲取知识"),
    content: "汲取知识",
  }, {
    isNewLiveSession: false,
    conversationId: "conv-1",
    turnId: "turn-1",
  }))

  expect(prepared?.content).toContain(".raw/note.md")
  expect(prepared?.content).toContain("synapse_kb_ingest_report")
})
```

- [ ] **Step 2: Add failing `/wiki ingest` coordinator test**

In `wiki-command-prompts.test.ts`, assert `/wiki ingest` prompt includes `synapse_kb_ingest_report` and says Synapse writes manifest:

```ts
expect(content).toContain("synapse_kb_ingest_report")
expect(content).toContain("Synapse")
expect(content).toContain(".raw/.manifest.json")
```

- [ ] **Step 3: Run failing wiring tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts
```

Expected: FAIL because natural-language ingest does not yet call the coordinator and `/wiki ingest` does not include the report contract.

- [ ] **Step 4: Update contribution creation input**

In `agent-contribution.ts`, replace the finalizer dependency with a coordinator dependency:

```ts
import { KnowledgeBaseIngestCoordinator } from "./ingest-coordinator"

type CreateKnowledgeBaseAgentContributionInput = {
  readonly project: SynapseProjectConfig
  readonly ingestCoordinator?: KnowledgeBaseIngestCoordinator
}
```

Construct:

```ts
const ingestCoordinator = input.ingestCoordinator ?? new KnowledgeBaseIngestCoordinator({ readPrompt })
```

- [ ] **Step 5: Route natural-language ingest through prepareMessage**

In `prepareMessage`, keep bootstrap behavior and add ingest preflight for non-slash natural-language ingest:

```ts
async prepareMessage(message, context) {
  let next = message
  if (context.isNewLiveSession) {
    const hotCache = await readOptional(hotCachePath)
    next = prependBootstrap(next, bootstrap, hotCache)
  }
  if (isKnowledgeBaseIngestIntent(message.content) && !/^\/wiki\s+/i.test(message.content.trim())) {
    const output = await ingestCoordinator.prepareTurn({
      projectPath: input.project.path,
      turnId: context.turnId,
      originalContent: message.content,
      force: false,
    })
    if (output.kind === "prompt") {
      return { ...next, content: output.content }
    }
    return { ...next, content: output.content }
  }
  return next
}
```

- [ ] **Step 6: Route afterTurn through coordinator**

In `afterTurn`:

```ts
async afterTurn({ message, result, conversationId, turnId }) {
  if (result.error) return
  if (!isKnowledgeBaseIngestIntent(message.content)) return
  await ingestCoordinator.finalizeTurn({
    projectPath: input.project.path,
    conversationId,
    turnId,
    assistantText: result.resultText,
  })
}
```

- [ ] **Step 7: Delegate `/wiki ingest` to coordinator**

In `agent-contribution.ts`, update the registered `wiki` command so it forwards command route context:

```ts
commands: [{
  name: "wiki",
  buildPrompt: (args, message, context) => buildKnowledgeBaseCommandPrompt(input.project.path, args, context.turnId),
}],
```

Update `buildKnowledgeBaseCommandPrompt`:

```ts
async function buildKnowledgeBaseCommandPrompt(
  projectPath: string,
  args: readonly string[],
  turnId: string,
): Promise<RegisteredPromptCommandOutput> {
  return buildKnowledgeBaseCommandOutput({
    projectPath,
    args,
    turnId,
    readPrompt,
    ingestCoordinator,
  })
}
```

In `wiki-command-prompts.ts`, update `BuildKnowledgeBaseCommandOutputInput`:

```ts
readonly ingestCoordinator?: Pick<KnowledgeBaseIngestCoordinator, "prepareTurn">
readonly turnId: string
```

Change `buildIngestOutput` to use the coordinator:

```ts
return (input.ingestCoordinator ?? new KnowledgeBaseIngestCoordinator({ readPrompt: input.readPrompt })).prepareTurn({
  projectPath: input.projectPath,
  turnId: input.turnId,
  originalContent: `/wiki ingest ${commandArgs.join(" ")}`.trim(),
  force: commandArgs.includes("--force"),
})
```

Do not generate a fallback turn id here. If a caller does not provide `turnId`, update that caller to pass the runtime command context. The preflight store and `afterTurn` must use the same id.

- [ ] **Step 8: Keep coordinator stable for the runtime service**

In `agent-runtime/index.ts`, create a stable resolver per service factory call:

```ts
const knowledgeBaseContributionCache = new Map<string, Promise<AgentProjectContribution>>()

async function resolveAgentProjectContributionForService(projectId: string) {
  const cached = knowledgeBaseContributionCache.get(projectId)
  if (cached) return cached
  const created = resolveAgentProjectContribution(projectId)
  knowledgeBaseContributionCache.set(projectId, created)
  return created
}
```

Use `resolveAgentProjectContributionForService` in the runtime deps instead of calling the module-level resolver directly. This keeps the coordinator's turn store stable between `prepareMessage` and `afterTurn`.

- [ ] **Step 9: Run wiring tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add desktop/electron/services/knowledge-base/agent-contribution.ts \
        desktop/electron/services/knowledge-base/wiki-command-prompts.ts \
        desktop/electron/services/agent-runtime/index.ts \
        desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts \
        desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts
git commit -m "feat(kb): use deterministic ingest coordinator"
```

---

### Task 8: Update Prompts And Plugin Skill Contract

**Files:**
- Modify: `desktop/resources/knowledge-base/prompts/ingest.md`
- Modify: `desktop/resources/knowledge-base/claude-plugin/skills/wiki-ingest/SKILL.md`
- Modify: `desktop/resources/knowledge-base/prompts/bootstrap.md`
- Modify: `desktop/electron/services/knowledge-base/wiki-command-copy.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts`

- [ ] **Step 1: Add failing prompt copy assertions**

In `wiki-command-prompts.test.ts`, add assertions that ingest prompt says:

```ts
expect(content).toContain("不要编辑 `.raw/.manifest.json`")
expect(content).toContain("synapse.kb.ingest.report.v1")
expect(content).toContain("pages_created")
expect(content).toContain("pages_updated")
```

- [ ] **Step 2: Run failing prompt assertions**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts
```

Expected: FAIL until prompt copy is updated.

- [ ] **Step 3: Update `ingest.md`**

Replace the manifest-writing paragraph with:

````md
写入 wiki 页面后，不要编辑 `.raw/.manifest.json`。Synapse 会在回合结束后根据预检 hash、你的结构化报告和实际文件状态写入 manifest `sources` 和 `address_map`。

你必须在最后输出一个 `synapse_kb_ingest_report` fenced JSON block：

```synapse_kb_ingest_report
{
  "schema": "synapse.kb.ingest.report.v1",
  "processed_sources": [
    {
      "source": ".raw/example.md",
      "pages_created": ["wiki/sources/example.md"],
      "pages_updated": ["wiki/index.md", "wiki/hot.md", "wiki/log.md"]
    }
  ],
  "skipped_sources": [
    {
      "source": ".raw/unchanged.md",
      "reason": "unchanged"
    }
  ]
}
```

报告要求：
- `source` 必须来自预检来源列表。
- `pages_created` 只放本轮新建的 `wiki/**/*.md`。
- `pages_updated` 只放本轮更新的 `wiki/**/*.md`。
- 不要自行写入 hash、`ingested_at` 或 `address_map`。
- 不要编辑 `.vault-meta/address-counter.txt`，不要自行发明新的 `c-NNNNNN` 地址。
````

- [ ] **Step 4: Update plugin skill**

In `desktop/resources/knowledge-base/claude-plugin/skills/wiki-ingest/SKILL.md`, change the "After ingest" bullets to:

```md
- Do not edit `.raw/.manifest.json`; Synapse finalizes manifest `sources` and `address_map` after the turn.
- Emit exactly one fenced `synapse_kb_ingest_report` JSON block using schema `synapse.kb.ingest.report.v1`.
- For each processed source, list the `.raw/...` source path plus `pages_created` and `pages_updated`.
- Do not write hashes, `ingested_at`, or `address_map` yourself.
- Do not edit `.vault-meta/address-counter.txt`.
- Do not invent new `c-NNNNNN` addresses.
- Preserve existing `address:` frontmatter when rewriting a page.
```

- [ ] **Step 5: Update bootstrap**

In `bootstrap.md`, make the manifest ownership line read:

```md
- `.raw/.manifest.json` 使用 claude-obsidian 兼容格式；Synapse 在汲取回合结束后根据预检 hash 和结构化报告写入 `sources` 与 `address_map`。
```

- [ ] **Step 6: Update command copy**

In `wiki-command-copy.ts`, update ingest appendix copy to say:

```ts
"- 不要编辑 `.raw/.manifest.json`；Synapse 会根据预检 hash 和 `synapse_kb_ingest_report` 写入 manifest。",
"- 最后必须输出 `synapse_kb_ingest_report` fenced JSON block，包含 `schema`、`processed_sources`、`pages_created`、`pages_updated`。",
"- 不要编辑 `.vault-meta/address-counter.txt`，不要自行发明 DragonScale 地址。",
```

- [ ] **Step 7: Run prompt tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/resources/knowledge-base/prompts/ingest.md \
        desktop/resources/knowledge-base/claude-plugin/skills/wiki-ingest/SKILL.md \
        desktop/resources/knowledge-base/prompts/bootstrap.md \
        desktop/electron/services/knowledge-base/wiki-command-copy.ts \
        desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts
git commit -m "docs(kb): make ingest report contract explicit"
```

---

### Task 9: Add Warning Logging And Invalid Manifest Coverage

**Files:**
- Modify: `desktop/electron/services/knowledge-base/ingest-coordinator.ts`
- Modify: `desktop/electron/services/knowledge-base/manifest-finalizer.ts`
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

- [ ] **Step 1: Add failing warning tests**

In `ingest-coordinator.test.ts`, add:

```ts
it("logs a warning when the ingest report is missing", async () => {
  const warn = vi.fn()
  const coordinator = new KnowledgeBaseIngestCoordinator({
    readPrompt: async () => "INGEST PROMPT",
    logger: { warn } as never,
  })
  coordinator.store.set("turn-1", {
    projectPath: "/tmp/kb",
    generatedAt: "2026-05-24T00:00:00.000Z",
    force: false,
    changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
    skippedSources: [],
    wikiBefore: { files: {} },
  })

  await coordinator.finalizeTurn({
    projectPath: "/tmp/kb",
    conversationId: "conv-1",
    turnId: "turn-1",
    assistantText: "done without report",
  })

  expect(warn).toHaveBeenCalledWith("Knowledge Base ingest report was not finalized.", expect.objectContaining({
    boundary: "knowledge-base.ingest-finalizer",
    warningCodes: ["report-missing"],
  }))
})
```

- [ ] **Step 2: Run failing warning tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts --testNamePattern "logs a warning"
```

Expected: FAIL because the coordinator does not accept a logger yet.

- [ ] **Step 3: Add logger dependency**

In `ingest-coordinator.ts`, add:

```ts
type KnowledgeBaseIngestLogger = {
  warn(message: string, metadata?: Record<string, unknown>): void
}
```

Accept `logger?: KnowledgeBaseIngestLogger` in the constructor and save it.

- [ ] **Step 4: Log parser and finalizer warnings**

In `finalizeTurn`, after parsing:

```ts
if (parsed.status !== "valid") {
  this.logger?.warn("Knowledge Base ingest report was not finalized.", {
    boundary: "knowledge-base.ingest-finalizer",
    projectPath: input.projectPath,
    conversationId: input.conversationId,
    turnId: input.turnId,
    warningCodes: parsed.warnings.map((warning) => warning.code),
  })
  return
}
```

After manifest finalizer returns:

```ts
if (result.warnings.length > 0) {
  this.logger?.warn("Knowledge Base ingest finalized with warnings.", {
    boundary: "knowledge-base.ingest-finalizer",
    projectPath: input.projectPath,
    conversationId: input.conversationId,
    turnId: input.turnId,
    warningCodes: result.warnings.map((warning) => warning.code),
  })
}
```

- [ ] **Step 5: Pass logger from contribution**

Add `logger?: { warn(message: string, metadata?: Record<string, unknown>): void }` to `CreateKnowledgeBaseAgentContributionInput`.

When constructing the coordinator:

```ts
const ingestCoordinator = input.ingestCoordinator ?? new KnowledgeBaseIngestCoordinator({ readPrompt, logger: input.logger })
```

Update `agent-runtime/index.ts` to pass `ctx.logger` into `createKnowledgeBaseAgentContribution`.

- [ ] **Step 6: Run warning tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/knowledge-base/ingest-coordinator.ts \
        desktop/electron/services/knowledge-base/manifest-finalizer.ts \
        desktop/electron/services/knowledge-base/agent-contribution.ts \
        desktop/electron/services/agent-runtime/index.ts \
        desktop/electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts \
        desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
git commit -m "feat(kb): log ingest finalization warnings"
```

---

### Task 10: Add Full Integration Tests For Manifest Sources And Address Map

**Files:**
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts`

- [ ] **Step 1: Add end-to-end contribution finalization test**

In `knowledge-base-contribution.test.ts`, add:

```ts
it("finalizes sources and address_map after a natural-language ingest turn", async () => {
  const projectPath = await tempDir()
  await mkdir(path.join(projectPath, ".raw"), { recursive: true })
  await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{},\"address_map\":{}}\n")
  await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
  await mkdir(path.join(projectPath, "wiki", "sources"), { recursive: true })
  const contribution = await createKnowledgeBaseAgentContribution({
    project: knowledgeBaseProject(projectPath),
  })

  await contribution?.prepareMessage?.(baseMessage("汲取知识"), {
    isNewLiveSession: false,
    conversationId: "conv-1",
    turnId: "turn-1",
  })

  await writeFile(path.join(projectPath, "wiki", "sources", "note.md"), "---\ntype: source\ntitle: Note\n---\n\n# Note\n")
  await contribution?.afterTurn?.({
    message: baseMessage("汲取知识"),
    result: {
      conversationId: "conv-1",
      resultText: "```synapse_kb_ingest_report\n{\"schema\":\"synapse.kb.ingest.report.v1\",\"processed_sources\":[{\"source\":\".raw/note.md\",\"pages_created\":[\"wiki/sources/note.md\"],\"pages_updated\":[]}],\"skipped_sources\":[]}\n```",
      events: [],
    },
    conversationId: "conv-1",
    turnId: "turn-1",
    isNewLiveSession: false,
  })

  const manifest = JSON.parse(await readFile(path.join(projectPath, ".raw", ".manifest.json"), "utf8")) as {
    sources: Record<string, { hash: string; pages_created: string[] }>
    address_map: Record<string, string>
  }
  expect(manifest.sources[".raw/note.md"]?.hash).toMatch(/^[a-f0-9]{64}$/)
  expect(manifest.sources[".raw/note.md"]?.pages_created).toEqual(["wiki/sources/note.md"])
  expect(manifest.address_map["wiki/sources/note.md"]).toBe("c-000001")
})
```

- [ ] **Step 2: Add non-KB isolation test**

In the same file, assert a normal project returns no KB contribution:

```ts
it("does not inject ingest behavior for non-knowledge-base projects", async () => {
  const projectPath = await tempDir()
  const contribution = await createKnowledgeBaseAgentContribution({
    project: { ...knowledgeBaseProject(projectPath), capabilities: {} },
  })

  expect(contribution).toBeNull()
})
```

- [ ] **Step 3: Run integration tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts \
        desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts \
        desktop/electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts
git commit -m "test(kb): cover deterministic manifest finalization"
```

---

### Task 11: Update Knowledge Base Design Guide

**Files:**
- Modify: `docs/agent-guides/knowledge-base.md`
- Modify: `docs/superpowers/specs/2026-05-23-dragonscale-ingest-address-finalizer-design.md`
- Modify: `docs/superpowers/specs/2026-05-21-wiki-phase1-design.md`

- [ ] **Step 1: Update `docs/agent-guides/knowledge-base.md`**

Add this implementation note:

```md
- Ingest manifest finalization is Synapse-owned. The Agent writes semantic wiki Markdown and emits `synapse.kb.ingest.report.v1`; Synapse validates the report, computes source hashes, and writes `.raw/.manifest.json` `sources` and `address_map`.
```

- [ ] **Step 2: Mark older design sections as superseded**

In `2026-05-23-dragonscale-ingest-address-finalizer-design.md`, add near the top:

```md
> Superseded for manifest `sources` ownership by `docs/superpowers/specs/2026-05-24-knowledge-base-deterministic-manifest-finalization-design.md`. DragonScale address finalization remains valid, but manifest `sources` are now finalized by Synapse rather than the Agent.
```

In `2026-05-21-wiki-phase1-design.md`, add near the manifest section:

```md
> Updated baseline: the Agent no longer performs final `.raw/.manifest.json` writes. Synapse computes hashes and finalizes manifest `sources` from the ingest report.
```

- [ ] **Step 3: Commit docs**

```bash
git add docs/agent-guides/knowledge-base.md \
        docs/superpowers/specs/2026-05-23-dragonscale-ingest-address-finalizer-design.md \
        docs/superpowers/specs/2026-05-21-wiki-phase1-design.md
git commit -m "docs(kb): update manifest ownership baseline"
```

---

### Task 12: Run Final Verification

**Files:**
- No edits unless a verification failure identifies a scoped issue in the files changed above.

- [ ] **Step 1: Run focused Knowledge Base tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/knowledge-base/__tests__/source-scan.test.ts \
  electron/services/knowledge-base/__tests__/manifest-writer.test.ts \
  electron/services/knowledge-base/__tests__/ingest-report.test.ts \
  electron/services/knowledge-base/__tests__/wiki-snapshot.test.ts \
  electron/services/knowledge-base/__tests__/ingest-turn-store.test.ts \
  electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts \
  electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts \
  electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts \
  electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts \
  electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts \
  electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: all listed test files pass.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 3: Run desktop test suite if focused tests pass**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 4: Inspect vault-template cleanliness**

Run:

```bash
find desktop/resources/knowledge-base/templates -maxdepth 6 -type f | sort | rg "(\\.agents/|\\.claude/|\\.codex/|SKILL.md|CLAUDE.md|hooks/|commands/|plugins/|scripts/)" || true
```

Expected: no output for runnable Agent capability files in user vault templates.

- [ ] **Step 5: Review diff**

Run:

```bash
git diff --stat
git diff --check
```

Expected: diff only touches scoped Knowledge Base, Agent Runtime contribution context, and docs files; `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Commit verification fixes if needed**

If verification required scoped fixes:

```bash
git add <fixed files>
git commit -m "fix(kb): stabilize deterministic manifest finalization"
```

If no fixes were needed, do not create an empty commit.

## Self-Review Checklist

- Spec requirement "natural-language ingest shares source preflight" is implemented by Tasks 6 and 7.
- Spec requirement "Agent emits structured report" is implemented by Tasks 3, 6, and 8.
- Spec requirement "Synapse writes `sources`" is implemented by Task 5.
- Spec requirement "Synapse writes `address_map`" is preserved and integrated by Task 5.
- Spec requirement "invalid reports fail closed" is implemented by Tasks 3, 5, and 9.
- Spec requirement "invalid manifest warning" is implemented by Tasks 5 and 9.
- Spec requirement "KB isolation" is verified by Tasks 7, 10, and 12.
- Spec requirement "docs baseline update" is implemented by Task 11.
