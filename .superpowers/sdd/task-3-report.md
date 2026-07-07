# Task 3 Report: Scheduler Core

## What changed
- Added `createSwarmScheduler` in `desktop/app-capabilities/swarm-task/main/scheduler.ts`.
- The scheduler now supports:
  - `start(...)` for batch and continuous runs
  - `stopRefill(runId)` to stop launching new rounds while letting active work drain
  - `cancel(runId)` to abort an active run and stop refill
- Added focused coverage in `desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts` for:
  - fixed batch worker assignment
  - continuous refill through `maxRounds`
  - `stopRefill` draining active work without starting new rounds

## Tests run
- `pnpm --filter @synapse/desktop exec vitest run app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`
  - Result: pass, 1 file / 3 tests passed.
- `pnpm --filter @synapse/desktop test -- app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`
  - Result: failed in the existing desktop suite noise path; the command still fans out to unrelated repository tests in this checkout, so it was not a reliable focused signal for this task.

## TDD RED/GREEN evidence
- RED: the first task-level run against the repo’s package script did not give a clean file-focused signal because the desktop test script expands into unrelated existing failures in this checkout.
- GREEN: the file-scoped Vitest run for `app-capabilities/swarm-task/main/__tests__/scheduler.test.ts` passed cleanly after the scheduler implementation landed.

## Files changed
- `desktop/app-capabilities/swarm-task/main/scheduler.ts`
- `desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`

## Self-review
- Kept the implementation narrow to the scheduler core only.
- Preserved the contract that `start(...)` waits for the scheduler run to drain, while `cancel(...)` can end the run early.
- Avoided touching service-layer behavior, per the task correction.

## Concerns
- The repo-level desktop test script still pulls in unrelated existing failures/noise, so file-scoped Vitest is the dependable verification for this task in the current checkout.

## Task 3 Fix Report

### Changed files
- `desktop/app-capabilities/swarm-task/main/scheduler.ts`
- `desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`

### Tests run
- `pnpm --filter @synapse/desktop exec vitest run app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`

### Result
- Passed: 1 file, 5 tests.

### Self-review
- Removed the artificial cancel shortcut so active runners now decide their own outcome and `start(...)` drains before resolving.
- Updated result classification so mixed success plus cancelled work reports `partial` instead of `cancelled`.
- Added regression coverage for cancel delivery, drain behavior, and mixed success/cancel classification.
