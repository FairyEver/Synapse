# DragonScale Boundary Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-24-dragonscale-boundary-scoring-design.md`

**Goal:** Replace the production need for upstream `boundary-score.py` with a Synapse-owned, read-only TypeScript service that computes DragonScale frontier scores for knowledge-base projects.

**Architecture:** Add `DragonScaleBoundaryService` under `desktop/electron/services/knowledge-base/dragonscale/`. The service scans only the target vault's `wiki/`, builds an Obsidian-style filename-stem wikilink graph, computes `(out_degree - in_degree) * exp(-age_days / 30)`, and returns structured results. The vendored Python script remains only as a compatibility oracle.

**Tech Stack:** Electron main process, TypeScript, Node filesystem APIs, Vitest, existing knowledge-base service exports.

---

## File Map

- Create: `desktop/electron/services/knowledge-base/dragonscale/boundary-service.ts`
  - Production read-only boundary scoring implementation.
- Create: `desktop/electron/services/knowledge-base/dragonscale/boundary-types.ts`
  - Boundary-specific public types and constants.
- Modify: `desktop/electron/services/knowledge-base/dragonscale/types.ts`
  - Re-export boundary types only if local convention favors one type barrel.
- Modify: `desktop/electron/services/knowledge-base/index.ts`
  - Export `DragonScaleBoundaryService` and boundary result types.
- Create: `desktop/electron/services/knowledge-base/__tests__/dragonscale-boundary-service.test.ts`
  - Unit and fixture tests for service semantics.
- Create: `desktop/electron/services/knowledge-base/__tests__/dragonscale-boundary-compat.test.ts`
  - Compatibility test against the vendored upstream script where practical.

---

### Task 1: Add Boundary Types And Export Shape

**Files:**
- Create: `desktop/electron/services/knowledge-base/dragonscale/boundary-types.ts`
- Modify: `desktop/electron/services/knowledge-base/index.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/dragonscale-boundary-service.test.ts`

- [x] **Step 1: Write a failing export/type test**

Create `desktop/electron/services/knowledge-base/__tests__/dragonscale-boundary-service.test.ts` with:

```ts
import { describe, expect, it } from "vitest"

import {
  DragonScaleBoundaryService,
  type DragonScaleBoundaryScoreReport,
} from "../index"

describe("DragonScaleBoundaryService", () => {
  it("is exported from the knowledge-base barrel", () => {
    expect(DragonScaleBoundaryService).toBeDefined()
    const report: DragonScaleBoundaryScoreReport = {
      generated: "2026-05-24T00:00:00Z",
      halflifeDays: 30,
      pageCountScoreable: 0,
      results: [],
    }
    expect(report.results).toEqual([])
  })
})
```

- [x] **Step 2: Run the focused test and confirm it fails**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-boundary-service.test.ts
```

Expected: FAIL because the service/types do not exist.

- [x] **Step 3: Add boundary type definitions**

Create `desktop/electron/services/knowledge-base/dragonscale/boundary-types.ts`:

```ts
export const DRAGONSCALE_BOUNDARY_HALFLIFE_DAYS = 30 as const
export const DRAGONSCALE_BOUNDARY_DEFAULT_TOP = 10 as const
export const DRAGONSCALE_BOUNDARY_MAX_BODY_BYTES = 256 * 1024

export interface DragonScaleBoundaryScoreOptions {
  readonly top?: number
  readonly includeScoreZero?: boolean
  readonly page?: string
  readonly today?: string
}

export interface DragonScaleBoundaryScoreResult {
  readonly title: string
  readonly titleKey: string
  readonly path: string
  readonly outDegree: number
  readonly inDegree: number
  readonly ageDays: number
  readonly recencyWeight: number
  readonly score: number
}

export interface DragonScaleBoundaryScoreReport {
  readonly generated: string
  readonly halflifeDays: typeof DRAGONSCALE_BOUNDARY_HALFLIFE_DAYS
  readonly pageCountScoreable: number
  readonly results: readonly DragonScaleBoundaryScoreResult[]
}
```

- [x] **Step 4: Add a temporary service shell and exports**

Create `desktop/electron/services/knowledge-base/dragonscale/boundary-service.ts`:

```ts
import type {
  DragonScaleBoundaryScoreOptions,
  DragonScaleBoundaryScoreReport,
} from "./boundary-types"
import { DRAGONSCALE_BOUNDARY_HALFLIFE_DAYS } from "./boundary-types"

