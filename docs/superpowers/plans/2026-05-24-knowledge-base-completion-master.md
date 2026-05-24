# Knowledge Base Completion Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining Knowledge Base work after file conversion Stage 2: Workflow reuse, local OCR/image/scanned PDF support, URL ingest, cross-platform packaging verification, deterministic manifest finalization, real Agent ingest end-to-end coverage, and session-scoped Knowledge Base context injection.

**Architecture:** Keep common file processing independent from Knowledge Base. Knowledge Base staging consumes common conversion/acquisition services and writes only data assets to the user vault. Knowledge Base Agent behavior remains Synapse-owned and is injected only through project contributions/session construction for Knowledge Base projects.

**Tech Stack:** Electron main process, TypeScript, Vitest, existing Workflow service/editor patterns, existing Agent Runtime project contributions, local file-conversion service, local HTML cleanup, optional local OCR abstraction, Electron Builder.

---

## Check File

Use this acceptance contract throughout implementation:

- `docs/superpowers/specs/2026-05-24-knowledge-base-completion-master-check.md`

Related existing specs and plans:

- `docs/superpowers/specs/2026-05-24-file-conversion-stage2-validation-design.md`
- `docs/superpowers/plans/2026-05-24-file-conversion-stage2-validation.md`
- `docs/superpowers/reports/2026-05-24-file-conversion-stage2-dependency-decisions.md`
- `docs/superpowers/specs/2026-05-24-knowledge-base-deterministic-manifest-finalization-design.md`
- `docs/superpowers/specs/2026-05-24-knowledge-base-final-integration-check.md`
- `docs/superpowers/plans/2026-05-24-knowledge-base-final-integration.md`

## File Map

Expected new files:

- `desktop/electron/services/source-acquisition/url-source.ts`
  - Fetches, bounds, and locally cleans URL sources.
- `desktop/electron/services/source-acquisition/html-to-source-markdown.ts`
  - Converts local HTML strings into source Markdown.
- `desktop/electron/services/source-acquisition/__tests__/url-source.test.ts`
  - URL source acquisition tests.
- `desktop/electron/services/file-conversion/ocr/types.ts`
  - OCR abstraction and result types.
- `desktop/electron/services/file-conversion/ocr/local-ocr.ts`
  - Local OCR adapter or unavailable adapter.
- `desktop/electron/services/file-conversion/__tests__/ocr.test.ts`
  - Local OCR behavior tests with deterministic injected engine.
- `desktop/electron/services/knowledge-base/ingest-coordinator.ts`
  - Shared preflight/finalization coordinator for `/wiki ingest` and natural language ingest.
- `desktop/electron/services/knowledge-base/ingest-report.ts`
  - Parses and validates Agent `synapse_kb_ingest_report` JSON.
- `desktop/electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts`
  - Deterministic manifest finalization tests.
- `desktop/electron/services/knowledge-base/__tests__/agent-ingest-e2e.test.ts`
  - Fake SDK end-to-end ingest tests.
- `desktop/electron/services/workflow/nodes/file-conversion-node.ts`
  - Workflow node runtime for common file conversion.
- `desktop/electron/services/workflow/__tests__/file-conversion-node.test.ts`
  - Workflow runtime tests.
- `desktop/src/modules/workflow/editor/__tests__/file-conversion-node-config.test.tsx`
  - Renderer config tests if a config UI is added.

Expected modified files:

- `desktop/electron/services/file-conversion/index.ts`
  - Export OCR-capable options only if required by common conversion.
- `desktop/electron/services/file-conversion/service.ts`
  - Keep common conversion independent; add OCR hook only through common options.
- `desktop/electron/services/file-conversion/extractors/pdf.ts`
  - Route empty text PDFs to optional local OCR when enabled.
- `desktop/electron/services/knowledge-base/source-staging.ts`
  - Accept URL acquisition output and OCR/image conversion outputs.
- `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
  - Expose URL upload/add-source API if the existing IPC needs it.
- `desktop/electron/modules/knowledge-base/ipc.ts`
  - Add narrow URL source IPC only if the UI/source manager needs it.
- `desktop/src/types/knowledge-base.ts`
  - Add source upload/acquisition result types.
- `desktop/electron/services/knowledge-base/wiki-command-prompts.ts`
  - Use shared ingest coordinator output.
- `desktop/electron/services/knowledge-base/agent-contribution.ts`
  - Ensure session-scoped KB injection and natural-language ingest route through coordinator.
- `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
  - Add a narrow session-resource injection seam only if current contribution hooks cannot provide SDK session context.
