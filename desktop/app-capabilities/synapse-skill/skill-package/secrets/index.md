# Synapse Secrets MCP

Use Synapse Secrets MCP tools to manage user-scoped local secrets used by `${{ NAME }}` placeholders.

Prefix a placeholder with a backslash, as in `\${{ NAME }}`, when installed content must keep it as literal text. Installer substitution preserves both the backslash and placeholder.

## Scope Boundary

Use this guide only for Synapse local secrets stored in the `密钥库` app.

Do not use these tools for Workflow variables, Database rows, Automation schedules, provider settings, shell environment variables, Resource Repository publishing, or editor installation state.

Secret names can also match keys in installed Skill root `.env` files. This file-based association requires the secret name and `.env` key to use exactly the same case; a case-only name conflict must be resolved before association. Synapse does not keep an installation database or persistent update queue.

These MCP tools modify encrypted secret storage only. Create, update, and upsert never scan or write installed Skill files. The desktop app provides a separate explicit scan and user-confirmed in-memory serial queue for updating associated `.env` files.

The desktop scanner accepts runtime `.env` files up to 1 MiB. The installer applies the same limit to root `.env.example` before decoding, parsing, or merging declarations, and accepts at most 100 environment-variable declarations per Skill. Batch association scans use the same 100-name limit. Scanning is available on Windows, but the current desktop queue returns a failure for every Windows write; the user must update the local `.env` manually. On macOS and Linux, the desktop queue performs a final validation and then uses a same-directory atomic replacement. MCP tools never scan or write these files and cannot bypass these desktop limits.

## Default Flow

1. Use `app_secrets_item_list` to inspect secret names without values.
2. Use `app_secrets_item_get` without `includeValue` for metadata.
3. Use `app_secrets_item_get` with `includeValue: true` only when the user explicitly needs the stored value.
4. Use `app_secrets_item_upsert` with `value` when setting a value and creation/update are both acceptable.
5. Use `app_secrets_item_create` when creation must fail if the name already exists.
6. Use `app_secrets_item_update` to change an existing secret value or description, including description-only updates.
7. Use `app_secrets_item_delete` only after the name is clear.

## Sensitive Value Rules

- List never returns values.
- Mutation tools never return values.
- Do not repeat token, password, secret, credential, API key, cookie, or authorization values in final answers.
- After writing a value, report the secret name and operation result only.

## Name Rules

Names must contain only letters, digits, and underscores. Secret storage names are matched case-insensitively, while installed Skill `.env` associations require an exact-case match.

Names are immutable after creation. To use a different name, create a new secret and update the Skill's `.env.example` and runtime code separately.
