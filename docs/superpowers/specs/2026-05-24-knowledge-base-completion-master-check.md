# Knowledge Base Completion Master Check

Date: 2026-05-24

## Purpose

This check file turns the seven remaining Knowledge Base work areas into one explicit acceptance contract.

Stage 2 file conversion is complete. The remaining work is not parser-core validation. The remaining work is to connect conversion, URL intake, OCR, manifest finalization, Agent session context, Workflow reuse, and release verification into a user-visible Knowledge Base experience that matches the important behavior of `AgriciDaniel/claude-obsidian` without writing runnable Agent assets into the user's vault.

This file is intentionally larger than a normal spec. It is the checklist future agents must use before claiming the Knowledge Base project is complete.

## Existing Baseline

Already completed or present in the codebase:

- `desktop/electron/services/file-conversion/` exists as a Knowledge Base-independent local conversion service.
- DOCX, XLSX, text PDF, PPTX, DOC/PPT helper boundary, parser warnings, parser error classification, and KB staging fixture tests exist.
- Knowledge Base upload staging archives convertible originals under `_attachments/originals/YYYY/MM/DD/` and writes converted Markdown under `.raw/<kind>/YYYY/MM/DD/`.
- Knowledge Base project contributions load Knowledge Base Agent behavior from Synapse-owned resources, not from the user vault.
- User vault templates do not need runnable `.claude`, `.agents`, `.codex`, skill, command, hook, plugin, or script files.
- `AGENTS.md` establishes the hard boundary that ordinary Agent, Scheduler, Workflow, and non-KB projects must not load KB-only behavior.

## Hard Rules

- The user Knowledge Base directory remains an Obsidian-compatible vault. It may contain Markdown, `.synapse-kb.json`, `.raw/.manifest.json`, `.raw/` source files, `wiki/`, `wiki/hot.md`, `wiki/index.md`, `wiki/log.md`, `wiki/meta/`, `_attachments/`, and `.vault-meta/` metadata.
- The user Knowledge Base directory must not receive runnable Agent skills, hooks, commands, plugins, agents, scripts, full prompts, `.claude`, `.agents`, `.codex`, or SDK settings.
- Knowledge Base Agent capabilities must be loaded only through Synapse internal resources and project contributions at Knowledge Base Agent session creation time.
- Ordinary Agent conversations, Scheduler runs, Workflow runs, and non-KB projects must not load Knowledge Base plugin, skill, hook, prompt, ingest preflight, or finalizer behavior.
- File conversion remains a common service. It must not import `knowledge-base`, `.raw`, `wiki/`, or manifest code in production files.
- URL fetching is allowed only as source acquisition for user-requested URLs. It must not use online document parsing, remote OCR, hosted readability services, or remote conversion APIs.
- OCR and scanned-PDF support must be local-only. If the local OCR engine is unavailable, the feature must return a structured unavailable result instead of falling back to an online API.
- Synapse may write `.raw/.manifest.json`; Synapse must not modify user source files under `.raw/` except `.raw/.manifest.json`.
- Manifest writes must fail closed. If Agent output cannot be validated, preserve the old manifest and record a warning.
- UI work must follow the repository shadcn/Radix/Tailwind token rules. No custom colors, no marketing text, no card nesting.

## Seven Remaining Work Areas

### 1. Workflow File Conversion Node

Goal: expose the common local conversion service as a Workflow node without adding Knowledge Base behavior to Workflow.

Acceptance checklist:

- [x] A Workflow node type exists for file conversion.
- [x] The node accepts local file input and returns structured conversion output: `format`, `kind`, `title`, `markdown`, `text`, `metadata`, and `warnings`.
- [x] The node can optionally write converted Markdown to a caller-provided output path when Workflow already supports file outputs.
- [x] The node does not know about `.raw`, `wiki/`, `KnowledgeBaseService`, or `.raw/.manifest.json`.
- [x] The node handles `unsupported_format`, `read_failed`, `size_limit_exceeded`, `parse_failed`, `encrypted`, `missing_local_helper`, and warnings.
- [x] Workflow validation rejects missing input file variables and invalid output path options.
- [x] Renderer UI uses existing Workflow node config patterns and shadcn/Radix components.
- [x] Workflow tests prove the node can run without loading Knowledge Base project contribution code.

