# Model Price First-Class Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Synapse model price management into a first-class `model-price` module with its own tables, UI, cost estimation service, and MCP-backed API surface.

**Architecture:** Add `desktop/electron/services/model-price/` as the single source for price defaults, rule persistence, rule matching, coverage aggregation, and cost estimation. Usage analysis, Agent runtime, Workflow, renderer UI, and MCP dispatchers become consumers of this service. The new module uses `model_price_rules` and `model_price_meta`; it does not migrate or read legacy `usage_model_prices`.

**Tech Stack:** Electron main process, `node:sqlite`, TypeScript, React, shadcn/Radix, Tailwind tokens, Vitest.

---

## File Structure

- Create `desktop/electron/services/model-price/types.ts`: shared main-process model price types and token breakdown shape.
- Create `desktop/electron/services/model-price/defaults.ts`: built-in CNY model price defaults moved from usage-analysis pricing.
- Create `desktop/electron/services/model-price/matching.ts`: normalization, wildcard/substring matching, cost rounding, cost estimation, rule hash.
- Create `desktop/electron/services/model-price/db-schema.ts`: `model_price_rules` and `model_price_meta` schema initialization and default seed marker.
- Create `desktop/electron/services/model-price/service.ts`: rule CRUD, reset, coverage aggregation, and estimation facade.
- Create `desktop/electron/services/model-price/index.ts`: public exports for consumers.
- Create `desktop/electron/services/model-price/__tests__/model-price-service.test.ts`: schema, defaults, matching, CRUD, reset, and legacy-table isolation tests.
- Create `desktop/electron/services/model-price/__tests__/coverage.test.ts`: CC/Codex model coverage aggregation tests.
- Modify `desktop/electron/services/usage-analysis/db-schema.ts`: call model-price schema initialization; stop migrating default usage price rules.
- Modify `desktop/electron/services/usage-analysis/cc-parser.ts`: import model-price estimation/types.
- Modify `desktop/electron/services/usage-analysis/codex-parser.ts`: import model-price estimation/types.
- Modify `desktop/electron/services/usage-analysis/cc-service.ts`: use `ModelPriceService` for price rules/hash and remove rule-edit methods from usage-analysis.
- Modify `desktop/electron/services/usage-analysis/usage-cost-snapshot.ts`: move or re-export through model-price so Agent/Workflow do not depend on usage-analysis pricing.
- Modify `desktop/electron/services/agent-runtime/index.ts` and `desktop/electron/services/agent-runtime/conversation-router.ts`: inject model-price estimation instead of usage-analysis rules.
- Inspect `desktop/electron/services/workflow/workflow-engine.ts`: keep stored snapshot behavior and verify it has no direct usage-analysis pricing import.
- Create `desktop/electron/model-price/channels.ts`: first-class IPC channel constants.
- Create `desktop/electron/model-price/ipc-handlers.ts`: input normalization and validated handlers for rules and coverage.
- Modify `desktop/electron/preload.ts`: expose `window.synapse.modelPrice`.
- Modify `desktop/src/types/bridge.ts`: add renderer bridge types for `modelPrice`.
- Modify `desktop/electron/capabilities/model-price-dispatcher.ts`: depend on `ModelPriceService` instead of usage-analysis pricing functions.
- Modify `desktop/electron/bootstrap/descriptors.ts`: construct and register `ModelPriceService`, wire IPC/MCP dependencies.
- Inspect `desktop/synapse-capabilities/shared/model-price-domain.ts`: keep tool names and action ids unchanged.
- Create `desktop/src/modules/model-price/types.ts`: renderer model-price types.
- Create `desktop/src/modules/model-price/hooks.ts`: `useModelPriceCoverage` and `useModelPriceRules`.
- Create `desktop/src/modules/model-price/components/model-coverage-view.tsx`: default coverage table view.
- Create `desktop/src/modules/model-price/components/price-rules-view.tsx`: rule editor view moved from pricing dialog.
- Create `desktop/src/modules/model-price/index.tsx`: top-level module with `模型覆盖` and `价格规则` tabs.
- Modify `desktop/config.ts`: add `{ id: "model-price", label: "价格" }` after `usage-codex`.
- Modify `desktop/src/App.tsx`: render `ModelPriceModule`.
- Modify `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`: remove pricing action prop and button.
- Modify `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`: remove pricing dialog state and import.
- Modify `desktop/src/modules/usage-analysis/codex/codex-usage-page.tsx`: remove pricing dialog state and import.
- Move or delete `desktop/src/modules/usage-analysis/shared/components/pricing-rules-dialog.tsx`: rule editing belongs in model-price module.
- Update tests under `desktop/electron/**/__tests__`, `desktop/src/**/__tests__`, and `desktop/tests/unit/**` that reference old price APIs.
- Modify `RELEASE_NOTES_PENDING.md`: add a user-facing note.

---

### Task 1: Model Price Tables, Defaults, Matching, And Rule CRUD

**Files:**
- Create: `desktop/electron/services/model-price/types.ts`
- Create: `desktop/electron/services/model-price/defaults.ts`
- Create: `desktop/electron/services/model-price/matching.ts`
- Create: `desktop/electron/services/model-price/db-schema.ts`
- Create: `desktop/electron/services/model-price/service.ts`
- Create: `desktop/electron/services/model-price/index.ts`
- Create: `desktop/electron/services/model-price/__tests__/model-price-service.test.ts`
- Modify: `desktop/electron/services/usage-analysis/db-schema.ts`

- [ ] **Step 1: Write failing model-price service tests**

