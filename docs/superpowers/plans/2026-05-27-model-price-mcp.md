# Model Price MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add aligned API and MCP capabilities for agents to manage Synapse model price rules and inspect used models.

**Architecture:** Add a `model_price` capability domain that maps canonical API actions to MCP tools. A thin Electron capability dispatcher validates action inputs, reads used-model rows from existing usage-analysis tables, and delegates price-rule persistence to focused helpers in the existing usage-analysis pricing module. Built-in skill resources guide agents to use rule ids and avoid historical repricing.

**Tech Stack:** Electron main process, TypeScript, node:sqlite `DatabaseSync`, Vitest, existing Synapse capability registry, existing built-in content template format.

---

## File Structure

- `desktop/electron/services/usage-analysis/pricing.ts`
  - Export rule lookup and id-based mutation helpers.
  - Keep normalization, currency, ordering, and SQLite persistence in one place.
- `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`
  - Cover helper behavior for create, partial update, enable, disable, delete, and matching.
- `desktop/synapse-capabilities/shared/model-price-domain.ts`
  - Define `model_price` capabilities and MCP tool schemas.
- `desktop/synapse-capabilities/shared/registry.ts`
  - Register the new domain and append tools/actions to the shared MCP registry.
- `desktop/tests/unit/synapse-capabilities.test.ts`
  - Assert domain action order, tool mapping, and schemas.
- `desktop/tests/unit/api-mcp-capability-surface.test.ts`
  - Extend action-router parity test dispatchers to include `model_price`.
- `desktop/electron/capabilities/model-price-dispatcher.ts`
  - Validate API action params and execute model price operations.
  - Query CC/Codex used models without triggering usage refresh.
- `desktop/electron/capabilities/__tests__/model-price-dispatcher.test.ts`
  - Cover dispatcher CRUD, used-model merge/filter/matching, and historical-cost stability.
- `desktop/electron/capabilities/action-router.ts`
  - Route `model_price.*` actions to the model-price dispatcher.
- `desktop/electron/capabilities/__tests__/action-router.test.ts`
  - Assert routing for the new domain.
- `desktop/electron/bootstrap/descriptors.ts`
  - Construct the model-price dispatcher from the usage-analysis database and pass it to the action router.
- `desktop/resources/templates/skills/synapse-model-price-mcp/meta.json`
  - Built-in skill metadata.
- `desktop/resources/templates/skills/synapse-model-price-mcp/content.md`
  - Built-in skill operating rules.
- `desktop/resources/templates/skills/synapse-model-price-mcp/files/api-reference.md`
  - Tool signatures and safe flows.
- `RELEASE_NOTES_PENDING.md`
  - Add a user-facing release note under `新增功能`.

## Task 1: Usage Pricing Helpers

**Files:**
- Modify: `desktop/electron/services/usage-analysis/pricing.ts`
- Modify: `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`

- [ ] **Step 1: Add failing helper tests**

Append these tests inside the existing `describe("usage analysis pricing", () => { ... })` block in `desktop/electron/services/usage-analysis/__tests__/pricing.test.ts`:

```ts
  it("creates updates enables disables and deletes model price rules by id", () => {
    const db = new DatabaseSync(":memory:")
    initUsageAnalysisSchema(db)

    const created = createUsagePriceRule(db, {
      modelPattern: "local-model",
      inputPer1M: 14.4,
      outputPer1M: 57.6,
    })
    expect(created).toMatchObject({
      modelPattern: "local-model",
      inputPer1M: 14.4,
      outputPer1M: 57.6,
      cacheReadPer1M: 0,
      cacheWritePer1M: 0,
      reasoningPer1M: 0,
      currency: "CNY",
      enabled: true,
      source: "user",
    })

    const updated = updateUsagePriceRule(db, created.id, { outputPer1M: 72 })
    expect(updated).toMatchObject({
      id: created.id,
      modelPattern: "local-model",
      inputPer1M: 14.4,
      outputPer1M: 72,
    })

    const disabled = setUsagePriceRuleEnabled(db, created.id, false)
    expect(disabled.enabled).toBe(false)
    expect(findUsagePriceRuleForModel("local-model", listUsagePriceRules(db))).toBeNull()

    const enabled = setUsagePriceRuleEnabled(db, created.id, true)
    expect(enabled.enabled).toBe(true)
    expect(findUsagePriceRuleForModel("local-model", listUsagePriceRules(db))?.id).toBe(created.id)

    expect(deleteUsagePriceRule(db, created.id)).toEqual({ deleted: true, ruleId: created.id })
    expect(getUsagePriceRule(db, created.id)).toBeNull()
    db.close()
  })

  it("throws clear errors for missing model price rule ids", () => {
    const db = new DatabaseSync(":memory:")
    initUsageAnalysisSchema(db)

    expect(() => updateUsagePriceRule(db, "missing-rule", { inputPer1M: 1 })).toThrow(/Model price rule not found/)
    expect(() => setUsagePriceRuleEnabled(db, "missing-rule", false)).toThrow(/Model price rule not found/)
    expect(() => deleteUsagePriceRule(db, "missing-rule")).toThrow(/Model price rule not found/)
    db.close()
  })
```

Update the import at the top of the same file to:

```ts
import {
  DEFAULT_USAGE_PRICE_RULES,
  createUsagePriceRule,
  deleteUsagePriceRule,
  estimateUsageCost,
  findUsagePriceRuleForModel,
  getUsagePriceRule,
  listUsagePriceRules,
  normalizeUsagePriceRules,
  setUsagePriceRuleEnabled,
  updateUsagePriceRule,
} from "../pricing"
```

