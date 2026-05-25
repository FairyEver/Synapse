# Quick Inputs Design

## Context

The Agent composer already supports a left-side Knowledge Base action menu for managed Knowledge Base projects. That menu is project-specific and comes from command metadata. Users now need a global personal quick-input list that works like input-method snippets: maintain reusable text in settings, then insert it into the Agent composer with one click.

Current relevant code:

- `desktop/src/modules/settings/index.tsx` renders the settings category panels.
- `desktop/src/modules/settings/data.ts` defines settings categories.
- `desktop/src/types/config.ts`, `desktop/src/constants/defaults.ts`, and `desktop/src/lib/config.ts` define and sanitize app config.
- `desktop/src/modules/agent/index.tsx` owns Agent draft state and passes composer actions.
- `desktop/src/modules/agent/components/agent-composer.tsx` owns composer insertion behavior.
- `desktop/src/modules/agent/components/agent-composer-input-box.tsx` renders `leadingActions`.
- `desktop/src/modules/agent/components/knowledge-base-action-menu.tsx` is the existing project-specific action menu.

## Goals

- Add a global Settings category named `快速输入`.
- Let users add, edit, delete, and pin quick inputs to the top.
- Store one ordered global quick-input list shared by all projects and Agent conversations.
- Support multi-line quick-input content.
- Show a `快速输入` menu at the left side of the Agent composer when at least one item exists.
- Insert selected quick-input content into the current draft at the cursor position without sending.
- Keep the existing Knowledge Base menu visible for Knowledge Base projects, positioned after `快速输入`.

## Non-Goals

- Do not add project-specific quick inputs.
- Do not add titles, categories, search, direct-send mode, drag sorting, or up/down sorting.
- Do not change Knowledge Base runtime, `/wiki` commands, or Knowledge Base command metadata.
- Do not add dependencies.
- Do not redesign the Agent composer or settings module.

## Data Model

Add `quickInputs` to `SynapseGlobalConfig`:

```ts
export type SynapseQuickInput = {
  readonly id: string
  readonly content: string
}

export type SynapseGlobalConfig = {
  themeMode: SynapseThemeMode
  projects: SynapseProjectConfig[]
  favorites: SynapseFavorites
  recentlyViewed: SynapseRecentlyViewed
  contentSortOrder: SynapseContentSortOrder
  quickInputs: SynapseQuickInput[]
}
```

Default config uses `quickInputs: []`.

Config normalization should:

- Treat missing or invalid `quickInputs` as `[]`.
- Trim only for validation; preserve the saved content exactly except for rejecting all-whitespace items.
- Generate and preserve stable `id` values from the renderer when users add items.
- Filter invalid items and dedupe by `id`.

`SynapseConfigPatch.global` should allow patching `quickInputs` through the existing config update path. Config backup and import continue to work through the existing core config namespace.

## Settings UX

Add a settings category:

- id: `quick-inputs`
- label: `快速输入`
- icon: a neutral lucide text/input icon such as `TextCursorInput`

The panel should be a focused list editor:

- Header row with an `新增` button.
- Empty state: `还没有快速输入`.
- Each item displays a compact preview derived from its content. Use the first non-empty line where possible, with normal truncation.
- Each item has icon buttons for edit, pin to top, and delete.
- The first item should not offer an active pin-to-top operation.
- Add and edit use a dialog with a `Textarea`.
- Save is blocked when `content.trim()` is empty.

The copy stays terse. No explanatory marketing or implementation text is shown in the UI.

## Composer UX

Create a small `QuickInputMenu` component near the existing Knowledge Base action menu.

Composer behavior:

- The menu is rendered only when `quickInputs.length > 0`.
- It is passed as the first child in `leadingActions`.
- The Knowledge Base menu remains second when Knowledge Base actions exist.
- A normal project shows only `快速输入`.
- A Knowledge Base project shows `快速输入` followed by `知识库`.
- Menu items follow the order stored in config.
- Selecting an item inserts its full content at the current cursor selection.
- Existing draft text is preserved. If the cursor is after non-whitespace text, insert one separating space before the quick input.
- Focus returns to the textarea after insertion.
- The item preview in the menu should be short and derived from content, not a separate title.

`AgentModule` should pass `config.global.quickInputs` to `AgentComposer`. `AgentComposer` should own the draft insertion effect, as it already does for Knowledge Base insert actions.

## Architecture

Use the existing global config path. This is intentionally simpler than a new DataRepository namespace:

```text
Settings QuickInputsPanel
  -> updateConfig({ global: { quickInputs } })

AppConfigProvider
  -> exposes config.global.quickInputs

AgentModule
  -> passes quickInputs to AgentComposer

AgentComposer
  -> renders QuickInputMenu before KnowledgeBaseActionMenu
  -> inserts selected content into draft
```

This keeps the feature global, renderer-local, and independent from Knowledge Base runtime behavior.

## Error Handling

- If config loading fails, the existing settings error path applies.
- If saving settings fails, show the existing notification error from `SettingsModule` or a local form error when appropriate.
- Invalid quick-input records from old or hand-edited config are ignored during sanitization.
- Empty quick-input lists render no composer menu.

## Visual Rules

Follow the current shadcn/Radix baseline:

- Use existing `Button`, `Dialog`, `DropdownMenu`, `Textarea`, `AlertDialog`, and settings grouping components.
- Use lucide icons for icon buttons.
- Use token classes such as `bg-card`, `text-muted-foreground`, and `border-border`.
- Do not use custom colors, arbitrary color values, gradients, decorative shadows, card nesting, or inline styles.

## Testing Strategy

Config tests:

- Default config includes `global.quickInputs: []`.
- Sanitization preserves valid multi-line content.
- Sanitization filters empty or malformed quick inputs.
- Config patch can update `global.quickInputs`.

Settings tests:

- Settings categories include `快速输入`.
- The panel renders empty state, add, edit, delete, and pin-to-top behavior.
- Blank content cannot be saved.

Composer tests:

- No quick-input menu renders when the list is empty.
- The quick-input menu renders before Knowledge Base actions.
- Selecting an item inserts content without sending.
- Existing draft text and cursor insertion are preserved.
- Knowledge Base projects still render the existing Knowledge Base menu after quick inputs.

## Implementation Boundaries

Expected files:

- `desktop/src/types/config.ts`
- `desktop/src/constants/defaults.ts`
- `desktop/src/lib/config.ts`
- related config tests
- `desktop/src/modules/settings/types.ts`
- `desktop/src/modules/settings/data.ts`
- `desktop/src/modules/settings/index.tsx`
- `desktop/src/modules/settings/components/quick-inputs-panel.tsx`
- related settings tests
- `desktop/src/modules/agent/index.tsx`
- `desktop/src/modules/agent/components/agent-composer.tsx`
- `desktop/src/modules/agent/components/quick-input-menu.tsx`
- related Agent composer tests

Avoid changing:

- Knowledge Base Electron services
- Agent runtime command routing
- Scheduler and Workflow Agent entry points
- shadcn shared primitives unless an existing primitive is missing