export class DragonScaleBoundaryService {
  async score(
    _projectPath: string,
    _options: DragonScaleBoundaryScoreOptions = {},
  ): Promise<DragonScaleBoundaryScoreReport> {
    return {
      generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      halflifeDays: DRAGONSCALE_BOUNDARY_HALFLIFE_DAYS,
      pageCountScoreable: 0,
      results: [],
    }
  }
}
```

Export from `desktop/electron/services/knowledge-base/index.ts`.

- [x] **Step 5: Run the focused test**

Expected: PASS for export shape only.

---

### Task 2: Implement Page Collection And Safety Filters

**Files:**
- Modify: `desktop/electron/services/knowledge-base/dragonscale/boundary-service.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/dragonscale-boundary-service.test.ts`

- [x] **Step 1: Add failing collection tests**

Cover:

- missing `wiki/` returns empty report;
- scoring a vault does not create `.vault-meta/`, `wiki/meta/`, reports, or any other file;
- `wiki/concepts/Alpha.md` is scoreable;
- `wiki/hot.md`, `wiki/index.md`, `wiki/meta/Report.md`, `wiki/folds/Fold.md`, and `type: meta` are excluded;
- symlinked pages are skipped before reading;
- files larger than `256 KiB` are skipped.

Use local `mkdtemp`, `mkdir`, `writeFile`, `symlink`, and cleanup helpers matching existing knowledge-base tests.

- [x] **Step 2: Implement page walking**

In `boundary-service.ts`:

- resolve `projectPath`;
- walk `wiki/` recursively with `readdir(..., { withFileTypes: true })`;
- skip missing `wiki/`;
- skip `Dirent.isSymbolicLink()`;
- call `lstat` before reading files;
- reject paths whose resolved location does not stay under the project root;
- read UTF-8 text and skip read/encoding failures;
- if exact invalid UTF-8 detection is needed, read bytes and decode through `TextDecoder("utf-8", { fatal: true })` rather than relying on replacement-character decoding;
- skip files above `DRAGONSCALE_BOUNDARY_MAX_BODY_BYTES`;
- parse first frontmatter block and body.

- [x] **Step 3: Implement inclusion filters**

Match upstream exclusions:

```ts
const EXCLUDE_TYPES = new Set(["meta", "fold"])
const EXCLUDE_FILENAMES = new Set([
  "_index.md",
  "index.md",
  "log.md",
  "hot.md",
  "overview.md",
  "dashboard.md",
  "Wiki Map.md",
  "getting-started.md",
])
const EXCLUDE_PATH_PREFIXES = ["wiki/folds/", "wiki/meta/"]
```

- [x] **Step 4: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-boundary-service.test.ts
```

Expected: collection tests PASS.

---

### Task 3: Implement Wikilink Graph Semantics

**Files:**
- Modify: `desktop/electron/services/knowledge-base/dragonscale/boundary-service.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/dragonscale-boundary-service.test.ts`

- [x] **Step 1: Add failing graph tests**

Cover:

- `[[Beta]]` creates an edge from Alpha to Beta;
- `[[Beta|alias]]`, `[[Beta#Heading]]`, and `[[folder/Beta]]` all resolve to `Beta`;
- duplicate links count once;
- self-links are ignored;
- links to missing pages are ignored;
- links inside fenced code blocks are ignored;
- tilde fences are ignored;
- indented wikilinks are counted.

- [x] **Step 2: Implement wikilink extraction**

Use an upstream-compatible regex:

```ts
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g
```

Normalize target by trimming and taking the last slash-delimited segment.

- [x] **Step 3: Implement fenced block filtering**

Track opening fence character and length for lines matching:

