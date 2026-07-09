# Secrets App Design

## Summary

Refactor the current Settings "variables" feature into a first-class Synapse system app named `密钥库`.

The new app owns user-scoped local secrets used by `${{ NAME }}` placeholders and Synapse MCP secret tools. The old Settings variable surface and old `app.settings.variable.*` actions are removed. There are no compatibility aliases.

## Goals

- Move secret management out of Settings and into `desktop/app-capabilities/secrets/`.
- Store secrets in DataRepository instead of `config.global.variables`.
- Make `SecretsService` the only business entry for secret CRUD, migration, IPC, MCP, and installer integration.
- Keep secret values out of default list/get responses, renderer logs, audit metadata, diagnostics, and backups.
- Replace old MCP actions and tools with `app.secrets.item.*` / `app_secrets_item_*`.
- Update the bundled Synapse Skill guide so agents use the new Secrets MCP domain.

## Non-Goals

- Do not support old `app.settings.variable.*` actions or `app_settings_variable_*` tools.
- Do not keep a Settings page for editing secrets.
- Do not introduce repository-scoped secrets.
- Do not expand the feature into provider configuration, shell environment variables, Database records, or Workflow runtime variables.

## Naming

- App name: `密钥库`
- App id: `secrets`
- App namespace: `secrets`
- DataRepository namespaces:
  - `app.secrets.items`
  - `app.secrets.settings`
- MCP actions:
  - `app.secrets.item.list`
  - `app.secrets.item.get`
  - `app.secrets.item.create`
  - `app.secrets.item.update`
  - `app.secrets.item.upsert`
  - `app.secrets.item.delete`
- MCP tools:
  - `app_secrets_item_list`
  - `app_secrets_item_get`
  - `app_secrets_item_create`
  - `app_secrets_item_update`
  - `app_secrets_item_upsert`
  - `app_secrets_item_delete`

## Architecture

Create a new capability package:

```text
desktop/app-capabilities/secrets/
├── shared/
├── main/
└── renderer/
```

`shared/` defines the stable app id, namespace, MCP action names, IPC schemas, and public types.

`main/` contains `SecretsService`, IPC wiring, and the MCP dispatcher. `SecretsService` owns CRUD, migration from legacy config, permission checks, audit-safe metadata, and change events.

`renderer/` contains the system app UI. It talks to the main process only through the Secrets bridge domain.

Register the app in the system app ids, definitions, registry, launcher content switch, preload bridge, generated IPC channels, and bootstrap service descriptors.

The previous Settings `VariablesPanel` and `variables` settings category are removed.

## Data Model

`app.secrets.items` uses the `sqlite` backend because it is list-style user data.

```ts
type SecretItemEntryV1 = {
  id: string
  schemaVersion: 1
  name: string
  value: string
  description?: string
  createdAt: string
  updatedAt: string
}
```

`app.secrets.settings` uses the `json` backend.

```ts
type SecretSettingsEntryV1 = {
  schemaVersion: 1
  legacyConfigMigratedAt: string | null
}
```

Secret names continue to allow only letters, digits, and underscores. Name matching and duplicate checks are case-insensitive.

## Migration

On startup, `SecretsService.initialize()` migrates `config.global.variables` into `app.secrets.items`.

Migration behavior:

- If `legacyConfigMigratedAt` is already set, do nothing.
- Read existing DataRepository secrets first.
- Import legacy variables in their existing order.
- If a legacy variable conflicts with an existing DataRepository secret by name, keep the DataRepository secret and skip the legacy one.
- After a successful import, clear `config.global.variables` and set `legacyConfigMigratedAt`.
- If any step fails, keep `config.global.variables` unchanged and retry on next startup.

The old config field may remain in the type temporarily as a migration source, but new feature code must not treat it as an active data source.

## Service Behavior

List and default get return a safe view:

```ts
type SecretSafeView = {
  id: string
  name: string
  description?: string
  hasValue: boolean
}
```

Only `get({ includeValue: true })` returns `value`, and only after `secret.read` permission passes.

Create, update, upsert, and delete require `secret.write`. Mutation responses return safe views only. Stored values must not appear in logs, audits, diagnostics, error metadata, or success toasts.

The service emits a changed event after successful mutations so open windows and consumers can refresh.

## Installer Integration

Content installation currently reads and updates `config.global.variables`. That flow moves to Secrets:

- Placeholder matching still uses `${{ NAME }}`.
- Existing substitution values are loaded from `SecretsService`.
- Saving new or changed substitution values calls Secrets IPC instead of config update.
- The installer keeps its current confirmation flow, but the saved target is now the Secrets app data.

Renderer code should not fetch secret values from app config. If a renderer needs secret metadata or values for a user-confirmed action, it uses the Secrets bridge.

## MCP And Agent Guide

Remove the old Settings variable MCP domain:

- `app.settings.variable.item.*`
- `app_settings_variable_item_*`

Route and document the new domain:

- `app.secrets.item.*`
- `app_secrets_item_*`

The Synapse Skill package replaces `variable/` guidance with `secrets/` guidance. The guide states that Secrets is for user-scoped local secrets used by Synapse placeholders and MCP, not Workflow variables, Database rows, shell env, provider settings, or editor installation state.

Old actions and tools are intentionally unsupported. Calls to old names should fail as unknown action/tool.

## UI

The `密钥库` system app is openable from the launcher and not pinned by default.

Main view:

- Top bar action: `新增`.
- Table columns: name, description, status, actions.
- Status values: `有值` and `空值`.
- Actions: edit and delete icon buttons.
- Empty state: `暂无密钥` with `新增密钥`.
- Load failure: error text plus retry.

Dialogs:

- Create/edit use standard shadcn Dialog.
- Fields: name, value, description.
- Editing does not prefill the existing value.
- Editing exposes an explicit control for whether to update the value.
- Delete uses AlertDialog and shows only the secret name.

The UI uses existing shadcn components and Tailwind tokens. It does not introduce custom colors, marketing copy, card nesting, or decorative styling.

## Backup And Diagnostics

Config backup and diagnostics should include secret inventory metadata only when needed, never secret values.

DataRepository schema registration, factory backend selection, backup discovery, and diagnostics summaries must account for the new namespaces. Any export or diagnostic output must redact or omit `value`.

## Testing

Service tests:

- CRUD behavior.
- Case-insensitive name uniqueness.
- Safe views omit values.
- `includeValue` requires `secret.read`.
- Mutations require `secret.write`.
- Audit events do not contain values or descriptions.
- Legacy config migration imports data, skips conflicts, clears legacy config on success, and preserves legacy config on failure.

IPC tests:

- Request and response schemas.
- Changed event broadcast.

MCP/router tests:

- New `app.secrets.item.*` actions route to the Secrets dispatcher.
- Old `app.settings.variable.*` actions are unknown.
- Permission denial happens before value access.

Renderer tests:

- Loading, empty, error, create, edit, delete states.
- Edit does not prefill the existing value.
- Value update is explicit.

Integration tests:

- Installer loads substitutions from Secrets.
- Installer saves new or changed substitution values through Secrets.
- Settings no longer exposes the variables category.
- Launcher includes the `secrets` app.
- Schema/factory tests include `app.secrets.items` and `app.secrets.settings`.

