# Document Template App Capability Design

Date: 2026-06-23

## Context

Synapse already has three separate extension surfaces that this feature touches:

- System Apps are registered through `desktop/src/modules/apps` and can run embedded or in a detached system app window.
- MCP capabilities are defined in `desktop/synapse-capabilities/shared/*-domain.ts`, mapped to tool names, and dispatched through Electron main-process capability dispatchers.
- Workflow nodes are defined under `desktop/workflow-nodes/*` and registered through the node type registry.

The new feature is a system app named `document-template`. It generates a Word `.docx` file from a `.docx` template and JSON data. The same capability must be callable from the app UI, MCP, and a Workflow node. The long-term design goal is not only this app, but a repeatable architecture for future apps that also provide MCP tools and Workflow nodes.

## Goals

- Add a new system app: `document-template`.
- Generate `.docx` files from a local `.docx` template and JSON data.
- Support JSON from either a local `.json` file path or an inline object.
- Write the generated document to a required local `outputPath`.
- Reject overwriting existing output files unless `overwrite: true` is provided.
- Add a new canonical capability action: `generate`.
- Add the MCP capability `app.document_template.docx.generate`.
- Add the MCP tool `app_document_template_docx_generate`.
- Add a Workflow node backed by the same core generation service.
- Establish an App Capability Package file layout for future app-centered capabilities.
- Update `AGENTS.md` so future app capabilities follow this architecture.

## Non-Goals

- Do not implement PDF, Excel, PowerPoint, preview, validation-only, or Drive upload in the first version.
- Do not add business-specific JSON enrichment such as dates, indexes, or field rewriting.
- Do not make the app infer output paths automatically in the first version.
- Do not expose a generic multi-format `app_document_template_generate` tool.
- Do not build a full automatic plugin loader for app capabilities in the first version.
- Do not store templates, generated documents, or JSON payload history in Synapse-managed storage.

## Architecture

Use an App Capability Package centered on the capability, not on a page or transport.

```text
desktop/app-capabilities/
└─ document-template/
   ├─ shared/
   │  ├─ schema.ts
   │  ├─ capability.ts
   │  └─ manifest.ts
   │
   ├─ main/
   │  ├─ service.ts
   │  ├─ dispatcher.ts
   │  └─ ipc.ts
   │
   ├─ renderer/
   │  ├─ app-definition.ts
   │  ├─ app-manifest.ts
   │  └─ index.tsx
   │
   └─ workflow-node/
      ├─ schema.ts
      ├─ manifest.ts
      ├─ executor.main.ts
      ├─ panel.tsx
      └─ card.tsx
```

The package has one core service and multiple adapters:

```text
App UI
MCP Tool
Workflow Node
   │
   ▼
document-template/main/service.ts
   │
   ▼
local output.docx
```

The adapters may validate transport-specific concerns, but they must not duplicate `.docx` rendering logic. All `.docx` template rendering, path validation, overwrite behavior, JSON loading, and result shape live behind the main service.

## Capability Naming

The new domain is a layered app domain:

```text
app.<app_namespace>.<format_or_subdomain>.<action>
```

For this feature:

| Item | Value |
| --- | --- |
| System app id | `document-template` |
| Capability id | `app.document_template.docx.generate` |
| MCP tool | `app_document_template_docx_generate` |
| Workflow node type | `document_template_docx_generate` |
| Action | `generate` |

The `.docx` layer is intentional. It keeps the application namespace separate from the concrete file format so future capabilities can be added without turning one MCP tool into a large multi-format switch:

```text
app.document_template.docx.generate
app.document_template.docx.validate
app.document_template.pdf.generate
app.report_builder.docx.generate
```

## Core API

The shared schema should describe the same semantic input for IPC, MCP, and Workflow:

```ts
type GenerateDocxInput = {
  templatePath: string
  outputPath: string
  dataPath?: string
  data?: Record<string, unknown>
  overwrite?: boolean
}

type GenerateDocxResult = {
  outputPath: string
  fileName: string
  size: number
  generatedAt: string
}
```

Validation rules:

- `templatePath` is required and must point to a local `.docx` file.
- `outputPath` is required and should end in `.docx`.
- Exactly one of `dataPath` or `data` must be provided.
- `dataPath`, when provided, must point to a local `.json` file containing a JSON object.
- `data`, when provided, must be a JSON object.
- If `outputPath` exists and `overwrite !== true`, generation fails.
- Parent directory for `outputPath` must exist.
- JSON is passed to the template engine as-is. No automatic date, index, or business-field enrichment is performed.

## Dependencies

Add runtime dependencies to `@synapse/desktop`:

- `docxtemplater`
- `pizzip`

The renderer must not load these libraries directly. `.docx` generation runs in Electron main process through the package service because it reads and writes local files.

## App UI

The first UI is a system app with a compact tool layout:

```text
从模板生成 Word 文档
├─ Word 模板文件    [选择文件]
├─ JSON 文件        [选择文件]
├─ 输出文件         [选择位置]
├─ 覆盖已存在文件   [开关]
└─ [生成]
```

UI constraints:

- Use existing shadcn/Radix components and theme tokens.
- Do not use custom colors, inline styles, decorative gradients, or marketing copy.
- Do not paste business explanations into the UI.
- Keep labels necessary and direct.
- UI file pickers call typed preload IPC. Renderer does not access Node filesystem APIs.

The UI can support inline JSON editing later, but the first app UI only needs file selection for template, JSON, and output path. The core service and MCP support inline JSON from day one.

## MCP

Add the `app` capability domain to the shared capability registry. The first capability is:

| Capability id | MCP tool | Mutates | Purpose |
| --- | --- | --- | --- |
| `app.document_template.docx.generate` | `app_document_template_docx_generate` | true | Generate a local `.docx` file from a `.docx` template and JSON data. |

Tool input:

```ts
{
  templatePath: string
  outputPath: string
  dataPath?: string
  data?: Record<string, unknown>
  overwrite?: boolean
}
```

Tool output:

```ts
{
  outputPath: string
  fileName: string
  size: number
  generatedAt: string
}
```

The dispatcher calls the same package service used by IPC and Workflow.

Safety:

- Treat this tool as mutating because it writes a local file.
- Require filesystem write permission for `outputPath`.
- Do not include full JSON data in logs or audit metadata.
- Log path metadata and result size only.
- Sanitize template engine errors before returning them to MCP clients.

## Workflow Node

Add a node type:

```text
document_template_docx_generate
```

Config fields:

```text
templatePath     text
outputPath       text
dataSource       select: dataPath | inline
dataPath         text, shown when dataSource=dataPath
data             record or JSON text, shown when dataSource=inline
overwrite        boolean
variables        variable-binding-list
```

Execution:

```text
resolve workflow variables
   │
   ▼
build GenerateDocxInput
   │
   ▼
call document-template main service
   │
   ▼
return outputs
```

Node result outputs:

```ts
{
  outputPath: string
  fileName: string
  size: number
  generatedAt: string
}
```

The node should fail with a concise message if required paths are missing, JSON is invalid, the output exists without overwrite, or the template renderer reports an invalid template.

## Registration Strategy

First version keeps current explicit registration, but all feature-owned code stays in the package:

```text
Existing registration points
├─ desktop/src/modules/apps/types.ts
├─ desktop/src/modules/apps/definitions.ts
├─ desktop/src/modules/apps/registry.ts
├─ desktop/src/modules/apps/components/system-app-content.tsx
├─ desktop/electron/modules/apps/ipc.ts
├─ desktop/electron/bootstrap/ipc-registry.ts
├─ desktop/synapse-capabilities/shared/registry.ts
├─ desktop/electron/capabilities/action-router.ts
├─ desktop/electron/bootstrap/descriptors.ts
└─ desktop/workflow-nodes/register.main.ts
```

Longer-term, these explicit imports can be collapsed into app capability registries:

```text
desktop/app-capabilities/register.ts
├─ listAppCapabilityPackages()
├─ listSystemAppDefinitions()
├─ listMcpDomains()
├─ listMainDispatchers()
├─ listIpcModules()
└─ listWorkflowNodes()
```

This future registry should be a small mechanical refactor after at least two app capability packages exist. The first package should not overbuild the loader.

## Documentation

Because this feature adds an MCP domain-like surface, implementation must update the single built-in Synapse skill template:

```text
desktop/resources/templates/skills/synapse-skill/
├─ content.md
└─ files/app/
   ├─ index.md
   └─ api-reference.md
```

The skill guidance should teach Agents:

- Use the `app` domain for app-provided capabilities.
- Use `app_document_template_docx_generate` for local `.docx` generation.
- Provide exactly one of `dataPath` or `data`.
- Ask before overwrite unless the user explicitly requested replacement.
- Do not repeat large JSON payloads or local secrets in final answers.

Implementation should also update relevant MCP/capability tests and release notes because this is a user-visible app and automation capability.

## Tests

Core service tests:

- Generates a `.docx` from a small fixture template and inline JSON.
- Generates a `.docx` from a JSON file.
- Rejects missing template file.
- Rejects non-object JSON.
- Rejects `data` plus `dataPath`.
- Rejects missing `data` and `dataPath`.
- Rejects existing output without `overwrite`.
- Overwrites existing output with `overwrite: true`.
- Returns output path, file name, size, and ISO timestamp.

MCP/capability tests:

- `generate` is accepted as a canonical capability action.
- `app.document_template.docx.generate` maps to `app_document_template_docx_generate`.
- The `app` domain appears in `CAPABILITY_DOMAINS`.
- The action router dispatches `app.*` capabilities to the app capability dispatcher.
- Tool schema requires template and output paths and enforces `dataPath`/`data` alternatives.

Workflow tests:

- Node manifest appears in node type registry.
- Config schema accepts dataPath and inline data modes.
- Executor calls the shared service and returns outputs.
- Executor interpolates workflow variables before calling the service.
- Executor reports existing output and invalid JSON failures clearly.

Renderer tests:

- App is listed in the app launcher.
- Detached system app opens with `document-template`.
- Generate button is disabled until template, JSON file, and output path are selected.
- Successful generation shows a concise success state.
- Failure shows the sanitized error.

## Open Decisions

No open decisions remain for the first version. The first implementation should use the architecture and behavior above.
