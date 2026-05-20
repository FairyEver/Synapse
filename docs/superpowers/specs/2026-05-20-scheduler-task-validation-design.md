# Scheduler Task Validation Design

Date: 2026-05-20

## Problem

Older scheduled tasks can contain action configs that were valid when saved but no longer pass the current action schema. Today these tasks fail only when a user runs them, and the failure is surfaced as a generic execution failure. The current failure happens before the action starts because the scheduler parses `task.action.config` with the current action manifest schema.

This is risky after upgrades: existing users can have enabled tasks that look runnable but cannot run.

## Goals

- Detect outdated scheduled task configs before manual run, enable, and scheduled execution.
- Show affected tasks as needing user attention in the task list.
- Treat invalid tasks as disabled at runtime without mutating stored task data.
- Let users edit affected tasks and save them only after the config passes current validation.
- Keep the design extensible for future action config format changes.

## Non-Goals

- Do not rewrite or migrate existing task records automatically.
- Do not silently infer provider or model choices for existing tasks.
- Do not restore unsupported agent types by mapping them to another runtime.
- Do not introduce new styling systems or custom colors.

## Proposed Approach

Use a lightweight action compatibility layer plus main-process enforcement.

Each action can describe whether a stored config is valid for the current runtime and which user-facing fixes are needed. The task scheduler consumes that generic result and does not hard-code `builtin.agent` fields in UI components or scheduler flow.

The scheduler computes a runtime validation state for each task:

```ts
type ScheduledTaskValidation =
  | { status: "valid"; issues: [] }
  | {
      status: "needs_update"
      issues: Array<{
        field: string
        message: string
      }>
    }
```

This state is returned with task list/get responses and checked again before privileged operations. Stored task data remains unchanged until the user saves an edit.

## Runtime Behavior

When a task validation status is `needs_update`:

- The scheduler treats the task as disabled for runtime decisions.
- Manual run is blocked.
- Enabling the task is blocked.
- Scheduled execution is skipped before action execution starts.
- The task's stored `enabled` value is not changed.

Scheduled skips should be recorded as `skipped` runs with a concise reason such as `任务配置需要更新`. This gives users and support staff a visible audit trail without pretending the action actually ran.

Manual run and enable attempts should return a structured failure that the renderer can show as a short message. They should not create action runs.

## List UI

The task list displays `needs_update` as the highest-priority task state:

- Badge: `需要更新`
- Enable switch: visually off and disabled
- Run button: disabled
- Next run: `需要更新`
- Edit, history, and delete remain available

This is a runtime presentation state only. If a task has `enabled: true` in storage but needs an update, the UI still shows it as not currently active.

## Edit Flow

Clicking edit for a task that needs an update first opens a small dialog:

- Title: `任务需要更新`
- Content: a short list of required fixes, for example:
  - `选择供应商`
  - `选择模型`
- Actions: `去编辑` and `取消`

After the user chooses `去编辑`, the existing edit form opens. Existing valid fields are preserved in the form. Missing or invalid fields remain empty or require re-selection. Saving uses the current action schema. Once the save succeeds, the task naturally leaves `needs_update`.

Clicking edit for a valid task opens the form directly.

## Action Compatibility

Add a small compatibility API near action definitions. The exact naming can be refined during implementation, but the capability should cover:

- Validate stored config without throwing.
- Return concise user-facing issue messages.
- Prepare legacy config for edit form display without writing it back.

Example shape:

```ts
type ActionStoredConfigValidation = {
  status: "valid" | "needs_update"
  issues: Array<{ field: string; message: string }>
}

type ActionCompatibility<TConfig> = {
  validateStoredConfig(config: Record<string, unknown>): ActionStoredConfigValidation
  prepareConfigForEdit?(
    config: Record<string, unknown>,
    defaults: unknown,
  ): Partial<TConfig>
}
```

If an action does not provide a custom validator, the default behavior is to run `manifest.configSchema.safeParse(config)`. A failed default parse produces a generic `检查执行内容` issue.

## Current `builtin.agent` Rules

For existing agent tasks:

- Missing `providerId`: issue `选择供应商`.
- Missing or invalid `modelTier`: issue `选择模型`.
- Unsupported `agentType`, such as `codex`: issue `选择当前支持的 Agent`.
- Unsupported permission mode, such as `yolo`: issue `选择权限模式`.

These issues are user actions, not automatic migrations. The form should guide the user to choose valid current values.

## Data Flow

1. Repository loads stored tasks unchanged.
2. Scheduler service enriches task DTOs with validation state.
3. Renderer list consumes validation state for badges and disabled controls.
4. Manual run, enable, and scheduler tick revalidate before acting.
5. Edit dialog uses validation issues to show the update prompt.
6. Save writes only the user's submitted valid task patch.

## Error Handling

- Validation failures should not be logged as action execution errors.
- Scheduled skips should be recorded as `skipped` with a concise reason.
- Manual run and enable attempts should return actionable errors.
- Logs should include task id, action type, validation status, and issue count, but not prompt content.

## Testing

Main-process tests:

- Lists return `needs_update` for legacy agent configs missing provider/model fields.
- `setEnabled(true)` rejects `needs_update` tasks without changing stored `enabled`.
- Manual run rejects `needs_update` tasks before action execution.
- Scheduler tick skips `needs_update` tasks and records `skipped`.
- Valid tasks continue to run normally.

Renderer tests:

- Task card shows `需要更新`, disabled switch, disabled run button, and `需要更新` next-run text.
- Edit on invalid task opens the update dialog before the form.
- Edit on valid task opens the form directly.
- Saving a corrected task removes the `needs_update` presentation after list refresh.

Compatibility tests:

- `builtin.agent` reports missing provider/model with specific issue messages.
- Unsupported legacy `agentType` and `mode` produce specific issues.
- Default action compatibility falls back to schema parsing.

## Implementation Notes

- Keep UI composition on existing shadcn components and token classes.
- Do not add custom colors, inline styles, or new visual primitives.
- Keep validation logic out of `TaskCard`; cards should render status from task DTOs.
- Keep action-specific compatibility close to action packages, not in scheduler UI.
- Do not mutate legacy task records until the user saves the edit form.
