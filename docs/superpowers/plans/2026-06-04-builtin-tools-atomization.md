# Builtin Tools Atomization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single broad File Conversion tool with descriptor-driven builtin atomic tools for `docx-to-markdown`, `xlsx-to-markdown`, `csv-to-markdown`, `pdf-to-markdown`, and `pptx-to-markdown`.

**Architecture:** Add a `desktop/electron/services/builtin-tools/` core with registry, descriptor projection, permission resolution, worker-backed runner, and one folder per tool. The existing `desktop/electron/services/file-conversion/` code remains shared parser infrastructure, while Tools IPC and renderer UI move to generic builtin tool calls.

**Tech Stack:** Electron main process, worker_threads, React, TypeScript, zod, Vitest, shadcn/Radix UI, existing Synapse `IpcRegistry`, `PermissionGuard`, and `AuditSink`.

---

## File Structure

Create:

- `desktop/electron/services/builtin-tools/types.ts`  
  Shared builtin tool types, ids, field descriptors, run envelope, permission declarations.
- `desktop/electron/services/builtin-tools/errors.ts`  
  `BuiltinToolError` and error normalization helpers.
- `desktop/electron/services/builtin-tools/registry.ts`  
  Imports every tool folder `index.ts`, validates unique ids, exposes list/get/projection/extension lookup.
- `desktop/electron/services/builtin-tools/permissions.ts`  
  Resolves descriptor permission declarations against validated input.
- `desktop/electron/services/builtin-tools/runner.ts`  
  Main-process runner that validates input, checks permissions, audits, starts the worker, validates output, and normalizes results.
- `desktop/electron/services/builtin-tools/worker-runner.ts`  
  Worker supervisor with asar/unpacked path resolution.
- `desktop/electron/services/builtin-tools/worker-execute.ts`  
  Worker-side execution helper used by the worker entry.
- `desktop/electron/workers/builtin-tool-worker.ts`  
  Worker entry that receives `{ toolId, input }`, revalidates, executes, and posts a structured response.
- `desktop/electron/worker-bootstraps/builtin-tool-worker-bootstrap.ts`  
  Bootstrap aligned with existing worker bootstrap pattern.
- `desktop/electron/services/builtin-tools/tools/<tool-id>/index.ts`  
  Exports the tool descriptor.
- `desktop/electron/services/builtin-tools/tools/<tool-id>/schema.ts`  
  Tool-owned input and output zod schemas.
- `desktop/electron/services/builtin-tools/tools/<tool-id>/executor.ts`  
  Tool-owned executor.
- `desktop/electron/services/builtin-tools/tools/<tool-id>/descriptor.ts`  
  Tool-owned descriptor.
- `desktop/electron/services/builtin-tools/tools/<tool-id>/__tests__/executor.test.ts`  
  Tool-owned executor tests.
- `desktop/src/modules/tools/builtin-tools/shared/tool-window.tsx`  
  Descriptor-driven tool window.
- `desktop/src/modules/tools/builtin-tools/shared/generated-tool-form.tsx`  
  Small generated form renderer.
- `desktop/src/modules/tools/builtin-tools/shared/generated-tool-result.tsx`  
  Generic result renderer.
- `desktop/src/modules/tools/builtin-tools/shared/path-utils.ts`  
  Renderer-only filename/path display helpers.
- `desktop/src/modules/tools/builtin-tools/__tests__/tool-window.test.tsx`  
  Generated window tests.
- `desktop/electron/services/builtin-tools/__tests__/registry.test.ts`
- `desktop/electron/services/builtin-tools/__tests__/runner.test.ts`
- `desktop/electron/services/builtin-tools/__tests__/worker-runner.test.ts`

Modify:

- `desktop/src/types/tools.ts`  
  Replace file-conversion-specific public types with renderer-safe builtin tool types.
- `desktop/src/types/bridge.ts`  
  Replace `tools.fileConversion.*` shape with generic `tools.*` methods.
- `desktop/electron/preload.ts`  
  Replace file-conversion channels and bridge methods with generic builtin tool bridge methods.
- `desktop/electron/generated/ipc-channels.generated.ts`  
  Regenerate through `pnpm --filter @synapse/desktop run generate:ipc`.
- `desktop/electron/modules/tools/ipc.ts`  
  Replace file-conversion-specific handlers with generic list/open/descriptor/run/select file/select directory handlers.
- `desktop/electron/modules/tools/__tests__/ipc.test.ts`  
  Update IPC tests for atomic builtin tools.
- `desktop/electron/services/tools/tool-registry.ts`  
  Make window metadata come from builtin tool descriptors.
- `desktop/electron/services/tools/tool-window-service.ts`  
  Keep generic window opening, but accept atomic tool ids.
- `desktop/electron/bootstrap/descriptors.ts`  
  Replace `tools.file-conversion-runner` service descriptor with `tools.builtin-tool-runner` if services are registered here.
- `desktop/electron/bootstrap/__tests__/registry.test.ts`  
  Update expected service ids.
- `desktop/src/modules/tools/index.tsx`  
  List atomic tools from renderer-safe descriptors.
- `desktop/src/main.tsx`  
  Route `window=tool&toolId=<atomic-id>` to the generated builtin tool window.
- `desktop/src/modules/tools/__tests__/tools-module.test.tsx`  
  Update expectations for atomic tool list/open.
- `desktop/src/modules/tools/file-conversion/file-conversion-window.tsx`  
  Remove after generated window is wired.
- `desktop/src/modules/tools/file-conversion/utils.ts`  
  Remove or replace with shared path helpers.
- `desktop/src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx`  
  Remove or replace with generated window tests.
- `desktop/electron/services/tools/file-conversion-runner.ts`  
  Remove after builtin runner replaces it.
- `desktop/electron/services/tools/file-conversion-types.ts`  
  Remove after public generic run types exist.
- `desktop/electron/workers/file-conversion-worker.ts`  
  Remove after builtin worker replaces it.
- `desktop/electron/worker-bootstraps/file-conversion-worker-bootstrap.ts`  
  Remove after builtin worker bootstrap replaces it.
- `RELEASE_NOTES_PENDING.md`  
  Add user-facing note that Tools now exposes focused conversion tools.

Keep:

- `desktop/electron/services/file-conversion/`  
  Remains shared deterministic parser/extractor infrastructure.
- `desktop/workflow-nodes/file-conversion/*`  
  Keep compatible in this slice unless implementation discovers a compile-time dependency that must be updated.

---

### Task 1: Add Builtin Tool Core Types And Registry Tests

**Files:**
- Create: `desktop/electron/services/builtin-tools/types.ts`
- Create: `desktop/electron/services/builtin-tools/errors.ts`
- Create: `desktop/electron/services/builtin-tools/registry.ts`
- Create: `desktop/electron/services/builtin-tools/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing registry test**

Create `desktop/electron/services/builtin-tools/__tests__/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  getBuiltinToolDescriptor,
  listBuiltinToolDescriptors,
  projectBuiltinToolDescriptor,
  createBuiltinToolRegistryForTests,
  findBuiltinTools,
} from "../registry"
import type { BuiltinToolDescriptor } from "../types"

function descriptor(id: string): BuiltinToolDescriptor<{ inputPath: string }, { markdown: string }> {
  const inputSchema = z.object({ inputPath: z.string().min(1) })
  const outputSchema = z.object({ markdown: z.string() })
  return {
    id,
    title: id,
    description: "Convert one file.",
    category: "conversion",
    inputSchema,
    outputSchema,
    ui: {
      fields: [{ id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".docx"] }],
      resultPreview: { kind: "markdown", pathFromOutput: "outputPath" },
    },
    permissions: [{ action: "fs.read.outside-userdata", pathFromInput: "inputPath" }],
    entryPoints: ["tools"],
    input: { extensions: [".docx"], kind: "file" },
    output: { kind: "markdown" },
    executor: async () => ({ markdown: "# Converted" }),
  }
}

