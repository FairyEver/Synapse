# Task Form Dialog UI Refactor Design

## Context

The task scheduler create/edit dialog currently presents all fields in one flat grid. The form works, but the visual density makes it hard to scan. The user chose a single-page, fully expanded layout with lightweight grouping.

This design applies only to `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx` and any directly related module-local tests. It must preserve the current task creation and editing behavior.

## Goals

- Reduce perceived density by grouping fields into clear sections.
- Keep all fields visible; do not introduce a wizard, tabs, or collapsed advanced settings.
- Keep the existing shadcn/Radix visual baseline.
- Use existing shared components before adding anything new.
- Keep the change surgical and renderer-only.

## Non-Goals

- No changes to task scheduler data types, persistence, IPC, or Electron services.
- No new scheduling capabilities.
- No custom colors, custom CSS modules, gradients, or page-specific visual system.
- No broad refactor of task scheduler state management.

## Chosen Approach

Use a single-page form with four lightweight sections:

1. **基础信息**: name, scope, project selector, description.
2. **触发计划**: trigger type, cron expression or interval minutes, interval anchor.
3. **执行内容**: action mode, shell, working directory, command or script content.
4. **运行设置**: environment variables, enabled switch, missed-run policy, timeout settings.

Each section uses a plain heading and spacing to establish hierarchy. Sections should not be rendered as nested cards. If a subtle divider is needed, use shadcn/Tailwind token-based spacing or `Separator`, but avoid repeated divider-heavy layout.

## Dialog Structure

The dialog should adopt the existing shared `FormDialog` pattern:

- Header stays at the top with `新建任务` or `编辑任务`.
- Body scrolls independently when content exceeds viewport height.
- Footer stays stable at the bottom with cancel/save actions.
- Width should use a restrained wider dialog, matching existing edit dialogs at `sm:max-w-[850px]`, so grouped rows have room without becoming a full-page surface.

The existing description text `保存后按计划执行。` is not necessary for completing the form and should be removed unless a concise replacement is required by validation or workflow.

## Field Layout

Use `Field`, `FieldGroup`, `FieldLabel`, `FieldContent`, and `FieldError` from `desktop/src/components/ui/field.tsx`, matching newer create dialogs in rules/prompts.

Recommended section layout:

- **基础信息**
  - First row: `名称` and `作用域`.
  - `项目` appears only when scope is project.
  - `描述` remains optional and full width.
- **触发计划**
  - First row: `触发方式` and the active schedule input.
  - `锚点` appears only for interval triggers.
- **执行内容**
  - First row: `执行类型`, `Shell`, `工作目录`.
  - `命令` or `脚本` textarea full width.
- **运行设置**
  - `环境变量` textarea full width.
  - Switches and timeout use a compact grid below the textarea.

Textarea rows should be explicit enough to make the command/script field useful without dominating the dialog. The environment variable textarea can be shorter than the command/script textarea.

## Interaction Behavior

The refactor should preserve current behavior:

- Opening the dialog resets form state from the selected task or defaults.
- Scope type controls whether project selector is visible.
- Trigger type controls whether cron, interval minutes, and interval anchor are visible.
- Action mode controls whether the content label reads `命令` or `脚本`.
- Timeout switch controls whether timeout minutes input is disabled.
- Save remains disabled until required fields are present.
- Submit still calls `buildTaskCreateInput` or `buildTaskUpdateInput`.

The save action should be a form submit button if `FormDialog` is used. This keeps keyboard Enter behavior aligned with standard forms.

## Error Handling

Current submit errors should remain visible in the footer area using existing `FieldError`/destructive token styling. Validation behavior in `desktop/src/modules/task-scheduler/utils.ts` should not change.

Inline field errors are not required for this refactor because the existing task form validation is submit-level. Adding field-level validation would expand scope and should be deferred unless requested separately.

## Component Boundaries

Keep new helper components module-local inside `task-form-dialog.tsx` unless they become broadly reusable. Acceptable helpers:

- `TaskFormSection` for section title plus content.
- `TaskField` if the local field wrapper remains useful.
- `ToggleField` may stay local, but should align visually with the rest of the form and avoid acting like a nested card stack.

Do not add a new shared primitive under `desktop/src/components/` for this task.

## Testing

Add focused renderer tests for the dialog structure:

- Create mode renders the four section headings.
- Project selector appears only when `作用域` is project.
- Interval anchor appears only when trigger type is interval.
- Command/script label follows action mode.

Existing utility tests should remain unchanged unless the UI refactor exposes a test helper need. Run the task scheduler tests and the desktop hard-constraints check before implementation is considered complete.

## Acceptance Criteria

- The dialog visually scans as four clear sections.
- All current fields remain available in one scrollable page.
- The footer action area remains stable at the bottom of the dialog.
- No custom colors, inline styles, CSS modules, or new dependencies are introduced.
- Existing task create/edit behavior is preserved.
