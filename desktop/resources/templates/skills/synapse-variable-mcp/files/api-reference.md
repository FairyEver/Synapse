# Synapse 变量 MCP API Reference

All tools are accessed through the `synapse-mcp` MCP server. Each tool maps to the same canonical Synapse API action.

## Shared Field

Every tool accepts optional `repositoryUuid`:

```json
{ "repositoryUuid": "repo-1" }
```

Omit it to use the current active repository.

## Safe Variable View

Tools return this safe view unless `variable_item_get` is called with `includeValue: true`:

```json
{
  "name": "GITEE_TOKEN",
  "description": "gitee 操作用的 token",
  "hasValue": true
}
```

`hasValue` says whether the stored value is a non-empty string.

## Tools

### variable_item_list

Canonical action: `variable.item.list`

Input:

```json
{
  "repositoryUuid": "repo-1"
}
```

Returns:

```json
{
  "repository": { "uuid": "repo-1", "name": "Main", "isActive": true },
  "variables": [
    { "name": "GITEE_TOKEN", "description": "gitee 操作用的 token", "hasValue": true }
  ],
  "total": 1
}
```

This tool never returns values.

### variable_item_get

Canonical action: `variable.item.get`

Input without value:

```json
{
  "repositoryUuid": "repo-1",
  "name": "GITEE_TOKEN"
}
```

Input with value:

```json
{
  "repositoryUuid": "repo-1",
  "name": "GITEE_TOKEN",
  "includeValue": true
}
```

Use `includeValue: true` only when the user explicitly needs the stored value.

### variable_item_create

Canonical action: `variable.item.create`

Input:

```json
{
  "repositoryUuid": "repo-1",
  "name": "BARK_ID",
  "value": "example-value",
  "description": "手机消息推送使用"
}
```

Fails if a variable with the same name already exists, case-insensitively.

### variable_item_update

Canonical action: `variable.item.update`

Input:

```json
{
  "repositoryUuid": "repo-1",
  "name": "BARK_ID",
  "newName": "BARK_TOKEN",
  "value": "replacement-value",
  "description": "手机消息推送使用"
}
```

Only provided fields change. Pass `description: ""` to clear the description.

### variable_item_upsert

Canonical action: `variable.item.upsert`

Input:

```json
{
  "repositoryUuid": "repo-1",
  "name": "BARK_ID",
  "value": "example-value",
  "description": "手机消息推送使用"
}
```

Creates the variable if missing, or updates provided fields if it already exists. Creating through upsert requires `value`.

### variable_item_delete

Canonical action: `variable.item.delete`

Input:

```json
{
  "repositoryUuid": "repo-1",
  "name": "BARK_ID"
}
```

Deletes one variable and returns only the safe variable view.

## Common Flows

### Set a variable in the active repository

1. Call `variable_item_upsert` without `repositoryUuid`.
2. Report the variable name and whether it was created or updated.
3. Do not include the value in the response.

### Set a variable in a named repository

1. Call `repository_item_list`.
2. Match the repository by `name` or `localPath`.
3. Call `variable_item_upsert` with that repository's `uuid`.
4. Report the repository name, variable name, and result.

### Read a value

1. Confirm the user needs the stored value.
2. Call `variable_item_get` with `includeValue: true`.
3. Use the value for the requested task.
4. Do not repeat the value in the final answer unless the user explicitly asked to see it.
