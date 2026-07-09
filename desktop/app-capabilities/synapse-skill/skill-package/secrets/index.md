# Synapse Secrets MCP

Use Synapse Secrets MCP tools to manage user-scoped local secrets used by `${{ NAME }}` placeholders.

## Scope Boundary

Use this guide only for Synapse local secrets stored in the `密钥库` app.

Do not use these tools for Workflow variables, Database rows, Automation schedules, provider settings, shell environment variables, Resource Repository publishing, or editor installation state.

## Default Flow

1. Use `app_secrets_item_list` to inspect secret names without values.
2. Use `app_secrets_item_get` without `includeValue` for metadata.
3. Use `app_secrets_item_get` with `includeValue: true` only when the user explicitly needs the stored value.
4. Use `app_secrets_item_upsert` when setting a value and creation/update are both acceptable.
5. Use `app_secrets_item_create` when creation must fail if the name already exists.
6. Use `app_secrets_item_update` for existing secrets or renames.
7. Use `app_secrets_item_delete` only after the name is clear.

## Sensitive Value Rules

- List never returns values.
- Mutation tools never return values.
- Do not repeat token, password, secret, credential, API key, cookie, or authorization values in final answers.
- After writing a value, report the secret name and operation result only.

## Name Rules

Names must contain only letters, digits, and underscores. Names are matched case-insensitively.