describe("builtin tool registry", () => {
  it("lists the five initial atomic conversion tools", () => {
    expect(listBuiltinToolDescriptors().map((tool) => tool.id)).toEqual([
      "docx-to-markdown",
      "xlsx-to-markdown",
      "csv-to-markdown",
      "pdf-to-markdown",
      "pptx-to-markdown",
    ])
  })

  it("returns descriptors by id", () => {
    expect(getBuiltinToolDescriptor("docx-to-markdown")?.title).toBe("DOCX 转 Markdown")
    expect(getBuiltinToolDescriptor("missing")).toBeNull()
  })

  it("rejects duplicate ids in test registries", () => {
    expect(() => createBuiltinToolRegistryForTests([
      descriptor("same"),
      descriptor("same"),
    ])).toThrow("Duplicate builtin tool id: same")
  })

  it("projects descriptors without executable fields or zod schemas", () => {
    const projected = projectBuiltinToolDescriptor(descriptor("docx-to-markdown"))
    expect(projected).toMatchObject({
      id: "docx-to-markdown",
      title: "docx-to-markdown",
      category: "conversion",
      inputFields: [{ id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".docx"] }],
      outputPreview: { kind: "markdown", pathFromOutput: "outputPath" },
    })
    expect("executor" in projected).toBe(false)
    expect("inputSchema" in projected).toBe(false)
    expect("outputSchema" in projected).toBe(false)
  })

  it("finds tools by input extension and output kind", () => {
    const registry = createBuiltinToolRegistryForTests([
      descriptor("docx-to-markdown"),
      {
        ...descriptor("pdf-to-markdown"),
        input: { extensions: [".pdf"], kind: "file" },
      },
    ])
    expect(findBuiltinTools({ inputExtension: ".DOCX", outputKind: "markdown" }, registry).map((tool) => tool.id)).toEqual(["docx-to-markdown"])
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/builtin-tools/__tests__/registry.test.ts
```

Expected: FAIL because `desktop/electron/services/builtin-tools/registry.ts` does not exist.

- [ ] **Step 3: Add core types**

Create `desktop/electron/services/builtin-tools/types.ts`:

```ts
import type { PermissionAction } from "../../runtime/security"
import type { z } from "zod"

export type BuiltinToolId =
  | "docx-to-markdown"
  | "xlsx-to-markdown"
  | "csv-to-markdown"
  | "pdf-to-markdown"
  | "pptx-to-markdown"

export type BuiltinToolCategory = "conversion" | "content" | "utility"
export type BuiltinToolEntryPoint = "tools" | "workflow" | "automation" | "knowledge-base"
export type BuiltinToolOutputKind = "markdown" | "text" | "file"

export type BuiltinToolInputField =
  | {
      readonly id: string
      readonly kind: "file"
      readonly label: string
      readonly required?: boolean
      readonly extensions?: readonly string[]
    }
  | {
      readonly id: string
      readonly kind: "directory"
      readonly label: string
      readonly required?: boolean
      readonly when?: BuiltinToolFieldCondition
    }
  | {
      readonly id: string
      readonly kind: "text"
      readonly label: string
      readonly required?: boolean
      readonly defaultValue?: string
      readonly when?: BuiltinToolFieldCondition
    }
  | {
      readonly id: string
      readonly kind: "select"
      readonly label: string
      readonly required?: boolean
      readonly defaultValue?: string
      readonly options: readonly { readonly value: string; readonly label: string }[]
      readonly when?: BuiltinToolFieldCondition
    }
  | {
      readonly id: string
      readonly kind: "checkbox"
      readonly label: string
      readonly defaultValue?: boolean
      readonly when?: BuiltinToolFieldCondition
    }
  | {
      readonly id: string
      readonly kind: "number"
      readonly label: string
      readonly required?: boolean
      readonly defaultValue?: number
      readonly min?: number
      readonly max?: number
      readonly when?: BuiltinToolFieldCondition
    }

export interface BuiltinToolFieldCondition {
  readonly field: string
  readonly equals: string | number | boolean
}

export interface BuiltinToolUiDescriptor {
  readonly fields: readonly BuiltinToolInputField[]
  readonly resultPreview: BuiltinToolOutputPreviewDescriptor
}

export interface BuiltinToolOutputPreviewDescriptor {
  readonly kind: BuiltinToolOutputKind
  readonly pathFromOutput?: string
}

export interface BuiltinToolPermissionRequirement {
  readonly action: PermissionAction
  readonly pathFromInput: string
  readonly when?: Record<string, string | number | boolean>
}

export interface BuiltinToolInputDescriptor {
  readonly kind: "file"
  readonly extensions: readonly string[]
}

export interface BuiltinToolOutputDescriptor {
  readonly kind: BuiltinToolOutputKind
}

export interface BuiltinToolExecutionContext {
  readonly entryPoint: BuiltinToolEntryPoint
  readonly actor: { readonly kind: "user" } | { readonly kind: "system"; readonly id?: string }
  readonly runId?: string
  readonly abortSignal?: AbortSignal
}

export type BuiltinToolExecutor<Input, Output> = (
  input: Input,
  context: BuiltinToolExecutionContext,
) => Promise<Output>

export interface BuiltinToolDescriptor<Input = unknown, Output = unknown> {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category: BuiltinToolCategory
  readonly inputSchema: z.ZodType<Input>
  readonly outputSchema: z.ZodType<Output>
  readonly ui: BuiltinToolUiDescriptor
  readonly permissions: readonly BuiltinToolPermissionRequirement[]
  readonly entryPoints: readonly BuiltinToolEntryPoint[]
  readonly input: BuiltinToolInputDescriptor
  readonly output: BuiltinToolOutputDescriptor
  readonly executor: BuiltinToolExecutor<Input, Output>
}

export interface RendererBuiltinToolDescriptor {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category: BuiltinToolCategory
  readonly inputFields: readonly BuiltinToolInputField[]
  readonly outputPreview: BuiltinToolOutputPreviewDescriptor
  readonly input: BuiltinToolInputDescriptor
  readonly output: BuiltinToolOutputDescriptor
}

export interface BuiltinToolWarning {
  readonly code: string
  readonly message: string
}

export interface BuiltinToolErrorPayload {
  readonly code: BuiltinToolErrorCode
  readonly message: string
}

export type BuiltinToolErrorCode =
  | "unknown_tool"
  | "invalid_input"
  | "permission_denied"
  | "unsupported_input"
  | "read_failed"
  | "conversion_failed"
  | "write_failed"
  | "worker_failed"
  | "timeout"

export type BuiltinToolRunResult<Output = unknown> =
  | {
      readonly ok: true
      readonly toolId: string
      readonly output: Output
      readonly warnings: readonly BuiltinToolWarning[]
      readonly metadata: Record<string, unknown>
    }
  | {
      readonly ok: false
      readonly toolId: string
      readonly error: BuiltinToolErrorPayload
      readonly metadata: Record<string, unknown>
    }
```

- [ ] **Step 4: Add error helpers**

Create `desktop/electron/services/builtin-tools/errors.ts`:

```ts
import type { BuiltinToolErrorCode, BuiltinToolErrorPayload } from "./types"

export class BuiltinToolError extends Error {
  readonly code: BuiltinToolErrorCode

  constructor(code: BuiltinToolErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message)
    this.name = "BuiltinToolError"
    this.code = code
    if (options && "cause" in options) {
      this.cause = options.cause
    }
  }
}

export function toBuiltinToolErrorPayload(error: unknown): BuiltinToolErrorPayload {
  if (error instanceof BuiltinToolError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof Error) {
    return { code: "worker_failed", message: error.message }
  }
  return { code: "worker_failed", message: String(error) }
}
```

- [ ] **Step 5: Add registry with temporary imports**

Create `desktop/electron/services/builtin-tools/registry.ts`:

```ts
import type { BuiltinToolDescriptor, BuiltinToolOutputKind, RendererBuiltinToolDescriptor } from "./types"
import { docxToMarkdownTool } from "./tools/docx-to-markdown"
import { xlsxToMarkdownTool } from "./tools/xlsx-to-markdown"
import { csvToMarkdownTool } from "./tools/csv-to-markdown"
import { pdfToMarkdownTool } from "./tools/pdf-to-markdown"
import { pptxToMarkdownTool } from "./tools/pptx-to-markdown"

export interface BuiltinToolRegistry {
  readonly tools: readonly BuiltinToolDescriptor[]
  readonly byId: ReadonlyMap<string, BuiltinToolDescriptor>
}

const DEFAULT_REGISTRY = createBuiltinToolRegistry([
  docxToMarkdownTool,
  xlsxToMarkdownTool,
  csvToMarkdownTool,
  pdfToMarkdownTool,
  pptxToMarkdownTool,
])

export function listBuiltinToolDescriptors(registry: BuiltinToolRegistry = DEFAULT_REGISTRY): readonly BuiltinToolDescriptor[] {
  return registry.tools
}

export function getBuiltinToolDescriptor(toolId: string, registry: BuiltinToolRegistry = DEFAULT_REGISTRY): BuiltinToolDescriptor | null {
  return registry.byId.get(toolId) ?? null
}

export function requireBuiltinToolDescriptor(toolId: string, registry: BuiltinToolRegistry = DEFAULT_REGISTRY): BuiltinToolDescriptor {
  const descriptor = getBuiltinToolDescriptor(toolId, registry)
  if (!descriptor) {
    throw new Error(`Unknown builtin tool: ${toolId}`)
  }
  return descriptor
}

export function listRendererBuiltinToolDescriptors(registry: BuiltinToolRegistry = DEFAULT_REGISTRY): readonly RendererBuiltinToolDescriptor[] {
  return registry.tools.map(projectBuiltinToolDescriptor)
}

export function projectBuiltinToolDescriptor(descriptor: BuiltinToolDescriptor): RendererBuiltinToolDescriptor {
  return {
    id: descriptor.id,
    title: descriptor.title,
    description: descriptor.description,
    category: descriptor.category,
    inputFields: descriptor.ui.fields,
    outputPreview: descriptor.ui.resultPreview,
    input: descriptor.input,
    output: descriptor.output,
  }
}

export function findBuiltinTools(
  query: { readonly inputExtension: string; readonly outputKind: BuiltinToolOutputKind },
  registry: BuiltinToolRegistry = DEFAULT_REGISTRY,
): readonly BuiltinToolDescriptor[] {
  const normalizedExtension = query.inputExtension.toLowerCase()
  return registry.tools.filter((tool) =>
    tool.output.kind === query.outputKind &&
    tool.input.extensions.map((extension) => extension.toLowerCase()).includes(normalizedExtension),
  )
}

export function createBuiltinToolRegistryForTests(tools: readonly BuiltinToolDescriptor[]): BuiltinToolRegistry {
  return createBuiltinToolRegistry(tools)
}

function createBuiltinToolRegistry(tools: readonly BuiltinToolDescriptor[]): BuiltinToolRegistry {
  const byId = new Map<string, BuiltinToolDescriptor>()
  for (const tool of tools) {
    if (byId.has(tool.id)) {
      throw new Error(`Duplicate builtin tool id: ${tool.id}`)
    }
    byId.set(tool.id, tool)
  }
  return { tools: [...tools], byId }
}
```

- [ ] **Step 6: Add minimal tool folder stubs for registry compilation**

For each tool folder, add `index.ts`, `schema.ts`, `executor.ts`, and `descriptor.ts`. Use this exact `docx-to-markdown` stub first:

```ts
// desktop/electron/services/builtin-tools/tools/docx-to-markdown/schema.ts
import { z } from "zod"

export const docxToMarkdownInputSchema = z.object({
  inputPath: z.string().min(1),
  outputMode: z.enum(["return", "write-file"]).default("return"),
  outputDirectory: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
})

export const docxToMarkdownOutputSchema = z.object({
  markdown: z.string(),
  text: z.string(),
  sourcePath: z.string(),
  outputPath: z.string().optional(),
  assets: z.array(z.object({
    relativePath: z.string(),
    fileName: z.string(),
    mimeType: z.string(),
  })).optional(),
  metadata: z.record(z.string(), z.unknown()),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
})

export type DocxToMarkdownInput = z.infer<typeof docxToMarkdownInputSchema>
export type DocxToMarkdownOutput = z.infer<typeof docxToMarkdownOutputSchema>
```

```ts
// desktop/electron/services/builtin-tools/tools/docx-to-markdown/executor.ts
import type { BuiltinToolExecutionContext } from "../../types"
import type { DocxToMarkdownInput, DocxToMarkdownOutput } from "./schema"

export async function executeDocxToMarkdown(
  input: DocxToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<DocxToMarkdownOutput> {
  return {
    markdown: "",
    text: "",
    sourcePath: input.inputPath,
    metadata: {},
    warnings: [],
  }
}
```

```ts
// desktop/electron/services/builtin-tools/tools/docx-to-markdown/descriptor.ts
import type { BuiltinToolDescriptor } from "../../types"
import { executeDocxToMarkdown } from "./executor"
import { docxToMarkdownInputSchema, docxToMarkdownOutputSchema, type DocxToMarkdownInput, type DocxToMarkdownOutput } from "./schema"

export const docxToMarkdownTool: BuiltinToolDescriptor<DocxToMarkdownInput, DocxToMarkdownOutput> = {
  id: "docx-to-markdown",
  title: "DOCX 转 Markdown",
  description: "转换一个 DOCX 文件",
  category: "conversion",
  inputSchema: docxToMarkdownInputSchema,
  outputSchema: docxToMarkdownOutputSchema,
  ui: {
    fields: [
      { id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".docx"] },
      {
        id: "outputMode",
        kind: "select",
        label: "输出",
        required: true,
        defaultValue: "write-file",
        options: [
          { value: "write-file", label: "写入文件" },
          { value: "return", label: "仅返回结果" },
        ],
      },
      { id: "outputDirectory", kind: "directory", label: "输出目录", when: { field: "outputMode", equals: "write-file" } },
    ],
    resultPreview: { kind: "markdown", pathFromOutput: "outputPath" },
  },
  permissions: [
    { action: "fs.read.outside-userdata", pathFromInput: "inputPath" },
    { action: "fs.write", pathFromInput: "outputDirectory", when: { outputMode: "write-file" } },
  ],
  entryPoints: ["tools", "workflow", "automation"],
  input: { kind: "file", extensions: [".docx"] },
  output: { kind: "markdown" },
  executor: executeDocxToMarkdown,
}
```

```ts
// desktop/electron/services/builtin-tools/tools/docx-to-markdown/index.ts
export { docxToMarkdownTool } from "./descriptor"
```

Create the other four tool stubs by replacing ids, titles, schema/export names, and extensions:

| Tool folder | Extension | Title | Export |
| --- | --- | --- | --- |
| `xlsx-to-markdown` | `.xlsx` | `XLSX 转 Markdown` | `xlsxToMarkdownTool` |
| `csv-to-markdown` | `.csv` | `CSV 转 Markdown` | `csvToMarkdownTool` |
| `pdf-to-markdown` | `.pdf` | `PDF 转 Markdown` | `pdfToMarkdownTool` |
| `pptx-to-markdown` | `.pptx` | `PPTX 转 Markdown` | `pptxToMarkdownTool` |

- [ ] **Step 7: Run registry tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/builtin-tools/__tests__/registry.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add desktop/electron/services/builtin-tools
git commit -m "feat(tools): add builtin tool registry"
```

---

### Task 2: Add Permission Resolution And Main Runner Tests

**Files:**
- Create: `desktop/electron/services/builtin-tools/permissions.ts`
- Create: `desktop/electron/services/builtin-tools/runner.ts`
- Create: `desktop/electron/services/builtin-tools/__tests__/runner.test.ts`

- [ ] **Step 1: Write runner tests**

Create `desktop/electron/services/builtin-tools/__tests__/runner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { BuiltinToolError } from "../errors"
import { createBuiltinToolRegistryForTests } from "../registry"
import { resolveBuiltinToolPermissions } from "../permissions"
import { runBuiltinTool } from "../runner"
import type { BuiltinToolDescriptor } from "../types"
import type { AuditSink, PermissionGuard, PermissionResult } from "../../../runtime/security"

const inputSchema = z.object({
  inputPath: z.string().min(1),
  outputMode: z.enum(["return", "write-file"]),
  outputDirectory: z.string().optional(),
})

const outputSchema = z.object({
  markdown: z.string(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
})

function makeTool(overrides: Partial<BuiltinToolDescriptor<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>>> = {}) {
  return {
    id: "docx-to-markdown",
    title: "DOCX 转 Markdown",
    description: "转换一个 DOCX 文件",
    category: "conversion",
    inputSchema,
    outputSchema,
    ui: { fields: [], resultPreview: { kind: "markdown" } },
    permissions: [
      { action: "fs.read.outside-userdata", pathFromInput: "inputPath" },
      { action: "fs.write", pathFromInput: "outputDirectory", when: { outputMode: "write-file" } },
    ],
    entryPoints: ["tools"],
    input: { kind: "file", extensions: [".docx"] },
    output: { kind: "markdown" },
    executor: vi.fn(async () => ({ markdown: "# OK", warnings: [] })),
    ...overrides,
  } satisfies BuiltinToolDescriptor<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>>
}

describe("builtin tool runner", () => {
  it("resolves conditional permissions from validated input", () => {
    const permissions = resolveBuiltinToolPermissions(makeTool(), {
      inputPath: "/tmp/a.docx",
      outputMode: "write-file",
      outputDirectory: "/tmp/out",
    })
    expect(permissions).toEqual([
      { action: "fs.read.outside-userdata", resource: "/tmp/a.docx" },
      { action: "fs.write", resource: "/tmp/out" },
    ])
  })

  it("skips permissions whose condition does not match", () => {
    const permissions = resolveBuiltinToolPermissions(makeTool(), {
      inputPath: "/tmp/a.docx",
      outputMode: "return",
    })
    expect(permissions).toEqual([
      { action: "fs.read.outside-userdata", resource: "/tmp/a.docx" },
    ])
  })

  it("validates input before permission checks", async () => {
    const tool = makeTool()
    const permissionGuard = makePermissionGuard()
    const result = await runBuiltinTool({
      toolId: "docx-to-markdown",
      input: { inputPath: "", outputMode: "return" },
      context: { entryPoint: "tools", actor: { kind: "user" } },
      registry: createBuiltinToolRegistryForTests([tool]),
      permissionGuard,
      auditSink: makeAuditSink(),
      executeInWorker: vi.fn(),
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.error.code).toBe("invalid_input")
    expect(permissionGuard.check).not.toHaveBeenCalled()
  })

  it("checks permissions and runs through the worker", async () => {
    const executeInWorker = vi.fn(async () => ({ markdown: "# OK", warnings: [] }))
    const permissionGuard = makePermissionGuard()
    const auditSink = makeAuditSink()
    const result = await runBuiltinTool({
      toolId: "docx-to-markdown",
      input: { inputPath: "/tmp/a.docx", outputMode: "return" },
      context: { entryPoint: "tools", actor: { kind: "user" } },
      registry: createBuiltinToolRegistryForTests([makeTool()]),
      permissionGuard,
      auditSink,
      executeInWorker,
    })
    expect(result).toEqual({
      ok: true,
      toolId: "docx-to-markdown",
      output: { markdown: "# OK", warnings: [] },
      warnings: [],
      metadata: {},
    })
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/a.docx",
      context: { source: "tools.builtinTool.run", toolId: "docx-to-markdown", entryPoint: "tools" },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
    }))
    expect(executeInWorker).toHaveBeenCalledWith({
      toolId: "docx-to-markdown",
      input: { inputPath: "/tmp/a.docx", outputMode: "return" },
    })
  })

  it("returns permission_denied when a guard rejects access", async () => {
    const result = await runBuiltinTool({
      toolId: "docx-to-markdown",
      input: { inputPath: "/tmp/a.docx", outputMode: "return" },
      context: { entryPoint: "tools", actor: { kind: "user" } },
      registry: createBuiltinToolRegistryForTests([makeTool()]),
      permissionGuard: makePermissionGuard({ allowed: false, reason: "denied", policyId: "p1" }),
      auditSink: makeAuditSink(),
      executeInWorker: vi.fn(),
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.error).toEqual({ code: "permission_denied", message: "denied" })
  })

  it("normalizes worker errors", async () => {
    const result = await runBuiltinTool({
      toolId: "docx-to-markdown",
      input: { inputPath: "/tmp/a.docx", outputMode: "return" },
      context: { entryPoint: "tools", actor: { kind: "user" } },
      registry: createBuiltinToolRegistryForTests([makeTool()]),
      permissionGuard: makePermissionGuard(),
      auditSink: makeAuditSink(),
      executeInWorker: vi.fn(async () => {
        throw new BuiltinToolError("conversion_failed", "Parse failed.")
      }),
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.error).toEqual({ code: "conversion_failed", message: "Parse failed." })
  })
})

function makePermissionGuard(result: PermissionResult = { allowed: true }): PermissionGuard {
  return {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => result),
  }
}

function makeAuditSink(): AuditSink {
  return {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/builtin-tools/__tests__/runner.test.ts
```

Expected: FAIL because `permissions.ts` and `runner.ts` do not exist.

- [ ] **Step 3: Add permission resolver**

Create `desktop/electron/services/builtin-tools/permissions.ts`:

```ts
import type { PermissionAction } from "../../runtime/security"
import { BuiltinToolError } from "./errors"
import type { BuiltinToolDescriptor, BuiltinToolPermissionRequirement } from "./types"

export interface ResolvedBuiltinToolPermission {
  readonly action: PermissionAction
  readonly resource: string
}

export function resolveBuiltinToolPermissions(
  descriptor: BuiltinToolDescriptor,
  input: Record<string, unknown>,
): readonly ResolvedBuiltinToolPermission[] {
  return descriptor.permissions
    .filter((permission) => conditionMatches(permission, input))
    .map((permission) => ({
      action: permission.action,
      resource: stringFromPath(input, permission.pathFromInput, descriptor.id),
    }))
}

function conditionMatches(permission: BuiltinToolPermissionRequirement, input: Record<string, unknown>): boolean {
  if (!permission.when) return true
  return Object.entries(permission.when).every(([field, value]) => input[field] === value)
}

function stringFromPath(input: Record<string, unknown>, field: string, toolId: string): string {
  const value = input[field]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BuiltinToolError("invalid_input", `Permission path field "${field}" is missing for ${toolId}.`)
  }
  return value
}
```

- [ ] **Step 4: Add runner**

Create `desktop/electron/services/builtin-tools/runner.ts`:

```ts
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { BuiltinToolError, toBuiltinToolErrorPayload } from "./errors"
import { getBuiltinToolDescriptor, type BuiltinToolRegistry } from "./registry"
import { resolveBuiltinToolPermissions } from "./permissions"
import type { BuiltinToolExecutionContext, BuiltinToolRunResult } from "./types"
import { executeBuiltinToolInWorker } from "./worker-runner"

export interface BuiltinToolRunRequest {
  readonly toolId: string
  readonly input: unknown
  readonly context: BuiltinToolExecutionContext
  readonly registry?: BuiltinToolRegistry
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly executeInWorker?: (payload: { readonly toolId: string; readonly input: unknown }) => Promise<unknown>
}

export async function runBuiltinTool(request: BuiltinToolRunRequest): Promise<BuiltinToolRunResult> {
  const descriptor = getBuiltinToolDescriptor(request.toolId, request.registry)
  if (!descriptor) {
    return failure(request.toolId, new BuiltinToolError("unknown_tool", `Unknown builtin tool: ${request.toolId}`))
  }

  const parsedInput = descriptor.inputSchema.safeParse(request.input)
  if (!parsedInput.success) {
    return failure(descriptor.id, new BuiltinToolError("invalid_input", parsedInput.error.message))
  }

  try {
    const permissions = resolveBuiltinToolPermissions(descriptor, parsedInput.data as Record<string, unknown>)
    for (const permission of permissions) {
      const guardResult = await request.permissionGuard.check({
        action: permission.action,
        actor: request.context.actor,
        resource: permission.resource,
        context: {
          source: "tools.builtinTool.run",
          toolId: descriptor.id,
          entryPoint: request.context.entryPoint,
        },
      })
      request.auditSink.record({
        action: permission.action,
        actor: request.context.actor,
        resource: permission.resource,
        outcome: guardResult.allowed ? "allowed" : "denied",
        metadata: guardResult.allowed
          ? { source: "tools.builtinTool.run", toolId: descriptor.id, entryPoint: request.context.entryPoint }
          : {
              source: "tools.builtinTool.run",
              toolId: descriptor.id,
              entryPoint: request.context.entryPoint,
              reason: guardResult.reason,
              policyId: guardResult.policyId,
            },
      })
      if (!guardResult.allowed) {
        throw new BuiltinToolError("permission_denied", guardResult.reason)
      }
    }

    const execute = request.executeInWorker ?? executeBuiltinToolInWorker
    const rawOutput = await execute({ toolId: descriptor.id, input: parsedInput.data })
    const parsedOutput = descriptor.outputSchema.safeParse(rawOutput)
    if (!parsedOutput.success) {
      throw new BuiltinToolError("conversion_failed", parsedOutput.error.message)
    }
    return {
      ok: true,
      toolId: descriptor.id,
      output: parsedOutput.data,
      warnings: warningsFromOutput(parsedOutput.data),
      metadata: {},
    }
  } catch (error) {
    return failure(descriptor.id, error)
  }
}

function failure(toolId: string, error: unknown): BuiltinToolRunResult {
  return {
    ok: false,
    toolId,
    error: toBuiltinToolErrorPayload(error),
    metadata: {},
  }
}

function warningsFromOutput(output: unknown): readonly { readonly code: string; readonly message: string }[] {
  if (!output || typeof output !== "object" || !("warnings" in output)) return []
  const warnings = (output as { readonly warnings?: unknown }).warnings
  if (!Array.isArray(warnings)) return []
  return warnings.filter((warning): warning is { readonly code: string; readonly message: string } =>
    Boolean(warning) &&
    typeof warning === "object" &&
    typeof (warning as { readonly code?: unknown }).code === "string" &&
    typeof (warning as { readonly message?: unknown }).message === "string",
  )
}
```

- [ ] **Step 5: Add a temporary worker-runner shim for compilation**

Create `desktop/electron/services/builtin-tools/worker-runner.ts`:

```ts
export async function executeBuiltinToolInWorker(_payload: { readonly toolId: string; readonly input: unknown }): Promise<unknown> {
  throw new Error("Builtin tool worker is not registered yet.")
}
```

- [ ] **Step 6: Run runner and registry tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/builtin-tools/__tests__/registry.test.ts electron/services/builtin-tools/__tests__/runner.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add desktop/electron/services/builtin-tools
git commit -m "feat(tools): add builtin tool runner"
```

---

### Task 3: Implement Atomic Conversion Executors

**Files:**
- Modify: all `desktop/electron/services/builtin-tools/tools/*/{schema.ts,executor.ts,descriptor.ts}`
- Create: `desktop/electron/services/builtin-tools/tools/shared/file-to-markdown.ts`
- Create: `desktop/electron/services/builtin-tools/tools/csv-to-markdown/csv.ts`
- Test: `desktop/electron/services/builtin-tools/tools/*/__tests__/executor.test.ts`

- [ ] **Step 1: Add shared executor tests for extension rejection**

Create one test per tool. Example for `docx-to-markdown` at `desktop/electron/services/builtin-tools/tools/docx-to-markdown/__tests__/executor.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { BuiltinToolError } from "../../../errors"
import { executeDocxToMarkdown } from "../executor"

describe("docx-to-markdown executor", () => {
  it("rejects non-docx input", async () => {
    await expect(executeDocxToMarkdown({
      inputPath: "/tmp/source.pdf",
      outputMode: "return",
    }, { entryPoint: "tools", actor: { kind: "user" } })).rejects.toMatchObject({
      code: "unsupported_input",
    })
  })

  it("writes markdown output when outputMode is write-file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-docx-tool-"))
    const sourcePath = path.join(dir, "source.docx")
    const outputDirectory = path.join(dir, "out")
    await writeFile(sourcePath, "not a real docx")
    await mkdir(outputDirectory)

    await expect(executeDocxToMarkdown({
      inputPath: sourcePath,
      outputMode: "write-file",
      outputDirectory,
    }, { entryPoint: "tools", actor: { kind: "user" } })).rejects.toBeInstanceOf(BuiltinToolError)
  })
})
```

Use the same pattern for `xlsx`, `csv`, `pdf`, and `pptx`, changing the wrong extension and executor name. For `csv-to-markdown`, also add a positive CSV parsing test:

```ts
it("converts quoted csv values to a markdown table", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-csv-tool-"))
  const sourcePath = path.join(dir, "people.csv")
  await writeFile(sourcePath, "name,notes\nAlice,\"hello, world\"\nBob,\n")

  const result = await executeCsvToMarkdown({
    inputPath: sourcePath,
    outputMode: "return",
    maxRows: 100,
  }, { entryPoint: "tools", actor: { kind: "user" } })

  expect(result.markdown).toContain("| name | notes |")
  expect(result.markdown).toContain("| Alice | hello, world |")
  expect(result.markdown).toContain("| Bob |  |")
})
```

- [ ] **Step 2: Run executor tests and verify failures**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/builtin-tools/tools
```