Create `desktop/electron/services/model-price/__tests__/model-price-service.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { initModelPriceSchema, ModelPriceService } from "../service"
import { DEFAULT_MODEL_PRICE_RULES } from "../defaults"

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  initModelPriceSchema(db)
  return db
}

describe("model price service", () => {
  it("initializes the new model price tables from built-in defaults", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    const rules = service.listRules()

    expect(rules).toHaveLength(DEFAULT_MODEL_PRICE_RULES.length)
    expect(rules.find((rule) => rule.modelPattern === "claude-sonnet-4")).toMatchObject({
      inputPer1M: 21.6,
      outputPer1M: 108,
      cacheReadPer1M: 2.16,
      cacheWritePer1M: 27,
      reasoningPer1M: 108,
      currency: "CNY",
      source: "builtin",
    })
    expect(db.prepare("SELECT value FROM model_price_meta WHERE key = ?").get("initialized_from_defaults_v1")).toBeTruthy()
    db.close()
  })

  it("does not read or migrate legacy usage_model_prices rows", () => {
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
        currency TEXT NOT NULL DEFAULT 'CNY',
        enabled INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'user',
        sort_index INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT ''
      )
    `)
    db.prepare(`
      INSERT INTO usage_model_prices (
        id, model_pattern, input_per_1m, output_per_1m, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run("legacy-custom", "legacy-only-model", 999, 999, "2026-06-09T00:00:00.000Z")

    initModelPriceSchema(db)
    const service = new ModelPriceService(db)

    expect(service.listRules().some((rule) => rule.modelPattern === "legacy-only-model")).toBe(false)
    expect(service.findRuleForModel("legacy-only-model")).toBeNull()
    db.close()
  })

  it("matches wildcard and substring rules and estimates CNY cost", () => {
    const db = createDb()
    const service = new ModelPriceService(db)
    service.saveRules([
      { modelPattern: "local-*", inputPer1M: 10, outputPer1M: 20, cacheReadPer1M: 1, cacheWritePer1M: 2, reasoningPer1M: 30 },
      { modelPattern: "substring-model", inputPer1M: 4, outputPer1M: 8, reasoningPer1M: 8 },
    ])

    expect(service.findRuleForModel("local-alpha")).toMatchObject({ modelPattern: "local-*" })
    expect(service.findRuleForModel("vendor-substring-model-v2")).toMatchObject({ modelPattern: "substring-model" })
    expect(service.estimateUsageCost("local-alpha", {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
      reasoning: 1_000_000,
    })).toMatchObject({
      input: 10,
      output: 20,
      cacheRead: 1,
      cacheWrite: 2,
      reasoning: 30,
      total: 63,
      priceKnown: true,
      currency: "CNY",
    })
    db.close()
  })

  it("creates updates disables enables deletes and resets rules in model_price_rules", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    const created = service.createRule({ modelPattern: "local-model", inputPer1M: 14.4 })
    expect(created).toMatchObject({ modelPattern: "local-model", inputPer1M: 14.4, outputPer1M: 0, enabled: true })

    const updated = service.updateRule(created.id, { outputPer1M: 57.6 })
    expect(updated).toMatchObject({ id: created.id, inputPer1M: 14.4, outputPer1M: 57.6 })

    expect(service.setRuleEnabled(created.id, false)).toMatchObject({ id: created.id, enabled: false })
    expect(service.setRuleEnabled(created.id, true)).toMatchObject({ id: created.id, enabled: true })
    expect(service.deleteRule(created.id)).toEqual({ deleted: true, ruleId: created.id })
    expect(service.listRules().some((rule) => rule.id === created.id)).toBe(false)

    service.createRule({ modelPattern: "custom-only", inputPer1M: 1 })
    expect(service.resetRulesToDefaults()).toEqual(DEFAULT_MODEL_PRICE_RULES)
    expect(service.listRules().some((rule) => rule.modelPattern === "custom-only")).toBe(false)
    db.close()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/model-price/__tests__/model-price-service.test.ts
```

Expected: FAIL because `desktop/electron/services/model-price/*` does not exist.

- [ ] **Step 3: Create model-price types and defaults**

Create `desktop/electron/services/model-price/types.ts`:

```ts
import type { SynapseCostCurrency } from "../../../action-packages/shared/cost-currency"

export interface ModelPriceRuleInput {
  readonly id?: string
  readonly modelPattern: string
  readonly inputPer1M?: number
  readonly outputPer1M?: number
  readonly cacheReadPer1M?: number
  readonly cacheWritePer1M?: number
  readonly reasoningPer1M?: number
  readonly currency?: SynapseCostCurrency
  readonly enabled?: boolean
  readonly source?: "builtin" | "user"
  readonly sortIndex?: number
  readonly updatedAt?: string
}

export interface ModelPriceRule {
  readonly id: string
  readonly modelPattern: string
  readonly inputPer1M: number
  readonly outputPer1M: number
  readonly cacheReadPer1M: number
  readonly cacheWritePer1M: number
  readonly reasoningPer1M: number
  readonly currency: SynapseCostCurrency
  readonly enabled: boolean
  readonly source: "builtin" | "user"
  readonly sortIndex: number
  readonly updatedAt: string
}

export interface ModelUsageTokenBreakdown {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export interface EstimatedModelUsageCost {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly total: number
  readonly priceKnown: boolean
  readonly currency: SynapseCostCurrency
  readonly matchedRuleId?: string
  readonly matchedRulePattern?: string
}

export interface ModelPriceRulePatch {
  readonly modelPattern?: string
  readonly inputPer1M?: number
  readonly outputPer1M?: number
  readonly cacheReadPer1M?: number
  readonly cacheWritePer1M?: number
  readonly reasoningPer1M?: number
  readonly enabled?: boolean
}

export interface ModelPriceRuleDeleteResult {
  readonly deleted: true
  readonly ruleId: string
}
```

Create `desktop/electron/services/model-price/defaults.ts` by moving `DEFAULT_USAGE_PRICE_RULE_INPUTS` from `desktop/electron/services/usage-analysis/pricing.ts` and renaming exports:

```ts
import { normalizeModelPriceRules } from "./matching"
import type { ModelPriceRuleInput } from "./types"

const DEFAULT_MODEL_PRICE_RULE_INPUTS: readonly ModelPriceRuleInput[] = [
  { id: "gpt-5-5", modelPattern: "gpt-5.5", inputPer1M: 36, outputPer1M: 216, cacheReadPer1M: 3.6, reasoningPer1M: 216, source: "builtin" },
  { id: "gpt-5-4", modelPattern: "gpt-5.4", inputPer1M: 18, outputPer1M: 108, cacheReadPer1M: 1.8, reasoningPer1M: 108, source: "builtin" },
  { id: "gpt-5-3-codex", modelPattern: "gpt-5.3-codex", inputPer1M: 9, outputPer1M: 72, cacheReadPer1M: 0.9, reasoningPer1M: 72, source: "builtin" },
  { id: "gpt-5-codex", modelPattern: "gpt-5-codex", inputPer1M: 9, outputPer1M: 72, cacheReadPer1M: 0.9, reasoningPer1M: 72, source: "builtin" },
  { id: "claude-opus-4-7", modelPattern: "claude-opus-4.7", inputPer1M: 36, outputPer1M: 180, cacheReadPer1M: 3.6, cacheWritePer1M: 45, reasoningPer1M: 180, source: "builtin" },
  { id: "claude-opus-4-7-hyphen", modelPattern: "claude-opus-4-7", inputPer1M: 36, outputPer1M: 180, cacheReadPer1M: 3.6, cacheWritePer1M: 45, reasoningPer1M: 180, source: "builtin" },
  { id: "claude-opus-4-6", modelPattern: "claude-opus-4.6", inputPer1M: 36, outputPer1M: 180, cacheReadPer1M: 3.6, cacheWritePer1M: 45, reasoningPer1M: 180, source: "builtin" },
  { id: "claude-opus-4-6-hyphen", modelPattern: "claude-opus-4-6", inputPer1M: 36, outputPer1M: 180, cacheReadPer1M: 3.6, cacheWritePer1M: 45, reasoningPer1M: 180, source: "builtin" },
  { id: "claude-opus-4", modelPattern: "claude-opus-4", inputPer1M: 108, outputPer1M: 540, cacheReadPer1M: 10.8, cacheWritePer1M: 135, reasoningPer1M: 540, source: "builtin" },
  { id: "claude-sonnet-4-6", modelPattern: "claude-sonnet-4.6", inputPer1M: 21.6, outputPer1M: 108, cacheReadPer1M: 2.16, cacheWritePer1M: 27, reasoningPer1M: 108, source: "builtin" },
  { id: "claude-sonnet-4", modelPattern: "claude-sonnet-4", inputPer1M: 21.6, outputPer1M: 108, cacheReadPer1M: 2.16, cacheWritePer1M: 27, reasoningPer1M: 108, source: "builtin" },
  { id: "claude-haiku-4-5", modelPattern: "claude-haiku-4.5", inputPer1M: 7.2, outputPer1M: 36, cacheReadPer1M: 0.72, cacheWritePer1M: 9, reasoningPer1M: 36, source: "builtin" },
  { id: "claude-haiku-4", modelPattern: "claude-haiku-4", inputPer1M: 7.2, outputPer1M: 36, cacheReadPer1M: 0.72, cacheWritePer1M: 9, reasoningPer1M: 36, source: "builtin" },
  { id: "deepseek-v4-pro", modelPattern: "deepseek-v4-pro", inputPer1M: 3.132, outputPer1M: 6.264, cacheReadPer1M: 0.0261, reasoningPer1M: 6.264, source: "builtin" },
  { id: "deepseek-v4-flash", modelPattern: "deepseek-v4-flash", inputPer1M: 1.008, outputPer1M: 2.016, cacheReadPer1M: 0.02016, reasoningPer1M: 2.016, source: "builtin" },
  { id: "kimi-k2-5", modelPattern: "kimi-k2.5", inputPer1M: 4.32, outputPer1M: 21.6, cacheReadPer1M: 0.72, reasoningPer1M: 21.6, source: "builtin" },
  { id: "kimi-k2-6", modelPattern: "kimi-k2.6", inputPer1M: 6.84, outputPer1M: 28.8, cacheReadPer1M: 1.152, reasoningPer1M: 28.8, source: "builtin" },
  { id: "glm-5-1", modelPattern: "glm-5.1", inputPer1M: 8, outputPer1M: 28, cacheReadPer1M: 8, reasoningPer1M: 28, source: "builtin" },
  { id: "minimax-m2-5", modelPattern: "MiniMax-M2.5", inputPer1M: 2.16, outputPer1M: 8.64, cacheReadPer1M: 0.216, cacheWritePer1M: 2.7, reasoningPer1M: 8.64, source: "builtin" },
]

export const DEFAULT_MODEL_PRICE_RULES = normalizeModelPriceRules(DEFAULT_MODEL_PRICE_RULE_INPUTS)
```

- [ ] **Step 4: Create matching helpers**

Create `desktop/electron/services/model-price/matching.ts`:

```ts
import { createHash } from "node:crypto"
import { SYNAPSE_COST_CURRENCY } from "../../../action-packages/shared/cost-currency"
import type { EstimatedModelUsageCost, ModelPriceRule, ModelPriceRuleInput, ModelUsageTokenBreakdown } from "./types"

const COST_FRACTION_DIGITS = 6

export function roundModelUsageCost(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Number(value.toFixed(COST_FRACTION_DIGITS))
}

export function normalizeModelPriceRules(inputs: readonly ModelPriceRuleInput[]): ModelPriceRule[] {
  const usedIds = new Set<string>()
  const now = new Date().toISOString()
  return inputs
    .map((input, index) => {
      const modelPattern = input.modelPattern.trim()
      if (!modelPattern) return null
      return {
        id: makeRuleId(input, index, usedIds),
        modelPattern,
        inputPer1M: normalizePrice(input.inputPer1M),
        outputPer1M: normalizePrice(input.outputPer1M),
        cacheReadPer1M: normalizePrice(input.cacheReadPer1M),
        cacheWritePer1M: normalizePrice(input.cacheWritePer1M),
        reasoningPer1M: normalizePrice(input.reasoningPer1M),
        currency: input.currency ?? SYNAPSE_COST_CURRENCY,
        enabled: input.enabled ?? true,
        source: input.source === "builtin" ? "builtin" : "user",
        sortIndex: Number.isFinite(Number(input.sortIndex)) ? Number(input.sortIndex) : index,
        updatedAt: input.updatedAt || now,
      } satisfies ModelPriceRule
    })
    .filter((rule): rule is ModelPriceRule => rule !== null)
    .sort(compareModelPriceRules)
}

export function compareModelPriceRules(a: ModelPriceRule, b: ModelPriceRule): number {
  return a.sortIndex - b.sortIndex || b.modelPattern.length - a.modelPattern.length || a.modelPattern.localeCompare(b.modelPattern)
}

export function findModelPriceRuleForModel(model: string, rules: readonly ModelPriceRule[]): ModelPriceRule | null {
  return rules.filter((rule) => rule.enabled).find((rule) => matchesModelPattern(model, rule.modelPattern)) ?? null
}

export function estimateModelUsageCost(
  model: string,
  tokens: ModelUsageTokenBreakdown,
  rules: readonly ModelPriceRule[],
): EstimatedModelUsageCost {
  const rule = findModelPriceRuleForModel(model, rules)
  if (!rule) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, priceKnown: false, currency: SYNAPSE_COST_CURRENCY }
  }
  const input = cost(tokens.input, rule.inputPer1M)
  const output = cost(tokens.output, rule.outputPer1M)
  const cacheRead = cost(tokens.cacheRead, rule.cacheReadPer1M)
  const cacheWrite = cost(tokens.cacheWrite, rule.cacheWritePer1M)
  const reasoning = cost(tokens.reasoning, rule.reasoningPer1M)
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total: roundModelUsageCost(input + output + cacheRead + cacheWrite + reasoning),
    priceKnown: true,
    currency: SYNAPSE_COST_CURRENCY,
    matchedRuleId: rule.id,
    matchedRulePattern: rule.modelPattern,
  }
}

export function hashModelPriceRules(rules: readonly ModelPriceRule[]): string {
  return createHash("sha256")
    .update(JSON.stringify(rules.map((rule) => ({
      id: rule.id,
      modelPattern: rule.modelPattern,
      inputPer1M: rule.inputPer1M,
      outputPer1M: rule.outputPer1M,
      cacheReadPer1M: rule.cacheReadPer1M,
      cacheWritePer1M: rule.cacheWritePer1M,
      reasoningPer1M: rule.reasoningPer1M,
      currency: rule.currency,
      enabled: rule.enabled,
      sortIndex: rule.sortIndex,
    }))))
    .digest("hex")
}

function cost(tokens: number, per1M: number): number {
  if (per1M <= 0 || tokens <= 0) return 0
  return roundModelUsageCost((tokens / 1_000_000) * per1M)
}

function normalizePrice(value: unknown): number {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : 0
}

function normalizeRuleId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized || "price-rule"
}

function makeRuleId(input: ModelPriceRuleInput, index: number, usedIds: Set<string>): string {
  const base = normalizeRuleId(input.id || input.modelPattern || `price-rule-${index + 1}`)
  let id = base
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  usedIds.add(id)
  return id
}

function wildcardPatternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`, "i")
}

