# Synapse Workflow MCP — API Reference

All tools are accessed via the `synapse-mcp` MCP server.

Workflow definition responses include `meta.schemaVersion` (SemVer). Preserve it on whole-definition updates. Do not confuse it with the `version` save revision. Synapse migrates supported legacy documents before returning them and blocks future or failed documents from fetch, update, and execution. List metadata can expose `loadError`; `rawExportAvailable` refers only to the Synapse UI's protected raw export path, which writes the untouched workflow JSON document rather than an importable Synapse workflow package.

---

## Discovery

### app_workflow_node_type_list

List available node types with summaries. Current built-in node types include `prompt`, `switch`, `http_request`, `script`, `workflow_call`, `document_template_docx_generate`, `codex`, `claude_code`, and `end`.

**Params:** none
**Returns:** `[{ type, title, subtitle, color }]`

### app_workflow_node_type_describe

Get full manifest and config JSON Schema for a node type.

**Params:** `nodeType` (string, required)
**Returns:** `{ type, title, color, ports, configFields, configSchema, availableProviders? }`
**Notes:** Always call this before configuring a node to get the current schema. Treat `configSchema.required` as authoritative and include every listed field, including booleans and arrays; `configFields[].optional` is aligned with the same requirement. The nested-workflow node type is exactly `workflow_call`, not `app_workflow_call`. For `prompt` and `switch` nodes, the response also includes `availableProviders` — an array of `{ id, name, models: { default?, haiku?, sonnet?, opus? } }`. Use this to discover valid `providerId` values. `codex` and `claude_code` nodes do not use `providerId` or `modelTier`; inspect `nodeType: "codex"` for Codex CLI fields and `nodeType: "claude_code"` for Claude Code CLI fields. If the user provides a copied reference such as `synapse-provider-model://local-claude-code/sonnet`, parse it as `providerId = "local-claude-code"` and `modelTier = "sonnet"`.

---

## Node Type Config Reference

These are the key config fields for each node type. Always call `app_workflow_node_type_describe` for the full JSON Schema.

### prompt

- `prompt` (string) — prompt template text with `{{variable}}` placeholders
- `variables` (array) — variable bindings
- `providerId?` / `modelTier?` — override workflow-level provider defaults
- `timeoutMins?` — override workflow-level timeout; defaults to 60 minutes when neither node nor workflow sets it

### switch

- `prompt` (string) — evaluation prompt
- `branches` (array of `{ id, label }`) — possible branch outcomes
- `defaultBranch?` (string) — fallback branch id
- `variables` (array) — variable bindings
- `providerId?` / `modelTier?` — override workflow-level provider defaults
- `timeoutMins?` — override workflow-level timeout; defaults to 60 minutes when neither node nor workflow sets it

### http_request

No provider needed. Config fields:

- `method` (enum: GET/POST/PUT/PATCH/DELETE, default "GET")
- `url` (string) — request URL
- `headers?` (object) — key-value request headers
- `query?` (object) — key-value query parameters
- `bodyType` (enum: none/json/text, default "none")
- `body?` (string) — request body (when bodyType is json or text)
- `auth?` (`{ type: "none"|"bearer"|"basic", bearerToken?, basicUsername?, basicPassword? }`)
- `timeoutMins?` (number) — request timeout in minutes
- `variables` (array) — variable bindings

### script

Requires workflow `defaultProjectId` as the execution project because script config currently has no node-level `projectId`. No provider needed. Config fields:

- `script` (string) — shell script content
- `shell?` (enum: posix/cmd/powershell) — platform default when omitted: Windows uses `cmd`; macOS/Linux use `posix`. Set `posix` explicitly only when the workflow should require a POSIX shell.
- `env?` (object) — key-value environment variables
- `pathStrategy?` (enum: merge/replace) — PATH handling
- `posixLogin?` (boolean) — run as login shell (posix only)
- `timeoutMins?` (number) — execution timeout in minutes
- `variables` (array) — variable bindings

Resolved variables are injected as environment variables, not interpolated as `{{variable}}` text. Use `$variable` in POSIX, `%variable%` in cmd, or `$env:variable` in PowerShell. Single file/directory params become path strings; multi-resource params become ordered JSON path arrays. Definitions using `{{variable}}` inside `script` are rejected before save.

Output is exact stdout. Use `printf` for single-value outputs that downstream `node_output` bindings will treat as paths, IDs, or JSON scalars.

### workflow_call

