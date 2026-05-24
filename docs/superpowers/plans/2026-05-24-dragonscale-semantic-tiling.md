# DragonScale Semantic Tiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-24-dragonscale-semantic-tiling-design.md`

**Goal:** Replace the production need for upstream `tiling-check.py` with a Synapse-owned TypeScript service that computes semantic tiling duplicate candidates, maintains `.vault-meta/tiling-cache.json`, and can write `wiki/meta/tiling-report-YYYY-MM-DD.md` on request.

**Architecture:** Add `DragonScaleTilingService` under `desktop/electron/services/knowledge-base/dragonscale/`, with an injectable embedding provider and a production Ollama provider. The service scans only eligible wiki pages, embeds page bodies through local Ollama by default, caches embeddings by body hash and model, computes cosine similarities, and returns structured error/review pairs. The vendored Python script remains only as a compatibility oracle.

**Tech Stack:** Electron main process, TypeScript, Node filesystem APIs, Node/Electron HTTP or built-in fetch support, Vitest, existing knowledge-base service exports.

---

## File Map

- Create: `desktop/electron/services/knowledge-base/dragonscale/tiling-types.ts`
  - Public tiling statuses, options, cache, threshold, pair, peek, and check result types.
- Create: `desktop/electron/services/knowledge-base/dragonscale/ollama-embedding-provider.ts`
  - Production local-Ollama embedding provider with URL, timeout, and response-size guards.
- Create: `desktop/electron/services/knowledge-base/dragonscale/tiling-service.ts`
  - Production semantic tiling implementation.
- Modify: `desktop/electron/services/knowledge-base/index.ts`
  - Export service and public types.
- Create: `desktop/electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts`
  - Unit tests using a fake embedding provider.
- Create: `desktop/electron/services/knowledge-base/__tests__/dragonscale-tiling-provider.test.ts`
  - URL safety and Ollama provider tests with a local test server or injected HTTP client.
- Create: `desktop/electron/services/knowledge-base/__tests__/dragonscale-tiling-report.test.ts`
  - Report markdown and report-path confinement tests.
- Modify if needed: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`
  - Regression test that user templates still do not receive tiling scripts or skill files.

---

### Task 1: Add Tiling Types And Barrel Exports

**Files:**
- Create: `desktop/electron/services/knowledge-base/dragonscale/tiling-types.ts`
- Modify: `desktop/electron/services/knowledge-base/index.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts`

- [ ] **Step 1: Write a failing export/type test**

Create `desktop/electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts` with a minimal test:

```ts
import { describe, expect, it } from "vitest"

import {
  DragonScaleTilingService,
  type DragonScaleTilingCheckResult,
} from "../index"

describe("DragonScaleTilingService", () => {
  it("is exported from the knowledge-base barrel", () => {
    expect(DragonScaleTilingService).toBeDefined()
    const result: DragonScaleTilingCheckResult = {
      status: "ok",
      generated: "2026-05-24T00:00:00Z",
      model: "nomic-embed-text",
      ollamaUrl: "http://127.0.0.1:11434",
      thresholds: {
        version: 1,
        model: "nomic-embed-text",
        bands: { error: 0.9, review: 0.8 },
        calibrated: false,
        calibrationPairsLabeled: 0,
      },
      scanned: 0,
      embedded: 0,
      skipped: {},
      cacheHits: 0,
      recomputed: 0,
      orphansPruned: 0,
      errors: [],
      reviews: [],
      warnings: [],
    }
    expect(result.status).toBe("ok")
  })
})
```

- [ ] **Step 2: Run the focused test and confirm it fails**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts
```

Expected: FAIL because the service/types do not exist.

- [ ] **Step 3: Add tiling type definitions**

Add constants and interfaces from the spec. Use camelCase public fields, but preserve serialized cache field names exactly where they touch disk:

- `computed_at` in `.vault-meta/tiling-cache.json`;
- `calibration_pairs_labeled` in `.vault-meta/tiling-thresholds.json`.

