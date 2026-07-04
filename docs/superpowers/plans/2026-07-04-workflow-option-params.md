# Workflow Option Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `option` workflow parameter type whose configured strings render as run-time dropdown values, with optional custom input.

**Architecture:** Treat `option` as an enumerated string parameter. Extend the shared workflow param contract first, then let persistence, IPC, MCP, editor UI, run UI, and runtime normalization consume the same shape. Keep parameter presets as `Record<string, string>` and let the existing workflow run normalizer enforce the option rules.

**Tech Stack:** Electron 41, Vite 8, React 19, TypeScript 6, Vitest, shadcn/Radix components, Tailwind token classes, Zod, Synapse DataRepository schemas.

---

## File Structure

- `desktop/src/types/workflow.ts`: shared workflow parameter type shape.
- `desktop/electron/services/workflow/workflow-param-normalizer.ts`: run-time `option` value parsing and validation.
- `desktop/electron/services/workflow/workflow-validator.ts`: workflow definition validation for option lists and defaults.
- `desktop/electron/runtime/data-repo/schemas/placeholders.ts`: DataRepository workflow entry normalization and validation.
- `desktop/electron/modules/workflow/ipc.ts`: workflow IPC Zod schema for definitions and param updates.
- `desktop/synapse-capabilities/shared/workflow-domain.ts`: MCP input schemas and system model description.
- `desktop/src/modules/workflow/components/params-editor-dialog.tsx`: authoring UI for option values and custom toggle.
- `desktop/src/modules/workflow/components/run-params-dialog.tsx`: run parameter dropdown and custom-value combobox.
- `desktop/resources/templates/skills/synapse-skill/files/workflow/index.md`: built-in skill guidance.
- `desktop/resources/templates/skills/synapse-skill/files/workflow/api-reference.md`: built-in skill API reference.
- `RELEASE_NOTES_PENDING.md`: user-visible release note.
- Tests:
  - `desktop/electron/services/__tests__/workflow-param-normalizer.test.ts`
  - `desktop/electron/services/__tests__/workflow-validator.test.ts`
  - `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`
  - `desktop/electron/modules/workflow/__tests__/ipc.test.ts`
  - `desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts`
  - `desktop/src/modules/workflow/components/__tests__/params-editor-dialog.test.tsx`
  - `desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx`

---

### Task 1: Shared Type, Normalizer, And Validator

**Files:**
- Modify: `desktop/src/types/workflow.ts`
- Modify: `desktop/electron/services/workflow/workflow-param-normalizer.ts`
- Modify: `desktop/electron/services/workflow/workflow-validator.ts`
- Test: `desktop/electron/services/__tests__/workflow-param-normalizer.test.ts`
- Test: `desktop/electron/services/__tests__/workflow-validator.test.ts`

- [ ] **Step 1: Write failing normalizer tests**

Add these cases to `desktop/electron/services/__tests__/workflow-param-normalizer.test.ts` inside `describe("normalizeWorkflowRunParams", () => { ... })`:

```ts
  it("normalizes option params as strings and rejects values outside a closed option list", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: "周报", options: ["日报", "周报"], allowCustomOption: false },
    ]), { report_type: "月报" })

    expect(result.errors[0]).toMatchObject({
      type: "invalid_config",
      message: "参数「report_type」必须是预设选项之一",
    })
  })

  it("accepts option params from the configured list", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: null, options: ["日报", "周报"], allowCustomOption: false },
    ]), { report_type: "周报" })

    expect(result.errors).toEqual([])
    expect(result.params).toEqual({ report_type: "周报" })
    expect(result.stringValues).toEqual({ report_type: "周报" })
    expect(result.snapshotParams).toEqual({ report_type: "周报" })
  })

  it("accepts custom option values when enabled", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: null, options: ["日报"], allowCustomOption: true },
    ]), { report_type: "季度复盘" })

    expect(result.errors).toEqual([])
    expect(result.params.report_type).toBe("季度复盘")
  })

  it("rejects empty custom option values for required params", async () => {
    const result = await normalizeWorkflowRunParams(def([
      { name: "report_type", type: "option", default: null, options: ["日报"], allowCustomOption: true },
    ]), { report_type: "" })

    expect(result.errors[0]).toMatchObject({
      type: "missing_param",
      message: "缺少必填参数「report_type」",
    })
  })
```

- [ ] **Step 2: Write failing validator tests**