No provider needed on the call node. It invokes another saved workflow and returns that child workflow's End output.

- `workflowId` (string) — child workflow ID to call. Must not be the current workflow ID.
- `variables` (array) — variable bindings from parent workflow params, upstream node outputs, or static values
- `paramTemplates` (object) — child text/number/option param name to template string map. Values may use `{{variable}}` placeholders declared in `variables`. Legacy single file/directory templates remain accepted; multi-resource params cannot use templates.
- `paramBindings` (object) — child param name to typed binding map. A template binding uses `{ "mode": "template", "template": "{{variable}}" }`; every placeholder must be declared in `variables`. For file/directory params, prefer a value binding such as `{ "input_file": { "mode": "value", "source": { "type": "param", "param": "input_file" } } }`. A single-resource value binding may also use a legacy `static` or `node_output` string path. A multi-resource value binding must directly reference a parent param with the same resource kind and `allowMultiple: true`.

Before configuring child params, call `app_workflow_definition_get` for the child workflow and read its current `params`. Every child param without a default requires a non-empty template or binding; inspect and save reject missing required mappings and unbound variables in either template form. Do not put the same child param in both `paramTemplates` and `paramBindings`. `app_workflow_definition_inspect` and save reject direct parent bindings whose file/directory type or `allowMultiple` value differs from the child parameter. They also reject templates, `static`, and `node_output` string sources for multi-resource child params. Single and multi values are never converted automatically. Child prompt/switch nodes still need provider/model/project through the child workflow defaults or child node overrides; child codex/claude_code nodes still need an effective project. The parent workflow_call node does not lock a child version; each run uses the child workflow's latest saved definition and validates it before any child node executes.

### document_template_docx_generate

Generates a DOCX from a template. No provider needed. Config fields:

- `templatePath` (string) — input DOCX template path
- `outputPath` (string) — generated DOCX output path
- `dataSource` (enum: `dataPath`/`inline`) — selects a JSON file or inline JSON text
- `dataPath?` (string) — required when `dataSource` is `dataPath`
- `dataJson?` (string) — required when `dataSource` is `inline`
- `overwrite` (boolean) — whether an existing output file may be replaced
- `variables` (array) — variable bindings available to path and inline-data templates

The path fields and inline JSON support `{{variable}}` interpolation. The node output is the generated `outputPath`; generation metadata is also available in the node result outputs.

### codex

Runs local `codex exec` in an execution project. No Synapse provider needed; do not set `providerId` or `modelTier`.

- `prompt` (string) — Codex instruction template with `{{variable}}` placeholders
- `variables` (array) — variable bindings from workflow params, upstream node outputs, or static values
- `projectId?` (string) — execution project override; inherits workflow `defaultProjectId` when omitted
- `workingDirectory?` (string) — per-task working directory. Supports `{{variable}}` interpolation, must already exist, and becomes both process cwd and Codex `--cd`. It is not automatically added to `additionalWritableDirs`.
- `timeoutMins?` (number) — node timeout in minutes
- `approvalPolicy` (enum: never/on-request/untrusted, default "never") — Codex approval policy
- `sandbox` (enum: read-only/workspace-write/danger-full-access, default "workspace-write") — Codex sandbox
- `model?` / `profile?` (string) — optional Codex CLI model/profile
- `enableSearch` (boolean, default false) — enables Codex search support
- `features.goals` (enum: default/enabled/disabled, default "enabled") — Codex goals feature flag
- `skipGitRepoCheck` (boolean, default true)
- `strictConfig` (boolean, default false)
- `bypassApprovalsAndSandbox` (boolean, default false) — when true, execution uses Codex's bypass flag instead of approval/sandbox CLI flags
- `bypassHookTrust` (boolean, default false)
- `additionalWritableDirs` (string[]) — repeated `--add-dir` values outside the actual working directory
- `images` (string[]) — repeated `--image` values
- `configOverrides` (array of `{ key, value }`) — repeated `--config key=value` values
- `captureDebugArtifacts` (boolean, default true)

Minimal valid config:

```json
{
  "prompt": "Summarize {{input}}",
  "variables": [],
  "approvalPolicy": "never",
  "sandbox": "workspace-write",
  "enableSearch": false,
  "features": { "goals": "enabled" },
  "skipGitRepoCheck": true,
  "strictConfig": false,
  "bypassApprovalsAndSandbox": false,
  "bypassHookTrust": false,
  "additionalWritableDirs": [],
  "images": [],
  "configOverrides": [],
  "captureDebugArtifacts": true
}
```

