# Builtin Tools Atomization Design

## Summary

Rework the current Tools module from one broad File Conversion tool into a Synapse-owned builtin atomic tools platform.

The first implementation slice splits file conversion into focused builtin tools:

- `docx-to-markdown`
- `xlsx-to-markdown`
- `csv-to-markdown`
- `pdf-to-markdown`
- `pptx-to-markdown`

Each tool owns its descriptor, schema, executor, tests, and optional renderer pieces inside its own folder. The system does not support third-party plugin installation, plugin markets, or external tool loading in this design.

## Goals

- Make each tool focus on one capability.
- Make tool input, output, permissions, and UI configuration described by a single TypeScript descriptor.
- Keep builtin tools easy to call from Tools, Workflow, Automation, and future Knowledge Base ingestion flows.
- Replace broad file-conversion-specific IPC and runner shapes with a generic builtin tool registry and runner.
- Reuse existing deterministic file conversion code where it is still useful.
- Add `csv-to-markdown` as the first small new atomic conversion tool.
- Keep code organized by tool first, not by technical layer first.

## Non-Goals

- No third-party plugin installation.
- No plugin market.
- No loading external JavaScript, shell scripts, or tool bundles.
- No user-authored tool registration.
- No online parsing, online OCR, or online vision APIs.
- No large visual redesign of the Tools module.
- No automatic Knowledge Base upload conversion in the first implementation slice.
- No complete Workflow node migration in the first implementation slice unless explicitly included by the implementation plan.

## Hard Rules

- Tool execution must not block the Electron main process.
- Renderer code can only call privileged behavior through `window.synapse.*`.
- Main-process IPC must use the existing `IpcRegistry` boundary.
- File reads and output writes must pass permission checks and audit records before execution.
- Worker-side execution must still validate source paths, output paths, and supported formats.
- A tool descriptor is the source of truth for tool metadata, input schema, output schema, UI fields, supported entry points, and permission needs.
- Tool folders are the primary ownership boundary. Do not create global `descriptors/`, `executors/`, or `schemas/` folders that scatter one tool across technical categories.
- Shared code is allowed only when it is genuinely shared by multiple tools, such as registry, runner, common conversion helpers, form rendering primitives, and output writers.
- Existing Knowledge Base upload remains raw file copy until a separate task explicitly changes it.
- UI must follow the current shadcn/Radix and Tailwind token rules.

## Current Context

The current Tools surface has a single `file-conversion` tool. Its registry metadata is hardcoded, its IPC channels are file-conversion-specific, and its worker payload/result types are tied to batch file conversion.

There is already a shared `desktop/electron/services/file-conversion/` service with extractors for document, spreadsheet, PDF, image, and presentation conversion. Workflow currently calls that shared service directly through a hardcoded `file_conversion` workflow node.

This design keeps the useful parser/extractor code but moves the product-level tool model to atomic builtin tools.

## Directory Layout

The builtin tools service should be organized by tool first:

```text
desktop/electron/services/builtin-tools/
  types.ts
  registry.ts
  runner.ts
  errors.ts
  permissions.ts
  tools/
    docx-to-markdown/
      descriptor.ts
      executor.ts
      schema.ts
      index.ts
      __tests__/
    xlsx-to-markdown/
      descriptor.ts
      executor.ts
      schema.ts
      index.ts
      __tests__/
    csv-to-markdown/
      descriptor.ts
      executor.ts
      schema.ts
      index.ts
      __tests__/
    pdf-to-markdown/
      descriptor.ts
      executor.ts
      schema.ts
      index.ts
      __tests__/
    pptx-to-markdown/
      descriptor.ts
      executor.ts
      schema.ts
      index.ts
      __tests__/
```

Renderer code should follow the same ownership principle when tool-specific UI is needed:

```text
desktop/src/modules/tools/
  builtin-tools/
    shared/
      generated-tool-form.tsx
      generated-tool-result.tsx
      tool-window.tsx
    tools/
      docx-to-markdown/
        form.tsx
        result.tsx
      xlsx-to-markdown/
        form.tsx
        result.tsx
      csv-to-markdown/
        form.tsx
        result.tsx
      pdf-to-markdown/
        form.tsx
        result.tsx
      pptx-to-markdown/
        form.tsx
        result.tsx
```

If a tool can use the shared generated form and result view without custom UI, its renderer folder can be omitted.

## Tool Descriptor

Each builtin tool exports a TypeScript descriptor from its `descriptor.ts`.

Example shape:

```ts
export interface BuiltinToolDescriptor<Input, Output> {
  readonly id: BuiltinToolId
  readonly title: string
  readonly description: string
  readonly category: "conversion" | "content" | "utility"
  readonly inputSchema: z.ZodType<Input>
  readonly outputSchema: z.ZodType<Output>
  readonly ui: BuiltinToolUiDescriptor
  readonly permissions: readonly BuiltinToolPermissionRequirement[]
  readonly entryPoints: readonly BuiltinToolEntryPoint[]
  readonly executor: BuiltinToolExecutor<Input, Output>
}
```

The descriptor lives with the tool. The registry only imports tool `index.ts` files and validates that every tool has a unique id.

Initial ids:

```ts
export type BuiltinToolId =
  | "docx-to-markdown"
  | "xlsx-to-markdown"
  | "csv-to-markdown"
  | "pdf-to-markdown"
  | "pptx-to-markdown"
```

## Input And Output Model

The first slice should standardize conversion tools around a small common file-to-markdown shape while still allowing each tool to own its schema.

Common input fields:

```ts
export interface FileToMarkdownInput {
  readonly inputPath: string
  readonly outputMode: "return" | "write-file"
  readonly outputDirectory?: string
  readonly outputPath?: string
}
```

Tool-specific options stay inside each tool. Examples:

- `csv-to-markdown`: delimiter, encoding, maxRows.
- `xlsx-to-markdown`: sheet selection, maxRowsPerSheet.
- `pdf-to-markdown`: page range, OCR options only if current local OCR support is retained for PDFs.
- `docx-to-markdown`: image handling.
- `pptx-to-markdown`: include speaker notes if supported by existing parser.

Common successful output:

```ts
export interface MarkdownConversionOutput {
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
  readonly warnings: readonly {
    readonly code: string
    readonly message: string
  }[]
}
```

The runner wraps executor output in a common envelope:

```ts
export type BuiltinToolRunResult<Output> =
  | {
      readonly ok: true
      readonly toolId: BuiltinToolId
      readonly output: Output
      readonly warnings: readonly BuiltinToolWarning[]
      readonly metadata: Record<string, unknown>
    }
  | {
      readonly ok: false
      readonly toolId: BuiltinToolId
      readonly error: BuiltinToolErrorPayload
      readonly metadata: Record<string, unknown>
    }
```

## Runner

All entry points call the same runner:

```ts
runBuiltinTool({
  toolId,
  input,
  context,
})
```

Responsibilities:

1. Resolve the descriptor.
2. Validate input with the descriptor schema.
3. Check permissions declared by the descriptor.
4. Record audit events.
5. Execute through a worker boundary for long-running tools.
6. Validate output with the descriptor schema.
7. Normalize errors into the common error envelope.

The runner must not contain per-format conversion logic. Per-format behavior belongs inside the tool folder.

## Worker Boundary

The existing file conversion worker can be replaced or generalized into a builtin tool worker.

The main process supervises execution and handles permission checks. The worker receives:

```ts
{
  toolId: BuiltinToolId
  input: unknown
}
```

The worker revalidates:

- tool id exists
- input matches schema
- source path is a file
- output path stays inside the selected output directory when writing
- extension matches the atomic tool

Batch conversion should move out of the executor. Atomic tools convert one input file per run. Batch behavior, if needed by the Tools UI later, should call the same atomic runner repeatedly and aggregate results outside the tool executor.

## Builtin Tool Implementations

### `docx-to-markdown`

Accepts one `.docx` file. Uses the existing docx extractor and markdown normalization. Writes one Markdown output when `outputMode` is `write-file`.

### `xlsx-to-markdown`

Accepts one `.xlsx` file. Uses the existing spreadsheet extractor. Supports sheet-related options only if they are already practical with the current extractor; otherwise the first slice converts all sheets with existing limits.

### `csv-to-markdown`

Accepts one `.csv` file. Uses a local parser or conservative built-in CSV parsing if no dependency is needed. Converts rows to a Markdown table with a size limit and warnings when truncated.

### `pdf-to-markdown`

Accepts one `.pdf` file. Uses the existing PDF extractor. Scanned/OCR-heavy behavior should stay behind explicit options and existing local-only constraints.

### `pptx-to-markdown`

Accepts one `.pptx` file. Uses the existing presentation extractor. Preserves slide boundaries.

## Tools UI

The Tools landing page lists atomic builtin tools, not one broad File Conversion tool.

Each item shows:

- tool title
- short description
- supported extension or primary input type
- open action