- `desktop/electron/services/agent-runtime/project-contributions.ts`
  - Keep KB contributions project-scoped and testable.
- `desktop/electron/services/workflow/workflow-engine.ts`
  - Register or execute file-conversion node according to current workflow node architecture.
- `desktop/electron/services/workflow/workflow-validator.ts`
  - Validate file-conversion node config.
- `desktop/src/types/workflow.ts`
  - Add file-conversion node config/result types if the existing extensible node type map requires it.
- `desktop/src/modules/workflow/editor/node-config-panel.tsx`
  - Minimal UI for file-conversion node config if needed.
- `desktop/package.json` and `pnpm-lock.yaml`
  - Add only dependencies proven by tests and packaging checks.
- `docs/superpowers/reports/2026-05-24-file-conversion-stage2-dependency-decisions.md`
  - Update after OCR or packaging dependency changes.

## Execution Order

The order matters:

1. Manifest ownership and Agent ingest coordinator.
2. Session-scoped Knowledge Base context injection verification.
3. URL source acquisition.
4. Local OCR/image/scanned PDF support.
5. Knowledge Base staging integration for URL/OCR/image.
6. Real Agent ingest E2E.
7. Workflow conversion node.
8. Cross-platform package verification and final boundary scan.

Workflow comes late because it must reuse the common conversion service after OCR and URL-adjacent boundaries are stable.

---

### Task 1: Add Manifest Ingest Report Parser

**Files:**
- Create: `desktop/electron/services/knowledge-base/ingest-report.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/ingest-report.test.ts`

- [ ] **Step 1: Write failing report parser tests**

Create `desktop/electron/services/knowledge-base/__tests__/ingest-report.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { parseKnowledgeBaseIngestReport } from "../ingest-report"

describe("parseKnowledgeBaseIngestReport", () => {
  it("extracts exactly one marked ingest report block", () => {
    const text = [
      "Done.",
      "```json synapse_kb_ingest_report",
      JSON.stringify({
        schema: "synapse.kb.ingest.report.v1",
        processed_sources: [{
          source: ".raw/documents/a.md",
          pages_created: ["wiki/sources/a.md"],
          pages_updated: ["wiki/index.md"],
        }],
        skipped_sources: [],
      }),
      "```",
    ].join("\n")

    expect(parseKnowledgeBaseIngestReport(text)).toEqual({
      ok: true,
      report: {
        schema: "synapse.kb.ingest.report.v1",
        processedSources: [{
          source: ".raw/documents/a.md",
          pagesCreated: ["wiki/sources/a.md"],
          pagesUpdated: ["wiki/index.md"],
        }],
        skippedSources: [],
      },
      warnings: [],
    })
  })

  it("fails closed when multiple report blocks are present", () => {
    const block = [
      "```json synapse_kb_ingest_report",
      "{\"schema\":\"synapse.kb.ingest.report.v1\",\"processed_sources\":[],\"skipped_sources\":[]}",
      "```",
    ].join("\n")

    expect(parseKnowledgeBaseIngestReport(`${block}\n${block}`)).toMatchObject({
      ok: false,
      code: "multiple-reports",
    })
  })
})
```

- [ ] **Step 2: Verify the parser test fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-report.test.ts
```

Expected: FAIL because `ingest-report.ts` does not exist.

- [ ] **Step 3: Implement the parser**

Create `desktop/electron/services/knowledge-base/ingest-report.ts`:

```ts
export interface KnowledgeBaseIngestReportSource {
  readonly source: string
  readonly pagesCreated: readonly string[]
  readonly pagesUpdated: readonly string[]
}

export interface KnowledgeBaseIngestReportSkippedSource {
  readonly source: string
  readonly reason: string
}

export interface KnowledgeBaseIngestReport {
  readonly schema: "synapse.kb.ingest.report.v1"
  readonly processedSources: readonly KnowledgeBaseIngestReportSource[]
  readonly skippedSources: readonly KnowledgeBaseIngestReportSkippedSource[]
}

export type ParseKnowledgeBaseIngestReportResult =
  | { readonly ok: true; readonly report: KnowledgeBaseIngestReport; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly code: string; readonly message: string }

const REPORT_BLOCK = /```(?:json)?\\s+synapse_kb_ingest_report\\s*\\n([\\s\\S]*?)\\n```/g

export function parseKnowledgeBaseIngestReport(text: string): ParseKnowledgeBaseIngestReportResult {
  const matches = [...text.matchAll(REPORT_BLOCK)]
  if (matches.length === 0) {
    return { ok: false, code: "missing-report", message: "No synapse_kb_ingest_report block was found." }
  }
  if (matches.length > 1) {
    return { ok: false, code: "multiple-reports", message: "Multiple synapse_kb_ingest_report blocks were found." }
  }
  try {
    const raw = JSON.parse(matches[0][1] ?? "")
    if (raw?.schema !== "synapse.kb.ingest.report.v1") {
      return { ok: false, code: "invalid-schema", message: "Ingest report schema is invalid." }
    }
    const processedSources = normalizeProcessedSources(raw.processed_sources)
    const skippedSources = normalizeSkippedSources(raw.skipped_sources)
    return {
      ok: true,
      report: { schema: "synapse.kb.ingest.report.v1", processedSources, skippedSources },
      warnings: [],
    }
  } catch (error) {
    return {
      ok: false,
      code: "invalid-json",
      message: error instanceof Error ? error.message : "Ingest report JSON could not be parsed.",
    }
  }
}

function normalizeProcessedSources(value: unknown): KnowledgeBaseIngestReportSource[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const source = stringField(entry, "source")
    if (!source) return []
    return [{
      source,
      pagesCreated: stringArrayField(entry, "pages_created"),
      pagesUpdated: stringArrayField(entry, "pages_updated"),
    }]
  })
}

function normalizeSkippedSources(value: unknown): KnowledgeBaseIngestReportSkippedSource[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const source = stringField(entry, "source")
    const reason = stringField(entry, "reason")
    if (!source || !reason) return []
    return [{ source, reason }]
  })
}

function stringField(value: object, key: string): string | null {
  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : null
}

function stringArrayField(value: object, key: string): string[] {
  const field = (value as Record<string, unknown>)[key]
  if (!Array.isArray(field)) return []
  return field.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}
```

- [ ] **Step 4: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-report.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/knowledge-base/ingest-report.ts desktop/electron/services/knowledge-base/__tests__/ingest-report.test.ts
git commit -m "feat(kb): parse deterministic ingest reports"
```

---

### Task 2: Add Deterministic Ingest Coordinator

**Files:**
- Create: `desktop/electron/services/knowledge-base/ingest-coordinator.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts`
- Modify: `desktop/electron/services/knowledge-base/index.ts`

- [ ] **Step 1: Add failing coordinator tests**

Create tests that prove:

- preflight scans `.raw/` and computes hashes;
- finalize rejects unknown `.raw/` source paths;
- finalize rejects wiki paths outside `wiki/`;
- finalize verifies listed wiki pages exist;
- valid reports update `manifest.sources`;
- invalid reports leave `manifest.sources` unchanged;
- address finalizer still updates `address_map`.

Use this minimal test shape:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { KnowledgeBaseIngestCoordinator } from "../ingest-coordinator"

const roots: string[] = []

async function mkdtempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-ingest-coordinator-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("KnowledgeBaseIngestCoordinator", () => {
  it("writes manifest sources from trusted preflight hashes after a valid report", async () => {
    const root = await mkdtempProject()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(root, ".raw", "note.md"), "# Source\n")

    const coordinator = new KnowledgeBaseIngestCoordinator({ now: () => new Date("2026-05-24T00:00:00.000Z") })
    const preflight = await coordinator.prepareTurn({ projectPath: root, force: false })

    await writeFile(path.join(root, "wiki", "sources", "note.md"), "---\naddress: c-000001\n---\n# Note\n")
    await coordinator.finalizeTurn({
      projectPath: root,
      preflightId: preflight.id,
      assistantText: [
        "```json synapse_kb_ingest_report",
        JSON.stringify({
          schema: "synapse.kb.ingest.report.v1",
          processed_sources: [{
            source: ".raw/note.md",
            pages_created: ["wiki/sources/note.md"],
            pages_updated: [],
          }],
          skipped_sources: [],
        }),
        "```",
      ].join("\n"),
    })

    const manifest = JSON.parse(await readFile(path.join(root, ".raw", ".manifest.json"), "utf8"))
    expect(manifest.sources[".raw/note.md"].hash).toBe(preflight.sources[0].hash)
    expect(manifest.sources[".raw/note.md"].pages_created).toEqual(["wiki/sources/note.md"])
  })
})
```

- [ ] **Step 2: Verify the coordinator test fails**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts
```

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Implement coordinator with in-memory preflight snapshots**

