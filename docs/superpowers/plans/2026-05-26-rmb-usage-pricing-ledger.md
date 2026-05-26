# RMB Usage Pricing Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch Synapse usage pricing and cost display to RMB while preserving historical costs as stable ledger snapshots.

**Architecture:** Add shared CNY conversion and formatting utilities, migrate usage-analysis SQLite prices and stored costs once at `1 USD = 7.2 CNY`, and stop refresh/price-rule edits from repricing historical usage events. New usage events are priced at insert time with current CNY rules; aggregates only sum stored event costs. Agent and Workflow displays convert legacy `costUsd` values to CNY without rewriting all historical JSON records.

**Tech Stack:** Electron main process, SQLite via `node:sqlite`, React, TypeScript, shadcn/ui, Vitest.

---

## File Structure

- Create `desktop/action-packages/shared/cost-currency.ts`
  - Shared constants and functions usable by Electron, workflow nodes, action packages, and renderer wrappers.
- Create `desktop/action-packages/__tests__/cost-currency.test.ts`
  - Unit tests for USD to CNY conversion, cost normalization, and CNY formatting.
- Create `desktop/src/lib/cost-currency.ts`
  - Renderer-friendly re-export from the shared module.
- Modify `desktop/src/lib/token-usage.ts`
  - Keep existing exported names for compatibility, but make user-facing cost formatting output CNY.
- Modify `desktop/electron/services/usage-analysis/pricing.ts`
  - Add currency fields to price-rule types, convert built-in default prices to CNY, and persist currency metadata.
- Modify `desktop/electron/services/usage-analysis/db-schema.ts`
  - Add currency metadata columns and call the one-time migration.
- Create `desktop/electron/services/usage-analysis/currency-migration.ts`
  - Idempotent USD-to-CNY migration for price rules, event costs, and aggregates.
- Modify `desktop/electron/services/usage-analysis/cc-parser.ts`
  - Accept current price rules through parse options so new events are priced with saved CNY rules.
- Modify `desktop/electron/services/usage-analysis/codex-parser.ts`
  - Accept current price rules through parse options for Codex usage events.
- Modify `desktop/electron/services/usage-analysis/cc-service.ts`
  - Pass price rules to parsers, persist event cost metadata, rebuild aggregates from stored costs, and stop automatic full-history repricing.
- Modify `desktop/electron/services/usage-analysis/types.ts`
  - Add cost currency fields where report callers need them.
- Modify `desktop/src/types/bridge.ts`
  - Mirror updated pricing rule and report types for renderer calls.
- Modify `desktop/src/modules/usage-analysis/shared/components/pricing-rules-dialog.tsx`
  - Change unit copy to RMB and keep the existing table layout.
- Modify `desktop/src/modules/usage-analysis/shared/components/report-views.tsx`
  - Format cost values as CNY.
- Modify `desktop/src/modules/usage-analysis/shared/components/today-report-view.tsx`
  - Format cost values as CNY.
- Modify `desktop/src/modules/usage-analysis/shared/today.ts`
  - Format metric sub-values as CNY.
- Modify `desktop/src/components/token-usage-summary.tsx`
  - Keep existing prop names but display legacy USD costs as converted RMB.
- Modify `desktop/src/modules/workflow/runner/run-report.ts`
  - Display workflow total and node costs as converted RMB.
- Modify `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`
  - Capture CNY companion cost for new SDK result events.
- Modify `desktop/electron/services/agent-runtime/types.ts`
  - Add optional CNY cost metadata while preserving `costUsd`.
- Modify `desktop/electron/services/agent-runtime/conversation-router.ts`
  - Persist CNY companion metadata for new results.
- Modify `desktop/src/types/agent.ts`
  - Add optional CNY cost metadata for renderer timeline items.
- Modify `desktop/electron/modules/agent/ipc-shared.ts`
  - Allow optional CNY cost metadata in IPC schemas.
- Modify `desktop/src/lib/agent-timeline.ts`
  - Preserve CNY metadata on timeline merge.
- Modify `desktop/src/types/workflow.ts`
  - Add optional CNY cost metadata to node results.
- Modify `desktop/workflow-nodes/types.ts`
  - Add optional CNY cost metadata through workflow node execution.
- Modify `desktop/workflow-nodes/prompt/executor.main.ts`
  - Pass through CNY cost metadata.
- Modify `desktop/workflow-nodes/switch/executor.main.ts`
  - Pass through CNY cost metadata.
- Modify `desktop/action-packages/builtin/agent/executor.main.ts`
  - Persist scheduled Agent CNY cost metadata.
- Modify `desktop/electron/services/workflow/workflow-engine.ts`
  - Preserve CNY cost metadata on node run results.
- Modify `desktop/electron/modules/workflow/ipc.ts`
  - Allow optional CNY cost metadata in workflow IPC schemas.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add the user-visible RMB pricing and migration note.

## Task 1: Shared RMB Cost Utilities

**Files:**
- Create: `desktop/action-packages/shared/cost-currency.ts`
- Create: `desktop/action-packages/__tests__/cost-currency.test.ts`
- Create: `desktop/src/lib/cost-currency.ts`
- Modify: `desktop/src/lib/token-usage.ts`

