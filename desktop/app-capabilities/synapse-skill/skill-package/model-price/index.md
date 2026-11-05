# Synapse Model Price MCP

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

You have access to Synapse Model Price MCP tools for managing model price rules.

## Scope Boundary

Use this skill only for Synapse model price rules:

- list built-in price presets;
- import a built-in price preset;
- list or inspect price rules;
- create price rules;
- partially update or clear price rules;
- enable, disable, or delete price rules.

Do not use this skill for Database tables, Automation schedules/items, Workflow definitions, Resource Repository publishing, provider settings, editor installation, or usage analysis.

## Default Flow

1. If the user asks to import built-in prices, call `app_model_price_preset_list` unless the `presetId` is already known, then call `app_model_price_preset_import`.
2. If the user asks to change, delete, enable, or disable an existing rule, call `app_model_price_rule_list` first and use the returned `id` as `ruleId`.
3. Use `app_model_price_rule_get` when the user names a specific rule id or when you need to inspect one rule before changing it.
4. Use `app_model_price_rule_create` only when no existing rule should be changed.
5. Use `app_model_price_rule_update` for partial price or pattern edits. Pass only fields that should change.
6. Use `app_model_price_rule_enable` when the user wants a disabled rule to match again.
7. Use `app_model_price_rule_disable` to keep a rule but stop matching it.
8. Use `app_model_price_rule_delete` only when the user wants one rule removed.
9. Use `app_model_price_rule_clear` only when the user explicitly asks to remove every price rule.

## Safety Rules

- Rule-specific mutating operations must use `ruleId`.
- Preset import must use a preset `id` returned by `app_model_price_preset_list`.
- Do not update or delete by guessing from `modelPattern`.
- If multiple rules could match the user's model, ask which rule to change.
- Do not clear all rules unless the user explicitly asked for that full reset.
- Prices are RMB per 1M tokens.
- `0` is valid for a token type that is not charged.
- Do not claim that price edits rewrite historical costs. They affect subsequent local cost estimates that use the current rules.

## API Reference

See the attached `api-reference.md` for tool signatures, fields, and common flows.