Create `KnowledgeBaseIngestCoordinator` with:

```ts
interface PrepareKnowledgeBaseIngestTurnInput {
  readonly projectPath: string
  readonly force: boolean
}

interface FinalizeKnowledgeBaseIngestTurnInput {
  readonly projectPath: string
  readonly preflightId: string
  readonly assistantText: string
}
```

The first implementation may keep preflight snapshots in a bounded in-memory map keyed by id. Do not use a global singleton; instantiate through Knowledge Base services or contribution wiring.

- [ ] **Step 4: Use existing manifest helpers**

Reuse existing manifest read/write helpers from `desktop/electron/services/knowledge-base/manifest.ts`.

Rules:

- source paths must start with `.raw/`;
- wiki page paths must start with `wiki/` and end with `.md`;
- normalized paths must remain inside project root;
- use preflight hashes, not Agent hashes;
- preserve existing manifest source entries not processed this turn.

- [ ] **Step 5: Export the coordinator**

Modify `desktop/electron/services/knowledge-base/index.ts` to export `KnowledgeBaseIngestCoordinator` and its public types.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts electron/services/knowledge-base/__tests__/manifest-writer.test.ts electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/knowledge-base/ingest-coordinator.ts desktop/electron/services/knowledge-base/__tests__/ingest-coordinator.test.ts desktop/electron/services/knowledge-base/index.ts
git commit -m "feat(kb): finalize ingest manifest deterministically"
```

---

### Task 3: Route `/wiki ingest` And Natural-Language Ingest Through Coordinator

**Files:**
- Modify: `desktop/electron/services/knowledge-base/wiki-command-prompts.ts`
- Modify: `desktop/electron/services/knowledge-base/wiki-command-copy.ts`
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`
- Modify: `desktop/electron/services/knowledge-base/ingest-intent.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/ingest-intent.test.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`

- [ ] **Step 1: Add failing prompt tests**

Assert `/wiki ingest` output contains:

- changed source list from coordinator preflight;
- explicit instruction: Agent must not edit `.raw/.manifest.json`;
- required `synapse_kb_ingest_report` fenced JSON contract;
- force flag when `/wiki ingest --force` is used.

- [ ] **Step 2: Add natural-language routing tests**

Extend ingest intent tests for:

```text
汲取知识
提取知识
导入这些来源
process these sources
add this to the wiki
```

Expected: recognized only for Knowledge Base projects through the contribution path.

- [ ] **Step 3: Wire command prompt construction**

Change `/wiki ingest` from a model-only prompt into:

1. call coordinator `prepareTurn`;
2. build prompt appendix;
3. store preflight id in the contribution turn context;
4. finalize after the Agent turn using assistant text.

- [ ] **Step 4: Wire natural-language ingest**

Natural-language ingest must call the same `prepareTurn` and `finalizeTurn` path as `/wiki ingest`.

