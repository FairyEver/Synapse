# Synapse Model Price MCP

You have access to Synapse Model Price MCP tools for listing used models and managing model price rules.

## Scope Boundary

Use this skill only for Synapse model price rules:

- list used CC/Codex models;
- list built-in price presets;
- import a built-in price preset;
- list or inspect price rules;
- create price rules;
- partially update or clear price rules;
- enable, disable, or delete price rules.

Do not use this skill for Database tables, Automation schedules/items, Workflow definitions, Resource Repository publishing, provider settings, editor installation, or running Usage Analysis refresh jobs.

## Default Flow

1. If the user asks which models need prices, call `app_model_price_used_model_list`.
2. If the user asks to import built-in prices, call `app_model_price_preset_list` unless the `presetId` is already known, then call `app_model_price_preset_import`.
3. If the user asks to change, delete, enable, or disable an existing rule, call `app_model_price_rule_list` first and use the returned `id` as `ruleId`.
4. Use `app_model_price_rule_get` when the user names a specific rule id or when you need to inspect one rule before changing it.
5. Use `app_model_price_rule_create` only when no existing rule should be changed.
6. Use `app_model_price_rule_update` for partial price or pattern edits. Pass only fields that should change.
7. Use `app_model_price_rule_enable` when the user wants a disabled rule to match again.
8. Use `app_model_price_rule_disable` to keep a rule but stop matching it.
9. Use `app_model_price_rule_delete` only when the user wants one rule removed.
10. Use `app_model_price_rule_clear` only when the user explicitly asks to remove every price rule.

## Safety Rules

- Rule-specific mutating operations must use `ruleId`.
- Preset import must use a preset `id` returned by `app_model_price_preset_list`.
- Do not update or delete by guessing from `modelPattern`.
- If multiple rules could match the user's model, ask which rule to change.
- Do not clear all rules unless the user explicitly asked for that full reset.
- Prices are RMB per 1M tokens.
- `0` is valid for a token type that is not charged.
- Do not claim that price edits immediately changed already indexed usage costs.
- Do not trigger or simulate Usage Analysis refreshes from this skill.
- If asked about historical totals, explain that a later Usage Analysis refresh can reprocess unchanged CC/Codex usage files when the price-rule hash changes.

## Matching Notes

`app_model_price_used_model_list` returns `priceKnown`, `matchedRuleId`, and `matchedRulePattern` based on currently enabled rules. This indicates current rule coverage only. It does not prove that older usage events have already been refreshed with the current rules.

## API Reference

See the attached `api-reference.md` for tool signatures, fields, and common flows.
