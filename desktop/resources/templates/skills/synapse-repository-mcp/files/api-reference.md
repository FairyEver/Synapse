# Synapse 仓库 MCP API Reference

All tools are accessed through the `synapse-mcp` MCP server. Each tool maps to the same canonical Synapse API action.

## Tools

### repository_item_list

Canonical action: `repository.item.list`

Input:

```json
{}
```

Returns:

```json
{
  "activeRepositoryUuid": "repo-1",
  "repositories": [
    {
      "uuid": "repo-1",
      "name": "Main",
      "localPath": "/Users/me/SynapseContent",
      "isActive": true,
      "variableCount": 2
    }
  ]
}
```

Fields:

- `activeRepositoryUuid`: current active repository uuid, or `null`.
- `repositories[].uuid`: pass this as `repositoryUuid` to repository-scoped MCP tools.
- `repositories[].name`: display name.
- `repositories[].localPath`: local folder path.
- `repositories[].isActive`: whether this repository is currently active in Synapse.
- `repositories[].variableCount`: number of local variables configured for this repository.

## Boundaries

This tool is read-only. It does not expose variable names or values and cannot modify repository configuration.
