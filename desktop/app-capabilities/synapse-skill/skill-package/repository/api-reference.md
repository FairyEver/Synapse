# Synapse Settings Repository MCP API Reference

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

Each tool maps to the same canonical Synapse API action.

## Tools

### app_settings_repository_item_list

Canonical action: `app.settings.repository.item.list`

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