Expected: FAIL because executors are stubs and CSV parser does not exist.

- [ ] **Step 3: Add shared file-to-markdown helper**

Create `desktop/electron/services/builtin-tools/tools/shared/file-to-markdown.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { FileConversionError, type FileConversionResult } from "../../../file-conversion"
import { resolveUniqueMarkdownOutputBundle, writeMarkdownOutputBundle } from "../../../tools/file-conversion-output"
import { BuiltinToolError } from "../../errors"

export interface FileToMarkdownBaseInput {
  readonly inputPath: string
  readonly outputMode: "return" | "write-file"
  readonly outputDirectory?: string
  readonly outputPath?: string
}

export interface MarkdownToolOutput {
  readonly markdown: string
  readonly text: string
  readonly sourcePath: string
  readonly outputPath?: string
  readonly assets?: readonly {
    readonly relativePath: string
    readonly fileName: string
    readonly mimeType: string
  }[]
  readonly metadata: Record<string, unknown>
  readonly warnings: readonly { readonly code: string; readonly message: string }[]
}

export function assertExtension(inputPath: string, extension: string): void {
  if (path.extname(inputPath).toLowerCase() !== extension) {
    throw new BuiltinToolError("unsupported_input", `Expected a ${extension} file.`)
  }
}

export async function outputFromConversionResult(
  input: FileToMarkdownBaseInput,
  result: FileConversionResult,
): Promise<MarkdownToolOutput> {
  if (input.outputMode !== "write-file") {
    return mapConversionResult(result)
  }

  if (input.outputPath) {
    await mkdir(path.dirname(input.outputPath), { recursive: true })
    await writeFile(input.outputPath, result.markdown)
    return { ...mapConversionResult(result), outputPath: input.outputPath }
  }

  if (!input.outputDirectory) {
    throw new BuiltinToolError("invalid_input", "outputDirectory is required when outputMode is write-file.")
  }

  const outputBundle = await resolveUniqueMarkdownOutputBundle(input.outputDirectory, input.inputPath, new Set())
  await writeMarkdownOutputBundle(outputBundle, result.markdown, result.assets ?? [])
  return { ...mapConversionResult(result), outputPath: outputBundle.markdownPath }
}

export function mapConversionError(error: unknown): BuiltinToolError {
  if (error instanceof BuiltinToolError) return error
  if (error instanceof FileConversionError) {
    if (error.code === "unsupported_format" || error.code === "missing_local_helper") {
      return new BuiltinToolError("unsupported_input", error.message, { cause: error })
    }
    if (error.code === "read_failed" || error.code === "size_limit_exceeded") {
      return new BuiltinToolError("read_failed", error.message, { cause: error })
    }
    return new BuiltinToolError("conversion_failed", error.message, { cause: error })
  }
  if (error instanceof Error) {
    return new BuiltinToolError("conversion_failed", error.message, { cause: error })
  }
  return new BuiltinToolError("conversion_failed", String(error))
}

function mapConversionResult(result: FileConversionResult): MarkdownToolOutput {
  return {
    markdown: result.markdown,
    text: result.text,
    sourcePath: result.sourcePath,
    assets: result.assets?.map((asset) => ({
      relativePath: asset.relativePath,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
    })),
    metadata: result.metadata,
    warnings: result.warnings,
  }
}
```

