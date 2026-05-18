# Provider Preset Picker Dialog

## Goal

Replace the create-form `供应商预设` dropdown with a dedicated preset picker dialog.

The picker is a task-specific UI for finding and selecting one provider preset. Selecting
a preset closes the picker and reuses the current reset-form confirmation flow.

## Context

Current implementation:

- `desktop/src/modules/settings/components/provider-panel.tsx` renders a shadcn `Select`
  at the top of `ProviderFormDialog`.
- Selecting a preset calls the existing `handlePresetSelect`, then opens the existing
  reset confirmation dialog.
- Confirming applies `formFromPreset(...)`; canceling keeps the previous selected value
  and leaves the form unchanged.

This design keeps that save and confirmation behavior intact. It only changes how users
find and choose a preset.

## User-Approved Direction

Use the lightweight single-column dialog direction:

- Search at the top.
- Category filters under search.
- A-Z filters under category filters.
- Results grouped by category.
- Click a preset row to select it immediately.

A-Z is a filter by preset name initial. It does not scroll to letter sections.

## Component Scope

Add a module-local component:

`desktop/src/modules/settings/components/provider-preset-picker-dialog.tsx`

Do not create a new shared UI primitive. The picker should compose existing shadcn/Radix
components from `desktop/src/components/ui/`, such as:

- `Dialog`
- `Input`
- `Button`
- `Badge`
- `ScrollArea`
- `Separator` only if a single separator is useful

The create form trigger should replace the current direct `Select` with a readonly
input-like control or button. It displays `自定义` or the selected preset name and opens
the picker dialog.

The picker should include a fixed `自定义` action before the preset results. `自定义` is
not a preset result and should not appear inside category groups or A-Z filtering.

## Data And State

`ProviderFormDialog` remains the owner of form-changing state:

- selected preset value
- pending preset selection
- template values
- form values

The picker may own local UI-only state:

- search query
- selected category filter
- selected initial letter filter

When a preset row is clicked, the picker calls `onSelect(value)` and closes. The parent
passes that value to the existing `handlePresetSelect`.

Selecting the fixed `自定义` action should use the same pending reset confirmation path
as it does now.

## Filtering

Search matches these preset fields:

- `name`
- `model`
- `baseUrl`
- `websiteUrl`

Search must not inspect user-entered API key values or any secret field.

Search, category filters, and A-Z filters apply to preset results only. They do not hide
the fixed `自定义` action.

Category filters:

- `全部`
- current `PROVIDER_CATEGORIES` labels

A-Z filters:

- derive visible initial letters from the full preset list;
- only show letters that exist;
- clicking a letter filters by preset name initial;
- clicking the active letter clears it.

Filters combine with AND semantics.

## Results

Results are grouped by provider category and sorted by preset name inside each group.

Each row shows:

- preset name as the primary text;
- one concise secondary value, preferring default model, then Base URL, then website domain;
- category badge;
- an external-link action for `apiKeyUrl` or `websiteUrl`.

Clicking the row selects the preset. Clicking the external-link action must not select
the row.

Empty state copy:

`没有匹配的预设`

Keep all UI copy brief. Do not add explanatory paragraphs.

## Styling Rules

Follow the repository shadcn/Radix baseline:

- no inline `style`;
- no hard-coded hex/rgb/hsl colors;
- no preset-specific custom colors from provider metadata;
- no gradients, glow effects, or decorative emoji;
- no nested cards;
- use theme tokens and existing shadcn component styles.

The picker should feel like a settings utility, not a marketplace page.

## Behavior

Opening:

- The picker opens from the create-mode provider form only.
- Search input receives focus when the dialog opens.

Selection:

- Clicking a preset row closes the picker.
- The existing reset confirmation opens.
- Confirming applies the preset defaults through the current `formFromPreset(...)` path.
- Canceling confirmation keeps the previous selected preset and form values.

Out of scope:

- recently used presets;
- recommended presets;
- pinning favorites;
- a persistent details panel;
- custom keyboard shortcuts beyond normal dialog and form control behavior;
- changing provider save, bridge, or service behavior.

## Error Handling

Preset loading behavior remains unchanged:

- if loading presets fails, log with the existing renderer logger;
- show the current short toast;
- keep the create form usable as `自定义`.

The picker itself should not add new error surfaces for normal empty search results.

## Tests

Add or update tests near the existing Provider panel tests:

- create mode opens the preset picker from the preset trigger;
- edit mode does not show the picker trigger;
- search filters by name/model/Base URL/website URL;
- category filter limits results;
- A-Z filter limits results by preset name initial and can be cleared;
- result rows are grouped by category;
- clicking a preset closes the picker and opens the reset confirmation;
- canceling reset keeps the previous preset and form values;
- confirming reset applies preset defaults through the existing form path;
- clicking the external-link action does not select the row.

No runtime browser preview is required for verification unless explicitly requested.