- [ ] **Step 2: Run pricing tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/pricing.test.ts
```

Expected: FAIL with missing exports such as `createUsagePriceRule`.

- [ ] **Step 3: Add helper types and persistence function**

In `desktop/electron/services/usage-analysis/pricing.ts`, add these exports after `EstimatedUsageCost`:

```ts
export interface UsageModelPriceRulePatch {
  readonly modelPattern?: string
  readonly inputPer1M?: number
  readonly outputPer1M?: number
  readonly cacheReadPer1M?: number
  readonly cacheWritePer1M?: number
  readonly reasoningPer1M?: number
  readonly enabled?: boolean
}

export interface UsageModelPriceRuleDeleteResult {
  readonly deleted: true
  readonly ruleId: string
}
```

Replace the body of `saveUsagePriceRules` with this implementation and add `replaceUsagePriceRules` immediately below it:

```ts
export function saveUsagePriceRules(database: DatabaseSync, inputs: readonly UsageModelPriceRuleInput[]): UsageModelPriceRule[] {
  const now = new Date().toISOString()
  const rules = normalizeUsagePriceRules(inputs.map((rule, index) => ({
    ...rule,
    source: rule.source ?? "user",
    sortIndex: index,
    updatedAt: now,
  })))
  replaceUsagePriceRules(database, rules)
  return rules
}

