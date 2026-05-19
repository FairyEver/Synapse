# Usage Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new CC/Codex usage analysis feature with independent top-level tabs, a new `usage.db`, tool-specific parsers, and token/cost-first reports while leaving the old `用量` feature untouched.

**Architecture:** Add a new `usage-analysis` renderer module and a new Electron service namespace. Store all new data in `usage.db` with `cc_*` and `cx_*` tables. Each tool has independent refresh, parser, reports, hooks, and pages, while sharing small renderer components for range picking, metric display, breakdown tables, and report loading states.

**Tech Stack:** Electron, React, TypeScript, SQLite via `node:sqlite`, shadcn/ui, Tailwind token utilities, Vitest-style repository tests.

---

## File Structure

Create these Electron files:

- `desktop/electron/usage-analysis/channels.ts` — usage-analysis IPC channel constants.
- `desktop/electron/usage-analysis/ipc-handlers.ts` — validated IPC handler registration.
- `desktop/electron/services/usage-analysis/types.ts` — main-process report, parser, and DB row types.
- `desktop/electron/services/usage-analysis/range.ts` — range filtering and local date/hour helpers.
- `desktop/electron/services/usage-analysis/pricing.ts` — estimated cost calculation by token type.
- `desktop/electron/services/usage-analysis/db.ts` — `usage.db` connection and schema migration.
- `desktop/electron/services/usage-analysis/scan.ts` — shared file walking and fingerprint utilities.
- `desktop/electron/services/usage-analysis/cc-parser.ts` — Claude Code parser.
- `desktop/electron/services/usage-analysis/cc-service.ts` — CC scan/refresh/report service.
- `desktop/electron/services/usage-analysis/codex-parser.ts` — Codex parser.
- `desktop/electron/services/usage-analysis/codex-service.ts` — Codex scan/refresh/report service.
- `desktop/electron/services/usage-analysis/index.ts` — service exports.
- `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`
- `desktop/electron/services/usage-analysis/__tests__/cc-parser.test.ts`
- `desktop/electron/services/usage-analysis/__tests__/codex-parser.test.ts`
- `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`

Modify these Electron integration files:

- `desktop/electron/preload.ts` — add `IPC_CHANNELS["usage-analysis"]` and `synapseBridge.usageAnalysis`.
- `desktop/src/types/bridge.ts` — add renderer bridge types.
- `desktop/electron/bootstrap/descriptors.ts` — add `core.usage-analysis` descriptor that registers IPC handlers.
- `desktop/electron/bootstrap/registry.ts` — register the new descriptor.

Create these renderer files:

- `desktop/src/modules/usage-analysis/index.tsx` — exports `CcUsageAnalysisModule` and `CodexUsageAnalysisModule`.
- `desktop/src/modules/usage-analysis/shared/types.ts` — renderer report types derived from bridge return values.
- `desktop/src/modules/usage-analysis/shared/range.ts` — range preset to query options.
- `desktop/src/modules/usage-analysis/shared/use-report-loader.ts` — common async loader helper.
- `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`
- `desktop/src/modules/usage-analysis/shared/components/range-picker.tsx`
- `desktop/src/modules/usage-analysis/shared/components/metric-grid.tsx`
- `desktop/src/modules/usage-analysis/shared/components/breakdown-table.tsx`
- `desktop/src/modules/usage-analysis/shared/components/report-state.tsx`
- `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`
- `desktop/src/modules/usage-analysis/cc/hooks.ts`
- `desktop/src/modules/usage-analysis/cc/pages/overview.tsx`
- `desktop/src/modules/usage-analysis/cc/pages/time.tsx`
- `desktop/src/modules/usage-analysis/cc/pages/models.tsx`
- `desktop/src/modules/usage-analysis/cc/pages/projects.tsx`
- `desktop/src/modules/usage-analysis/cc/pages/tools.tsx`
- `desktop/src/modules/usage-analysis/cc/pages/details.tsx`
- `desktop/src/modules/usage-analysis/codex/codex-usage-page.tsx`
- `desktop/src/modules/usage-analysis/codex/hooks.ts`
- `desktop/src/modules/usage-analysis/codex/pages/overview.tsx`
- `desktop/src/modules/usage-analysis/codex/pages/time.tsx`
- `desktop/src/modules/usage-analysis/codex/pages/models.tsx`
- `desktop/src/modules/usage-analysis/codex/pages/projects.tsx`
- `desktop/src/modules/usage-analysis/codex/pages/tools.tsx`
- `desktop/src/modules/usage-analysis/codex/pages/details.tsx`
- `desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx`
- `desktop/src/modules/usage-analysis/__tests__/range-picker.test.tsx`
- `desktop/src/modules/usage-analysis/__tests__/cc-page.test.tsx`
- `desktop/src/modules/usage-analysis/__tests__/codex-page.test.tsx`

Modify renderer integration:

- `desktop/src/App.tsx` — import new modules, extend `AppTabId`, add top-level `CC` and `Codex` tabs, render the new modules.

---

### Task 1: Add Shared Usage Analysis Types and Range Helpers

**Files:**
- Create: `desktop/electron/services/usage-analysis/types.ts`
- Create: `desktop/electron/services/usage-analysis/range.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/range.test.ts`

- [x] **Step 1: Write the range helper test**

Create `desktop/electron/services/usage-analysis/__tests__/range.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createUsageRangeFilter, localDateKey, localHourKey } from "../range"

describe("usage analysis range helpers", () => {
  it("creates no bounds for all time", () => {
    expect(createUsageRangeFilter({ preset: "all" }, new Date("2026-05-19T12:00:00+08:00"))).toEqual({})
  })

  it("creates an inclusive date window for 7 days", () => {
    expect(createUsageRangeFilter({ preset: "7d" }, new Date("2026-05-19T12:00:00+08:00"))).toEqual({
      sinceDate: "2026-05-13",
      untilDate: "2026-05-19",
    })
  })

  it("formats local date and hour keys", () => {
    const ts = new Date("2026-05-19T09:08:07+08:00").getTime()
    expect(localDateKey(ts)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(localHourKey(ts)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}$/)
  })
})
```

- [x] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/range.test.ts
```

Expected: fail because `../range` does not exist.

- [x] **Step 3: Create shared main-process types**

Create `desktop/electron/services/usage-analysis/types.ts`:

```ts
export type UsageTool = "cc" | "codex"
export type UsageRangePreset = "7d" | "30d" | "90d" | "all"

export interface UsageRangeInput {
  readonly preset: UsageRangePreset
}

export interface UsageRangeFilter {
  readonly sinceDate?: string
  readonly untilDate?: string
}

