# auto Continuous Pool Scheduling Design

## Goal

Replace `auto`'s batch barrier scheduler with a continuous worker pool. When concurrency is 4, the system should keep up to 4 worker slots busy. As soon as any slot finishes its current worker run, the scheduler immediately starts another run in that same slot unless the user has requested stop.

This maximizes queue utilization for long-running parallel work. Fast workers no longer sit idle while waiting for the slowest worker in the previous batch.

## Current Problem

`auto/src/runner.ts` currently starts one batch with `Promise.all(workers.map(...))`. `auto/src/scheduler.ts` waits for that full batch to resolve, then waits `intervalSeconds`, then starts the next batch.

That creates a full-batch barrier:

- Worker 1, 2, and 4 can finish early.
- Worker 3 can keep running for much longer.
- The finished worker capacity stays unused until Worker 3 finishes.

The UI is accurately showing the backend behavior; the inefficient part is the scheduling model.

## Non-Goals

- Do not introduce per-worker worktrees.
- Do not add file locks, automatic conflict resolution, or task claiming at the scheduler layer.
- Do not add a finite run count. Continuous mode runs until the user stops it.
- Do not start the Synapse Electron dev server for validation.
- Do not redesign the whole `auto` UI beyond the fields and labels affected by the scheduling model.

## Scheduling Model

`concurrency` becomes the number of fixed slots. Each slot owns one worker process at a time.

When the user starts the scheduler:

1. Create a run session id.
2. Create `concurrency` slot records.
3. Start one worker run per slot.
4. When a slot's worker finishes, record the result and immediately start the next run in that slot.
5. Continue indefinitely while the scheduler remains active.

Each new run should receive:

- The same saved prompt and provider config.
- The same working directory.
- The slot id.
- A monotonically increasing run sequence for display and logs.
- The current total slot count, so the prompt wrapper can still say which parallel worker it represents.

The worker process behavior remains owned by `runWorker`. The scheduler should orchestrate repeated starts; it should not duplicate child-process logic.

## Interval Removal

Remove `intervalSeconds` from the active scheduling model.

Implementation expectations:

- Remove the loop interval field from the Web UI.
- Remove `intervalSeconds` from new saved config output.
- Keep load-time compatibility for old `state/ui-config.json` files that still contain `intervalSeconds`; reading old files should not fail.
- Update docs and tests that describe the old interval behavior.

`pnpm once` may keep a one-shot behavior: start `concurrency` workers once, wait for all of them, then exit. It should not become an infinite command unless the user explicitly starts the Web scheduler.

## Stop Behavior

Rename the user-facing action from batch stop semantics to slot drain semantics.

Recommended UI label:

```text
当前任务后停止
```

Backend behavior:

- Calling stop sets `drainAfterCurrent = true`.
- Running workers are not killed.
- A slot that finishes while drain is enabled records its result and becomes idle.
- No new worker run is started for drained slots.
- When all slots are idle, scheduler status becomes `stopped`.

Use `draining` as the scheduler status while waiting for active slots to finish after a stop request. This is clearer than the old `stopping`, because no child process is force-stopped.

## Status Model

Replace batch snapshots with session and slot snapshots.

```ts
export type SchedulerStatus = 'idle' | 'running' | 'draining' | 'stopped' | 'error'

export interface SchedulerSnapshot {
  status: SchedulerStatus
  drainAfterCurrent: boolean
  activeConfig: UiConfig | null
  session: RunSessionSnapshot | null
  error: string
}

export interface RunSessionSnapshot {
  id: string
  startedAt: string
  durationMs: number
  slots: SlotSnapshot[]
  recentRuns: WorkerResult[]
  totals: RunTotals
  summaryPath: string
}

export interface SlotSnapshot {
  slotId: number
  sequence: number
  worker: WorkerResult | null
}

export interface RunTotals {
  started: number
  success: number
  error: number
  timeout: number
}
```

Notes:

- `worker.id` can remain the slot id for compatibility with output buffering.
- `sequence` disambiguates repeated runs in the same slot.
- `recentRuns` should be bounded so an infinite run does not grow frontend memory without limit.
- Existing worker statuses can remain `pending`, `running`, `success`, `error`, and `timeout`.

