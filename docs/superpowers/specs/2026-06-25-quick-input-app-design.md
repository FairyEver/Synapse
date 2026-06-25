# Quick Input App Design

Date: 2026-06-25

## Context

Synapse already has a global prompt snippet feature under Settings. It stores items in `config.global.quickInputs`, renders a Settings category named `提示词片段`, and exposes those snippets in Agent conversations through the composer menu and slash candidates. The old model includes `directSend`, so one item can either insert text into the draft or send immediately.

The product direction changes this feature into a standalone system application named `快捷输入`. It should become a general quick text library, while the first integration remains Agent conversations. In Agent, all quick inputs send immediately; there is no longer an insert/direct-send mode.

This change also establishes a durable convention for system app owned data.

## Goals

- Add a standalone system app named `快捷输入`.
- Keep the app available from the launcher, but do not pin it to the bottom Dock by default.
- Move quick input storage out of `core.config` into a DataRepository app namespace.
- Preserve existing user snippets through an internal migration.
- Remove the old Settings category for prompt snippets.
- Remove `directSend` from the active data model and UI.
- Make Agent quick input selection send immediately from every quick input entry point.
- Treat the feature as a general quick text library, with only Agent integration in the first version.
- Document the new system app data namespace convention in `AGENTS.md`.

## Non-Goals

- Do not add titles, categories, tags, search, drag sorting, or batch actions in the first version.
- Do not add MCP tools or Workflow nodes for quick input in the first version.
- Do not make quick inputs project-specific.
- Do not change Agent runtime command routing beyond quick input selection behavior.
- Do not preserve `directSend` as a user-facing setting.

## App Structure

Create an app capability package:

```text
desktop/app-capabilities/quick-input/
├─ shared/
│  ├─ schema.ts
│  └─ capability.ts
├─ main/
│  ├─ service.ts
│  └─ ipc.ts
└─ renderer/
   ├─ app-definition.ts
   ├─ app-manifest.ts
   └─ index.tsx
```

The app id is `quick-input`. The user-facing name is `快捷输入`.

The first version does not expose MCP or Workflow surfaces, but the capability package keeps the core service separate from renderer and IPC so those adapters can be added later without moving business logic.

## Data Namespace Convention

System app owned data should use:

```text
app.<app-id>.<entity>
```

For this app:

```text
app.quick-input.items
app.quick-input.settings
```

`app.quick-input.items` uses the SQLite backend. DataRepository maps it to the actual SQLite table name:

```text
ns_app_quick_input_items
```

Application code should not hand-write this table name. It should access the namespace through DataRepository.

`app.quick-input.settings` can use JSON because it is a small singleton for seed and legacy migration markers.

## Data Model

Quick input item:

```ts
type QuickInputItemV1 = {
  id: string
  schemaVersion: 1
  content: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}
```

Quick input settings:

```ts
type QuickInputSettingsV1 = {
  schemaVersion: 1
  legacyConfigMigratedAt: string | null
  defaultSeededVersion: string | null
}
```

`content` is the only user-authored field. The UI derives previews from the first non-empty line and optional following text. `directSend` is not part of the new model.

## Migration And Seeding

On service initialization:

1. Load `app.quick-input.settings`.
2. If `legacyConfigMigratedAt` is null, read `config.global.quickInputs`.
3. If the old list is non-empty and `app.quick-input.items` is empty, migrate every valid old item into `app.quick-input.items`.
4. Preserve old order with increasing `sortOrder`.
5. Drop `directSend` during migration.
6. After a successful migration, set `legacyConfigMigratedAt` and clear `config.global.quickInputs`.
7. If migration fails, do not clear old config data; log a structured error and retry on a later initialization.

Default snippets move from config normalization into the quick input service:

1. If `defaultSeededVersion` equals the current app version, do nothing.
2. If no quick inputs exist and default seeding has not run for this version, insert the built-in defaults.
3. If user items exist, do not append defaults.
4. Record `defaultSeededVersion` after the check.

This keeps defaults as a one-time aid for empty users, not a recurring recommendation.

## App UI

The app is launchable from the system app launcher and openable in its own system app window. It is not pinned to the Dock by default.

The UI is a focused list editor:

```text
快捷输入                                      [新增]

帮我捋一下
把这里的信息重新整理一下，重点放在结论...
                                      [编辑] [置顶] [删除]

给个结论
先说结论，再用几条要点说明理由。
                                      [编辑] [置顶] [删除]
```

UI behavior:

- Empty state: `还没有快捷输入`.
- Add/edit opens a dialog with a single `内容` textarea.
- Save is blocked when `content.trim()` is empty.
- Delete uses a confirmation dialog.
- Pin-to-top remains available and is disabled for the first item.
- No direct-send switch is shown.
- No explanatory or marketing copy is shown.
- Use existing shadcn/Radix components, lucide icons, and token classes.
- Do not add custom colors, inline styles, decorative gradients, card nesting, or redundant helper text.

## Agent Integration

Agent conversations read quick inputs from the new app service, not `config.global.quickInputs`.

Behavior:

- Rename the composer button from `片段` to `快捷输入`.
- The menu is hidden when there are no items.
- Selecting any quick input sends its full content immediately.
- Slash menu quick input candidates should use the same send-immediately semantics. The app must not have one quick input entry point that inserts and another that sends.
- Existing draft text is preserved when sending a quick input from the composer menu.
- Telemetry should record item id and content length, not full content.

The old `directSend` value only participates in legacy migration input. It no longer affects Agent behavior.

## Backup Compatibility

New backups should include DataRepository namespaces `app.quick-input.items` and `app.quick-input.settings`. `global.quickInputs` should normally be empty after migration.

Old backups that still include `config.global.quickInputs` remain compatible because the quick input service migrates that old config list on startup.

## Error Handling

- Loading failures show the app's local load error and allow retry.
- Save failures show concise errors or toast messages.
- Migration failures keep old config data intact and log structured diagnostics.
- Invalid legacy records are skipped rather than blocking the entire migration, as long as at least valid records can be migrated.
- If clearing old config after migration fails, do not mark migration complete.

## Testing Strategy

DataRepository schema tests:

- Registers `app.quick-input.items` and `app.quick-input.settings`.
- Validates minimal valid records.
- Uses SQLite backend for items and JSON backend for settings.

Service tests:

- Lists items by `sortOrder`.
- Creates, updates, deletes, and pins items.
- Rejects blank content.
- Seeds defaults only for empty data and only once per app version.
- Migrates legacy `config.global.quickInputs`, drops `directSend`, preserves order, and clears old config after success.
- Does not clear old config when migration fails.
- Does not re-migrate after the migration marker exists.

IPC/preload tests:

- Exposes list/create/update/delete/pin methods through `window.synapse.quickInput`.
- Validates request and response schemas.

App tests:

- Launcher includes `快捷输入`.
- Dock defaults do not include `quick-input`.
- Settings no longer includes `提示词片段`.
- The quick input app renders list, empty, add, edit, pin, and delete states.

Agent tests:

- Composer renders `快捷输入` when items exist.
- Menu selection sends immediately and preserves the existing draft.
- Slash candidate selection also sends immediately.
- Telemetry does not include full quick input content.
- Old insert/direct-send branching is removed.

## Release Notes

Add a pending release note when implementation lands:

```text
- 提示词片段升级为独立的“快捷输入”应用；Agent 对话中选择快捷输入会直接发送，原有片段会自动迁移。
```
