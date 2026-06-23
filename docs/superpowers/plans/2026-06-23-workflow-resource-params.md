# Workflow Resource Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class workflow `file` and `directory` parameters that work through the desktop UI, MCP/API execution, and nested workflow calls.

**Architecture:** Introduce shared resource-reference types, then centralize run-parameter normalization in one Electron service used by all workflow run entry points. Renderer controls and MCP docs consume the same parameter contract; existing string interpolation keeps receiving resolved local paths for compatibility.

**Tech Stack:** Electron 41, React 19, TypeScript 6, Vitest, shadcn/ui, Tailwind CSS 4, Zod.

---

## File Structure

- Modify `desktop/src/types/workflow.ts`: define workflow param type union, resource reference types, normalized run param types, and workflow-call typed bindings.
- Create `desktop/electron/services/workflow/workflow-param-normalizer.ts`: normalize defaults, shorthand strings, resource envelopes, local path stat checks, string interpolation view, and snapshot-safe values.
- Create `desktop/electron/services/__tests__/workflow-param-normalizer.test.ts`: focused TDD coverage for resource params.
- Modify `desktop/electron/services/workflow/workflow-validator.ts`: validate param definition defaults and delegate run-param validation/effective params to the normalizer.
- Modify `desktop/electron/services/__tests__/workflow-validator.test.ts`: cover file/directory definition validation and run-param compatibility.
- Modify `desktop/electron/services/workflow/variable-resolver.ts`: resolve resource params to their string value for templates.
- Modify `desktop/electron/services/__tests__/workflow-variable-resolver.test.ts`: cover resource interpolation.
- Modify `desktop/electron/runtime/data-repo/schemas/placeholders.ts`: accept and normalize `file` and `directory` params in persisted workflow records.
- Modify `desktop/electron/modules/workflow/ipc.ts` and `desktop/electron/modules/workflow/__tests__/ipc.test.ts`: add workflow file/directory picker IPC and ensure run entry points receive normalized params.
- Modify `desktop/electron/bootstrap/descriptors.ts` and `desktop/electron/bootstrap/__tests__/descriptors.test.ts`: use normalized params in capability, automation, and workflow-call execution paths.
- Modify `desktop/electron/capabilities/workflow-dispatcher.ts` and `desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts`: document and test MCP shorthand/full-form params flowing through `workflow.run.execute`.
- Modify `desktop/workflow-nodes/workflow-call/schema.ts`, `params.ts`, `executor.main.ts`, `manifest.ts`, `panel.tsx`, `card.tsx`, and tests under `desktop/workflow-nodes/workflow-call/__tests__/`: add typed `paramBindings` while preserving `paramTemplates`.
- Modify `desktop/src/modules/workflow/components/params-editor-dialog.tsx` and tests: add file/directory parameter type editing.
- Modify `desktop/src/modules/workflow/components/run-params-dialog.tsx` and tests: add file/directory runtime controls using native pickers.
- Modify `desktop/src/types/bridge.ts`: expose the generated workflow picker bridge types after IPC generation or manual type alignment if this project keeps bridge types checked in.
- Modify `desktop/resources/templates/skills/synapse-skill/files/workflow/index.md` and `api-reference.md`: update built-in skill guidance.
- Modify `RELEASE_NOTES_PENDING.md`: add user-facing release note for workflow file/folder params.

## Task 1: Shared Parameter Types

**Files:**
- Modify: `desktop/src/types/workflow.ts`
- Test: `desktop/electron/services/__tests__/workflow-validator.test.ts`

- [ ] **Step 1: Write failing type-oriented validator tests**

Add cases near the existing `validateRunParams` and `buildEffectiveRunParams` tests:

```ts
it("accepts file and directory parameter definitions", () => {
  const def: WorkflowDefinition = {
    ...base,
    params: [
      { name: "source_file", type: "file", default: null },
      { name: "workspace_dir", type: "directory", default: null },
    ],
  }

  expect(validateWorkflow(def).errors.filter((error) => error.message.includes("参数"))).toEqual([])
})

it("rejects resource parameter defaults with the wrong entry type", () => {
  const def: WorkflowDefinition = {
    ...base,
    params: [
      {
        name: "source_file",
        type: "file",
        default: { kind: "local_path", entryType: "directory", path: "/tmp" },
      },
    ],
  }

  expect(validateWorkflow(def).errors[0]).toMatchObject({
    type: "invalid_config",
    message: "参数「source_file」的默认值必须是文件引用",
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/workflow-validator.test.ts
```

Expected: FAIL because `WorkflowParam["type"]` does not include `file` or `directory`.

- [ ] **Step 3: Add shared workflow param/resource types**

In `desktop/src/types/workflow.ts`, replace the current `WorkflowParam` with:

```ts
export type WorkflowParamType = "text" | "number" | "file" | "directory"

export type WorkflowResourceEntryType = "file" | "directory"

export type WorkflowLocalPathResourceRef = {
  readonly kind: "local_path"
  readonly entryType: WorkflowResourceEntryType
  readonly path: string
}

export type WorkflowDriveResourceRef = {
  readonly kind: "drive"
  readonly entryType: WorkflowResourceEntryType
  readonly id: string
  readonly versionId?: string
}

export type WorkflowStagedResourceRef = {
  readonly kind: "staged"
  readonly entryType: WorkflowResourceEntryType
  readonly id: string
}

export type WorkflowInlineFileResourceRef = {
  readonly kind: "inline_file"
  readonly entryType: "file"
  readonly name: string
  readonly mimeType?: string
  readonly base64: string
}

export type WorkflowResourceRef =
  | WorkflowLocalPathResourceRef
  | WorkflowDriveResourceRef
  | WorkflowStagedResourceRef
  | WorkflowInlineFileResourceRef

export type WorkflowParamDefault = string | number | WorkflowResourceRef | null

export interface WorkflowParam {
  name: string
  type: WorkflowParamType
  default: WorkflowParamDefault
  description?: string
}

export type WorkflowParamBinding =
  | { readonly mode: "template"; readonly template: string }
  | { readonly mode: "value"; readonly source: WorkflowVariableSource }
```

- [ ] **Step 4: Run typecheck for the expected validator failures**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: FAIL in validator and persisted schema code that still assumes only `text | number`.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/types/workflow.ts desktop/electron/services/__tests__/workflow-validator.test.ts
git commit -m "feat(workflow): add resource parameter types"
```

## Task 2: Persisted Workflow Schema and Definition Validation

**Files:**
- Modify: `desktop/electron/runtime/data-repo/schemas/placeholders.ts`
- Modify: `desktop/electron/services/workflow/workflow-validator.ts`
- Test: `desktop/electron/services/__tests__/workflow-validator.test.ts`

- [ ] **Step 1: Add persisted schema tests for resource params**

In `desktop/electron/runtime/data-repo/schemas/placeholders.ts` tests if a dedicated schema test exists, add resource param cases there. If there is no dedicated workflow schema test, keep coverage in `workflow-validator.test.ts` by adding:

```ts
it("validates local path resource defaults by parameter type", () => {
  const resourceDefault = { kind: "local_path" as const, entryType: "file" as const, path: "/tmp/input.txt" }
  const def: WorkflowDefinition = { ...base, params: [{ name: "input", type: "file", default: resourceDefault }] }

  expect(validateWorkflow(def).errors).toEqual([])
})
```

- [ ] **Step 2: Run validator tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/workflow-validator.test.ts
```

Expected: FAIL because `validateWorkflow` does not validate resource defaults yet.

- [ ] **Step 3: Update persisted workflow param guards**

In `desktop/electron/runtime/data-repo/schemas/placeholders.ts`, change the workflow param type definition to accept `file` and `directory`:

```ts
type WorkflowParamRecord = {
  name: string
  type: "text" | "number" | "file" | "directory"
  default: string | number | WorkflowResourceRef | null
  description?: string
}
```

Add a local guard:

```ts
function isWorkflowResourceRef(value: unknown): value is WorkflowResourceRef {
  if (!isAnyRecord<Record<string, unknown>>(value)) return false
  if (value.kind === "local_path") {
    return (value.entryType === "file" || value.entryType === "directory")
      && typeof value.path === "string"
  }
  if (value.kind === "drive") {
    return (value.entryType === "file" || value.entryType === "directory")
      && typeof value.id === "string"
      && isOptionalString(value.versionId)
  }
  if (value.kind === "staged") {
    return (value.entryType === "file" || value.entryType === "directory")
      && typeof value.id === "string"
  }
  if (value.kind === "inline_file") {
    return value.entryType === "file"
      && typeof value.name === "string"
      && typeof value.base64 === "string"
      && isOptionalString(value.mimeType)
  }
  return false
}
```

Update `isWorkflowParam` and `normalizeWorkflowParam` so resource defaults are preserved only when `isWorkflowResourceRef(rawDefault)` is true.

- [ ] **Step 4: Update definition validation**

In `desktop/electron/services/workflow/workflow-validator.ts`, add helpers:

```ts
function isResourceParamType(type: WorkflowParam["type"]): type is "file" | "directory" {
  return type === "file" || type === "directory"
}

function isWorkflowResourceRef(value: unknown): value is WorkflowResourceRef {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).kind === "string"
}

function validateParamDefault(param: WorkflowParam, errors: ValidationError[]): void {
  if (param.type === "number" && param.default !== null) {
    if (typeof param.default !== "number" || !Number.isFinite(param.default)) {
      errors.push({ type: "invalid_config", message: `参数「${param.name.trim()}」是数字类型，默认值必须是有效数字` })
    }
  }
  if (param.type === "text" && param.default !== null && typeof param.default !== "string") {
    errors.push({ type: "invalid_config", message: `参数「${param.name.trim()}」的默认值必须是文本` })
  }
  if (isResourceParamType(param.type) && param.default !== null) {
    if (!isWorkflowResourceRef(param.default) || param.default.entryType !== param.type) {
      errors.push({ type: "invalid_config", message: `参数「${param.name.trim()}」的默认值必须是${param.type === "file" ? "文件" : "文件夹"}引用` })
    }
  }
}
```

