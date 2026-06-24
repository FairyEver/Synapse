# Synapse Model Price MCP API Reference

## List Used Models

`app_model_price_used_model_list`

```json
{
  "source": "all",
  "range": "all",
  "limit": 200
}
```

Fields:

- `source`: `all`, `cc`, or `codex`; defaults to `all`.
- `range`: `today`, `7d`, `30d`, `90d`, or `all`; defaults to `all`.
- `limit`: 1 to 500; defaults to 200.

Use this to find models with `priceKnown: false`. `matchedRuleId` is a rule id, not a model name.

## List And Import Presets

`app_model_price_preset_list`

```json
{}
```

Lists built-in presets. Use the returned `id` field as `presetId`.

`app_model_price_preset_import`

```json
{ "presetId": "deepseek-official" }
```

Imports or refreshes one built-in preset. Existing user rules that do not match preset patterns are preserved.

## List And Get Rules

`app_model_price_rule_list`

```json
{}
```

Lists enabled and disabled rules. Use the returned `id` field as `ruleId`.

`app_model_price_rule_get`

```json
{ "ruleId": "rule-id-from-list" }
```

## Create Rule

`app_model_price_rule_create`

```json
{
  "modelPattern": "gpt-5",
  "inputPer1M": 10,
  "outputPer1M": 30,
  "cacheReadPer1M": 1,
  "cacheWritePer1M": 2,
  "reasoningPer1M": 0,
  "enabled": true
}
```

Fields:

- `modelPattern`: substring or wildcard pattern used to match model names.
- `inputPer1M`, `outputPer1M`, `cacheReadPer1M`, `cacheWritePer1M`, `reasoningPer1M`: prices in RMB per 1M tokens.
- Omitted price fields default to `0`; `0` is valid when that token type is not charged.
- `enabled` defaults to `true`.

## Update Rule

`app_model_price_rule_update`

```json
{
  "ruleId": "rule-id-from-list",
  "outputPer1M": 28
}
```

Updates are partial. Pass only fields that should change; omitted prices keep their current values. Do not use `modelPattern` as `ruleId`.

## Enable Or Disable Rule

`app_model_price_rule_enable`

```json
{ "ruleId": "rule-id-from-list" }
```

`app_model_price_rule_disable`

```json
{ "ruleId": "rule-id-from-list" }
```

Disable a rule when you want to keep it for later but stop matching it.

## Delete Rule

`app_model_price_rule_delete`

```json
{ "ruleId": "rule-id-from-list" }
```

This hard-deletes the rule. Use only when the user explicitly wants removal.

## Clear Rules

`app_model_price_rule_clear`

```json
{}
```

Clears every model price rule. Use only when the user explicitly asks for a full reset.

## Common Flows

Find unpriced used models:

1. Call `app_model_price_used_model_list`.
2. Look for rows with `priceKnown: false`.
3. Ask the user for prices if they did not provide them.
4. Create a rule with `app_model_price_rule_create`.

Import built-in prices:

1. Call `app_model_price_preset_list`.
2. Choose the exact preset requested by the user.
3. Call `app_model_price_preset_import` with the returned `id`.

Update one price field:

1. Call `app_model_price_rule_list`.
2. Identify the exact rule and confirm ambiguity if multiple rules could match.
3. Call `app_model_price_rule_update` with `ruleId` and only the changed field.

Enable, disable, or delete:

1. Call `app_model_price_rule_list`.
2. Use the returned `id` as `ruleId`.
3. Call `app_model_price_rule_enable` when a disabled rule should match again.
4. Call `app_model_price_rule_disable` to keep the rule but stop matching it.
5. Call `app_model_price_rule_delete` only for explicit removal.

Clear all rules:

1. Confirm the user explicitly requested a full reset.
2. Call `app_model_price_rule_clear`.

Model price rule changes affect current matching immediately, but they do not rewrite already indexed usage totals at save time. A later Usage Analysis refresh can reprocess unchanged CC/Codex usage files when the price-rule hash changes. Do not trigger or simulate that refresh from this skill.
