# Task 6 Report

## Changed files

- `desktop/app-capabilities/swarm-task/main/ipc.ts`
- `desktop/app-capabilities/swarm-task/main/__tests__/ipc.test.ts`
- `desktop/electron/bootstrap/descriptors.ts`
- `desktop/electron/bootstrap/registry.ts`
- `desktop/electron/bootstrap/ipc-registry.ts`
- `desktop/electron/preload.ts`
- `desktop/electron/__tests__/preload.test.ts`
- `desktop/electron/bootstrap/__tests__/registry.test.ts`
- `desktop/electron/bootstrap/__tests__/descriptors.test.ts`
- `desktop/src/types/bridge.ts`
- `desktop/scripts/build/generate-ipc.mjs`
- `desktop/electron/generated/ipc-channels.generated.ts`

## What changed

- Added `swarmTaskIpcModule` with the Task 6 bridge surface only: `listTasks`, `createTask`, `updateTask`, `deleteTask`, `startRun`, `stopRefill`, `cancelRun`, `listRuns`, `getRun`, `listWorkerRuns`.
- Registered `core.swarm-task` in bootstrap using existing `createSwarmTaskService`, existing swarm DataRepository namespaces, `app.getPath("userData")/swarm-runs`, and the Task 5 production gateway via `createAgentRuntimeSwarmGateway`.
- Wired agent resolution through the current `resolveProjectAgent(ctx.registry.get.bind(ctx.registry), projectId)` helper.
- Registered the IPC module in `electron/bootstrap/ipc-registry.ts`.
- Added preload bridge methods and `SynapseBridge` typings for the new `swarmTask` domain.
- Added focused tests for IPC, preload mapping, registry membership/order, and descriptor metadata.
- Updated IPC codegen source list and regenerated `desktop/electron/generated/ipc-channels.generated.ts`.

## Tests run

### Red

Command:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/swarm-task/main/__tests__/ipc.test.ts electron/__tests__/preload.test.ts electron/bootstrap/__tests__/registry.test.ts electron/bootstrap/__tests__/descriptors.test.ts
```

Result:

- Failed as expected before implementation.
- `app-capabilities/swarm-task/main/__tests__/ipc.test.ts`: could not import `../ipc`.
- `electron/__tests__/preload.test.ts`: `bridge.swarmTask` was undefined.
- `electron/bootstrap/__tests__/registry.test.ts`: `core.swarm-task` missing from registry and start order.
- `electron/bootstrap/__tests__/descriptors.test.ts`: `coreSwarmTaskDescriptor` missing.

### Green

Command:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/swarm-task/main/__tests__/ipc.test.ts electron/__tests__/preload.test.ts electron/bootstrap/__tests__/registry.test.ts electron/bootstrap/__tests__/descriptors.test.ts
```

Result:

- Exit code `0`
- `4` test files passed
- `84` tests passed

## TDD evidence

- Wrote failing tests first for the new IPC module and for the bootstrap/preload wiring expectations.
- Ran the focused Vitest command before implementation and confirmed missing module / missing bridge / missing registration failures.
- Implemented the minimal registration, IPC, preload, and codegen changes needed to satisfy those failures.
- Re-ran the same focused Vitest command and confirmed all targeted tests passed.

## Self-review

- Scope stayed inside Task 6: no renderer app, no MCP dispatcher, no terminal worker behavior.
- Reused existing swarm-task service, shared schemas, shared constants, and the existing `resolveProjectAgent` helper.
- Used current DataRepository namespace exports (`SWARM_TASKS_NAMESPACE`, `SWARM_TASK_RUNS_NAMESPACE`, `SWARM_TASK_WORKER_RUNS_NAMESPACE`) instead of inventing new names.
- Kept changes surgical and left unrelated dirty automation / release-notes files untouched.

## Concerns

- No additional concerns at hand.