- [ ] **Step 1: Write shared utility tests**

Create `desktop/action-packages/__tests__/cost-currency.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  SYNAPSE_COST_CURRENCY,
  USD_TO_CNY_RATE,
  formatSynapseCost,
  normalizeCostCny,
  resolveSynapseCostCny,
  usdToCny,
} from "../shared/cost-currency"

describe("cost currency helpers", () => {
  it("converts legacy USD costs to CNY with the fixed rate", () => {
    expect(SYNAPSE_COST_CURRENCY).toBe("CNY")
    expect(USD_TO_CNY_RATE).toBe(7.2)
    expect(usdToCny(0.01)).toBeCloseTo(0.072, 6)
  })

  it("normalizes finite non-negative CNY costs", () => {
    expect(normalizeCostCny(1.23)).toBe(1.23)
    expect(normalizeCostCny(-1)).toBeUndefined()
    expect(normalizeCostCny(Number.NaN)).toBeUndefined()
    expect(normalizeCostCny("1")).toBeUndefined()
  })

  it("prefers CNY snapshots and falls back to legacy USD values", () => {
    expect(resolveSynapseCostCny({ costCny: 5, costUsd: 1 })).toBe(5)
    expect(resolveSynapseCostCny({ costUsd: 1 })).toBe(7.2)
    expect(resolveSynapseCostCny({})).toBeUndefined()
  })

  it("formats CNY values for user-facing cost display", () => {
    expect(formatSynapseCost(7.2)).toContain("¥")
    expect(formatSynapseCost(7.2)).toContain("7.20")
  })
})
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- cost-currency
```

Expected: FAIL because `desktop/action-packages/shared/cost-currency.ts` does not exist.

- [ ] **Step 3: Add the shared utility module**

Create `desktop/action-packages/shared/cost-currency.ts`:

```ts
export const SYNAPSE_COST_CURRENCY = "CNY" as const
export const USD_TO_CNY_RATE = 7.2

export type SynapseCostCurrency = typeof SYNAPSE_COST_CURRENCY

const costFormatter = new Intl.NumberFormat("zh-CN", {
  currency: SYNAPSE_COST_CURRENCY,
  maximumFractionDigits: 6,
  minimumFractionDigits: 2,
  style: "currency",
})

export function usdToCny(value: number): number {
  return value * USD_TO_CNY_RATE
}

export function normalizeCostCny(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  return value
}

export function resolveSynapseCostCny(input: {
  readonly costCny?: unknown
  readonly costUsd?: unknown
}): number | undefined {
  const cny = normalizeCostCny(input.costCny)
  if (cny !== undefined) return cny
  const usd = normalizeCostCny(input.costUsd)
  return usd === undefined ? undefined : usdToCny(usd)
}

export function formatSynapseCost(value: number): string {
  return costFormatter.format(value)
}
```

- [ ] **Step 4: Add the renderer re-export**

Create `desktop/src/lib/cost-currency.ts`:

```ts
export {
  SYNAPSE_COST_CURRENCY,
  USD_TO_CNY_RATE,
  formatSynapseCost,
  normalizeCostCny,
  resolveSynapseCostCny,
  usdToCny,
  type SynapseCostCurrency,
} from "../../action-packages/shared/cost-currency"
```

- [ ] **Step 5: Update token usage formatting to CNY**

In `desktop/src/lib/token-usage.ts`, replace the USD formatter with the shared formatter while preserving existing exports:

```ts
import { formatSynapseCost, resolveSynapseCostCny } from "@/lib/cost-currency"
```

Change `normalizeCostUsd` and `formatCostUsd` to:

```ts
export function normalizeCostUsd(value: unknown): number | undefined {
  return resolveSynapseCostCny({ costUsd: value })
}

export function formatCostUsd(value: number): string {
  return formatSynapseCost(value)
}
```

This keeps call sites compiling while changing the user-facing meaning to CNY.

- [ ] **Step 6: Run the utility test and type-adjacent token usage tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- cost-currency run-report
```

Expected: `cost-currency` PASS; existing run-report tests may FAIL until Task 5 updates expected CNY strings.

- [ ] **Step 7: Commit**

```bash
git add desktop/action-packages/shared/cost-currency.ts desktop/action-packages/__tests__/cost-currency.test.ts desktop/src/lib/cost-currency.ts desktop/src/lib/token-usage.ts
git commit -m "feat: add rmb cost utilities"
```

## Task 2: Usage Pricing Schema And One-Time Migration

**Files:**
- Modify: `desktop/electron/services/usage-analysis/pricing.ts`
- Modify: `desktop/electron/services/usage-analysis/db-schema.ts`
- Create: `desktop/electron/services/usage-analysis/currency-migration.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`

- [ ] **Step 1: Add migration and default-price tests**

Append these tests to `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`:

```ts
import { DatabaseSync } from "node:sqlite"
import { initUsageAnalysisSchema } from "../db-schema"
import { DEFAULT_USAGE_PRICE_RULES, listUsagePriceRules } from "../pricing"