Tool windows should use a shared descriptor-driven window by default. The generated UI supports a small initial field set:

- file picker
- directory picker
- text input
- select
- checkbox
- number input

The generated UI should be plain and operational. It should not include implementation notes, roadmap text, or plugin language.

For the first implementation slice, each conversion tool window can share the same layout:

1. Input file
2. Output mode
3. Output directory or output path when writing
4. Tool-specific options
5. Run button
6. Current result

## IPC

Replace file-conversion-specific IPC with generic builtin tool APIs:

```ts
tools.listTools()
tools.openTool({ toolId })
tools.getToolDescriptor({ toolId })
tools.runTool({ toolId, input })
tools.selectFile({ toolId, fieldId })
tools.selectDirectory({ toolId, fieldId })
```

The returned descriptor must be renderer-safe. It should include metadata and UI field descriptions, not executable functions or raw zod objects.

Example renderer-safe descriptor:

```ts
export interface RendererBuiltinToolDescriptor {
  readonly id: BuiltinToolId
  readonly title: string
  readonly description: string
  readonly category: string
  readonly inputFields: readonly BuiltinToolInputField[]
  readonly outputPreview: BuiltinToolOutputPreviewDescriptor
}
```

## Workflow And Automation Integration

Workflow and Automation should call builtin tools through the same runner rather than importing file conversion services directly.

The first slice may keep the existing `file_conversion` workflow node working for compatibility. A later migration can add a generic `builtin_tool` node or replace the file conversion node with atomic tool selection.

Compatibility rule:

- Existing workflows using `file_conversion` must continue to run until an explicit migration is implemented.
- New atomic tool descriptors should declare `entryPoints: ["tools", "workflow", "automation"]` only when their input and output schemas are stable enough for those callers.

## Knowledge Base Integration

Knowledge Base upload behavior does not change in this design.

The builtin tool registry should make future Knowledge Base integration straightforward by supporting lookup by source extension and output type:

```ts
findBuiltinTools({
  inputExtension: ".docx",
  outputKind: "markdown",
})
```

When a future task enables Knowledge Base conversion, it should call atomic tools explicitly and continue respecting the Knowledge Base raw file manager rules.

## Error Handling

Use structured error codes:

```ts
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
```

UI messages should be short. Detailed diagnostics belong in structured logs.

## Permission And Audit

Descriptors declare permission needs in a data form:

```ts
permissions: [
  { action: "fs.read.outside-userdata", pathFromInput: "inputPath" },
  { action: "fs.write", pathFromInput: "outputDirectory", when: { outputMode: "write-file" } },
]
```

The runner resolves these declarations after input validation and before execution. The worker still validates paths for defense in depth.

Audit records include:

- tool id
- entry point
- operation
- permission outcome
- source count, usually one for atomic tools
- sanitized path identity following existing audit conventions

## Migration Plan

1. Add builtin tool core types, registry, runner, and renderer-safe descriptor projection.
2. Move the existing Tools registry to read from builtin tool descriptors.
3. Add atomic conversion tool folders.
4. Implement `docx-to-markdown`, `xlsx-to-markdown`, `pdf-to-markdown`, and `pptx-to-markdown` as wrappers around existing extractors.
5. Implement `csv-to-markdown`.
6. Replace the current File Conversion tool window with the shared descriptor-driven tool window.
7. Replace file-conversion-specific IPC with generic builtin tool IPC while preserving compatibility only where needed during the migration.
8. Keep the existing `desktop/electron/services/file-conversion/` code as shared parser infrastructure.
9. Add tests for descriptor validation, registry uniqueness, runner error normalization, permission declaration resolution, each atomic executor, and renderer descriptor projection.

## Testing

Unit tests:

- registry rejects duplicate ids
- registry lists all five initial tools
- descriptor projection strips executable fields
- runner rejects unknown tool ids
- runner validates input before permission checks
- runner normalizes executor failures
- permission declarations resolve correct input paths
- each atomic tool rejects the wrong extension
- each atomic tool converts a fixture successfully
- `csv-to-markdown` handles quoted values, commas, empty cells, and truncation warnings

Renderer tests:

- Tools page lists atomic tools
- generated form renders descriptor fields
- run button is disabled until required fields are present
- run result shows success and failure states

Workflow compatibility tests:

- existing `file_conversion` node behavior remains unchanged until explicitly migrated

Hard constraint checks:

- no new naked `ipcMain.handle/on`
- no renderer direct Electron access
- no empty catches
- no main-process long-running conversion