- [ ] **Step 4: Add a temporary service shell and exports**

Create `DragonScaleTilingService` with `peek()` and `check()` returning safe empty results for a missing `wiki/`.

Export from `desktop/electron/services/knowledge-base/index.ts`.

- [ ] **Step 5: Run the focused test**

Expected: PASS for export shape only.

---

### Task 2: Implement Ollama Provider Safety

**Files:**
- Create: `desktop/electron/services/knowledge-base/dragonscale/ollama-embedding-provider.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/dragonscale-tiling-provider.test.ts`

- [ ] **Step 1: Add failing provider tests**

Cover:

- accepts `http://127.0.0.1:11434`, `http://localhost:11434`, and `http://[::1]:11434`;
- rejects remote hosts unless `allowRemoteOllama` is true;
- detects reachable Ollama via `/api/version`;
- detects model presence via `/api/tags`, including names like `nomic-embed-text:latest`;
- rejects oversized JSON responses;
- rejects empty or non-numeric embeddings.

Use a local Node HTTP server in tests, or inject a tiny HTTP client into the provider if that is simpler.

- [ ] **Step 2: Implement URL validation**

Add helpers:

```ts
function isLocalOllamaUrl(raw: string): boolean
function resolveOllamaUrl(options: { ollamaUrl?: string; allowRemoteOllama?: boolean }): string
```

If no explicit URL is provided, read `process.env.OLLAMA_URL` only through the same validation path. A non-local env URL without `allowRemoteOllama` must be rejected with `usage-error` at the service layer.

- [ ] **Step 3: Implement provider HTTP calls**

Use existing platform capabilities; do not add a dependency.

Provider behavior:

- `isReachable(url)` calls `/api/version` with a short timeout.
- `hasModel(url, model)` calls `/api/tags` with a short timeout.
- `embed({ url, model, text })` posts to `/api/embeddings` with a longer timeout.
- Cap response bodies to `4 MiB`.
- Return `false` for reachability/model detection failures, but throw for malformed embedding responses.

- [ ] **Step 4: Run provider tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-tiling-provider.test.ts
```

Expected: PASS.

---

### Task 3: Implement Page Scan And Threshold Loading

**Files:**
- Modify: `desktop/electron/services/knowledge-base/dragonscale/tiling-service.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts`

- [ ] **Step 1: Add failing scan tests**

Cover:

- missing `wiki/` returns `ok` and does not create `.vault-meta/`;
- scoreable pages include eligible Markdown under `wiki/`;
- excludes `wiki/hot.md`, `wiki/index.md`, `wiki/meta/*`, `wiki/folds/*`, and frontmatter `type: meta` / `type: fold`;
- skips symlinked pages before read/embed;
- skips files over `128 KiB`;
- skips invalid UTF-8;
- counts skipped reasons.

- [ ] **Step 2: Implement page walking**

Follow the boundary service's path-safety posture, but keep tiling-specific limits:

- `MAX_BODY_BYTES = 128 * 1024`;
- candidates are `wiki/**/*.md`;
- use `lstat` and resolved path checks before reading;
- decode UTF-8 with fatal decoding so invalid files are skipped.

- [ ] **Step 3: Parse frontmatter and body**

Use only the first frontmatter block.

Return the body after frontmatter removal for both hashing and embedding.

- [ ] **Step 4: Add threshold tests**

Cover:

- missing `.vault-meta/tiling-thresholds.json` uses defaults;
- valid thresholds are read;
- invalid JSON or invalid bands return `usage-error`;
- `bands.review` must be less than or equal to `bands.error`;
- both bands must be finite numbers between `0` and `1`.

- [ ] **Step 5: Implement threshold loading**

Do not create `.vault-meta/tiling-thresholds.json` when missing.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts
```

Expected: scan and threshold tests PASS.

---

### Task 4: Implement Cache Semantics