function replaceUsagePriceRules(database: DatabaseSync, rules: readonly UsageModelPriceRule[]): void {
  let transactionStarted = false
  database.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    database.exec("DELETE FROM usage_model_prices")
    insertUsagePriceRules(database, rules)
    database.prepare(`
      INSERT OR REPLACE INTO usage_pricing_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(PRICING_SEED_META_KEY, "1", new Date().toISOString())
    database.exec("COMMIT")
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK")
    throw error
  }
}
```

- [ ] **Step 4: Add id-based helper implementation**

Add these functions before `insertUsagePriceRules` in `desktop/electron/services/usage-analysis/pricing.ts`:

```ts
export function findUsagePriceRuleForModel(
  model: string,
  rules: readonly UsageModelPriceRule[] = DEFAULT_USAGE_PRICE_RULES,
): UsageModelPriceRule | null {
  return findRule(model, rules)
}

export function getUsagePriceRule(database: DatabaseSync, ruleId: string): UsageModelPriceRule | null {
  return listUsagePriceRules(database).find((rule) => rule.id === ruleId) ?? null
}

export function createUsagePriceRule(database: DatabaseSync, input: UsageModelPriceRuleInput): UsageModelPriceRule {
  const existing = listUsagePriceRules(database)
  const now = new Date().toISOString()
  const rules = normalizeUsagePriceRules([
    ...existing,
    {
      ...input,
      source: input.source ?? "user",
      sortIndex: existing.length,
      updatedAt: now,
    },
  ])
  replaceUsagePriceRules(database, rules)
  return rules.find((rule) => rule.updatedAt === now && rule.modelPattern === input.modelPattern.trim()) ?? rules[rules.length - 1]
}

export function updateUsagePriceRule(
  database: DatabaseSync,
  ruleId: string,
  patch: UsageModelPriceRulePatch,
): UsageModelPriceRule {
  const existing = listUsagePriceRules(database)
  if (!existing.some((rule) => rule.id === ruleId)) {
    throw new Error(`Model price rule not found: ${ruleId}`)
  }
  const now = new Date().toISOString()
  const rules = normalizeUsagePriceRules(existing.map((rule) => (
    rule.id === ruleId
      ? { ...rule, ...patch, id: rule.id, updatedAt: now }
      : rule
  )))
  replaceUsagePriceRules(database, rules)
  const updated = rules.find((rule) => rule.id === ruleId)
  if (!updated) throw new Error(`Model price rule not found after update: ${ruleId}`)
  return updated
}

export function setUsagePriceRuleEnabled(database: DatabaseSync, ruleId: string, enabled: boolean): UsageModelPriceRule {
  return updateUsagePriceRule(database, ruleId, { enabled })
}

export function deleteUsagePriceRule(database: DatabaseSync, ruleId: string): UsageModelPriceRuleDeleteResult {
  const existing = listUsagePriceRules(database)
  if (!existing.some((rule) => rule.id === ruleId)) {
    throw new Error(`Model price rule not found: ${ruleId}`)
  }
  const rules = normalizeUsagePriceRules(existing.filter((rule) => rule.id !== ruleId))
  replaceUsagePriceRules(database, rules)
  return { deleted: true, ruleId }
}
```

- [ ] **Step 5: Run pricing tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/pricing.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit pricing helpers**

Run:

```bash
git add desktop/electron/services/usage-analysis/pricing.ts desktop/electron/services/usage-analysis/__tests__/pricing.test.ts
git commit -m "feat: add model price rule helpers"
```

## Task 2: Model Price Capability Domain

**Files:**
- Create: `desktop/synapse-capabilities/shared/model-price-domain.ts`
- Modify: `desktop/tests/unit/synapse-capabilities.test.ts`

- [ ] **Step 1: Add failing capability tests**

In `desktop/tests/unit/synapse-capabilities.test.ts`, add this import with the other domain imports:

```ts
import {
  MODEL_PRICE_DOMAIN,
  MODEL_PRICE_MCP_TOOL_ACTIONS,
  buildModelPriceTools,
} from "../../synapse-capabilities/shared/model-price-domain"
```

Add this `describe` block after the top-level `Synapse capability domains` block:

```ts
describe("Model price capability domain", () => {
  it("registers model price actions separately from usage analysis internals", () => {
    expect(MODEL_PRICE_DOMAIN.id).toBe("model_price")
    expect(MODEL_PRICE_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "model_price.used_model.list",
      "model_price.rule.list",
      "model_price.rule.get",
      "model_price.rule.create",
      "model_price.rule.update",
      "model_price.rule.delete",
      "model_price.rule.enable",
      "model_price.rule.disable",
    ])
  })

  it("maps model price MCP tools to canonical actions", () => {
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_used_model_list).toBe("model_price.used_model.list")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_rule_update).toBe("model_price.rule.update")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_rule_disable).toBe("model_price.rule.disable")
  })

  it("defines model price MCP schemas with ruleId-based mutations", () => {
    const tools = buildModelPriceTools()
    expect(tools.find((tool) => tool.name === "model_price_rule_get")?.inputSchema.required).toEqual(["ruleId"])
    expect(tools.find((tool) => tool.name === "model_price_rule_update")?.inputSchema.required).toEqual(["ruleId"])
    expect(tools.find((tool) => tool.name === "model_price_rule_delete")?.inputSchema.required).toEqual(["ruleId"])
    expect(tools.find((tool) => tool.name === "model_price_rule_update")?.inputSchema.properties).not.toHaveProperty("enabled")
  })
})
```

- [ ] **Step 2: Run capability tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts
```

Expected: FAIL because `model-price-domain` does not exist.

- [ ] **Step 3: Create the model price domain**

Create `desktop/synapse-capabilities/shared/model-price-domain.ts`:

```ts
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"
import type { CapabilityId } from "./naming"
import { capabilityIdToMcpTool } from "./naming"

const ruleIdProperty = {
  type: "string",
  description: "Model price rule id. Call model_price_rule_list first when only a model name or pattern is known.",
}

const priceProperty = (label: string) => ({
  type: "number",
  minimum: 0,
  description: `${label} price in CNY per 1M tokens. Use 0 when this token type is not charged.`,
})

const modelPriceCapabilities: readonly CapabilityDefinition[] = [
  { id: "model_price.used_model.list" as CapabilityId, title: "List used models", description: "List models seen in CC and Codex usage data with current price-rule match status.", mutates: false },
  { id: "model_price.rule.list" as CapabilityId, title: "List price rules", description: "List model price rules, including disabled rules.", mutates: false },
  { id: "model_price.rule.get" as CapabilityId, title: "Get price rule", description: "Get one model price rule by ruleId.", mutates: false },
  { id: "model_price.rule.create" as CapabilityId, title: "Create price rule", description: "Create one model price rule.", mutates: true },
  { id: "model_price.rule.update" as CapabilityId, title: "Update price rule", description: "Partially update one model price rule by ruleId.", mutates: true },
  { id: "model_price.rule.delete" as CapabilityId, title: "Delete price rule", description: "Hard-delete one model price rule by ruleId.", mutates: true },
  { id: "model_price.rule.enable" as CapabilityId, title: "Enable price rule", description: "Enable one model price rule.", mutates: true },
  { id: "model_price.rule.disable" as CapabilityId, title: "Disable price rule", description: "Disable one model price rule without deleting it.", mutates: true },
]

export const MODEL_PRICE_DOMAIN: CapabilityDomainDefinition = {
  id: "model_price",
  capabilities: modelPriceCapabilities,
}

export const MODEL_PRICE_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  modelPriceCapabilities.map((capability) => [capabilityIdToMcpTool(capability.id), capability.id]),
)

export function buildModelPriceTools(): McpToolDefinition[] {
  const priceFields = {
    inputPer1M: priceProperty("Input"),
    outputPer1M: priceProperty("Output"),
    cacheReadPer1M: priceProperty("Cache read"),
    cacheWritePer1M: priceProperty("Cache write"),
    reasoningPer1M: priceProperty("Reasoning"),
  }

  return [
    {
      name: "model_price_used_model_list",
      description: "List models used by CC and Codex with current enabled price-rule match status. This reads indexed usage data and does not refresh usage logs.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["all", "cc", "codex"], description: "Usage source filter. Defaults to all." },
          range: { type: "string", enum: ["today", "7d", "30d", "90d", "all"], description: "Usage date range. Defaults to all." },
          limit: { type: "number", minimum: 1, description: "Maximum number of model rows to return. Defaults to 200." },
        },
      },
    },
    {
      name: "model_price_rule_list",
      description: "List all model price rules, including disabled rules. Call this before update, delete, enable, or disable when only a model name is known.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "model_price_rule_get",
      description: "Get one model price rule by ruleId.",
      inputSchema: { type: "object", properties: { ruleId: ruleIdProperty }, required: ["ruleId"] },
    },
    {
      name: "model_price_rule_create",
      description: "Create a model price rule. Prices are CNY per 1M tokens. Missing price fields default to 0 and enabled defaults to true.",
      inputSchema: {
        type: "object",
        properties: {
          modelPattern: { type: "string", description: "Model name substring or wildcard pattern. Must not be empty." },
          ...priceFields,
          enabled: { type: "boolean", description: "Whether the rule participates in matching. Defaults to true." },
        },
        required: ["modelPattern"],
      },
    },
    {
      name: "model_price_rule_update",
      description: "Partially update one model price rule by ruleId. Only provided fields change; omitted prices keep their current values.",
      inputSchema: {
        type: "object",
        properties: {
          ruleId: ruleIdProperty,
          modelPattern: { type: "string", description: "Replacement model pattern. Must not be empty when provided." },
          ...priceFields,
        },
        required: ["ruleId"],
      },
    },
    {
      name: "model_price_rule_delete",
      description: "Hard-delete one model price rule by ruleId.",
      inputSchema: { type: "object", properties: { ruleId: ruleIdProperty }, required: ["ruleId"] },
    },
    {
      name: "model_price_rule_enable",
      description: "Enable one model price rule by ruleId.",
      inputSchema: { type: "object", properties: { ruleId: ruleIdProperty }, required: ["ruleId"] },
    },
    {
      name: "model_price_rule_disable",
      description: "Disable one model price rule by ruleId without deleting it.",
      inputSchema: { type: "object", properties: { ruleId: ruleIdProperty }, required: ["ruleId"] },
    },
  ]
}
```

- [ ] **Step 4: Verify this task has not changed the global registry**

Run:

```bash
git diff --name-only -- desktop/synapse-capabilities/shared desktop/tests/unit/synapse-capabilities.test.ts
```

Expected output:

```text
desktop/synapse-capabilities/shared/model-price-domain.ts
desktop/tests/unit/synapse-capabilities.test.ts
```

- [ ] **Step 5: Run capability tests and verify the standalone domain passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts
```

