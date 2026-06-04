# Default Quick Inputs Seeding Design

## Context

Settings already has a global `片段` list backed by `config.global.quickInputs`. The Agent composer reads the same list for the bottom `片段` menu and the `/` menu. Users can add, edit, delete, pin, and toggle direct send for each item.

The current default is an empty list. Existing users who never configured snippets see no quick-start examples. New default snippets should help empty users start faster, while never disturbing users who already created their own snippets.

## Goals

- Seed a small set of built-in quick inputs when the user's snippet list is empty.
- Support both new installs and existing users whose `quickInputs` list is still empty.
- Never replace, merge into, reorder, or edit user-created quick inputs.
- Prevent repeated seeding after app restarts, config reloads, or after the user deletes seeded snippets.
- Record the app version that ran the default-snippet seed check.

## Non-Goals

- Do not add snippet titles, categories, search fields, or a marketplace.
- Do not add UI copy explaining built-in snippets.
- Do not re-add defaults for users who intentionally deleted all snippets after the seed check.
- Do not migrate users who already have one or more snippets.
- Do not change composer insertion, direct-send, or slash-menu behavior.

## Product Behavior

On config normalization or first persisted config update for the current version:

1. If the stored seed version equals the current app version, do nothing.
2. If the stored seed version differs from the current app version and `quickInputs.length === 0`, append the built-in quick inputs.
3. If the stored seed version differs from the current app version and `quickInputs.length > 0`, leave the list unchanged.
4. Record the current app version as the seed version after the check.

This makes the defaults an onboarding aid for blank users, not a recurring system recommendation.

## Built-In Quick Inputs

All seeded items use `directSend: true`.

```text
帮我捋一下
把这里的信息重新整理一下，重点放在结论、分歧和下一步。
```

```text
给个结论
先说结论，再用几条要点说明理由。
```

```text
哪里有问题
帮我挑一下毛病，重点看不清楚、不完整、前后打架的地方。
```

```text
改得像正式文档
保持原意，把表达改得更清楚、更克制、更适合放进文档。
```

```text
整理成待办
拆成可执行的待办事项，按优先级排一下。
```

```text
存到桌面
整理成一份 Markdown 文件，保存到我的桌面。
```

## Data Model

Extend `SynapseGlobalConfig` with:

```ts
defaultQuickInputsSeededVersion: string | null
```

The value means: this app version has already checked whether default snippets should be appended.

Default config uses:

```ts
defaultQuickInputsSeededVersion: null
```

The seeded quick inputs should have stable IDs so repeated normalization cannot create new IDs for the same built-in items.

## Data Flow

```text
current app version
  -> config normalization / initial config preparation
  -> if seed version differs:
       quickInputs empty ? append defaults : keep user list
       set defaultQuickInputsSeededVersion
  -> existing config persistence path
```

The implementation should use the existing config update path. It should not introduce a separate DataRepository namespace for snippets.

## Error Handling

- If the config cannot be saved, the existing config error path applies.
- Invalid existing quick input records continue to be filtered by current config normalization.
- If defaults are seeded, the operation should be persisted with the seed version in the same config write whenever possible.

## Testing

Config tests should cover:

- A default config seeds the built-in quick inputs and records the current version.
- Existing empty `quickInputs` with an older or missing seed version receives defaults.
- Existing non-empty `quickInputs` with an older or missing seed version is preserved and only records the current version.
- If the stored seed version already equals the current app version, no quick inputs are added.
- After a user deletes all snippets and the seed version is current, defaults are not re-added.
- Seeded quick inputs use `directSend: true`.

## Release Notes

Add a pending release note explaining that empty snippet lists now receive a small set of built-in quick inputs for common AI conversations, while existing user snippets are left untouched.