Call `validateParamDefault(p, errors)` inside the existing param loop.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/workflow-validator.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: validator tests PASS; typecheck may still fail where run params and workflow-call are not updated.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/runtime/data-repo/schemas/placeholders.ts desktop/electron/services/workflow/workflow-validator.ts desktop/electron/services/__tests__/workflow-validator.test.ts
git commit -m "feat(workflow): validate resource parameter definitions"
```

## Task 3: Run Parameter Normalizer

**Files:**
- Create: `desktop/electron/services/workflow/workflow-param-normalizer.ts`
- Create: `desktop/electron/services/__tests__/workflow-param-normalizer.test.ts`
- Modify: `desktop/electron/services/workflow/workflow-validator.ts`

- [ ] **Step 1: Write failing normalizer tests**

Create `desktop/electron/services/__tests__/workflow-param-normalizer.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import { normalizeWorkflowRunParams } from "../workflow/workflow-param-normalizer"

function def(params: WorkflowDefinition["params"]): WorkflowDefinition {
  return {
    id: "wf",
    name: "Workflow",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params,
    nodes: [{ id: "end", name: "结束", type: "end", position: { x: 0, y: 0 }, config: { outputType: "text", template: "", variables: [] } }],
    edges: [],
  }
}

describe("normalizeWorkflowRunParams", () => {
  it("normalizes file and directory shorthand strings to local path refs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-workflow-params-"))
    const filePath = path.join(root, "input.txt")
    const dirPath = path.join(root, "workspace")
    await writeFile(filePath, "hello")
    await mkdir(dirPath)

    const result = await normalizeWorkflowRunParams(def([
      { name: "input_file", type: "file", default: null },
      { name: "workspace_dir", type: "directory", default: null },
    ]), {
      input_file: filePath,
      workspace_dir: dirPath,
    })

    expect(result.params.input_file).toEqual({ kind: "local_path", entryType: "file", path: filePath })
    expect(result.params.workspace_dir).toEqual({ kind: "local_path", entryType: "directory", path: dirPath })
    expect(result.stringValues).toEqual({ input_file: filePath, workspace_dir: dirPath })
  })

  it("rejects a directory passed to a file parameter", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-workflow-params-"))
    const result = await normalizeWorkflowRunParams(def([{ name: "input", type: "file", default: null }]), { input: root })

    expect(result.errors[0]).toMatchObject({ type: "invalid_config", message: "参数「input」必须是文件" })
  })

  it("returns unsupported errors for unresolved remote resource refs", async () => {
    const result = await normalizeWorkflowRunParams(def([{ name: "input", type: "file", default: null }]), {
      input: { kind: "drive", entryType: "file", id: "drive-file-1" },
    })

    expect(result.errors[0]).toMatchObject({ type: "invalid_config", message: "参数「input」暂不支持 drive 文件引用" })
  })
})
```

- [ ] **Step 2: Run the new tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/workflow-param-normalizer.test.ts
```

Expected: FAIL because `workflow-param-normalizer.ts` does not exist.

- [ ] **Step 3: Implement the normalizer**

Create `desktop/electron/services/workflow/workflow-param-normalizer.ts` with:

```ts
import { lstat } from "node:fs/promises"
import path from "node:path"
import type { ValidationError, WorkflowDefinition, WorkflowParam, WorkflowResourceRef } from "../../../src/types/workflow"

export interface NormalizedWorkflowRunParams {
  readonly params: Record<string, unknown>
  readonly stringValues: Record<string, string>
  readonly snapshotParams: Record<string, unknown>
  readonly errors: ValidationError[]
}

export async function normalizeWorkflowRunParams(
  def: Pick<WorkflowDefinition, "params">,
  rawParams: Record<string, unknown>,
): Promise<NormalizedWorkflowRunParams> {
  const params: Record<string, unknown> = {}
  const stringValues: Record<string, string> = {}
  const snapshotParams: Record<string, unknown> = {}
  const errors: ValidationError[] = []

  for (const param of def.params) {
    const raw = Object.prototype.hasOwnProperty.call(rawParams, param.name)
      ? rawParams[param.name]
      : param.default
    if (raw === undefined || raw === null) {
      errors.push({ type: "missing_param", message: `缺少必填参数「${param.name}」` })
      continue
    }
    const normalized = await normalizeOneParam(param, raw)
    if ("error" in normalized) {
      errors.push(normalized.error)
      continue
    }
    params[param.name] = normalized.value
    stringValues[param.name] = normalized.stringValue
    snapshotParams[param.name] = normalized.snapshotValue
  }

  return { params, stringValues, snapshotParams, errors }
}

async function normalizeOneParam(
  param: WorkflowParam,
  raw: unknown,
): Promise<
  | { value: unknown; stringValue: string; snapshotValue: unknown }
  | { error: ValidationError }
> {
  if (param.type === "text") {
    if (typeof raw !== "string") return error(param, "必须是文本")
    return { value: raw, stringValue: raw, snapshotValue: raw }
  }
  if (param.type === "number") {
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN
    if (!Number.isFinite(value)) return error(param, "必须是数字")
    return { value, stringValue: String(value), snapshotValue: value }
  }

  const ref = normalizeResourceInput(param, raw)
  if ("error" in ref) return ref
  if (ref.value.kind !== "local_path") {
    return error(param, `暂不支持 ${ref.value.kind} ${param.type === "file" ? "文件" : "文件夹"}引用`)
  }
  const statResult = await statLocalResource(param, ref.value.path)
  if ("error" in statResult) return statResult
  return { value: ref.value, stringValue: ref.value.path, snapshotValue: ref.value }
}

function normalizeResourceInput(
  param: WorkflowParam,
  raw: unknown,
): { value: WorkflowResourceRef } | { error: ValidationError } {
  if (typeof raw === "string") {
    if (!path.isAbsolute(raw.trim())) return error(param, "必须是绝对路径")
    return { value: { kind: "local_path", entryType: param.type, path: raw.trim() } }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return error(param, "必须是资源引用")
  const ref = raw as WorkflowResourceRef
  if (ref.entryType !== param.type) return error(param, `必须是${param.type === "file" ? "文件" : "文件夹"}`)
  return { value: ref }
}

async function statLocalResource(param: WorkflowParam, resourcePath: string): Promise<{} | { error: ValidationError }> {
  try {
    const stat = await lstat(resourcePath)
    if (param.type === "file" && !stat.isFile()) return error(param, "必须是文件")
    if (param.type === "directory" && !stat.isDirectory()) return error(param, "必须是文件夹")
    return {}
  } catch {
    return error(param, "路径不存在或不可访问")
  }
}

function error(param: WorkflowParam, message: string): { error: ValidationError } {
  return { error: { type: message.includes("缺少") ? "missing_param" : "invalid_config", message: `参数「${param.name}」${message}` } }
}
```

