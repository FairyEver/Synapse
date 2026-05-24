# Knowledge Base Programmatic Parallel Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Knowledge Base-only programmatic parallel ingest runner that partitions changed `.raw/` sources into restricted source-page worker tasks, validates worker reports, and lets one merge coordinator and one manifest finalizer own shared wiki and manifest writes.

**Architecture:** `KnowledgeBaseIngestCoordinator.prepareTurn()` keeps the existing scan/preflight responsibility. For larger changed-source batches, `createKnowledgeBaseAgentContribution()` calls a new `KnowledgeBaseParallelIngestRunner` before the main live turn; the runner executes restricted worker sessions and returns a merge prompt for the current live conversation. Workers write only their assigned `wiki/sources/...` page, the live conversation merges shared wiki pages, and `KnowledgeBaseManifestFinalizer` remains the only writer for `.raw/.manifest.json` and `address_map`.

**Tech Stack:** Electron main process, TypeScript, Claude Agent SDK through injectable live-session factories, existing Agent Runtime contribution hooks, Vitest.

---

## File Structure

- Create `desktop/electron/services/knowledge-base/ingest-worker-report.ts`
  - Parses and validates `synapse_kb_worker_report`.
- Create `desktop/electron/services/knowledge-base/ingest-task-planner.ts`
  - Converts preflight changed sources into deterministic one-source/one-target-page tasks.
- Create `desktop/electron/services/knowledge-base/ingest-worker-policy.ts`
  - Enforces exact worker write scope for direct worker sessions.
- Create `desktop/electron/services/knowledge-base/ingest-worker-session-runner.ts`
  - Runs one worker task through an injected live-session factory and returns a validated worker report.
- Create `desktop/electron/services/knowledge-base/parallel-ingest-runner.ts`
  - Orchestrates task planning, bounded worker concurrency, report validation, and merge prompt construction.
- Modify `desktop/electron/services/knowledge-base/agent-contribution.ts`
  - Uses the parallel runner only for local-renderer Knowledge Base ingest turns above the internal threshold.
- Modify `desktop/electron/services/agent-runtime/index.ts`
  - Constructs and injects the KB parallel runner with provider/env/session dependencies.
- Modify `desktop/electron/services/knowledge-base/index.ts`
  - Exports new public KB module APIs.
- Tests live next to the module in `desktop/electron/services/knowledge-base/__tests__/`.

## Task 1: Worker Report Parser

**Files:**
- Create: `desktop/electron/services/knowledge-base/ingest-worker-report.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/ingest-worker-report.test.ts`
- Modify: `desktop/electron/services/knowledge-base/index.ts`

- [ ] **Step 1: Write failing parser tests**

Add `desktop/electron/services/knowledge-base/__tests__/ingest-worker-report.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA,
  parseKnowledgeBaseWorkerReport,
} from "../ingest-worker-report"

const validBlock = [
  "```synapse_kb_worker_report",
  JSON.stringify({
    schema: KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA,
    task_id: "task-1",
    source: ".raw/a.md",
    target_page: "wiki/sources/a.md",
    pages_created: ["wiki/sources/a.md"],
    pages_updated: [],
    candidate_concepts: ["Concept A"],
    candidate_entities: [],
    candidate_questions: [],
    skipped: null,
  }),
  "```",
].join("\n")

