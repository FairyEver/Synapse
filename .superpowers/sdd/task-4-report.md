# Task 4 Report

## Changed files

- `desktop/app-capabilities/swarm-task/main/service.ts`
- `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`

## What changed

- Added `createSwarmTaskService(deps)` with the required task, run, and worker APIs:
  - `listTasks`
  - `createTask`
  - `updateTask`
  - `deleteTask`
  - `startRun`
  - `stopRefill`
  - `cancelRun`
  - `listRuns`
  - `getRun`
  - `listWorkerRuns`
- Wired the service to the existing shared schemas, `prompt-builder`, and `scheduler`.
- Implemented background run scheduling so `startRun` persists and returns the new `running` run immediately without waiting for worker completion.
- Implemented worker record persistence with:
  - `platform: "swarm"` compatible storage contract via `sessionKey: "swarm:<taskId>:<runId>"`
  - structured summary extraction through `extractSwarmStructuredOutput`
  - fallback summaries through `fallbackSummary`
  - previous handoff propagation through the existing prompt builder contract
- Added focused tests covering:
  - reusable task creation/listing
  - config snapshotting at run start
  - background completion and worker summary persistence
  - fallback summary behavior when the structured summary block is absent

## Tests run

1. `pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`
   - Result: noisy/unfocused in this repo shape; the command fanned out into unrelated desktop test execution and was interrupted after showing unrelated failures/warnings outside this task path. Not used as the acceptance signal.

2. `pnpm --filter @synapse/desktop exec vitest run app-capabilities/swarm-task/main/__tests__/service.test.ts`
   - Result: PASS
   - Output summary:
     - `Test Files  1 passed (1)`
     - `Tests  4 passed (4)`

## TDD evidence

- Wrote `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts` before creating `desktop/app-capabilities/swarm-task/main/service.ts`.
- Ran the brief-specified package test command during the red phase and confirmed it was not a useful focused signal because it fanned out into unrelated suite noise.
- Implemented the minimal service needed to satisfy the new tests.
- Re-ran the focused Vitest command and confirmed the new service tests passed.

## Self-review

- Kept the change surgical to the two requested source files plus this report.
- Reused only the existing shared schemas, scheduler, and prompt-builder contracts.
- Did not introduce CLI workers, shell runners, prompt task classification, or extra data shapes.
- Ensured worker records persist the required `sessionKey` format and that summaries use the existing structured-output/fallback path instead of passing full prior outputs forward.

## Concerns

- `cancelRun` only asks the gateway to cancel workers that are still stored with `status: "running"` and already have a `conversationId`; if cancellation needs to reach conversations created after a persistence race, that would need an additional targeted test and refinement.

## Task 4 Fix Report

### Changed files

- `desktop/app-capabilities/swarm-task/main/service.ts`
- `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`
- `.superpowers/sdd/task-4-report.md`

### Tests run

1. `pnpm --filter @synapse/desktop exec vitest run app-capabilities/swarm-task/main/__tests__/service.test.ts`
   - Result: PASS
   - Output summary:
     - `Test Files  1 passed (1)`
     - `Tests  6 passed (6)`

### Result

- `createWorkerRunner` now persists a terminal worker row when `deps.agent.sendWorker()` rejects after the worker was initially stored.
- Abort-driven failures now persist worker `status: "cancelled"` and flow that same terminal outcome back through the scheduler path.
- Ordinary gateway rejections now persist worker `status: "failed"` with `error` and `lastMessage`, and the run finishes as failed.
- `cancelRun()` now also persists the parent task `lastRunId` and `lastStatus: "cancelled"` instead of leaving the task stuck on the previous status.

### Self-review

- Kept `startRun()` asynchronous behavior unchanged: it still returns the newly created `running` run immediately after background scheduling starts.
- Added focused regression tests for gateway abort, gateway rejection, and task status update on `cancelRun()`.
- Kept the fix contained to the service/test pair plus this report append.

### Concerns

- No additional concerns beyond the pre-existing note above.