Do not duplicate scan/hash code in the prompt builder.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts electron/services/knowledge-base/__tests__/ingest-intent.test.ts electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/knowledge-base/wiki-command-prompts.ts desktop/electron/services/knowledge-base/wiki-command-copy.ts desktop/electron/services/knowledge-base/agent-contribution.ts desktop/electron/services/knowledge-base/ingest-intent.ts desktop/electron/services/knowledge-base/__tests__/wiki-command-prompts.test.ts desktop/electron/services/knowledge-base/__tests__/ingest-intent.test.ts desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
git commit -m "feat(kb): route ingest through deterministic coordinator"
```

---

### Task 4: Lock Knowledge Base Session-Scoped Context Injection

**Files:**
- Modify: `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
- Modify: `desktop/electron/services/agent-runtime/claude-sdk-session.ts` only if tests show the current seam is insufficient.
- Modify: `desktop/electron/services/agent-runtime/project-contributions.ts` only if tests show contribution scoping is insufficient.
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts`

- [ ] **Step 1: Add failing isolation tests**

Tests must prove:

- Knowledge Base project sessions load KB plugin/prompt resources from Synapse resources.
- Ordinary project sessions do not include KB plugin paths.
- Scheduler/Workflow-created Agent paths do not receive KB contribution unless the project is explicitly Knowledge Base and the entrypoint supports it.
- `disableAllHooks` remains true unless a future approved KB-specific hook mechanism exists.
- No session code writes KB Agent assets into project path.

- [ ] **Step 2: Add explicit session resource contract if missing**

If current project contributions already support this, keep production changes minimal.

If not, add a narrow type:

```ts
interface AgentSessionResourceContribution {
  readonly pluginPaths?: readonly string[]
  readonly promptAppendix?: string
  readonly settingSources?: readonly ("user" | "project" | "local")[]
}
```

The exact type name should follow existing Agent Runtime naming.

- [ ] **Step 3: Update Knowledge Base contribution only**

Ensure KB session context is contributed only when the project has `knowledgeBase` capability.

- [ ] **Step 4: Run boundary tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run template scan**

```bash
find desktop/resources/knowledge-base/templates -maxdepth 6 -type f | rg "(SKILL.md|\\.claude|\\.agents|\\.codex|commands/|hooks/|plugin|script)" || true
```

Expected: empty output.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/agent-runtime desktop/electron/services/knowledge-base/agent-contribution.ts
git commit -m "test(kb): lock session scoped agent resources"
```

---

### Task 5: Add URL Source Acquisition Service

**Files:**
- Create: `desktop/electron/services/source-acquisition/url-source.ts`
- Create: `desktop/electron/services/source-acquisition/html-to-source-markdown.ts`
- Create: `desktop/electron/services/source-acquisition/__tests__/url-source.test.ts`
- Modify: `desktop/electron/services/knowledge-base/source-staging.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/source-staging.test.ts`

- [ ] **Step 1: Add failing URL acquisition tests**

Create tests for:

- valid HTML URL -> Markdown;
- redirect stores final URL;
- unsupported protocol rejects;
- localhost/private URL rejects by default;
- oversized response rejects;
- network failure returns structured error;
- no online parser API calls are needed.

Use an injected fetch function:

```ts
type FetchUrl = (url: string, init: { readonly signal: AbortSignal }) => Promise<{
  readonly url: string
  readonly status: number
  readonly headers: { get(name: string): string | null }
  text(): Promise<string>
}>
```

- [ ] **Step 2: Implement URL validation**

Allow only `http:` and `https:` by default.

Reject:

- `file:`;
- `data:`;
- `javascript:`;
- credentials in URL;
- private/local hosts unless an explicit test-only or future setting enables them.

- [ ] **Step 3: Implement local HTML cleanup**

Use a local parser or conservative regex-free DOM parser available in the project dependencies. If adding a dependency, document it and test packaging later.

Output Markdown frontmatter must include:

```md
---
source_url: "https://example.com/a"
source_final_url: "https://example.com/a"
source_format: "url"
fetched_at: "2026-05-24T00:00:00.000Z"
content_type: "text/html"
---
```

- [ ] **Step 4: Integrate with Knowledge Base staging**

Add a source staging entrypoint for URLs that writes to:

```text
.raw/web/YYYY/MM/DD/<slug>.md
```

