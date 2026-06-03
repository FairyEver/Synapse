# Automation Editor Redesign

Date: 2026-06-03

## Context

The existing Automation renderer followed the old Automation Module Design and implemented create/edit as an in-page dialog with card-grid list management. That was the wrong product direction for the Automation UI.

This spec replaces the renderer-side Automation list and editor behavior from `docs/superpowers/specs/2026-06-03-automation-module-design.md`. The old main-process data model, scheduler runtime, IPC surface, Action Runtime executor reuse, and one-trigger-one-executor product model remain valid unless this spec explicitly changes them.

The old design statement `No dedicated editor window in this phase` is no longer valid for Automation UI work. Automation create and edit must use a dedicated editor window.

## Goals

- Make the main Automation page a simple list that follows the existing Workflow page layout.
- Open a dedicated Automation editor window for both create and edit.
- Reuse and focus the existing editor window when opening the same Automation item again.
- Keep the editor shape close to the Feishu Automation reference: editable title, two-column builder, footer actions.
- Use a lightweight, restrained UI: white surface, careful spacing, minimal borders, no large background blocks, no decorative gradients, no custom colors.
- Model triggers the same way executors are modeled: each trigger owns its manifest, schema, default config, summary, and renderer config panel.
- Let users clear a selected trigger or executor and return to the selection list.

## Non-Goals

- Do not change the Automation runtime execution model beyond UI needs.
- Do not add new trigger types beyond the current first phase: Cron and fixed interval.
- Do not add Workflow executor support in this redesign.
- Do not migrate or alter old Task Scheduler data.
- Do not introduce custom colors, icons for trigger/executor choices, card-heavy layouts, marketing copy, or explanatory UI text.
- Do not make create/edit a Dialog, Sheet, or embedded mode inside the main Automation tab.

## Main Automation Page

The main Automation page follows the current Workflow page layout pattern:

- Full-height module with `bg-surface`.
- Top row: left title `自动化`, right action button `新建`.
- Body: scroll area with a vertical list of wide rows.
- Empty, loading, and error states should use the same density and tone as Workflow.

Each row should follow the Workflow row component shape:

- Left content: Automation name.
- Right metadata: trigger summary and executor summary.
- Right actions: run, history, delete, and any existing enable/disable control if still required by the current product state.
- Clicking the row body opens the Automation editor window.
- Clicking row actions must not open the editor.

The list is a list, not a card grid. Do not preserve `AutomationCardGrid` as the primary page surface.

## Editor Window

Create and edit use a dedicated Electron child window.

Window behavior:

- `create` opens one draft editor window. If a create draft window is already open, focus it.
- `edit` opens one window per Automation id. If that id is already open, focus the existing window.
- The editor window has its own renderer entry, similar to Workflow editor and Content editor windows.
- Reopening the same item must not create duplicate editors.
- Window close with unsaved changes should protect the draft using the existing app confirmation pattern.

The editor layout:

- Native window title bar label may be `新窗口：自动化编辑器` or the app-standard equivalent.
- Inside the editor content, the top area contains only the editable Automation title.
- Do not show a redundant `自动化` label on the right side of the editor header.
- A thin necessary divider separates the title area from the builder area.
- The builder area is two columns:
  - Left: `当以下情况发生时`
  - Right: `就执行以下操作`
- A thin vertical divider between the two columns is acceptable.
- The footer contains two buttons aligned to the right:
  - `仅保存`
  - `保存并启用`

Save semantics:

- `仅保存`: save the configuration and preserve the current enabled state. For a new Automation, save it disabled.
- `保存并启用`: save the configuration and set the Automation enabled.

## Builder Interaction

The builder is selection-first, then configuration.

Initial state:

- Left column directly lists available triggers.
- Right column directly lists available executors.
- No large empty placeholder panel.
- No trigger/executor icons until the product has designed them.

List visual behavior:

- Normal rows have no background.
- Normal rows have no row dividers.
- On hover, the current row gets a very light muted background.
- Use spacing, alignment, and text hierarchy instead of borders and alternating backgrounds.
- Keep copy minimal: choice name, concise secondary line, and a small `选择` affordance are enough.