describe("usage analysis RMB pricing migration", () => {
  it("seeds new databases with CNY default price rules", () => {
    const db = new DatabaseSync(":memory:")
    initUsageAnalysisSchema(db)

    const rules = listUsagePriceRules(db)
    expect(rules.find((rule) => rule.modelPattern === "claude-sonnet-4")).toMatchObject({
      inputPer1M: 21.6,
      outputPer1M: 108,
      cacheReadPer1M: 2.16,
      cacheWritePer1M: 27,
      reasoningPer1M: 108,
      currency: "CNY",
    })
    expect(db.prepare("SELECT value FROM usage_pricing_meta WHERE key = ?").get("cost_currency_migrated_to_cny_v1")).toBeTruthy()
    db.close()
  })

  it("keeps default in-memory rules in CNY", () => {
    expect(DEFAULT_USAGE_PRICE_RULES.find((rule) => rule.modelPattern === "claude-sonnet-4")).toMatchObject({
      inputPer1M: 21.6,
      outputPer1M: 108,
      cacheReadPer1M: 2.16,
      cacheWritePer1M: 27,
      reasoningPer1M: 108,
      currency: "CNY",
    })
  })
})
```

Append this migration test to `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`:

```ts
it("migrates legacy USD prices and stored costs exactly once", () => {
  const db = new DatabaseSync(":memory:")
  db.exec(`
    CREATE TABLE usage_model_prices (
      id TEXT PRIMARY KEY,
      model_pattern TEXT NOT NULL,
      input_per_1m REAL NOT NULL DEFAULT 0,
      output_per_1m REAL NOT NULL DEFAULT 0,
      cache_read_per_1m REAL NOT NULL DEFAULT 0,
      cache_write_per_1m REAL NOT NULL DEFAULT 0,
      reasoning_per_1m REAL NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'user',
      sort_index INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE usage_pricing_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE cc_scan_files (file_path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL, line_count INTEGER NOT NULL DEFAULT 0, parse_status TEXT NOT NULL, error_kind TEXT, last_scanned_at TEXT NOT NULL);
    CREATE TABLE cc_sessions (session_id TEXT PRIMARY KEY, file_path TEXT NOT NULL, workspace_key TEXT NOT NULL DEFAULT '', workspace_label TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', cli_version TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL DEFAULT '', ended_at TEXT NOT NULL DEFAULT '', model_summary TEXT NOT NULL DEFAULT '', request_count INTEGER NOT NULL DEFAULT 0, conversation_count INTEGER NOT NULL DEFAULT 0, tool_call_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE cc_usage_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, date TEXT NOT NULL, hour TEXT NOT NULL, workspace_key TEXT NOT NULL DEFAULT '', workspace_label TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT 'unknown', provider TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0, cost_input REAL NOT NULL DEFAULT 0, cost_output REAL NOT NULL DEFAULT 0, cost_cache_read REAL NOT NULL DEFAULT 0, cost_cache_write REAL NOT NULL DEFAULT 0, cost_reasoning REAL NOT NULL DEFAULT 0, total_cost REAL NOT NULL DEFAULT 0, price_known INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE cc_tool_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, date TEXT NOT NULL, hour TEXT NOT NULL DEFAULT '', workspace_key TEXT NOT NULL DEFAULT '', tool_name TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT '', exit_code INTEGER, duration_ms INTEGER);
    CREATE TABLE cc_daily_usage (date TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', workspace_key TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0, cost_input REAL NOT NULL DEFAULT 0, cost_output REAL NOT NULL DEFAULT 0, cost_cache_read REAL NOT NULL DEFAULT 0, cost_cache_write REAL NOT NULL DEFAULT 0, cost_reasoning REAL NOT NULL DEFAULT 0, total_cost REAL NOT NULL DEFAULT 0, price_known INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0, conversations INTEGER NOT NULL DEFAULT 0, tool_calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, model, provider, workspace_key));
    CREATE TABLE cc_hourly_usage (hour TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', workspace_key TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0, cost_input REAL NOT NULL DEFAULT 0, cost_output REAL NOT NULL DEFAULT 0, cost_cache_read REAL NOT NULL DEFAULT 0, cost_cache_write REAL NOT NULL DEFAULT 0, cost_reasoning REAL NOT NULL DEFAULT 0, total_cost REAL NOT NULL DEFAULT 0, price_known INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0, conversations INTEGER NOT NULL DEFAULT 0, tool_calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hour, model, provider, workspace_key));
    INSERT INTO usage_model_prices (id, model_pattern, input_per_1m, output_per_1m, cache_read_per_1m, cache_write_per_1m, reasoning_per_1m, enabled, source, sort_index, updated_at)
    VALUES ('legacy', 'legacy-model', 1, 2, 0.5, 3, 2, 1, 'user', 0, '2026-05-01T00:00:00.000Z');
    INSERT INTO cc_usage_events (id, session_id, timestamp_ms, date, hour, model, input_tokens, output_tokens, cost_input, cost_output, total_cost, price_known)
    VALUES ('event-1', 'session-1', 1770000000000, '2026-05-01', '2026-05-01 10', 'legacy-model', 100, 50, 1, 2, 3, 1);
  `)

  initUsageAnalysisSchema(db)
  initUsageAnalysisSchema(db)

  expect(db.prepare("SELECT input_per_1m, output_per_1m, currency FROM usage_model_prices WHERE id = 'legacy'").get()).toEqual({
    input_per_1m: 7.2,
    output_per_1m: 14.4,
    currency: "CNY",
  })
  expect(db.prepare("SELECT cost_input, cost_output, total_cost, cost_currency, pricing_rate FROM cc_usage_events WHERE id = 'event-1'").get()).toEqual({
    cost_input: 7.2,
    cost_output: 14.4,
    total_cost: 21.6,
    cost_currency: "CNY",
    pricing_rate: 7.2,
  })
  expect(db.prepare("SELECT total_cost, cost_currency FROM cc_daily_usage WHERE model = 'legacy-model'").get()).toEqual({
    total_cost: 21.6,
    cost_currency: "CNY",
  })
  db.close()
})
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- pricing reports
```

Expected: FAIL because currency columns and migration code do not exist.

- [ ] **Step 3: Add currency fields and CNY defaults to pricing**

In `desktop/electron/services/usage-analysis/pricing.ts`:

- import constants:

```ts
import { SYNAPSE_COST_CURRENCY, type SynapseCostCurrency } from "../../../action-packages/shared/cost-currency"
```

- add `currency?: SynapseCostCurrency` to `UsageModelPriceRuleInput`.
- add `currency: SynapseCostCurrency` to `UsageModelPriceRule`.
- add `currency` to `PriceRuleRow`.
- convert `DEFAULT_USAGE_PRICE_RULE_INPUTS` by multiplying each previous USD value by `7.2`.
- set `currency: SYNAPSE_COST_CURRENCY` in normalized rules.
- select, map, and insert the `currency` column.

The default Sonnet rule should become:

```ts
{ id: "claude-sonnet-4", modelPattern: "claude-sonnet-4", inputPer1M: 21.6, outputPer1M: 108, cacheReadPer1M: 2.16, cacheWritePer1M: 27, reasoningPer1M: 108, source: "builtin" }
```

- [ ] **Step 4: Add migration module**

Create `desktop/electron/services/usage-analysis/currency-migration.ts`:

```ts
import type { DatabaseSync } from "node:sqlite"
import { SYNAPSE_COST_CURRENCY, USD_TO_CNY_RATE } from "../../../action-packages/shared/cost-currency"
import { seedDefaultUsagePriceRules } from "./pricing"