- [ ] **Step 4: Replace docx/xlsx/pdf/pptx executors**

Use this exact shape for `docx-to-markdown/executor.ts`:

```ts
import { createDefaultFileConversionService } from "../../../file-conversion"
import type { BuiltinToolExecutionContext } from "../../types"
import { assertExtension, mapConversionError, outputFromConversionResult } from "../shared/file-to-markdown"
import type { DocxToMarkdownInput, DocxToMarkdownOutput } from "./schema"

export async function executeDocxToMarkdown(
  input: DocxToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<DocxToMarkdownOutput> {
  assertExtension(input.inputPath, ".docx")
  try {
    const result = await createDefaultFileConversionService().convert({
      filePath: input.inputPath,
      preferredOutput: "markdown",
      imageHandling: { mode: "assets", assetDirectoryName: "assets" },
    })
    return outputFromConversionResult(input, result)
  } catch (error) {
    throw mapConversionError(error)
  }
}
```

Use the same shape for:

- `xlsx-to-markdown` with `.xlsx` and `executeXlsxToMarkdown`
- `pdf-to-markdown` with `.pdf` and `executePdfToMarkdown`
- `pptx-to-markdown` with `.pptx` and `executePptxToMarkdown`

- [ ] **Step 5: Add CSV parser and executor**

