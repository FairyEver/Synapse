# Workflow Node Types — Phase 1 Implementation Plan

Design: `docs/superpowers/specs/2026-05-16-workflow-node-types-design.md`

## Task 1: Infrastructure — runtimeDeps injection

### Steps

- [x] 1.1 In `workflow-nodes/types.ts`: add `NodeRuntimeDeps` interface with `processRunner` and `sendHttpRequest`. Add optional `runtimeDeps?: NodeRuntimeDeps` field to `NodeExecutionInput`.
- [x] 1.2 In `electron/services/workflow/workflow-engine.ts`: accept `runtimeDeps?: NodeRuntimeDeps` in constructor. Pass it to every `executor.execute()` call.
- [x] 1.3 In `electron/bootstrap/descriptors.ts`: in `coreWorkflowEngineDescriptor.create()`, construct processRunner + import sendOutboundHttpRequest, pass as `runtimeDeps` to `new WorkflowEngine(...)`.
- [x] 1.4 Update existing `WorkflowEngine` test: verify constructor still works with just `agentDeps` (backward-compat).

### Verify

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm vitest run electron/services/__tests__/workflow-engine.test.ts
```

## Task 2: Config form idPrefix

### Steps

- [x] 2.1 In `action-packages/builtin/http-request/config.renderer.tsx`: add `idPrefix?: string` prop. Prefix all `id` and `htmlFor` attributes with `${idPrefix}` when provided.
- [x] 2.2 In `action-packages/builtin/script/config.renderer.tsx`: add `idPrefix?: string` prop. Prefix all `id` and `htmlFor` attributes with `${idPrefix}` when provided.

### Verify

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm tsc --noEmit --project tsconfig.json 2>&1 | head -50
```

## Task 3: HTTP Request node

### Steps

- [x] 3.1 Create `workflow-nodes/http-request/schema.ts` — workflow node config schema wrapping httpRequestActionConfigSchema + variables binding.
- [x] 3.2 Create `workflow-nodes/http-request/manifest.ts` — NodeManifest with Globe icon, type "http_request".
- [x] 3.3 Create `workflow-nodes/http-request/executor.main.ts` — thin executor wrapper that calls `input.runtimeDeps.sendHttpRequest`.
- [x] 3.4 Create `workflow-nodes/http-request/card.tsx` — compact card component.
- [x] 3.5 Create `workflow-nodes/http-request/panel.tsx` — config panel using HttpRequestConfigForm.
- [x] 3.6 Create `workflow-nodes/http-request/index.ts` — barrel exports.
- [x] 3.7 Create `workflow-nodes/http-request/__tests__/executor.test.ts` — unit test for executor.

### Verify

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm vitest run workflow-nodes/http-request/__tests__/executor.test.ts
```

## Task 4: Script node

### Steps

- [x] 4.1 Create `workflow-nodes/script/schema.ts` — workflow node config schema wrapping scriptActionConfigSchema + variables binding.
- [x] 4.2 Create `workflow-nodes/script/manifest.ts` — NodeManifest with Terminal icon, type "script".
- [x] 4.3 Create `workflow-nodes/script/executor.main.ts` — thin executor wrapper that calls runShellAction via processRunner from runtimeDeps.
- [x] 4.4 Create `workflow-nodes/script/card.tsx` — compact card component.
- [x] 4.5 Create `workflow-nodes/script/panel.tsx` — config panel using ScriptConfigForm.
- [x] 4.6 Create `workflow-nodes/script/index.ts` — barrel exports.
- [x] 4.7 Create `workflow-nodes/script/__tests__/executor.test.ts` — unit test for executor.

### Verify

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm vitest run workflow-nodes/script/__tests__/executor.test.ts
```

## Task 5: Registration + Editor integration

### Steps

- [x] 5.1 Update `workflow-nodes/register.main.ts` — register HTTP Request + Script manifest+executor.
- [x] 5.2 Update `workflow-nodes/register.renderer.ts` — register HTTP Request + Script manifest.
- [x] 5.3 Update `workflow-nodes/panel-registry.ts` — register HTTP Request + Script panels.
- [x] 5.4 Update `src/modules/workflow/editor/node-wrappers.tsx` — add HttpRequestNodeWrapper, ScriptNodeWrapper, update nodeTypes map.
- [x] 5.5 Update `src/modules/workflow/runner/runner-node-wrappers.tsx` — add runner variants, update runnerNodeTypes map.

### Verify

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm vitest run workflow-nodes/ electron/services/__tests__/workflow-engine.test.ts
```