const RMB_MIGRATION_META_KEY = "cost_currency_migrated_to_cny_v1"

export function migrateUsageAnalysisCostsToCny(database: DatabaseSync): void {
  const marker = database.prepare("SELECT value FROM usage_pricing_meta WHERE key = ?").get(RMB_MIGRATION_META_KEY) as { value?: string } | undefined
  if (marker?.value) return

  const migratedAt = new Date().toISOString()
  database.exec("BEGIN IMMEDIATE")
  try {
    const priceCount = countRows(database, "usage_model_prices")
    if (priceCount === 0) {
      seedDefaultUsagePriceRules(database)
    } else {
      database.prepare(`
        UPDATE usage_model_prices SET
          input_per_1m = input_per_1m * ?,
          output_per_1m = output_per_1m * ?,
          cache_read_per_1m = cache_read_per_1m * ?,
          cache_write_per_1m = cache_write_per_1m * ?,
          reasoning_per_1m = reasoning_per_1m * ?,
          currency = ?
        WHERE currency = '' OR currency = 'USD'
      `).run(USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, SYNAPSE_COST_CURRENCY)
    }

    for (const prefix of ["cc", "cx"] as const) {
      database.prepare(`
        UPDATE ${prefix}_usage_events SET
          cost_input = cost_input * ?,
          cost_output = cost_output * ?,
          cost_cache_read = cost_cache_read * ?,
          cost_cache_write = cost_cache_write * ?,
          cost_reasoning = cost_reasoning * ?,
          total_cost = total_cost * ?,
          cost_currency = ?,
          pricing_rate = ?,
          priced_at = CASE WHEN priced_at = '' THEN ? ELSE priced_at END
        WHERE cost_currency = '' OR cost_currency = 'USD'
      `).run(USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, SYNAPSE_COST_CURRENCY, USD_TO_CNY_RATE, migratedAt)
    }

    database.prepare(`
      INSERT OR REPLACE INTO usage_pricing_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(RMB_MIGRATION_META_KEY, JSON.stringify({ currency: SYNAPSE_COST_CURRENCY, rate: USD_TO_CNY_RATE, migratedAt }), migratedAt)
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}

function countRows(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count_value FROM ${table}`).get() as { count_value?: number } | undefined
  return Number(row?.count_value ?? 0)
}
```

The aggregate rebuild call is added in Task 4 after `rebuildAggregates` can write currency metadata.

- [ ] **Step 5: Add schema columns and call migration**

In `desktop/electron/services/usage-analysis/db-schema.ts`:

- import `migrateUsageAnalysisCostsToCny` instead of calling `seedDefaultUsagePriceRules` directly.
- add `currency TEXT NOT NULL DEFAULT ''` to `usage_model_prices`.
- add `cost_currency TEXT NOT NULL DEFAULT ''`, `pricing_rate REAL NOT NULL DEFAULT 0`, `priced_at TEXT NOT NULL DEFAULT ''`, and `pricing_version TEXT NOT NULL DEFAULT ''` to usage event table definitions.
- add `cost_currency TEXT NOT NULL DEFAULT ''` to daily and hourly aggregate table definitions.
- add `ensureColumn` calls for all new columns.
- call `migrateUsageAnalysisCostsToCny(database)` after all `ensureColumn` calls and before indexes are used by reports.

- [ ] **Step 6: Run pricing and report tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- pricing reports
```

Expected: PASS for pricing defaults and migration tests. Some report-cost behavior may still FAIL until Task 3 removes automatic historical repricing.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/usage-analysis/pricing.ts desktop/electron/services/usage-analysis/db-schema.ts desktop/electron/services/usage-analysis/currency-migration.ts desktop/electron/services/usage-analysis/__tests__/pricing.test.ts desktop/electron/services/usage-analysis/__tests__/reports.test.ts
git commit -m "feat: migrate usage pricing to rmb"
```

## Task 3: Snapshot Pricing On Refresh

**Files:**
- Modify: `desktop/electron/services/usage-analysis/cc-parser.ts`
- Modify: `desktop/electron/services/usage-analysis/codex-parser.ts`
- Modify: `desktop/electron/services/usage-analysis/cc-service.ts`
- Modify: `desktop/electron/services/usage-analysis/types.ts`
- Test: `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`

- [ ] **Step 1: Replace the historical-reprice test**

In `desktop/electron/services/usage-analysis/__tests__/reports.test.ts`, replace the existing test named `recalculates report costs after saving model-only price rules` with:

```ts
it("keeps historical event costs stable after saving model-only price rules", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
  tempDirs.push(dir)
  const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
  fs.mkdirSync(projectDir, { recursive: true })
  fs.writeFileSync(path.join(projectDir, "session.jsonl"), JSON.stringify({
    type: "assistant",
    timestamp: "2026-05-19T01:00:01.000Z",
    message: {
      role: "assistant",
      model: "local-model",
      usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
    },
  }))

  const db = getUsageAnalysisDb(dir)
  const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
  await service.refresh()

  const before = service.getOverview({ preset: "all" })
  expect(before.totals.estimatedCost).toBe(0)
  expect(before.totals.unpricedTokens).toBe(1_500_000)

  service.savePricingRules([{
    modelPattern: "local-model",
    inputPer1M: 14.4,
    outputPer1M: 57.6,
    cacheReadPer1M: 0,
    cacheWritePer1M: 0,
    reasoningPer1M: 57.6,
  }])

  const after = service.getOverview({ preset: "all" })
  expect(after.totals.estimatedCost).toBe(0)
  expect(after.totals.unpricedTokens).toBe(1_500_000)
})
```

Add this new append-pricing test:

```ts
it("prices newly appended events with current CNY rules without repricing old events", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
  tempDirs.push(dir)
  const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
  fs.mkdirSync(projectDir, { recursive: true })
  const file = path.join(projectDir, "session.jsonl")
  fs.writeFileSync(file, `${JSON.stringify({
    type: "assistant",
    timestamp: "2026-05-19T01:00:01.000Z",
    message: {
      role: "assistant",
      model: "local-model",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    },
  })}\n`)

  const db = getUsageAnalysisDb(dir)
  const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
  await service.refresh()
  service.savePricingRules([{ modelPattern: "local-model", inputPer1M: 14.4, outputPer1M: 0 }])
  fs.appendFileSync(file, `${JSON.stringify({
    type: "assistant",
    timestamp: "2026-05-19T02:00:01.000Z",
    message: {
      role: "assistant",
      model: "local-model",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    },
  })}\n`)

  await service.refresh()

  const rows = db.prepare("SELECT total_cost, price_known, cost_currency FROM cc_usage_events ORDER BY timestamp_ms ASC").all() as { total_cost: number; price_known: number; cost_currency: string }[]
  expect(rows).toEqual([
    { total_cost: 0, price_known: 0, cost_currency: "CNY" },
    { total_cost: 14.4, price_known: 1, cost_currency: "CNY" },
  ])
  expect(service.getOverview({ preset: "all" }).totals).toMatchObject({
    estimatedCost: 14.4,
    pricedTokens: 1_000_000,
    unpricedTokens: 1_000_000,
  })
})
```

- [ ] **Step 2: Run report tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- reports
```