describe("parseKnowledgeBaseWorkerReport", () => {
  it("parses one valid worker report", () => {
    expect(parseKnowledgeBaseWorkerReport(validBlock, {
      taskId: "task-1",
      sourcePath: ".raw/a.md",
      targetPage: "wiki/sources/a.md",
    })).toMatchObject({
      status: "valid",
      report: {
        taskId: "task-1",
        source: ".raw/a.md",
        targetPage: "wiki/sources/a.md",
        pagesCreated: ["wiki/sources/a.md"],
        pagesUpdated: [],
      },
    })
  })

  it("rejects missing and multiple worker report blocks", () => {
    expect(parseKnowledgeBaseWorkerReport("done", {
      taskId: "task-1",
      sourcePath: ".raw/a.md",
      targetPage: "wiki/sources/a.md",
    })).toMatchObject({ status: "missing", warnings: [{ code: "worker-report-missing" }] })

    expect(parseKnowledgeBaseWorkerReport(`${validBlock}\n${validBlock}`, {
      taskId: "task-1",
      sourcePath: ".raw/a.md",
      targetPage: "wiki/sources/a.md",
    })).toMatchObject({ status: "invalid", warnings: [{ code: "worker-report-multiple" }] })
  })

  it("rejects schema, task, source, target, and page ownership mismatches", () => {
    const report = {
      schema: KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA,
      task_id: "task-2",
      source: ".raw/b.md",
      target_page: "wiki/sources/b.md",
      pages_created: ["wiki/index.md"],
      pages_updated: [],
      candidate_concepts: [],
      candidate_entities: [],
      candidate_questions: [],
      skipped: null,
    }
    const block = `\`\`\`synapse_kb_worker_report\n${JSON.stringify(report)}\n\`\`\``

    expect(parseKnowledgeBaseWorkerReport(block, {
      taskId: "task-1",
      sourcePath: ".raw/a.md",
      targetPage: "wiki/sources/a.md",
    })).toMatchObject({
      status: "invalid",
      warnings: expect.arrayContaining([
        { code: "worker-report-task-mismatch", message: expect.any(String) },
        { code: "worker-report-source-mismatch", message: expect.any(String) },
        { code: "worker-report-target-mismatch", message: expect.any(String) },
        { code: "worker-report-page-outside-target", message: expect.any(String) },
      ]),
    })
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-worker-report.test.ts
```

Expected: FAIL because `ingest-worker-report.ts` does not exist.

- [ ] **Step 3: Implement parser**

Create `desktop/electron/services/knowledge-base/ingest-worker-report.ts`:

```ts
export const KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA = "synapse.kb.worker.report.v1"

export interface KnowledgeBaseWorkerReport {
  readonly taskId: string
  readonly source: string
  readonly targetPage: string
  readonly pagesCreated: readonly string[]
  readonly pagesUpdated: readonly string[]
  readonly candidateConcepts: readonly string[]
  readonly candidateEntities: readonly string[]
  readonly candidateQuestions: readonly string[]
  readonly skipped: { readonly reason: string } | null
}

export interface KnowledgeBaseWorkerReportWarning {
  readonly code: string
  readonly message: string
}

export type KnowledgeBaseWorkerReportParseResult =
  | { readonly status: "valid"; readonly report: KnowledgeBaseWorkerReport; readonly warnings: readonly KnowledgeBaseWorkerReportWarning[] }
  | { readonly status: "missing" | "invalid"; readonly warnings: readonly KnowledgeBaseWorkerReportWarning[] }

export interface KnowledgeBaseWorkerReportExpectedTask {
  readonly taskId: string
  readonly sourcePath: string
  readonly targetPage: string
}

export function parseKnowledgeBaseWorkerReport(
  content: string,
  expected: KnowledgeBaseWorkerReportExpectedTask,
): KnowledgeBaseWorkerReportParseResult {
  const blocks = [...content.matchAll(/```synapse_kb_worker_report\s*\n([\s\S]*?)\n```/g)]
  if (blocks.length === 0) {
    return { status: "missing", warnings: [{ code: "worker-report-missing", message: "Missing synapse_kb_worker_report block." }] }
  }
  if (blocks.length > 1) {
    return { status: "invalid", warnings: [{ code: "worker-report-multiple", message: "Multiple synapse_kb_worker_report blocks found." }] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(blocks[0]?.[1] ?? "")
  } catch (error) {
    return {
      status: "invalid",
      warnings: [{ code: "worker-report-json", message: error instanceof Error ? error.message : String(error) }],
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "invalid", warnings: [{ code: "worker-report-object", message: "Worker report must be an object." }] }
  }

  const record = parsed as Record<string, unknown>
  const warnings: KnowledgeBaseWorkerReportWarning[] = []
  if (record.schema !== KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA) {
    warnings.push({ code: "worker-report-schema", message: "Unsupported worker report schema." })
  }
  if (record.task_id !== expected.taskId) {
    warnings.push({ code: "worker-report-task-mismatch", message: `Worker report task mismatch: ${String(record.task_id)}` })
  }
  if (record.source !== expected.sourcePath) {
    warnings.push({ code: "worker-report-source-mismatch", message: `Worker report source mismatch: ${String(record.source)}` })
  }
  if (record.target_page !== expected.targetPage) {
    warnings.push({ code: "worker-report-target-mismatch", message: `Worker report target mismatch: ${String(record.target_page)}` })
  }

  const pagesCreated = strings(record.pages_created)
  const pagesUpdated = strings(record.pages_updated)
  const outsidePages = [...pagesCreated, ...pagesUpdated].filter((page) => normalize(page) !== normalize(expected.targetPage))
  if (outsidePages.length > 0) {
    warnings.push({ code: "worker-report-page-outside-target", message: `Worker report claimed pages outside target: ${outsidePages.join(", ")}` })
  }

  if (warnings.length > 0) return { status: "invalid", warnings }

  return {
    status: "valid",
    warnings: [],
    report: {
      taskId: expected.taskId,
      source: expected.sourcePath,
      targetPage: expected.targetPage,
      pagesCreated,
      pagesUpdated,
      candidateConcepts: strings(record.candidate_concepts),
      candidateEntities: strings(record.candidate_entities),
      candidateQuestions: strings(record.candidate_questions),
      skipped: parseSkipped(record.skipped),
    },
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function parseSkipped(value: unknown): { readonly reason: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const reason = (value as Record<string, unknown>).reason
  return typeof reason === "string" ? { reason } : null
}

function normalize(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.?\//, "")
}
```

Update `desktop/electron/services/knowledge-base/index.ts` exports:

```ts
export {
  KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA,
  parseKnowledgeBaseWorkerReport,
} from "./ingest-worker-report"
export type {
  KnowledgeBaseWorkerReport,
  KnowledgeBaseWorkerReportParseResult,
  KnowledgeBaseWorkerReportWarning,
} from "./ingest-worker-report"
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-worker-report.test.ts
```

Expected: PASS.

## Task 2: Deterministic Ingest Task Planner

**Files:**
- Create: `desktop/electron/services/knowledge-base/ingest-task-planner.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/ingest-task-planner.test.ts`
- Modify: `desktop/electron/services/knowledge-base/index.ts`

- [ ] **Step 1: Write failing planner tests**

Create `desktop/electron/services/knowledge-base/__tests__/ingest-task-planner.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { planKnowledgeBaseIngestTasks } from "../ingest-task-planner"

describe("planKnowledgeBaseIngestTasks", () => {
  it("assigns one stable source target per changed source", () => {
    const tasks = planKnowledgeBaseIngestTasks({
      changedSources: [
        { relativePath: ".raw/articles/Alpha Note.md", hash: "a".repeat(64), state: "new" },
        { relativePath: ".raw/transcripts/Alpha Note.md", hash: "b".repeat(64), state: "new" },
      ],
      manifestSources: {},
    })

    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toMatchObject({
      taskId: "kb-ingest-worker-0001",
      sourcePath: ".raw/articles/Alpha Note.md",
      sourceHash: "a".repeat(64),
      targetPage: "wiki/sources/articles-alpha-note.md",
    })
    expect(tasks[1]?.targetPage).toBe("wiki/sources/transcripts-alpha-note.md")
  })

  it("reuses an existing source page from manifest history", () => {
    const tasks = planKnowledgeBaseIngestTasks({
      changedSources: [
        { relativePath: ".raw/a.md", hash: "a".repeat(64), state: "changed" },
      ],
      manifestSources: {
        ".raw/a.md": {
          hash: "old",
          ingested_at: "2026-05-24T00:00:00.000Z",
          pages_created: ["wiki/sources/custom-a.md"],
          pages_updated: ["wiki/index.md"],
        },
      },
    })

    expect(tasks[0]?.targetPage).toBe("wiki/sources/custom-a.md")
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-task-planner.test.ts
```

Expected: FAIL because `ingest-task-planner.ts` does not exist.

- [ ] **Step 3: Implement planner**

Create `desktop/electron/services/knowledge-base/ingest-task-planner.ts`:

```ts
import { createHash } from "node:crypto"
import path from "node:path"

import type { KnowledgeBaseManifest } from "./manifest"
import type { KnowledgeBaseSourceScanItem } from "./source-scan"

export interface KnowledgeBaseIngestWorkerTask {
  readonly taskId: string
  readonly sourcePath: string
  readonly sourceHash: string
  readonly targetPage: string
  readonly mode: "create-or-update-source-page"
}

export interface PlanKnowledgeBaseIngestTasksInput {
  readonly changedSources: readonly KnowledgeBaseSourceScanItem[]
  readonly manifestSources: KnowledgeBaseManifest["sources"]
}

export function planKnowledgeBaseIngestTasks(input: PlanKnowledgeBaseIngestTasksInput): KnowledgeBaseIngestWorkerTask[] {
  const claimed = new Set<string>()
  return input.changedSources.map((source, index) => {
    const reused = existingSourcePage(input.manifestSources[source.relativePath])
    const derived = reused ?? deriveSourceTargetPage(source.relativePath)
    const targetPage = uniqueTargetPage(derived, source.relativePath, claimed)
    claimed.add(targetPage)
    return {
      taskId: `kb-ingest-worker-${String(index + 1).padStart(4, "0")}`,
      sourcePath: source.relativePath,
      sourceHash: source.hash,
      targetPage,
      mode: "create-or-update-source-page",
    }
  })
}

function existingSourcePage(entry: KnowledgeBaseManifest["sources"][string] | undefined): string | undefined {
  const pages = [...(entry?.pages_created ?? []), ...(entry?.pages_updated ?? [])]
  return pages.find((page) => page.startsWith("wiki/sources/") && page.endsWith(".md"))
}

function deriveSourceTargetPage(sourcePath: string): string {
  const withoutRaw = sourcePath.replace(/^\.raw\//, "")
  const parsed = path.posix.parse(withoutRaw)
  const prefix = parsed.dir.split("/").filter(Boolean).join("-")
  const base = slugify(parsed.name)
  return `wiki/sources/${[prefix, base].filter(Boolean).join("-")}.md`
}

function uniqueTargetPage(candidate: string, sourcePath: string, claimed: Set<string>): string {
  if (!claimed.has(candidate)) return candidate
  const parsed = path.posix.parse(candidate)
  const suffix = createHash("sha256").update(sourcePath).digest("hex").slice(0, 8)
  return `${parsed.dir}/${parsed.name}-${suffix}${parsed.ext}`
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return slug || "source"
}
```

Update `desktop/electron/services/knowledge-base/index.ts` exports:

```ts
export {
  planKnowledgeBaseIngestTasks,
} from "./ingest-task-planner"
export type {
  KnowledgeBaseIngestWorkerTask,
  PlanKnowledgeBaseIngestTasksInput,
} from "./ingest-task-planner"
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-task-planner.test.ts
```

Expected: PASS.

## Task 3: Direct Worker Write Policy

**Files:**
- Create: `desktop/electron/services/knowledge-base/ingest-worker-policy.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/ingest-worker-policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Create `desktop/electron/services/knowledge-base/__tests__/ingest-worker-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { evaluateKnowledgeBaseWorkerToolPolicy } from "../ingest-worker-policy"

describe("evaluateKnowledgeBaseWorkerToolPolicy", () => {
  it("allows worker writes only to the assigned target page", () => {
    expect(evaluateKnowledgeBaseWorkerToolPolicy("Write", {
      file_path: "wiki/sources/a.md",
      content: "# A",
    }, {
      targetPage: "wiki/sources/a.md",
    })).toBeUndefined()
  })

  it("denies manifest, vault metadata, and shared wiki writes", () => {
    const context = { targetPage: "wiki/sources/a.md" }

    expect(evaluateKnowledgeBaseWorkerToolPolicy("Write", { file_path: ".raw/.manifest.json" }, context)).toMatchObject({ behavior: "deny" })
    expect(evaluateKnowledgeBaseWorkerToolPolicy("Edit", { file_path: ".vault-meta/address-counter.txt" }, context)).toMatchObject({ behavior: "deny" })
    expect(evaluateKnowledgeBaseWorkerToolPolicy("MultiEdit", { file_path: "wiki/index.md" }, context)).toMatchObject({ behavior: "deny" })
    expect(evaluateKnowledgeBaseWorkerToolPolicy("Write", { file_path: "wiki/concepts/a.md" }, context)).toMatchObject({ behavior: "deny" })
  })

  it("does not intercept read tools", () => {
    expect(evaluateKnowledgeBaseWorkerToolPolicy("Read", {
      file_path: "wiki/index.md",
    }, {
      targetPage: "wiki/sources/a.md",
    })).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-worker-policy.test.ts
```

Expected: FAIL because `ingest-worker-policy.ts` does not exist.

- [ ] **Step 3: Implement policy**

Create `desktop/electron/services/knowledge-base/ingest-worker-policy.ts`:

```ts
import path from "node:path"

export interface KnowledgeBaseWorkerToolPolicyContext {
  readonly targetPage: string
}

export interface KnowledgeBaseWorkerToolPolicyResult {
  readonly behavior: "deny"
  readonly message: string
}

export function evaluateKnowledgeBaseWorkerToolPolicy(
  toolName: string,
  input: Record<string, unknown>,
  context: KnowledgeBaseWorkerToolPolicyContext,
): KnowledgeBaseWorkerToolPolicyResult | undefined {
  if (!isWriteTool(toolName)) return undefined
  const writePath = typeof input.file_path === "string" ? input.file_path : undefined
  if (!writePath) return deny()
  const normalized = normalizeToolPath(writePath)
  if (!normalized) return deny()
  if (normalized !== normalizeToolPath(context.targetPage)) return deny()
  return undefined
}

function isWriteTool(toolName: string): boolean {
  return ["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)
}

function deny(): KnowledgeBaseWorkerToolPolicyResult {
  return {
    behavior: "deny",
    message: "Knowledge Base ingest workers may write only their assigned wiki/sources page.",
  }
}

function normalizeToolPath(value: string): string | null {
  const normalized = value.replaceAll("\\", "/").replace(/^\.?\//, "")
  if (normalized.includes("\0")) return null
  if (path.posix.isAbsolute(normalized)) return null
  if (normalized.split("/").includes("..")) return null
  return normalized
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-worker-policy.test.ts
```

Expected: PASS.

## Task 4: One-Task Worker Session Runner

**Files:**
- Create: `desktop/electron/services/knowledge-base/ingest-worker-session-runner.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/ingest-worker-session-runner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Create `desktop/electron/services/knowledge-base/__tests__/ingest-worker-session-runner.test.ts` with a fake live session:

```ts
import { describe, expect, it, vi } from "vitest"

import { KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA } from "../ingest-worker-report"
import { KnowledgeBaseWorkerSessionRunner } from "../ingest-worker-session-runner"
import type { AgentEvent, AgentLiveSession, AgentMessage } from "../../agent-runtime/types"

class FakeWorkerSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  readonly sent: string[] = []
  private events: AgentEvent[]

  constructor(resultText: string) {
    this.events = [{ type: "result", content: resultText, done: true }]
  }

  async send(message: AgentMessage): Promise<boolean> {
    this.sent.push(message.content)
    return true
  }
  async respondPermission(): Promise<void> {}
  async nextEvent(): Promise<AgentEvent | null> { return this.events.shift() ?? null }
  currentSessionId(): string | undefined { return "worker-sdk-1" }
  alive(): boolean { return this.events.length > 0 }
  async close(): Promise<void> {}
}

describe("KnowledgeBaseWorkerSessionRunner", () => {
  it("sends a scoped worker prompt and parses the worker report", async () => {
    const resultText = [
      "```synapse_kb_worker_report",
      JSON.stringify({
        schema: KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA,
        task_id: "kb-ingest-worker-0001",
        source: ".raw/a.md",
        target_page: "wiki/sources/a.md",
        pages_created: ["wiki/sources/a.md"],
        pages_updated: [],
        candidate_concepts: [],
        candidate_entities: [],
        candidate_questions: [],
        skipped: null,
      }),
      "```",
    ].join("\n")
    const session = new FakeWorkerSession(resultText)
    const createSession = vi.fn(() => session)
    const runner = new KnowledgeBaseWorkerSessionRunner({ createSession })

    const result = await runner.run({
      projectId: "project-1",
      conversationId: "conv-1",
      providerId: "anthropic",
      cwd: "/vault",
      env: {},
      task: {
        taskId: "kb-ingest-worker-0001",
        sourcePath: ".raw/a.md",
        sourceHash: "a".repeat(64),
        targetPage: "wiki/sources/a.md",
        mode: "create-or-update-source-page",
      },
      userId: "user-1",
    })

    expect(result.status).toBe("completed")
    expect(result.report).toMatchObject({ source: ".raw/a.md", targetPage: "wiki/sources/a.md" })
    expect(session.sent[0]).toContain("Process exactly one Knowledge Base source")
    expect(session.sent[0]).toContain(".raw/a.md")
    expect(session.sent[0]).toContain("wiki/sources/a.md")
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/vault",
      providerId: "anthropic",
      targetPage: "wiki/sources/a.md",
    }))
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-worker-session-runner.test.ts
```

Expected: FAIL because `ingest-worker-session-runner.ts` does not exist.

- [ ] **Step 3: Implement runner with injectable session factory**

Create `desktop/electron/services/knowledge-base/ingest-worker-session-runner.ts`:

```ts
import type { AgentEvent, AgentLiveSession, AgentMessage } from "../agent-runtime/types"
import type { KnowledgeBaseIngestWorkerTask } from "./ingest-task-planner"
import { parseKnowledgeBaseWorkerReport, type KnowledgeBaseWorkerReport } from "./ingest-worker-report"

export interface CreateKnowledgeBaseWorkerSessionInput {
  readonly projectId: string
  readonly conversationId: string
  readonly providerId: string
  readonly cwd: string
  readonly env: Record<string, string>
  readonly model?: string
  readonly mode?: string
  readonly targetPage: string
}

export type CreateKnowledgeBaseWorkerSession = (
  input: CreateKnowledgeBaseWorkerSessionInput,
) => AgentLiveSession | Promise<AgentLiveSession>

export type KnowledgeBaseWorkerSessionResult =
  | { readonly status: "completed"; readonly report: KnowledgeBaseWorkerReport; readonly events: readonly AgentEvent[] }
  | { readonly status: "failed"; readonly warnings: readonly { readonly code: string; readonly message: string }[]; readonly events: readonly AgentEvent[] }

export class KnowledgeBaseWorkerSessionRunner {
  constructor(private readonly deps: { readonly createSession: CreateKnowledgeBaseWorkerSession }) {}

  async run(input: {
    readonly projectId: string
    readonly conversationId: string
    readonly providerId: string
    readonly cwd: string
    readonly env: Record<string, string>
    readonly model?: string
    readonly mode?: string
    readonly task: KnowledgeBaseIngestWorkerTask
    readonly userId?: string
  }): Promise<KnowledgeBaseWorkerSessionResult> {
    const session = await this.deps.createSession({
      projectId: input.projectId,
      conversationId: input.conversationId,
      providerId: input.providerId,
      cwd: input.cwd,
      env: input.env,
      model: input.model,
      mode: input.mode,
      targetPage: input.task.targetPage,
    })
    const message: AgentMessage = {
      projectId: input.projectId,
      sessionKey: input.task.taskId,
      platform: "local-renderer",
      userId: input.userId,
      content: workerPrompt(input.task),
    }
    const events: AgentEvent[] = []
    let resultText = ""
    const accepted = await session.send(message)
    if (!accepted) return { status: "failed", warnings: [{ code: "worker-send-rejected", message: "Worker session rejected message." }], events }
    while (session.alive()) {
      const event = await session.nextEvent()
      if (!event) break
      events.push(event)
      if (event.type === "result") {
        resultText = event.content ?? ""
        break
      }
      if (event.type === "error") {
        return { status: "failed", warnings: [{ code: "worker-session-error", message: event.message }], events }
      }
    }
    const parsed = parseKnowledgeBaseWorkerReport(resultText, {
      taskId: input.task.taskId,
      sourcePath: input.task.sourcePath,
      targetPage: input.task.targetPage,
    })
    return parsed.status === "valid"
      ? { status: "completed", report: parsed.report, events }
      : { status: "failed", warnings: parsed.warnings, events }
  }
}

function workerPrompt(task: KnowledgeBaseIngestWorkerTask): string {
  return [
    "Process exactly one Knowledge Base source.",
    `Task id: ${task.taskId}`,
    `Source: ${task.sourcePath}`,
    `Target page: ${task.targetPage}`,
    "Write only the target page. Do not edit shared wiki pages, .raw/.manifest.json, or .vault-meta.",
    "Return exactly one synapse_kb_worker_report fenced JSON block.",
  ].join("\n")
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-worker-session-runner.test.ts
```

Expected: PASS.

## Task 5: Parallel Runner Orchestration

**Files:**
- Create: `desktop/electron/services/knowledge-base/parallel-ingest-runner.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/parallel-ingest-runner.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

Create `desktop/electron/services/knowledge-base/__tests__/parallel-ingest-runner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { KnowledgeBaseParallelIngestRunner } from "../parallel-ingest-runner"

describe("KnowledgeBaseParallelIngestRunner", () => {
  it("runs workers and builds one merge prompt from accepted reports", async () => {
    const runWorker = vi.fn(async (input: { task: { sourcePath: string; targetPage: string } }) => ({
      status: "completed" as const,
      events: [],
      report: {
        taskId: "task",
        source: input.task.sourcePath,
        targetPage: input.task.targetPage,
        pagesCreated: [input.task.targetPage],
        pagesUpdated: [],
        candidateConcepts: ["Concept A"],
        candidateEntities: [],
        candidateQuestions: [],
        skipped: null,
      },
    }))
    const runner = new KnowledgeBaseParallelIngestRunner({
      runWorker,
      getProviderEnv: async () => ({ providerId: "anthropic", env: {} }),
    })

    const result = await runner.prepareMergePrompt({
      projectId: "project-1",
      projectPath: "/vault",
      conversationId: "conv-1",
      turnId: "turn-1",
      userId: "user-1",
      preflight: {
        projectPath: "/vault",
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [
          { relativePath: ".raw/a.md", hash: "a".repeat(64), state: "new" },
          { relativePath: ".raw/b.md", hash: "b".repeat(64), state: "new" },
        ],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
      manifestSources: {},
    })

    expect(result.status).toBe("merge-ready")
    expect(runWorker).toHaveBeenCalledTimes(2)
    expect(result.prompt).toContain("Knowledge Base merge coordinator")
    expect(result.prompt).toContain("wiki/sources/a.md")
    expect(result.prompt).toContain("Concept A")
  })

  it("skips merge when every worker fails", async () => {
    const runner = new KnowledgeBaseParallelIngestRunner({
      runWorker: async () => ({ status: "failed" as const, warnings: [{ code: "worker-report-missing", message: "Missing" }], events: [] }),
      getProviderEnv: async () => ({ providerId: "anthropic", env: {} }),
    })

    const result = await runner.prepareMergePrompt({
      projectId: "project-1",
      projectPath: "/vault",
      conversationId: "conv-1",
      turnId: "turn-1",
      userId: "user-1",
      preflight: {
        projectPath: "/vault",
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [{ relativePath: ".raw/a.md", hash: "a".repeat(64), state: "new" }],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
      manifestSources: {},
    })

    expect(result).toMatchObject({
      status: "failed",
      message: expect.stringContaining(".raw/a.md"),
    })
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/parallel-ingest-runner.test.ts
```

Expected: FAIL because `parallel-ingest-runner.ts` does not exist.

- [ ] **Step 3: Implement orchestration**

Create `desktop/electron/services/knowledge-base/parallel-ingest-runner.ts`:

```ts
import type { KnowledgeBaseManifest } from "./manifest"
import type { KnowledgeBaseIngestTurnState } from "./ingest-turn-store"
import { planKnowledgeBaseIngestTasks, type KnowledgeBaseIngestWorkerTask } from "./ingest-task-planner"
import type { KnowledgeBaseWorkerSessionResult } from "./ingest-worker-session-runner"

export interface KnowledgeBaseParallelIngestRunnerInput {
  readonly projectId: string
  readonly projectPath: string
  readonly conversationId: string
  readonly turnId: string
  readonly userId?: string
  readonly preflight: KnowledgeBaseIngestTurnState
  readonly manifestSources: KnowledgeBaseManifest["sources"]
}

export type KnowledgeBaseParallelIngestRunnerResult =
  | { readonly status: "merge-ready"; readonly prompt: string; readonly failedSources: readonly string[] }
  | { readonly status: "failed"; readonly message: string; readonly failedSources: readonly string[] }

type RunWorker = (input: {
  readonly projectId: string
  readonly conversationId: string
  readonly providerId: string
  readonly cwd: string
  readonly env: Record<string, string>
  readonly task: KnowledgeBaseIngestWorkerTask
  readonly userId?: string
}) => Promise<KnowledgeBaseWorkerSessionResult>

export class KnowledgeBaseParallelIngestRunner {
  private readonly concurrency: number

  constructor(private readonly deps: {
    readonly runWorker: RunWorker
    readonly getProviderEnv: () => Promise<{ readonly providerId: string; readonly env: Record<string, string>; readonly model?: string; readonly mode?: string }>
    readonly concurrency?: number
  }) {
    this.concurrency = deps.concurrency ?? 3
  }

  async prepareMergePrompt(input: KnowledgeBaseParallelIngestRunnerInput): Promise<KnowledgeBaseParallelIngestRunnerResult> {
    const provider = await this.deps.getProviderEnv()
    const tasks = planKnowledgeBaseIngestTasks({
      changedSources: input.preflight.changedSources,
      manifestSources: input.manifestSources,
    })
    const results = await runBounded(tasks, this.concurrency, (task) => this.deps.runWorker({
      projectId: input.projectId,
      conversationId: input.conversationId,
      providerId: provider.providerId,
      cwd: input.projectPath,
      env: provider.env,
      task,
      userId: input.userId,
    }))
    const accepted = results.flatMap((result) => result.status === "completed" ? [result.report] : [])
    const failedSources = tasks
      .filter((task, index) => results[index]?.status !== "completed")
      .map((task) => task.sourcePath)
    if (accepted.length === 0) {
      return {
        status: "failed",
        failedSources,
        message: `知识库并行导入未完成：所有 worker 失败。失败来源：${failedSources.join(", ")}`,
      }
    }
    return {
      status: "merge-ready",
      failedSources,
      prompt: buildMergePrompt({ reports: accepted, failedSources }),
    }
  }
}

async function runBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index
      index += 1
      results[current] = await run(items[current] as T)
    }
  })
  await Promise.all(workers)
  return results
}

function buildMergePrompt(input: {
  readonly reports: readonly {
    readonly source: string
    readonly targetPage: string
    readonly pagesCreated: readonly string[]
    readonly pagesUpdated: readonly string[]
    readonly candidateConcepts: readonly string[]
    readonly candidateEntities: readonly string[]
    readonly candidateQuestions: readonly string[]
  }[]
  readonly failedSources: readonly string[]
}): string {
  return [
    "Knowledge Base merge coordinator.",
    "Workers already created or updated source-owned pages. Do not reprocess .raw sources from scratch.",
    "Update shared wiki pages exactly once: wiki/concepts, wiki/entities, wiki/questions, wiki/index.md, wiki/hot.md, and wiki/log.md.",
    "Do not edit .raw/.manifest.json, .vault-meta, hashes, ingested_at, or address_map.",
    "Worker reports:",
    JSON.stringify(input.reports, null, 2),
    input.failedSources.length > 0 ? `Failed worker sources: ${input.failedSources.join(", ")}` : "",
    "Finish with exactly one synapse_kb_ingest_report fenced JSON block.",
  ].filter(Boolean).join("\n\n")
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/parallel-ingest-runner.test.ts
```

Expected: PASS.

## Task 6: Agent Contribution Integration

**Files:**
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

- [ ] **Step 1: Write failing contribution tests**

Add tests to `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`:

```ts
it("uses the parallel ingest runner for larger local-renderer ingest batches", async () => {
  const projectPath = await tempDir()
  await mkdir(path.join(projectPath, ".raw"), { recursive: true })
  await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{},\"address_map\":{}}\n")
  await writeFile(path.join(projectPath, ".raw", "a.md"), "alpha\n")
  await writeFile(path.join(projectPath, ".raw", "b.md"), "bravo\n")

  const prepareMergePrompt = vi.fn(async () => ({
    status: "merge-ready" as const,
    prompt: "merge prompt from runner",
    failedSources: [],
  }))
  const contribution = await createKnowledgeBaseAgentContribution({
    project: knowledgeBaseProject(projectPath),
    parallelIngestRunner: { prepareMergePrompt } as never,
    parallelIngestThreshold: 2,
  })

  const prepared = await contribution?.prepareMessage?.(baseMessage("汲取知识"), {
    isNewLiveSession: false,
    conversationId: "conv-1",
    turnId: "turn-1",
  })

  expect(prepareMergePrompt).toHaveBeenCalled()
  expect(prepared?.content).toBe("merge prompt from runner")
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: FAIL because `parallelIngestRunner` and `parallelIngestThreshold` are not supported.

- [ ] **Step 3: Integrate runner conservatively**

Modify `desktop/electron/services/knowledge-base/agent-contribution.ts`:

```ts
type ParallelIngestRunnerLike = {
  prepareMergePrompt(input: {
    readonly projectId: string
    readonly projectPath: string
    readonly conversationId: string
    readonly turnId: string
    readonly userId?: string
    readonly preflight: KnowledgeBaseIngestTurnState
    readonly manifestSources: KnowledgeBaseManifest["sources"]
  }): Promise<{ readonly status: "merge-ready"; readonly prompt: string } | { readonly status: "failed"; readonly message: string }>
}
```

Add optional constructor inputs:

```ts
readonly parallelIngestRunner?: ParallelIngestRunnerLike
readonly parallelIngestThreshold?: number
```

After `ingestCoordinator.prepareTurn()` stores preflight and before returning the prompt, branch only when all of these are true:

```ts
input.parallelIngestRunner
  && isKnowledgeBaseAgentMessage(message)
  && isKnowledgeBaseSourceIngestIntent(message.content)
  && changedSources.length >= (input.parallelIngestThreshold ?? 3)
```

Because `prepareTurn()` currently returns only prompt/result, add a narrow method to `KnowledgeBaseIngestCoordinator` in this task:

```ts
preparePreflight(input): Promise<
  | { kind: "ready"; state: KnowledgeBaseIngestTurnState; manifestSources: KnowledgeBaseManifest["sources"] }
  | { kind: "result"; output: RegisteredPromptCommandOutput }
>
```

Then make existing `prepareTurn()` call `preparePreflight()` and render the legacy prompt, preserving old behavior for small batches.

- [ ] **Step 4: Wire production runner in agent-runtime index**

Modify `desktop/electron/services/agent-runtime/index.ts` to create the runner only for KB contribution construction. Pass a `getProviderEnv` dependency that uses the existing `providerService` and the actor from the current message. Keep this dependency scoped to KB contribution setup and do not expose it to Scheduler or Workflow.

Use a factory shape like:

```ts
const parallelIngestRunner = new KnowledgeBaseParallelIngestRunner({
  getProviderEnv: async () => {
    const provider = await providerService.getActiveProvider()
    if (!provider) throw new Error("Provider is required")
    return {
      providerId: provider.id,
      env: await providerService.buildEnv(provider.id, {
        actor: { kind: "user" },
        projectId: ctx.projectId,
      }),
    }
  },
  runWorker: (workerInput) => workerSessionRunner.run(workerInput),
})
```

- [ ] **Step 5: Run integration tests and verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts
```

Expected: PASS.

## Task 7: Focused Verification

**Files:**
- No production files unless previous tasks reveal type errors.

- [ ] **Step 1: Run all new KB parallel ingest tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-worker-report.test.ts electron/services/knowledge-base/__tests__/ingest-task-planner.test.ts electron/services/knowledge-base/__tests__/ingest-worker-policy.test.ts electron/services/knowledge-base/__tests__/ingest-worker-session-runner.test.ts electron/services/knowledge-base/__tests__/parallel-ingest-runner.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run existing affected tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts electron/services/agent-runtime/__tests__/session-manager.test.ts electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts electron/services/knowledge-base/__tests__/manifest-finalizer.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

## Self-Review Checklist

- Spec coverage:
  - task planner: Task 2.
  - worker report parser: Task 1.
  - code-level write guard: Task 3.
  - worker execution and report collection: Task 4 and Task 5.
  - merge coordinator prompt: Task 5.
  - KB-only integration: Task 6.
  - finalizer single-writer behavior: preserved and verified in Task 7.
- Placeholder scan: no unfinished markers or unspecified implementation steps.
- Type consistency:
  - Worker task fields are `taskId`, `sourcePath`, `sourceHash`, `targetPage`, and `mode`.
  - Worker report fields map snake_case JSON to camelCase TypeScript.
  - Runner returns `merge-ready` or `failed`.