**Files:**
- Modify: `desktop/electron/services/knowledge-base/dragonscale/tiling-service.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts`

- [ ] **Step 1: Add failing cache tests**

Use a fake embedding provider that returns deterministic small vectors.

Cover:

- first successful check creates `.vault-meta/tiling-cache.json`;
- cache file uses upstream-compatible `version`, `model`, `embeddings`, `hash`, `embedding`, and `computed_at`;
- unchanged bodies hit cache and do not call `embed` again;
- frontmatter-only changes do not recompute;
- body changes recompute;
- `rebuildCache` recomputes every live page;
- model mismatch invalidates prior embeddings;
- deleted pages are pruned;
- corrupt cache returns `cache-corrupt` and does not overwrite the file.

- [ ] **Step 2: Implement body hash**

Match upstream:

```text
model=<model>
<body>
```

Use SHA-256 hex.

- [ ] **Step 3: Implement process-wide per-vault lock**

Mirror the address service's process-wide lock map. This protects Synapse-internal concurrent tiling runs.

- [ ] **Step 4: Implement atomic cache writes**

Write to `.vault-meta/tiling-cache.<pid-or-unique>.tmp`, then rename to `tiling-cache.json`.

Use pretty JSON plus trailing newline.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts --testNamePattern "cache|recompute|corrupt|model"
```

Expected: cache tests PASS.

---

### Task 5: Implement Similarity Bands And Check Result

**Files:**
- Modify: `desktop/electron/services/knowledge-base/dragonscale/tiling-service.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts`

- [ ] **Step 1: Add failing similarity tests**

Cover:

- cosine similarity is computed for each pair;
- pairs below review threshold are omitted;
- `similarity >= error` goes to `errors`;
- `review <= similarity < error` goes to `reviews`;
- pairs sort by similarity descending;
- dimension mismatches skip the pair and add a warning;
- individual embed failures skip that page and increment `embed_error`;
- candidate page count above `5000` returns `scale-exceeded`;
- candidate page count above `500` adds a warning.

- [ ] **Step 2: Implement cosine and pair generation**

Keep this pure and unit-testable.

Round or display similarities only at report formatting time unless result tests require stable numeric precision.

- [ ] **Step 3: Implement readiness status flow**

Order:

1. Resolve and validate Ollama URL.
2. If `wiki/` is missing, return `ok` empty without creating `.vault-meta/`.
3. Check Ollama reachability.
4. Check model presence.
5. Load thresholds.
6. Load or initialize cache.
7. Scan, embed, cache, score pairs.

- [ ] **Step 4: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts
```

Expected: service tests PASS.

---

### Task 6: Implement Peek Diagnostics

**Files:**
- Modify: `desktop/electron/services/knowledge-base/dragonscale/tiling-service.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts`

- [ ] **Step 1: Add failing peek tests**

Cover:

- reports vault path;
- reports Ollama URL, reachability, requested model, and model presence;
- reports cache present/readable, cache entries, cache model, and cache error;
- reports thresholds present/readable, calibrated, and bands;
- maps unavailable Ollama/model/corrupt cache to the same statuses as `check`.

- [ ] **Step 2: Implement `peek()`**

`peek()` must not compute embeddings, write cache, or write reports.

- [ ] **Step 3: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts --testNamePattern "peek"
```

Expected: PASS.

---

### Task 7: Implement Report Markdown And Safe Report Writes

**Files:**
- Create: `desktop/electron/services/knowledge-base/__tests__/dragonscale-tiling-report.test.ts`
- Modify: `desktop/electron/services/knowledge-base/dragonscale/tiling-service.ts`

- [ ] **Step 1: Add failing report tests**

Cover:

- `reportMarkdown` contains upstream-compatible headings and summary lines;
- empty errors/reviews render `- none`;
- similarities display with four decimals;
- default caller-provided path `wiki/meta/tiling-report-YYYY-MM-DD.md` is allowed;
- absolute or relative report paths escaping the vault are rejected with `usage-error`;
- report parent directory is created only when a report path is requested;
- report writes do not modify wiki pages.

- [ ] **Step 2: Implement markdown formatter**

Preserve section names:

- `# Semantic Tiling Report`
- `## Errors (similarity >= X)`
- `## Review (Y <= similarity < X)`