- [ ] **Step 4: Wire synchronous validator compatibility**

Keep `validateRunParams` and `buildEffectiveRunParams` exported from `workflow-validator.ts` for existing callers, but make their behavior resource-aware without async filesystem checks:

```ts
if ((param.type === "file" || param.type === "directory") && hasValue) {
  const isStringPath = typeof value === "string" && value.trim().length > 0
  const isEnvelope = Boolean(value) && typeof value === "object" && !Array.isArray(value)
  if (!isStringPath && !isEnvelope) {
    errors.push({ type: "invalid_config", message: `参数「${param.name}」必须是${param.type === "file" ? "文件" : "文件夹"}引用` })
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/workflow-param-normalizer.test.ts desktop/electron/services/__tests__/workflow-validator.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/workflow/workflow-param-normalizer.ts desktop/electron/services/__tests__/workflow-param-normalizer.test.ts desktop/electron/services/workflow/workflow-validator.ts desktop/electron/services/__tests__/workflow-validator.test.ts
git commit -m "feat(workflow): normalize resource run parameters"
```

## Task 4: Run Entry Points Use Normalized Params

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/modules/workflow/ipc.ts`
- Modify: `desktop/electron/capabilities/workflow-dispatcher.ts`
- Test: `desktop/electron/bootstrap/__tests__/descriptors.test.ts`
- Test: `desktop/electron/modules/workflow/__tests__/ipc.test.ts`
- Test: `desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts`

- [ ] **Step 1: Add failing entry-point tests**

In `desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts`, add:

```ts
it("workflow.run.execute forwards resource params to the run handler", async () => {
  const result = await dispatcher.dispatch("workflow.run.execute", {
    workflowId: "wf-1",
    params: {
      input_file: { kind: "local_path", entryType: "file", path: "/tmp/input.txt" },
    },
  }, { source: "api" })

  expect(result.ok).toBe(true)
  expect(deps.runWorkflow).toHaveBeenCalledWith("wf-1", {
    input_file: { kind: "local_path", entryType: "file", path: "/tmp/input.txt" },
  }, expect.any(Object))
})
```

In the IPC/bootstrap tests, add one case where the run status stores normalized `local_path` refs and not raw shorthand strings.

- [ ] **Step 2: Run entry-point tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts desktop/electron/modules/workflow/__tests__/ipc.test.ts desktop/electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: FAIL in IPC/bootstrap assertions because params are not normalized at run start.

- [ ] **Step 3: Normalize in `createRunWorkflowHandler`**

In `desktop/electron/bootstrap/descriptors.ts`, import `normalizeWorkflowRunParams` and replace:

```ts
const paramErrors = validateRunParams(def, params)
if (paramErrors.length > 0) return { errors: paramErrors }
```

and:

```ts
const effectiveParams = buildEffectiveRunParams(def, params)
```

with:

```ts
const normalizedParams = await normalizeWorkflowRunParams(def, params)
if (normalizedParams.errors.length > 0) return { errors: normalizedParams.errors }
const effectiveParams = normalizedParams.params
```

Use `effectiveParams` for `runStatuses`, `snapshotService.save`, and `workflowEngine.run`.

- [ ] **Step 4: Normalize in workflow IPC run methods**

In `desktop/electron/modules/workflow/ipc.ts`, update every run path currently using `validateRunParams` and `buildEffectiveRunParams` so it awaits `normalizeWorkflowRunParams(def, params)` and uses `normalized.params`.

Keep user-facing error mapping identical:

```ts
const normalized = await normalizeWorkflowRunParams(def, params)
if (normalized.errors.length > 0) {
  return { errors: normalized.errors }
}
const effectiveParams = normalized.params
```

- [ ] **Step 5: Keep capability dispatcher thin**

Leave `workflow.run.execute` in `workflow-dispatcher.ts` forwarding raw `params` to `deps.runWorkflow`; the run handler owns normalization. Add no filesystem validation in the dispatcher.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts desktop/electron/modules/workflow/__tests__/ipc.test.ts desktop/electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/bootstrap/descriptors.ts desktop/electron/modules/workflow/ipc.ts desktop/electron/capabilities/workflow-dispatcher.ts desktop/electron/bootstrap/__tests__/descriptors.test.ts desktop/electron/modules/workflow/__tests__/ipc.test.ts desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts
git commit -m "feat(workflow): normalize params at run entry points"
```