Boundary checks:

```bash
rg -n "knowledge-base|KnowledgeBase|\\.raw|wiki/|manifest" desktop/electron/services/file-conversion desktop/electron/services/workflow || true
```

Expected: no production match tying common conversion or Workflow conversion node to Knowledge Base internals.

### 2. Local OCR, Image, And Scanned PDF Extraction

Goal: support image files and scanned PDFs through local OCR only.

Supported first targets:

- `.png`
- `.jpg`
- `.jpeg`
- `.webp`
- scanned `.pdf`

Acceptance checklist:

- [x] A local OCR abstraction exists outside Knowledge Base, under a common file-processing or file-conversion boundary.
- [x] OCR support is optional and capability-detected.
- [x] If OCR dependencies are not installed or not approved, conversion returns a structured `missing_local_helper` or `ocr_unavailable` style result, not a crash.
- [x] Text PDFs continue to use the existing PDF text path before OCR is considered.
- [x] Scanned PDFs that produce no embedded text can request OCR when OCR is enabled.
- [x] OCR results include page/image metadata, source file path, confidence when available, and warnings.
- [x] OCR never calls online APIs, browser vision APIs, or hosted OCR services.
- [x] Knowledge Base staging can accept image/PDF OCR outputs and write generated Markdown under `.raw/images/` or `.raw/pdfs/`.
- [x] Tests include an image fixture and a scanned-PDF-like fixture with deterministic or mocked OCR output.

Boundary checks:

```bash
rg -n "https?://|fetch\\(|axios|got\\(|undici|WebFetch|vision|openai|anthropic" desktop/electron/services/file-conversion desktop/electron/services/file-processing desktop/electron/services/knowledge-base/source-staging.ts || true
```

Expected: no online OCR, remote parser, or hosted vision path in conversion/staging production code.

### 3. URL Ingest Pipeline

Goal: let users add a URL as a Knowledge Base source by fetching, cleaning, and storing source Markdown before ingest.

Acceptance checklist:

- [x] A URL source acquisition service exists as Knowledge Base staging code or a common source-acquisition service with a KB adapter.
- [x] URL fetch requires an explicit user-provided URL.
- [x] URL allow/deny logic rejects unsupported protocols, local file URLs, dangerous redirects, and oversized responses.
- [x] HTML is cleaned locally into readable Markdown.
- [x] Non-HTML responses are handled conservatively: text accepted with content type checks; binary rejected or routed to local file conversion only when explicitly supported.
- [x] URL sources are stored under `.raw/web/YYYY/MM/DD/`.
- [x] Frontmatter records original URL, fetched timestamp, content type, final URL after redirects, and source hash.
- [x] `.raw/.manifest.json` receives deterministic source entries only through Synapse-owned finalization.
- [x] Tests cover valid HTML, redirect, non-HTML text, unsupported protocol, oversized response, and network failure.
- [x] No external readability, parser, or scraping API is used.

Suggested data shape:

```ts
interface KnowledgeBaseUrlSource {
  readonly originalUrl: string
  readonly finalUrl: string
  readonly contentType: string
  readonly fetchedAt: string
  readonly rawRelativePath: string
  readonly hash: string
}
```

Boundary checks:

```bash
rg -n "readability|defuddle|turndown|sanitize|url" desktop/electron/services/knowledge-base desktop/electron/services/source-acquisition || true
```

Expected: local cleanup implementation or approved local dependency only.

### 4. Cross-Platform Packaging Verification

Goal: prove the conversion and OCR dependencies do not break release lanes.

Acceptance checklist:

- [x] macOS arm64 directory package still passes.
- [x] Windows package or CI-equivalent packaging check passes or records a blocking release risk.
- [x] Linux package or CI-equivalent packaging check passes or records a blocking release risk.
- [x] `@napi-rs/canvas` native packages are present where required.
- [x] Any OCR dependency native files or worker assets are documented and packaged.
- [x] `asarUnpack` needs are explicit and tested.
- [x] `pnpm approve-builds` implications are documented for dependencies that request postinstall scripts.
- [x] The dependency report is updated after every dependency change.