function matchesModelPattern(model: string, pattern: string): boolean {
  const normalizedModel = model.trim().toLowerCase()
  const normalizedPattern = pattern.trim().toLowerCase()
  if (!normalizedModel || !normalizedPattern) return false
  if (normalizedPattern.includes("*")) return wildcardPatternToRegex(normalizedPattern).test(normalizedModel)
  return normalizedModel.includes(normalizedPattern)
}
```

- [ ] **Step 5: Create schema and service implementation**

Create `desktop/electron/services/model-price/db-schema.ts`:

```ts
import type { DatabaseSync } from "node:sqlite"
import { DEFAULT_MODEL_PRICE_RULES } from "./defaults"
import type { ModelPriceRule } from "./types"

export const MODEL_PRICE_DEFAULTS_META_KEY = "initialized_from_defaults_v1"

export function initModelPriceSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS model_price_rules (
      id TEXT PRIMARY KEY,
      model_pattern TEXT NOT NULL,
      input_per_1m REAL NOT NULL DEFAULT 0,
      output_per_1m REAL NOT NULL DEFAULT 0,
      cache_read_per_1m REAL NOT NULL DEFAULT 0,
      cache_write_per_1m REAL NOT NULL DEFAULT 0,
      reasoning_per_1m REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'builtin',
      sort_index INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS model_price_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  seedModelPriceDefaults(database)
}

function seedModelPriceDefaults(database: DatabaseSync): void {
  const meta = database.prepare("SELECT value FROM model_price_meta WHERE key = ?").get(MODEL_PRICE_DEFAULTS_META_KEY) as { value?: string } | undefined
  if (meta?.value) return
  let transactionStarted = false
  database.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    database.exec("DELETE FROM model_price_rules")
    insertSeedRules(database, DEFAULT_MODEL_PRICE_RULES)
    database.prepare(`
      INSERT OR REPLACE INTO model_price_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(MODEL_PRICE_DEFAULTS_META_KEY, "1", new Date().toISOString())
    database.exec("COMMIT")
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK")
    throw error
  }
}

function insertSeedRules(database: DatabaseSync, rules: readonly ModelPriceRule[]): void {
  const insert = database.prepare(`
    INSERT INTO model_price_rules (
      id, model_pattern, input_per_1m, output_per_1m, cache_read_per_1m,
      cache_write_per_1m, reasoning_per_1m, currency, enabled, source, sort_index, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const rule of rules) {
    insert.run(
      rule.id,
      rule.modelPattern,
      rule.inputPer1M,
      rule.outputPer1M,
      rule.cacheReadPer1M,
      rule.cacheWritePer1M,
      rule.reasoningPer1M,
      rule.currency,
      rule.enabled ? 1 : 0,
      rule.source,
      rule.sortIndex,
      rule.updatedAt,
    )
  }
}
```

Create `desktop/electron/services/model-price/service.ts` with:

```ts
import type { DatabaseSync } from "node:sqlite"
import { DEFAULT_MODEL_PRICE_RULES } from "./defaults"
import { initModelPriceSchema } from "./db-schema"
import {
  compareModelPriceRules,
  estimateModelUsageCost,
  findModelPriceRuleForModel,
  normalizeModelPriceRules,
} from "./matching"
import type {
  EstimatedModelUsageCost,
  ModelPriceRule,
  ModelPriceRuleDeleteResult,
  ModelPriceRuleInput,
  ModelPriceRulePatch,
  ModelUsageTokenBreakdown,
} from "./types"

interface ModelPriceRuleRow {
  readonly id: string
  readonly model_pattern: string
  readonly input_per_1m: number
  readonly output_per_1m: number
  readonly cache_read_per_1m: number
  readonly cache_write_per_1m: number
  readonly reasoning_per_1m: number
  readonly currency: string
  readonly enabled: number
  readonly source: string
  readonly sort_index: number
  readonly updated_at: string
}

export { initModelPriceSchema }

export class ModelPriceService {
  constructor(private readonly db: DatabaseSync) {}

  listRules(): ModelPriceRule[] {
    return listModelPriceRules(this.db)
  }

  saveRules(inputs: readonly ModelPriceRuleInput[]): ModelPriceRule[] {
    const now = new Date().toISOString()
    const rules = normalizeModelPriceRules(inputs.map((rule, index) => ({
      ...rule,
      source: rule.source ?? "user",
      sortIndex: index,
      updatedAt: now,
    })))
    replaceModelPriceRules(this.db, rules)
    return rules
  }

  resetRulesToDefaults(): ModelPriceRule[] {
    replaceModelPriceRules(this.db, DEFAULT_MODEL_PRICE_RULES)
    return this.listRules()
  }

  getRule(ruleId: string): ModelPriceRule | null {
    return this.listRules().find((rule) => rule.id === ruleId) ?? null
  }

  createRule(input: ModelPriceRuleInput): ModelPriceRule {
    const existing = this.listRules()
    const now = new Date().toISOString()
    const rules = normalizeModelPriceRules([
      ...existing,
      { ...input, source: input.source ?? "user", sortIndex: existing.length, updatedAt: now },
    ])
    replaceModelPriceRules(this.db, rules)
    return rules.find((rule) => rule.updatedAt === now && rule.modelPattern === input.modelPattern.trim()) ?? rules[rules.length - 1]
  }

  updateRule(ruleId: string, patch: ModelPriceRulePatch): ModelPriceRule {
    const existing = this.listRules()
    if (!existing.some((rule) => rule.id === ruleId)) throw new Error(`Model price rule not found: ${ruleId}`)
    const now = new Date().toISOString()
    const rules = normalizeModelPriceRules(existing.map((rule) => (
      rule.id === ruleId ? { ...rule, ...patch, id: rule.id, updatedAt: now } : rule
    )))
    replaceModelPriceRules(this.db, rules)
    const updated = rules.find((rule) => rule.id === ruleId)
    if (!updated) throw new Error(`Model price rule not found after update: ${ruleId}`)
    return updated
  }

  setRuleEnabled(ruleId: string, enabled: boolean): ModelPriceRule {
    return this.updateRule(ruleId, { enabled })
  }

  deleteRule(ruleId: string): ModelPriceRuleDeleteResult {
    const existing = this.listRules()
    if (!existing.some((rule) => rule.id === ruleId)) throw new Error(`Model price rule not found: ${ruleId}`)
    replaceModelPriceRules(this.db, normalizeModelPriceRules(existing.filter((rule) => rule.id !== ruleId)))
    return { deleted: true, ruleId }
  }

  findRuleForModel(model: string): ModelPriceRule | null {
    return findModelPriceRuleForModel(model, this.listRules())
  }

  estimateUsageCost(model: string, tokens: ModelUsageTokenBreakdown): EstimatedModelUsageCost {
    return estimateModelUsageCost(model, tokens, this.listRules())
  }
}

export function listModelPriceRules(database: DatabaseSync): ModelPriceRule[] {
  const rows = database.prepare(`
    SELECT id, model_pattern, input_per_1m, output_per_1m, cache_read_per_1m,
      cache_write_per_1m, reasoning_per_1m, currency, enabled, source, sort_index, updated_at
    FROM model_price_rules
    ORDER BY sort_index ASC, LENGTH(model_pattern) DESC, model_pattern ASC
  `).all() as unknown as ModelPriceRuleRow[]
  return rows.map((row) => ({
    id: row.id,
    modelPattern: row.model_pattern,
    inputPer1M: normalizePrice(row.input_per_1m),
    outputPer1M: normalizePrice(row.output_per_1m),
    cacheReadPer1M: normalizePrice(row.cache_read_per_1m),
    cacheWritePer1M: normalizePrice(row.cache_write_per_1m),
    reasoningPer1M: normalizePrice(row.reasoning_per_1m),
    currency: "CNY",
    enabled: row.enabled === 1,
    source: row.source === "builtin" ? "builtin" : "user",
    sortIndex: Number(row.sort_index),
    updatedAt: row.updated_at,
  })).sort(compareModelPriceRules)
}

export function replaceModelPriceRules(database: DatabaseSync, rules: readonly ModelPriceRule[]): void {
  let transactionStarted = false
  database.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    database.exec("DELETE FROM model_price_rules")
    insertModelPriceRules(database, rules)
    database.exec("COMMIT")
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK")
    throw error
  }
}

