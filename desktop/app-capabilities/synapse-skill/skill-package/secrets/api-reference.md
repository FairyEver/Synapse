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
  "newName": "API_TOKEN_2",
  "value": "new secret value",
  "description": "optional"
}
```

Updates an existing secret. Omit `value` when only changing metadata. The response never includes `value`.

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
