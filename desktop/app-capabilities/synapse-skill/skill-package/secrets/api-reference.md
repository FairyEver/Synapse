# Synapse Secrets API Reference

## Safe View

Tools return this safe view unless `app_secrets_item_get` is called with `includeValue: true`:

```json
{
  "id": "secret-id",
  "name": "API_TOKEN",
  "description": "optional",
  "hasValue": true
}
```

## Skill ENV Boundary

Names are immutable after creation. Secret storage resolves names case-insensitively, but association with a key in an installed Skill root `.env` file requires exactly matching case. A case-only conflict must be resolved before association; Synapse does not keep an installation database.

MCP create, update, and upsert modify encrypted secret storage only and never scan or write installed Skill files. Explicit scanning and the user-confirmed in-memory serial update queue are desktop app IPC/UI capabilities, not MCP actions or tools.

Desktop runtime `.env` scanning, reinstall merging, and queue updates have a 1 MiB file-size limit and fail safely above it. The installer applies the same limit to root `.env.example` before decoding, parsing, or merging declarations. Desktop scanning is available on Windows, but the current Windows queue returns a failure for each write and requires the user to update the local `.env` manually. On macOS and Linux, the desktop queue performs a final validation before a same-directory atomic replacement. MCP tools never scan or write Skill `.env` files and do not bypass these limits.

## Tools

### app_secrets_item_list

Canonical action: `app.secrets.item.list`

Input: `{}`.

Returns `{ secrets, total }`. Values are never returned.

### app_secrets_item_get

Canonical action: `app.secrets.item.get`

Input:

```json
{
  "name": "API_TOKEN",
  "includeValue": false
}
```

When `includeValue` is true, the returned `secret` includes `value` after secret-read permission.

### app_secrets_item_create

Canonical action: `app.secrets.item.create`

Input:

```json
{
  "name": "API_TOKEN",
  "value": "secret value",
  "description": "optional"
}
```

Creates a secret and fails if the name already exists. The response never includes `value`.

### app_secrets_item_update

Canonical action: `app.secrets.item.update`

Input:

```json
{
  "name": "API_TOKEN",
  "value": "new secret value",
  "description": "optional"
}
```

Updates an existing secret value or description. The name identifies the existing secret and cannot be changed. Omit `value` when only changing metadata. The response never includes `value`.

### app_secrets_item_upsert

Canonical action: `app.secrets.item.upsert`

Input:

```json
{
  "name": "API_TOKEN",
  "value": "secret value",
  "description": "optional"
}
```

Creates or updates a secret by name. `value` is required when creating a new secret. The response never includes `value`.

### app_secrets_item_delete

Canonical action: `app.secrets.item.delete`

Input:

```json
{
  "name": "API_TOKEN"
}
```

Deletes a secret by name. The response never includes `value`.