```ts
const FENCE_RE = /^(\s*)(`{3,}|~{3,})/
```

Skip all lines while inside a fence. Close only on the same character with same-or-longer run length.

- [x] **Step 4: Build in/out edge maps**

Use filename stem as `titleKey`, matching upstream Obsidian resolution. If duplicate stems exist, let the later sorted path overwrite the earlier entry and add a test documenting this compatibility behavior.

- [x] **Step 5: Run focused tests**

Expected: graph tests PASS.

---

### Task 4: Implement Scoring, Filtering, And Page Lookup

**Files:**
- Modify: `desktop/electron/services/knowledge-base/dragonscale/boundary-service.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/dragonscale-boundary-service.test.ts`

- [x] **Step 1: Add failing scoring tests**

Use `today: "2026-05-24"` in options for deterministic scores.

Cover:

- `updated` takes precedence over `created`;
- missing or invalid date uses `ageDays = 10000`;
- `recencyWeight = round4(exp(-ageDays / 30))`;
- `score = round4((outDegree - inDegree) * recencyWeight)`;
- default filters out `score <= 0`;
- `includeScoreZero: true` includes zero and negative scores;
- default `top` is 10;
- `top < 1` rejects;
- `page` can match by stem or relative path;
- unmatched `page` rejects.

- [x] **Step 2: Implement date and rounding helpers**

Use local dates only:

```ts
function daysSince(dateString: string | undefined, today: string): number
function round4(value: number): number
```

Production `today` should be derived from the local current date in `YYYY-MM-DD`.

- [x] **Step 3: Implement report shaping**

Return:

```ts
{
  generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  halflifeDays: 30,
  pageCountScoreable: pages.size,
  results,
}
```

Sort by score descending then `titleKey` ascending before applying `top`.

- [x] **Step 4: Run focused tests**

Expected: scoring tests PASS.

---

### Task 5: Add Upstream Compatibility Coverage

**Files:**
- Create: `desktop/electron/services/knowledge-base/__tests__/dragonscale-boundary-compat.test.ts`
- Modify if needed: `desktop/electron/services/knowledge-base/dragonscale/boundary-service.ts`

- [x] **Step 1: Decide compatibility harness**

Preferred low-risk harness:

- create a temp fixture vault;
- copy or symlink the vendored `boundary-score.py` into `temp/scripts/boundary-score.py`;
- create `temp/wiki/...` fixture pages;
- execute `python3 scripts/boundary-score.py --json --include-score-zero --top 20` with `cwd=temp`;
- compare normalized Python JSON against `DragonScaleBoundaryService.score(temp, { includeScoreZero: true, top: 20 })`.

Do not pass the service `today` override in this compatibility test. The Python oracle uses the current local date, so the service should do the same for this one comparison.

Normalize:

- ignore `generated`;
- map snake_case keys to camelCase;
- compare numeric fields with exact equality where deterministic, or `toBeCloseTo(..., 4)` for floating fields.

- [x] **Step 2: Add the compatibility test**

Fixture should include:

- a positive frontier page;
- a hub page with negative score;
- a zero score page;
- aliases/headings/folder-qualified wikilinks;
- a fenced code wikilink that must not count;
- a `wiki/meta/` page that must not count.

- [x] **Step 3: Run compatibility test**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-boundary-compat.test.ts
```

Expected: PASS when `python3` is available. If local test conventions require no optional runtime dependency, skip with a clear condition when `python3` is unavailable.

- [x] **Step 4: Run all DragonScale knowledge-base tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts electron/services/knowledge-base/__tests__/dragonscale-script-runner.test.ts electron/services/knowledge-base/__tests__/dragonscale-boundary-service.test.ts electron/services/knowledge-base/__tests__/dragonscale-boundary-compat.test.ts
```

Expected: PASS.

---

### Task 6: Final Validation And Documentation Check

**Files:**
- Modify only if a small doc correction is needed:
  - `docs/superpowers/specs/2026-05-23-dragonscale-script-internalization-design.md`
  - `docs/agent-guides/knowledge-base.md`

- [x] **Step 1: Verify no user-vault templates gained runnable files**

```bash
find desktop/resources/knowledge-base/templates -maxdepth 5 -type f | sort | rg "(boundary-score|tiling-check|allocate-address|scripts/|\\.claude|SKILL.md)" || true
```

Expected: no output.

- [x] **Step 2: Run the focused knowledge-base test set**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts electron/services/knowledge-base/__tests__/ingest-finalizer.test.ts electron/services/knowledge-base/__tests__/wiki-page-addresses.test.ts electron/services/knowledge-base/__tests__/manifest-writer.test.ts electron/services/knowledge-base/__tests__/dragonscale-boundary-service.test.ts electron/services/knowledge-base/__tests__/dragonscale-boundary-compat.test.ts
```

Expected: PASS.

- [x] **Step 3: Run hard constraints if implementation changed production code**

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [x] **Step 4: Inspect changed files**

```bash
git diff --stat
git diff -- docs/superpowers/specs/2026-05-24-dragonscale-boundary-scoring-design.md docs/superpowers/plans/2026-05-24-dragonscale-boundary-scoring.md desktop/electron/services/knowledge-base
```

Expected: changes are limited to boundary scoring implementation, tests, and explicitly relevant docs.

---

## Completion Criteria

- Boundary scoring is implemented in TypeScript and exported from knowledge-base internals.
- Production boundary scoring does not execute scripts and does not write to the vault.
- Tests prove algorithm parity for page filtering, wikilinks, scoring, sorting, and path safety.
- Compatibility coverage compares against the vendored upstream script where practical.
- No Agent-specific runtime files are added to user vault templates.