Add these cases to `desktop/electron/services/__tests__/workflow-validator.test.ts` inside `describe("validateWorkflow", () => { ... })`:

```ts
  it("accepts valid option parameters", () => {
    const result = validateWorkflow({
      ...base,
      params: [
        { name: "report_type", type: "option", default: "周报", options: ["日报", "周报"], allowCustomOption: false },
      ],
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it("rejects option parameters without usable options", () => {
    const result = validateWorkflow({
      ...base,
      params: [
        { name: "report_type", type: "option", default: null, options: ["  "], allowCustomOption: true },
      ],
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "invalid_config",
        message: "参数「report_type」至少需要一个选项",
      }),
    ]))
  })

  it("rejects duplicate option values after trimming", () => {
    const result = validateWorkflow({
      ...base,
      params: [
        { name: "report_type", type: "option", default: "日报", options: ["日报", " 日报 "], allowCustomOption: false },
      ],
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "invalid_config",
        message: "参数「report_type」的选项不能重复",
      }),
    ]))
  })

  it("rejects option defaults outside the option list", () => {
    const result = validateWorkflow({
      ...base,
      params: [
        { name: "report_type", type: "option", default: "月报", options: ["日报", "周报"], allowCustomOption: true },
      ],
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "invalid_config",
        message: "参数「report_type」的默认值必须是选项之一",
      }),
    ]))
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/electron/services/__tests__/workflow-param-normalizer.test.ts \
  desktop/electron/services/__tests__/workflow-validator.test.ts
```

Expected: failures mentioning TypeScript type incompatibility for `"option"` or missing option validation behavior.

- [ ] **Step 4: Extend shared workflow types**

In `desktop/src/types/workflow.ts`, change the workflow param declarations to:

```ts
export type WorkflowParamType = "text" | "number" | "file" | "directory" | "option"
export type WorkflowResourceEntryType = "file" | "directory"
export type WorkflowLocalPathResourceRef = { readonly kind: "local_path"; readonly entryType: WorkflowResourceEntryType; readonly path: string }
export type WorkflowDriveResourceRef = { readonly kind: "drive"; readonly entryType: WorkflowResourceEntryType; readonly id: string; readonly versionId?: string }
export type WorkflowStagedResourceRef = { readonly kind: "staged"; readonly entryType: WorkflowResourceEntryType; readonly id: string }
export type WorkflowInlineFileResourceRef = { readonly kind: "inline_file"; readonly entryType: "file"; readonly name: string; readonly mimeType?: string; readonly base64: string }
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
  options?: string[]
  allowCustomOption?: boolean
}
```

- [ ] **Step 5: Implement option normalization**

In `desktop/electron/services/workflow/workflow-param-normalizer.ts`, add an option branch before the number branch:

```ts
  if (param.type === "option") {
    if (typeof raw !== "string") return paramError(param, "必须是文本")
    const value = raw.trim()
    if (!value) {
      return {
        error: {
          type: "missing_param",
          message: `缺少必填参数「${param.name}」`,
        },
      }
    }
    const options = normalizeOptionValues(param.options)
    if (param.allowCustomOption !== true && !options.includes(value)) {
      return paramError(param, "必须是预设选项之一")
    }
    return { value, stringValue: value, snapshotValue: value }
  }
```

Add this helper near the bottom of the same file:

```ts
function normalizeOptionValues(options: readonly string[] | undefined): string[] {
  if (!Array.isArray(options)) return []
  return options.map((option) => option.trim()).filter(Boolean)
}
```

Keep the missing-param check in `normalizeWorkflowRunParams` unchanged so `undefined` and `null` still use defaults or produce the existing required error.

- [ ] **Step 6: Implement option validation**

In `desktop/electron/services/workflow/workflow-validator.ts`, add this helper near `validateParamDefault`:

```ts
function normalizeOptionValues(options: readonly string[] | undefined): string[] {
  if (!Array.isArray(options)) return []
  return options.map((option) => option.trim()).filter(Boolean)
}

function validateOptionParam(param: WorkflowParam, errors: ValidationError[]): void {
  const name = param.name.trim()
  if (param.type !== "option") return

  const options = normalizeOptionValues(param.options)
  if (options.length === 0) {
    errors.push({ type: "invalid_config", message: `参数「${name}」至少需要一个选项` })
    return
  }

  if (new Set(options).size !== options.length) {
    errors.push({ type: "invalid_config", message: `参数「${name}」的选项不能重复` })
  }

  if (param.default !== null) {
    if (typeof param.default !== "string" || !options.includes(param.default.trim())) {
      errors.push({ type: "invalid_config", message: `参数「${name}」的默认值必须是选项之一` })
    }
  }
}
```

