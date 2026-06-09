# Model Price First-Class Module Design

## Summary

Refactor Synapse model price management into a first-class `model-price` module. Price rules, model coverage, cost estimation, and MCP dispatch should no longer live under CC or Codex usage-analysis boundaries.

The refactor intentionally creates a new price-rule table and initializes it from built-in defaults only. The legacy `usage_model_prices` table is not migrated, read, or written by the new module.

## Goals

- Add a top-level `价格` module between `Codex` and `设置`.
- Move price rule UI out of the CC and Codex usage pages.
- Add a model coverage view that shows used CC/Codex models and whether current rules match them.
- Make `model-price` the single calculation boundary for CC, Codex, Agent, Workflow, and MCP model cost estimates.
- Keep the existing `model_price.*` MCP action and tool names.
- Initialize the new model price tables from current built-in defaults on startup.

## Non-Goals

- No migration from `usage_model_prices`.
- No automatic historical repricing.
- No manual historical repricing UI in this implementation.
- No external price fetching.
- No provider-specific pricing rules.
- No multi-currency UI.
- No redesign of CC or Codex usage reports beyond removing their price-rule button.

## Current Context

Current model pricing is owned by usage analysis:

- default rules and matching live in `desktop/electron/services/usage-analysis/pricing.ts`;
- editable rules are stored in `usage_model_prices`;
- renderer editing lives in `desktop/src/modules/usage-analysis/shared/components/pricing-rules-dialog.tsx`;
- CC and Codex pages expose the same `价格规则` dialog from their headers;
- MCP already exposes a `model_price` capability domain, but its dispatcher still imports usage-analysis pricing functions.

This creates a naming and ownership mismatch. Price rules are shared by CC, Codex, Agent, Workflow, and MCP, so they should not be owned by either CC or Codex usage pages.

## Product Shape

Top-level navigation becomes:

```text
... IDE · CC · Codex · 价格 · 设置
```

The `价格` module has two views:

- `模型覆盖`: default view. It lists models seen in CC and Codex usage events, their sources, token totals, pricing status, matched rule, and estimated stored cost. Unpriced rows can start rule creation.
- `价格规则`: editable rule table. It keeps the existing columns: enabled, model pattern, input, output, cache read, cache write, reasoning, and row actions.

The CC and Codex usage-analysis headers keep their range and refresh controls, but no longer show `价格规则`.

UI follows the existing shadcn/Radix baseline. No custom colors, inline styling, card nesting, decorative gradients, or explanatory product copy are needed.

## Main Process Architecture

Add a new service boundary:

```text
desktop/electron/services/model-price/
  index.ts
  db-schema.ts
  defaults.ts
  matching.ts
  service.ts
  coverage.ts
  types.ts
```

The service owns:

- schema initialization for new model price tables;
- default rule insertion;
- rule normalization, matching, ordering, CRUD, enable/disable, and reset;
- model coverage aggregation from CC/Codex usage events;
- cost estimation from model name plus token breakdown.

`usage-analysis` continues to own usage parsing, usage events, aggregates, reports, and scan state. It consumes model-price estimation but does not own rule storage or matching.

## New Tables

Create new tables in the existing usage-analysis SQLite database:

```sql
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
);
```

```sql
CREATE TABLE IF NOT EXISTS model_price_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Startup initialization:

1. Ensure both tables exist.
2. Read `model_price_meta.initialized_from_defaults_v1`.
3. If the marker exists, do nothing.
4. If the marker is missing, insert the built-in default rule set into `model_price_rules`.
5. Write the marker only after defaults are inserted successfully.

The legacy `usage_model_prices` table is ignored. Existing user customizations in that table do not carry forward.

## Rule Model

The rule shape remains compatible with the current renderer and MCP shape:

```ts
{
  id: string
  modelPattern: string
  inputPer1M: number
  outputPer1M: number
  cacheReadPer1M: number
  cacheWritePer1M: number
  reasoningPer1M: number
  currency: "CNY"
  enabled: boolean
  source: "builtin" | "user"
  sortIndex: number
  updatedAt: string
}
```

Rules match by the existing semantics:

- enabled rules only;
- wildcard `*` supports regex-like full-pattern matching;
- non-wildcard patterns match by case-insensitive substring;
- order is `sortIndex ASC`, then longer pattern first.

## Cost Estimation

`model-price` exposes a single estimation function:

```ts
estimateModelUsageCost(input: {
  model: string
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    reasoning: number
  }
}): {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  total: number
  priceKnown: boolean
  matchedRuleId?: string
  matchedRulePattern?: string
  currency: "CNY"
}
```

Consumers:

- CC parser prices newly inserted CC usage events through this function.
- Codex parser prices newly inserted Codex usage events through this function.
- Agent usage snapshots use this function when producing local CNY cost snapshots.
- Workflow token usage snapshots use the same estimate path.
- MCP coverage uses current enabled rules for match status.

If estimation fails or no rule matches, consumers should surface `priceKnown: false` and use existing `未定价` behavior. They must not silently convert failure into a priced zero-cost row.

## Model Coverage

`model-price` exposes coverage aggregation:

```ts
{
  source?: "all" | "cc" | "codex"
  range?: "today" | "7d" | "30d" | "90d" | "all"
  limit?: number
}
```

Rows:

```ts
{
  model: string
  sources: ("cc" | "codex")[]
  tokens: number
  requests: number
  pricedTokens: number
  unpricedTokens: number
  estimatedCost: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  priceKnown: boolean
  matchedRuleId?: string
  matchedRulePattern?: string
}
```

Coverage reads existing indexed usage data. It does not trigger usage refresh or repricing.

`priceKnown` means the current enabled rule set can match the model. It does not prove historical events were priced.

## Renderer Architecture

Add:

```text
desktop/src/modules/model-price/
  index.tsx
  hooks.ts
  types.ts
  components/model-coverage-view.tsx
  components/price-rules-view.tsx
