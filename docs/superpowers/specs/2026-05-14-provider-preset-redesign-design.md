# Provider Preset Redesign

## Goal

Redesign AI provider presets so they behave as a create-form shortcut instead of a separate creation path.

Users should add a provider from one place: the existing Add Provider form. Presets appear inside that form as a dropdown. Selecting a preset resets the create form and fills it with the provider's default values after the user confirms.

## References

- Synapse current UI: `desktop/src/modules/settings/components/provider-panel.tsx`
- Reference behavior: `/Users/liyang/Documents/code/demo/cc-switch-main/src/components/providers/forms/ProviderForm.tsx`
- Reference selector: `/Users/liyang/Documents/code/demo/cc-switch-main/src/components/providers/forms/ProviderPresetSelector.tsx`

## Interaction Design

Provider list actions:

- Keep the primary `添加` action.
- Remove the separate `从预设添加` action.
- Do not expose a separate preset creation dialog from the Provider list.

Add Provider form:

- Show a `供应商预设` dropdown at the top of the form.
- Default selection is `自定义`.
- The dropdown is shown only when creating a new Provider.
- Editing an existing Provider does not show the dropdown.

Preset selection:

- When the user selects a preset, show a confirmation dialog before mutating the form.
- The confirmation copy must be brief and explicit: choosing this preset will reset the current form and fill the provider defaults.
- If the user confirms, reset the whole create form and apply the selected preset defaults.
- If the user cancels, keep the previous dropdown value and leave the form unchanged.

## Data And State

The UI no longer creates providers through a separate preset-save path.

The renderer should:

- Load presets through the existing `listProviderPresets()` bridge method.
- Convert the selected preset into `ProviderFormValues`.
- Save through the existing `createProvider(buildCreateInput(formValues))` path.
- Stop calling `createProviderFromPreset` from this UI flow.

Preset-to-form mapping:

- `id`: generated from the preset name, using a suffix if the ID already exists.
- `name`: preset name.
- `category`: preset category.
- `baseUrl`: preset base URL after template values are applied.
- `apiKeyField`: preset API key field.
- `apiKey`: empty.
- `model`, `haikuModel`, `sonnetModel`, `opusModel`: preset defaults after template values are applied.
- `active`: create-form default.
- `sortIndex`: create-form default.

Template values:

- If a preset defines template values, show a `预设参数` section inside the create form.
- Initialize each template parameter from its preset default.
- When a template parameter changes, re-apply the preset and update the mapped form fields.
- API keys remain user-entered and are not filled from preset defaults.

## Component Scope

Primary file:

- `desktop/src/modules/settings/components/provider-panel.tsx`

Expected UI changes:

- Remove `ProviderPresetDialog`.
- Remove the separate preset dialog open state and submit handler.
- Extend `ProviderFormDialog` with create-mode preset selection.
- Use existing shadcn/Radix components and theme tokens.
- Avoid custom styling, custom colors, nested cards, or explanatory UI copy.

Expected helper functions:

- Generate a safe provider ID from a preset name and existing providers.
- Convert a preset into form values.
- Build default template parameter values.
- Apply template parameter values to preset fields.

These helpers should stay module-local unless another file already owns the same concern.

## Error Handling

- If loading presets fails, log with the existing renderer logger and show a short toast.
- The Add Provider form must remain usable as `自定义` even if presets fail to load.
- Confirmation cancellation is not an error and must not log.

## Tests

Update the existing Provider panel tests to cover:

- Create mode shows the preset dropdown.
- Edit mode does not show the preset dropdown.
- Selecting a preset asks for confirmation.
- Confirming resets the form and fills preset defaults.
- Canceling confirmation leaves the form unchanged.
- Saving after applying a preset calls `createProvider`.
- Saving from this UI flow does not call `createProviderFromPreset`.
- Template parameter edits update mapped preset fields.

## Out Of Scope

- Removing the backend `createProviderFromPreset` service or IPC method.
- Redesigning the broader Settings page.
- Adding new provider preset data.
- Importing cc-switch configuration.
- Changing Provider storage or secret storage semantics.
