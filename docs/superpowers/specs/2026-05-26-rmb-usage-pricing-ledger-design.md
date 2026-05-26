# RMB Usage Pricing Ledger Design

## Summary

Synapse usage analysis will switch model pricing and token cost display from USD to RMB. The change uses a fixed migration rate of `1 USD = 7.2 CNY`.

The design treats cost as a ledger snapshot, not a live formula. Token usage is the factual record. Price rules define how new usage is priced. Each usage event stores the cost calculated at the time it is inserted or explicitly repriced. Later price edits must not silently change historical costs.

## Goals

- Show all usage-analysis model prices and token costs in RMB.
- Convert existing USD price rules and stored costs to CNY exactly once during upgrade.
- Preserve historical cost stability after upgrade.
- Stop refresh and price-rule edits from silently repricing old usage events.
- Keep the existing usage-analysis UI structure and shadcn/Radix baseline.

## Non-Goals

- No live exchange-rate lookup.
- No multi-currency UI.
- No provider-specific pricing rules.
- No automatic historical repricing after a user edits price rules.
- No broad redesign of usage-analysis charts or tables.

## Current Behavior

The current implementation stores model price rules in `usage_model_prices`.

Usage events and aggregate tables also store calculated cost fields:

- `cost_input`
- `cost_output`
- `cost_cache_read`
- `cost_cache_write`
- `cost_reasoning`
- `total_cost`
- `price_known`

Refresh scans usage logs incrementally, but after the scan it currently calls `repriceUsageEvents()` for the whole namespace and then rebuilds aggregates. Saving price rules also reprices both `cc` and `cx` historical usage events.

That means a price edit can change historical costs. This design removes that default behavior.

## Data Model

### Constants

Define shared constants in one Electron/renderer-safe module:

- `SYNAPSE_COST_CURRENCY = "CNY"`
- `USD_TO_CNY_RATE = 7.2`

All pricing and cost formatting should use these constants rather than local numeric literals.

### Pricing Rules

`usage_model_prices` remains the source of editable model prices. Prices are interpreted as `CNY / 1M token`.

Add currency metadata to make migration state explicit:

- `currency TEXT NOT NULL DEFAULT ''`
- `pricing_version TEXT NOT NULL DEFAULT ''`

The default built-in price rules are converted from their previous USD values by multiplying by `7.2`.

Example:

- `claude-sonnet-4` input: `3 USD` becomes `21.6 CNY`
- `claude-sonnet-4` output: `15 USD` becomes `108 CNY`

### Usage Events

For each `${prefix}_usage_events` table, add ledger metadata:

- `cost_currency TEXT NOT NULL DEFAULT ''`
- `pricing_rate REAL NOT NULL DEFAULT 0`
- `priced_at TEXT NOT NULL DEFAULT ''`
- `pricing_version TEXT NOT NULL DEFAULT ''`

Existing cost columns remain in place and become CNY-denominated after migration.

For new usage events, costs are calculated from the currently saved CNY price rules when the event is inserted. The event stores the resulting CNY cost. Later price-rule changes do not mutate the event unless an explicit reprice command is added in a future feature.

### Aggregates

`${prefix}_daily_usage` and `${prefix}_hourly_usage` may keep cost columns for performance. These tables are derived data.

When aggregates are rebuilt, they must sum stored event costs. They must not recalculate costs from current price rules.

Add aggregate currency metadata:

- `cost_currency TEXT NOT NULL DEFAULT ''`

Aggregate rows for tool calls keep zero cost and `cost_currency = 'CNY'`.

### Agent And Workflow Costs

Agent SDK result events expose `total_cost_usd`. Existing Synapse runtime types also use `costUsd` in conversation metadata, workflow node results, and run reports.

This feature should make the user-facing Synapse cost canonical in CNY:

- new SDK result handling converts `total_cost_usd * 7.2` into a CNY cost snapshot;
- persisted records should prefer a currency-neutral or CNY field such as `costCny` plus `costCurrency = "CNY"`;
- existing `costUsd` fields remain readable for compatibility but are treated as legacy USD when no CNY field exists;
- UI and report formatters resolve cost by preferring the CNY field, then falling back to `costUsd * 7.2`.

This keeps old Agent and Workflow histories visible in RMB without requiring every internal type name to be renamed in the same change.

## Upgrade Migration

### Migration Marker

Use `usage_pricing_meta` for an idempotent migration marker:

- key: `cost_currency_migrated_to_cny_v1`
- value: JSON containing the target currency, conversion rate, and completion timestamp

The migration must only mark completion after all price rules, usage events, and aggregates have been converted successfully.

### Migration Steps

On schema initialization:

1. Add new currency and pricing metadata columns if they do not exist.
2. Check `usage_pricing_meta.cost_currency_migrated_to_cny_v1`.
3. If present, do not multiply any values again.
4. If absent, count existing price rules and usage events before seeding defaults.
5. If there are no price rules and no usage events, seed the CNY default price rules and write the migration marker in the same transaction.
6. If existing rows are present, run a single transaction:
   - Multiply legacy `usage_model_prices` numeric price columns by `7.2` where `currency` is empty or `USD`.
   - Set price-rule `currency` to `CNY`.
   - If the price-rule table is empty, seed CNY default price rules without multiplying them.
   - Multiply legacy `${prefix}_usage_events` cost columns by `7.2` where `cost_currency` is empty or `USD`.
   - Set event `cost_currency` to `CNY`.
   - Set event `pricing_rate` to `7.2` when empty or zero.
   - Set event `priced_at` to the migration timestamp when empty.
   - Rebuild `${prefix}_daily_usage` and `${prefix}_hourly_usage` from stored event costs.
   - Write the migration marker.