Create `desktop/electron/services/builtin-tools/tools/csv-to-markdown/csv.ts`:

```ts
export interface ParsedCsv {
  readonly rows: readonly (readonly string[])[]
  readonly truncated: boolean
}

export function parseCsv(input: string, options: { readonly delimiter: string; readonly maxRows: number }): ParsedCsv {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    const next = input[index + 1]
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\""
        index += 1
      } else if (char === "\"") {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === "\"") {
      quoted = true
      continue
    }
    if (char === options.delimiter) {
      row.push(cell)
      cell = ""
      continue
    }
    if (char === "\n") {
      row.push(cell.replace(/\r$/, ""))
      rows.push(row)
      if (rows.length >= options.maxRows) {
        return { rows, truncated: true }
      }
      row = []
      cell = ""
      continue
    }
    cell += char
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ""))
    rows.push(row)
  }

  return { rows, truncated: false }
}

export function csvRowsToMarkdown(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return ""
  const width = Math.max(...rows.map((row) => row.length))
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => escapeCell(row[index] ?? "")))
  const header = normalized[0]
  const body = normalized.slice(1)
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n")
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim()
}
```

Replace `csv-to-markdown/schema.ts` with input including CSV options:

```ts
import { z } from "zod"

export const csvToMarkdownInputSchema = z.object({
  inputPath: z.string().min(1),
  outputMode: z.enum(["return", "write-file"]).default("return"),
  outputDirectory: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
  delimiter: z.string().min(1).max(1).default(","),
  maxRows: z.number().int().positive().max(10000).default(1000),
})

export const csvToMarkdownOutputSchema = z.object({
  markdown: z.string(),
  text: z.string(),
  sourcePath: z.string(),
  outputPath: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
})

export type CsvToMarkdownInput = z.infer<typeof csvToMarkdownInputSchema>
export type CsvToMarkdownOutput = z.infer<typeof csvToMarkdownOutputSchema>
```

Replace `csv-to-markdown/executor.ts`:

```ts
import { readFile } from "node:fs/promises"

import type { BuiltinToolExecutionContext } from "../../types"
import { BuiltinToolError } from "../../errors"
import { assertExtension, outputFromConversionResult } from "../shared/file-to-markdown"
import { csvRowsToMarkdown, parseCsv } from "./csv"
import type { CsvToMarkdownInput, CsvToMarkdownOutput } from "./schema"

export async function executeCsvToMarkdown(
  input: CsvToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<CsvToMarkdownOutput> {
  assertExtension(input.inputPath, ".csv")
  let raw: string
  try {
    raw = await readFile(input.inputPath, "utf8")
  } catch (error) {
    throw new BuiltinToolError("read_failed", "Could not read CSV file.", { cause: error })
  }
  const parsed = parseCsv(raw, { delimiter: input.delimiter, maxRows: input.maxRows })
  const markdown = csvRowsToMarkdown(parsed.rows)
  const warnings = parsed.truncated ? [{ code: "truncated", message: "CSV rows were truncated by maxRows." }] : []
  return outputFromConversionResult(input, {
    sourcePath: input.inputPath,
    format: "xlsx",
    kind: "spreadsheet",
    title: input.inputPath,
    markdown,
    text: parsed.rows.map((row) => row.join("\t")).join("\n"),
    metadata: { rowCount: parsed.rows.length, delimiter: input.delimiter },
    warnings,
  })
}
```

- [ ] **Step 6: Update CSV descriptor fields**

Update `desktop/electron/services/builtin-tools/tools/csv-to-markdown/descriptor.ts` so `ui.fields` includes:

```ts
{ id: "delimiter", kind: "text", label: "分隔符", defaultValue: "," },
{ id: "maxRows", kind: "number", label: "最大行数", defaultValue: 1000, min: 1, max: 10000 },
```

- [ ] **Step 7: Run executor tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/builtin-tools/tools
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add desktop/electron/services/builtin-tools/tools
git commit -m "feat(tools): implement atomic conversion tools"
```

---

### Task 4: Add Builtin Tool Worker Boundary

**Files:**
- Modify: `desktop/electron/services/builtin-tools/worker-runner.ts`
- Create: `desktop/electron/services/builtin-tools/worker-execute.ts`
- Create: `desktop/electron/workers/builtin-tool-worker.ts`
- Create: `desktop/electron/worker-bootstraps/builtin-tool-worker-bootstrap.ts`
- Create: `desktop/electron/services/builtin-tools/__tests__/worker-runner.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/__tests__/registry.test.ts`

- [ ] **Step 1: Write worker runner tests**

Create `desktop/electron/services/builtin-tools/__tests__/worker-runner.test.ts`:

```ts
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { executeBuiltinToolInWorker, resolveBuiltinToolWorkerPath } from "../worker-runner"

describe("builtin tool worker runner", () => {
  it("resolves unpacked worker bootstrap inside app.asar", () => {
    const baseDir = path.join("/Applications/Synapse.app/Contents/Resources/app.asar/dist-electron/electron/services/builtin-tools")
    expect(resolveBuiltinToolWorkerPath(baseDir)).toContain("app.asar.unpacked")
    expect(resolveBuiltinToolWorkerPath(baseDir)).toContain("worker-bootstraps")
  })

  it("resolves source worker during development", () => {
    const baseDir = path.join("/repo/desktop/dist-electron/electron/services/builtin-tools")
    expect(resolveBuiltinToolWorkerPath(baseDir)).toBe(path.join(baseDir, "../../workers/builtin-tool-worker.js"))
  })

  it("returns worker success messages", async () => {
    const worker = fakeWorker()
    const resultPromise = executeBuiltinToolInWorker(
      { toolId: "docx-to-markdown", input: { inputPath: "/tmp/a.docx", outputMode: "return" } },
      { workerFactory: () => worker as never, timeoutMs: 1000 },
    )
    worker.emitMessage({ type: "success", output: { markdown: "# OK", warnings: [] } })
    await expect(resultPromise).resolves.toEqual({ markdown: "# OK", warnings: [] })
  })
})

function fakeWorker() {
  const listeners = new Map<string, (value: unknown) => void>()
  return {
    once: vi.fn((event: string, callback: (value: unknown) => void) => {
      listeners.set(event, callback)
      return undefined
    }),
    terminate: vi.fn(async () => undefined),
    emitMessage(value: unknown) {
      listeners.get("message")?.(value)
    },
  }
}
```

- [ ] **Step 2: Run worker test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/builtin-tools/__tests__/worker-runner.test.ts
```

Expected: FAIL because worker runner is still a shim.

- [ ] **Step 3: Implement worker-side execute helper**

Create `desktop/electron/services/builtin-tools/worker-execute.ts`:

```ts
import { BuiltinToolError } from "./errors"
import { getBuiltinToolDescriptor } from "./registry"
import type { BuiltinToolExecutionContext } from "./types"

export interface BuiltinToolWorkerPayload {
  readonly toolId: string
  readonly input: unknown
}

export async function executeBuiltinToolInCurrentThread(payload: BuiltinToolWorkerPayload): Promise<unknown> {
  const descriptor = getBuiltinToolDescriptor(payload.toolId)
  if (!descriptor) {
    throw new BuiltinToolError("unknown_tool", `Unknown builtin tool: ${payload.toolId}`)
  }
  const parsedInput = descriptor.inputSchema.safeParse(payload.input)
  if (!parsedInput.success) {
    throw new BuiltinToolError("invalid_input", parsedInput.error.message)
  }
  const context: BuiltinToolExecutionContext = {
    entryPoint: "tools",
    actor: { kind: "user" },
  }
  return descriptor.executor(parsedInput.data, context)
}
```

- [ ] **Step 4: Implement worker entry**

Create `desktop/electron/workers/builtin-tool-worker.ts`:

```ts
import { parentPort, workerData } from "node:worker_threads"

import { toBuiltinToolErrorPayload } from "../services/builtin-tools/errors"
import { executeBuiltinToolInCurrentThread } from "../services/builtin-tools/worker-execute"

void executeBuiltinToolInCurrentThread(workerData)
  .then((output) => {
    parentPort?.postMessage({ type: "success", output })
  })
  .catch((error: unknown) => {
    parentPort?.postMessage({ type: "error", error: toBuiltinToolErrorPayload(error) })
  })
```

Create `desktop/electron/worker-bootstraps/builtin-tool-worker-bootstrap.ts`:

```ts
import "../workers/builtin-tool-worker"
```

- [ ] **Step 5: Implement worker runner**

Replace `desktop/electron/services/builtin-tools/worker-runner.ts`:

```ts
import path from "node:path"
import { Worker } from "node:worker_threads"

import { BuiltinToolError } from "./errors"

type WorkerFactory = (workerPath: string, workerData: { readonly toolId: string; readonly input: unknown }) => Worker
const DEFAULT_TIMEOUT_MS = 300_000

export function executeBuiltinToolInWorker(
  payload: { readonly toolId: string; readonly input: unknown },
  options: { readonly workerFactory?: WorkerFactory; readonly timeoutMs?: number } = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const workerFactory = options.workerFactory ?? ((workerPath, workerData) => new Worker(workerPath, { workerData }))
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const worker = workerFactory(resolveBuiltinToolWorkerPath(__dirname), payload)
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate().catch(() => undefined)
      reject(new BuiltinToolError("timeout", `Builtin tool timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    worker.once("message", (message: { readonly type?: string; readonly output?: unknown; readonly error?: { readonly code?: string; readonly message?: string } }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (message.type === "success") {
        resolve(message.output)
        return
      }
      reject(new BuiltinToolError("worker_failed", message.error?.message || "Builtin tool worker failed."))
    })

    worker.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })

    worker.once("exit", (code) => {
      if (settled || code === 0) return
      settled = true
      clearTimeout(timer)
      reject(new BuiltinToolError("worker_failed", `Builtin tool worker exited with code ${code}`))
    })
  })
}

export function resolveBuiltinToolWorkerPath(baseDir: string): string {
  if (baseDir.includes("app.asar")) {
    const workerBaseDir = baseDir.replace(/([\\/])app\.asar(?=[\\/])/, "$1app.asar.unpacked")
    return path.join(workerBaseDir, "../../worker-bootstraps/builtin-tool-worker-bootstrap.js")
  }
  return path.join(baseDir, "../../workers/builtin-tool-worker.js")
}
```

- [ ] **Step 6: Register runner service**

In `desktop/electron/bootstrap/descriptors.ts`, replace the `tools.file-conversion-runner` descriptor with:

```ts
{
  id: "tools.builtin-tool-runner",
  factory: () => runBuiltinTool,
  dependsOn: [],
}
```

Import `runBuiltinTool` from `../services/builtin-tools/runner`. Update `desktop/electron/bootstrap/__tests__/registry.test.ts` expected ids from `tools.file-conversion-runner` to `tools.builtin-tool-runner`.

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/builtin-tools/__tests__/worker-runner.test.ts electron/bootstrap/__tests__/registry.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add desktop/electron/services/builtin-tools desktop/electron/workers/builtin-tool-worker.ts desktop/electron/worker-bootstraps/builtin-tool-worker-bootstrap.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/__tests__/registry.test.ts
git commit -m "feat(tools): run builtin tools in worker"
```

---

### Task 5: Replace Tools IPC And Preload Bridge

**Files:**
- Modify: `desktop/src/types/tools.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/modules/tools/ipc.ts`
- Modify: `desktop/electron/modules/tools/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`

- [ ] **Step 1: Rewrite IPC tests**

Replace tools IPC tests in `desktop/electron/modules/tools/__tests__/ipc.test.ts` with expectations for:

```ts
it("lists atomic builtin tools", async () => {
  const { harness } = createHarness()
  const result = await harness.invoke("synapse:tools:list", {}) as { tools: Array<{ id: string }> }
  expect(result.tools.map((tool) => tool.id)).toEqual([
    "docx-to-markdown",
    "xlsx-to-markdown",
    "csv-to-markdown",
    "pdf-to-markdown",
    "pptx-to-markdown",
  ])
})

it("opens an atomic tool through the window service", async () => {
  const windowService = { open: vi.fn(async () => undefined) }
  const { harness } = createHarness({ windowService })
  await harness.invoke("synapse:tools:open", { toolId: "docx-to-markdown" })
  expect(windowService.open).toHaveBeenCalledWith("docx-to-markdown")
})

it("returns a renderer-safe descriptor", async () => {
  const { harness } = createHarness()
  const result = await harness.invoke("synapse:tools:descriptor", { toolId: "csv-to-markdown" }) as Record<string, unknown>
  expect(result.id).toBe("csv-to-markdown")
  expect(result.inputFields).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "inputPath", kind: "file" }),
    expect.objectContaining({ id: "delimiter", kind: "text" }),
  ]))
  expect("executor" in result).toBe(false)
})

it("runs a builtin tool through the runner service", async () => {
  const runTool = vi.fn(async () => ({ ok: true, toolId: "docx-to-markdown", output: { markdown: "# OK" }, warnings: [], metadata: {} }))
  const { harness } = createHarness({ runTool })
  const result = await harness.invoke("synapse:tools:run", {
    toolId: "docx-to-markdown",
    input: { inputPath: "/tmp/a.docx", outputMode: "return" },
  })
  expect(result).toMatchObject({ ok: true, toolId: "docx-to-markdown" })
  expect(runTool).toHaveBeenCalledWith(expect.objectContaining({
    toolId: "docx-to-markdown",
    input: { inputPath: "/tmp/a.docx", outputMode: "return" },
  }))
})
```

Keep dialog tests but rename channels to:

- `synapse:tools:select-file`
- `synapse:tools:select-directory`

The file dialog test must call:

```ts
await harness.invoke("synapse:tools:select-file", { toolId: "docx-to-markdown", fieldId: "inputPath" })
```

Expected filter:

```ts
filters: [{ name: "支持的文件", extensions: ["docx"] }]
```

- [ ] **Step 2: Run IPC tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/tools/__tests__/ipc.test.ts
```

Expected: FAIL because IPC still exposes file-conversion-specific channels.

- [ ] **Step 3: Replace public tool types**

Update `desktop/src/types/tools.ts` to export:

```ts
export type SynapseToolId =
  | "docx-to-markdown"
  | "xlsx-to-markdown"
  | "csv-to-markdown"
  | "pdf-to-markdown"
  | "pptx-to-markdown"

export type SynapseToolCategory = "conversion" | "content" | "utility"
export type SynapseToolOutputKind = "markdown" | "text" | "file"

export type SynapseToolInputField =
  | { readonly id: string; readonly kind: "file"; readonly label: string; readonly required?: boolean; readonly extensions?: readonly string[] }
  | { readonly id: string; readonly kind: "directory"; readonly label: string; readonly required?: boolean; readonly when?: SynapseToolFieldCondition }
  | { readonly id: string; readonly kind: "text"; readonly label: string; readonly required?: boolean; readonly defaultValue?: string; readonly when?: SynapseToolFieldCondition }
  | { readonly id: string; readonly kind: "select"; readonly label: string; readonly required?: boolean; readonly defaultValue?: string; readonly options: readonly { readonly value: string; readonly label: string }[]; readonly when?: SynapseToolFieldCondition }
  | { readonly id: string; readonly kind: "checkbox"; readonly label: string; readonly defaultValue?: boolean; readonly when?: SynapseToolFieldCondition }
  | { readonly id: string; readonly kind: "number"; readonly label: string; readonly required?: boolean; readonly defaultValue?: number; readonly min?: number; readonly max?: number; readonly when?: SynapseToolFieldCondition }

export interface SynapseToolFieldCondition {
  readonly field: string
  readonly equals: string | number | boolean
}

export interface SynapseToolOutputPreviewDescriptor {
  readonly kind: SynapseToolOutputKind
  readonly pathFromOutput?: string
}

export interface SynapseToolDefinition {
  readonly id: SynapseToolId
  readonly title: string
  readonly description: string
  readonly category: SynapseToolCategory
  readonly inputFields: readonly SynapseToolInputField[]
  readonly outputPreview: SynapseToolOutputPreviewDescriptor
  readonly input: { readonly kind: "file"; readonly extensions: readonly string[] }
  readonly output: { readonly kind: SynapseToolOutputKind }
}

export interface SynapseToolsListResult {
  readonly tools: readonly SynapseToolDefinition[]
}

export interface SynapseToolOpenPayload {
  readonly toolId: SynapseToolId
}

export interface SynapseToolRunPayload {
  readonly toolId: SynapseToolId
  readonly input: Record<string, unknown>
}

export type SynapseToolRunResult =
  | {
      readonly ok: true
      readonly toolId: SynapseToolId
      readonly output: Record<string, unknown>
      readonly warnings: readonly { readonly code: string; readonly message: string }[]
      readonly metadata: Record<string, unknown>
    }
  | {
      readonly ok: false
      readonly toolId: SynapseToolId
      readonly error: { readonly code: string; readonly message: string }
      readonly metadata: Record<string, unknown>
    }

export interface SynapseToolFileSelectionPayload {
  readonly toolId: SynapseToolId
  readonly fieldId: string
}

export interface SynapseToolFileSelectionResult {
  readonly filePath: string | null
}

export interface SynapseToolDirectorySelectionPayload {
  readonly toolId: SynapseToolId
  readonly fieldId: string
  readonly defaultPath?: string
}

export interface SynapseToolDirectorySelectionResult {
  readonly directoryPath: string | null
}
```

- [ ] **Step 4: Replace tools IPC implementation**

Update `desktop/electron/modules/tools/ipc.ts`:

- `listTools` returns `{ tools: listRendererBuiltinToolDescriptors() }`.
- `openTool` validates `toolId` by checking `getBuiltinToolDescriptor(toolId)`.
- `getToolDescriptor` channel is `synapse:tools:descriptor`.
- `runTool` channel is `synapse:tools:run`.
- `selectFile` channel is `synapse:tools:select-file`.
- `selectDirectory` channel is `synapse:tools:select-directory`.

The `runTool` handler must resolve:

```ts
const runTool = ctx.resolve<typeof runBuiltinTool>("tools.builtin-tool-runner")
return runTool({
  toolId: request.toolId,
  input: request.input,
  context: { entryPoint: "tools", actor: { kind: "user" } },
  permissionGuard: ctx.resolve("core.permission-guard"),
  auditSink: ctx.resolve("core.audit-sink"),
})
```

- [ ] **Step 5: Update preload bridge**

In `desktop/electron/preload.ts`, replace file conversion channels with:

```ts
"getToolDescriptor": "synapse:tools:descriptor",
"runTool": "synapse:tools:run",
"selectFile": "synapse:tools:select-file",
"selectDirectory": "synapse:tools:select-directory",
```

Replace `tools.fileConversion` bridge with:

```ts
tools: {
  listTools: () => invoke(IPC_CHANNELS.tools.listTools)({}),
  openTool: (toolId) => invoke(IPC_CHANNELS.tools.openTool)({ toolId }),
  getToolDescriptor: (toolId) => invoke(IPC_CHANNELS.tools.getToolDescriptor)({ toolId }),
  runTool: (payload) => invoke(IPC_CHANNELS.tools.runTool)(payload),
  selectFile: (payload) => invoke(IPC_CHANNELS.tools.selectFile)(payload),
  selectDirectory: (payload) => invoke(IPC_CHANNELS.tools.selectDirectory)(payload),
  filePathForDroppedFile: (file) => pathForFile(file),
}
```

Update `desktop/src/types/bridge.ts` to match the same shape.

- [ ] **Step 6: Regenerate IPC channels**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` updates with the new generic channels.