Then call it in the existing param loop immediately after `validateParamDefault(p, errors)`:

```ts
    validateParamDefault(p, errors)
    validateOptionParam(p, errors)
```

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/electron/services/__tests__/workflow-param-normalizer.test.ts \
  desktop/electron/services/__tests__/workflow-validator.test.ts
```

Expected: both test files pass.

- [ ] **Step 8: Commit Task 1**

```bash
git add \
  desktop/src/types/workflow.ts \
  desktop/electron/services/workflow/workflow-param-normalizer.ts \
  desktop/electron/services/workflow/workflow-validator.ts \
  desktop/electron/services/__tests__/workflow-param-normalizer.test.ts \
  desktop/electron/services/__tests__/workflow-validator.test.ts
git commit -m "feat: add workflow option param validation"
```

---

### Task 2: Persistence, IPC, And MCP Schemas

**Files:**
- Modify: `desktop/electron/runtime/data-repo/schemas/placeholders.ts`
- Modify: `desktop/electron/modules/workflow/ipc.ts`
- Modify: `desktop/synapse-capabilities/shared/workflow-domain.ts`
- Test: `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`
- Test: `desktop/electron/modules/workflow/__tests__/ipc.test.ts`
- Test: `desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts`

- [ ] **Step 1: Write failing DataRepository schema test**

Add this test to `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`:

```ts
  it("accepts workflow option parameters", () => {
    const schema = allSchemas.find((item) => item.name === "workflows")
    expect(schema).toBeTruthy()

    const entry = {
      id: "workflow-option-param",
      schemaVersion: 1,
      name: "Option Workflow",
      version: "v1",
      createdAt: 1,
      updatedAt: 2,
      params: [
        {
          name: "report_type",
          type: "option",
          default: "周报",
          options: ["日报", "周报"],
          allowCustomOption: false,
        },
      ],
      nodes: [{ id: "end", name: "结束", type: "end", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    }

    expect(schema?.validate(entry)).toBe(true)
  })
```

- [ ] **Step 2: Write failing IPC schema test**

Add a test to `desktop/electron/modules/workflow/__tests__/ipc.test.ts` using the existing IPC harness pattern:

```ts
  it("accepts option workflow params through definition save IPC", async () => {
    const harness = createWorkflowIpcHarness()
    const definition = {
      id: "workflow-option-param",
      name: "Option Workflow",
      version: "v1",
      createdAt: 1,
      updatedAt: 2,
      params: [
        { name: "report_type", type: "option", default: "周报", options: ["日报", "周报"], allowCustomOption: false },
      ],
      nodes: [{ id: "end", name: "结束", type: "end", position: { x: 0, y: 0 }, config: { outputType: "text", template: "", variables: [] } }],
      edges: [],
    }

    await expect(harness.invoke("synapse:workflow:save", { definition })).resolves.toBeDefined()
  })
```

- [ ] **Step 3: Write failing MCP schema test**

Add this assertion to a workflow tool schema test in `desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts`, near existing `workflow.param.update` coverage:

```ts
  it("describes option params in workflow MCP schemas", () => {
    const tools = buildWorkflowTools()
    const updateTool = tools.find((tool) => tool.name === "app_workflow_param_update" || tool.name === "workflow_param_update")
    const serialized = JSON.stringify(updateTool?.inputSchema)

    expect(serialized).toContain("\"option\"")
    expect(serialized).toContain("allowCustomOption")
    expect(serialized).toContain("options")
  })
```

Add this import at the top if the file does not already import it:

```ts
import { buildWorkflowTools } from "../../../synapse-capabilities/shared/workflow-domain"
```

- [ ] **Step 4: Run schema tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/electron/runtime/data-repo/__tests__/schemas.test.ts \
  desktop/electron/modules/workflow/__tests__/ipc.test.ts \
  desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts
```

Expected: failures because `option`, `options`, and `allowCustomOption` are not accepted or described yet.

- [ ] **Step 5: Update DataRepository workflow entry schema**

In `desktop/electron/runtime/data-repo/schemas/placeholders.ts`, update `WorkflowEntryV1["params"]` to include the option fields:

```ts
  params: Array<{
    name: string
    type: "text" | "number" | "file" | "directory" | "option"
    default: string | number | WorkflowResourceRefV1 | null
    description?: string
    options?: string[]
    allowCustomOption?: boolean
  }>
```

Update `isWorkflowParam` so it accepts the new fields:

```ts
function isWorkflowParam(value: unknown): value is WorkflowEntryV1["params"][number] {
  return isAnyRecord<Record<string, unknown>>(value)
    && typeof value.name === "string"
    && isWorkflowParamType(value.type)
    && (value.default === null || typeof value.default === "string" || typeof value.default === "number" || isWorkflowResourceRef(value.default))
    && isOptionalString(value.description)
    && (value.options === undefined || isStringArray(value.options))
    && (value.allowCustomOption === undefined || typeof value.allowCustomOption === "boolean")
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}
```

Update `isWorkflowParamType`:

```ts
function isWorkflowParamType(value: unknown): value is WorkflowEntryV1["params"][number]["type"] {
  return value === "text" || value === "number" || value === "file" || value === "directory" || value === "option"
}
```

Update `normalizeWorkflowParam` to copy option metadata:

```ts
  const options = Array.isArray(value.options)
    ? value.options.filter((option): option is string => typeof option === "string")
    : undefined
  if (options !== undefined) param.options = options
  if (typeof value.allowCustomOption === "boolean") param.allowCustomOption = value.allowCustomOption
```

- [ ] **Step 6: Update IPC Zod schema**

In `desktop/electron/modules/workflow/ipc.ts`, update the param schema to:

```ts
const workflowParamSchema = z.object({
  name: z.string(),
  type: z.enum(["text", "number", "file", "directory", "option"]),
  default: z.union([z.string(), z.number(), workflowResourceRefSchema, z.null()]),
  description: z.string().optional(),
  options: z.array(z.string()).optional(),
  allowCustomOption: z.boolean().optional(),
})
```

Then use `workflowParamSchema` in `workflowDefinitionSchema`:

```ts
  params: z.array(workflowParamSchema),
```

Replace any duplicated inline `params: z.array(z.object({ name: ..., type: ... }))` schema in the same file with `z.array(workflowParamSchema)`.

- [ ] **Step 7: Update MCP workflow tool schemas**

In `desktop/synapse-capabilities/shared/workflow-domain.ts`, update the system description:

```ts
const SYSTEM_MODEL_DESCRIPTION = `Synapse workflows are directed acyclic graphs (DAGs). Nodes execute in topological order; independent nodes run in parallel. Workflow params support text, number, file, directory, and option types; file/directory values are resource references such as { kind: "local_path", entryType: "file", path: "/abs/file.txt" }; option values are strings selected from the workflow definition unless allowCustomOption is true. Available node types include prompt, switch, http_request, script, workflow_call, codex, claude_code, and end. Every workflow must have exactly one "end" node and no cycles. Nodes connect via directed edges (from → to); switch-node edges may carry a "branch" field. Switch branches are mutually exclusive: connect each branch only to its own downstream nodes, then merge after those branch-specific nodes if needed. Nodes define a "variables" list that binds upstream node outputs or workflow params; reference them in templates with {{variableName}}. A workflow_call node invokes another saved workflow, maps text/number/option child params through paramTemplates, can pass file/directory child params through paramBindings, and returns the child workflow's End output. A codex node runs local codex exec, needs an effective project, may set a per-task workingDirectory, and returns Codex's final reply text. A claude_code node runs the user's local Claude Code CLI via claude -p, needs an effective project, may set workingDirectory and Claude Code settings/MCP paths, and returns Claude Code's final reply text. Call this tool first to discover available node types, then call workflow_node_type_describe for config details.`
```

Update the param type schema:

```ts
const workflowParamTypeSchema = {
  type: "string",
  enum: ["text", "number", "file", "directory", "option"],
  description: "Workflow parameter type. option params pass strings; file and directory params receive resource references, not file bytes.",
}
```

Update param item properties in `workflowDefinitionSchema` and the param-update tool schema to include:

```ts
          options: {
            type: "array",
            items: { type: "string" },
            description: "option only: available string values. The label and actual value are the same string.",
          },
          allowCustomOption: {
            type: "boolean",
            description: "option only: when true, workflow runs may pass a string outside options. Custom run values are not saved back to the definition.",
          },
```

- [ ] **Step 8: Run schema tests to verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/electron/runtime/data-repo/__tests__/schemas.test.ts \
  desktop/electron/modules/workflow/__tests__/ipc.test.ts \
  desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts
```

Expected: all three test files pass.

- [ ] **Step 9: Commit Task 2**

```bash
git add \
  desktop/electron/runtime/data-repo/schemas/placeholders.ts \
  desktop/electron/modules/workflow/ipc.ts \
  desktop/synapse-capabilities/shared/workflow-domain.ts \
  desktop/electron/runtime/data-repo/__tests__/schemas.test.ts \
  desktop/electron/modules/workflow/__tests__/ipc.test.ts \
  desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts
git commit -m "feat: accept workflow option params in schemas"
```

---

### Task 3: Parameter Editor UI

**Files:**
- Modify: `desktop/src/modules/workflow/components/params-editor-dialog.tsx`
- Test: `desktop/src/modules/workflow/components/__tests__/params-editor-dialog.test.tsx`

- [ ] **Step 1: Write failing editor tests**

Add tests to `desktop/src/modules/workflow/components/__tests__/params-editor-dialog.test.tsx`:

```ts
  it("saves option params with trimmed non-empty options and clears invalid defaults", async () => {
    const onChange = vi.fn()
    const onClose = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ParamsEditorDialog
          open
          params={[
            {
              name: "report_type",
              type: "option",
              default: "月报",
              options: [" 日报 ", "", "周报"],
              allowCustomOption: true,
            },
          ]}
          onChange={onChange}
          onClose={onClose}
        />,
      )
    })

    const saveButton = [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent === "保存")

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith([
      {
        name: "report_type",
        type: "option",
        default: null,
        options: ["日报", "周报"],
        allowCustomOption: true,
      },
    ])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("blocks saving option params when all options are empty", async () => {
    const onChange = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ParamsEditorDialog
          open
          params={[
            { name: "report_type", type: "option", default: null, options: [" "], allowCustomOption: false },
          ]}
          onChange={onChange}
          onClose={vi.fn()}
        />,
      )
    })

    const saveButton = [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent === "保存")

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("至少保留一个选项")
  })

  it("blocks saving duplicate option values", async () => {
    const onChange = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ParamsEditorDialog
          open
          params={[
            { name: "report_type", type: "option", default: "日报", options: ["日报", " 日报 "], allowCustomOption: false },
          ]}
          onChange={onChange}
          onClose={vi.fn()}
        />,
      )
    })

    const saveButton = [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent === "保存")

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("选项不能重复")
  })
