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
