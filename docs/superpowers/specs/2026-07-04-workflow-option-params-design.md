# Workflow Option Parameters Design

## Context

Workflow parameters currently support `text`, `number`, `file`, and `directory`. Some workflows need a constrained string input where the workflow author defines a small list of valid values, and the runner picks one from a dropdown. In some cases, the author also wants to allow one-off values without saving those values back into the workflow definition.

This design adds a first-class `option` parameter type. It is still a string value at runtime, but it carries option metadata for editing, validation, and run-time rendering.

## Goals

- Add an `option` workflow parameter type.
- Let workflow authors define the available option values.
- Let workflow authors decide whether runners may enter values outside the option list.
- Render option parameters as dropdowns in the run parameter dialog.
- Keep the value passed into workflow variables as the selected string.
- Keep custom run-time values out of the workflow definition unless the author edits the parameter list.
- Preserve existing text, number, file, directory, preset, workflow-call, MCP, and API behavior.

## Non-Goals

- Do not add separate display labels and internal values in the first version.
- Do not auto-save custom run-time values back into `options`.
- Do not add a global option library shared across workflows.
- Do not change workflow run parameter presets from `Record<string, string>`.
- Do not redesign the whole parameter editor.

## Product Model

`option` is an enumerated string parameter. Each option string is both the UI label and the actual value passed into the workflow.

```ts
type WorkflowParamType = "text" | "number" | "file" | "directory" | "option"

interface WorkflowParam {
  name: string
  type: WorkflowParamType
  default: WorkflowParamDefault
  description?: string
  options?: string[]
  allowCustomOption?: boolean
}
```

Rules:

- `options` is used only when `type === "option"`.
- `allowCustomOption` is used only when `type === "option"`.
- Option values are strings.
- The selected option value is the actual run parameter value.
- `default` for an option parameter is `null` or one of the option strings.
- `default: null` means the parameter is required at run time.
- If `allowCustomOption` is missing, treat it as `false`.

Example:

```json
{
  "name": "report_type",
  "type": "option",
  "default": "周报",
  "options": ["日报", "周报", "月报"],
  "allowCustomOption": false
}
```

Running the workflow with `report_type = "周报"` passes the string `周报` into node variables and template interpolation.

## Parameter Editor

The existing workflow parameter editor adds `选项` to the type selector.

When a parameter is `option`, the card shows:

- `默认值`: a select control populated from the current option list, with a way to leave it empty.
- `选项`: editable string rows with add, delete, and move controls.
- `允许自定义`: a switch.

Save normalization:

- Trim every option string.
- Drop empty option rows.
- After dropping empty rows, at least one option must remain.
- Duplicate option values block saving.
- If the default value is not in the final option list, clear it to `null`.
- When the parameter type changes, clear the default value.
- When changing into `option`, start with an empty option list and require the author to add at least one option before saving.

This keeps half-filled rows from causing friction while still preventing ambiguous duplicate values.

## Run Parameters Dialog

Option parameters render based on `allowCustomOption`.

When custom values are not allowed:

- Render a normal shadcn `Select`.
- Values must come from `options`.
- Empty value is invalid when `default === null`.

When custom values are allowed:

- Render a combobox using existing shadcn `Command` and `Popover` components.
- The runner can pick an option or type a new string.
- A typed custom value is valid for that run if it is non-empty.
- The custom value is not appended to `options`.

Parameter presets continue to store raw strings:

```ts
values: Record<string, string>
```

If a preset contains a custom value for an option parameter that allows custom values, loading and running that preset is valid. If the parameter no longer allows custom values and the preset value is not in `options`, validation blocks the run.

## Runtime Normalization

`normalizeWorkflowRunParams` handles `option` parameters as strings.

Normalization rules:

- Missing or `null` values fall back to the parameter default.
- Empty required values produce the existing missing-param style error.
- Non-string option values are invalid.
- If `allowCustomOption` is false, the value must be in `options`.
- If `allowCustomOption` is true, any non-empty string is valid.
- The normalized `params`, `stringValues`, and `snapshotParams` all store the final string value.

Template interpolation keeps working because option params become strings just like text params.

## Validation

Workflow definition validation adds option-specific checks:

- `options` must exist and contain at least one non-empty value after trimming.
- Option values must be unique after trimming.
- `default` must be `null` or a string in `options`.
- `allowCustomOption`, when present, must be boolean.
- Non-option parameters ignore missing `options` and `allowCustomOption`.

The DataRepository placeholder schema, workflow IPC schemas, package import/export schema, and MCP schemas must all accept the new type and fields.

## MCP And API Contract

`app_workflow_param_update` accepts option params:

```json
{
  "name": "report_type",
  "type": "option",
  "default": "周报",
  "options": ["日报", "周报", "月报"],
  "allowCustomOption": false
}
```

`app_workflow_run_execute` passes option values as strings:

```json
{
  "workflowId": "workflow-1",
  "params": {
    "report_type": "周报"
  }
}
```

The consolidated built-in `synapse-skill` workflow guide and API reference must describe:

- the new `option` type;
- `options`;
- `allowCustomOption`;
- the fact that labels and values are the same string;
- custom run values are not saved back to the definition.

## Workflow Call Behavior

No new workflow-call mapping shape is required.

For child option parameters:

- `paramTemplates` may produce a string.
- `paramBindings` may forward a parent param, upstream output, or static string.
- The child workflow's normal parameter normalization validates the final string against the child option definition.

This keeps option params aligned with text params while preserving the child's own constraints.

## Compatibility And Migration

Existing workflows require no migration. Workflows without `option` params continue to load unchanged.

Older records that lack `options` and `allowCustomOption` remain valid because those fields are only meaningful for `option` params.

Invalid unknown parameter types should continue to use the existing load-error or validation behavior.

## UI Constraints

The implementation must follow existing Synapse UI discipline:

- Use existing shadcn/Radix components and Tailwind token classes.
- Do not add custom colors, arbitrary Tailwind colors, inline styles, decorative gradients, or explanatory UI copy.
- Keep the parameter editor change surgical.
- Use compact operational labels only.

## Testing

Tests should cover:

- Editing and saving an option param.
- Empty option rows are dropped on save.
- Saving fails when all option rows are empty.
- Duplicate option values block saving.
- Default value is cleared when it is no longer in `options`.
- Run dialog renders a select for closed option params.
- Run dialog accepts custom values only when `allowCustomOption` is true.
- Parameter presets can store and reload valid custom option values.
- Runtime normalizer rejects option values outside `options` when custom values are disabled.
- Runtime normalizer accepts non-empty custom strings when custom values are enabled.
- Validator rejects invalid option definitions.
- IPC, DataRepository schema, MCP tool schema, and built-in `synapse-skill` docs include the new fields.
- Existing text, number, file, and directory parameter behavior remains unchanged.

## Release Notes

Because this is user-visible workflow functionality, implementation should update `RELEASE_NOTES_PENDING.md` with a short note explaining that workflow run parameters can now be configured as option dropdowns, with optional custom input.