Expected: PASS. The global API/MCP surface parity test is intentionally updated in Task 4 when routing is wired, so the full focused suite becomes green in one routing commit.

- [ ] **Step 6: Commit standalone domain**

Run:

```bash
git add desktop/synapse-capabilities/shared/model-price-domain.ts desktop/tests/unit/synapse-capabilities.test.ts
git commit -m "feat: add model price capability domain"
```

## Task 3: Model Price Dispatcher

**Files:**
- Create: `desktop/electron/capabilities/model-price-dispatcher.ts`
- Create: `desktop/electron/capabilities/__tests__/model-price-dispatcher.test.ts`

- [ ] **Step 1: Add failing dispatcher tests**

Create `desktop/electron/capabilities/__tests__/model-price-dispatcher.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { initUsageAnalysisSchema } from "../../services/usage-analysis/db-schema"
import { createModelPriceCapabilityDispatcher } from "../model-price-dispatcher"

function createTestDb(): DatabaseSync {
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
  const timestamp = input.timestamp ?? "2026-05-19T01:00:00.000Z"
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

describe("model price capability dispatcher", () => {
  it("creates partially updates disables enables and deletes price rules by ruleId", async () => {
    const db = createTestDb()
    const dispatcher = createModelPriceCapabilityDispatcher({ db })

    const created = await dispatcher.dispatch("model_price.rule.create", {
      modelPattern: "local-model",
      inputPer1M: 14.4,
    }, { source: "api" })
    expect(created.ok).toBe(true)
    expect(created.data).toMatchObject({
      modelPattern: "local-model",
      inputPer1M: 14.4,
      outputPer1M: 0,
      enabled: true,
      currency: "CNY",
    })
    const ruleId = (created.data as { id: string }).id

    const updated = await dispatcher.dispatch("model_price.rule.update", {
      ruleId,
      outputPer1M: 57.6,
    }, { source: "mcp-http" })
    expect(updated.data).toMatchObject({
      id: ruleId,
      inputPer1M: 14.4,
      outputPer1M: 57.6,
    })

    await expect(dispatcher.dispatch("model_price.rule.disable", { ruleId }, { source: "api" }))
      .resolves.toMatchObject({ data: { id: ruleId, enabled: false } })
    await expect(dispatcher.dispatch("model_price.rule.enable", { ruleId }, { source: "api" }))
      .resolves.toMatchObject({ data: { id: ruleId, enabled: true } })
    await expect(dispatcher.dispatch("model_price.rule.delete", { ruleId }, { source: "api" }))
      .resolves.toEqual({ ok: true, data: { deleted: true, ruleId } })

    const rules = await dispatcher.dispatch("model_price.rule.list", {}, { source: "api" })
    expect((rules.data as Array<{ id: string }>).some((rule) => rule.id === ruleId)).toBe(false)
    db.close()
  })

  it("rejects invalid model price params clearly", async () => {
    const db = createTestDb()
    const dispatcher = createModelPriceCapabilityDispatcher({ db })

    await expect(dispatcher.dispatch("model_price.rule.create", { modelPattern: "" }, { source: "api" }))
      .rejects.toThrow(/modelPattern/)
    await expect(dispatcher.dispatch("model_price.rule.create", { modelPattern: "x", inputPer1M: -1 }, { source: "api" }))
      .rejects.toThrow(/inputPer1M/)
    await expect(dispatcher.dispatch("model_price.rule.update", { ruleId: "missing", outputPer1M: 1 }, { source: "api" }))
      .rejects.toThrow(/Model price rule not found/)
    db.close()
  })

  it("lists used models merged across CC and Codex with current enabled rule matching", async () => {
    const db = createTestDb()
    insertUsageEvent(db, "cc", { id: "cc-1", model: "local-model", inputTokens: 100 })
    insertUsageEvent(db, "cx", { id: "cx-1", model: "local-model", inputTokens: 50 })
    insertUsageEvent(db, "cx", { id: "cx-2", model: "other-model", inputTokens: 25 })
    const dispatcher = createModelPriceCapabilityDispatcher({ db })
    const created = await dispatcher.dispatch("model_price.rule.create", {
      modelPattern: "local-model",
      inputPer1M: 1,
    }, { source: "api" })
    const ruleId = (created.data as { id: string }).id

    const all = await dispatcher.dispatch("model_price.used_model.list", {}, { source: "api" })
    expect(all.data).toEqual([
      expect.objectContaining({
        model: "local-model",
        sources: ["cc", "codex"],
        tokens: 150,
        requests: 2,
        priceKnown: true,
        matchedRuleId: ruleId,
        matchedRulePattern: "local-model",
      }),
      expect.objectContaining({
        model: "other-model",
        sources: ["codex"],
        tokens: 25,
        priceKnown: false,
      }),
    ])

    const ccOnly = await dispatcher.dispatch("model_price.used_model.list", { source: "cc" }, { source: "api" })
    expect(ccOnly.data).toEqual([
      expect.objectContaining({ model: "local-model", sources: ["cc"], tokens: 100 }),
    ])

    await dispatcher.dispatch("model_price.rule.disable", { ruleId }, { source: "api" })
    const afterDisable = await dispatcher.dispatch("model_price.used_model.list", { source: "cc" }, { source: "api" })
    expect(afterDisable.data).toEqual([
      expect.objectContaining({ model: "local-model", priceKnown: false }),
    ])
    db.close()
  })

  it("does not change historical usage event costs when rules change", async () => {
    const db = createTestDb()
    insertUsageEvent(db, "cc", {
      id: "cc-priced",
      model: "priced-model",
      inputTokens: 1_000_000,
      priceKnown: true,
      totalCost: 12,
    })
    const dispatcher = createModelPriceCapabilityDispatcher({ db })

    const created = await dispatcher.dispatch("model_price.rule.create", {
      modelPattern: "priced-model",
      inputPer1M: 99,
    }, { source: "api" })
    await dispatcher.dispatch("model_price.rule.update", {
      ruleId: (created.data as { id: string }).id,
      inputPer1M: 111,
    }, { source: "api" })

    expect(db.prepare("SELECT total_cost, price_known FROM cc_usage_events WHERE id = ?").get("cc-priced")).toEqual({
      total_cost: 12,
      price_known: 1,
    })
    db.close()
  })
})
```