The transaction prevents half-migrated cost data from being marked complete.

Marker value:

```json
{"currency":"CNY","rate":7.2,"migratedAt":"<iso timestamp>"}
```

### Empty And New Databases

For a new database, the migration owns the initial CNY default seed and writes the marker immediately. This prevents CNY seed values from being mistaken for legacy USD and multiplied by `7.2`.

For an existing database with no usage events, only price rules need conversion. If the price-rule table is empty, seed CNY defaults and write the marker.

### Agent And Workflow History

Existing persisted Agent and Workflow histories that contain only `costUsd` are legacy USD values.

Do not bulk rewrite all historical Agent and Workflow JSON records in this feature. Those records live outside the usage-analysis SQLite ledger and are spread across runtime repositories. Instead:

- all display and export code resolves legacy `costUsd` through the fixed `7.2` conversion;
- new writes add a CNY companion value such as `costCny` with `costCurrency = "CNY"` where the local type boundary is already being touched;
- existing `costUsd` remains available as legacy raw SDK cost for compatibility.

This gives upgraded users RMB output immediately without a risky broad JSON-history rewrite.

### Interrupted Migration

If the app exits before the marker is written, startup retries the migration. To avoid double conversion after partial writes, the migration should run in one transaction. SQLite rollback guarantees values return to their pre-migration state if the transaction fails.

If a defensive check is added, it should key off explicit metadata rather than guessing from numeric price magnitudes.

## Refresh Semantics

Refresh keeps its file-level incremental behavior:

- unchanged log files are skipped;
- append-only Claude Code files parse only new lines;
- replaced files delete and recreate the events for their affected sessions.

Cost handling changes:

- skipped existing events are not repriced;
- newly inserted events are priced with current CNY rules;
- events recreated because a file is replaced are treated as newly inserted and priced with current CNY rules;
- refresh rebuilds aggregates from stored event costs;
- refresh does not call a full-history repricing function.

This means old usage remains stable unless its source log file is actually replaced and reparsed.

## Price Rule Editing

Saving price rules updates `usage_model_prices` only.

After save:

- current and future inserted usage events use the new CNY prices;
- existing usage events keep their stored CNY costs;
- aggregates do not need repricing because historical event costs did not change;
- reports may reload so the editor reflects saved rules, but historical totals remain stable.

If Synapse later needs historical repricing, it should be a separate explicit action with a confirmation step and a clear result summary.

## Formatting And UI

Currency formatting changes from USD to CNY:

- shared token usage summaries;
- workflow run reports;
- workflow node result panels;
- agent timeline cost display;
- usage-analysis overview, today, model, time, and detail views;
- pricing rules dialog.

The pricing rules dialog description becomes `人民币 / 1M token`.

UI implementation must keep the current shadcn/Radix baseline:

- no custom colors;
- no inline styles;
- no new visual system;
- no explanatory migration copy in the main UI.

Product copy stays short. Existing labels such as `费用`, `估算费用`, `价格规则`, and `未定价` remain acceptable.

## API And Type Naming

Existing `costUsd` fields from the Agent SDK and workflow runtime represent upstream SDK payloads or persisted conversation metadata. Renaming them everywhere is not required in this change because it would broaden migration risk.

Display utilities must stop formatting those values as USD when the user-facing surface is Synapse cost display. They should resolve a CNY snapshot first and only use `costUsd * 7.2` as a legacy fallback.

For usage-analysis APIs, prefer currency-neutral names such as `estimatedCost`, `totalCost`, and `costBreakdown`. Add currency metadata only where callers need to distinguish migrated data.

## Error Handling

- Usage-analysis migration failures should throw from schema initialization, not silently proceed with mixed currency data.
- Save failures keep existing price rules unchanged.
- Refresh failures keep previously stored events and aggregates intact where possible.
- Empty or unknown prices still produce `未定价`; they should not be displayed as zero-cost priced usage.

## Testing

Focused tests should cover:

- new default price rules are CNY values converted at `7.2`;
- an old database with USD price rules migrates exactly once;
- usage event cost columns migrate exactly once;
- daily and hourly aggregates are rebuilt from migrated event costs;
- saving price rules does not change historical usage event costs;
- refresh does not reprice skipped events;
- new appended events use current CNY price rules;
- Agent and Workflow cost displays convert legacy `costUsd` to CNY;
- new SDK `total_cost_usd` values are captured or displayed as CNY snapshots;
- reports format currency as CNY;
- unpriced rows still show `未定价`.

Validation commands:

```bash
pnpm --filter @synapse/desktop test -- usage-analysis
pnpm --filter @synapse/desktop run check:hard-constraints
```

## Release Notes

This is user-visible and should update `RELEASE_NOTES_PENDING.md` during implementation.

Suggested release note:

```markdown
- 用量分析的模型价格和费用统计改为人民币；升级后会按固定汇率把旧美元费用等价换算为人民币，后续调整价格规则不会静默改写历史费用。
```