- [ ] **Step 7: Run IPC tests and typecheck focused files**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/tools/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS or only renderer failures from the old File Conversion window still importing removed bridge fields. Renderer failures are resolved in Task 6.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add desktop/src/types/tools.ts desktop/src/types/bridge.ts desktop/electron/modules/tools/ipc.ts desktop/electron/modules/tools/__tests__/ipc.test.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat(tools): expose generic builtin tool ipc"
```

---

### Task 6: Replace Tools Renderer With Descriptor-Driven UI

**Files:**
- Modify: `desktop/src/modules/tools/index.tsx`
- Create: `desktop/src/modules/tools/builtin-tools/shared/tool-window.tsx`
- Create: `desktop/src/modules/tools/builtin-tools/shared/generated-tool-form.tsx`
- Create: `desktop/src/modules/tools/builtin-tools/shared/generated-tool-result.tsx`
- Create: `desktop/src/modules/tools/builtin-tools/shared/path-utils.ts`
- Create: `desktop/src/modules/tools/builtin-tools/__tests__/tool-window.test.tsx`
- Modify: `desktop/src/modules/tools/__tests__/tools-module.test.tsx`
- Modify: `desktop/src/main.tsx`
- Delete: `desktop/src/modules/tools/file-conversion/file-conversion-window.tsx`
- Delete: `desktop/src/modules/tools/file-conversion/utils.ts`
- Delete: `desktop/src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx`

- [ ] **Step 1: Update ToolsModule test**

Update `desktop/src/modules/tools/__tests__/tools-module.test.tsx` mock data:

```ts
tools: [{
  id: "docx-to-markdown",
  title: "DOCX 转 Markdown",
  description: "转换一个 DOCX 文件",
  category: "conversion",
  inputFields: [{ id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".docx"] }],
  outputPreview: { kind: "markdown", pathFromOutput: "outputPath" },
  input: { kind: "file", extensions: [".docx"] },
  output: { kind: "markdown" },
}]
```

Change assertions:

```ts
expect(document.body.textContent).toContain("DOCX 转 Markdown")
buttonByLabel("打开 DOCX 转 Markdown").click()
expect(bridgeMocks.tools.openTool).toHaveBeenCalledWith("docx-to-markdown")
```

- [ ] **Step 2: Add generated tool window test**

Create `desktop/src/modules/tools/builtin-tools/__tests__/tool-window.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BuiltinToolWindow } from "../shared/tool-window"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []
let bridgeMocks: ReturnType<typeof createBridgeMocks>

beforeEach(() => {
  bridgeMocks = createBridgeMocks()
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: bridgeMocks,
  })
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("BuiltinToolWindow", () => {
  it("renders descriptor fields and runs the tool", async () => {
    await renderWindow("docx-to-markdown")
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("DOCX 转 Markdown")
    })

    await act(async () => {
      buttonByText("选择文件").click()
      await Promise.resolve()
    })
    await act(async () => {
      buttonByText("运行").click()
      await Promise.resolve()
    })

    expect(bridgeMocks.tools.selectFile).toHaveBeenCalledWith({ toolId: "docx-to-markdown", fieldId: "inputPath" })
    expect(bridgeMocks.tools.runTool).toHaveBeenCalledWith({
      toolId: "docx-to-markdown",
      input: expect.objectContaining({ inputPath: "/tmp/a.docx" }),
    })
    await waitForExpectation(() => {
      expect(document.body.textContent).toContain("完成")
    })
  })
})

async function renderWindow(toolId: string): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<BuiltinToolWindow toolId={toolId} />)
    await Promise.resolve()
  })
}

function createBridgeMocks() {
  return {
    tools: {
      getToolDescriptor: vi.fn(async () => ({
        id: "docx-to-markdown",
        title: "DOCX 转 Markdown",
        description: "转换一个 DOCX 文件",
        category: "conversion",
        inputFields: [
          { id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".docx"] },
          {
            id: "outputMode",
            kind: "select",
            label: "输出",
            required: true,
            defaultValue: "return",
            options: [
              { value: "return", label: "仅返回结果" },
              { value: "write-file", label: "写入文件" },
            ],
          },
        ],
        outputPreview: { kind: "markdown", pathFromOutput: "outputPath" },
        input: { kind: "file", extensions: [".docx"] },
        output: { kind: "markdown" },
      })),
      selectFile: vi.fn(async () => ({ filePath: "/tmp/a.docx" })),
      selectDirectory: vi.fn(async () => ({ directoryPath: "/tmp/out" })),
      runTool: vi.fn(async () => ({
        ok: true,
        toolId: "docx-to-markdown",
        output: { markdown: "# OK", warnings: [], metadata: {}, sourcePath: "/tmp/a.docx" },
        warnings: [],
        metadata: {},
      })),
    },
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`)
  return button
}

async function waitForExpectation(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }
  throw lastError
}
```

- [ ] **Step 3: Run renderer tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/tools
```

Expected: FAIL because generated UI files do not exist and ToolsModule still expects `label`.

- [ ] **Step 4: Update ToolsModule**

In `desktop/src/modules/tools/index.tsx`:

- Replace `tool.label` with `tool.title`.
- Replace `ItemDescription` with `tool.description`.
- Keep the current shadcn `Item`, `Button`, and lucide icon structure.
- Update aria label to `打开 ${tool.title}`.
- Keep no extra explanatory product copy.

- [ ] **Step 5: Add generated form**

Create `desktop/src/modules/tools/builtin-tools/shared/generated-tool-form.tsx`:

```tsx
import { FileText, FolderOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SynapseToolDefinition, SynapseToolInputField } from "@/types/tools"

export function GeneratedToolForm(props: {
  readonly tool: SynapseToolDefinition
  readonly values: Record<string, unknown>
  readonly disabled?: boolean
  readonly onChange: (fieldId: string, value: unknown) => void
  readonly onSelectFile: (fieldId: string) => void
  readonly onSelectDirectory: (fieldId: string) => void
}) {
  return (
    <div className="grid gap-3">
      {props.tool.inputFields.filter((field) => fieldVisible(field, props.values)).map((field) => (
        <div key={field.id} className="grid gap-1.5">
          <Label htmlFor={field.id}>{field.label}</Label>
          <FieldControl
            field={field}
            value={props.values[field.id]}
            disabled={props.disabled}
            onChange={(value) => props.onChange(field.id, value)}
            onSelectFile={() => props.onSelectFile(field.id)}
            onSelectDirectory={() => props.onSelectDirectory(field.id)}
          />
        </div>
      ))}
    </div>
  )
}

function FieldControl(props: {
  readonly field: SynapseToolInputField
  readonly value: unknown
  readonly disabled?: boolean
  readonly onChange: (value: unknown) => void
  readonly onSelectFile: () => void
  readonly onSelectDirectory: () => void
}) {
  if (props.field.kind === "file") {
    return (
      <div className="flex items-center gap-2">
        <Input id={props.field.id} value={typeof props.value === "string" ? props.value : ""} readOnly />
        <Button type="button" variant="outline" disabled={props.disabled} onClick={props.onSelectFile}>
          <FileText data-icon="inline-start" />
          选择文件
        </Button>
      </div>
    )
  }
  if (props.field.kind === "directory") {
    return (
      <div className="flex items-center gap-2">
        <Input id={props.field.id} value={typeof props.value === "string" ? props.value : ""} readOnly />
        <Button type="button" variant="outline" disabled={props.disabled} onClick={props.onSelectDirectory}>
          <FolderOpen data-icon="inline-start" />
          选择目录
        </Button>
      </div>
    )
  }
  if (props.field.kind === "select") {
    return (
      <select
        id={props.field.id}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        disabled={props.disabled}
        value={typeof props.value === "string" ? props.value : props.field.defaultValue ?? ""}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.field.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    )
  }
  if (props.field.kind === "checkbox") {
    return (
      <input
        id={props.field.id}
        type="checkbox"
        className="h-4 w-4"
        disabled={props.disabled}
        checked={Boolean(props.value ?? props.field.defaultValue)}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    )
  }
  if (props.field.kind === "number") {
    return (
      <Input
        id={props.field.id}
        type="number"
        disabled={props.disabled}
        value={typeof props.value === "number" ? props.value : props.field.defaultValue ?? ""}
        min={props.field.min}
        max={props.field.max}
        onChange={(event) => props.onChange(event.target.value === "" ? "" : Number(event.target.value))}
      />
    )
  }
  return (
    <Input
      id={props.field.id}
      disabled={props.disabled}
      value={typeof props.value === "string" ? props.value : props.field.defaultValue ?? ""}
      onChange={(event) => props.onChange(event.target.value)}
    />
  )
}

function fieldVisible(field: SynapseToolInputField, values: Record<string, unknown>): boolean {
  if (!("when" in field) || !field.when) return true
  return values[field.when.field] === field.when.equals
}
```

- [ ] **Step 6: Add result and window components**

Create `generated-tool-result.tsx`:

```tsx
import { CheckCircle2, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"

export function GeneratedToolResult(props: { readonly result: unknown }) {
  const result = props.result as { readonly ok?: boolean; readonly output?: Record<string, unknown>; readonly error?: { readonly message?: string } }
  if (result.ok === true) {
    const outputPath = typeof result.output?.outputPath === "string" ? result.output.outputPath : null
    return (
      <div className="grid gap-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 />
          完成
          <Badge variant="secondary">成功</Badge>
        </div>
        {outputPath ? <p className="truncate text-sm text-muted-foreground" title={outputPath}>{outputPath}</p> : null}
      </div>
    )
  }
  if (result.ok === false) {
    return (
      <div className="grid gap-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <XCircle />
          失败
          <Badge variant="destructive">错误</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{result.error?.message ?? "运行失败"}</p>
      </div>
    )
  }
  return null
}
```

Create `tool-window.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { SynapseToolDefinition } from "@/types/tools"
import { GeneratedToolForm } from "./generated-tool-form"
import { GeneratedToolResult } from "./generated-tool-result"

export function BuiltinToolWindow(props: { readonly toolId: string }) {
  const [tool, setTool] = useState<SynapseToolDefinition | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<unknown>(null)

  useEffect(() => {
    let canceled = false
    void requireBridgeDomain("tools").getToolDescriptor(props.toolId).then((descriptor) => {
      if (canceled) return
      setTool(descriptor)
      setValues(defaultValues(descriptor))
    }).catch(() => {
      if (!canceled) toast.error("读取工具失败")
    })
    return () => {
      canceled = true
    }
  }, [props.toolId])

  const canRun = useMemo(() => {
    if (!tool || running) return false
    return tool.inputFields.every((field) => {
      if (!field.required) return true
      const value = values[field.id]
      return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null
    })
  }, [running, tool, values])

  async function selectFile(fieldId: string): Promise<void> {
    const selection = await requireBridgeDomain("tools").selectFile({ toolId: props.toolId, fieldId })
    if (selection.filePath) {
      setValues((current) => ({ ...current, [fieldId]: selection.filePath }))
      setResult(null)
    }
  }

  async function selectDirectory(fieldId: string): Promise<void> {
    const selection = await requireBridgeDomain("tools").selectDirectory({ toolId: props.toolId, fieldId })
    if (selection.directoryPath) {
      setValues((current) => ({ ...current, [fieldId]: selection.directoryPath }))
      setResult(null)
    }
  }

  async function run(): Promise<void> {
    if (!canRun) return
    setRunning(true)
    try {
      const nextResult = await requireBridgeDomain("tools").runTool({ toolId: props.toolId, input: values })
      setResult(nextResult)
      toast.success(nextResult.ok ? "运行完成" : "运行失败")
    } catch {
      toast.error("运行失败")
    } finally {
      setRunning(false)
    }
  }

  if (!tool) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">读取中</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ScrollArea className="min-h-0 flex-1">
        <main className="grid gap-3 p-3">
          <Card size="sm">
            <CardHeader>
              <CardTitle>{tool.title}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <GeneratedToolForm
                tool={tool}
                values={values}
                disabled={running}
                onChange={(fieldId, value) => {
                  setValues((current) => ({ ...current, [fieldId]: value }))
                  setResult(null)
                }}
                onSelectFile={(fieldId) => void selectFile(fieldId)}
                onSelectDirectory={(fieldId) => void selectDirectory(fieldId)}
              />
              <Button type="button" disabled={!canRun} onClick={() => void run()}>
                {running ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
                运行
              </Button>
            </CardContent>
          </Card>
          {result ? <GeneratedToolResult result={result} /> : null}
        </main>
      </ScrollArea>
    </div>
  )
}

function defaultValues(tool: SynapseToolDefinition): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of tool.inputFields) {
    if ("defaultValue" in field && field.defaultValue !== undefined) {
      values[field.id] = field.defaultValue
    }
  }
  return values
}
```

- [ ] **Step 7: Update main tool window route**

In `desktop/src/main.tsx`, replace dynamic import of `FileConversionWindow` with:

```ts
const { BuiltinToolWindow } = await import("@/modules/tools/builtin-tools/shared/tool-window")
```

Render:

```tsx
<BuiltinToolWindow toolId={toolId} />
```

- [ ] **Step 8: Delete old file conversion renderer files**

Delete:

```bash
git rm desktop/src/modules/tools/file-conversion/file-conversion-window.tsx
git rm desktop/src/modules/tools/file-conversion/utils.ts
git rm desktop/src/modules/tools/file-conversion/__tests__/file-conversion-window.test.tsx
```

- [ ] **Step 9: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/tools
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit Task 6**

Run:

```bash
git add desktop/src/modules/tools desktop/src/main.tsx desktop/src/types/tools.ts desktop/src/types/bridge.ts
git commit -m "feat(tools): render descriptor driven tool windows"
```

---

### Task 7: Remove Legacy File Conversion Tool Runner

**Files:**
- Modify: `desktop/electron/services/tools/tool-registry.ts`
- Modify: `desktop/electron/services/tools/tool-window-service.ts`
- Delete: `desktop/electron/services/tools/file-conversion-runner.ts`
- Delete: `desktop/electron/services/tools/file-conversion-types.ts`
- Delete: `desktop/electron/services/tools/__tests__/file-conversion-runner.test.ts`
- Delete: `desktop/electron/services/tools/__tests__/file-conversion-runner.test.ts`
- Delete: `desktop/electron/workers/file-conversion-worker.ts`
- Delete: `desktop/electron/worker-bootstraps/file-conversion-worker-bootstrap.ts`

- [ ] **Step 1: Update tool window service tests if present**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/tools/__tests__/tool-window-service.test.ts electron/services/tools/__tests__/tool-registry.test.ts
```