Expected: FAIL because saving rules and refresh still reprice all history.

- [ ] **Step 3: Pass price rules into parsers**

In `desktop/electron/services/usage-analysis/cc-parser.ts`:

- import `UsageModelPriceRule` type from `./pricing`.
- add to `UsageParseOptions`:

```ts
readonly priceRules?: readonly UsageModelPriceRule[]
```

- change:

```ts
const cost = estimateUsageCost(model, tokens)
```

to:

```ts
const cost = estimateUsageCost(model, tokens, options.priceRules)
```

In `desktop/electron/services/usage-analysis/codex-parser.ts`, make the same `estimateUsageCost(currentModel, tokens, options.priceRules)` change.

- [ ] **Step 4: Persist CNY event metadata**

In `desktop/electron/services/usage-analysis/cc-service.ts`:

- import `SYNAPSE_COST_CURRENCY` and `USD_TO_CNY_RATE` from the shared utility.
- extend `UsageEventRow` with:

```ts
readonly cost_currency: string
readonly pricing_rate: number
readonly priced_at: string
readonly pricing_version: string
```

- in `refreshUsageNamespace`, load price rules once:

```ts
const priceRules = listUsagePriceRules(options.db)
const pricedAt = new Date().toISOString()
```

- pass rules into `parseFile`:

```ts
const parsed = await options.parseFile(file, canAppend ? { startLine: existing.line_count, priceRules } : { priceRules })
```

- pass `pricedAt` to `persistParsedFile`.
- add cost metadata columns to the usage insert statement:

```sql
cost_input, cost_output, cost_cache_read, cost_cache_write, cost_reasoning, total_cost, price_known,
cost_currency, pricing_rate, priced_at, pricing_version
```

- add values:

```ts
SYNAPSE_COST_CURRENCY,
USD_TO_CNY_RATE,
pricedAt,
"",
```

- [ ] **Step 5: Stop automatic full-history repricing**

In `desktop/electron/services/usage-analysis/cc-service.ts`:

- remove `repriceUsageEvents(options.db, options.prefix)` from the end of `refreshUsageNamespace`.
- in `savePricingRules`, remove:

```ts
repriceUsageEvents(this.db, "cc")
repriceUsageEvents(this.db, "cx")
rebuildAggregates(this.db, "cc")
rebuildAggregates(this.db, "cx")
```

- in `ensureAggregatesReady`, remove the `hasStaleEventPricing()` branch.
- keep `repriceUsageEvents` only if the migration module imports it; otherwise delete it after migration no longer needs it.

- [ ] **Step 6: Rebuild aggregates from stored event costs**

Keep `rebuildAggregates` as the sole aggregate repair path. Ensure every aggregate insert selects stored cost columns and writes `cost_currency = "CNY"`:

```sql
SUM(cost_input),
SUM(cost_output),
SUM(cost_cache_read),
SUM(cost_cache_write),
SUM(cost_reasoning),
SUM(total_cost),
MAX(price_known),
'CNY',
```

For tool aggregate rows, write zero cost and `cost_currency = "CNY"`.

Export `rebuildAggregates` if `currency-migration.ts` calls it after converting legacy event costs:

```ts
export { refreshUsageNamespace, rebuildAggregates }
```

- [ ] **Step 7: Run report tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- reports
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/usage-analysis/cc-parser.ts desktop/electron/services/usage-analysis/codex-parser.ts desktop/electron/services/usage-analysis/cc-service.ts desktop/electron/services/usage-analysis/types.ts desktop/electron/services/usage-analysis/__tests__/reports.test.ts
git commit -m "feat: preserve usage cost snapshots"
```

## Task 4: Usage Analysis RMB UI And Types

**Files:**
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/modules/usage-analysis/shared/components/pricing-rules-dialog.tsx`
- Modify: `desktop/src/modules/usage-analysis/shared/components/report-views.tsx`
- Modify: `desktop/src/modules/usage-analysis/shared/components/today-report-view.tsx`
- Modify: `desktop/src/modules/usage-analysis/shared/today.ts`
- Test: `desktop/src/modules/usage-analysis/__tests__/report-views.test.tsx`
- Test: `desktop/src/modules/usage-analysis/__tests__/today.test.ts`

- [ ] **Step 1: Update UI test expectations to RMB**

In `desktop/src/modules/usage-analysis/__tests__/today.test.ts`, change:

```ts
expect(metrics[0].subValue).toBe("US$1.20")
```

to:

```ts
expect(metrics[0].subValue).toContain("¥1.20")
```

In `desktop/src/modules/usage-analysis/__tests__/report-views.test.tsx`, add:

```ts
it("formats overview costs as RMB", () => {
  const html = renderToStaticMarkup(
    <OverviewReportView
      state={state(overviewReport(), false)}
      trendBucket="day"
      onTrendBucketChange={() => undefined}
    />,
  )

  expect(html).toContain("¥0.01")
  expect(html).not.toContain("US$")
})
```