Do not write to `wiki/` directly.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/source-acquisition/__tests__/url-source.test.ts electron/services/knowledge-base/__tests__/source-staging.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/source-acquisition desktop/electron/services/knowledge-base/source-staging.ts desktop/electron/services/knowledge-base/__tests__/source-staging.test.ts
git commit -m "feat(kb): stage url sources locally"
```

---

### Task 6: Add Local OCR Abstraction And Image Fixtures

**Files:**
- Create: `desktop/electron/services/file-conversion/ocr/types.ts`
- Create: `desktop/electron/services/file-conversion/ocr/local-ocr.ts`
- Create: `desktop/electron/services/file-conversion/__tests__/ocr.test.ts`
- Modify: `desktop/electron/services/file-conversion/types.ts`
- Modify: `desktop/electron/services/file-conversion/registry.ts`
- Modify: `desktop/electron/services/file-conversion/service.ts`
- Modify: `desktop/electron/services/file-conversion/extractors/pdf.ts`
- Modify: `desktop/electron/services/file-conversion/index.ts`

- [ ] **Step 1: Add failing OCR tests with injected engine**

Tests:

- image conversion uses injected local OCR engine;
- scanned PDF with empty embedded text can use OCR when enabled;
- OCR unavailable returns a structured failure or warning, not a crash;
- OCR output includes confidence and page/image metadata when provided.

- [ ] **Step 2: Add OCR types**

Use a small interface:

```ts
export interface LocalOcrEngine {
  recognize(input: { readonly filePath: string; readonly mimeType?: string }): Promise<{
    readonly text: string
    readonly confidence?: number
    readonly metadata?: Record<string, unknown>
    readonly warnings?: readonly { readonly code: string; readonly message: string }[]
  }>
}
```

- [ ] **Step 3: Implement unavailable default**

Default OCR engine should return a structured unavailable result. Do not silently install or call remote services.

- [ ] **Step 4: Add image formats to conversion registry**

Add formats only if type definitions and tests are in the same task:

```ts
type FileConversionFormat = "doc" | "docx" | "xlsx" | "pdf" | "ppt" | "pptx" | "png" | "jpg" | "jpeg" | "webp"
```

- [ ] **Step 5: Route empty text PDF to OCR only when enabled**

Existing text PDF behavior must remain unchanged when OCR is disabled.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/ocr.test.ts electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts electron/services/file-conversion/__tests__/file-conversion-errors.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/file-conversion
git commit -m "feat(file-conversion): add local ocr abstraction"
```

---

### Task 7: Integrate OCR And URL Sources Into Knowledge Base Staging

