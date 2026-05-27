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
