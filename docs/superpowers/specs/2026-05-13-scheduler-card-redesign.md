# Scheduler Task Card Redesign

## Context

The task scheduler list currently renders each task as a compact card in `desktop/src/modules/task-scheduler/components/task-card.tsx`. The card exposes the right data, but the hierarchy is flat:

- Status is represented only by a small dot.
- Trigger, last run, and next run have equal visual weight.
- Run, edit, history, and delete actions compete at the same level.
- Disabled tasks become dim, but still read like active tasks at a glance.

The user approved the visual direction in:

- `docs/superpowers/previews/2026-05-13-scheduler-card-redesign.svg`

## Goals

- Make each card more visually polished while staying on the current shadcn/Radix baseline.
- Make the list easier to scan by emphasizing status, next run, and the primary action.
- Keep card density suitable for an internal tool list view.
- Preserve all existing task operations.
- Keep changes surgical and renderer-only.

## Non-Goals

- No new scheduling capabilities.
- No changes to Electron services, IPC, persistence, or task schemas.
- No custom theme, hard-coded app color system, gradients, decorative effects, or new dependencies.
- No broad refactor of task scheduler state management.
- No table/list-view mode switch in this pass.

## Chosen Approach

Use a **status-driven card**. Each card should make these questions answerable in one glance:

1. Is this task enabled?
2. Did the last run succeed?
3. When will it run next?
4. What is the main action I can take now?

The card keeps the existing grid presentation, but reorganizes content into a clearer structure:

1. Status badge and enable switch.
2. Task name and optional description.
3. Highlighted schedule block with next run and trigger summary.
4. Compact metadata row for last result and scope.
5. Primary action plus secondary actions menu.

## Layout

### Card Header

The header contains:

- A small status badge:
  - `已启用` for enabled tasks with no failure status.
  - `上次失败` for `failed` or `timeout`.
  - `已停用` for disabled tasks.
- The existing `Switch`, aligned to the right.

Use shadcn `Badge` variants and token-based classes. Do not introduce hard-coded color literals. If a failure state needs emphasis, use the existing destructive token or `Badge` destructive variant.

### Title Area

Show the task name as the primary text. If `task.description` exists, show it below as one truncated muted line. Do not add explanatory text.

### Schedule Block

Replace the current flat key/value rows with one compact muted block:

- Left side: `下次执行`
  - Enabled: formatted `nextRunAt`, falling back to `—`.
  - Disabled: `停用中`.
- Right side: trigger summary:
  - Cron tasks: `Cron · <expr>`.
  - Interval tasks: existing interval copy, including `完成后` when anchored to `last_completed_at`.

The block should use existing token surfaces such as `bg-muted/50` and `border-border`. It should not be a nested card; it is a lightweight information block inside one card.

### Metadata Row

Below the schedule block, show compact metadata:

- `上次`: formatted `lastRunAt` plus status label when available.
- `范围`: existing task scope formatter.

Thread the existing `config.global.projects` from `TaskSchedulerModule` to `TaskCardGrid` and `TaskCard`, then use the existing `formatTaskScope` helper. This keeps the scope label accurate without adding new lookup logic inside the card.

### Actions

Make the primary action explicit:

- Enabled and idle: `运行`.
- Enabled with last failure/timeout: `重试`.
- Busy/running context: `停止`.
- Disabled: primary action disabled.

Move secondary actions into a `DropdownMenu` opened by an icon button:

- `编辑`
- `历史`
- `删除`

This keeps the card quieter and makes the user’s likely next action easier to find.

## Visual Rules

- Use `Card`, `CardHeader`, `CardContent`, `CardFooter` only if they help align with existing shadcn structure. A plain module-local composition is acceptable if it matches the existing module pattern.
- Use existing `Button`, `Badge`, `Switch`, `Tooltip`, and `DropdownMenu`.
- Use lucide icons for icon-only controls.
- Use token classes such as `bg-card`, `bg-muted/50`, `text-muted-foreground`, `border-border`, and `ring-foreground/10`.
- Do not use inline `style`, CSS modules, hard-coded hex/rgb/hsl colors, gradients, glow effects, or custom shadows.
- Avoid card-inside-card composition. The schedule block is a muted information region, not a separate card.

## Behavior

Preserve current behavior:

- Toggling the switch enables/disables a task.
- Running a `builtin.agent` task still requests watching the next agent session when a project id exists.
- Run, stop, edit, history, and delete callbacks keep their existing signatures.
- Busy state still prevents conflicting mutations.
- Disabled tasks cannot be run manually from the card.

The secondary actions menu must stop event propagation if the card later becomes clickable. The current card is not clickable, so no navigation behavior is required.

## Component Boundaries

Keep changes local to the task scheduler module:

- `desktop/src/modules/task-scheduler/components/task-card.tsx`
- `desktop/src/modules/task-scheduler/components/task-card-grid.tsx`
- `desktop/src/modules/task-scheduler/index.tsx` to pass project config to the grid.
- `desktop/src/modules/task-scheduler/utils.ts` only for small formatting helpers.
- Focused tests under `desktop/src/modules/task-scheduler/__tests__/`.

Do not create a new shared card primitive.

## Testing

Add or update focused tests for:

- Enabled task renders status, next run, trigger, and primary `运行`.
- Failed or timeout task renders failure status and primary `重试`.
- Disabled task renders `停用中` and disables primary run.
- Secondary actions are available through the menu.

Run, at minimum:

```bash
pnpm --filter @synapse/desktop run test -- task-scheduler
pnpm --filter @synapse/desktop run check:hard-constraints
```

## Acceptance Criteria

- The implemented card matches the approved preview direction.
- A user can identify enabled/disabled/failed tasks without reading every row.
- Next run and trigger are easier to scan than in the current card.
- Secondary actions are present but visually quieter.
- Existing scheduler list operations still work.
- No custom colors, inline styles, CSS modules, new dependencies, or theme changes are introduced.
