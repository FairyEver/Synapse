# Model Price MCP Design

## Summary

Add a `model_price` capability domain so Synapse agents can manage the shared model price rule table through aligned API actions and MCP tools.

The first version only manages price rules. It does not reprice historical usage events, rebuild usage aggregates, or change existing cost snapshots.

## Goals

- Let agents list models the user has actually used across CC and Codex.
- Let agents list, get, create, update, delete, enable, and disable model price rules.
- Keep API actions and MCP tools aligned through the capability registry.
- Keep CC and Codex on the existing shared price rule source.
- Add a built-in skill named `Synapse 价格规则 MCP` to guide safe agent usage.

## Non-Goals

- No historical usage repricing.
- No automatic aggregate rebuild after price rule edits.
- No separate CC and Codex price tables.
- No direct Database MCP access to `usage_model_prices`.
- No writes by `modelPattern`; mutating operations use `ruleId`.
- No UI redesign.

## Current Context

Synapse stores editable model price rules in the shared `usage_model_prices` table. CC and Codex usage events are stored separately under the `cc_*` and `cx_*` tables, but both sources use the same price rules when new usage events are parsed.

The current renderer pricing dialog reads and saves the whole rule table through usage-analysis IPC. For agents, whole-table saves are too easy to misuse. The MCP/API surface should expose focused rule operations by id.

The existing RMB usage pricing ledger design is still binding:

- model prices are `CNY / 1M token`;
- price edits affect future newly inserted or reparsed usage events only;
- existing event cost snapshots must not change unless a separate explicit repricing feature is designed later.

## Capability Domain

Add a new domain id:

```text
model_price
```

Canonical API actions and MCP tools:

| API action | MCP tool |
| --- | --- |
| `model_price.used_model.list` | `model_price_used_model_list` |
| `model_price.rule.list` | `model_price_rule_list` |
| `model_price.rule.get` | `model_price_rule_get` |
| `model_price.rule.create` | `model_price_rule_create` |
| `model_price.rule.update` | `model_price_rule_update` |
| `model_price.rule.delete` | `model_price_rule_delete` |
| `model_price.rule.enable` | `model_price_rule_enable` |
| `model_price.rule.disable` | `model_price_rule_disable` |

MCP must not own business logic. HTTP MCP and stdio MCP both map tool names to these actions, then dispatch through the same action router used by local `/api`.

## Service Boundary

Add a thin model-price capability dispatcher. It owns:

- input validation;
- rule id lookup;
- partial update merge;
- used-model aggregation response shaping;
- action result formatting.

It should reuse existing usage-analysis pricing functions for normalization, ordering, currency, and persistence. It should not duplicate price matching rules or write SQLite directly from MCP transport code.

The dispatcher can read the usage-analysis SQLite database because the data lives there, but it must keep writes limited to `usage_model_prices`.

`action-router` gains a `modelPriceDispatch` branch for `model_price.*` actions.

## Used Model Listing

`model_price.used_model.list` reads existing indexed usage data. It does not trigger usage refresh.

Input:

```ts
{
  source?: "all" | "cc" | "codex" // default "all"
  range?: "today" | "7d" | "30d" | "90d" | "all" // default "all"
  limit?: number // default 200
}
```

Behavior:

- `source: "all"` merges CC and Codex by model name.
- `source: "cc"` reads only CC usage.
- `source: "codex"` reads only Codex usage.
- Results are ordered by total tokens descending.
- Matching only considers currently enabled price rules.
- Disabled rules are returned by rule listing, but do not count as a model match.

Response row:

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

`priceKnown` in this response means the current enabled rule set can match the model. It does not mean all historical events were priced.

## Rule Operations

Rule shape:

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

### List

`model_price.rule.list` returns all rules, including disabled rules, in the current matching order.

Agents should call this before update, delete, enable, or disable so they can operate by `ruleId`.

### Get

`model_price.rule.get` input:

```ts
{ ruleId: string }
```

Returns one rule or a clear not-found error.

### Create