**Files:**
- Modify: `desktop/electron/services/knowledge-base/source-staging.ts`
- Modify: `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
- Modify: `desktop/electron/modules/knowledge-base/ipc.ts` only if a new IPC is needed.
- Modify: `desktop/src/types/knowledge-base.ts`
- Create or modify: `desktop/electron/services/knowledge-base/__tests__/source-staging-url-ocr.test.ts`

- [ ] **Step 1: Add failing staging tests**

Tests:

- URL source writes `.raw/web/YYYY/MM/DD/*.md`;
- image OCR source archives original under `_attachments/originals/YYYY/MM/DD/` and writes `.raw/images/YYYY/MM/DD/*.md`;
- scanned PDF OCR output writes `.raw/pdfs/YYYY/MM/DD/*.md`;
- conversion warnings are preserved in upload result;
- unsupported OCR unavailable result becomes `conversion-error` or `ocr-unavailable` according to final type choice.

- [ ] **Step 2: Extend upload/source result types**

Add fields without breaking existing callers:

```ts
readonly sourceKind?: "file" | "url"
readonly sourceUrl?: string
readonly originalRelativePath?: string
readonly conversionWarnings?: readonly FileConversionWarning[]
```

- [ ] **Step 3: Implement staging integration**

Keep all writes under:

```text
.raw/web/
.raw/images/
.raw/pdfs/
_attachments/originals/
```

- [ ] **Step 4: Run source staging tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/source-staging.test.ts electron/services/knowledge-base/__tests__/source-staging-fixtures.test.ts electron/services/knowledge-base/__tests__/source-staging-url-ocr.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/knowledge-base desktop/electron/modules/knowledge-base/ipc.ts desktop/src/types/knowledge-base.ts
git commit -m "feat(kb): stage url and ocr sources"
```

---

### Task 8: Add Real Agent Ingest End-To-End Harness

**Files:**
- Create: `desktop/electron/services/knowledge-base/__tests__/agent-ingest-e2e.test.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts`
- Modify: `desktop/electron/services/knowledge-base/agent-contribution.ts` only if required by tests.

- [ ] **Step 1: Add fake SDK end-to-end test**

The test must:

1. create a temp Knowledge Base vault;
2. write `.raw/note.md`;
3. start a Knowledge Base Agent contribution turn for `/wiki ingest`;
4. fake the assistant writing `wiki/sources/note.md`, `wiki/index.md`, `wiki/hot.md`, and `wiki/log.md`;
5. fake assistant text with `synapse_kb_ingest_report`;
6. run after-turn finalization;
7. assert manifest source entry and address map are written.

- [ ] **Step 2: Add natural-language variant**

Use:

```text
汲取知识
```

Expected: same coordinator path and same manifest result shape.

- [ ] **Step 3: Add ordinary Agent negative test**

An ordinary project must not receive:

- KB plugin path;
- KB preflight appendix;
- KB after-turn finalizer.

- [ ] **Step 4: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/agent-ingest-e2e.test.ts electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/knowledge-base/__tests__/agent-ingest-e2e.test.ts desktop/electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts desktop/electron/services/knowledge-base/agent-contribution.ts
git commit -m "test(kb): cover real agent ingest finalization"
```

---

### Task 9: Add Workflow File Conversion Node Runtime

**Files:**
- Create: `desktop/electron/services/workflow/nodes/file-conversion-node.ts`
- Create: `desktop/electron/services/workflow/__tests__/file-conversion-node.test.ts`
- Modify: `desktop/electron/services/workflow/workflow-engine.ts`
- Modify: `desktop/electron/services/workflow/workflow-validator.ts`
- Modify: `desktop/src/types/workflow.ts`

- [ ] **Step 1: Add failing workflow runtime tests**

Tests:

- node converts a local DOCX using an injected conversion service;
- node returns structured result;
- node propagates conversion warnings;
- node returns structured failure for unsupported/encrypted/size-limit errors;
- node production code has no KB imports.

- [ ] **Step 2: Implement runtime node with injected converter**

Use common conversion types:

```ts
interface WorkflowFileConversionNodeConfig {
  readonly inputPath: string
  readonly outputMode?: "result" | "markdown-file"
  readonly outputPath?: string
}
```

Do not include `.raw`, `wiki`, or Knowledge Base options.

- [ ] **Step 3: Add validator rules**

Reject:

- missing `inputPath`;
- `markdown-file` without `outputPath`;
- output paths that escape allowed workflow output boundaries.

- [ ] **Step 4: Run focused workflow tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/workflow/__tests__/file-conversion-node.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/workflow desktop/src/types/workflow.ts
git commit -m "feat(workflow): add file conversion node runtime"
```

---

### Task 10: Add Workflow File Conversion Node UI

**Files:**
- Modify: `desktop/src/modules/workflow/editor/node-palette.tsx`
- Modify: `desktop/src/modules/workflow/editor/node-config-panel.tsx`
- Create or modify: `desktop/src/modules/workflow/editor/__tests__/file-conversion-node-config.test.tsx`

- [ ] **Step 1: Read UI rules before editing**

Read:

```bash
sed -n '1,220p' .claude/rules/design.md
sed -n '1,220p' .claude/rules/ui-rules.md
sed -n '1,180p' desktop/components.json
sed -n '1,220p' desktop/src/styles/globals.css
```

- [ ] **Step 2: Add failing renderer tests**

Tests must assert:

- File Conversion node appears in node palette;
- config panel shows input path binding;
- output mode select exists;
- validation message appears for missing input path;
- UI uses existing form/select/input components.

- [ ] **Step 3: Implement minimal UI**

Use existing Workflow editor patterns. Keep labels short:

- `Input`
- `Output`
- `Result only`
- `Markdown file`

No explanatory paragraphs.

- [ ] **Step 4: Run renderer tests**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/editor/__tests__/file-conversion-node-config.test.tsx src/modules/workflow/editor/__tests__/node-config-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/workflow/editor
git commit -m "feat(workflow): configure file conversion nodes"
```

---

### Task 11: Cross-Platform Packaging And Dependency Report

**Files:**
- Modify: `docs/superpowers/reports/2026-05-24-file-conversion-stage2-dependency-decisions.md`
- Create: `docs/superpowers/reports/2026-05-24-knowledge-base-completion-package-check.md`
- Modify: package/build config only if a packaging failure is caused by this work and the fix is narrow.

- [ ] **Step 1: Run required verification commands**

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run build:electron
pnpm --filter @synapse/desktop run build:renderer
pnpm --filter @synapse/desktop exec electron-builder --dir --mac --arm64 --publish never
pnpm --filter @synapse/desktop why pdf-parse
pnpm --filter @synapse/desktop why officeparser
pnpm --filter @synapse/desktop why @napi-rs/canvas
```

- [ ] **Step 2: Inspect native and worker assets**

```bash
find node_modules desktop/node_modules -name '*.node' -o -name '*.dylib' -o -name '*.so' -o -name '*.dll' | rg '(@napi-rs|canvas|pdfjs|pdf-parse|officeparser|tesseract|ocr)' || true
find desktop/release/mac-arm64 -name '*.node' -o -name '*.dylib' -o -name '*.so' -o -name '*.dll' | rg '(@napi-rs|canvas|pdfjs|pdf-parse|officeparser|tesseract|ocr)' || true
find node_modules desktop/node_modules | rg '(traineddata|worker|tesseract|ocr)' || true
```

- [ ] **Step 3: Create package check report**

Create `docs/superpowers/reports/2026-05-24-knowledge-base-completion-package-check.md` with:

- command result table;
- dependency graph summary;
- native asset summary;
- macOS result;
- Windows/Linux verification status;
- explicit remaining release risks.

- [ ] **Step 4: Commit report and narrow fixes**

```bash
git add docs/superpowers/reports/2026-05-24-knowledge-base-completion-package-check.md docs/superpowers/reports/2026-05-24-file-conversion-stage2-dependency-decisions.md desktop/package.json pnpm-lock.yaml
git commit -m "docs(kb): record completion packaging checks"
```

---

### Task 12: Final Boundary Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-05-24-knowledge-base-completion-master-check.md` only if verification reveals an accepted exception.

- [ ] **Step 1: Run full focused test set**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__ electron/services/knowledge-base/__tests__ electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts electron/services/workflow/__tests__/file-conversion-node.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run type/build/hard checks**

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run build:electron
pnpm --filter @synapse/desktop run build:renderer
```

Expected: PASS.

- [ ] **Step 3: Run boundary scans**

```bash
find desktop/resources/knowledge-base/templates -maxdepth 6 -type f | rg "(SKILL.md|\\.claude|\\.agents|\\.codex|commands/|hooks/|plugin|script)" || true
rg -n "source-staging|KnowledgeBaseService|knowledge-base" desktop/electron/services/workflow desktop/electron/services/task-scheduler desktop/action-packages || true
rg -n "knowledge-base|KnowledgeBase|\\.raw|wiki/|manifest" desktop/electron/services/file-conversion || true
rg -n "fetch\\(|https?://|axios|got\\(|undici|WebFetch|vision|openai|anthropic" desktop/electron/services/file-conversion desktop/electron/services/knowledge-base/source-staging.ts || true
git diff --check
```

Expected:

- template scan empty;
- Workflow/Scheduler/action package scan has no KB session injection or staging matches;
- file-conversion production files have no KB imports or KB terms;
- no online parsing/OCR/vision API path.

- [ ] **Step 4: Request final review**

Dispatch a final code-review subagent with:

- base commit before Task 1;
- current HEAD;
- `docs/superpowers/specs/2026-05-24-knowledge-base-completion-master-check.md`;
- this plan path;
- final verification command outputs.

- [ ] **Step 5: Fix final review findings**

For each Critical or Important finding:

1. verify against code;
2. add a failing test when possible;
3. fix;
4. rerun focused tests;
5. commit with a focused message.

- [ ] **Step 6: Commit final check update if needed**

```bash
git add docs/superpowers/specs/2026-05-24-knowledge-base-completion-master-check.md
git commit -m "docs(kb): update completion verification exceptions"
```

Only run this commit if the check file changed.

---

## Self-Review

- Every remaining area from the user's seven-item list maps to at least one task:
  - Workflow node: Tasks 9-10.
  - OCR/image/scanned PDF: Tasks 6-7.
  - URL ingest: Tasks 5 and 7.
  - Cross-platform packaging: Task 11.
  - Manifest semantics: Tasks 1-3.
  - Real Agent E2E: Task 8.
  - Temporary context injection: Task 4.
- The plan keeps common file conversion independent from Knowledge Base.
- The plan keeps runnable Agent assets out of user vaults.
- The plan does not add Scheduler integration.
- The plan uses local-only conversion/OCR and URL source acquisition only for user-provided URLs.
- UI work is isolated to Workflow node configuration and references existing UI rules.
- Final verification includes tests, typecheck, hard constraints, build, packaging, and boundary scans.

## Execution Options

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

The recommended path is option 1 because the plan spans Agent Runtime, Knowledge Base, common conversion, Workflow, packaging, and boundary verification.