export interface UsageTokenBreakdown {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export interface UsageCostBreakdown {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export interface UsageRefreshResult {
  readonly scannedFiles: number
  readonly parsedFiles: number
  readonly skippedFiles: number
  readonly failedFiles: number
  readonly usageEvents: number
  readonly toolEvents: number
  readonly elapsedMs: number
}

export interface UsageMetric {
  readonly label: string
  readonly value: string
  readonly subValue?: string
}

export interface UsageOverviewReport {
  readonly generatedAt: string
  readonly totals: {
    readonly tokens: number
    readonly estimatedCost: number
    readonly requests: number
    readonly conversations: number
    readonly toolCalls: number
    readonly activeDays: number
  }
  readonly tokenBreakdown: UsageTokenBreakdown
  readonly costBreakdown: UsageCostBreakdown
  readonly topModels: UsageModelRow[]
  readonly topProjects: UsageProjectRow[]
  readonly topTools: UsageToolRow[]
  readonly trend: UsageTimeBucket[]
}

export interface UsageTimeBucket {
  readonly bucket: string
  readonly tokens: number
  readonly estimatedCost: number
  readonly requests: number
  readonly conversations: number
  readonly toolCalls: number
  readonly dominantModel: string
}

export interface UsageModelRow {
  readonly model: string
  readonly provider?: string
  readonly tokens: number
  readonly estimatedCost: number
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly requests: number
  readonly averageTokensPerRequest: number
}

export interface UsageProjectRow {
  readonly workspaceKey: string
  readonly workspaceLabel: string
  readonly sessions: number
  readonly requests: number
  readonly tokens: number
  readonly estimatedCost: number
  readonly toolCalls: number
  readonly lastUsedAt: string
}

export interface UsageToolRow {
  readonly toolName: string
  readonly category: string
  readonly calls: number
  readonly failures: number
  readonly failureRate: number
  readonly averageDurationMs: number
}

export interface UsageDetailRow {
  readonly id: string
  readonly timestamp: string
  readonly sessionId: string
  readonly workspaceLabel: string
  readonly model: string
  readonly tokens: number
  readonly estimatedCost: number
  readonly tokenBreakdown: UsageTokenBreakdown
  readonly toolCalls: number
  readonly durationMs?: number
}
```

- [x] **Step 4: Implement range helpers**

Create `desktop/electron/services/usage-analysis/range.ts`:

```ts
import type { UsageRangeFilter, UsageRangeInput } from "./types"

const DAY_MS = 24 * 60 * 60 * 1000

const RANGE_DAYS: Record<Exclude<UsageRangeInput["preset"], "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

export function localDateKey(timestampMs: number): string {
  const date = new Date(timestampMs)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function localHourKey(timestampMs: number): string {
  const date = new Date(timestampMs)
  return `${localDateKey(timestampMs)} ${pad2(date.getHours())}`
}

export function createUsageRangeFilter(input: UsageRangeInput, now = new Date()): UsageRangeFilter {
  if (input.preset === "all") return {}
  const days = RANGE_DAYS[input.preset]
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end.getTime() - (days - 1) * DAY_MS)
  return {
    sinceDate: localDateKey(start.getTime()),
    untilDate: localDateKey(end.getTime()),
  }
}
```

- [x] **Step 5: Run the test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/range.test.ts
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add desktop/electron/services/usage-analysis/types.ts desktop/electron/services/usage-analysis/range.ts desktop/electron/services/usage-analysis/__tests__/range.test.ts
git commit -m "feat: add usage analysis range types"
```

---

### Task 2: Add Estimated Pricing Logic

**Files:**
- Create: `desktop/electron/services/usage-analysis/pricing.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`

- [x] **Step 1: Write pricing tests**

Create `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { estimateUsageCost } from "../pricing"

describe("usage analysis pricing", () => {
  it("estimates OpenAI-style cached input and reasoning costs", () => {
    const cost = estimateUsageCost("codex", "gpt-5.5", {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 0,
      reasoning: 500_000,
    })

    expect(cost.input).toBeGreaterThan(0)
    expect(cost.cacheRead).toBeGreaterThan(0)
    expect(cost.cacheWrite).toBe(0)
    expect(cost.reasoning).toBeGreaterThan(0)
    expect(cost.total).toBeCloseTo(cost.input + cost.output + cost.cacheRead + cost.reasoning, 6)
  })

  it("estimates Anthropic-style cache creation costs", () => {
    const cost = estimateUsageCost("cc", "claude-opus-4.6", {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
      reasoning: 0,
    })

    expect(cost.input).toBeGreaterThan(0)
    expect(cost.output).toBeGreaterThan(cost.input)
    expect(cost.cacheRead).toBeGreaterThan(0)
    expect(cost.cacheWrite).toBeGreaterThan(cost.input)
    expect(cost.total).toBeCloseTo(cost.input + cost.output + cost.cacheRead + cost.cacheWrite, 6)
  })

  it("returns zero cost for unknown models", () => {
    expect(estimateUsageCost("cc", "unknown-model", {
      input: 1,
      output: 1,
      cacheRead: 1,
      cacheWrite: 1,
      reasoning: 1,
    })).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
    })
  })
})
```

- [x] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/pricing.test.ts
```

Expected: fail because `../pricing` does not exist.

- [x] **Step 3: Implement pricing**

Create `desktop/electron/services/usage-analysis/pricing.ts`:

```ts
import type { UsageTokenBreakdown, UsageTool } from "./types"

interface PriceRule {
  readonly pattern: RegExp
  readonly inputPer1M: number
  readonly outputPer1M: number
  readonly cacheReadPer1M?: number
  readonly cacheWritePer1M?: number
}

export interface EstimatedUsageCost {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly total: number
}

const OPENAI_RULES: PriceRule[] = [
  { pattern: /gpt-5\.5/i, inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.125 },
  { pattern: /gpt-5\.4/i, inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.125 },
  { pattern: /gpt-5\.3-codex|gpt-5-codex/i, inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.125 },
]

const ANTHROPIC_RULES: PriceRule[] = [
  { pattern: /claude-opus-4[\.-]6|claude-opus-4/i, inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  { pattern: /claude-sonnet-4/i, inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  { pattern: /claude-haiku-4/i, inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.1, cacheWritePer1M: 1.25 },
]

function findRule(tool: UsageTool, model: string): PriceRule | null {
  const rules = tool === "codex" ? OPENAI_RULES : ANTHROPIC_RULES
  return rules.find((rule) => rule.pattern.test(model)) ?? null
}

function cost(tokens: number, per1M: number | undefined): number {
  if (!per1M || tokens <= 0) return 0
  return tokens / 1_000_000 * per1M
}

export function estimateUsageCost(tool: UsageTool, model: string, tokens: UsageTokenBreakdown): EstimatedUsageCost {
  const rule = findRule(tool, model)
  if (!rule) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }
  }

  const input = cost(tokens.input, rule.inputPer1M)
  const output = cost(tokens.output, rule.outputPer1M)
  const cacheRead = cost(tokens.cacheRead, rule.cacheReadPer1M)
  const cacheWrite = cost(tokens.cacheWrite, rule.cacheWritePer1M)
  const reasoning = cost(tokens.reasoning, rule.outputPer1M)

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total: input + output + cacheRead + cacheWrite + reasoning,
  }
}
```

- [x] **Step 4: Run pricing tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/pricing.test.ts
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add desktop/electron/services/usage-analysis/pricing.ts desktop/electron/services/usage-analysis/__tests__/pricing.test.ts
git commit -m "feat: add usage analysis pricing"
```

---

### Task 3: Create `usage.db` Schema

**Files:**
- Create: `desktop/electron/services/usage-analysis/db.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/db.test.ts`

- [x] **Step 1: Write schema test**

Create `desktop/electron/services/usage-analysis/__tests__/db.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { closeUsageAnalysisDbForTests, getUsageAnalysisDb } from "../db"

const tempDirs: string[] = []

afterEach(() => {
  closeUsageAnalysisDbForTests()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe("usage analysis db", () => {
  it("creates cc and cx table namespaces", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-db-"))
    tempDirs.push(dir)
    const db = getUsageAnalysisDb(dir)
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
    const names = rows.map((row) => row.name)

    expect(names).toContain("cc_scan_files")
    expect(names).toContain("cc_usage_events")
    expect(names).toContain("cc_tool_events")
    expect(names).toContain("cc_daily_usage")
    expect(names).toContain("cc_hourly_usage")
    expect(names).toContain("cx_scan_files")
    expect(names).toContain("cx_usage_events")
    expect(names).toContain("cx_tool_events")
    expect(names).toContain("cx_task_events")
    expect(names).toContain("cx_daily_usage")
    expect(names).toContain("cx_hourly_usage")
  })
})
```

- [x] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/db.test.ts
```

Expected: fail because `../db` does not exist.

- [x] **Step 3: Implement DB schema**

Create `desktop/electron/services/usage-analysis/db.ts` with:

```ts
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { app } from "electron"

let db: DatabaseSync | null = null

export function getUsageAnalysisDb(baseDir = app.getPath("userData")): DatabaseSync {
  if (db) return db
  db = new DatabaseSync(path.join(baseDir, "usage.db"))
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  initUsageAnalysisSchema(db)
  return db
}

export function closeUsageAnalysisDbForTests(): void {
  db?.close()
  db = null
}

function initUsageAnalysisSchema(database: DatabaseSync): void {
  for (const prefix of ["cc", "cx"] as const) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_scan_files (
        file_path TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        parse_status TEXT NOT NULL,
        error_kind TEXT,
        last_scanned_at TEXT NOT NULL
      )
    `)
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_sessions (
        session_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        workspace_key TEXT NOT NULL DEFAULT '',
        workspace_label TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        cli_version TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL DEFAULT '',
        ended_at TEXT NOT NULL DEFAULT '',
        model_summary TEXT NOT NULL DEFAULT '',
        request_count INTEGER NOT NULL DEFAULT 0,
        conversation_count INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0
      )
    `)
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_usage_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        date TEXT NOT NULL,
        hour TEXT NOT NULL,
        workspace_key TEXT NOT NULL DEFAULT '',
        workspace_label TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT 'unknown',
        provider TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cost_input REAL NOT NULL DEFAULT 0,
        cost_output REAL NOT NULL DEFAULT 0,
        cost_cache_read REAL NOT NULL DEFAULT 0,
        cost_cache_write REAL NOT NULL DEFAULT 0,
        cost_reasoning REAL NOT NULL DEFAULT 0,
        total_cost REAL NOT NULL DEFAULT 0
      )
    `)
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_tool_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        date TEXT NOT NULL,
        workspace_key TEXT NOT NULL DEFAULT '',
        tool_name TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '',
        exit_code INTEGER,
        duration_ms INTEGER
      )
    `)
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_daily_usage (
        date TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        workspace_key TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost REAL NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        conversations INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, model, provider, workspace_key)
      )
    `)
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}_hourly_usage (
        hour TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        workspace_key TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost REAL NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        conversations INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (hour, model, provider, workspace_key)
      )
    `)
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS cx_task_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER,
      time_to_first_token_ms INTEGER
    )
  `)
}
```