- [ ] **Step 2: Run dispatcher tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/model-price-dispatcher.test.ts
```

Expected: FAIL because `createModelPriceCapabilityDispatcher` does not exist.

- [ ] **Step 3: Implement dispatcher validation and rule actions**

Create `desktop/electron/capabilities/model-price-dispatcher.ts` with this implementation:

```ts
import type { DatabaseSync } from "node:sqlite"
import {
  createUsagePriceRule,
  deleteUsagePriceRule,
  findUsagePriceRuleForModel,
  getUsagePriceRule,
  listUsagePriceRules,
  setUsagePriceRuleEnabled,
  updateUsagePriceRule,
  type UsageModelPriceRulePatch,
} from "../services/usage-analysis/pricing"
import { createUsageRangeFilter } from "../services/usage-analysis/range"
import type { UsageRangePreset } from "../services/usage-analysis/types"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"

type ModelPriceSource = "all" | "cc" | "codex"
type UsagePrefix = "cc" | "cx"
type UsageSourceName = "cc" | "codex"

type ModelPriceDispatcherDeps = {
  readonly db: DatabaseSync
}

type UsedModelRow = {
  readonly model: string
  readonly sources: UsageSourceName[]
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

type UsedModelAccumulator = Omit<UsedModelRow, "sources" | "priceKnown" | "matchedRuleId" | "matchedRulePattern"> & {
  readonly sources: Set<UsageSourceName>
}

const RANGE_PRESETS: readonly UsageRangePreset[] = ["today", "7d", "30d", "90d", "all"]
const PRICE_FIELDS = ["inputPer1M", "outputPer1M", "cacheReadPer1M", "cacheWritePer1M", "reasoningPer1M"] as const

export function createModelPriceCapabilityDispatcher(deps: ModelPriceDispatcherDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, _context: DispatchContext): Promise<DispatchResult> {
      switch (action) {
        case "model_price.used_model.list":
          return { ok: true, data: listUsedModels(deps.db, params) }
        case "model_price.rule.list":
          return { ok: true, data: listUsagePriceRules(deps.db) }
        case "model_price.rule.get":
          return { ok: true, data: requireRule(deps.db, requireString(params, "ruleId")) }
        case "model_price.rule.create":
          return { ok: true, data: createUsagePriceRule(deps.db, readCreateParams(params)) }
        case "model_price.rule.update":
          return { ok: true, data: updateUsagePriceRule(deps.db, requireString(params, "ruleId"), readPatchParams(params)) }
        case "model_price.rule.delete":
          return { ok: true, data: deleteUsagePriceRule(deps.db, requireString(params, "ruleId")) }
        case "model_price.rule.enable":
          return { ok: true, data: setUsagePriceRuleEnabled(deps.db, requireString(params, "ruleId"), true) }
        case "model_price.rule.disable":
          return { ok: true, data: setUsagePriceRuleEnabled(deps.db, requireString(params, "ruleId"), false) }
        default:
          throw new Error(`Unknown action: ${action}`)
      }
    },
  }
}
```

- [ ] **Step 4: Add dispatcher helper functions**

Append these helper functions to the same file:

```ts
function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  }
  return value.trim()
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`Invalid '${key}': expected boolean`)
  return value
}

function optionalPrice(params: Record<string, unknown>, key: typeof PRICE_FIELDS[number]): number | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid '${key}': expected number >= 0`)
  }
  return value
}

function readCreateParams(params: Record<string, unknown>) {
  return {
    modelPattern: requireString(params, "modelPattern"),
    inputPer1M: optionalPrice(params, "inputPer1M"),
    outputPer1M: optionalPrice(params, "outputPer1M"),
    cacheReadPer1M: optionalPrice(params, "cacheReadPer1M"),
    cacheWritePer1M: optionalPrice(params, "cacheWritePer1M"),
    reasoningPer1M: optionalPrice(params, "reasoningPer1M"),
    enabled: optionalBoolean(params, "enabled") ?? true,
  }
}

function readPatchParams(params: Record<string, unknown>): UsageModelPriceRulePatch {
  const patch: UsageModelPriceRulePatch = {}
  if ("modelPattern" in params) patch.modelPattern = requireString(params, "modelPattern")
  for (const field of PRICE_FIELDS) {
    if (field in params) {
      const value = optionalPrice(params, field)
      if (value !== undefined) patch[field] = value
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("No model price fields provided for update")
  }
  return patch
}

function requireRule(db: DatabaseSync, ruleId: string) {
  const rule = getUsagePriceRule(db, ruleId)
  if (!rule) throw new Error(`Model price rule not found: ${ruleId}`)
  return rule
}

function normalizeSource(value: unknown): ModelPriceSource {
  if (value === undefined) return "all"
  if (value === "all" || value === "cc" || value === "codex") return value
  throw new Error("Invalid 'source': expected all, cc, or codex")
}

function normalizeRange(value: unknown): UsageRangePreset {
  if (value === undefined) return "all"
  if (typeof value === "string" && RANGE_PRESETS.includes(value as UsageRangePreset)) return value as UsageRangePreset
  throw new Error("Invalid 'range': expected today, 7d, 30d, 90d, or all")
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return 200
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error("Invalid 'limit': expected positive number")
  }
  return Math.floor(value)
}
```

- [ ] **Step 5: Add used-model query implementation**

