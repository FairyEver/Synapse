# Workflow Resource Parameters Design

## Background

Workflow parameters currently support only `text` and `number`. Users who need a workflow to operate on a file or folder must paste a path into a text input. That works for local desktop use, but it does not give Synapse enough structure to validate file vs directory inputs, render native pickers, document MCP usage, or evolve toward remote API/MCP execution.

This design extends workflow parameters with first-class resource parameter types while keeping the implementation centered around a small, reusable parameter normalization layer. The first feature scope is `file` and `directory`, but the shape should support future parameter types without rewriting UI, MCP, validation, and workflow-call behavior each time.

## Goals

- Add workflow parameter types for selecting a file and selecting a directory.
- Make the same parameter contract work from the desktop UI, MCP tools, API callers, and workflow-call nodes.
- Preserve compatibility for existing workflows and existing string-based template interpolation.
- Keep file contents outside workflow definitions and run snapshots by default.
- Centralize parameter parsing, validation, normalization, redaction, and display rules.
- Update the consolidated built-in `synapse-skill` workflow guidance when implementation happens.

## Non-Goals

- Do not build a full remote upload API in the first implementation unless explicitly scoped later.
- Do not store arbitrary file bytes or directory trees inside workflow definitions.
- Do not let individual workflow nodes invent their own file parameter parsing rules.
- Do not change the existing DAG execution model.

## Core Model

Workflow parameter definitions should become a discriminated contract:

```ts
type WorkflowParamType = "text" | "number" | "file" | "directory"

interface WorkflowParam {
  name: string
  type: WorkflowParamType
  default: WorkflowParamDefault
  description?: string
}

type WorkflowParamDefault =
  | string
  | number
  | WorkflowResourceRef
  | null
```

`file` and `directory` parameters are not raw bytes and are not opaque OS handles. Their values are resource references:

```ts
type WorkflowResourceRef =
  | { kind: "local_path"; entryType: "file" | "directory"; path: string }
  | { kind: "drive"; entryType: "file" | "directory"; id: string; versionId?: string }
  | { kind: "staged"; entryType: "file" | "directory"; id: string }
  | { kind: "inline_file"; entryType: "file"; name: string; mimeType?: string; base64: string }
```

The first implementation should fully support `local_path`. The schema should allow the resource-reference envelope so MCP/API guidance can be stable, but `drive`, `staged`, and `inline_file` may initially return clear unsupported errors unless an existing resolver already exists for them.

## User-Facing Behavior

In the workflow parameter editor, `file` and `directory` appear as additional types. Their default value control uses the same restrained form layout as current parameters, with a path input and a native picker button. It should use existing shadcn components and Tailwind tokens only.

In the run-params dialog:

- `text` renders as a text input.
- `number` renders as a number input.
- `file` renders as a path input plus file picker.
- `directory` renders as a path input plus directory picker.

The selected value is normalized to:

```json
{ "kind": "local_path", "entryType": "file", "path": "/absolute/path" }
```

or:

```json
{ "kind": "local_path", "entryType": "directory", "path": "/absolute/path" }
```

The UI may display the path string for readability. It should not copy file bytes into renderer state beyond what is needed for native selection.

## MCP/API Contract

MCP/API callers can pass resource values in either full or shorthand form.

Full form:

```json
{
  "params": {
    "input_file": {
      "kind": "local_path",
      "entryType": "file",
      "path": "/Users/liyang/Desktop/input.pdf"
    }
  }
}
```

Local shorthand:

```json
{
  "params": {
    "input_file": "/Users/liyang/Desktop/input.pdf",
    "workspace_dir": "/Users/liyang/project"
  }
}
```

The shorthand is accepted only because the workflow definition already says whether each parameter is `file` or `directory`. Synapse normalizes it to `local_path` before validation and execution.

Documentation must state that local paths are resolved on the machine running Synapse, not on the caller's machine. Remote callers should use a future `drive`, `staged`, or `inline_file` reference once those resolvers are available.

## Runtime Normalization

Add a workflow parameter value normalization service used by every run entry point:

```ts
normalizeWorkflowRunParams(definition, rawParams, context)
```

Responsibilities:

- Apply defaults.
- Validate missing required values.
- Coerce `number` values consistently.
- Validate `text` values.
- Normalize `file` and `directory` values into `WorkflowResourceRef`.
- Check `local_path` existence and entry kind before execution.
- Produce a string view for template interpolation.
- Produce a redacted or display-safe view for snapshots and tracking.

For `local_path`, validation should confirm:

- path is a non-empty absolute path;
- file parameters point to an existing regular file;
- directory parameters point to an existing directory;
- symlink behavior follows existing local file access policy and must be explicit in tests;
- permission checks and audit happen before a node actually reads or writes the resource.

## Variable Binding and Interpolation

Existing workflow nodes receive resolved variables as strings. To preserve compatibility, file and directory params should interpolate to their resolved local path string.

For example:

```text
请读取 {{input_file}} 并总结
```

If `input_file` is a local-path resource, `{{input_file}}` becomes `/Users/liyang/Desktop/input.pdf`.

This is intentionally the compatibility layer. Internally, run state should retain the typed normalized value so future nodes can consume a resource reference directly instead of parsing a string.

## Workflow Call Behavior

`workflow_call` currently uses `paramTemplates`, which are strings. That works for `text` and `number`, but it is not enough for typed resource forwarding.

The first implementation should preserve `paramTemplates` for legacy string-compatible child params and add a general typed mapping field:

```ts
paramBindings?: Record<
  string,
  | { mode: "template"; template: string }
  | { mode: "value"; source: VariableSource }
>
```

This avoids inventing a separate mapping field every time a non-string parameter type appears. `mode: "template"` keeps the existing text templating behavior. `mode: "value"` forwards a typed value from a parent param, upstream output, or static source through the same normalization layer used by top-level runs.

## Storage, Redaction, and Snapshots

Workflow definitions store parameter definitions and optional defaults. They do not store file bytes.

Run status and run snapshots may include normalized parameter values, but must reuse existing path-sensitive tracking/redaction rules. Local paths are useful for debugging and are already present in workflow debug reports, but sensitive tokens, Authorization values, and credentials must remain redacted.

Inline file content, if supported later, must not be written to normal run snapshots. Store only metadata such as file name, size, MIME type, and a staged id.

## Implementation Shape

The eventual code change should be surgical and centered around shared helpers:

- shared workflow param types in `desktop/src/types/workflow.ts`;
- data-repo schema normalization in `desktop/electron/runtime/data-repo/schemas/placeholders.ts`;
- workflow validation and run-param validation in `desktop/electron/services/workflow/workflow-validator.ts`;
- a new normalization helper under `desktop/electron/services/workflow/`;
- renderer controls in `ParamsEditorDialog` and `RunParamsDialog`;
- generic IPC methods for choosing file and directory paths, or a workflow-scoped picker module if no suitable shell picker exists;
- MCP dispatcher acceptance and documentation for `workflow.param.update` and `workflow.run.execute`;
- consolidated built-in skill updates in `desktop/resources/templates/skills/synapse-skill/files/workflow/index.md` and `api-reference.md`;
- tests for UI behavior, validator behavior, MCP shorthand/full-form params, and workflow-call compatibility.

## Migration

Existing workflows remain valid. Legacy params with `type: "text"` or `type: "number"` are unchanged.

The data repository placeholder validator must accept `file` and `directory`. Older records do not need migration. Invalid unknown types should still be rejected or loaded with the existing workflow load-error behavior.

## Testing

Tests should cover:

- saving params with `file` and `directory`;
- rejecting wrong default shapes;
- run-param shorthand string normalization;
- full `local_path` envelope normalization;
- file path required to be an existing file;
- directory path required to be an existing directory;
- missing required resource params;
- template interpolation produces the resolved path string;
- run snapshots and UI tracking do not record raw file bytes;
- MCP `workflow_param_update` docs and accepted schema include `file` and `directory`;
- workflow-call behavior for legacy `paramTemplates` remains unchanged.

## Workflow Call Decision

The first implementation should include the general `paramBindings` model. Workflow params are meant to be universal across UI, MCP, API, and nested workflows, so `workflow_call` should not remain string-only after file and directory params are introduced.

`paramTemplates` remains supported as the legacy string-template field. When both fields are present for the same child parameter, validation should reject the config and ask the caller to keep exactly one mapping source.