- [ ] **Step 3: Implement confined report writer**

Resolve report path against the project path and reject paths outside the vault.

Write UTF-8 with trailing newline.

- [ ] **Step 4: Run report tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-tiling-report.test.ts
```

Expected: PASS.

---

### Task 8: Add Compatibility And Template Cleanliness Checks

**Files:**
- Modify: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`
- Create or extend: `desktop/electron/services/knowledge-base/__tests__/dragonscale-tiling-compat.test.ts` if useful.

- [ ] **Step 1: Add or extend vault cleanliness regression tests**

Assert a created knowledge-base vault does not contain:

- `scripts/tiling-check.py`;
- `scripts/boundary-score.py`;
- `scripts/allocate-address.sh`;
- `.claude/`;
- `.agents/`;
- `.codex/`;
- `SKILL.md` files.

- [ ] **Step 2: Add low-risk compatibility tests**

Do not require live Ollama.

Compare static pieces with the vendored upstream script behavior where practical:

- default threshold shape;
- hash computation;
- report headings and summary field names.

If invoking the Python oracle becomes brittle, prefer fixture assertions against the vendored script text plus TypeScript unit coverage.

- [ ] **Step 3: Run focused knowledge-base tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts electron/services/knowledge-base/__tests__/dragonscale-tiling-provider.test.ts electron/services/knowledge-base/__tests__/dragonscale-tiling-report.test.ts
```

Expected: PASS.

---

### Task 9: Final Validation

**Files:**
- Modify only if a small doc correction is needed:
  - `docs/superpowers/specs/2026-05-23-dragonscale-script-internalization-design.md`
  - `docs/agent-guides/knowledge-base.md`

- [ ] **Step 1: Verify no user-vault templates gained runnable files**

```bash
find desktop/resources/knowledge-base/templates -maxdepth 6 -type f | sort | rg "(tiling-check|boundary-score|allocate-address|scripts/|\\.claude|\\.agents|\\.codex|SKILL.md)" || true
```

Expected: no output.

- [ ] **Step 2: Run the DragonScale-focused test set**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts electron/services/knowledge-base/__tests__/dragonscale-script-runner.test.ts electron/services/knowledge-base/__tests__/dragonscale-boundary-service.test.ts electron/services/knowledge-base/__tests__/dragonscale-boundary-compat.test.ts electron/services/knowledge-base/__tests__/dragonscale-tiling-service.test.ts electron/services/knowledge-base/__tests__/dragonscale-tiling-provider.test.ts electron/services/knowledge-base/__tests__/dragonscale-tiling-report.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Inspect changed files**

```bash
git diff --stat
git diff -- docs/superpowers/specs/2026-05-24-dragonscale-semantic-tiling-design.md docs/superpowers/plans/2026-05-24-dragonscale-semantic-tiling.md desktop/electron/services/knowledge-base desktop/resources/knowledge-base/templates
```

Expected: changes are limited to semantic tiling implementation, tests, exports, and explicitly relevant docs.

---

## Completion Criteria

- `DragonScaleTilingService` is implemented in TypeScript and exported from knowledge-base internals.
- Production semantic tiling does not execute scripts and does not copy runnable files into user vaults.
- Page bodies are sent only to local Ollama by default.
- `.vault-meta/tiling-cache.json` is maintained with upstream-compatible semantics.
- Optional report writing is confined to the vault and uses upstream-compatible markdown sections.
- Tests cover URL safety, page filtering, cache behavior, thresholds, pair scoring, report writing, and template cleanliness.
- No ordinary Agent, Scheduler, Workflow, or non-knowledge-base project loads semantic tiling behavior.