Append these functions to `desktop/electron/capabilities/model-price-dispatcher.ts`:

```ts
function selectedSources(source: ModelPriceSource): Array<{ prefix: UsagePrefix; name: UsageSourceName }> {
  if (source === "cc") return [{ prefix: "cc", name: "cc" }]
  if (source === "codex") return [{ prefix: "cx", name: "codex" }]
  return [
    { prefix: "cc", name: "cc" },
    { prefix: "cx", name: "codex" },
  ]
}

function listUsedModels(db: DatabaseSync, params: Record<string, unknown>): UsedModelRow[] {
  const source = normalizeSource(params.source)
  const range = normalizeRange(params.range)
  const limit = normalizeLimit(params.limit)
  const rules = listUsagePriceRules(db)
  const byModel = new Map<string, UsedModelAccumulator>()

  for (const item of selectedSources(source)) {
    for (const row of queryUsedModels(db, item.prefix, range)) {
      const current = byModel.get(row.model) ?? {
        model: row.model,
        sources: new Set<UsageSourceName>(),
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
      const matchedRule = findUsagePriceRuleForModel(row.model, rules)
      return {
        ...row,
        sources: [...row.sources].sort(),
        priceKnown: matchedRule !== null,
        ...(matchedRule ? { matchedRuleId: matchedRule.id, matchedRulePattern: matchedRule.modelPattern } : {}),
      }
    })
}

function queryUsedModels(db: DatabaseSync, prefix: UsagePrefix, preset: UsageRangePreset): Array<Omit<UsedModelAccumulator, "sources">> {
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

- [ ] **Step 6: Run dispatcher tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/model-price-dispatcher.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit dispatcher**

Run:

```bash
git add desktop/electron/capabilities/model-price-dispatcher.ts desktop/electron/capabilities/__tests__/model-price-dispatcher.test.ts
git commit -m "feat: add model price dispatcher"
```

## Task 4: Action Router And Bootstrap Wiring

**Files:**
- Modify: `desktop/synapse-capabilities/shared/registry.ts`
- Modify: `desktop/tests/unit/synapse-capabilities.test.ts`
- Modify: `desktop/electron/capabilities/action-router.ts`
- Modify: `desktop/electron/capabilities/__tests__/action-router.test.ts`
- Modify: `desktop/tests/unit/api-mcp-capability-surface.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`

- [ ] **Step 1: Add failing action-router test**

In `desktop/electron/capabilities/__tests__/action-router.test.ts`, update `createRouterDeps`:

```ts
function createRouterDeps(overrides: Partial<Parameters<typeof createSynapseActionRouter>[0]> = {}) {
  return {
    contentDispatch: vi.fn(),
    databaseDispatch: vi.fn(),
    modelPriceDispatch: vi.fn(),
    schedulerDispatch: vi.fn(),
    workflowDispatch: vi.fn(),
    ...overrides,
  }
}
```

Add this test before the Scheduler routing test:

```ts
  it("routes Model Price actions to the Model Price dispatcher", async () => {
    const modelPriceDispatch = vi.fn(() => ({ ok: true as const, data: ["rules"] }))
    const deps = createRouterDeps({
      modelPriceDispatch,
    })
    const router = createSynapseActionRouter(deps)

    await expect(router.dispatch("model_price.rule.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: ["rules"],
    })
    expect(modelPriceDispatch).toHaveBeenCalledWith("model_price.rule.list", {}, { source: "api" })
    expect(deps.contentDispatch).not.toHaveBeenCalled()
    expect(deps.databaseDispatch).not.toHaveBeenCalled()
    expect(deps.schedulerDispatch).not.toHaveBeenCalled()
    expect(deps.workflowDispatch).not.toHaveBeenCalled()
  })
```

In `desktop/tests/unit/synapse-capabilities.test.ts`, add this test to the `Model price capability domain` block:

```ts
  it("combines model price tools with all MCP tools", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)
    expect(toolNames).toContain("model_price_used_model_list")
    expect(toolNames).toContain("model_price_rule_create")
    expect(toolNames).toContain("model_price_rule_delete")
    expect(MCP_TOOL_ACTIONS.model_price_rule_enable).toBe("model_price.rule.enable")
    expect(getActionDomainId("model_price.rule.list")).toBe("model_price")
  })
```

In `desktop/tests/unit/api-mcp-capability-surface.test.ts`, extend the dispatchers object and router setup:

```ts
    const dispatchers = {
      content: vi.fn(async () => ({ ok: true as const })),
      database: vi.fn(async () => ({ ok: true as const })),
      model_price: vi.fn(async () => ({ ok: true as const })),
      scheduler: vi.fn(async () => ({ ok: true as const })),
      workflow: vi.fn(async () => ({ ok: true as const })),
    }
    const router = createSynapseActionRouter({
      contentDispatch: dispatchers.content,
      databaseDispatch: dispatchers.database,
      modelPriceDispatch: dispatchers.model_price,
      schedulerDispatch: dispatchers.scheduler,
      workflowDispatch: dispatchers.workflow,
    })
```

- [ ] **Step 2: Run action-router tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts tests/unit/synapse-capabilities.test.ts tests/unit/api-mcp-capability-surface.test.ts
```

Expected: FAIL because the global registry does not include model price tools and the router does not accept `modelPriceDispatch`.

- [ ] **Step 3: Update action router**

In `desktop/electron/capabilities/action-router.ts`, add the new dependency:

```ts
export type SynapseActionRouterDeps = {
  readonly contentDispatch: DomainDispatch
  readonly databaseDispatch: DomainDispatch
  readonly modelPriceDispatch: DomainDispatch
  readonly schedulerDispatch: DomainDispatch
  readonly workflowDispatch: DomainDispatch
}
```

Add the route branch in `createSynapseActionRouter`:

```ts
      if (domainId === "model_price") return deps.modelPriceDispatch(action, params, context)
```

