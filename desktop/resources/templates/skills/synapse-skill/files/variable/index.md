# Synapse Settings Variable MCP

You have access to Synapse Settings Variable MCP tools for managing user-scoped local variables used by `${{ NAME }}` placeholders.

## Scope Boundary

Use this skill only for Synapse local variables stored in the user's Synapse configuration.

Do not use this skill for Database rows, Automation schedules/items, Workflow variables, Resource Repository publishing, provider settings, shell environment variables, or editor installation.

## Default Flow

1. Use `app_settings_variable_item_list` to inspect variable names and descriptions without values. This still requires secret-read permission because names and descriptions can reveal secret inventory.
2. Use `app_settings_variable_item_get` without `includeValue` when you need one variable's metadata. This also requires secret-read permission.
3. Use `app_settings_variable_item_get` with `includeValue: true` only when the user explicitly needs the stored value.
4. Use `app_settings_variable_item_upsert` when the user asks to set a variable and does not care whether it already exists.
5. Use `app_settings_variable_item_create` only when the user wants creation to fail if the variable already exists.
6. Use `app_settings_variable_item_update` when the variable must already exist or when renaming with `newName`.
7. Use `app_settings_variable_item_delete` only after the variable name is clear.

## Sensitive Value Rules

- `app_settings_variable_item_list` never returns values, but variable names and descriptions are secret-adjacent metadata.
- Mutation tools never return values.
- Do not repeat token, password, secret, credential, API key, cookie, or authorization values in your final answer.
- After writing a value, report the variable name and operation result only.
- If you read a value with `includeValue: true`, use it only for the user's requested operation.

## Name Rules

Variable names must contain only letters, digits, and underscores. Names are matched case-insensitively.

## API Reference

See the attached `api-reference.md` for tool signatures, fields, and common flows.
