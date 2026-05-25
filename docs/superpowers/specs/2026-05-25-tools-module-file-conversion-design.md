# Tools Module And File Conversion Tool Design

## Summary

Add a new top-level **Tools** module to Synapse. Tools is a product surface for small, focused utilities that run in independent windows. The first tool is **File Conversion**, which converts selected local files to Markdown and writes the converted files to a user-selected output directory.

This design also moves the product ownership of file conversion out of Knowledge Base. Knowledge Base upload remains simple file copying. File conversion stays a shared Electron service, and the Tools module becomes the user-facing entry point for ad hoc conversion.

## Goals

- Add a top-level `工具` tab next to existing modules such as `定时` and `工作流`.
- Add a Tools landing page that lists available tools.
- Add a renderer and Electron tool registry so future tools can be added without duplicating window-opening code.
- Add a generic tool window service that opens or focuses independent tool windows by `toolId`.
- Add a File Conversion tool window.
- Support selecting input files and selecting an output directory.
- Convert `.docx`, `.xlsx`, `.pdf`, and `.pptx` to Markdown `.md`.
- Write output files using the source basename, with collision-safe `-2`, `-3` suffixes.
- Ensure tool execution does not block the Electron main process.
- Keep Knowledge Base upload behavior as simple file copy.

## Non-Goals

- No tool run history.
- No recent output list.
- No general tool task scheduler.
- No parameter schema platform for all future tools in the first slice.
- No Knowledge Base `.raw` integration.
- No automatic conversion during Knowledge Base upload.
- No `.doc`, `.ppt`, or image OCR support in the File Conversion tool UI.
- No custom UI theme, custom colors, or standalone visual system.

## Hard Rules

- Tool execution must not block the Electron main process.
- Main-process IPC handlers must not synchronously parse or convert large files.
- Long-running conversion work must run behind a worker or child-process boundary.
- The main process may validate requests, check permission, open dialogs, create windows, and supervise workers.
- Worker-side code must still validate input and output paths.
- Unknown `toolId` values must be rejected in both renderer-visible APIs and main-process window routing.
- Knowledge Base upload remains raw file copy and must not call the Tools file conversion flow.
- The shared `desktop/electron/services/file-conversion/` service must not import Tools or Knowledge Base modules.
- Renderer code must access privileged behavior only through `window.synapse.*`.
- UI must follow the current shadcn/Radix and Tailwind token rules from `AGENTS.md`.

## User Experience

The main app gains a `工具` tab. The first version shows a compact tool list with one entry:

- `文件转换`

Clicking the entry opens an independent File Conversion window. Re-clicking the same tool focuses the existing tool window instead of opening duplicates.

The File Conversion window contains:

- A file selection area.
- An output directory selection area.
- A convert action.
- A current-result area for this conversion only.

The convert action is disabled until at least one supported input file and one output directory are selected.

The result area shows:

- Progress while converting.
- Success and failure counts when complete.
- Failed file names with short reasons.
- An action to open the output directory.

The window does not show Knowledge Base terminology, `.raw`, ingest, or source-management language.

## Supported Conversion Behavior

Supported input extensions:

- `.docx`
- `.xlsx`
- `.pdf`
- `.pptx`

Output:

- Markdown only.
- One `.md` file per input file.
- Output filename is the source basename with `.md`.
- Name collisions are resolved with numeric suffixes:
  - `report.md`
  - `report-2.md`
  - `report-3.md`

Warnings from conversion do not fail the file. The first slice may show a compact warning count per successful file, but it should not build a detailed diagnostics surface.

## Architecture

### Renderer Modules

Add:

```text
desktop/src/modules/tools/
  index.tsx
  registry.ts
  file-conversion/
    file-conversion-window.tsx
    types.ts
    utils.ts
```

`index.tsx` renders the top-level Tools page.

`registry.ts` defines renderer-visible tool metadata for the landing page. It should contain only product-facing metadata and the `toolId`. Privileged window opening still goes through Electron IPC.

`file-conversion/file-conversion-window.tsx` renders the independent tool window.

Update `desktop/src/App.tsx`:

- Add `tools` to `AppTabId`.
- Add a `工具` navigation tab.
- Render `ToolsModule` when active.

Update `desktop/src/main.tsx`:

- Add a `window=tool` branch.
- Route by `toolId`.
- Load the File Conversion tool window for `toolId=file-conversion`.
- Reject unknown tools by rendering an error boundary-friendly fallback or throwing a controlled error.

### Electron Modules

Add:

```text
desktop/electron/modules/tools/
  ipc.ts
```

The Tools IPC module exposes:

- `tools.listTools()`
- `tools.openTool({ toolId })`
- `tools.fileConversion.selectInputFiles()`
- `tools.fileConversion.selectOutputDirectory()`
- `tools.fileConversion.convert({ filePaths, outputDirectory })`
- Optional current-run progress events for the active window.