- [ ] **Step 2: Run UI tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- today report-views
```

Expected: FAIL because components still format costs as USD.

- [ ] **Step 3: Add bridge currency fields**

In `desktop/src/types/bridge.ts`:

- add `readonly currency: "CNY"` to `UsageAnalysisModelPriceRule`.
- add optional `readonly currency?: "CNY"` to `UsageAnalysisModelPriceRuleInput` only if renderer saves it.
- add optional `readonly costCurrency?: "CNY"` to report rows if main process returns it.

Keep current `estimatedCost` and `costBreakdown` names.

- [ ] **Step 4: Update price dialog unit text**

In `desktop/src/modules/usage-analysis/shared/components/pricing-rules-dialog.tsx`, change:

```tsx
<DialogDescription>美元 / 1M token</DialogDescription>
```

to:

```tsx
<DialogDescription>人民币 / 1M token</DialogDescription>
```

- [ ] **Step 5: Use CNY formatter in report views**

In `desktop/src/modules/usage-analysis/shared/components/report-views.tsx`:

- import:

```ts
import { formatSynapseCost } from "@/lib/cost-currency"
```

- replace the local `formatCurrency` body with:

```ts
function formatCurrency(value: number): string {
  return formatSynapseCost(value)
}
```

In `desktop/src/modules/usage-analysis/shared/components/today-report-view.tsx` and `desktop/src/modules/usage-analysis/shared/today.ts`, make the same formatter replacement.

- [ ] **Step 6: Run UI tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- today report-views
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/types/bridge.ts desktop/src/modules/usage-analysis/shared/components/pricing-rules-dialog.tsx desktop/src/modules/usage-analysis/shared/components/report-views.tsx desktop/src/modules/usage-analysis/shared/components/today-report-view.tsx desktop/src/modules/usage-analysis/shared/today.ts desktop/src/modules/usage-analysis/__tests__/report-views.test.tsx desktop/src/modules/usage-analysis/__tests__/today.test.ts
git commit -m "feat: show usage costs in rmb"
```

## Task 5: Agent And Workflow RMB Cost Display

**Files:**
- Modify: `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`
- Modify: `desktop/electron/services/agent-runtime/types.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Modify: `desktop/electron/services/agent-runtime/session-repository.ts`
- Modify: `desktop/electron/modules/agent/ipc-shared.ts`
- Modify: `desktop/src/types/agent.ts`
- Modify: `desktop/src/lib/agent-timeline.ts`
- Modify: `desktop/src/components/token-usage-summary.tsx`
- Modify: `desktop/src/modules/workflow/runner/run-report.ts`
- Modify: `desktop/src/types/workflow.ts`
- Modify: `desktop/workflow-nodes/types.ts`
- Modify: `desktop/workflow-nodes/prompt/executor.main.ts`
- Modify: `desktop/workflow-nodes/switch/executor.main.ts`
- Modify: `desktop/action-packages/builtin/agent/executor.main.ts`
- Modify: `desktop/electron/services/workflow/workflow-engine.ts`
- Modify: `desktop/electron/modules/workflow/ipc.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts`
- Test: `desktop/src/modules/workflow/runner/__tests__/run-report.test.ts`
- Test: `desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx`

- [ ] **Step 1: Update SDK event bridge tests**

In `desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts`, update result expectations so a raw `total_cost_usd: 0.01` produces:

```ts
costUsd: 0.01,
costCny: 0.072,
costCurrency: "CNY",
```

Keep the `costUsd` assertion so legacy compatibility remains covered.

- [ ] **Step 2: Update workflow report tests**

In `desktop/src/modules/workflow/runner/__tests__/run-report.test.ts`, change USD expectations:

```ts
expect(report).toContain("- 总费用：¥0.07")
expect(report).toContain("- 费用：¥0.07")
expect(report).not.toContain("$0.01")
```

Use `toContain("¥0.07")` because `0.01 USD * 7.2 = 0.072 CNY` with two visible decimals.

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- sdk-event-bridge run-report node-result-panel
```

Expected: FAIL because CNY companion fields and display conversion are not implemented.

- [ ] **Step 4: Add CNY companion fields to agent types and schemas**

Add optional fields beside each existing `costUsd?: number`:

```ts
readonly costCny?: number
readonly costCurrency?: "CNY"
```

Apply this shape in:

- `desktop/electron/services/agent-runtime/types.ts`
- `desktop/src/types/agent.ts`
- `desktop/electron/modules/agent/ipc-shared.ts`

In zod schemas, add:

```ts
costCny: z.number().optional(),
costCurrency: z.literal("CNY").optional(),
```

- [ ] **Step 5: Capture CNY cost on new SDK result events**

In `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`:

- import:

```ts
import { SYNAPSE_COST_CURRENCY, usdToCny } from "../../../action-packages/shared/cost-currency"
```

- after reading `costUsd`, return:

```ts
const costUsd = numberValue(raw.total_cost_usd)
const costCny = costUsd === undefined ? undefined : usdToCny(costUsd)

return {
  type: "result",
  content: typeof raw.result === "string" ? raw.result : "",
  done: true,
  sdkSessionId,
  costUsd,
  costCny,
  costCurrency: costCny === undefined ? undefined : SYNAPSE_COST_CURRENCY,
  usage: recordValue(raw.usage),
  payload: sanitizeResultSuccessPayload(payload),
  ...envelope,
}
```

- [ ] **Step 6: Preserve CNY metadata through agent persistence**