`model_price.rule.create` input:

```ts
{
  modelPattern: string
  inputPer1M?: number
  outputPer1M?: number
  cacheReadPer1M?: number
  cacheWritePer1M?: number
  reasoningPer1M?: number
  enabled?: boolean
}
```

Defaults:

- missing numeric fields become `0`;
- `enabled` defaults to `true`;
- currency is always `CNY`.

Returns the created rule.

### Update

`model_price.rule.update` input:

```ts
{
  ruleId: string
  modelPattern?: string
  inputPer1M?: number
  outputPer1M?: number
  cacheReadPer1M?: number
  cacheWritePer1M?: number
  reasoningPer1M?: number
}
```

Update is partial. Only provided fields change. All other fields keep their existing values so agents cannot accidentally clear prices by omitting fields.

Use `enable` and `disable` for enabled state instead of overloading update.

### Enable And Disable

`model_price.rule.enable` and `model_price.rule.disable` input:

```ts
{ ruleId: string }
```

They return the changed rule.

### Delete

`model_price.rule.delete` input:

```ts
{ ruleId: string }
```

Delete is a hard delete. It returns:

```ts
{ deleted: true, ruleId: string }
```

## Validation And Errors

- Missing or unknown `ruleId` returns an explicit error.
- Empty `modelPattern` is rejected on create and update.
- Numeric price fields must be finite numbers greater than or equal to `0`.
- `0` is valid and means that token type is not charged.
- Negative numbers, `NaN`, and non-number values are rejected.
- Writes do not mutate `cc_usage_events`, `cx_usage_events`, daily aggregates, hourly aggregates, or scan state.

## Built-In Skill

Add a built-in skill:

```text
desktop/resources/templates/skills/synapse-model-price-mcp/
  meta.json
  content.md
  files/api-reference.md
```

Metadata:

- title: `Synapse 价格规则 MCP`
- name: `synapse-model-price-mcp`
- category: `data`
- icon: `terminal`
- iconBg: `teal`

The skill should instruct agents to:

- use this skill only for Synapse model price rules;
- call `model_price_used_model_list` before filling missing prices;
- call `model_price_rule_list` or `model_price_rule_get` before mutating rules;
- use `ruleId` for update, delete, enable, and disable;
- ask the user if multiple candidate rules could match the requested model;
- treat all prices as RMB per 1M tokens;
- never claim or trigger historical repricing.

`files/api-reference.md` should document tool signatures, field meanings, and common flows such as:

- find unpriced used models;
- create a price rule;
- update one price field;
- disable a rule;
- hard-delete a rule.

## Implementation Notes

Expected new or changed areas:

- `desktop/synapse-capabilities/shared/model-price-domain.ts`
- `desktop/synapse-capabilities/shared/registry.ts`
- `desktop/electron/capabilities/action-router.ts`
- a model-price dispatcher under `desktop/electron/capabilities/` or a nearby existing capability boundary
- usage-analysis pricing service helpers for id-based create/update/delete/enable/disable if needed
- focused tests under existing Electron/capability and usage-analysis test locations
- built-in skill template under `desktop/resources/templates/skills/synapse-model-price-mcp/`

Do not add a new dependency.

## Testing

Cover:

- capability registry includes the `model_price` domain;
- each `model_price.*` action maps to exactly one MCP tool;
- action router dispatches `model_price.*` to the model-price dispatcher;
- MCP `tools/list` includes all model price tools;
- create normalizes CNY rule fields and defaults to enabled;
- update is partial and preserves omitted fields;
- delete hard-deletes by id;
- enable and disable change matching behavior;
- invalid `ruleId`, empty pattern, and invalid prices fail clearly;
- used-model list merges CC and Codex by default;
- used-model source filters work;
- used-model range defaults to `all`;
- matching ignores disabled rules;
- price-rule writes do not change stored historical usage event costs.

## Release Note

When implemented, add a pending release note explaining that agents can manage Synapse model price rules through API/MCP tools and a built-in guidance skill, without changing historical usage costs.