- [x] **Step 4: Run DB test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/db.test.ts
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add desktop/electron/services/usage-analysis/db.ts desktop/electron/services/usage-analysis/__tests__/db.test.ts
git commit -m "feat: add usage analysis database"
```

---

### Task 4: Add Shared Scan Utilities

**Files:**
- Create: `desktop/electron/services/usage-analysis/scan.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/scan.test.ts`

- [x] **Step 1: Write scan utility tests**

Create `desktop/electron/services/usage-analysis/__tests__/scan.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { collectJsonlFiles, fingerprintFile } from "../scan"

describe("usage analysis scan utilities", () => {
  it("collects jsonl files recursively", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-scan-"))
    try {
      fs.mkdirSync(path.join(dir, "nested"))
      fs.writeFileSync(path.join(dir, "a.jsonl"), "{}\n")
      fs.writeFileSync(path.join(dir, "nested", "b.jsonl"), "{}\n")
      fs.writeFileSync(path.join(dir, "skip.txt"), "")

      expect(collectJsonlFiles([dir]).map((file) => path.basename(file)).sort()).toEqual(["a.jsonl", "b.jsonl"])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("creates file fingerprints", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-fp-"))
    try {
      const file = path.join(dir, "a.jsonl")
      fs.writeFileSync(file, "{}\n")
      const fp = fingerprintFile(file)
      expect(fp.filePath).toBe(file)
      expect(fp.size).toBeGreaterThan(0)
      expect(fp.mtimeMs).toBeGreaterThan(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [x] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/scan.test.ts
```

Expected: fail because `../scan` does not exist.

- [x] **Step 3: Implement scan utilities**

Create `desktop/electron/services/usage-analysis/scan.ts`:

```ts
import fs from "node:fs"
import path from "node:path"

export interface UsageFileFingerprint {
  readonly filePath: string
  readonly size: number
  readonly mtimeMs: number
}

function collectJsonlFilesFromDir(dir: string, out: string[], maxDepth: number): void {
  if (maxDepth <= 0) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectJsonlFilesFromDir(fullPath, out, maxDepth - 1)
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(fullPath)
    }
  }
}

export function collectJsonlFiles(roots: string[], maxDepth = 8): string[] {
  const files: string[] = []
  for (const root of roots) {
    collectJsonlFilesFromDir(root, files, maxDepth)
  }
  return [...new Set(files)].sort()
}

export function fingerprintFile(filePath: string): UsageFileFingerprint {
  const stat = fs.statSync(filePath)
  return {
    filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  }
}
```

- [x] **Step 4: Run scan tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/scan.test.ts
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add desktop/electron/services/usage-analysis/scan.ts desktop/electron/services/usage-analysis/__tests__/scan.test.ts
git commit -m "feat: add usage analysis scan utilities"
```

---

### Task 5: Implement Claude Code Parser

**Files:**
- Create: `desktop/electron/services/usage-analysis/cc-parser.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/cc-parser.test.ts`

- [x] **Step 1: Write CC parser tests**

Create `desktop/electron/services/usage-analysis/__tests__/cc-parser.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseClaudeUsageFile } from "../cc-parser"

describe("Claude Code usage parser", () => {
  it("extracts assistant usage and tool calls without content text", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-parser-"))
    try {
      const file = path.join(dir, "session.jsonl")
      fs.writeFileSync(file, [
        JSON.stringify({ type: "user", timestamp: "2026-05-19T01:00:00.000Z", message: { role: "user", content: "secret prompt" } }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-05-19T01:00:01.000Z",
          message: {
            role: "assistant",
            model: "claude-opus-4.6",
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 30,
              cache_creation_input_tokens: 40,
              cache_creation: {
                ephemeral_5m_input_tokens: 40,
                ephemeral_1h_input_tokens: 0,
              },
            },
            content: [
              { type: "tool_use", name: "Bash", id: "tool-1", input: { command: "echo hidden" } },
              { type: "tool_result", tool_use_id: "tool-1", content: "hidden output" },
              { type: "thinking", thinking: "hidden thinking" },
            ],
          },
        }),
      ].join("\n"))

      const parsed = await parseClaudeUsageFile(file)
      expect(parsed.sessions[0]).toMatchObject({
        sessionId: "session",
        requestCount: 1,
        conversationCount: 1,
        toolCallCount: 1,
      })
      expect(parsed.usageEvents[0]).toMatchObject({
        model: "claude-opus-4.6",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 40,
      })
      expect(parsed.toolEvents[0]).toMatchObject({
        toolName: "Bash",
        category: "tool_use",
      })
      expect(JSON.stringify(parsed)).not.toContain("secret prompt")
      expect(JSON.stringify(parsed)).not.toContain("hidden output")
      expect(JSON.stringify(parsed)).not.toContain("hidden thinking")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [x] **Step 2: Run the failing parser test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/cc-parser.test.ts
```

Expected: fail because `../cc-parser` does not exist.

- [x] **Step 3: Implement CC parser**

Create `desktop/electron/services/usage-analysis/cc-parser.ts` with a streaming JSONL parser:

```ts
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { estimateUsageCost } from "./pricing"
import { localDateKey, localHourKey } from "./range"

export interface ParsedUsageSession {
  readonly sessionId: string
  readonly filePath: string
  readonly workspaceKey: string
  readonly workspaceLabel: string
  readonly startedAt: string
  readonly endedAt: string
  readonly modelSummary: string
  readonly requestCount: number
  readonly conversationCount: number
  readonly toolCallCount: number
}

export interface ParsedUsageEvent {
  readonly id: string
  readonly sessionId: string
  readonly timestampMs: number
  readonly date: string
  readonly hour: string
  readonly workspaceKey: string
  readonly workspaceLabel: string
  readonly model: string
  readonly provider: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly costInput: number
  readonly costOutput: number
  readonly costCacheRead: number
  readonly costCacheWrite: number
  readonly costReasoning: number
  readonly totalCost: number
}

export interface ParsedToolEvent {
  readonly id: string
  readonly sessionId: string
  readonly timestampMs: number
  readonly date: string
  readonly workspaceKey: string
  readonly toolName: string
  readonly category: string
  readonly status: string
  readonly durationMs: number | null
}

export interface ParsedUsageFile {
  readonly sessions: ParsedUsageSession[]
  readonly usageEvents: ParsedUsageEvent[]
  readonly toolEvents: ParsedToolEvent[]
}

function asNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0
}

function parseTimestamp(value: unknown, fallback: number): number {
  if (typeof value !== "string") return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function workspaceFromClaudePath(filePath: string): { key: string; label: string } {
  const parts = filePath.split(path.sep)
  const projectIndex = parts.findIndex((part, index) => part === ".claude" && parts[index + 1] === "projects")
  const key = projectIndex >= 0 ? (parts[projectIndex + 2] ?? "") : ""
  return { key, label: key.replace(/^-Users-/, "/Users/").replaceAll("-", "/") }
}

export async function parseClaudeUsageFile(filePath: string): Promise<ParsedUsageFile> {
  const fallbackTs = fs.statSync(filePath).mtimeMs
  const sessionId = path.basename(filePath, ".jsonl")
  const workspace = workspaceFromClaudePath(filePath)
  const usageEvents: ParsedUsageEvent[] = []
  const toolEvents: ParsedToolEvent[] = []
  const models = new Set<string>()
  let conversationCount = 0
  let startedAt = ""
  let endedAt = ""

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    const timestampMs = parseTimestamp(raw.timestamp, fallbackTs)
    const iso = new Date(timestampMs).toISOString()
    if (!startedAt || iso < startedAt) startedAt = iso
    if (!endedAt || iso > endedAt) endedAt = iso

    if (raw.type === "user") {
      conversationCount++
      continue
    }

    const message = raw.message as Record<string, unknown> | undefined
    if (!message) continue

    const content = Array.isArray(message.content) ? message.content : []
    for (const block of content) {
      const value = block as Record<string, unknown>
      if (value?.type !== "tool_use") continue
      const toolName = typeof value.name === "string" ? value.name : "unknown"
      toolEvents.push({
        id: `${sessionId}:tool:${toolEvents.length}`,
        sessionId,
        timestampMs,
        date: localDateKey(timestampMs),
        workspaceKey: workspace.key,
        toolName,
        category: "tool_use",
        status: "",
        durationMs: null,
      })
    }

    const usage = message.usage as Record<string, unknown> | undefined
    const model = typeof message.model === "string" ? message.model : ""
    if (!usage || !model) continue
    models.add(model)

    const tokens = {
      input: asNumber(usage.input_tokens),
      output: asNumber(usage.output_tokens),
      cacheRead: asNumber(usage.cache_read_input_tokens),
      cacheWrite: asNumber(usage.cache_creation_input_tokens),
      reasoning: 0,
    }
    const cost = estimateUsageCost("cc", model, tokens)
    usageEvents.push({
      id: `${sessionId}:usage:${usageEvents.length}`,
      sessionId,
      timestampMs,
      date: localDateKey(timestampMs),
      hour: localHourKey(timestampMs),
      workspaceKey: workspace.key,
      workspaceLabel: workspace.label,
      model,
      provider: "anthropic",
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cacheRead,
      cacheWriteTokens: tokens.cacheWrite,
      reasoningTokens: tokens.reasoning,
      costInput: cost.input,
      costOutput: cost.output,
      costCacheRead: cost.cacheRead,
      costCacheWrite: cost.cacheWrite,
      costReasoning: cost.reasoning,
      totalCost: cost.total,
    })
  }

  return {
    sessions: [{
      sessionId,
      filePath,
      workspaceKey: workspace.key,
      workspaceLabel: workspace.label,
      startedAt,
      endedAt,
      modelSummary: [...models].join(", "),
      requestCount: usageEvents.length,
      conversationCount,
      toolCallCount: toolEvents.length,
    }],
    usageEvents,
    toolEvents,
  }
}
```

- [x] **Step 4: Run CC parser tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/cc-parser.test.ts
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add desktop/electron/services/usage-analysis/cc-parser.ts desktop/electron/services/usage-analysis/__tests__/cc-parser.test.ts
git commit -m "feat: parse Claude Code usage analysis"
```

---

### Task 6: Implement Codex Parser

**Files:**
- Create: `desktop/electron/services/usage-analysis/codex-parser.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/codex-parser.test.ts`

- [x] **Step 1: Write Codex parser tests**

Create `desktop/electron/services/usage-analysis/__tests__/codex-parser.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseCodexUsageFile } from "../codex-parser"

describe("Codex usage parser", () => {
  it("extracts token counts, session metadata, tools, and task timings", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-parser-"))
    try {
      const file = path.join(dir, "rollout-test.jsonl")
      fs.writeFileSync(file, [
        JSON.stringify({ type: "session_meta", timestamp: "2026-05-19T01:00:00.000Z", payload: { type: "session_meta", id: "s1", cwd: "/tmp/project", model_provider: "openai", source: "cli", cli_version: "1.0.0" } }),
        JSON.stringify({ type: "turn_context", timestamp: "2026-05-19T01:00:01.000Z", payload: { type: "turn_context", model: "gpt-5.5" } }),
        JSON.stringify({ type: "event_msg", timestamp: "2026-05-19T01:00:02.000Z", payload: { type: "user_message", content: "hidden user message" } }),
        JSON.stringify({ type: "event_msg", timestamp: "2026-05-19T01:00:03.000Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 10, total_tokens: 140 } } } }),
        JSON.stringify({ type: "response_item", timestamp: "2026-05-19T01:00:04.000Z", payload: { type: "function_call", name: "exec_command", call_id: "call-1", arguments: { cmd: "hidden command" } } }),
        JSON.stringify({ type: "event_msg", timestamp: "2026-05-19T01:00:05.000Z", payload: { type: "exec_command_end", call_id: "call-1", status: "failed", exit_code: 1, duration: 123 } }),
        JSON.stringify({ type: "event_msg", timestamp: "2026-05-19T01:00:06.000Z", payload: { type: "task_complete", turn_id: "t1", duration_ms: 5000, time_to_first_token_ms: 700 } }),
      ].join("\n"))

      const parsed = await parseCodexUsageFile(file)
      expect(parsed.sessions[0]).toMatchObject({
        sessionId: "s1",
        workspaceLabel: "project",
        provider: "openai",
        source: "cli",
        requestCount: 1,
        conversationCount: 1,
        toolCallCount: 2,
      })
      expect(parsed.usageEvents[0]).toMatchObject({
        model: "gpt-5.5",
        inputTokens: 80,
        cacheReadTokens: 20,
        outputTokens: 30,
        reasoningTokens: 10,
      })
      expect(parsed.toolEvents.map((event) => event.category)).toEqual(["function_call", "exec"])
      expect(parsed.taskEvents[0]).toMatchObject({
        durationMs: 5000,
        timeToFirstTokenMs: 700,
      })
      expect(JSON.stringify(parsed)).not.toContain("hidden user message")
      expect(JSON.stringify(parsed)).not.toContain("hidden command")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [x] **Step 2: Run the failing parser test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/codex-parser.test.ts
```

Expected: fail because `../codex-parser` does not exist.

- [x] **Step 3: Implement Codex parser**

Create `desktop/electron/services/usage-analysis/codex-parser.ts` using the same `ParsedUsageFile` shapes from `cc-parser.ts`, plus task events:

```ts
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { estimateUsageCost } from "./pricing"
import { localDateKey, localHourKey } from "./range"
import type { ParsedToolEvent, ParsedUsageEvent, ParsedUsageSession } from "./cc-parser"

export interface ParsedTaskEvent {
  readonly id: string
  readonly sessionId: string
  readonly startedAt: string
  readonly completedAt: string
  readonly durationMs: number | null
  readonly timeToFirstTokenMs: number | null
}

export interface ParsedCodexUsageFile {
  readonly sessions: ParsedUsageSession[]
  readonly usageEvents: ParsedUsageEvent[]
  readonly toolEvents: ParsedToolEvent[]
  readonly taskEvents: ParsedTaskEvent[]
}

function asNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0
}

function parseTimestamp(value: unknown, fallback: number): number {
  if (typeof value !== "string") return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function workspaceFromCwd(cwd: unknown): { key: string; label: string } {
  if (typeof cwd !== "string" || cwd.trim().length === 0) return { key: "", label: "" }
  return { key: cwd, label: path.basename(cwd) || cwd }
}

export async function parseCodexUsageFile(filePath: string): Promise<ParsedCodexUsageFile> {
  const fallbackTs = fs.statSync(filePath).mtimeMs
  let sessionId = path.basename(filePath, ".jsonl")
  let workspace = { key: "", label: "" }
  let provider = "openai"
  let source = ""
  let cliVersion = ""
  let currentModel = "unknown"
  let conversationCount = 0
  let startedAt = ""
  let endedAt = ""
  const models = new Set<string>()
  const usageEvents: ParsedUsageEvent[] = []
  const toolEvents: ParsedToolEvent[] = []
  const taskEvents: ParsedTaskEvent[] = []

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    const payload = raw.payload as Record<string, unknown> | undefined
    if (!payload) continue
    const payloadType = typeof payload.type === "string" ? payload.type : String(raw.type ?? "")
    const timestampMs = parseTimestamp(raw.timestamp, fallbackTs)
    const iso = new Date(timestampMs).toISOString()
    if (!startedAt || iso < startedAt) startedAt = iso
    if (!endedAt || iso > endedAt) endedAt = iso

    if (payloadType === "session_meta") {
      if (typeof payload.id === "string") sessionId = payload.id
      workspace = workspaceFromCwd(payload.cwd)
      if (typeof payload.model_provider === "string") provider = payload.model_provider
      if (typeof payload.source === "string") source = payload.source
      if (typeof payload.cli_version === "string") cliVersion = payload.cli_version
      continue
    }

    if (payloadType === "turn_context") {
      if (typeof payload.model === "string") currentModel = payload.model
      models.add(currentModel)
      continue
    }

    if (payloadType === "user_message") {
      conversationCount++
      continue
    }

    if (payloadType === "token_count") {
      const info = payload.info as Record<string, unknown> | undefined
      const last = info?.last_token_usage as Record<string, unknown> | undefined
      if (!last) continue
      const cached = asNumber(last.cached_input_tokens)
      const rawInput = asNumber(last.input_tokens)
      const tokens = {
        input: Math.max(0, rawInput - cached),
        output: asNumber(last.output_tokens),
        cacheRead: cached,
        cacheWrite: 0,
        reasoning: asNumber(last.reasoning_output_tokens),
      }
      const cost = estimateUsageCost("codex", currentModel, tokens)
      usageEvents.push({
        id: `${sessionId}:usage:${usageEvents.length}`,
        sessionId,
        timestampMs,
        date: localDateKey(timestampMs),
        hour: localHourKey(timestampMs),
        workspaceKey: workspace.key,
        workspaceLabel: workspace.label,
        model: currentModel,
        provider,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cacheReadTokens: tokens.cacheRead,
        cacheWriteTokens: tokens.cacheWrite,
        reasoningTokens: tokens.reasoning,
        costInput: cost.input,
        costOutput: cost.output,
        costCacheRead: cost.cacheRead,
        costCacheWrite: cost.cacheWrite,
        costReasoning: cost.reasoning,
        totalCost: cost.total,
      })
      continue
    }

    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      const toolName = typeof payload.name === "string" ? payload.name : payloadType
      toolEvents.push({
        id: `${sessionId}:tool:${toolEvents.length}`,
        sessionId,
        timestampMs,
        date: localDateKey(timestampMs),
        workspaceKey: workspace.key,
        toolName,
        category: payloadType,
        status: "",
        durationMs: null,
      })
      continue
    }

    if (payloadType === "exec_command_end" || payloadType === "patch_apply_end" || payloadType === "web_search_call" || payloadType === "mcp_tool_call_end") {
      toolEvents.push({
        id: `${sessionId}:tool:${toolEvents.length}`,
        sessionId,
        timestampMs,
        date: localDateKey(timestampMs),
        workspaceKey: workspace.key,
        toolName: payloadType,
        category: payloadType === "exec_command_end" ? "exec" : payloadType,
        status: typeof payload.status === "string" ? payload.status : "",
        durationMs: asNumber(payload.duration || payload.duration_ms) || null,
      })
      continue
    }

    if (payloadType === "task_complete") {
      taskEvents.push({
        id: typeof payload.turn_id === "string" ? payload.turn_id : `${sessionId}:task:${taskEvents.length}`,
        sessionId,
        startedAt: "",
        completedAt: typeof payload.completed_at === "string" ? payload.completed_at : iso,
        durationMs: asNumber(payload.duration_ms) || null,
        timeToFirstTokenMs: asNumber(payload.time_to_first_token_ms) || null,
      })
    }
  }

  return {
    sessions: [{
      sessionId,
      filePath,
      workspaceKey: workspace.key,
      workspaceLabel: workspace.label,
      startedAt,
      endedAt,
      modelSummary: [...models].join(", "),
      requestCount: usageEvents.length,
      conversationCount,
      toolCallCount: toolEvents.length,
    }],
    usageEvents,
    toolEvents,
    taskEvents,
  }
}
```

- [x] **Step 4: Run Codex parser tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/codex-parser.test.ts
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add desktop/electron/services/usage-analysis/codex-parser.ts desktop/electron/services/usage-analysis/__tests__/codex-parser.test.ts
git commit -m "feat: parse Codex usage analysis"
```

---

### Task 7: Add Report Services and Persistence

**Files:**
- Create: `desktop/electron/services/usage-analysis/cc-service.ts`
- Create: `desktop/electron/services/usage-analysis/codex-service.ts`
- Create: `desktop/electron/services/usage-analysis/index.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`

- [x] **Step 1: Write report service tests**

Create `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { closeUsageAnalysisDbForTests, getUsageAnalysisDb } from "../db"
import { CcUsageAnalysisService } from "../cc-service"

const tempDirs: string[] = []

afterEach(() => {
  closeUsageAnalysisDbForTests()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("usage analysis reports", () => {
  it("stores parsed CC events and returns overview totals", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-19T01:00:01.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4.6",
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
        content: [{ type: "tool_use", name: "Bash", id: "tool-1" }],
      },
    }))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    const refresh = await service.refresh()
    expect(refresh.parsedFiles).toBe(1)

    const overview = service.getOverview({ preset: "all" })
    expect(overview.totals.tokens).toBe(190)
    expect(overview.totals.requests).toBe(1)
    expect(overview.totals.toolCalls).toBe(1)
    expect(overview.topModels[0].model).toBe("claude-opus-4.6")
  })
})
```

- [x] **Step 2: Run the failing report test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/reports.test.ts
```

Expected: fail because services do not exist.

- [x] **Step 3: Implement service persistence and reports**

Implement `CcUsageAnalysisService` and `CodexUsageAnalysisService` with these public methods:

```ts
refresh(): Promise<UsageRefreshResult>
getOverview(range: UsageRangeInput): UsageOverviewReport
getTime(range: UsageRangeInput): UsageTimeBucket[]
getModels(range: UsageRangeInput): UsageModelRow[]
getProjects(range: UsageRangeInput): UsageProjectRow[]
getTools(range: UsageRangeInput): UsageToolRow[]
getDetails(range: UsageRangeInput): UsageDetailRow[]
```

Use prepared statements for inserts. In each refresh:

1. Collect files.
2. Compare `size` and `mtime_ms` against the matching scan table.
3. Parse changed files.
4. In one transaction, delete prior rows for changed sessions and insert new rows.
5. Rebuild the matching `daily` and `hourly` aggregate tables from usage and tool rows.

For first implementation, keep query logic simple and explicit:

```sql
SELECT * FROM cc_usage_events WHERE date >= ? AND date <= ?
```

Use `createUsageRangeFilter` to omit the `WHERE` clause for `all`.

- [x] **Step 4: Export services**

Create `desktop/electron/services/usage-analysis/index.ts`:

```ts
export { getUsageAnalysisDb } from "./db"
export { CcUsageAnalysisService } from "./cc-service"
export { CodexUsageAnalysisService } from "./codex-service"
export type { UsageRangeInput, UsageRefreshResult } from "./types"
```

- [x] **Step 5: Run report tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/reports.test.ts
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add desktop/electron/services/usage-analysis/cc-service.ts desktop/electron/services/usage-analysis/codex-service.ts desktop/electron/services/usage-analysis/index.ts desktop/electron/services/usage-analysis/__tests__/reports.test.ts
git commit -m "feat: add usage analysis reports"
```

---

### Task 8: Add IPC, Preload Bridge, and Service Registration

**Files:**
- Create: `desktop/electron/usage-analysis/channels.ts`
- Create: `desktop/electron/usage-analysis/ipc-handlers.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`

- [x] **Step 1: Add channel constants**

Create `desktop/electron/usage-analysis/channels.ts`:

```ts
export const USAGE_ANALYSIS_CHANNELS = {
  ccRefresh: "synapse:usage-analysis:cc:refresh",
  ccOverview: "synapse:usage-analysis:cc:overview",
  ccTime: "synapse:usage-analysis:cc:time",
  ccModels: "synapse:usage-analysis:cc:models",
  ccProjects: "synapse:usage-analysis:cc:projects",
  ccTools: "synapse:usage-analysis:cc:tools",
  ccDetails: "synapse:usage-analysis:cc:details",
  codexRefresh: "synapse:usage-analysis:codex:refresh",
  codexOverview: "synapse:usage-analysis:codex:overview",
  codexTime: "synapse:usage-analysis:codex:time",
  codexModels: "synapse:usage-analysis:codex:models",
  codexProjects: "synapse:usage-analysis:codex:projects",
  codexTools: "synapse:usage-analysis:codex:tools",
  codexDetails: "synapse:usage-analysis:codex:details",
} as const
```

- [x] **Step 2: Add IPC handlers**

Create `desktop/electron/usage-analysis/ipc-handlers.ts`:

```ts
import os from "node:os"
import path from "node:path"
import { USAGE_ANALYSIS_CHANNELS } from "./channels"
import { handleValidatedIpc } from "../ipc/validated-ipc"
import { getUsageAnalysisDb, CcUsageAnalysisService, CodexUsageAnalysisService } from "../services/usage-analysis"
import type { UsageRangeInput } from "../services/usage-analysis"

let registered = false

export function registerUsageAnalysisHandlers(): void {
  if (registered) return
  const db = getUsageAnalysisDb()
  const home = os.homedir()
  const cc = new CcUsageAnalysisService({
    db,
    roots: [path.join(home, ".claude", "projects")],
  })
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex")
  const codex = new CodexUsageAnalysisService({
    db,
    roots: [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")],
  })

  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccRefresh, async () => cc.refresh())
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccOverview, async (_event, range: UsageRangeInput) => cc.getOverview(range))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccTime, async (_event, range: UsageRangeInput) => cc.getTime(range))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccModels, async (_event, range: UsageRangeInput) => cc.getModels(range))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccProjects, async (_event, range: UsageRangeInput) => cc.getProjects(range))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccTools, async (_event, range: UsageRangeInput) => cc.getTools(range))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.ccDetails, async (_event, range: UsageRangeInput) => cc.getDetails(range))

  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexRefresh, async () => codex.refresh())
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexOverview, async (_event, range: UsageRangeInput) => codex.getOverview(range))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexTime, async (_event, range: UsageRangeInput) => codex.getTime(range))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexModels, async (_event, range: UsageRangeInput) => codex.getModels(range))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexProjects, async (_event, range: UsageRangeInput) => codex.getProjects(range))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexTools, async (_event, range: UsageRangeInput) => codex.getTools(range))
  handleValidatedIpc(USAGE_ANALYSIS_CHANNELS.codexDetails, async (_event, range: UsageRangeInput) => codex.getDetails(range))

  registered = true
}
```

- [x] **Step 3: Modify preload bridge**

In `desktop/electron/preload.ts`, import or inline `USAGE_ANALYSIS_CHANNELS` consistently with existing channel patterns. Add:

```ts
"usage-analysis": {
  "ccRefresh": "synapse:usage-analysis:cc:refresh",
  "ccOverview": "synapse:usage-analysis:cc:overview",
  "ccTime": "synapse:usage-analysis:cc:time",
  "ccModels": "synapse:usage-analysis:cc:models",
  "ccProjects": "synapse:usage-analysis:cc:projects",
  "ccTools": "synapse:usage-analysis:cc:tools",
  "ccDetails": "synapse:usage-analysis:cc:details",
  "codexRefresh": "synapse:usage-analysis:codex:refresh",
  "codexOverview": "synapse:usage-analysis:codex:overview",
  "codexTime": "synapse:usage-analysis:codex:time",
  "codexModels": "synapse:usage-analysis:codex:models",
  "codexProjects": "synapse:usage-analysis:codex:projects",
  "codexTools": "synapse:usage-analysis:codex:tools",
  "codexDetails": "synapse:usage-analysis:codex:details",
},
```

Add to `synapseBridge`:

```ts
usageAnalysis: {
  cc: {
    refresh: invoke(IPC_CHANNELS["usage-analysis"].ccRefresh),
    getOverview: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccOverview)(range),
    getTime: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccTime)(range),
    getModels: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccModels)(range),
    getProjects: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccProjects)(range),
    getTools: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccTools)(range),
    getDetails: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccDetails)(range),
  },
  codex: {
    refresh: invoke(IPC_CHANNELS["usage-analysis"].codexRefresh),
    getOverview: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexOverview)(range),
    getTime: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexTime)(range),
    getModels: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexModels)(range),
    getProjects: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexProjects)(range),
    getTools: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexTools)(range),
    getDetails: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexDetails)(range),
  },
},
```

- [x] **Step 4: Modify bridge types**

In `desktop/src/types/bridge.ts`, add `usageAnalysis` with method return types matching the service reports. Import shared renderer-independent types only if they are already safe for renderer type imports; otherwise define structural Promise return types in `bridge.ts` as the file currently does for `tokenUsage`.

- [x] **Step 5: Register descriptor**

In `desktop/electron/bootstrap/descriptors.ts`, add:

```ts
export const coreUsageAnalysisDescriptor: ServiceDescriptor<{ initialized: true }> = {
  id: "core.usage-analysis",
  criticality: "degraded",
  async create() {
    const { registerUsageAnalysisHandlers } = await import("../usage-analysis/ipc-handlers.js")
    registerUsageAnalysisHandlers()
    return { initialized: true }
  },
}
```

In `desktop/electron/bootstrap/registry.ts`, import and register `coreUsageAnalysisDescriptor` near `coreTokenUsageDescriptor`.

- [x] **Step 6: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: pass. If it fails on generated IPC/channel policy, follow the repo’s generated channel workflow instead of bypassing it.

- [x] **Step 7: Commit**

```bash
git add desktop/electron/usage-analysis/channels.ts desktop/electron/usage-analysis/ipc-handlers.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/registry.ts
git commit -m "feat: expose usage analysis IPC"
```

---

### Task 9: Build Shared Renderer Shell Components

**Files:**
- Create: `desktop/src/modules/usage-analysis/shared/range.ts`
- Create: `desktop/src/modules/usage-analysis/shared/types.ts`
- Create: `desktop/src/modules/usage-analysis/shared/use-report-loader.ts`
- Create: `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`
- Create: `desktop/src/modules/usage-analysis/shared/components/range-picker.tsx`
- Create: `desktop/src/modules/usage-analysis/shared/components/metric-grid.tsx`
- Create: `desktop/src/modules/usage-analysis/shared/components/breakdown-table.tsx`
- Create: `desktop/src/modules/usage-analysis/shared/components/report-state.tsx`
- Test: `desktop/src/modules/usage-analysis/__tests__/range-picker.test.tsx`

- [x] **Step 1: Write range picker test**

Create `desktop/src/modules/usage-analysis/__tests__/range-picker.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { RangePicker } from "../shared/components/range-picker"

describe("RangePicker", () => {
  it("renders the usage range options", () => {
    const html = renderToStaticMarkup(<RangePicker value="30d" onChange={() => undefined} />)
    expect(html).toContain("7 天")
    expect(html).toContain("30 天")
    expect(html).toContain("90 天")
    expect(html).toContain("全部")
  })
})
```

- [x] **Step 2: Implement shared renderer files**

Use existing shadcn components. `RangePicker` should use `Tabs`, not hand-rolled buttons:

```tsx
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { UsageRangePreset } from "../types"

interface RangePickerProps {
  value: UsageRangePreset
  onChange: (value: UsageRangePreset) => void
}

export function RangePicker({ value, onChange }: RangePickerProps) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as UsageRangePreset)}>
      <TabsList>
        <TabsTrigger value="7d">7 天</TabsTrigger>
        <TabsTrigger value="30d">30 天</TabsTrigger>
        <TabsTrigger value="90d">90 天</TabsTrigger>
        <TabsTrigger value="all">全部</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
```

`UsageAnalysisShell` should own secondary tabs and toolbar layout:

```tsx
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { RangePicker } from "./range-picker"
import type { UsageRangePreset, UsageViewId } from "../types"

interface UsageAnalysisShellProps {
  title: string
  view: UsageViewId
  range: UsageRangePreset
  refreshing: boolean
  onViewChange: (view: UsageViewId) => void
  onRangeChange: (range: UsageRangePreset) => void
  onRefresh: () => void
  children: React.ReactNode
}

const VIEWS: { id: UsageViewId; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "time", label: "时间" },
  { id: "models", label: "模型" },
  { id: "projects", label: "项目" },
  { id: "tools", label: "工具" },
  { id: "details", label: "明细" },
]

export function UsageAnalysisShell(props: UsageAnalysisShellProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-4 py-2">
        <div className="flex items-center justify-between gap-3">
          <Tabs value={props.view} onValueChange={(next) => props.onViewChange(next as UsageViewId)}>
            <TabsList>
              {VIEWS.map((view) => (
                <TabsTrigger key={view.id} value={view.id}>{view.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <RangePicker value={props.range} onChange={props.onRangeChange} />
            <Button type="button" variant="outline" size="sm" disabled={props.refreshing} onClick={props.onRefresh}>
              <RefreshCw data-icon="inline-start" />
              刷新
            </Button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {props.children}
      </div>
    </div>
  )
}
```

Define `UsageRangePreset` and `UsageViewId` in `shared/types.ts`.

- [x] **Step 3: Run shared renderer test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/range-picker.test.tsx
```

Expected: pass.

- [x] **Step 4: Commit**

```bash
git add desktop/src/modules/usage-analysis/shared desktop/src/modules/usage-analysis/__tests__/range-picker.test.tsx
git commit -m "feat: add usage analysis UI shell"
```

---

### Task 10: Add CC and Codex Renderer Pages

**Files:**
- Create all `desktop/src/modules/usage-analysis/cc/*`
- Create all `desktop/src/modules/usage-analysis/codex/*`
- Create: `desktop/src/modules/usage-analysis/index.tsx`
- Test: `desktop/src/modules/usage-analysis/__tests__/cc-page.test.tsx`
- Test: `desktop/src/modules/usage-analysis/__tests__/codex-page.test.tsx`

- [x] **Step 1: Write page smoke tests**

Create `desktop/src/modules/usage-analysis/__tests__/cc-page.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CcUsageAnalysisModule } from "../index"

describe("CcUsageAnalysisModule", () => {
  it("renders the CC usage analysis shell", () => {
    const html = renderToStaticMarkup(<CcUsageAnalysisModule />)
    expect(html).toContain("概览")
    expect(html).toContain("时间")
    expect(html).toContain("刷新")
  })
})
```

Create `desktop/src/modules/usage-analysis/__tests__/codex-page.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CodexUsageAnalysisModule } from "../index"

describe("CodexUsageAnalysisModule", () => {
  it("renders the Codex usage analysis shell", () => {
    const html = renderToStaticMarkup(<CodexUsageAnalysisModule />)
    expect(html).toContain("概览")
    expect(html).toContain("模型")
    expect(html).toContain("刷新")
  })
})
```

- [x] **Step 2: Implement hooks**

Create `cc/hooks.ts` and `codex/hooks.ts`. Each hook calls `requireSynapseBridge().usageAnalysis.<tool>`.

Use this shape:

```ts
import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { UsageRangePreset } from "../shared/types"

export function useCcOverview(range: UsageRangePreset) {
  const [data, setData] = useState<Awaited<ReturnType<typeof requireSynapseBridge>["usageAnalysis"]["cc"]["getOverview"]> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setData(await requireSynapseBridge().usageAnalysis.cc.getOverview({ preset: range }))
      setError(null)
    } catch {
      setError(new Error("读取失败"))
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { void refresh() }, [refresh])
  return { data, loading, error, refresh }
}
```

Avoid component-level `fetch` or raw Electron APIs.

- [x] **Step 3: Implement page components**

Each page should render a concise empty/loading state and report tables. First pass can render table-based reports without chart dependencies:

- `overview.tsx`: metric grid + token breakdown + cost breakdown + top lists.
- `time.tsx`: time bucket table.
- `models.tsx`: model table.
- `projects.tsx`: project table.
- `tools.tsx`: tools table.
- `details.tsx`: detail table.

Use `Table`, `Badge`, `Skeleton`, `Alert`, `Button`, and existing utility classes. Do not use inline styles or custom colors.

- [x] **Step 4: Implement module entry**

Create `desktop/src/modules/usage-analysis/index.tsx` exporting:

```tsx
import { CcUsagePage } from "./cc/cc-usage-page"
import { CodexUsagePage } from "./codex/codex-usage-page"

export function CcUsageAnalysisModule() {
  return <CcUsagePage />
}

export function CodexUsageAnalysisModule() {
  return <CodexUsagePage />
}
```

- [x] **Step 5: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/usage-analysis/__tests__/cc-page.test.tsx src/modules/usage-analysis/__tests__/codex-page.test.tsx
```

Expected: pass.

- [x] **Step 6: Commit**

```bash
git add desktop/src/modules/usage-analysis
git commit -m "feat: add usage analysis pages"
```

---

### Task 11: Wire Top-Level Tabs

**Files:**
- Modify: `desktop/src/App.tsx`

- [x] **Step 1: Update imports and tab type**

In `desktop/src/App.tsx`, add:

```ts
import { CcUsageAnalysisModule, CodexUsageAnalysisModule } from "@/modules/usage-analysis"
```

Extend `AppTabId`:

```ts
type AppTabId = SynapseContentType | "agent" | "database" | "task-scheduler" | "editor-scan" | "token-usage" | "usage-cc" | "usage-codex" | "workflow" | "settings"
```

- [x] **Step 2: Add tabs after old 用量**

In the `tabs` array, add:

```ts
{ id: "usage-cc" as const, label: "CC" },
{ id: "usage-codex" as const, label: "Codex" },
```

Keep old:

```ts
{ id: "token-usage" as const, label: "用量" },
```

- [x] **Step 3: Render modules**

Below old `TokenUsageModule` render block, add:

```tsx
{activeTab === "usage-cc" ? (
  <ErrorBoundary fallbackTitle="CC 使用分析出现问题">
    <CcUsageAnalysisModule />
  </ErrorBoundary>
) : null}
{activeTab === "usage-codex" ? (
  <ErrorBoundary fallbackTitle="Codex 使用分析出现问题">
    <CodexUsageAnalysisModule />
  </ErrorBoundary>
) : null}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/App.tsx
git commit -m "feat: add usage analysis tabs"
```

---

### Task 12: Final Verification

**Files:**
- No new files unless verification reveals necessary fixes.

- [x] **Step 1: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: pass.

- [x] **Step 2: Run usage analysis tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis src/modules/usage-analysis
```

Expected: pass.

- [ ] **Step 3: Run package tests**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: pass.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass.

- [x] **Step 5: Inspect diff**

Run:

```bash
git diff --stat HEAD
git diff --check
```

Expected:

- No whitespace errors.
- Changes are limited to usage analysis, bridge/IPC registration, and top-level tab wiring.
- Existing `desktop/src/modules/token-usage` behavior remains unchanged.

- [ ] **Step 6: Commit verification fixes when files changed**

If verification required fixes, inspect the changed files first:

```bash
git status --short
git diff --check
```

Then stage only files changed for this usage-analysis implementation and commit them:

```bash
git commit -m "fix: verify usage analysis integration"
```

If no fixes were needed, do not create an empty commit.