In `desktop/electron/services/agent-runtime/conversation-router.ts`:

- include `costCny` and `costCurrency` in `resultHistoryMetadata`.
- add helper functions mirroring `resultCostFromEvent`.
- when saving usage through `session-repository`, pass CNY fields if the repository input type is updated.

In `desktop/electron/services/agent-runtime/session-repository.ts`:

- add optional `costCny` and `costCurrency` to save/update inputs.
- store them on conversation root and history metadata where existing `costUsd` is stored.

- [ ] **Step 7: Preserve CNY metadata through renderer timeline**

In `desktop/src/lib/agent-timeline.ts`:

- add `costCny: numberMetadata(metadata, "costCny")`.
- add `costCurrency: stringMetadata(metadata, "costCurrency") as "CNY" | undefined`.
- merge `event.metadata?.costCny ?? event.costCny` and `event.metadata?.costCurrency ?? event.costCurrency`.

- [ ] **Step 8: Add CNY cost fields to workflow result types and pass-throughs**

Add optional `costCny?: number` and `costCurrency?: "CNY"` to:

- `desktop/src/types/workflow.ts`
- `desktop/workflow-nodes/types.ts`
- `desktop/electron/modules/workflow/ipc.ts`

Pass the fields through in:

- `desktop/workflow-nodes/prompt/executor.main.ts`
- `desktop/workflow-nodes/switch/executor.main.ts`
- `desktop/action-packages/builtin/agent/executor.main.ts`
- `desktop/electron/services/workflow/workflow-engine.ts`

Where a result only has `costUsd`, compute `costCny` with `usdToCny(costUsd)`.

- [ ] **Step 9: Display CNY in token summaries and workflow reports**

In `desktop/src/components/token-usage-summary.tsx`:

- add props:

```ts
readonly costCny?: number
readonly costCurrency?: "CNY"
```

- resolve:

```ts
const normalizedCostCny = resolveSynapseCostCny({ costCny, costUsd })
```

- display:

```tsx
费用 {formatSynapseCost(normalizedCostCny)}
```

In `desktop/src/modules/workflow/runner/run-report.ts`:

- replace `normalizeCostUsd` usage with `resolveSynapseCostCny({ costCny: result.costCny, costUsd: result.costUsd })`.
- keep helper names stable if renaming would create a large diff, but make the formatted value CNY.

- [ ] **Step 10: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- sdk-event-bridge run-report node-result-panel
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add desktop/electron/services/agent-runtime/sdk-event-bridge.ts desktop/electron/services/agent-runtime/types.ts desktop/electron/services/agent-runtime/conversation-router.ts desktop/electron/services/agent-runtime/session-repository.ts desktop/electron/modules/agent/ipc-shared.ts desktop/src/types/agent.ts desktop/src/lib/agent-timeline.ts desktop/src/components/token-usage-summary.tsx desktop/src/modules/workflow/runner/run-report.ts desktop/src/types/workflow.ts desktop/workflow-nodes/types.ts desktop/workflow-nodes/prompt/executor.main.ts desktop/workflow-nodes/switch/executor.main.ts desktop/action-packages/builtin/agent/executor.main.ts desktop/electron/services/workflow/workflow-engine.ts desktop/electron/modules/workflow/ipc.ts desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts desktop/src/modules/workflow/runner/__tests__/run-report.test.ts desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx
git commit -m "feat: display agent workflow costs in rmb"
```

## Task 6: Release Notes And Final Validation

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add this bullet to `RELEASE_NOTES_PENDING.md`:

```markdown
- 用量分析的模型价格和费用统计改为人民币；升级后会按固定汇率把旧美元费用等价换算为人民币，后续调整价格规则不会静默改写历史费用。
```

- [ ] **Step 2: Run focused usage-analysis tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- usage-analysis
```

Expected: PASS.

- [ ] **Step 3: Run focused Agent and Workflow cost tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- sdk-event-bridge run-report node-result-panel
```

Expected: PASS.

- [ ] **Step 4: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Run typecheck if focused tests pass**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 6: Review diff for forbidden UI patterns**

Run:

```bash
rg -n "style=\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|gradient|shadow-.*border" desktop/src/modules/usage-analysis desktop/src/components/token-usage-summary.tsx
```

Expected: no new custom style, hardcoded color, arbitrary color, or decorative gradient usage introduced by this feature.

- [ ] **Step 7: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note rmb usage pricing"
```

## Self-Review

- Spec coverage:
  - RMB constants and formatting: Task 1.
  - CNY default rules and one-time migration: Task 2.
  - Stable historical usage costs and no silent repricing: Task 3.
  - Usage-analysis UI and bridge types: Task 4.
  - Agent and Workflow legacy cost display: Task 5.
  - Release notes and validation: Task 6.
- Placeholder scan:
  - The plan contains no unfinished markers or unspecified file paths.
- Type consistency:
  - New user-facing currency field is consistently `costCurrency: "CNY"`.
  - New CNY value field is consistently `costCny`.
  - Usage-analysis existing report value fields remain `estimatedCost` and `costBreakdown`.