## Output Buffering

Current output buffering is keyed by `workerId`. In continuous mode, the same slot id will run many workers over time. The buffer must avoid mixing old and current output in a confusing way.

Use one of these small, local options:

- Include run sequence in output identity, such as `{ slotId, sequence }`.
- Or reset the per-slot buffer whenever a slot starts a new run.

The first option is better for recent history. The second option is simpler if the UI only shows the active run output. The implementation should choose one and keep the UI consistent with it.

## Logging

Change logs from batch directories to session directories.

```text
logs/
  2026-05-26T12-00-00/
    summary.md
    slot-1-run-0001.md
    slot-1-run-0005.md
    slot-3-run-0007.md
```

`summary.md` should record:

- Session start time.
- Working directory.
- Provider.
- Concurrency.
- Total started, success, error, and timeout counts.
- Recent completed run entries with slot id, sequence, status, duration, exit code, and log path.

`maxLogs` should continue pruning old top-level log directories. It should count session directories after this change.

## Web UI

Remove the "循环间隔" field from run configuration.

Update the run view:

- Show scheduler status as `运行中`, `停止中`, `已停止`, or `错误`.
- Show fixed slot rows instead of batch worker rows.
- Slot labels should be concise, for example `Slot 1`.
- Each slot row should show the current run status, duration, last message, and output panel.
- Show compact totals for started, success, error, and timeout.
- Keep copy terse and operational; do not add explanatory paragraphs.

Use the existing UI style and components. Do not add custom colors, gradients, nested cards, or inline styles.

## API Behavior

Keep the existing endpoint shape where possible:

- `POST /api/start`: save config and start the continuous scheduler.
- `POST /api/stop-after-current`: set drain mode. The endpoint name can remain for compatibility, but frontend text should use the new stop label.
- `GET /api/status`: return the new scheduler snapshot.
- `GET /events`: stream snapshot and output events.
- `GET /api/workers/output`: return output keyed consistently with the chosen output identity.

Existing clients should fail clearly if they expect `currentBatch`; the Web app should be updated in the same change.

## Implementation Shape

Keep the change local to `auto`.

Expected files:

- `auto/src/config.ts`: remove interval from current config shape while tolerating old saved values.
- `auto/src/scheduler.ts`: replace batch loop with continuous slot orchestration.
- `auto/src/runner.ts`: keep `runWorker`; add small helpers only if needed for session logging or one-shot compatibility.
- `auto/src/logger.ts`: add session-based log naming and summary updates.
- `auto/src/server.ts`: adapt snapshot/output buffering and preserve the stop endpoint.
- `auto/web/src/types.ts`: replace batch snapshot types with session and slot types.
- `auto/web/src/components/config-form.tsx`: remove interval control.
- `auto/web/src/views/run-view.tsx` and worker components: render slots and totals.
- Tests for scheduler, config compatibility, runner one-shot behavior, and output buffering.

Avoid unrelated refactors.

## Error Handling

A worker failure should not stop the scheduler. The slot records the failed run, increments totals, and immediately starts another run unless draining is enabled.

Scheduler-level `error` is reserved for orchestration failures that prevent the pool from continuing, such as logger initialization failure or an unexpected exception outside an individual worker result.

If a worker command cannot be spawned, that should be treated as a worker `error` result. The pool may continue trying because the user can stop it from the UI.

## Testing

Add or update focused tests:

- Starting with concurrency 4 starts 4 active slots.
- When one slot finishes, a new run starts for that slot without waiting for other slots.
- Stop enters `draining`, does not start replacement runs, and becomes `stopped` after all active slots finish.
- Worker failures increment totals and do not stop other slots.
- Old configs with `intervalSeconds` still load.
- Saved configs no longer write `intervalSeconds`.
- `pnpm once` still runs exactly one set of `concurrency` workers.

Validation commands:

```bash
pnpm --dir auto test
pnpm --dir auto typecheck
```

Do not start the Synapse Electron development server for this work.