Expected: some assertions may still expect `file-conversion`.

- [ ] **Step 2: Make tool registry project builtin descriptors**

Replace `desktop/electron/services/tools/tool-registry.ts` content with:

```ts
import type { SynapseToolDefinition, SynapseToolId } from "../../../src/types/tools"
import { listRendererBuiltinToolDescriptors } from "../builtin-tools/registry"

const DEFAULT_BOUNDS = {
  width: 760,
  height: 560,
  minWidth: 560,
  minHeight: 420,
} as const

export function listToolDefinitions(): readonly SynapseToolDefinition[] {
  return listRendererBuiltinToolDescriptors() as readonly SynapseToolDefinition[]
}

export function getToolDefinition(toolId: string): (SynapseToolDefinition & { readonly bounds: typeof DEFAULT_BOUNDS; readonly windowTitle: string }) | null {
  const tool = listToolDefinitions().find((definition) => definition.id === toolId)
  if (!tool) return null
  return { ...tool, bounds: DEFAULT_BOUNDS, windowTitle: tool.title }
}

export function requireToolDefinition(toolId: string): SynapseToolDefinition & { readonly bounds: typeof DEFAULT_BOUNDS; readonly windowTitle: string } {
  const tool = getToolDefinition(toolId)
  if (!tool) {
    throw new Error(`Unknown tool: ${toolId}`)
  }
  return tool
}

export function isSynapseToolId(toolId: string): toolId is SynapseToolId {
  return getToolDefinition(toolId) !== null
}
```

- [ ] **Step 3: Remove legacy runner files**

Run:

```bash
git rm desktop/electron/services/tools/file-conversion-runner.ts
git rm desktop/electron/services/tools/file-conversion-types.ts
git rm desktop/electron/services/tools/__tests__/file-conversion-runner.test.ts
git rm desktop/electron/workers/file-conversion-worker.ts
git rm desktop/electron/worker-bootstraps/file-conversion-worker-bootstrap.ts
```

- [ ] **Step 4: Search for legacy references**

Run:

```bash
rg -n "file-conversion-runner|fileConversion|synapse:tools:file-conversion|file-conversion-worker|ToolsFileConversion|file-conversion\"" desktop/electron desktop/src
```

Expected: no references except workflow node paths such as `desktop/workflow-nodes/file-conversion`, shared parser service paths such as `desktop/electron/services/file-conversion`, and historical docs/tests that are not compiled.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/tools electron/modules/tools src/modules/tools
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

Run:

```bash
git add desktop/electron/services/tools desktop/electron/workers desktop/electron/worker-bootstraps desktop/electron/modules/tools desktop/src/modules/tools
git commit -m "refactor(tools): remove legacy file conversion tool"
```

---

### Task 8: Final Verification, Release Notes, And Compatibility Checks

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`
- Verify: `desktop/workflow-nodes/file-conversion/*`
- Verify: `desktop/electron/services/file-conversion/*`

- [ ] **Step 1: Add release note**

Add a concise user-facing entry to `RELEASE_NOTES_PENDING.md`:

```md
- 工具页里的文件转换拆成了更专注的内置工具，DOCX、XLSX、CSV、PDF、PPTX 转 Markdown 可以分别打开和运行，后续工作流与自动化也能复用同一套工具入口。
```

- [ ] **Step 2: Verify Workflow compatibility**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/workflow/__tests__/file-conversion-node.test.ts src/modules/workflow/editor/__tests__/file-conversion-node-config.test.tsx
```

Expected: PASS. Existing `file_conversion` workflow node still works.

- [ ] **Step 3: Verify builtin tools and Tools UI**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/builtin-tools electron/modules/tools src/modules/tools
```

Expected: PASS.

- [ ] **Step 4: Verify IPC codegen and hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:ipc-codegen
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS. No new naked `ipcMain.handle/on`, no renderer direct Electron access, and generated IPC is current.

- [ ] **Step 5: Run full desktop validation**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
rg -n "plugin market|third-party plugin|synapse:tools:file-conversion|tools.fileConversion|file-conversion-runner" desktop/electron desktop/src docs/superpowers/specs/2026-06-04-builtin-tools-atomization-design.md
```

Expected:

- `git status --short` shows only intended files.
- `git diff --stat HEAD` matches the planned tool refactor and release note.
- `rg` finds no product-code references to removed file-conversion-specific Tools APIs.
- The spec may still contain third-party/plugin terms only in Non-Goals.

- [ ] **Step 7: Commit Task 8**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note atomic builtin tools"
```

---

## Self-Review Notes

- Spec coverage: The plan covers atomic builtin tools, tool-first folders, TypeScript descriptors, generic runner, permission/audit, worker boundary, Tools UI, IPC migration, Workflow compatibility, Knowledge Base non-change, tests, and release notes.
- Scope boundary: Plugin installation, plugin market, external code loading, and Knowledge Base auto-conversion are explicitly outside this implementation.
- Type consistency: Public renderer types use `SynapseTool*`; Electron core types use `BuiltinTool*`; ids are the same five atomic tool ids.
- Risk: The generated form uses a native `select` in the first pass. If the existing UI library already has a select primitive available and the implementation agent prefers it, it may use the shadcn/Radix component while keeping the same field semantics and tests.