The node passes the prompt through stdin and returns only Codex's final reply text as `output`. By default it runs with `--cd` set to the resolved project workspace. If `workingDirectory` is set, Synapse interpolates and trims it, requires an existing directory, then uses it as both process cwd and Codex `--cd`; with `workspace-write`, Codex's current workspace is the actual working directory plus any `additionalWritableDirs`. Debug metadata is available in `outputs.codexDebug`, but downstream `node_output` bindings receive the final reply text only.

### claude_code

Runs local `claude -p` in an execution project. No Synapse provider needed; do not set `providerId` or `modelTier`.

- `prompt` (string) — Claude Code instruction template with `{{variable}}` placeholders
- `variables` (array) — variable bindings from workflow params, upstream node outputs, or static values
- `projectId?` (string) — execution project override; inherits workflow `defaultProjectId` when omitted
- `workingDirectory?` (string) — per-task working directory. Supports `{{variable}}` interpolation, must already exist, and becomes process cwd.
- `timeoutMins?` (number) — node timeout in minutes; inherits workflow `defaultNodeTimeoutMins` when omitted, then falls back to 60 minutes
- `permissionMode` (enum: default/acceptEdits/plan/auto/dontAsk/bypassPermissions, default "acceptEdits")
- `model?` (string) — optional Claude Code CLI model
- `maxTurns?` (number) — optional maximum turns
- `outputFormat` (enum: text/json/stream-json, default "stream-json")
- `verbose` (boolean, default true)
- `safeMode` (boolean, default false)
- `bareMode` (boolean, default false)
- `noSessionPersistence` (boolean, default false)
- `settingSources` (array of user/project/local, default `["user", "project", "local"]`) — must contain at least one value and no duplicates
- `settingsPath?` (string) — optional Claude Code settings file; supports `{{variable}}` interpolation and must exist
- `mcpConfigPath?` (string) — optional Claude Code MCP config file; supports `{{variable}}` interpolation and must exist
- `strictMcpConfig` (boolean, default false)
- `additionalDirectories` (string[]) — repeated `--add-dir` values; each must resolve to an existing directory
- `allowedTools` (string[]) — repeated Claude Code allowed tool rules
- `disallowedTools` (string[]) — repeated Claude Code disallowed tool rules
- `captureDebugArtifacts` (boolean, default true)

Minimal valid config:

```json
{
  "prompt": "Summarize {{input}}",
  "variables": [],
  "permissionMode": "acceptEdits",
  "outputFormat": "stream-json",
  "verbose": true,
  "safeMode": false,
  "bareMode": false,
  "noSessionPersistence": false,
  "settingSources": ["user", "project", "local"],
  "strictMcpConfig": false,
  "additionalDirectories": [],
  "allowedTools": [],
  "disallowedTools": [],
  "captureDebugArtifacts": true
}
```

The node passes the prompt as the `claude -p` query argument and returns only Claude Code's final reply text as `output`. If `workingDirectory` is set, Synapse interpolates and trims it, requires an existing directory, then uses it as process cwd. Debug metadata is available in `outputs.claudeCodeDebug`, but downstream `node_output` bindings receive the final reply text only.

### end

- `outputType` (`"text"`) — end node output mode
- `template` (string) — final output template with `{{variable}}` placeholders
- `variables` (array) — variable bindings

---

## Read

### app_workflow_definition_list

List all workflow definitions.

**Params:** none
**Returns:** `[{ id, name, description?, version, loadError?, rawExportAvailable?, nodeCount, createdAt, updatedAt }]`

### app_workflow_definition_get

Get full workflow definition by ID.

**Params:** `workflowId` (string, required)
**Returns:** Full `WorkflowDefinition` object (nodes, edges, params, `defaultProjectId?`, `defaultProviderId?`, `defaultModelTier?`, `defaultNodeTimeoutMins?`) or `null`
### app_workflow_definition_inspect

Validate a workflow definition without saving.

**Params:** `definition` (object, required) — full WorkflowDefinition including the complete Synapse-managed `meta` object with `meta.schemaVersion`
**Returns:** `{ valid, errors, warnings }`
**Notes:** Inspection rejects missing schema metadata before graph validation, matching whole-definition update. It applies the same definition and local multi-resource default checks as save, including filesystem type, accessibility, and canonical-path uniqueness. Validation errors may include `nodeId`, `nodeName`, `field`, `retryable`, and `details` such as `missingField`, `providerId`, `modelTier`, `projectId`, and `timeoutMs`.

