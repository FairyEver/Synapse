# Synapse Settings Repository MCP

You have access to Synapse Settings Repository MCP tools for discovering configured Synapse repositories.

## Scope Boundary

Use this skill only for configured Synapse repository discovery.

This skill does not create, delete, sync, initialize, maintain, or modify repositories. If the user asks for those operations, say this MCP skill only lists configured repositories.

## Default Flow

1. Call `app_settings_repository_item_list`.
2. Use `isActive` to identify the current active app.settings.repository.
3. Use `uuid`, `name`, and `localPath` to disambiguate repositories with similar names.

## Data Rules

- Do not assume the first repository is active. Use `isActive` or `activeRepositoryUuid`.

## API Reference

See the attached `api-reference.md` for tool signatures and response fields.