Required commands:

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run build:electron
pnpm --filter @synapse/desktop run build:renderer
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop exec electron-builder --dir --mac --arm64 --publish never
```

Windows/Linux checks may be CI-only if local host limitations prevent native packaging. If skipped locally, the check file must say exactly why and where it is covered.

### 5. Deterministic Manifest Semantics

Goal: make Synapse the only final writer for `.raw/.manifest.json` source facts and address map.

Acceptance checklist:

- [x] `/wiki ingest` and natural-language ingest share the same source preflight.
- [x] Preflight computes source hashes, classifies new/changed/unchanged/skipped, records size, format, and source metadata.
- [x] Agent prompt tells the Agent not to edit `.raw/.manifest.json`.
- [x] Agent emits one structured `synapse_kb_ingest_report` JSON block.
- [x] Synapse validates the report against preflight source paths and post-turn wiki page state.
- [x] Synapse writes `manifest.sources` using trusted preflight hashes, not Agent-provided hashes.
- [x] Synapse writes `manifest.address_map` in the same normalized manifest write after address finalization.
- [x] Invalid reports leave existing `manifest.sources` unchanged and record warnings.
- [x] Upload/staging conversion metadata is either reflected in manifest source entries or explicitly kept in frontmatter with a documented reason.
- [x] Tests cover malformed manifest, invalid report JSON, path escape, unknown source, missing wiki page, partial valid report, and unchanged source behavior.

Allowed manifest-owned writes:

```text
.raw/.manifest.json
```

Forbidden writes:

```text
.raw/**/*.md
.raw/**/*.txt
.raw/**/*.json
```

Exception: staging may create new `.raw/` source files when the user uploads or fetches a source. Finalization may not rewrite them.

### 6. Real Agent Ingest End-To-End

Goal: prove a Knowledge Base Agent conversation can ingest sources through the real Agent routing and finalization path.

Acceptance checklist:

- [x] A test or harness creates a temp Knowledge Base vault with `.raw/` sources.
- [x] A Knowledge Base Agent session receives `/wiki ingest`.
- [x] A Knowledge Base Agent session receives a natural-language ingest request such as `汲取知识`.
- [x] Both paths receive the same source preflight facts.
- [x] The Agent-facing prompt includes the manifest ownership contract.
- [x] A deterministic fake Claude SDK session emits a valid ingest report and wiki writes.
- [x] Finalizer writes `.raw/.manifest.json` and address frontmatter.
- [x] The test proves `wiki/index.md`, `wiki/hot.md`, and `wiki/log.md` update when reported.
- [x] The test proves ordinary Agent sessions do not receive the Knowledge Base ingest plugin or finalizer.
- [x] The test proves Scheduler and Workflow Agent paths do not receive KB-only behavior unless they explicitly target a Knowledge Base project and the design allows it.

Minimum commands:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts
```

### 7. Knowledge Base Agent Temporary Context Injection

Goal: move all Knowledge Base Agent runtime context into Synapse-owned session contributions, so the user vault stays clean.

Acceptance checklist:

- [x] Knowledge Base Agent sessions are detected from project capability, not path heuristics alone.
- [x] Knowledge Base session creation injects only Synapse-owned plugin/prompt/skill resources.
- [x] Injected resources are session-scoped or project-contribution-scoped.
- [x] Ordinary projects use normal Agent settings and do not load KB resources.
- [x] Scheduler, Workflow, and non-chat Agent entrypoints cannot accidentally load KB resources.
- [x] `settingSources`, `skills`, plugin paths, and hook-disabling behavior are explicitly tested.
- [x] No `.claude`, `.agents`, `.codex`, skill, hook, command, or plugin file is written to a user vault.
- [x] A template scan runs in final verification.

Required scans:

```bash
find desktop/resources/knowledge-base/templates -maxdepth 6 -type f | rg "(SKILL.md|\\.claude|\\.agents|\\.codex|commands/|hooks/|plugin|script)" || true
rg -n "knowledge-base|KnowledgeBase" desktop/electron/services/task-scheduler desktop/electron/services/workflow desktop/action-packages || true
```