Place it after the database branch and before scheduler.

- [ ] **Step 4: Register the model price domain globally**

Modify `desktop/synapse-capabilities/shared/registry.ts`:

```ts
import {
  MODEL_PRICE_DOMAIN,
  MODEL_PRICE_MCP_TOOL_ACTIONS,
  buildModelPriceTools,
} from "./model-price-domain"
```

Add `MODEL_PRICE_DOMAIN` to `CAPABILITY_DOMAINS` after `DATABASE_DOMAIN`:

```ts
export const CAPABILITY_DOMAINS: readonly CapabilityDomainDefinition[] = [
  DATABASE_DOMAIN,
  MODEL_PRICE_DOMAIN,
  SCHEDULER_DOMAIN,
  WORKFLOW_DOMAIN,
  CONTENT_DOMAIN,
]
```

Add model price actions and tools:

```ts
export const MCP_TOOL_ACTIONS: Record<string, string> = {
  ...buildDatabaseMcpToolActions(),
  ...MODEL_PRICE_MCP_TOOL_ACTIONS,
  ...SCHEDULER_MCP_TOOL_ACTIONS,
  ...WORKFLOW_MCP_TOOL_ACTIONS,
  ...CONTENT_MCP_TOOL_ACTIONS,
}

export function buildAllMcpTools(): McpToolDefinition[] {
  return [
    ...buildDatabaseTools(),
    ...buildModelPriceTools(),
    ...buildSchedulerTools(),
    ...buildWorkflowTools(),
    ...buildContentTools(),
  ]
}
```

- [ ] **Step 5: Wire bootstrap**

In `desktop/electron/bootstrap/descriptors.ts`, add imports near the existing capability imports:

```ts
import { createModelPriceCapabilityDispatcher } from "../capabilities/model-price-dispatcher"
import { getUsageAnalysisDb } from "../services/usage-analysis"
```

Inside the `core.database` descriptor `start` function, before `const actionRouter = createSynapseActionRouter({ ... })`, add:

```ts
    const modelPriceDispatcher = createModelPriceCapabilityDispatcher({
      db: getUsageAnalysisDb(app.getPath("userData")),
    })
```

Pass the dispatcher to the router:

```ts
      modelPriceDispatch: (action, params, context) => modelPriceDispatcher.dispatch(action, params, context),
```

The resulting router block should contain:

```ts
    const actionRouter = createSynapseActionRouter({
      contentDispatch: (action, params, context) => contentDispatcher.dispatch(action, params, context),
      databaseDispatch: dispatchDatabaseAction,
      modelPriceDispatch: (action, params, context) => modelPriceDispatcher.dispatch(action, params, context),
      schedulerDispatch: (action, params) => dispatchSchedulerAction(taskScheduler, actionRuntime, action, params),
      workflowDispatch: (action, params, context) => workflowDispatcher.dispatch(action, params, context),
    })
```

- [ ] **Step 6: Run router and parity tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts tests/unit/synapse-capabilities.test.ts tests/unit/api-mcp-capability-surface.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run focused MCP RPC regression**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/database/__tests__/mcp-server.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit routing**

Run:

```bash
git add desktop/synapse-capabilities/shared/registry.ts desktop/tests/unit/synapse-capabilities.test.ts desktop/electron/capabilities/action-router.ts desktop/electron/capabilities/__tests__/action-router.test.ts desktop/tests/unit/api-mcp-capability-surface.test.ts desktop/electron/bootstrap/descriptors.ts
git commit -m "feat: route model price capabilities"
```

## Task 5: Built-In Skill Template

**Files:**
- Create: `desktop/resources/templates/skills/synapse-model-price-mcp/meta.json`
- Create: `desktop/resources/templates/skills/synapse-model-price-mcp/content.md`
- Create: `desktop/resources/templates/skills/synapse-model-price-mcp/files/api-reference.md`

- [ ] **Step 1: Create skill metadata**

Create `desktop/resources/templates/skills/synapse-model-price-mcp/meta.json`:

```json
{
  "id": "synapse-model-price-mcp",
  "name": "synapse-model-price-mcp",
  "title": "Synapse 价格规则 MCP",
  "usage": "让 AI 通过 Synapse MCP 管理模型价格规则：查看已用模型、补充价格、调整价格、禁用或删除规则。\n\n- **适合**：补全未定价模型、按 ruleId 调整价格、清理错误规则。\n- **会做**：先列出已用模型或规则，再用 ruleId 执行写操作。\n- **不适合**：历史费用重算、数据库表维护、工作流或定时任务管理。",
  "description": "Use when working with Synapse model price rules through MCP tools.",
  "category": "data",
  "icon": "terminal",
  "iconBg": "teal"
}
```

- [ ] **Step 2: Create skill instructions**

Create `desktop/resources/templates/skills/synapse-model-price-mcp/content.md`:

```md
# Synapse 价格规则 MCP

You have access to Synapse Model Price MCP tools for listing used models and managing model price rules.

## Scope Boundary

Use this skill only for Synapse model price rules:

- list used CC/Codex models;
- list or inspect price rules;
- create price rules;
- partially update price rules;
- enable, disable, or delete price rules.

Do not use this skill for Database tables, Scheduler tasks, Workflow definitions, built-in content publishing, provider settings, editor installation, or historical usage repricing.

## Default Flow

1. If the user asks which models need prices, call `model_price_used_model_list`.
2. If the user asks to change, delete, enable, or disable an existing rule, call `model_price_rule_list` first and use the returned `id` as `ruleId`.
3. Use `model_price_rule_get` when the user names a specific rule id or when you need to inspect one rule before changing it.
4. Use `model_price_rule_create` only when no existing rule should be changed.
5. Use `model_price_rule_update` for partial price or pattern edits. Pass only fields that should change.
6. Use `model_price_rule_disable` to keep a rule but stop matching it.
7. Use `model_price_rule_delete` only when the user wants the rule removed.

## Safety Rules

- Mutating operations must use `ruleId`.
- Do not update or delete by guessing from `modelPattern`.
- If multiple rules could match the user's model, ask which rule to change.
- Prices are RMB per 1M tokens.
- `0` is valid for a token type that is not charged.
- Do not claim that price edits changed historical usage costs.
- Do not trigger or simulate historical repricing.

## Matching Notes

`model_price_used_model_list` returns `priceKnown`, `matchedRuleId`, and `matchedRulePattern` based on currently enabled rules. This indicates current rule coverage only. It does not prove that older usage events were priced.

## API Reference

See the attached `api-reference.md` for tool signatures, fields, and common flows.
```