Selected state:

- Selecting a trigger replaces the left list with that trigger's config panel.
- Selecting an executor replaces the right list with that executor's config panel.
- The selected panel header shows the selected item name, concise summary, and a `重新选择` action.
- `重新选择` clears only that side and restores its selection list.
- Clearing a side should preserve the other side's selection and config.

## Trigger Architecture

Triggers must mirror the existing Action Runtime renderer pattern.

Add renderer-side trigger definitions with:

- `manifest.id`
- `manifest.title`
- `manifest.defaultConfig`
- `manifest.configSchema`
- `summarizeConfig(config)`
- optional `ConfigForm`

The renderer trigger registry should provide:

- `register`
- `get`
- `list`
- `getDefaultConfig`
- `parseConfig`
- `summarize`

First built-in triggers:

- `builtin.cron`
- `builtin.interval`

Trigger config forms:

- Cron: expression, timezone, active days.
- Fixed interval: interval minutes, anchor, active days.

The existing main-process `AutomationTriggerRegistry` can remain the runtime registry, but renderer config UI must not be hard-coded inside one Automation form component.

## Executor Architecture

Automation continues to reuse `rendererActionRegistry` and existing Action Runtime config forms.

The editor's executor list should be built from `rendererActionRegistry.list()`.

The selected executor panel should render the executor's existing `ConfigForm`. It should not duplicate command, script, HTTP request, or Agent config UI.

## Data Flow

Create flow:

1. Main Automation page calls an `openCreateEditorWindow` bridge method.
2. The window opens in draft mode with default title and no selected trigger or executor.
3. Selecting trigger/executor initializes their configs from registry default config.
4. `仅保存` creates the item disabled.
5. `保存并启用` creates the item enabled.
6. The main list refreshes through the existing Automation changed event.

Edit flow:

1. Main Automation row calls `openEditorWindow(id)`.
2. The editor window loads the Automation item by id.
3. Existing trigger/executor refs populate selected panels.
4. Edits stay local until save.
5. Saving updates the item and emits the existing change event.

## Validation And Errors

The editor can save only when:

- Title is not empty.
- Trigger is selected.
- Executor is selected.
- Trigger config parses through the renderer trigger registry.
- Executor config parses through `rendererActionRegistry`.

Error UI should be short and local. Prefer field-level errors where a config form already supports them; otherwise show one concise footer error.

Do not log prompt text, request bodies, secrets, Authorization values, cookies, tokens, or environment values.

## Testing Strategy

Renderer tests:

- Automation page follows Workflow-style list layout and no longer renders the form dialog for create/edit.
- New button opens create editor window.
- Row body opens edit editor window.
- Row action buttons do not open the editor.
- Editor window initial state shows trigger and executor lists.
- Selecting a trigger renders that trigger config panel.
- Selecting an executor renders that executor config panel.
- `重新选择` restores only that side's list.
- `仅保存` creates a disabled item for new Automation.
- `保存并启用` creates or updates an enabled item.
- Existing executor ConfigForm is rendered from `rendererActionRegistry`.
- Trigger config is parsed through the new renderer trigger registry.

Main-process/window tests:

- Create editor reuses an existing create draft window.
- Edit editor reuses and focuses the same Automation id window.
- Different Automation ids can have different editor windows.
- Loading failures close or display an error without creating duplicate windows.

Regression tests:

- Existing Automation IPC create/update/list/run behavior remains compatible.
- Existing Automation runtime tests continue to pass.
- Existing Task Scheduler tests continue to pass.

## Implementation Notes

Prefer small, staged changes:

1. Add renderer trigger registry and built-in trigger renderer definitions.
2. Add Automation editor window service and IPC/preload bridge methods.
3. Add editor window renderer entry.
4. Replace the main Automation card grid with Workflow-style list rows.
5. Move create/edit from dialog state to editor-window open calls.
6. Remove or stop using the old form dialog after the editor is complete.

Update `RELEASE_NOTES_PENDING.md` during implementation because this is a user-visible UI correction.