export function insertModelPriceRules(database: DatabaseSync, rules: readonly ModelPriceRule[]): void {
  const insert = database.prepare(`
    INSERT INTO model_price_rules (
      id, model_pattern, input_per_1m, output_per_1m, cache_read_per_1m,
      cache_write_per_1m, reasoning_per_1m, currency, enabled, source, sort_index, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const rule of rules) {
    insert.run(
      rule.id,
      rule.modelPattern,
      rule.inputPer1M,
      rule.outputPer1M,
      rule.cacheReadPer1M,
      rule.cacheWritePer1M,
      rule.reasoningPer1M,
      rule.currency,
      rule.enabled ? 1 : 0,
      rule.source,
      rule.sortIndex,
      rule.updatedAt,
    )
  }
}

function normalizePrice(value: unknown): number {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : 0
}
```

Create `desktop/electron/services/model-price/index.ts`:

```ts
export { DEFAULT_MODEL_PRICE_RULES } from "./defaults"
export { initModelPriceSchema, ModelPriceService, listModelPriceRules } from "./service"
export {
  estimateModelUsageCost,
  findModelPriceRuleForModel,
  hashModelPriceRules,
  normalizeModelPriceRules,
  roundModelUsageCost,
} from "./matching"
export type {
  EstimatedModelUsageCost,
  ModelPriceRule,
  ModelPriceRuleDeleteResult,
  ModelPriceRuleInput,
  ModelPriceRulePatch,
  ModelUsageTokenBreakdown,
} from "./types"
```

- [ ] **Step 6: Initialize model-price schema from usage-analysis database setup**

Modify `desktop/electron/services/usage-analysis/db-schema.ts`:

```ts
import type { DatabaseSync } from "node:sqlite"
import { migrateUsageAnalysisCostsToCny } from "./currency-migration"
import { initModelPriceSchema } from "../model-price"
```

At the end of `initUsageAnalysisSchema`, replace:

```ts
migrateUsageAnalysisCostsToCny(database)
migrateDefaultUsagePriceRules(database)
```

with:

```ts
migrateUsageAnalysisCostsToCny(database)
initModelPriceSchema(database)
```

Keep legacy table creation for now if older code still expects it during the transition, but do not seed or migrate it.

- [ ] **Step 7: Run model-price service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/model-price/__tests__/model-price-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add desktop/electron/services/model-price desktop/electron/services/usage-analysis/db-schema.ts
git commit -m "feat: add model price service"
```

---

### Task 2: Model Coverage Aggregation

**Files:**
- Modify: `desktop/electron/services/model-price/types.ts`
- Modify: `desktop/electron/services/model-price/service.ts`
- Create: `desktop/electron/services/model-price/coverage.ts`
- Create: `desktop/electron/services/model-price/__tests__/coverage.test.ts`

- [ ] **Step 1: Write failing coverage tests**

Create `desktop/electron/services/model-price/__tests__/coverage.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { initUsageAnalysisSchema } from "../../usage-analysis/db-schema"
import { ModelPriceService } from "../service"

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  initUsageAnalysisSchema(db)
  return db
}

function insertUsageEvent(db: DatabaseSync, prefix: "cc" | "cx", input: {
  id: string
  model: string
  inputTokens: number
  outputTokens?: number
  priceKnown?: boolean
  totalCost?: number
  timestamp?: string
}): void {
  const timestamp = input.timestamp ?? "2026-06-09T01:00:00.000Z"
  const timestampMs = new Date(timestamp).getTime()
  const date = timestamp.slice(0, 10)
  const hour = `${date} ${timestamp.slice(11, 13)}`
  const outputTokens = input.outputTokens ?? 0
  const tokens = input.inputTokens + outputTokens
  db.prepare(`
    INSERT INTO ${prefix}_usage_events (
      id, session_id, timestamp_ms, date, hour, model, input_tokens, output_tokens,
      priced_tokens, unpriced_tokens, total_cost, price_known, cost_currency
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    `${prefix}-session-${input.id}`,
    timestampMs,
    date,
    hour,
    input.model,
    input.inputTokens,
    outputTokens,
    input.priceKnown === true ? tokens : 0,
    input.priceKnown === true ? 0 : tokens,
    input.totalCost ?? 0,
    input.priceKnown === true ? 1 : 0,
    "CNY",
  )
}

describe("model price coverage", () => {
  it("merges used CC and Codex models and reports current rule matches", () => {
    const db = createDb()
    const service = new ModelPriceService(db)
    service.saveRules([{ id: "local", modelPattern: "local-model", inputPer1M: 1 }])
    insertUsageEvent(db, "cc", { id: "cc-1", model: "local-model", inputTokens: 100, priceKnown: true, totalCost: 0.001 })
    insertUsageEvent(db, "cx", { id: "cx-1", model: "local-model", inputTokens: 50, priceKnown: false })
    insertUsageEvent(db, "cx", { id: "cx-2", model: "other-model", inputTokens: 25, priceKnown: false })

    expect(service.listCoverage({ source: "all", range: "all" })).toEqual([
      expect.objectContaining({
        model: "local-model",
        sources: ["cc", "codex"],
        tokens: 150,
        requests: 2,
        pricedTokens: 100,
        unpricedTokens: 50,
        priceKnown: true,
        matchedRuleId: "local",
        matchedRulePattern: "local-model",
      }),
      expect.objectContaining({
        model: "other-model",
        sources: ["codex"],
        tokens: 25,
        requests: 1,
        priceKnown: false,
      }),
    ])
    db.close()
  })

  it("filters coverage by source and range without refreshing usage logs", () => {
    const db = createDb()
    const service = new ModelPriceService(db)
    insertUsageEvent(db, "cc", { id: "old", model: "old-model", inputTokens: 1, timestamp: "2026-01-01T00:00:00.000Z" })
    insertUsageEvent(db, "cx", { id: "today", model: "today-model", inputTokens: 2, timestamp: "2026-06-09T01:00:00.000Z" })

    expect(service.listCoverage({ source: "codex", range: "today" })).toEqual([
      expect.objectContaining({ model: "today-model", sources: ["codex"], tokens: 2 }),
    ])
    db.close()
  })
})
```

- [ ] **Step 2: Run coverage tests to verify they fail**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/model-price/__tests__/coverage.test.ts
```

Expected: FAIL because `ModelPriceService.listCoverage` is not implemented.

- [ ] **Step 3: Add coverage types**

Append to `desktop/electron/services/model-price/types.ts`:

```ts
export type ModelPriceCoverageSource = "all" | "cc" | "codex"
export type ModelPriceCoverageRange = "today" | "7d" | "30d" | "90d" | "all"
export type ModelPriceUsageSourceName = "cc" | "codex"

export interface ModelPriceCoverageInput {
  readonly source?: ModelPriceCoverageSource
  readonly range?: ModelPriceCoverageRange
  readonly limit?: number
}

export interface ModelPriceCoverageRow {
  readonly model: string
  readonly sources: ModelPriceUsageSourceName[]
  readonly tokens: number
  readonly requests: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly priceKnown: boolean
  readonly matchedRuleId?: string
  readonly matchedRulePattern?: string
}
```

- [ ] **Step 4: Implement coverage aggregation**

Create `desktop/electron/services/model-price/coverage.ts`:

```ts
import type { DatabaseSync } from "node:sqlite"
import { createUsageRangeFilter } from "../usage-analysis/range"
import { findModelPriceRuleForModel } from "./matching"
import type {
  ModelPriceCoverageInput,
  ModelPriceCoverageRange,
  ModelPriceCoverageRow,
  ModelPriceCoverageSource,
  ModelPriceRule,
  ModelPriceUsageSourceName,
} from "./types"

type UsagePrefix = "cc" | "cx"

type UsedModelAccumulator = Omit<ModelPriceCoverageRow, "sources" | "priceKnown" | "matchedRuleId" | "matchedRulePattern"> & {
  readonly sources: Set<ModelPriceUsageSourceName>
}

const RANGE_PRESETS: readonly ModelPriceCoverageRange[] = ["today", "7d", "30d", "90d", "all"]

export function listModelPriceCoverage(
  db: DatabaseSync,
  rules: readonly ModelPriceRule[],
  input: ModelPriceCoverageInput = {},
): ModelPriceCoverageRow[] {
  const source = normalizeSource(input.source)
  const range = normalizeRange(input.range)
  const limit = normalizeLimit(input.limit)
  const byModel = new Map<string, UsedModelAccumulator>()

  for (const item of selectedSources(source)) {
    for (const row of queryUsedModels(db, item.prefix, range)) {
      const current = byModel.get(row.model) ?? {
        model: row.model,
        sources: new Set<ModelPriceUsageSourceName>(),
        tokens: 0,
        requests: 0,
        pricedTokens: 0,
        unpricedTokens: 0,
        estimatedCost: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
      }
      current.sources.add(item.name)
      byModel.set(row.model, {
        ...current,
        tokens: current.tokens + row.tokens,
        requests: current.requests + row.requests,
        pricedTokens: current.pricedTokens + row.pricedTokens,
        unpricedTokens: current.unpricedTokens + row.unpricedTokens,
        estimatedCost: current.estimatedCost + row.estimatedCost,
        input: current.input + row.input,
        output: current.output + row.output,
        cacheRead: current.cacheRead + row.cacheRead,
        cacheWrite: current.cacheWrite + row.cacheWrite,
        reasoning: current.reasoning + row.reasoning,
      })
    }
  }

  return [...byModel.values()]
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
    .slice(0, limit)
    .map((row) => {
      const matchedRule = findModelPriceRuleForModel(row.model, rules)
      return {
        ...row,
        sources: [...row.sources].sort() as ModelPriceUsageSourceName[],
        priceKnown: matchedRule !== null,
        ...(matchedRule ? { matchedRuleId: matchedRule.id, matchedRulePattern: matchedRule.modelPattern } : {}),
      }
    })
}

function normalizeSource(value: unknown): ModelPriceCoverageSource {
  if (value === undefined) return "all"
  if (value === "all" || value === "cc" || value === "codex") return value
  throw new Error("Invalid 'source': expected all, cc, or codex")
}

function normalizeRange(value: unknown): ModelPriceCoverageRange {
  if (value === undefined) return "all"
  if (typeof value === "string" && RANGE_PRESETS.includes(value as ModelPriceCoverageRange)) return value as ModelPriceCoverageRange
  throw new Error("Invalid 'range': expected today, 7d, 30d, 90d, or all")
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return 200
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) throw new Error("Invalid 'limit': expected positive number")
  return Math.floor(value)
}

function selectedSources(source: ModelPriceCoverageSource): Array<{ prefix: UsagePrefix; name: ModelPriceUsageSourceName }> {
  if (source === "cc") return [{ prefix: "cc", name: "cc" }]
  if (source === "codex") return [{ prefix: "cx", name: "codex" }]
  return [
    { prefix: "cc", name: "cc" },
    { prefix: "cx", name: "codex" },
  ]
}

function queryUsedModels(db: DatabaseSync, prefix: UsagePrefix, preset: ModelPriceCoverageRange): Array<Omit<UsedModelAccumulator, "sources">> {
  const filter = createUsageRangeFilter({ preset })
  const where: string[] = ["model != ''"]
  const params: Array<string | number> = []
  if (filter.sinceTimestampMs !== undefined) {
    where.push("timestamp_ms >= ?")
    params.push(filter.sinceTimestampMs)
  } else if (filter.sinceDate) {
    where.push("date >= ?")
    params.push(filter.sinceDate)
  }
  if (filter.untilTimestampMs !== undefined) {
    where.push("timestamp_ms <= ?")
    params.push(filter.untilTimestampMs)
  } else if (filter.untilDate) {
    where.push("date <= ?")
    params.push(filter.untilDate)
  }
  const rows = db.prepare(`
    SELECT
      model,
      COALESCE(SUM(input_tokens), 0) AS input,
      COALESCE(SUM(output_tokens), 0) AS output,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning,
      COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens), 0) AS tokens,
      COALESCE(SUM(CASE WHEN price_known = 1 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END), 0) AS priced_tokens,
      COALESCE(SUM(CASE WHEN price_known = 0 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END), 0) AS unpriced_tokens,
      COALESCE(SUM(total_cost), 0) AS estimated_cost,
      COUNT(*) AS requests
    FROM ${prefix}_usage_events
    WHERE ${where.join(" AND ")}
    GROUP BY model
    HAVING tokens > 0
  `).all(...params) as Record<string, unknown>[]

  return rows.map((row) => ({
    model: String(row.model ?? "unknown"),
    tokens: toNumber(row.tokens),
    requests: toNumber(row.requests),
    pricedTokens: toNumber(row.priced_tokens),
    unpricedTokens: toNumber(row.unpriced_tokens),
    estimatedCost: toNumber(row.estimated_cost),
    input: toNumber(row.input),
    output: toNumber(row.output),
    cacheRead: toNumber(row.cache_read),
    cacheWrite: toNumber(row.cache_write),
    reasoning: toNumber(row.reasoning),
  }))
}

function toNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}
```

Modify `desktop/electron/services/model-price/service.ts`:

```ts
import { listModelPriceCoverage } from "./coverage"
import type { ModelPriceCoverageInput, ModelPriceCoverageRow } from "./types"
```

Add method:

```ts
listCoverage(input: ModelPriceCoverageInput = {}): ModelPriceCoverageRow[] {
  return listModelPriceCoverage(this.db, this.listRules(), input)
}
```

Export coverage types from `desktop/electron/services/model-price/index.ts`.

- [ ] **Step 5: Run coverage tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/model-price/__tests__/coverage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add desktop/electron/services/model-price
git commit -m "feat: add model price coverage"
```

---

### Task 3: Move Usage-Analysis Price Consumers To Model Price

**Files:**
- Modify: `desktop/electron/services/usage-analysis/cc-parser.ts`
- Modify: `desktop/electron/services/usage-analysis/codex-parser.ts`
- Modify: `desktop/electron/services/usage-analysis/cc-service.ts`
- Modify: `desktop/electron/services/usage-analysis/cc-scan-state.ts`
- Modify: `desktop/electron/services/usage-analysis/usage-cost-snapshot.ts`
- Modify: `desktop/electron/services/usage-analysis/index.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/cc-parser.test.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/codex-parser.test.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/cc-scan-state.test.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts`

- [ ] **Step 1: Write failing compatibility tests for usage-analysis consumers**

Update `desktop/electron/services/usage-analysis/__tests__/cc-scan-state.test.ts` to import `hashModelPriceRules` and `DEFAULT_MODEL_PRICE_RULES` from `../model-price` path:

```ts
import { DEFAULT_MODEL_PRICE_RULES, hashModelPriceRules } from "../../model-price"
```

Add or update assertion:

```ts
it("uses the model-price rule hash for scan replacement decisions", () => {
  const oldHash = hashModelPriceRules(DEFAULT_MODEL_PRICE_RULES)
  const newHash = hashModelPriceRules([
    ...DEFAULT_MODEL_PRICE_RULES,
    { ...DEFAULT_MODEL_PRICE_RULES[0], id: "copy", modelPattern: "copy-model", sortIndex: 999 },
  ])

  expect(oldHash).not.toBe(newHash)
})
```

Update `desktop/electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts` so it imports defaults from model-price:

```ts
import { DEFAULT_MODEL_PRICE_RULES } from "../../model-price"
```

Expected failing reason: old usage-analysis pricing exports are still used or model-price imports have not been wired through parsers.

- [ ] **Step 2: Run affected usage-analysis tests to verify failures**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/cc-parser.test.ts electron/services/usage-analysis/__tests__/codex-parser.test.ts electron/services/usage-analysis/__tests__/cc-scan-state.test.ts electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts
```

Expected: FAIL until imports and types move to model-price.

- [ ] **Step 3: Update parser imports**

In `desktop/electron/services/usage-analysis/cc-parser.ts`, replace:

```ts
import { estimateUsageCost, type UsageModelPriceRule } from "./pricing"
```

with:

```ts
import { estimateModelUsageCost, type ModelPriceRule } from "../model-price"
```

Change parser option type:

```ts
readonly priceRules?: readonly ModelPriceRule[]
```

Replace:

```ts
const cost = estimateUsageCost(model, tokens, options.priceRules)
```

with:

```ts
const cost = estimateModelUsageCost(model, tokens, options.priceRules ?? [])
```

Apply the same import and call replacement in `desktop/electron/services/usage-analysis/codex-parser.ts`.

- [ ] **Step 4: Update scan state hash types**

In `desktop/electron/services/usage-analysis/cc-scan-state.ts`, replace `UsageModelPriceRule` import from `./pricing` with:

```ts
import { hashModelPriceRules, type ModelPriceRule } from "../model-price"
```

Replace implementation of `hashUsagePriceRules` with a compatibility wrapper:

```ts
export function hashUsagePriceRules(rules: readonly ModelPriceRule[]): string {
  return hashModelPriceRules(rules)
}
```

Keep the function name while usage-analysis still calls it, but make it delegate to model-price.

- [ ] **Step 5: Update cc-service to read rules from ModelPriceService**

In `desktop/electron/services/usage-analysis/cc-service.ts`, replace pricing imports:

```ts
import {
  ModelPriceService,
  hashModelPriceRules,
  type ModelPriceRule,
} from "../model-price"
```

Remove imports of `listUsagePriceRules`, `resetUsagePriceRulesToDefaults`, `saveUsagePriceRules`, `UsageModelPriceRule`, and `UsageModelPriceRuleInput`.

Inside `refreshUsageNamespace`, replace:

```ts
const priceRules = listUsagePriceRules(options.db)
const pricingRulesHash = hashUsagePriceRules(priceRules)
```

with:

```ts
const modelPrice = new ModelPriceService(options.db)
const priceRules = modelPrice.listRules()
const pricingRulesHash = hashModelPriceRules(priceRules)
```

In parse callback types, replace `UsageModelPriceRule` with `ModelPriceRule`.

Remove `getPricingRules`, `savePricingRules`, and `resetPricingRules` methods from `CcUsageAnalysisService`. If IPC compatibility still needs temporary wrappers during Task 4, reintroduce them there as `ModelPriceService` delegations, not usage-analysis pricing imports.

- [ ] **Step 6: Move usage cost snapshot imports**

In `desktop/electron/services/usage-analysis/usage-cost-snapshot.ts`, replace:

```ts
import { estimateUsageCost, roundUsageCost, type UsageModelPriceRule } from "./pricing"
```

with:

```ts
import { estimateModelUsageCost, roundModelUsageCost, type ModelPriceRule } from "../model-price"
```

Change input type:

```ts
readonly priceRules: readonly ModelPriceRule[]
```

Replace `estimateUsageCost` and `roundUsageCost` calls with `estimateModelUsageCost` and `roundModelUsageCost`.

- [ ] **Step 7: Update usage-analysis public exports**

In `desktop/electron/services/usage-analysis/index.ts`, remove:

```ts
export type { UsageModelPriceRule, UsageModelPriceRuleInput } from "./pricing"
```

If callers still need rule types, import from `desktop/electron/services/model-price`.

- [ ] **Step 8: Run usage-analysis consumer tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/cc-parser.test.ts electron/services/usage-analysis/__tests__/codex-parser.test.ts electron/services/usage-analysis/__tests__/cc-scan-state.test.ts electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts electron/services/model-price/__tests__/model-price-service.test.ts electron/services/model-price/__tests__/coverage.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add desktop/electron/services/usage-analysis desktop/electron/services/model-price
git commit -m "refactor: route usage pricing through model price"
```

---

### Task 4: First-Class Model Price IPC And Preload Bridge

**Files:**
- Create: `desktop/electron/model-price/channels.ts`
- Create: `desktop/electron/model-price/ipc-handlers.ts`
- Create: `desktop/electron/model-price/__tests__/ipc-handlers.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/usage-analysis/channels.ts`
- Modify: `desktop/electron/usage-analysis/ipc-handlers.ts`
- Modify: `desktop/electron/usage-analysis/__tests__/ipc-handlers.test.ts`

- [ ] **Step 1: Write failing IPC normalization tests**

Create `desktop/electron/model-price/__tests__/ipc-handlers.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  normalizeModelPriceCoverageInput,
  normalizeModelPriceRuleInputs,
} from "../ipc-handlers"

describe("model price ipc handlers", () => {
  it("normalizes coverage input", () => {
    expect(normalizeModelPriceCoverageInput({ source: "codex", range: "90d", limit: 20.8 })).toEqual({
      source: "codex",
      range: "90d",
      limit: 20,
    })
    expect(normalizeModelPriceCoverageInput({ source: "bad", range: "bad", limit: -1 })).toEqual({
      source: "all",
      range: "all",
      limit: 200,
    })
  })

  it("normalizes rule inputs defensively", () => {
    expect(normalizeModelPriceRuleInputs([
      { id: "custom", modelPattern: " local ", inputPer1M: 1, outputPer1M: -1, enabled: false },
      { modelPattern: " " },
      null,
    ])).toEqual([
      {
        id: "custom",
        modelPattern: "local",
        inputPer1M: 1,
        outputPer1M: 0,
        cacheReadPer1M: 0,
        cacheWritePer1M: 0,
        reasoningPer1M: 0,
        enabled: false,
      },
    ])
  })
})
```

- [ ] **Step 2: Run IPC test to verify it fails**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/model-price/__tests__/ipc-handlers.test.ts
```

Expected: FAIL because model-price IPC files do not exist.

- [ ] **Step 3: Add model-price channel constants**

Create `desktop/electron/model-price/channels.ts`:

```ts
export const MODEL_PRICE_CHANNELS = {
  rulesList: "synapse:model-price:rules:list",
  rulesSave: "synapse:model-price:rules:save",
  rulesReset: "synapse:model-price:rules:reset",
  coverageList: "synapse:model-price:coverage:list",
} as const
```

- [ ] **Step 4: Implement model-price IPC handlers**

Create `desktop/electron/model-price/ipc-handlers.ts`:

```ts
import type { ModelPriceCoverageInput, ModelPriceRuleInput, ModelPriceService } from "../services/model-price"
import { MODEL_PRICE_CHANNELS } from "./channels"

type HandleValidatedIpc = <Args extends unknown[], Result>(
  channel: string,
  handler: (event: unknown, ...args: Args) => Result | Promise<Result>,
) => void

let registered = false

export function registerModelPriceIpcHandlers(options: {
  readonly handleValidatedIpc: HandleValidatedIpc
  readonly modelPrice: ModelPriceService
}): void {
  if (registered) return
  const { handleValidatedIpc, modelPrice } = options

  handleValidatedIpc(MODEL_PRICE_CHANNELS.rulesList, async () => modelPrice.listRules())
  handleValidatedIpc(MODEL_PRICE_CHANNELS.rulesSave, async (_event, rules?: unknown) => modelPrice.saveRules(normalizeModelPriceRuleInputs(rules)))
  handleValidatedIpc(MODEL_PRICE_CHANNELS.rulesReset, async () => modelPrice.resetRulesToDefaults())
  handleValidatedIpc(MODEL_PRICE_CHANNELS.coverageList, async (_event, input?: unknown) => modelPrice.listCoverage(normalizeModelPriceCoverageInput(input)))

  registered = true
}

export function normalizeModelPriceCoverageInput(input: unknown): Required<ModelPriceCoverageInput> {
  const record = isRecord(input) ? input : {}
  return {
    source: record.source === "cc" || record.source === "codex" || record.source === "all" ? record.source : "all",
    range: record.range === "today" || record.range === "7d" || record.range === "30d" || record.range === "90d" || record.range === "all" ? record.range : "all",
    limit: typeof record.limit === "number" && Number.isFinite(record.limit) && record.limit > 0 ? Math.floor(record.limit) : 200,
  }
}

export function normalizeModelPriceRuleInputs(input: unknown): ModelPriceRuleInput[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    if (!isRecord(item) || typeof item.modelPattern !== "string" || item.modelPattern.trim() === "") return []
    return [{
      ...(typeof item.id === "string" && item.id.trim() ? { id: item.id.trim() } : {}),
      modelPattern: item.modelPattern.trim(),
      inputPer1M: normalizePrice(item.inputPer1M),
      outputPer1M: normalizePrice(item.outputPer1M),
      cacheReadPer1M: normalizePrice(item.cacheReadPer1M),
      cacheWritePer1M: normalizePrice(item.cacheWritePer1M),
      reasoningPer1M: normalizePrice(item.reasoningPer1M),
      enabled: item.enabled === false ? false : true,
    }]
  })
}