- [ ] **Step 3: Create skill API reference**

Create `desktop/resources/templates/skills/synapse-model-price-mcp/files/api-reference.md`:

```md
# Synapse 价格规则 MCP API Reference

All tools are accessed through the `synapse-mcp` MCP server. Each tool maps to the same canonical Synapse API action.

## Tools

### model_price_used_model_list

Canonical action: `model_price.used_model.list`

Input:

```json
{
  "source": "all",
  "range": "all",
  "limit": 200
}
```

Fields:

- `source`: `all`, `cc`, or `codex`. Defaults to `all`.
- `range`: `today`, `7d`, `30d`, `90d`, or `all`. Defaults to `all`.
- `limit`: positive number. Defaults to `200`.

Returns model rows sorted by tokens:

```json
{
  "model": "local-model",
  "sources": ["cc", "codex"],
  "tokens": 1500000,
  "requests": 2,
  "pricedTokens": 0,
  "unpricedTokens": 1500000,
  "estimatedCost": 0,
  "input": 1000000,
  "output": 500000,
  "cacheRead": 0,
  "cacheWrite": 0,
  "reasoning": 0,
  "priceKnown": false
}
```

`priceKnown` means the current enabled rule set matches the model.

### model_price_rule_list

Canonical action: `model_price.rule.list`

Input:

```json
{}
```

Returns all rules, including disabled rules.

### model_price_rule_get

Canonical action: `model_price.rule.get`

Input:

```json
{ "ruleId": "local-model" }
```

Returns one rule.

### model_price_rule_create

Canonical action: `model_price.rule.create`

Input:

```json
{
  "modelPattern": "local-model",
  "inputPer1M": 14.4,
  "outputPer1M": 57.6,
  "cacheReadPer1M": 0,
  "cacheWritePer1M": 0,
  "reasoningPer1M": 57.6,
  "enabled": true
}
```

Only `modelPattern` is required. Missing price fields default to `0`. Prices are CNY per 1M tokens.

### model_price_rule_update

Canonical action: `model_price.rule.update`

Input:

```json
{
  "ruleId": "local-model",
  "outputPer1M": 72
}
```

Only provided fields change.

### model_price_rule_enable

Canonical action: `model_price.rule.enable`

Input:

```json
{ "ruleId": "local-model" }
```

Returns the enabled rule.

### model_price_rule_disable

Canonical action: `model_price.rule.disable`

Input:

```json
{ "ruleId": "local-model" }
```

Returns the disabled rule.

### model_price_rule_delete

Canonical action: `model_price.rule.delete`

Input:

```json
{ "ruleId": "local-model" }
```

Returns:

```json
{ "deleted": true, "ruleId": "local-model" }
```

## Common Flows

### Find models without prices

1. Call `model_price_used_model_list` with `{ "source": "all", "range": "all" }`.
2. Select rows where `priceKnown` is `false`.
3. Ask the user for prices when the request did not include them.
4. Call `model_price_rule_create`.

### Update one price

1. Call `model_price_rule_list`.
2. Find the intended rule id.
3. If multiple rules could match, ask the user to choose.
4. Call `model_price_rule_update` with only the changed price field.

### Remove a wrong rule

1. Call `model_price_rule_list`.
2. Confirm the intended `ruleId`.
3. Call `model_price_rule_delete` for hard delete, or `model_price_rule_disable` to keep the rule inactive.
```

- [ ] **Step 4: Validate metadata JSON**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('desktop/resources/templates/skills/synapse-model-price-mcp/meta.json', 'utf8')); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 5: Commit built-in skill**

Run:

```bash
git add desktop/resources/templates/skills/synapse-model-price-mcp
git commit -m "feat: add model price mcp skill"
```

## Task 6: Release Notes And Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add pending release note**

Under `## 新增功能` in `RELEASE_NOTES_PENDING.md`, add:

```md
- 新增 Synapse 价格规则 MCP 能力和内置技能，Agent 可以查看已用模型、补充或调整模型价格规则，并通过禁用或删除管理错误规则；改价不会重算历史费用。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/pricing.test.ts electron/capabilities/__tests__/model-price-dispatcher.test.ts electron/capabilities/__tests__/action-router.test.ts tests/unit/synapse-capabilities.test.ts tests/unit/api-mcp-capability-surface.test.ts electron/database/__tests__/mcp-server.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Commit release note and final fixes**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note model price mcp"
```

If verification required code fixes, include the fixed files in this commit only when the fix belongs to the current model-price MCP work.

## Self-Review Notes

- Spec coverage:
  - `model_price` domain and API/MCP parity: Tasks 2 and 4.
  - Used-model listing with merged CC/Codex, source filter, range default, and match status: Task 3.
  - Rule list/get/create/update/delete/enable/disable by `ruleId`: Tasks 1 and 3.
  - Partial update preserving omitted fields: Tasks 1 and 3.
  - No historical repricing: Task 3 regression and Task 6 release note.
  - Built-in skill `Synapse 价格规则 MCP`: Task 5.
- Placeholder scan: no placeholder steps are present.
- Type consistency:
  - Domain id is `model_price`.
  - Used model tool is `model_price_used_model_list`.
  - Rule id parameter is consistently `ruleId`.
  - Currency remains `CNY`.