## Task 5: Variable Resolution for Resource Params

**Files:**
- Modify: `desktop/electron/services/workflow/variable-resolver.ts`
- Test: `desktop/electron/services/__tests__/workflow-variable-resolver.test.ts`

- [ ] **Step 1: Write failing interpolation test**

Add:

```ts
it("resolves local path resource params to their path string", () => {
  const { resolved } = resolveVariables([
    { name: "input", source: { type: "param", param: "input_file" } },
  ], {
    input_file: { kind: "local_path", entryType: "file", path: "/tmp/input.txt" },
  }, {})

  expect(resolved.input).toBe("/tmp/input.txt")
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/workflow-variable-resolver.test.ts
```

Expected: FAIL because object params stringify to `[object Object]`.

- [ ] **Step 3: Implement resource stringification**

In `variable-resolver.ts`, add:

```ts
function paramValueToString(raw: unknown): string {
  if (raw == null) return ""
  if (typeof raw === "number" && Number.isNaN(raw)) return ""
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>
    if (record.kind === "local_path" && typeof record.path === "string") return record.path
    if (typeof record.id === "string") return record.id
  }
  return String(raw)
}
```

Replace the existing param branch string conversion with:

```ts
resolved[name] = paramValueToString(raw)
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/workflow-variable-resolver.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/workflow/variable-resolver.ts desktop/electron/services/__tests__/workflow-variable-resolver.test.ts
git commit -m "feat(workflow): interpolate resource params as paths"
```

## Task 6: Workflow Call Typed Param Bindings

**Files:**
- Modify: `desktop/workflow-nodes/workflow-call/schema.ts`
- Modify: `desktop/workflow-nodes/workflow-call/params.ts`
- Modify: `desktop/workflow-nodes/workflow-call/executor.main.ts`
- Modify: `desktop/workflow-nodes/workflow-call/manifest.ts`
- Test: `desktop/workflow-nodes/workflow-call/__tests__/schema.test.ts`
- Test: `desktop/workflow-nodes/workflow-call/__tests__/params.test.ts`
- Test: `desktop/workflow-nodes/workflow-call/__tests__/executor.test.ts`

- [ ] **Step 1: Add failing schema and params tests**

In `schema.test.ts`:

```ts
it("accepts typed param bindings", () => {
  const result = workflowCallNodeConfigSchema.safeParse({
    workflowId: "child-1",
    variables: [{ name: "input", source: { type: "param", param: "input_file" } }],
    paramTemplates: {},
    paramBindings: {
      input_file: { mode: "value", source: { type: "param", param: "input_file" } },
      topic: { mode: "template", template: "总结 {{input}}" },
    },
  })

  expect(result.success).toBe(true)
})
```

In `params.test.ts`:

```ts
it("forwards resource params through value bindings", () => {
  const resource = { kind: "local_path" as const, entryType: "file" as const, path: "/tmp/input.txt" }
  const result = buildWorkflowCallParams({
    childDefinition: child([{ name: "input_file", type: "file", default: null }]),
    paramTemplates: {},
    paramBindings: { input_file: { mode: "value", source: { type: "param", param: "input_file" } } },
    parentParamValues: { input_file: resource },
    resolvedVariables: { input_file: "/tmp/input.txt" },
  })

  expect(result.params.input_file).toEqual(resource)
  expect(result.errors).toEqual([])
})

it("rejects duplicate template and binding mappings for the same child param", () => {
  const result = buildWorkflowCallParams({
    childDefinition: child([{ name: "topic", type: "text", default: null }]),
    paramTemplates: { topic: "{{topic}}" },
    paramBindings: { topic: { mode: "template", template: "{{topic}}" } },
    parentParamValues: {},
    resolvedVariables: { topic: "hello" },
  })

  expect(result.errors[0]).toBe("子工作流参数「topic」不能同时使用 paramTemplates 和 paramBindings")
})
```