function normalizePrice(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
```

When wiring this into runtime, use the repository’s existing IPC registration boundary. Do not add naked `ipcMain.handle/on`.

- [ ] **Step 5: Add bridge types**

In `desktop/src/types/bridge.ts`, add model-price shared types near usage-analysis price rule types:

```ts
export type ModelPriceCoverageSource = "all" | "cc" | "codex"
export type ModelPriceCoverageRange = "today" | "7d" | "30d" | "90d" | "all"

export interface ModelPriceCoverageInput {
  readonly source?: ModelPriceCoverageSource
  readonly range?: ModelPriceCoverageRange
  readonly limit?: number
}

export interface ModelPriceCoverageRow {
  readonly model: string
  readonly sources: ("cc" | "codex")[]
  readonly tokens: number
  readonly requests: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly priceKnown: boolean
  readonly matchedRuleId?: string
  readonly matchedRulePattern?: string
}
```

Add to `SynapseBridge`:

```ts
modelPrice: {
  listRules: () => Promise<UsageAnalysisModelPriceRule[]>
  saveRules: (rules: UsageAnalysisModelPriceRuleInput[]) => Promise<UsageAnalysisModelPriceRule[]>
  resetRules: () => Promise<UsageAnalysisModelPriceRule[]>
  listCoverage: (input?: ModelPriceCoverageInput) => Promise<ModelPriceCoverageRow[]>
}
```

The existing rule type names can be reused temporarily in renderer bridge types to keep this task narrow. Rename them to `ModelPriceRule` in a cleanup if the type churn stays local.

- [ ] **Step 6: Expose preload bridge**

In `desktop/electron/preload.ts`, import `MODEL_PRICE_CHANNELS` and add:

```ts
modelPrice: {
  listRules: invoke(MODEL_PRICE_CHANNELS.rulesList),
  saveRules: (rules) => invoke(MODEL_PRICE_CHANNELS.rulesSave)(rules),
  resetRules: invoke(MODEL_PRICE_CHANNELS.rulesReset),
  listCoverage: (input) => invoke(MODEL_PRICE_CHANNELS.coverageList)(input),
},
```

- [ ] **Step 7: Retire usage-analysis pricing IPC**

In `desktop/electron/usage-analysis/channels.ts`, remove:

```ts
pricingRulesGet
pricingRulesSave
pricingRulesReset
```

In `desktop/electron/usage-analysis/ipc-handlers.ts`, remove handlers for `pricingRulesGet`, `pricingRulesSave`, and `pricingRulesReset`.

Update `desktop/electron/usage-analysis/__tests__/ipc-handlers.test.ts` only if it imports or expects pricing handlers. Keep usage-analysis range and conversation tests unchanged.

- [ ] **Step 8: Run IPC tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/model-price/__tests__/ipc-handlers.test.ts electron/usage-analysis/__tests__/ipc-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add desktop/electron/model-price desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/usage-analysis
git commit -m "feat: add model price bridge"
```

---

### Task 5: MCP Dispatcher Uses ModelPriceService

**Files:**
- Modify: `desktop/electron/capabilities/model-price-dispatcher.ts`
- Modify: `desktop/electron/capabilities/__tests__/model-price-dispatcher.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/capabilities/__tests__/action-router.test.ts`
- Modify: `desktop/tests/unit/synapse-capabilities.test.ts`
- Modify: `desktop/tests/unit/api-mcp-capability-surface.test.ts`

- [ ] **Step 1: Update dispatcher tests to assert legacy table isolation**

In `desktop/electron/capabilities/__tests__/model-price-dispatcher.test.ts`, update imports:

```ts
import { ModelPriceService } from "../../services/model-price"
```

Add test:

```ts
it("dispatches through the model price service and ignores legacy usage_model_prices", async () => {
  const db = createTestDb()
  db.prepare(`
    INSERT INTO usage_model_prices (
      id, model_pattern, input_per_1m, output_per_1m, updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run("legacy", "legacy-only-model", 999, 999, "2026-06-09T00:00:00.000Z")
  const dispatcher = createModelPriceCapabilityDispatcher({
    modelPrice: new ModelPriceService(db),
  })

  const rules = await dispatcher.dispatch("model_price.rule.list", {}, { source: "api" })

  expect((rules.data as Array<{ modelPattern: string }>).some((rule) => rule.modelPattern === "legacy-only-model")).toBe(false)
  db.close()
})
```

Expected failing reason: dispatcher still takes `db` and imports usage-analysis pricing.

- [ ] **Step 2: Run dispatcher test to verify failure**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/model-price-dispatcher.test.ts
```