Expected: no ordinary Scheduler/Workflow/action package coupling to KB session injection.

## Completion Matrix

| Area | Must be true before complete | Blocking if false |
| --- | --- | --- |
| Workflow node | Common conversion node works without KB imports. | Yes |
| OCR/image | Local-only OCR path exists or is explicitly feature-gated unavailable. | Yes |
| URL ingest | URL sources can be fetched, cleaned, stored, scanned, and finalized. | Yes |
| Packaging | macOS verified; Windows/Linux either verified or marked blocking. | Yes |
| Manifest | Synapse owns final source and address-map writes. | Yes |
| Agent E2E | `/wiki ingest` and natural-language ingest both update manifest deterministically. | Yes |
| Temporary context | KB Agent runtime assets stay outside user vault and outside ordinary Agent paths. | Yes |

## Execution Status

Updated: 2026-05-24

This checklist has been executed in branch `codex/kb-completion-master` through commit `f5ad6d14`.

Verification evidence:

- Focused Vitest command passed: 28 test files, 203 tests.
- `pnpm --filter @synapse/desktop run typecheck` passed.
- `pnpm --filter @synapse/desktop run check:hard-constraints` passed.
- `pnpm --filter @synapse/desktop run build:electron` passed.
- `pnpm --filter @synapse/desktop run build:renderer` passed with the existing Vite chunk-size warning.
- Boundary scans for vault templates, Workflow/Scheduler/action package coupling, common file-conversion coupling, online OCR/fetch paths, and `git diff --check` passed with empty output.
- macOS arm64 directory packaging passed when run with `CSC_IDENTITY_AUTO_DISCOVERY=false`; the exact signed command stalled at local `codesign`.
- Packaging evidence and remaining release risks are recorded in `docs/superpowers/reports/2026-05-24-knowledge-base-completion-package-check.md`.
- Final code review Important findings were addressed in `f5ad6d14`: manifest finalization now rejects processed sources with no wiki-page evidence, URL intake is wired through source manager -> IPC -> Knowledge Base service, and the Workflow file conversion node supports variable bindings for path interpolation.

## Final Verification Command Set

Run these before claiming the full Knowledge Base completion is done:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__ electron/services/knowledge-base/__tests__ electron/services/agent-runtime/__tests__/knowledge-base-contribution.test.ts
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run build:electron
pnpm --filter @synapse/desktop run build:renderer
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @synapse/desktop exec electron-builder --dir --mac --arm64 --publish never
find desktop/resources/knowledge-base/templates -maxdepth 6 -type f | rg "(SKILL.md|\\.claude|\\.agents|\\.codex|commands/|hooks/|plugin|script)" || true
rg -n "source-staging|KnowledgeBaseService|knowledge-base" desktop/electron/services/workflow desktop/electron/services/task-scheduler desktop/action-packages || true
rg -n "knowledge-base|KnowledgeBase|\\.raw|wiki/|manifest" desktop/electron/services/file-conversion || true
rg -n "fetch\\(|https?://|axios|got\\(|undici|WebFetch|vision|openai|anthropic" desktop/electron/services/file-conversion desktop/electron/services/knowledge-base/source-staging.ts || true
git diff --check
```

Empty scan output is expected for all boundary scans unless a later spec explicitly adds an allowed match and documents why.

## Residual Risks To Track

- `officeparser` and `pdf-parse` pull `@napi-rs/canvas`; Windows/Linux package verification remains important.
- `officeparser` pulls `tesseract.js` transitively. Synapse's OCR abstraction is unavailable-by-default and does not call it directly today, but release packaging should keep watching worker/WASM/trained-data assets if a real OCR adapter is added.
- No `pnpm approve-builds` change was required during this completion pass. Future real OCR dependencies may introduce build-script approvals and must update the dependency report.
- URL fetching adds network risk, but only as source acquisition. It must be permissioned and bounded.
- Manifest finalization must be conservative; partial success is acceptable, silent corruption is not.
- Release signing/notarization, Windows packaging, and Linux packaging remain release-lane checks outside this macOS local verification.