- [ ] **Step 2: Run workflow-call tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/workflow-call/__tests__/schema.test.ts desktop/workflow-nodes/workflow-call/__tests__/params.test.ts desktop/workflow-nodes/workflow-call/__tests__/executor.test.ts
```

Expected: FAIL because `paramBindings` is unknown.

- [ ] **Step 3: Add schema support**

In `desktop/workflow-nodes/workflow-call/schema.ts`, import `variableSourceSchema` and add:

```ts
const workflowCallParamBindingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("template"), template: z.string() }),
  z.object({ mode: z.literal("value"), source: variableSourceSchema }),
])
```

Extend config:

```ts
paramBindings: z.record(z.string(), workflowCallParamBindingSchema).default({}),
```

Keep `paramTemplates` required for existing saved configs; normalizers can default missing `paramBindings` to `{}`.

- [ ] **Step 4: Implement typed param construction**

Update `BuildWorkflowCallParamsInput` in `params.ts`:

```ts
paramBindings?: Record<string, WorkflowParamBinding>
parentParamValues?: Record<string, unknown>
```

Add:

```ts
function resolveValueBinding(source: VariableSource, input: BuildWorkflowCallParamsInput): unknown {
  if (source.type === "param") return input.parentParamValues?.[source.param]
  if (source.type === "static") return source.value
  return input.resolvedVariables[source.node] ?? ""
}
```

In `buildWorkflowCallParams`, before legacy template handling, check `paramBindings[param.name]`. Reject both legacy and new mapping for the same child param. For `mode: "template"`, render like `paramTemplates`. For `mode: "value"`, assign the raw resolved value and let the child run normalizer validate it.

- [ ] **Step 5: Pass parent raw params from executor**

In `executor.main.ts`, pass parent param values from `input.context` only if already available. If `NodeExecutionInput` does not expose raw params, modify `desktop/workflow-nodes/types.ts` and `workflow-engine.ts` to include `paramValues` in node execution input:

```ts
paramValues: paramValues,
```

Then call:

```ts
const paramResult = buildWorkflowCallParams({
  childDefinition,
  paramTemplates: config.paramTemplates,
  paramBindings: config.paramBindings,
  parentParamValues: input.paramValues,
  resolvedVariables,
})
```

- [ ] **Step 6: Update manifest defaults**

In `manifest.ts`, change default config:

```ts
defaultConfig: { workflowId: "", variables: [], paramTemplates: {}, paramBindings: {} },
```

Add config field:

```ts
{ name: "paramBindings", kind: "record", label: "参数绑定" },
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/workflow-call/__tests__
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/workflow-nodes/workflow-call desktop/workflow-nodes/types.ts desktop/electron/services/workflow/workflow-engine.ts
git commit -m "feat(workflow): add typed workflow call params"
```

## Task 7: Workflow Parameter Picker IPC

**Files:**
- Modify: `desktop/electron/modules/workflow/ipc.ts`
- Modify: `desktop/electron/modules/workflow/__tests__/ipc.test.ts`
- Modify: `desktop/src/types/bridge.ts` if generated bridge types are checked in

- [ ] **Step 1: Add failing IPC picker tests**

In `desktop/electron/modules/workflow/__tests__/ipc.test.ts`, add:

```ts
it("chooses a workflow parameter file", async () => {
  electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/input.txt"] })

  const result = await harness.invoke("synapse:workflow:param-file:choose")

  expect(result).toBe("/tmp/input.txt")
  expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
    properties: ["openFile"],
  }))
})

it("chooses a workflow parameter directory", async () => {
  electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/workspace"] })

  const result = await harness.invoke("synapse:workflow:param-directory:choose")

  expect(result).toBe("/tmp/workspace")
  expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
    properties: ["openDirectory"],
  }))
})
```

- [ ] **Step 2: Run IPC tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/workflow/__tests__/ipc.test.ts
```

Expected: FAIL because channels do not exist.

- [ ] **Step 3: Add IPC methods**

In the workflow IPC module methods, add:

```ts
chooseParamFile: {
  channel: "synapse:workflow:param-file:choose",
  kind: "invoke",
  request: z.void().optional(),
  response: z.string().nullable(),
  handler: async () => chooseWorkflowParamPath("file"),
},
chooseParamDirectory: {
  channel: "synapse:workflow:param-directory:choose",
  kind: "invoke",
  request: z.void().optional(),
  response: z.string().nullable(),
  handler: async () => chooseWorkflowParamPath("directory"),
},
```

Add helper:

```ts
async function chooseWorkflowParamPath(entryType: "file" | "directory"): Promise<string | null> {
  const parentWindow = BrowserWindow.getFocusedWindow()
  const options: Electron.OpenDialogOptions = {
    title: entryType === "file" ? "选择文件" : "选择文件夹",
    properties: [entryType === "file" ? "openFile" : "openDirectory"],
  }
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] ?? null
}
```

- [ ] **Step 4: Regenerate IPC if required**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: generated bridge declarations update cleanly, or no changes if this repo does not generate `desktop/src/types/bridge.ts` from IPC metadata.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/workflow/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/modules/workflow/ipc.ts desktop/electron/modules/workflow/__tests__/ipc.test.ts desktop/src/types/bridge.ts
git commit -m "feat(workflow): add resource parameter pickers"
```

If `desktop/src/types/bridge.ts` did not change, omit it from `git add`.

## Task 8: Parameter Editor UI

**Files:**
- Modify: `desktop/src/modules/workflow/components/params-editor-dialog.tsx`
- Test: `desktop/src/modules/workflow/components/__tests__/params-editor-dialog.test.tsx`

- [ ] **Step 1: Add failing UI tests**

Add a test that opens the type select and saves file/directory params:

```tsx
it("saves file and directory parameters", async () => {
  const onChange = vi.fn()
  const { container } = renderDialog({
    open: true,
    params: [
      { name: "input_file", type: "file", default: null },
      { name: "workspace_dir", type: "directory", default: null },
    ],
    onChange,
  })

  container.querySelector<HTMLButtonElement>("button[type='submit']")?.click()

  expect(onChange).toHaveBeenCalledWith([
    { name: "input_file", type: "file", default: null, description: undefined },
    { name: "workspace_dir", type: "directory", default: null, description: undefined },
  ])
})
```

Adapt the selector to the existing test helpers in this file.

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/params-editor-dialog.test.tsx
```