```

Add bridge APIs under a new first-class namespace:

```ts
window.synapse.modelPrice.listRules()
window.synapse.modelPrice.saveRules(rules)
window.synapse.modelPrice.resetRules()
window.synapse.modelPrice.listCoverage(input)
```

The old `usageAnalysis.getPricingRules`, `usageAnalysis.savePricingRules`, and `usageAnalysis.resetPricingRules` should be retired or left only as temporary compatibility wrappers during the refactor. New renderer code must use `modelPrice`.

## IPC And Preload

Add new channels:

```text
synapse:model-price:rules:list
synapse:model-price:rules:save
synapse:model-price:rules:reset
synapse:model-price:coverage:list
```

IPC handlers live in a model-price IPC module, not in `electron/usage-analysis/ipc-handlers.ts`. Registration must follow the existing IPC boundary and must not introduce naked `ipcMain.handle/on` outside the runtime IPC layer.

Handlers validate inputs in the main process, call `model-price` service methods, and return normalized rule or coverage data.

## MCP

Keep the public MCP contract:

```text
model_price_used_model_list
model_price_rule_list
model_price_rule_get
model_price_rule_create
model_price_rule_update
model_price_rule_delete
model_price_rule_enable
model_price_rule_disable
```

The action domain remains `model_price`.

Change the dispatcher implementation so `desktop/electron/capabilities/model-price-dispatcher.ts` depends on the new `model-price` service instead of importing `usage-analysis/pricing.ts`.

Mutation rules remain:

- writes use `ruleId`;
- partial update keeps omitted fields unchanged;
- enable/disable remain separate actions;
- delete is hard delete;
- mutating MCP actions continue through `PermissionGuard` and `AuditSink`;
- MCP never triggers historical repricing.

## Historical Cost Semantics

Default behavior:

- price changes affect future newly parsed usage events;
- price changes affect future Agent and Workflow cost snapshots;
- existing usage events keep their stored costs;
- existing Agent and Workflow snapshots keep their stored costs;
- coverage can show current rule match status but must not imply historical rows were repriced.

Manual historical repricing is a future feature. It should require explicit user confirmation and a result summary, and it should not be included in this refactor.

## Error Handling

- Model-price table initialization failure must not silently fall back to `usage_model_prices`.
- Rule save failure leaves existing rules unchanged.
- Coverage query failure affects only the price module view.
- CC/Codex report pages should continue to open if coverage fails.
- Agent/Workflow estimation failures should produce unpriced snapshots or clear diagnostics, not priced zero-cost records.
- Logs must use structured logger paths and avoid leaking secrets.

## Release Notes

This is user-visible. Update `RELEASE_NOTES_PENDING.md` during implementation with a short note that price management moved to a standalone module and now includes model coverage.

## Testing

Focused tests should cover:

- empty database initializes `model_price_rules` from built-in defaults;
- initialization marker prevents duplicate default insertion;
- old `usage_model_prices` rows are ignored;
- rule CRUD, enable, disable, delete, save, and reset use the new table;
- rule matching behavior stays compatible;
- coverage merges CC and Codex used models and marks current match status;
- CC parser prices new usage events through model-price service;
- Codex parser prices new usage events through model-price service;
- Agent and Workflow cost snapshots use the new estimation boundary;
- MCP tool names and action ids remain unchanged;
- MCP dispatcher reads/writes through the new service;
- top-level navigation includes `价格` between `Codex` and `设置`;
- CC and Codex pages no longer render the price-rule button;
- price module renders `模型覆盖` and `价格规则`.

Validation commands:

```bash
pnpm --filter @synapse/desktop test -- model-price usage-analysis
pnpm --filter @synapse/desktop run check:hard-constraints
```
