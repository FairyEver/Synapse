# Workflow Token Usage Tab Design

## Background

Workflow runs already record token usage on individual Agent-backed nodes. The Runner window currently has `DAG` and `时间线` views, and node details can show a compact token summary. Users still cannot see a run-level bill: which nodes consumed tokens, which model each node used, how each token category contributed, and what the final cost was.

This design adds a dedicated `Token` tab to the workflow Runner. The tab is a run ledger, not a dashboard. It uses the same pricing semantics as Agent conversations: prices are estimated from Synapse model price rules and the effective model, not from Claude Code or SDK-returned cost fields.

## Goals

- Add a third Runner view: `DAG | 时间线 | Token`.
- Show one table of token-consuming nodes in execution order.
- Show each node's effective model, token categories, and estimated CNY cost.
- Add a final `合计` row at the bottom of the table.
- Preserve historical run cost: reopening history shows the price snapshot calculated when the node finished.
- Use existing shadcn/Radix components, Tailwind token classes, and restrained UI copy.

## Non-Goals

- Do not modify the Agent conversation usage card.
- Do not add top summary metric cards above the table.
- Do not build a global workflow cost dashboard.
- Do not recalculate historical run costs from current price rules when the user reopens history.
- Do not use Claude Code or SDK returned `costUsd` / `costCny` as the workflow billing source.
- Do not add a pricing-rule editor inside the workflow Runner.

## Current Code Context

- Agent conversation usage card:
  - `desktop/src/modules/agent/components/agent-usage-card.tsx`
  - `desktop/src/modules/agent/utils/agent-usage-card.ts`
- Generic compact usage summary:
  - `desktop/src/components/token-usage-summary.tsx`
  - `desktop/src/lib/token-usage.ts`
- Agent cost estimation source:
  - `desktop/electron/services/usage-analysis/pricing.ts`
  - `desktop/electron/services/agent-runtime/conversation-router.ts`
- Workflow Runner views:
  - `desktop/src/modules/workflow/runner/runner-toolbar.tsx`
  - `desktop/src/modules/workflow/runner/runner-app.tsx`
  - `desktop/src/modules/workflow/runner/timeline-view.tsx`
- Workflow node result type:
  - `desktop/src/types/workflow.ts`
- Workflow execution:
  - `desktop/electron/services/workflow/workflow-engine.ts`
  - `desktop/workflow-nodes/types.ts`
  - `desktop/workflow-nodes/prompt/executor.main.ts`
  - `desktop/workflow-nodes/switch/executor.main.ts`

## Hard Rules

- Workflow node costs must be calculated from the effective model name and Synapse usage price rules.
- Workflow node costs must ignore SDK / Claude Code cost fields for UI billing.
- Cost calculation must happen during the run, before the node result is persisted in active status and terminal snapshots.
- Historical runs must display the saved cost snapshot.
- Nodes without matching price rules must be marked `未定价`; their token counts remain visible, and their cost is not added to the priced total.
- UI must not add top-level summary cards. The only run-level totals appear in the table footer.
- Styling must use existing shadcn/Radix components and token classes only.

## Data Model

Extend workflow node execution and renderer-facing results with a saved usage-cost snapshot.

```ts
type WorkflowUsageCostBreakdownCny = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
}

interface WorkflowNodeUsageCostSnapshot {
  modelName?: string
  costCny?: number
  costBreakdownCny?: WorkflowUsageCostBreakdownCny
  costCurrency?: "CNY"
  priceKnown?: boolean
  estimatedCost?: boolean
}
```

`NodeRunResult` must carry this as `usageCost?: WorkflowNodeUsageCostSnapshot`. The Token tab must read workflow billing data from `usageCost`, not from legacy top-level `costUsd` / `costCny` fields. Keeping the billing snapshot in one object makes the approved pricing source explicit and avoids mixing old SDK-derived fields into the new table.

The renderer needs:

- `usage`: existing token payload.
- `usageCost.modelName`: actual model string used for price matching and display.
- `usageCost.costCny`: calculated from Synapse price rules.
- `usageCost.costBreakdownCny`: calculated per token category.
- `usageCost.priceKnown`: whether a price rule matched the model.
- `usageCost.estimatedCost`: true when Synapse estimated the cost from usage and price rules.

## Effective Model

Workflow prompt and switch nodes already resolve provider/model from node config or workflow defaults before execution. The cost snapshot must use the resolved model name, not just `providerId` or `modelTier`.

The workflow engine must receive the effective model string used by the Agent runtime. If the runtime result metadata already carries it, workflow uses that value. If not, extend `sendToAgent` and its scheduled Agent result type so workflow receives `modelName` alongside `usage`. Do not infer display pricing from provider ID alone.