```

- [ ] **Step 2: Run editor tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/params-editor-dialog.test.tsx
```

Expected: failures because option controls and save normalization are not implemented.

- [ ] **Step 3: Add imports**

In `desktop/src/modules/workflow/components/params-editor-dialog.tsx`, add `Switch` and more icons:

```ts
import { Switch } from "@/components/ui/switch"
import { Plus, Trash2, ChevronUp, ChevronDown, FolderOpen, X } from "lucide-react"
```

Keep existing imports that are still used.

- [ ] **Step 4: Add editor helpers**

Add these helpers near `fromDraft`:

```ts
const EMPTY_OPTION_ERROR = "至少保留一个选项"
const DUPLICATE_OPTION_ERROR = "选项不能重复"

function normalizeOptionValues(options: readonly string[] | undefined): string[] {
  if (!Array.isArray(options)) return []
  return options.map((option) => option.trim()).filter(Boolean)
}

function optionValidationError(param: WorkflowParam): string | null {
  if (param.type !== "option") return null
  const options = normalizeOptionValues(param.options)
  if (options.length === 0) return EMPTY_OPTION_ERROR
  if (new Set(options).size !== options.length) return DUPLICATE_OPTION_ERROR
  return null
}

function sanitizeParamForSave(param: WorkflowParam): WorkflowParam {
  if (param.type !== "option") {
    return {
      name: param.name,
      type: param.type,
      default: param.default,
      description: param.description,
    }
  }

  const options = normalizeOptionValues(param.options)
  const defaultValue = typeof param.default === "string" && options.includes(param.default.trim())
    ? param.default.trim()
    : null

  return {
    name: param.name,
    type: "option",
    default: defaultValue,
    description: param.description,
    options,
    allowCustomOption: param.allowCustomOption === true,
  }
}
```

