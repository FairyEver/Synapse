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
      "isActive": true
    }
  ]
}
```

Fields:

- `activeRepositoryUuid`: current active repository uuid, or `null`.
- `repositories[].uuid`: repository identifier.
- `repositories[].name`: display name.
- `repositories[].localPath`: local folder path.
- `repositories[].isActive`: whether this repository is currently active in Synapse.

## Boundaries

This tool is read-only and cannot modify repository configuration.
