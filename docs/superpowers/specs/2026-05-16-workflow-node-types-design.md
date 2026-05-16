# Workflow Node Types — Phase 1 Design

## Goal

Extend the Synapse workflow engine with two new node types — **HTTP Request** and **Script** — that reuse the existing action-packages execution primitives, config schemas, and config form components from the task scheduler.

## Architecture

### Runtime Deps Injection

Today `NodeExecutionInput` only has `agentDeps: AgentSendDeps` for calling LLM agents. HTTP Request and Script nodes need additional capabilities:

- `sendHttpRequest` — wraps `sendOutboundHttpRequest` from `electron/runtime/network`
- `processRunner` — wraps `ControlledProcessRunner.run` from `electron/runtime/process`

Introduce a `NodeRuntimeDeps` interface in `workflow-nodes/types.ts` that bundles these. Add an optional `runtimeDeps` field to `NodeExecutionInput`.

`WorkflowEngine` constructor accepts `runtimeDeps?: NodeRuntimeDeps` alongside `agentDeps`. The engine passes `runtimeDeps` through to every node executor via `NodeExecutionInput`.

The bootstrap layer (`coreWorkflowEngineDescriptor`) constructs a `ControlledProcessRunner` and imports `sendOutboundHttpRequest`, bundling them into `runtimeDeps` when creating the engine.

### Reuse Strategy

Each new workflow node reuses its action-package counterpart:

| Concern | HTTP Request node | Script node |
|---|---|---|
| Config schema | `httpRequestActionConfigSchema` | `scriptActionConfigSchema` |
| Config form | `HttpRequestConfigForm` | `ScriptConfigForm` |
| Execution | Calls `sendOutboundHttpRequest` directly | Calls `runShellAction` directly |

The workflow node executors are thin wrappers that:
1. Map `NodeExecutionInput` fields to the action primitive's parameters
2. Map the action result back to `NodeExecutionResult`

### Config Form `idPrefix`

The shared config forms hardcode `id` attributes like `task-action-http-method-GET`. When used inside the workflow editor, these may collide with other instances. Add an `idPrefix?: string` prop to both `HttpRequestConfigForm` and `ScriptConfigForm`. When provided, all `id` and `htmlFor` attributes are prefixed.

### Node Structure

Each node follows the established pattern (`prompt/`, `switch/`, `end/`):

```
workflow-nodes/http-request/
  schema.ts          — re-exports httpRequestActionConfigSchema + adds variables
  manifest.ts        — NodeManifest with Globe icon
  executor.main.ts   — thin wrapper calling sendHttpRequest from runtimeDeps
  card.tsx            — compact card for editor canvas
  panel.tsx           — config panel using HttpRequestConfigForm
  index.ts            — barrel exports
workflow-nodes/script/
  schema.ts          — re-exports scriptActionConfigSchema + adds variables
  manifest.ts        — NodeManifest with Terminal icon
  executor.main.ts   — thin wrapper calling runShellAction via processRunner from runtimeDeps
  card.tsx            — compact card for editor canvas
  panel.tsx           — config panel using ScriptConfigForm
  index.ts            — barrel exports
```

### Registration

- `register.main.ts` — add `httpRequestNodeManifest + httpRequestNodeExecutor`, `scriptNodeManifest + scriptNodeExecutor`
- `register.renderer.ts` — add manifest-only registration
- `panel-registry.ts` — add panel components

### Editor Integration

- `node-wrappers.tsx` — add `HttpRequestNodeWrapper`, `ScriptNodeWrapper`
- `runner-node-wrappers.tsx` — add runner variants
- Both files export updated `nodeTypes` / `runnerNodeTypes` maps

## Non-Goals (Phase 2+)

- Variable interpolation in URL/body/script (future)
- Streaming output display
- Node-level timeout UI