### app_workflow_run_get

Get execution status for a run owned by a workflow.

**Notes:** Renderer events, run status, and persisted snapshots bound large node-output fields. A value ending in `[truncated]`, an array ending in `[truncated]`, or an object with `__synapseTruncated: true` is a bounded history representation; the Workflow engine still uses the complete value while executing downstream nodes.

**Params:** `workflowId` (string, required), `runId` (string, required)
**Returns:** `{ status, nodeResults, error?, definitionMigration? }` or snapshot from history, or `null`
**Notes:** Authorizes the read against `workflowId`, then checks in-memory active runs and persisted snapshots. Returns `null` when the run does not belong to that workflow. An archived snapshot can return `definitionMigration` with `kind: "failed" | "unsupported_future"` plus source/target versions when its embedded definition is protected; do not interpret, reconstruct, rerun, or reuse that unavailable definition.
Node results include `durationMs` when available. For failures, inspect the failed node's `error`, `durationMs`, effective provider/model/project fields, timeout config, and upstream input size before retrying.

### app_workflow_run_list

List run history for a workflow (newest first).

**Params:** `workflowId` (string, required), `limit?` (integer, 1-20, default 20)
**Returns:** Array of run snapshots
**Notes:** The limit is applied before snapshot files are decoded, migrated, and sanitized. The renderer run-history path uses the same 20-snapshot bound.

---

## Write (Whole Definition)

### app_workflow_definition_create

Create a new empty workflow with a default end node.

**Params:** `name?` (string), `defaultProjectId?` (string), `defaultProviderId?` (string), `defaultModelTier?` (`"default"|"haiku"|"sonnet"|"opus"`), `defaultNodeTimeoutMins?` (number)
**Returns:** `{ id, versionHash }`
**Notes:** Prompt/switch nodes require an effective project, provider, and model tier. Script nodes require workflow `defaultProjectId` as their execution project. Codex and Claude Code nodes require an effective project but no provider/model tier. Set workflow defaults here or set `projectId`/`providerId`/`modelTier` on each prompt/switch node and `projectId` on each codex/claude_code node.

### app_workflow_definition_update

Replace a full workflow definition. Validates before saving.

**Params:** `definition` (object, required) — must include `id` and the complete Synapse-managed `meta` object with `meta.schemaVersion`
**Returns:** `{ versionHash }`
**Notes:** Config is replaced entirely, not merged. Include `defaultProjectId`, `defaultProviderId`, `defaultModelTier`, and optional `defaultNodeTimeoutMins` to set workflow-level defaults.

### app_workflow_definition_delete

Delete a current workflow definition. Cancels active runs and removes snapshots.

**Params:** `workflowId` (string, required)
**Returns:** `{ ok: true }`
**Notes:** Workflows reported by `app_workflow_definition_list` with `loadError` are protected and cannot be deleted. A future-schema document with `rawExportAvailable` must be preserved through the Synapse UI's raw export path; migration-failed source and diagnostics remain stored for later recovery.

---

## Write (Atomic Mutations)

### app_workflow_node_create

Add a node to a app.workflow.

**Params:** `workflowId` (string, required), `node: { name, type, config, position? }`, `incomingEdges?`, `outgoingEdges?`
**Returns:** `{ nodeId, versionHash, edgeIds?, validation? }`
**Notes:** `node.config` is required and must match the selected node type schema from `app_workflow_node_type_describe`. Position auto-calculated if omitted. Strict validation runs before saving, so disconnected placeholder nodes are rejected. Workflow node IDs must use only letters, numbers, `_`, or `-`; never use path separators, `..`, absolute paths, or spaces. Use `incomingEdges` / `outgoingEdges` to create a node and its connecting edges in the same validated mutation, or use `app_workflow_definition_update` for a complete DAG rewrite. Save `nodeId` and returned `edgeIds` for later updates.

`incomingEdges` items are `{ from, branch? }`, where `from` is an existing upstream node ID. Include `branch` when the upstream node is a switch.

`outgoingEdges` items are `{ to, branch? }`, where `to` is an existing downstream node ID. Include `branch` only when the new node is a switch.

### app_workflow_node_update

Update a node's name, position, or config.