- [ ] **Step 5: Add option controls to `WorkflowParamCard`**

Inside `WorkflowParamCard`, add handlers:

```ts
  const optionValues = param.type === "option" ? (param.options ?? []) : []
  const updateOption = (optionIndex: number, value: string) => {
    onChange({ options: optionValues.map((option, index) => index === optionIndex ? value : option) })
  }
  const addOption = () => {
    onChange({ options: [...optionValues, ""] })
  }
  const removeOption = (optionIndex: number) => {
    const nextOptions = optionValues.filter((_, index) => index !== optionIndex)
    onChange({
      options: nextOptions,
      default: typeof param.default === "string" && nextOptions.map((option) => option.trim()).includes(param.default)
        ? param.default
        : null,
    })
  }
```

Add `SelectItem value="option">选项</SelectItem>` to the type selector. Change the type selector handler to seed option metadata:

```tsx
onValueChange={(v) => onChange({
  type: v as WorkflowParam["type"],
  default: null,
  ...(v === "option" ? { options: [], allowCustomOption: false } : { options: undefined, allowCustomOption: undefined }),
})}
```

Replace the default-value rendering branch so option params use a select:

```tsx
        {param.type === "number" ? (
          <Input
            type="number"
            value={typeof param.default === "number" ? param.default : ""}
            onChange={(e) =>
              onChange({ default: e.target.value === "" ? null : Number(e.target.value) })
            }
            placeholder="可选"
          />
        ) : param.type === "option" ? (
          <Select
            value={typeof param.default === "string" && normalizeOptionValues(param.options).includes(param.default) ? param.default : "__empty__"}
            onValueChange={(value) => onChange({ default: value === "__empty__" ? null : value })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="必填" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__empty__">必填</SelectItem>
              {normalizeOptionValues(param.options).map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : resourceEntryType ? (
```