## Task 4 Fix Report 2

### Changed files

- `desktop/app-capabilities/swarm-task/main/service.ts`
- `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`
- `.superpowers/sdd/task-4-report.md`

### Tests run

1. `pnpm --filter @synapse/desktop exec vitest run app-capabilities/swarm-task/main/__tests__/service.test.ts`
   - Result: PASS
   - Output summary:
     - `Test Files  1 passed (1)`
     - `Tests  8 passed (8)`

### Result

- Added `onConversationId` to the swarm agent gateway input so worker conversations can be published before `sendWorker()` resolves.
- `createWorkerRunner()` now persists the live `conversationId` onto the running worker row immediately, which lets `cancelRun()` call `cancelConversation(projectId, conversationId)` for in-flight workers.
- Worker terminal persistence now merges against the latest stored worker row, so an early published `conversationId` survives later cancellation and failure writes.
- `cancelRun()` now returns already terminal runs unchanged instead of rewriting `success`, `partial`, `failed`, or `cancelled` runs to `cancelled`, which also preserves the parent task's last status history.

### Self-review

- Kept the change confined to the requested service/test files plus the report append.
- Preserved the existing `startRun()` behavior of returning the new `running` run immediately after background scheduling begins.
- Preserved the prior gateway-rejection persistence behavior while tightening the live cancellation path around conversation ids.

### Concerns

- No additional concerns.

## Task 4 Fix Report 3

### Changed files

- `desktop/app-capabilities/swarm-task/main/service.ts`
- `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`
- `.superpowers/sdd/task-4-report.md`

### Tests run

1. `pnpm --filter @synapse/desktop exec vitest run app-capabilities/swarm-task/main/__tests__/service.test.ts`
   - Result: PASS
   - Output summary:
     - `Test Files  1 passed (1)`
     - `Tests  10 passed (10)`

### Result

- `startRun()` now builds `configSnapshot` by deep-merging nested override objects onto the task's existing config before validating the final snapshot, so partial overrides keep prior nested values instead of reverting them to schema defaults.
- Added a regression test proving nested overrides for `summary`, `handoff`, and `injectOptions` preserve the task's existing non-default nested values while still producing a full valid snapshot.
- `stopRefill()` now returns terminal runs unchanged instead of rewriting `success`, `partial`, `failed`, or `cancelled` runs to `draining`.
- Added a focused test covering the new terminal-state `stopRefill()` guard.

### Self-review

- Kept the fix scoped to the owned service/test files plus this report append.
- Preserved the existing `startRun()` behavior of returning the new `running` run immediately after background scheduling begins.
- Left the live conversation id callback path and prior terminal worker persistence behavior intact.

### Concerns

- No additional concerns.

## Task 4 Fix Report 4

### Changed files

- `desktop/app-capabilities/swarm-task/main/service.ts`
- `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`
- `.superpowers/sdd/task-4-report.md`

### Tests run

1. `pnpm --filter @synapse/desktop exec vitest run app-capabilities/swarm-task/main/__tests__/service.test.ts`
   - Result: PASS
   - Output summary:
     - `Test Files  1 passed (1)`
     - `Tests  11 passed (11)`

### Result

- `cancelRun()` now snapshots unique `conversationId`s from running workers before aborting the scheduler, then calls `cancelConversation(projectId, conversationId)` from that snapshot after abort so fast worker cancellation no longer drops the gateway cancellation.
- Added a regression test that forces the fast-cancel race by delaying the service's running-worker read long enough for the worker to persist `status: "cancelled"` immediately after abort; the service still cancels the published conversation.
- `stopRefill()` now reads the run first and returns terminal runs unchanged without touching the scheduler.

### Self-review

- Kept `startRun()` returning the newly created `running` run immediately after scheduling background work.
- Left the nested config snapshot merge, live `onConversationId` persistence, and terminal worker persistence paths intact.
- Kept the change scoped to the owned service/test files plus this report append.

### Concerns

- No additional concerns.