Expected: FAIL because the select does not include resource types.

- [ ] **Step 3: Add file/directory type options**

In `params-editor-dialog.tsx`, extend the select:

```tsx
<SelectItem value="file">文件</SelectItem>
<SelectItem value="directory">文件夹</SelectItem>
```

When changing type, reset incompatible defaults:

```ts
const nextDefault = v === "number" ? null : null
onChange({ type: v as WorkflowParam["type"], default: nextDefault })
```

For resource defaults, add this branch before the existing text `Textarea` branch. This editor only needs to preserve defaults safely in this task:

```tsx
{(param.type === "file" || param.type === "directory") && (
  <Input
    value={typeof param.default === "object" && param.default?.kind === "local_path" ? param.default.path : ""}
    onChange={(event) => onChange({
      default: event.target.value
        ? { kind: "local_path", entryType: param.type, path: event.target.value }
        : null,
    })}
    placeholder="可选"
  />
)}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/params-editor-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/workflow/components/params-editor-dialog.tsx desktop/src/modules/workflow/components/__tests__/params-editor-dialog.test.tsx
git commit -m "feat(workflow): edit resource parameter definitions"
```

## Task 9: Run Params Dialog UI

**Files:**
- Modify: `desktop/src/modules/workflow/components/run-params-dialog.tsx`
- Test: `desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx`

- [ ] **Step 1: Add failing runtime UI tests**

Add:

```tsx
it("submits file and directory params as local path refs", async () => {
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  const bridge = installWorkflowBridge({
    chooseParamFile: vi.fn().mockResolvedValue("/tmp/input.txt"),
    chooseParamDirectory: vi.fn().mockResolvedValue("/tmp/workspace"),
  })

  const { container } = renderDialog({
    open: true,
    params: [
      { name: "input_file", type: "file", default: null },
      { name: "workspace_dir", type: "directory", default: null },
    ],
    onConfirm,
  })

  await clickButton(container, "选择文件")
  await clickButton(container, "选择文件夹")
  await clickButton(container, "运行")

  expect(bridge.chooseParamFile).toHaveBeenCalled()
  expect(bridge.chooseParamDirectory).toHaveBeenCalled()
  expect(onConfirm).toHaveBeenCalledWith({
    input_file: { kind: "local_path", entryType: "file", path: "/tmp/input.txt" },
    workspace_dir: { kind: "local_path", entryType: "directory", path: "/tmp/workspace" },
  }, {
    input_file: "/tmp/input.txt",
    workspace_dir: "/tmp/workspace",
  })
})
```

Use existing test helpers if they differ.

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx
```

Expected: FAIL because resource params render as text inputs.

- [ ] **Step 3: Implement resource controls**

In `run-params-dialog.tsx`, add a helper:

```ts
function parseParamValue(param: WorkflowParam, raw: string): unknown {
  if (param.type === "number") {
    const num = Number(raw)
    return raw === "" || Number.isNaN(num) ? (param.default ?? 0) : num
  }
  if (param.type === "file" || param.type === "directory") {
    return raw
      ? { kind: "local_path", entryType: param.type, path: raw }
      : param.default
  }
  return raw
}
```

Render resource rows as an input plus outline button using existing shadcn components and no custom colors:

```tsx
<div className="flex gap-2">
  <Input
    id={p.name}
    value={values[p.name] ?? ""}
    onChange={(event) => {
      setValues((current) => ({ ...current, [p.name]: event.target.value }))
      if (errors[p.name]) {
        setErrors((current) => {
          const next = { ...current }
          delete next[p.name]
          return next
        })
      }
    }}
    aria-invalid={!!errors[p.name]}
  />
  <Button type="button" variant="outline" onClick={() => chooseResource(p.type, p.name)}>
    {p.type === "file" ? "选择文件" : "选择文件夹"}
  </Button>
</div>
```

Implement picker:

```ts
async function chooseResource(type: "file" | "directory", name: string): Promise<void> {
  const workflow = window.synapse?.workflow
  const selected = type === "file"
    ? await workflow?.chooseParamFile()
    : await workflow?.chooseParamDirectory()
  if (!selected) return
  setValues((current) => ({ ...current, [name]: selected }))
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/workflow/components/run-params-dialog.tsx desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx
git commit -m "feat(workflow): run workflows with resource params"
```

## Task 10: Workflow Call Panel UI

**Files:**
- Modify: `desktop/workflow-nodes/workflow-call/panel.tsx`
- Modify: `desktop/workflow-nodes/workflow-call/card.tsx`
- Test: `desktop/workflow-nodes/workflow-call/__tests__/panel.test.ts`
- Test: `desktop/workflow-nodes/workflow-call/__tests__/card.test.tsx`

- [ ] **Step 1: Add failing panel test for resource child params**

Add:

```ts
it("auto-fills same-name resource params with value bindings", async () => {
  workflowList.mockResolvedValue([{ id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 }])
  workflowGet.mockResolvedValue({
    id: "child",
    name: "子工作流",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [{ name: "input_file", type: "file", default: null }],
    nodes: [],
    edges: [],
  })

  const { onChange } = renderPanel({ workflowId: "child", variables: [], paramTemplates: {}, paramBindings: {} }, {
    workflowParams: [{ name: "input_file", type: "file", default: null }],
  })
  await flushEffects()

  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    paramBindings: { input_file: { mode: "value", source: { type: "param", param: "input_file" } } },
  }))
})
```

- [ ] **Step 2: Run panel tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/workflow-call/__tests__/panel.test.ts desktop/workflow-nodes/workflow-call/__tests__/card.test.tsx
```