**Params:** `workflowId` (string, required), `nodeId` (string, required), `patch: { name?, position?, config? }`
**Returns:** `{ versionHash, validation? }`
**Notes:** `config` is replaced entirely (not merged with existing).

### app_workflow_node_delete

Delete a node and all connected edges.

**Params:** `workflowId` (string, required), `nodeId` (string, required)
**Returns:** `{ removedEdgeCount, versionHash, validation? }`
**Notes:** Cannot delete the end node — will throw an error.

### app_workflow_edge_create

Add a directed edge between two nodes.

**Params:** `workflowId` (string, required), `from` (string, required), `to` (string, required), `branch?` (string)
**Returns:** `{ edgeId, versionHash, validation? }`
**Notes:** Include `branch` for edges from switch nodes. Switch branches are mutually exclusive; connect each branch only to its own downstream nodes. If multiple branches connect to the same multi-node target set, validation returns a `duplicate_switch_branch_targets` warning.

### app_workflow_edge_delete

Delete an edge by ID.

**Params:** `workflowId` (string, required), `edgeId` (string, required)
**Returns:** `{ versionHash, validation? }`

### app_workflow_param_update

Replace the workflow's parameter list entirely.

**Params:** `workflowId` (string, required), `params` (array, required) — each: `{ name, type: "text"|"number"|"file"|"directory"|"option", default?, description?, options?, allowCustomOption?, allowMultiple? }`; `allowMultiple` is valid only when `type` is `file` or `directory`
**Returns:** `{ versionHash, validation? }`
**Notes:** Pass empty array to clear all params. Use `null` default for required params. For file/directory defaults, use a resource ref:

```json
{ "kind": "local_path", "entryType": "file", "path": "/absolute/path/to/file.txt" }
```

Use `"entryType": "directory"` for directory params. Defaults store a reference, not file bytes.

Set `allowMultiple: true` only for file/directory params. Its default and run value must be an ordered, non-empty array of at most 100 unique resources, even when it contains one item. Array items may mix absolute local path strings and `local_path` objects at run time; stored defaults use resource objects. Local multi-resource defaults are checked against the filesystem before save, including canonical-path duplicate detection, so symbolic-link aliases of the same resource are rejected.

For option / 选项 params, set `options` to an array of strings. The option label and value are the same string. Set `allowCustomOption: true` only when runs may provide a non-empty custom string. Custom run values are not saved back to the workflow definition.

---

## Layout

### app_workflow_layout_update

Reposition all nodes using the same pure auto-layout algorithm as the UI editor. Saves the updated positions.

**Params:** `workflowId` (string, required), `direction?` (string, `"LR"` or `"TB"`, default `"LR"`)
**Returns:** `{ versionHash, validation? }`
**Notes:** `LR` arranges nodes left-to-right, `TB` arranges top-to-bottom. The UI editor reflects the changes on next load. Call this after adding, deleting, or reconnecting nodes so agents can clean up layout without opening the UI.

---

## Execute

### app_workflow_run_execute

Execute a workflow with parameters.

**Params:** `workflowId` (string, required), `params?` (object — key-value matching param definitions)
**Returns:** `{ runId }`
**Notes:** Poll `app_workflow_run_get` with this `workflowId` and the returned `runId` to track progress. Every key in `params` must match a declared Workflow param; unknown keys are rejected before the run starts. For option params, pass a string. Closed options must match one configured option value; params with `allowCustomOption: true` accept a non-empty custom string. Custom run values are not saved back to the workflow definition. For file/directory params, pass either a local path string or a resource ref. Synapse normalizes strings to:

```json
{ "kind": "local_path", "entryType": "file", "path": "/absolute/path/to/file.txt" }
```

The path must exist and match the param kind before the run starts. For a file/directory param with `allowMultiple: true`, pass an ordered, non-empty array of at most 100 unique items; each item may be an absolute local path string or matching resource object. One item is still passed as an array. Any invalid item rejects the whole run and reports its array index. Remote or Drive-backed resource kinds should remain explicit objects for future compatibility; unsupported kinds are rejected instead of silently stringified.

### app_workflow_run_disable

Cancel a running workflow execution.

**Params:** `workflowId` (string, required), `runId` (string, required)
**Returns:** `{ runId, cancelRequested }`

**Notes:** Authorizes the mutation against `workflowId` and verifies the active run belongs to that workflow before sending an abort signal. `cancelRequested` is true when Synapse found the matching active run and sent the signal. It is false when the run is no longer active or belongs to another workflow; the request still succeeds idempotently.