The IPC module must use `IpcRegistry`, zod schemas, `PermissionGuard`, and `AuditSink`.

### Electron Services

Add:

```text
desktop/electron/services/tools/
  tool-registry.ts
  tool-window-service.ts
  file-conversion-runner.ts
```

`tool-registry.ts` contains main-process tool definitions:

- `id`
- `label`
- `windowTitle`
- default bounds
- route metadata

`tool-window-service.ts` opens or focuses tool windows. It owns BrowserWindow creation for all tools. It builds renderer URLs with:

```text
window=tool
toolId=file-conversion
```

`file-conversion-runner.ts` supervises conversion execution. It must not run parser work directly in the main process. It starts a worker or child process, forwards progress, enforces timeout/cancellation boundaries if included in the first implementation, and returns structured results.

### Worker Boundary

Add a worker entry such as:

```text
desktop/electron/workers/file-conversion-worker.ts
```

The worker imports and uses the existing shared service:

```text
desktop/electron/services/file-conversion/
```

The worker receives validated input, revalidates paths, converts files one by one, writes Markdown outputs, and returns structured results.

The worker must continue after per-file failures. A batch should only fail as a whole if the worker cannot start, crashes, is terminated, or the request itself is invalid.

## Data Flow

1. User opens the `工具` tab.
2. Renderer calls `tools.listTools()`.
3. User clicks `文件转换`.
4. Renderer calls `tools.openTool({ toolId: "file-conversion" })`.
5. Main process opens or focuses the generic tool window.
6. File Conversion window loads with `window=tool&toolId=file-conversion`.
7. User selects files through `selectInputFiles()`.
8. User selects an output directory through `selectOutputDirectory()`.
9. User starts conversion through `convert()`.
10. Main process validates extensions and permissions.
11. Main process starts the conversion worker through `file-conversion-runner`.
12. Worker converts each file and writes Markdown outputs.
13. Worker returns per-file results.
14. Tool window displays the current result.

## Permission And Audit

Selecting files and output directories uses native dialogs in Electron.

Before conversion starts, the main process checks:

- Read permission for selected input files.
- Write permission for the selected output directory.

Audit records should include:

- Tool id.
- Operation name.
- Number of input files.
- Output directory identity in a privacy-conscious form if current audit conventions require sanitization.
- Allowed, denied, and failed outcomes.

The worker should not rely only on renderer-provided paths. It must check that each source is a file and that output paths remain inside the selected output directory.

## Error Handling

Per-file failures return structured entries:

- unsupported format
- read failed
- conversion failed
- write failed
- output collision resolution failed

Batch-level failures include:

- worker failed to start
- worker crashed
- worker timed out
- invalid request
- permission denied

The UI should show concise user-facing messages. Detailed diagnostics belong in structured logs, not UI paragraphs.

## Relationship To Knowledge Base

Knowledge Base remains separate:

- The source manager uploads raw files by copying them into the managed runtime.
- It does not call the Tools conversion API.
- It does not show File Conversion UI inside Knowledge Base.
- Existing Knowledge Base staging and file conversion integration can be revisited in a later task, but this design does not change it.

The shared file conversion service remains independent and reusable by both current and future consumers, but product flows choose explicitly whether to call it.

## Tests

Add focused tests for:

- Tool registry returns only known tools.
- Unknown tool ids are rejected.
- `openTool(file-conversion)` delegates to the generic window service.
- Generic tool window service focuses an existing window on repeated open.
- Generic tool window service builds `window=tool&toolId=file-conversion`.
- File Conversion IPC validates supported extensions.
- File Conversion IPC performs permission and audit checks.
- File Conversion runner does not call the converter in the main process.
- Worker converts `.docx`, `.xlsx`, `.pdf`, and `.pptx` fixtures to `.md`.
- Output naming resolves collisions with `-2` and `-3`.
- Per-file conversion failure does not stop the batch.
- Worker crash or timeout returns a batch-level failure.
- Tools tab renders in `App`.
- Tools page lists `文件转换`.
- File Conversion window disables conversion until files and output directory are selected.
- Existing Knowledge Base source manager tests continue to prove upload is simple copy.

## Implementation Notes

- Reuse existing shadcn primitives in `desktop/src/components/ui/`.
- Prefer existing renderer logger and notification helpers.
- Do not add new dependencies unless the worker boundary requires a project-approved helper. Prefer Electron or Node built-ins first.
- Keep the first File Conversion UI simple and local to `desktop/src/modules/tools/file-conversion/`.
- Do not introduce a generic run-history storage schema in this slice.

## Success Criteria

- Users can open a `工具` top-level tab.
- Users can open File Conversion in an independent window.
- Users can convert supported files to Markdown in a chosen output directory.
- Output filenames are collision-safe.
- Conversion work does not block the main process.
- Knowledge Base upload remains simple file copy.
- Focused tests pass.