Expected: FAIL because panel does not manage `paramBindings`.

- [ ] **Step 3: Update panel state**

In `panel.tsx`, track both templates and bindings:

```ts
const [bindings, setBindings] = useState<Record<string, WorkflowParamBinding>>(config.paramBindings ?? {})
```

For child `file` and `directory` params, render a `Select` that chooses a same-name or existing variable binding source. Keep text/number params in the existing textarea path unless they already have `paramBindings`.

Update `buildInitialParamTemplates` into `buildInitialParamMappings`:

```ts
if (param.type === "file" || param.type === "directory") {
  if (parentParamNames.has(param.name)) {
    nextBindings[param.name] = { mode: "value", source: { type: "param", param: param.name } }
    changed = true
  }
  continue
}
```

- [ ] **Step 4: Update card summary**

In `card.tsx`, count both mapping sources:

```ts
const paramCount = new Set([
  ...Object.keys(config.paramTemplates),
  ...Object.keys(config.paramBindings ?? {}),
]).size
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/workflow-call/__tests__
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/workflow-nodes/workflow-call/panel.tsx desktop/workflow-nodes/workflow-call/card.tsx desktop/workflow-nodes/workflow-call/__tests__/panel.test.ts desktop/workflow-nodes/workflow-call/__tests__/card.test.tsx
git commit -m "feat(workflow): map resource params in workflow calls"
```

## Task 11: MCP Skill Docs and Release Notes

**Files:**
- Modify: `desktop/resources/templates/skills/synapse-skill/files/workflow/index.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/workflow/api-reference.md`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update workflow skill guidance**

In `index.md`, add this section after "Variable Bindings":

~~~md
## Workflow Parameters

Workflow params support `text`, `number`, `file`, and `directory`.

For `file` and `directory`, pass either a full resource reference or a local path shorthand. Local paths are resolved on the machine running Synapse.

Full local file reference:

```json
{ "kind": "local_path", "entryType": "file", "path": "/Users/me/input.pdf" }
```

Local shorthand accepted by `workflow_run_execute` when the workflow param type is known:

```json
{ "input_file": "/Users/me/input.pdf", "workspace_dir": "/Users/me/project" }
```

Do not pass a caller-machine path when Synapse is running on another machine. Use a Synapse-accessible path or a supported resource reference.
~~~

Ensure markdown fences are balanced when editing.

- [ ] **Step 2: Update API reference**

Change `workflow_param_update` params line to:

```md
**Params:** `workflowId` (string, required), `params` (array, required) — each: `{ name, type: "text"|"number"|"file"|"directory", default?, description? }`
```

Change `workflow_run_execute` notes to include:

```md
**Resource params:** For `file` and `directory` params, values may be local path strings or `{ kind: "local_path", entryType, path }` objects. Paths are resolved on the Synapse host machine.
```

- [ ] **Step 3: Update release notes**

Append a concise user-facing bullet under the pending release section:

```md
- 工作流参数新增文件和文件夹类型，运行时可以通过选择器或 MCP 参数传入本机可访问路径；子工作流也能继续传递这类参数。
```

- [ ] **Step 4: Run docs sanity checks**

Run:

```bash
rg -n 'text"\\|"number"' desktop/resources/templates/skills/synapse-skill/files/workflow
rg -n "file|directory|文件|文件夹" desktop/resources/templates/skills/synapse-skill/files/workflow/index.md desktop/resources/templates/skills/synapse-skill/files/workflow/api-reference.md
```

Expected: no stale workflow-param type list limited to only `text|number`; resource guidance appears in both files.

- [ ] **Step 5: Commit**

```bash
git add desktop/resources/templates/skills/synapse-skill/files/workflow/index.md desktop/resources/templates/skills/synapse-skill/files/workflow/api-reference.md RELEASE_NOTES_PENDING.md
git commit -m "docs(workflow): document resource parameters"
```

## Task 12: Final Verification

**Files:**
- No planned source edits unless verification reveals a bug.

- [ ] **Step 1: Run focused workflow tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/electron/services/__tests__/workflow-param-normalizer.test.ts \
  desktop/electron/services/__tests__/workflow-validator.test.ts \
  desktop/electron/services/__tests__/workflow-variable-resolver.test.ts \
  desktop/workflow-nodes/workflow-call/__tests__ \
  desktop/src/modules/workflow/components/__tests__/params-editor-dialog.test.tsx \
  desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx \
  desktop/electron/modules/workflow/__tests__/ipc.test.ts \
  desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full desktop tests if focused tests are clean**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS. If runtime exceeds the session budget, record the last completed focused commands and the reason full tests were not completed.

- [ ] **Step 4: Inspect git state**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: only intentional changes are committed or clearly listed for final handoff.

- [ ] **Step 5: Final commit for verification fixes**

If verification required fixes:

```bash
git add -u
git commit -m "fix(workflow): stabilize resource parameter support"
```

If no fixes were needed, skip this commit.