After the default-value control, render option rows when `param.type === "option"`:

```tsx
      {param.type === "option" && (
        <div className="grid gap-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">选项</Label>
            <div className="grid gap-1.5">
              {optionValues.map((option, optionIndex) => (
                <div key={optionIndex} className="flex items-center gap-1.5">
                  <Input
                    value={option}
                    onChange={(event) => updateOption(optionIndex, event.target.value)}
                    placeholder="选项值"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => removeOption(optionIndex)}
                    aria-label="删除选项"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-fit justify-start gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={addOption}
              >
                <Plus className="size-3" />添加选项
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs" htmlFor={`workflow-param-${param.name || index}-allow-custom`}>允许自定义</Label>
            <Switch
              id={`workflow-param-${param.name || index}-allow-custom`}
              checked={param.allowCustomOption === true}
              onCheckedChange={(checked) => onChange({ allowCustomOption: checked })}
            />
          </div>
        </div>
      )}
```

- [ ] **Step 6: Wire save validation**

In `ParamsEditorDialog`, compute option errors:

```ts
  const optionErrors = useMemo(() => {
    const result = new Map<string, string>()
    for (const p of draft) {
      const error = optionValidationError(p)
      if (error) result.set(p._key, error)
    }
    return result
  }, [draft])

  const hasOptionErrors = optionErrors.size > 0
```

Pass `optionErrors.get(p._key)` to `WorkflowParamCard` via a new prop:

```ts
  optionError?: string
```

Render the error below the option list:

```tsx
          {optionError && <p className="text-xs text-destructive">{optionError}</p>}
```

Update save disabled states from `disabled={hasDuplicates}` to:

```tsx
disabled={hasDuplicates || hasOptionErrors}
```

Update `handleSave`:

```ts
  const handleSave = () => {
    if (hasDuplicates || hasOptionErrors) return
    onChange(draft
      .map((p) => sanitizeParamForSave({ ...fromDraft(p), name: p.name.trim() }))
      .filter((p) => p.name !== ""))
    onClose()
  }
```

- [ ] **Step 7: Run editor tests to verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/params-editor-dialog.test.tsx
```

Expected: the params editor tests pass.

- [ ] **Step 8: Commit Task 3**

```bash
git add \
  desktop/src/modules/workflow/components/params-editor-dialog.tsx \
  desktop/src/modules/workflow/components/__tests__/params-editor-dialog.test.tsx
