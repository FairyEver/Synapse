# Synapse Settings Variable MCP API Reference

All tools are accessed through the `synapse-mcp` MCP server. Each tool maps to the same canonical Synapse API action.

## Safe Variable View

Tools return this safe view unless `app_settings_variable_item_get` is called with `includeValue: true`:

```json
{
  "name": "GITEE_TOKEN",
  "description": "gitee 操作用的 token",
  "hasValue": true
}
```

`hasValue` says whether the stored value is a non-empty string.

## Tools

### app_settings_variable_item_list

Canonical action: `app.settings.variable.item.list`

Input:

```json
{}
```

Returns:

```json
{
  "variables": [
    { "name": "GITEE_TOKEN", "description": "gitee 操作用的 token", "hasValue": true }
  ],
  "total": 1
}
```

This tool never returns values.

Requires `secret.read` permission and records an audit event without variable values or descriptions.

### app_settings_variable_item_get

Canonical action: `app.settings.variable.item.get`

Input without value:

```json
{
  "name": "GITEE_TOKEN"
}
```

Input with value:

```json
{
  "name": "GITEE_TOKEN",
  "includeValue": true
}
```

Use `includeValue: true` only when the user explicitly needs the stored value.

Both metadata reads and value reads require `secret.read` permission. Audit records must not include stored values.

### app_settings_variable_item_create

Canonical action: `app.settings.variable.item.create`

Input:

```json
{
  "name": "BARK_ID",
  "value": "example-value",
  "description": "手机消息推送使用"
}
```

Fails if a variable with the same name already exists, case-insensitively.

### app_settings_variable_item_update

Canonical action: `app.settings.variable.item.update`

Input:

```json
{
  "name": "BARK_ID",
  "newName": "BARK_TOKEN",
  "value": "replacement-value",
  "description": "手机消息推送使用"
}
```

Only provided fields change. Pass `description: ""` to clear the description.

### app_settings_variable_item_upsert

Canonical action: `app.settings.variable.item.upsert`

Input:

```json
{
  "name": "BARK_ID",
  "value": "example-value",
  "description": "手机消息推送使用"
}
```

Creates the variable if missing, or updates provided fields if it already exists. Creating through upsert requires `value`.

### app_settings_variable_item_delete

Canonical action: `app.settings.variable.item.delete`

Input:

```json
{
  "name": "BARK_ID"
}
```

Deletes one variable and returns only the safe variable view.

## Common Flows

### Set a user variable

1. Call `app_settings_variable_item_upsert`.
2. Report the variable name and whether it was created or updated.
3. Do not include the value in the response.

### Read a value

1. Confirm the user needs the stored value.
2. Call `app_settings_variable_item_get` with `includeValue: true`.
3. Use the value for the requested task.
4. Do not repeat the value in the final answer unless the user explicitly asked to see it.
