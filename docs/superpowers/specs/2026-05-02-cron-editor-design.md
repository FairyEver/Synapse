# Cron Editor Design

## Context

The task scheduler form currently renders the Cron schedule as a plain text input. The main process validates and executes five-field cron expressions, but the renderer does not provide immediate validation, common schedule templates, or run-time preview before saving.

The user wants a Cron editor that remains field-compatible with ordinary form inputs. Outside the editor dialog it must look and behave like a normal input, with a button embedded inside the input on the right. The detailed editor lives in a compact modal.

## Goals

- Replace the current task scheduler Cron text field with a reusable `CronInput`.
- Keep the outer control visually compatible with existing input fields.
- Use an embedded right-side action button inside the input, following the existing `InputGroup` pattern.
- Provide a compact modal editor for common schedule templates, raw expression editing, validation, and future run preview.
- Generate and validate only the current five-field cron syntax supported by the task scheduler backend.
- Preserve the stored value as a plain cron expression string.
- Keep the change renderer-only for the first version.

## Non-Goals

- No scheduler data model changes.
- No IPC or main-process API changes.
- No new cron syntax beyond the current backend support.
- No seconds field, Quartz syntax, `?`, `L`, `W`, or `#`.
- No custom color system, CSS module, inline style, or new dependency.
- No broad refactor of the task scheduler form.

## Chosen Approach

Build a lightweight renderer-side editor:

```text
desktop/src/modules/task-scheduler/components/cron-input.tsx
desktop/src/modules/task-scheduler/components/cron-editor-dialog.tsx
desktop/src/modules/task-scheduler/cron-utils.ts
```

`CronInput` is the only component used by `TaskFormDialog`. It accepts the normal controlled input shape:

```ts
type CronInputProps = {
  id: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}
```

The value remains a string such as `0 9 * * *`. The editor dialog keeps a draft copy while open. Closing or canceling discards the draft. Clicking `应用` writes the draft back through `onChange`.

## Outer Field

The outer field must not render an `Input` and `Button` as separate adjacent controls. It should follow the existing shadcn input-group pattern used by the task scheduler working-directory field:

- `InputGroup`
- `InputGroupInput`
- `InputGroupAddon align="inline-end"`
- `InputGroupButton`

The right-side button should be visually inside the input border and use the concise text `编辑`. It should not add a second border or create a separate button group.

The task scheduler form should keep the existing `TaskField` label and grid placement. Only the Cron field body changes from `Input` to `CronInput`.

## Dialog Layout

The dialog should be compact because it edits one field, not an entire task. Use the shared `Dialog` and `FormDialog` pattern with a restrained width around `sm:max-w-[560px]`.

Structure:

1. Header: title `编辑 Cron`.
2. Body: compact vertical layout.
3. Tabs: `常用` and `高级`.
4. Preview: future five run times for the current draft.
5. Footer: `取消` and `应用`.

Avoid a sidebar, large multi-column editor surface, nested cards, or a full-screen form layout. Content should remain dense but readable.

## Common Templates

The default tab is `常用`. It supports the first-version practical template set:

- 每 N 分钟
- 每小时
- 每天
- 每周
- 每月
- 工作日

Template selection should reveal only the needed parameters:

- 每 N 分钟: interval minutes.
- 每小时: minute.
- 每天: hour and minute.
- 每周: weekday, hour, and minute.
- 每月: day of month, hour, and minute.
- 工作日: hour and minute.

Changing parameters updates the dialog draft only. The outer input does not change until `应用`.

Generated expressions:

- Every N minutes: `*/N * * * *`
- Hourly at minute M: `M * * * *`
- Daily at HH:MM: `M H * * *`
- Weekly: `M H * * W`
- Monthly: `M H D * *`
- Weekdays: `M H * * 1-5`

## Advanced Tab

The `高级` tab provides direct raw expression editing. It is useful for existing values that do not match a common template, and for users who already know cron syntax.

The raw editor still uses the same renderer-side validation and preview. It must only accept the supported five-field syntax.

## Validation And Preview

Add renderer-side pure utilities that mirror the current backend behavior:

- Parse five cron fields.
- Support `*`, comma lists, ranges, and step syntax.
- Support English month and weekday aliases, matching the current backend parser.
- Normalize weekday `7` to Sunday.
- Compute the next five run times from the current local time.

Invalid expressions should show a concise field error in the dialog and disable `应用`. The outer field remains editable, so users can still type manually. The final save path remains protected by the existing main-process validation.

Run preview shows the next five local run times using the existing date formatting style where possible. If the expression is invalid, the preview area should be replaced by the validation message.

## State Flow

1. User edits the outer input manually, or opens the editor.
2. Opening the editor copies `value` into local draft state.
3. Template or advanced edits update the draft.
4. Validation and preview are derived from draft state.
5. `取消` or closing the dialog discards draft state.
6. `应用` writes the draft to the outer field and closes the dialog.
7. The task form submit path remains unchanged.

## Component Boundaries

`CronInput` and `CronEditorDialog` should live under the task scheduler module for the first version. They can be promoted later if another module needs the same control.

`cron-utils.ts` should be pure TypeScript with no React dependency. Keep it small and explicit. Avoid a general cron library unless the project later decides to unify backend and frontend parsing through one shared package.

## UI Rules

- Use existing shadcn/Radix primitives from `desktop/src/components/ui/`.
- Use `InputGroup` for the embedded button shape.
- Use `Tabs`, `Select`, `Input`, `Field`, `FieldError`, and `Button` for the modal body.
- Use token classes only. No hard-coded hex, rgb, hsl, gradient, glow, or custom CSS module.
- Keep UI copy short: labels, validation errors, and action names only.
- Do not add explanatory marketing or implementation text inside the interface.

## Error Handling

Renderer validation errors should be local to the dialog. Submit-time backend errors should continue to surface through the task form footer as they do today.

If an existing cron expression is valid and matches one of the supported common templates, the editor opens on `常用` with the matching template selected. If it is valid but does not match a common template, the editor opens on `高级` with the raw expression unchanged. Invalid expressions open on `高级` so the user can fix the raw value directly.

## Testing

Add focused renderer tests:

- `CronInput` renders an `InputGroup` with an inline-end embedded button.
- Opening the editor does not change the outer value.
- Applying a template writes the expected cron expression.
- Canceling discards draft changes.
- Advanced raw expression editing validates five-field cron.
- Invalid expressions disable `应用`.
- Preview renders five future run times for a valid expression.

Add pure utility tests:

- Template generation for every supported template.
- Parser accepts the same core syntax as the backend.
- Parser rejects unsupported field counts and invalid ranges.
- Future run calculation returns five ascending dates.

Update the existing task form dialog test to assert the Cron field uses the input-group shape, similar to the working-directory field test.

## Acceptance Criteria

- The Cron field remains visually compatible with ordinary form inputs.
- The editor button is embedded inside the input on the right.
- The editor modal is compact and focused on one field.
- Common templates cover every N minutes, hourly, daily, weekly, monthly, and weekdays.
- Raw expression editing remains available in the modal.
- The preview shows five future run times before applying.
- No scheduler persistence, IPC, or main-process behavior changes.
- Existing task creation and editing still submit the same cron string shape.