git commit -m "feat: edit workflow option params"
```

---

### Task 4: Run Parameters Dialog UI

**Files:**
- Modify: `desktop/src/modules/workflow/components/run-params-dialog.tsx`
- Test: `desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx`

- [ ] **Step 1: Write failing run dialog tests**

Add tests to `desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx`:

```ts
  it("submits closed option params from a dropdown", async () => {
    const onConfirm = vi.fn()
    await renderDialog({
      params: [
        { name: "report_type", type: "option", default: "日报", options: ["日报", "周报"], allowCustomOption: false },
      ],
      onConfirm,
    })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("#report_type")?.click()
    })
    await act(async () => {
      clickOption("周报")
    })
    await act(async () => {
      document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onConfirm).toHaveBeenCalledWith({ report_type: "周报" }, { report_type: "周报" })
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        optionParamCount: 1,
      }),
    }))
  })

  it("accepts custom option values when enabled", async () => {
    const onConfirm = vi.fn()
    await renderDialog({
      params: [
        { name: "report_type", type: "option", default: null, options: ["日报"], allowCustomOption: true },
      ],
      onConfirm,
    })

    await act(async () => {
      setControlValue(document.body.querySelector<HTMLInputElement>("#report_type"), "季度复盘")
    })
    await act(async () => {
      document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onConfirm).toHaveBeenCalledWith({ report_type: "季度复盘" }, { report_type: "季度复盘" })
  })

  it("rejects option values outside the list when custom values are disabled", async () => {
    const onConfirm = vi.fn()
    await renderDialog({
      params: [
        { name: "report_type", type: "option", default: null, options: ["日报"], allowCustomOption: false },
      ],
      lastValues: { report_type: "季度复盘" },
      onConfirm,
    })

    await act(async () => {
      document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("请选择预设选项")
  })
```

- [ ] **Step 2: Run run-dialog tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx
```

Expected: failures because option rendering, parsing, and tracking are missing.

- [ ] **Step 3: Add imports and param counts**

In `desktop/src/modules/workflow/components/run-params-dialog.tsx`, add imports:

```ts
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Check, ChevronsUpDown, FolderOpen, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
```

Keep existing imports that are still used. Update `paramCounts`:

```ts
  const paramCounts = useMemo(() => ({
    number: params.filter((param) => param.type === "number").length,
    text: params.filter((param) => param.type === "text").length,
    file: params.filter((param) => param.type === "file").length,
    directory: params.filter((param) => param.type === "directory").length,
    option: params.filter((param) => param.type === "option").length,
  }), [params])
```

Add `optionParamCount` to tracking metadata:

```ts
        optionParamCount: paramCounts.option,
```

- [ ] **Step 4: Add option validation and parsing**

Add helper:

```ts
function normalizeOptionValues(options: readonly string[] | undefined): string[] {
  if (!Array.isArray(options)) return []
  return options.map((option) => option.trim()).filter(Boolean)
}
```

Update `validate()` option handling:

```ts
      } else if (param.type === "option") {
        const value = raw?.trim() ?? ""
        if (!value) {
          next[param.name] = "此项为必填"
        } else if (param.allowCustomOption !== true && !normalizeOptionValues(param.options).includes(value)) {
          next[param.name] = "请选择预设选项"
        }
      } else if (!raw) {
```

Update `parseValues()` before the resource branch:

```ts
      } else if (param.type === "option") {
        parsed[param.name] = values[param.name]?.trim() ?? ""
```

- [ ] **Step 5: Add `OptionParamControl`**

Add this component above `RunParamsDialog`:

```tsx
interface OptionParamControlProps {
  readonly param: WorkflowParam
  readonly value: string
  readonly invalid: boolean
  readonly onChange: (value: string) => void
}

function OptionParamControl({ param, value, invalid, onChange }: OptionParamControlProps) {
  const options = normalizeOptionValues(param.options)
  if (param.allowCustomOption === true) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-full justify-between"
            aria-invalid={invalid}
          >
            <span className="truncate">{value || "选择或输入"}</span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
          <Command>
            <CommandInput id={param.name} value={value} onValueChange={onChange} />
            <CommandList>
              <CommandEmpty>无匹配项</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem key={option} value={option} onSelect={() => onChange(option)}>
                    <Check className={cn("size-4", value === option ? "opacity-100" : "opacity-0")} />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={param.name} className="w-full" aria-invalid={invalid}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>{option}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 6: Render option params**

In the parameter control render branch, add `param.type === "option"` before resource params:

```tsx
                      ) : param.type === "option" ? (
                        <OptionParamControl
                          param={param}
                          value={values[param.name] ?? ""}
                          invalid={!!errors[param.name]}
                          onChange={(nextValue) => updateValue(param.name, nextValue)}
                        />
```

- [ ] **Step 7: Run run-dialog tests to verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx
```

Expected: run dialog tests pass and tracking calls include `optionParamCount`.

- [ ] **Step 8: Commit Task 4**

```bash
git add \
  desktop/src/modules/workflow/components/run-params-dialog.tsx \
  desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx
git commit -m "feat: run workflows with option params"
```

---

### Task 5: Built-In Skill Docs And Release Notes

**Files:**
- Modify: `desktop/resources/templates/skills/synapse-skill/files/workflow/index.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/workflow/api-reference.md`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update workflow built-in skill guide**

In `desktop/resources/templates/skills/synapse-skill/files/workflow/index.md`, replace the param type list with:

```md
Workflow params support five types:

- `text` — string input.
- `number` — numeric input.
- `file` — resource reference to a file.
- `directory` — resource reference to a directory.
- `option` — string selected from `options`; if `allowCustomOption` is true, callers may pass a string outside `options`.

For option params, the displayed option and actual run value are the same string. Custom run values are not saved back to the workflow definition.
```

Keep the existing file/directory guidance directly after this section.

- [ ] **Step 2: Update workflow API reference**

In `desktop/resources/templates/skills/synapse-skill/files/workflow/api-reference.md`, update `app_workflow_param_update` params text to:

```md
**Params:** `workflowId` (string, required), `params` (array, required) — each: `{ name, type: "text"|"number"|"file"|"directory"|"option", default?, description?, options?, allowCustomOption? }`

**Notes:** Pass empty array to clear all params. Use `null` default for required params. For `option`, set `options` to string values; each string is both the label and run value. If `allowCustomOption` is true, workflow runs may pass a string outside `options`; custom run values are not written back to the definition. For file/directory defaults, use a resource ref:
```

Update `app_workflow_run_execute` notes with:

```md
For option params, pass a string. Closed option params must match one configured option; custom-enabled option params accept any non-empty string.
```

- [ ] **Step 3: Update release notes**

Add this bullet under `## 新增功能` in `RELEASE_NOTES_PENDING.md`:

```md
- 工作流参数新增“选项”类型，运行时可以用下拉菜单选择预设值，也可以按参数设置允许一次性输入自定义值。
```

- [ ] **Step 4: Verify docs mention option params**

Run:

```bash
rg -n "option|选项|allowCustomOption" \
  desktop/resources/templates/skills/synapse-skill/files/workflow/index.md \
  desktop/resources/templates/skills/synapse-skill/files/workflow/api-reference.md \
  RELEASE_NOTES_PENDING.md
```

Expected: all three files show matching lines.

- [ ] **Step 5: Commit Task 5**

```bash
git add \
  desktop/resources/templates/skills/synapse-skill/files/workflow/index.md \
  desktop/resources/templates/skills/synapse-skill/files/workflow/api-reference.md \
  RELEASE_NOTES_PENDING.md
git commit -m "docs: document workflow option params"
```

---

### Task 6: Full Verification

**Files:**
- Verify all files changed in Tasks 1-5.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/electron/services/__tests__/workflow-param-normalizer.test.ts \
  desktop/electron/services/__tests__/workflow-validator.test.ts \
  desktop/electron/runtime/data-repo/__tests__/schemas.test.ts \
  desktop/electron/modules/workflow/__tests__/ipc.test.ts \
  desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts \
  desktop/src/modules/workflow/components/__tests__/params-editor-dialog.test.tsx \
  desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx
```

Expected: all listed test files pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: TypeScript checks pass.

- [ ] **Step 3: Run UI style guard**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: hard-constraint checks pass. If it flags UI style issues, fix the flagged code using existing shadcn/Tailwind token patterns only.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat HEAD~5..HEAD
git status --short
```

Expected: diff includes only workflow option param implementation, docs, tests, and release notes; status is clean.

- [ ] **Step 5: Final commit if verification fixes were needed**

If Step 1, 2, or 3 required fixes after Task 5, commit those fixes:

```bash
git add .
git commit -m "fix: stabilize workflow option params"
```

If no fixes were needed, do not create an empty commit.