## Cost Calculation

Use the existing pricing helper:

```ts
estimateUsageCost(modelName, usageTokenBreakdown(usage), priceRules)
```

The currently relevant code path in Agent conversations is:

- read rules from `getUsagePriceRules`
- normalize usage into token categories
- call `estimateUsageCost`
- save `costCny`, `costBreakdownCny`, `costCurrency: "CNY"`, `estimatedCost: true`

Workflow must share this logic instead of duplicating it. Extract a main-process utility near `desktop/electron/services/usage-analysis/` that both Agent conversations and workflow engine can call. The utility returns the usage-cost snapshot shape, so both call sites keep the same pricing behavior.

The extracted helper must return undefined when:

- usage is missing
- model name is missing
- no price rule matches

It must not fall back to SDK `costUsd` conversion.

## UI Design

Add a `Token` view button in `RunnerToolbar` beside `DAG` and `时间线`.

The Token view contains one main table:

| 节点 | 模型 | 输入 | 输出 | 缓存读 | 缓存写 | 思考 | 费用 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2. 生成10套标题 | deepseek-v4 | 12,440 | 1,260 | 18,200 | 0 | -- | ¥0.18 |
| 3A. 文学维度评分 | deepseek-v4 | 9,110 | 860 | 21,400 | 420 | -- | ¥0.16 |
| 合计 | 9 个节点 | 78,930 | 8,780 | 181,000 | 1,500 | 300 | ¥1.42 |

Rules:

- Table is sorted by `startedAt` for nodes that have it, then by workflow node order.
- Pending, running, skipped, and non-token nodes are omitted unless they later produce usage.
- Numeric columns are right-aligned and use tabular numbers.
- The footer row is sticky if the table scrolls.
- `思考` is shown when any node has reasoning tokens; otherwise the column is hidden.
- For unpriced nodes, show `未定价` in the fee cell.
- If some nodes are unpriced, the footer fee shows the priced total and a compact unpriced marker, for example `¥1.42 · 部分定价`.
- Do not show explanatory paragraphs in the UI.

The optional right-side model summary from the prototype is out of scope for the first implementation. The first version stays to the single table the user approved.

## Live Run Behavior

During an active run:

- The Token tab is available immediately.
- It updates as node results arrive.
- A node appears when its `NodeRunResult` has usage data.
- The footer total updates with each priced node.
- Running nodes without usage are not shown in the token table.

For terminal runs:

- The table reads from saved `nodeResults`.
- It does not reprice from current rules.
- If old snapshots have usage but no saved Synapse cost snapshot, show tokens and `未定价` rather than using legacy SDK cost.

## Error Handling

- Missing usage: omit the node from the Token table.
- Invalid usage fields: normalize missing categories to 0, following existing token usage helpers.
- Missing model: show model as `--`, fee as `未定价`.
- Missing price rule: show model, token counts, and `未定价`.
- Cost calculation failure: log a structured warning with run/node/model context and store no CNY cost.

Do not throw away a successful node result just because the cost could not be estimated.

## Testing

Main-process tests:

- Workflow prompt node with usage and a priced model stores CNY cost from Synapse price rules.
- SDK-provided `costCny` is ignored when it differs from Synapse rule calculation.
- Unpriced model stores usage and `priceKnown: false` without a CNY cost.
- Terminal workflow snapshots preserve the calculated cost fields.
- Active run node events include the calculated cost fields.

Renderer helper tests:

- Builds rows from node results with usage.
- Sorts rows by execution order.
- Sums input/output/cache read/cache write/reasoning tokens.
- Sums only priced costs.
- Formats unpriced and partially priced totals.

Component tests:

- Toolbar can switch to `Token`.
- Token view renders approved table and no top summary cards.
- Footer row shows `合计`.
- Numeric cells are right-aligned.
- Nodes without usage are omitted.

Static checks:

```bash
rg -n "style=\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|from-|to-|gradient|console\\.log" desktop/src/modules/workflow desktop/src/components/token-usage-summary.tsx
```

Expected: no new violations in the workflow UI change.

## Acceptance Criteria

- Runner toolbar has `DAG | 时间线 | Token`.
- Token tab shows the single approved table with a `合计` footer row.
- There are no top summary cards.
- Each priced node's fee is calculated from the effective model and Synapse price rules.
- SDK / Claude Code cost fields cannot affect displayed workflow fees.
- Historical run costs remain stable after price rules are edited.
- Unpriced nodes remain visible with token counts and `未定价`.
- The UI follows current shadcn/Radix and token styling rules.