Expected: FAIL until dispatcher accepts `modelPrice`.

- [ ] **Step 3: Change dispatcher dependencies**

In `desktop/electron/capabilities/model-price-dispatcher.ts`, replace dependency type:

```ts
type ModelPriceDispatcherDeps = {
  readonly modelPrice: ModelPriceService
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
  readonly logger?: ModelPriceDispatcherLogger
}
```

Replace imports from `../services/usage-analysis/pricing` with:

```ts
import type { ModelPriceRulePatch, ModelPriceService } from "../services/model-price"
```

Change dispatcher action implementation:

```ts
function dispatchModelPriceAction(
  modelPrice: ModelPriceService,
  action: string,
  params: Record<string, unknown>,
): DispatchResult {
  switch (action) {
    case "model_price.used_model.list":
      return { ok: true, data: modelPrice.listCoverage(params) }
    case "model_price.rule.list":
      return { ok: true, data: modelPrice.listRules() }
    case "model_price.rule.get": {
      const rule = modelPrice.getRule(requireString(params, "ruleId"))
      if (!rule) throw new Error(`Model price rule not found: ${requireString(params, "ruleId")}`)
      return { ok: true, data: rule }
    }
    case "model_price.rule.create":
      return { ok: true, data: modelPrice.createRule(readCreateParams(params)) }
    case "model_price.rule.update":
      return { ok: true, data: modelPrice.updateRule(requireString(params, "ruleId"), readPatchParams(params)) }
    case "model_price.rule.delete":
      return { ok: true, data: modelPrice.deleteRule(requireString(params, "ruleId")) }
    case "model_price.rule.enable":
      return { ok: true, data: modelPrice.setRuleEnabled(requireString(params, "ruleId"), true) }
    case "model_price.rule.disable":
      return { ok: true, data: modelPrice.setRuleEnabled(requireString(params, "ruleId"), false) }
    default:
      throw new Error(`Unknown action: ${action}`)
  }
}
```

Replace calls to `dispatchModelPriceAction(deps.db, action, params)` with `dispatchModelPriceAction(deps.modelPrice, action, params)`.

Remove now-duplicated local `listUsedModels` and `queryUsedModels` helpers from dispatcher; coverage lives in `ModelPriceService`.

- [ ] **Step 4: Wire bootstrap to construct ModelPriceService**

In `desktop/electron/bootstrap/descriptors.ts`, import:

```ts
import { ModelPriceService } from "../services/model-price"
```

Where `createModelPriceCapabilityDispatcher` is constructed, replace:

```ts
createModelPriceCapabilityDispatcher({ db: getUsageAnalysisDb(), ... })
```

with:

```ts
createModelPriceCapabilityDispatcher({
  modelPrice: new ModelPriceService(getUsageAnalysisDb()),
  permissionGuard,
  auditSink,
})
```

Also register model-price IPC handlers from Task 4 at the same bootstrap point that usage-analysis IPC handlers are registered, passing `new ModelPriceService(getUsageAnalysisDb())`.

- [ ] **Step 5: Run MCP and capability tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/model-price-dispatcher.test.ts electron/capabilities/__tests__/action-router.test.ts tests/unit/synapse-capabilities.test.ts tests/unit/api-mcp-capability-surface.test.ts electron/database/__tests__/mcp-server.test.ts
```

Expected: PASS. Tool names remain unchanged.

- [ ] **Step 6: Commit Task 5**

```bash
git add desktop/electron/capabilities desktop/electron/bootstrap/descriptors.ts desktop/tests/unit
git commit -m "refactor: route model price mcp through service"
```

---

### Task 6: Agent Cost Estimation Uses Model Price And Workflow Keeps Snapshots

**Files:**
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts` if present or nearest existing agent runtime tests
- Modify: `desktop/electron/services/workflow/__tests__/workflow-engine.test.ts` or existing workflow cost tests
- Modify: `desktop/electron/services/usage-analysis/usage-cost-snapshot.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts`

- [ ] **Step 1: Write failing Agent/Workflow import tests**

In `desktop/electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts`, assert model-price defaults work:

```ts
import { DEFAULT_MODEL_PRICE_RULES } from "../../model-price"
import { estimateSynapseUsageCostSnapshot } from "../usage-cost-snapshot"

it("estimates local cost from model-price rules", () => {
  expect(estimateSynapseUsageCostSnapshot({
    modelName: "claude-sonnet-4",
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    priceRules: DEFAULT_MODEL_PRICE_RULES,
  })).toMatchObject({
    modelName: "claude-sonnet-4",
    costCny: 129.6,
    costCurrency: "CNY",
    priceKnown: true,
    estimatedCost: true,
  })
})
```

Add a static import guard test where appropriate:

```ts
it("does not import usage-analysis pricing from agent runtime entry", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../index.ts", import.meta.url), "utf8"))
  expect(source).not.toContain("../usage-analysis/pricing")
  expect(source).toContain("../model-price")
})
```

- [ ] **Step 2: Run cost snapshot and agent tests to verify failures**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts
```

Expected: FAIL until imports are moved.

- [ ] **Step 3: Update Agent runtime dependency injection**

In `desktop/electron/services/agent-runtime/index.ts`, replace:

```ts
import { listUsagePriceRules } from "../usage-analysis/pricing"
```

with:

```ts
import { ModelPriceService } from "../model-price"
```

Replace:

```ts
getUsagePriceRules: () => listUsagePriceRules(getUsageAnalysisDb()),
```

with:

```ts
getUsagePriceRules: () => new ModelPriceService(getUsageAnalysisDb()).listRules(),
```

Keep the existing dependency name `getUsagePriceRules` in this task to avoid unrelated Agent runtime type churn, but source it from `ModelPriceService`.

- [ ] **Step 4: Update conversation-router imports**

In `desktop/electron/services/agent-runtime/conversation-router.ts`, replace:

```ts
import { estimateSynapseUsageCostSnapshot } from "../usage-analysis/usage-cost-snapshot"
```

with:

```ts
import { estimateSynapseUsageCostSnapshot } from "../model-price"
```

If `estimateSynapseUsageCostSnapshot` remains in usage-analysis after Task 3, move it into `desktop/electron/services/model-price/usage-cost-snapshot.ts` and export it from model-price.

- [ ] **Step 5: Verify Workflow keeps stored cost snapshots**

Run:

```bash
rg -n "usage-analysis/pricing|estimateUsageCost|listUsagePriceRules|saveUsagePriceRules" desktop/electron/services/workflow
```

Expected: no matches. Keep `desktop/electron/services/workflow/workflow-engine.ts` unchanged. Workflow should continue storing the `costCny`/`usageCost` snapshot produced by node execution and must not re-estimate historical results.

- [ ] **Step 6: Run Agent/Workflow focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts electron/services/workflow
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add desktop/electron/services/agent-runtime desktop/electron/services/workflow desktop/electron/services/model-price desktop/electron/services/usage-analysis/usage-cost-snapshot.ts desktop/electron/services/usage-analysis/__tests__/usage-cost-snapshot.test.ts
git commit -m "refactor: use model price for runtime costs"
```

---

### Task 7: Renderer Top-Level Price Module

**Files:**
- Create: `desktop/src/modules/model-price/types.ts`
- Create: `desktop/src/modules/model-price/hooks.ts`
- Create: `desktop/src/modules/model-price/components/model-coverage-view.tsx`
- Create: `desktop/src/modules/model-price/components/price-rules-view.tsx`
- Create: `desktop/src/modules/model-price/index.tsx`
- Create: `desktop/src/modules/model-price/__tests__/model-price-module.test.tsx`
- Create: `desktop/src/modules/model-price/__tests__/price-rules-view.test.tsx`
- Modify: `desktop/config.ts`
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/src/__tests__/App.workflow-entry.test.tsx`
- Modify: `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`
- Modify: `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx`
- Modify: `desktop/src/modules/usage-analysis/codex/codex-usage-page.tsx`
- Modify: `desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx`
- Delete or stop importing: `desktop/src/modules/usage-analysis/shared/components/pricing-rules-dialog.tsx`

- [ ] **Step 1: Write failing renderer tests**

Create `desktop/src/modules/model-price/__tests__/model-price-module.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ModelPriceModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const modelPriceBridge = vi.hoisted(() => ({
  listCoverage: vi.fn(),
  listRules: vi.fn(),
  saveRules: vi.fn(),
  resetRules: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({ modelPrice: modelPriceBridge }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}))

let roots: Root[] = []

beforeEach(() => {
  modelPriceBridge.listCoverage.mockResolvedValue([
    { model: "local-model", sources: ["cc", "codex"], tokens: 150, requests: 2, pricedTokens: 0, unpricedTokens: 150, estimatedCost: 0, input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0, priceKnown: false },
  ])
  modelPriceBridge.listRules.mockResolvedValue([
    { id: "gpt-5-5", modelPattern: "gpt-5.5", inputPer1M: 36, outputPer1M: 216, cacheReadPer1M: 3.6, cacheWritePer1M: 0, reasoningPer1M: 216, currency: "CNY", enabled: true, source: "builtin", sortIndex: 0, updatedAt: "2026-06-09T00:00:00.000Z" },
  ])
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("ModelPriceModule", () => {
  it("renders coverage as the default view and includes the rules view", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(<ModelPriceModule />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.body.textContent).toContain("模型覆盖")
    expect(document.body.textContent).toContain("价格规则")
    expect(document.body.textContent).toContain("local-model")
    expect(document.body.textContent).toContain("未定价")
  })
})
```

Update `desktop/src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx`:

```tsx
it("does not render pricing rules action in usage analysis shell", () => {
  const html = renderToStaticMarkup(
    <UsageAnalysisShell
      title="CC"
      view="overview"
      range="30d"
      refreshing={false}
      onViewChange={() => undefined}
      onRangeChange={() => undefined}
      onRefresh={() => undefined}
    >
      <div>content</div>
    </UsageAnalysisShell>,
  )

  expect(html).not.toContain("价格规则")
})
```

Update `desktop/src/__tests__/App.workflow-entry.test.tsx` navigation-order assertion to expect `价格` after `Codex`.

- [ ] **Step 2: Run renderer tests to verify failures**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/model-price/__tests__/model-price-module.test.tsx src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx src/__tests__/App.workflow-entry.test.tsx
```

Expected: FAIL because module and nav entry do not exist and shell still renders pricing action when passed.

- [ ] **Step 3: Add renderer types and hooks**

Create `desktop/src/modules/model-price/types.ts`:

```ts
import type {
  ModelPriceCoverageInput,
  ModelPriceCoverageRow,
  UsageAnalysisModelPriceRule,
  UsageAnalysisModelPriceRuleInput,
} from "@/types/bridge"

export type ModelPriceRule = UsageAnalysisModelPriceRule
export type ModelPriceRuleInput = UsageAnalysisModelPriceRuleInput
export type { ModelPriceCoverageInput, ModelPriceCoverageRow }
export type ModelPriceViewId = "coverage" | "rules"
```

Create `desktop/src/modules/model-price/hooks.ts`:

```ts
import { useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { ModelPriceCoverageInput, ModelPriceCoverageRow, ModelPriceRule } from "./types"

type LoadState<T> = {
  readonly data: T | null
  readonly loading: boolean
  readonly error: boolean
}

export function useModelPriceCoverage(input: ModelPriceCoverageInput, refreshKey: number): LoadState<ModelPriceCoverageRow[]> {
  const [state, setState] = useState<LoadState<ModelPriceCoverageRow[]>>({ data: null, loading: true, error: false })
  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, loading: true, error: false }))
    requireSynapseBridge().modelPrice.listCoverage(input)
      .then((data) => {
        if (active) setState({ data, loading: false, error: false })
      })
      .catch(() => {
        if (active) setState({ data: null, loading: false, error: true })
      })
    return () => {
      active = false
    }
  }, [input.source, input.range, input.limit, refreshKey])
  return state
}

export function useModelPriceRules(refreshKey: number): LoadState<ModelPriceRule[]> {
  const [state, setState] = useState<LoadState<ModelPriceRule[]>>({ data: null, loading: true, error: false })
  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, loading: true, error: false }))
    requireSynapseBridge().modelPrice.listRules()
      .then((data) => {
        if (active) setState({ data, loading: false, error: false })
      })
      .catch(() => {
        if (active) setState({ data: null, loading: false, error: true })
      })
    return () => {
      active = false
    }
  }, [refreshKey])
  return state
}
```

- [ ] **Step 4: Create coverage view**

Create `desktop/src/modules/model-price/components/model-coverage-view.tsx`:

```tsx
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatSynapseCost } from "@/lib/cost-currency"
import { formatTokenUsageValue } from "@/lib/token-usage"
import type { ModelPriceCoverageRow } from "../types"

interface ModelCoverageViewProps {
  readonly rows: readonly ModelPriceCoverageRow[]
  readonly loading: boolean
  readonly error: boolean
  readonly onCreateRule: (model: string) => void
  readonly onEditRule: (ruleId: string) => void
}

export function ModelCoverageView({ rows, loading, error, onCreateRule, onEditRule }: ModelCoverageViewProps) {
  if (loading) return <div className="p-3 text-sm text-muted-foreground">加载中</div>
  if (error) return <div className="p-3 text-sm text-destructive">读取失败</div>
  if (rows.length === 0) return <div className="p-3 text-sm text-muted-foreground">暂无模型</div>

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>模型</TableHead>
          <TableHead>来源</TableHead>
          <TableHead className="text-right">Token</TableHead>
          <TableHead>当前规则</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="text-right">费用</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.model}>
            <TableCell className="font-medium">{row.model}</TableCell>
            <TableCell>{row.sources.join(" / ")}</TableCell>
            <TableCell className="text-right tabular-nums">{formatTokenUsageValue(row.tokens)}</TableCell>
            <TableCell>{row.matchedRulePattern ?? "无"}</TableCell>
            <TableCell>{row.priceKnown ? "已定价" : "未定价"}</TableCell>
            <TableCell className="text-right tabular-nums">{row.unpricedTokens >= row.tokens ? "未定价" : formatSynapseCost(row.estimatedCost)}</TableCell>
            <TableCell className="text-right">
              {row.matchedRuleId ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onEditRule(row.matchedRuleId!)}>
                  编辑
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => onCreateRule(row.model)}>
                  创建规则
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 5: Create price rules view**

Create `desktop/src/modules/model-price/components/price-rules-view.tsx` by moving the table/editing logic from `desktop/src/modules/usage-analysis/shared/components/pricing-rules-dialog.tsx` into a non-dialog view.

Use this component API:

```tsx
interface PriceRulesViewProps {
  readonly rows: readonly ModelPriceRule[]
  readonly loading: boolean
  readonly error: boolean
  readonly draftModelPattern?: string
  readonly onSaved: () => void
}
```

The component should:

- load rows from props into editable local state when `rows` changes;
- use `requireSynapseBridge().modelPrice.saveRules(rows.map(toRuleInput))`;
- use `requireSynapseBridge().modelPrice.resetRules()` behind the existing `AlertDialog`;
- show `读取失败`, `添加`, `保存`, `重置`, `恢复内置默认价格`, and `确认重置`;
- keep numeric cells `text-right tabular-nums`;
- avoid inline style and custom colors.

Use the existing helper functions from `pricing-rules-dialog.tsx`: `toEditableRule`, `newEditableRule`, `toRuleInput`, `formatPriceField`, `parsePriceField`.

- [ ] **Step 6: Create module shell**

Create `desktop/src/modules/model-price/index.tsx`:

```tsx
import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RangePicker } from "@/modules/usage-analysis/shared/components/range-picker"
import type { UsageRangePreset } from "@/modules/usage-analysis/shared/types"
import { ModelCoverageView } from "./components/model-coverage-view"
import { PriceRulesView } from "./components/price-rules-view"
import { useModelPriceCoverage, useModelPriceRules } from "./hooks"
import type { ModelPriceViewId } from "./types"

export function ModelPriceModule() {
  const [view, setView] = useState<ModelPriceViewId>("coverage")
  const [range, setRange] = useState<UsageRangePreset>("30d")
  const [refreshKey, setRefreshKey] = useState(0)
  const [draftModelPattern, setDraftModelPattern] = useState<string | undefined>()
  const coverageInput = useMemo(() => ({ source: "all" as const, range, limit: 200 }), [range])
  const coverage = useModelPriceCoverage(coverageInput, refreshKey)
  const rules = useModelPriceRules(refreshKey)

  const openCreateRule = (model: string) => {
    setDraftModelPattern(model)
    setView("rules")
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-2 px-2 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 text-sm font-medium">价格</h2>
          <Tabs value={view} onValueChange={(next) => setView(next as ModelPriceViewId)}>
            <TabsList>
              <TabsTrigger value="coverage">模型覆盖</TabsTrigger>
              <TabsTrigger value="rules">价格规则</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex items-center gap-2">
          {view === "coverage" ? <RangePicker value={range} onChange={setRange} /> : null}
          <Button type="button" variant="outline" size="sm" onClick={() => setRefreshKey((current) => current + 1)}>
            <RefreshCw data-icon="inline-start" />
            刷新
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 min-w-0 max-w-full flex-1" viewportClassName="min-w-0 max-w-full">
        <div className="min-h-full min-w-full w-0 max-w-full overflow-x-hidden px-2 pb-2 pt-0">
          {view === "coverage" ? (
            <ModelCoverageView
              rows={coverage.data ?? []}
              loading={coverage.loading}
              error={coverage.error}
              onCreateRule={openCreateRule}
              onEditRule={() => setView("rules")}
            />
          ) : (
            <PriceRulesView
              rows={rules.data ?? []}
              loading={rules.loading}
              error={rules.error}
              draftModelPattern={draftModelPattern}
              onSaved={() => setRefreshKey((current) => current + 1)}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
```

- [ ] **Step 7: Add top-level navigation and remove CC/Codex price button**

Modify `desktop/config.ts`:

```ts
  { id: "usage-cc", label: "CC" },
  { id: "usage-codex", label: "Codex" },
  { id: "model-price", label: "价格" },
  { id: "settings", label: "设置" },
```

Modify `desktop/src/App.tsx`:

```tsx
import { ModelPriceModule } from "@/modules/model-price"
```

Render:

```tsx
{activeTab === "model-price" ? (
  <ErrorBoundary fallbackTitle="价格模块出现问题">
    <ModelPriceModule />
  </ErrorBoundary>
) : null}
```

Modify `desktop/src/modules/usage-analysis/shared/components/usage-analysis-shell.tsx`:

- remove `BadgeDollarSign` import;
- remove `onPricingRulesClick` prop;
- remove the `价格规则` button.

Modify `desktop/src/modules/usage-analysis/cc/cc-usage-page.tsx` and `desktop/src/modules/usage-analysis/codex/codex-usage-page.tsx`:

- remove `PricingRulesDialog` import;
- remove `pricingRulesOpen` state;
- remove `onPricingRulesClick`;
- remove `<PricingRulesDialog ... />`.

- [ ] **Step 8: Run renderer tests**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/model-price/__tests__/model-price-module.test.tsx src/modules/usage-analysis/__tests__/usage-analysis-shell.test.tsx src/__tests__/App.workflow-entry.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 7**

```bash
git add desktop/src/modules/model-price desktop/src/modules/usage-analysis desktop/src/App.tsx desktop/config.ts desktop/src/__tests__/App.workflow-entry.test.tsx
git rm desktop/src/modules/usage-analysis/shared/components/pricing-rules-dialog.tsx
git commit -m "feat: add model price module"
```

---

### Task 8: Cleanup Legacy Price Paths And Release Notes

**Files:**
- Modify or delete: `desktop/electron/services/usage-analysis/pricing.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/modules/usage-analysis/__tests__/pricing-rules-dialog.test.tsx`
- Modify: `RELEASE_NOTES_PENDING.md`
- Search all code for old imports and bridge calls.

- [ ] **Step 1: Search for legacy references**

Run:

```bash
rg -n "usage_model_prices|usageAnalysis\\.getPricingRules|usageAnalysis\\.savePricingRules|usageAnalysis\\.resetPricingRules|pricing-rules-dialog|UsageModelPriceRule|estimateUsageCost|listUsagePriceRules|saveUsagePriceRules|resetUsagePriceRulesToDefaults" desktop/electron desktop/src desktop/tests
```

Expected before cleanup: references remain only in legacy schema/migration tests or files being removed.

- [ ] **Step 2: Remove old usage-analysis pricing module**

Delete `desktop/electron/services/usage-analysis/pricing.ts`.

Move any still-useful expectations from `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts` into `desktop/electron/services/model-price/__tests__/model-price-service.test.ts`, then delete `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`.

Run:

```bash
rg -n "services/usage-analysis/pricing|\\.\\/pricing|\\.\\.\\/pricing|UsageModelPriceRule|DEFAULT_USAGE_PRICE_RULES" desktop/electron desktop/src desktop/tests
```

Expected: no matches outside deleted files.

- [ ] **Step 3: Update tests that belonged to the deleted dialog/module**

Delete `desktop/src/modules/usage-analysis/__tests__/pricing-rules-dialog.test.tsx`.

Move reset coverage into `desktop/src/modules/model-price/__tests__/price-rules-view.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PriceRulesView } from "../components/price-rules-view"
import type { ModelPriceRule } from "../types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}))

const modelPriceBridge = vi.hoisted(() => ({
  saveRules: vi.fn(),
  resetRules: vi.fn(),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => notifications,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    modelPrice: modelPriceBridge,
  }),
}))

let roots: Root[] = []

beforeEach(() => {
  notifications.error.mockClear()
  notifications.success.mockClear()
  notifications.warning.mockClear()
  modelPriceBridge.saveRules.mockReset()
  modelPriceBridge.resetRules.mockReset()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

it("confirms and resets rules to built-in defaults through modelPrice bridge", async () => {
  modelPriceBridge.resetRules.mockResolvedValueOnce([priceRule({ id: "gpt-5-5", modelPattern: "gpt-5.5", inputPer1M: 36 })])
  const onSaved = vi.fn()
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)

  await act(async () => {
    root.render(
      <PriceRulesView
        rows={[priceRule({ id: "local", modelPattern: "local-model", inputPer1M: 99 })]}
        loading={false}
        error={false}
        onSaved={onSaved}
      />,
    )
    await flushPromises()
  })

  expect(inputValues()).toContain("local-model")

  await act(async () => {
    clickButton("重置")
    await flushPromises()
  })
  expect(document.body.textContent).toContain("恢复内置默认价格")

  await act(async () => {
    clickButton("确认重置")
    await flushPromises()
  })

  expect(modelPriceBridge.resetRules).toHaveBeenCalledTimes(1)
  expect(inputValues()).toContain("gpt-5.5")
  expect(inputValues()).not.toContain("local-model")
  expect(onSaved).toHaveBeenCalledTimes(1)
  expect(notifications.success).toHaveBeenCalledWith("已重置")
})

function clickButton(label: string): void {
  const button = [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!button) throw new Error(`Button not found: ${label}`)
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function inputValues(): string[] {
  return [...document.querySelectorAll("input")].map((input) => input.value)
}

function priceRule(input: Partial<ModelPriceRule>): ModelPriceRule {
  return {
    id: input.id ?? "rule",
    modelPattern: input.modelPattern ?? "model",
    inputPer1M: input.inputPer1M ?? 1,
    outputPer1M: input.outputPer1M ?? 2,
    cacheReadPer1M: input.cacheReadPer1M ?? 0,
    cacheWritePer1M: input.cacheWritePer1M ?? 0,
    reasoningPer1M: input.reasoningPer1M ?? 2,
    currency: "CNY",
    enabled: input.enabled ?? true,
    source: input.source ?? "user",
    sortIndex: input.sortIndex ?? 0,
    updatedAt: input.updatedAt ?? "2026-06-09T00:00:00.000Z",
  }
}
```

- [ ] **Step 4: Add release note**

Append a concise user-facing bullet to `RELEASE_NOTES_PENDING.md`:

```md
- 价格管理从 CC/Codex 用量页独立成顶层“价格”模块，并新增模型覆盖视图，能直接看到哪些已用模型还缺价格规则。
```

- [ ] **Step 5: Run cleanup search**

Run:

```bash
rg -n "usageAnalysis\\.getPricingRules|usageAnalysis\\.savePricingRules|usageAnalysis\\.resetPricingRules|pricing-rules-dialog|listUsagePriceRules|saveUsagePriceRules|resetUsagePriceRulesToDefaults" desktop/electron desktop/src desktop/tests
```

Expected: no matches.

- [ ] **Step 6: Run broad focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/model-price electron/services/usage-analysis electron/capabilities/__tests__/model-price-dispatcher.test.ts electron/model-price/__tests__/ipc-handlers.test.ts src/modules/model-price src/modules/usage-analysis src/__tests__/App.workflow-entry.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run hard constraints**

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 8: Commit Task 8**

```bash
git add desktop/electron desktop/src desktop/tests RELEASE_NOTES_PENDING.md
git commit -m "chore: remove legacy price management paths"
```

---

## Final Verification

- [ ] **Step 1: Run final focused test set**

```bash
pnpm --filter @synapse/desktop test -- model-price usage-analysis
```

Expected: PASS.

- [ ] **Step 2: Run capability and app shell tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/model-price-dispatcher.test.ts electron/model-price/__tests__/ipc-handlers.test.ts src/modules/model-price src/__tests__/App.workflow-entry.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Inspect git status**

```bash
git status --short
```

Expected: clean except for intentional local files generated by the test runner.
