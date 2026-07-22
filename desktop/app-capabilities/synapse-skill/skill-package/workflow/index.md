# Synapse Workflow MCP

You have access to Synapse Workflow MCP tools for creating, editing, validating, and running Synapse workflow definitions. Synapse workflows are DAG-based: nodes execute in topological order, and independent nodes run in parallel. When you add, delete, or reconnect workflow nodes, finish by calling `app_workflow_layout_update` so the saved workflow opens with a clean layout in the UI.

## Scope Boundary

Use this skill only for Synapse workflow definitions, workflow nodes, workflow edges, workflow validation, workflow layout, and workflow runs.

Do not treat this domain file as the umbrella guidance for every Synapse MCP capability. Database tables and rows, Automation schedules/items, built-in rules, built-in skills, prompts, and other Synapse resource publishing flows belong to their matching consolidated `synapse-skill` domain attachments when that domain exists.

If a user asks for another Synapse MCP domain while this domain file is active, return to `SKILL.md` for routing and read the matching `<domain>/index.md` attachment before using that domain's tools. If no current domain attachment exists, use the relevant MCP tools directly and keep the workflow-specific guidance here out of that task.

Workflow definitions returned by Synapse contain `meta.schemaVersion`, a SemVer document-schema version managed by Synapse. Preserve the complete `meta` object when sending a fetched definition back through a whole-definition update. Do not invent, downgrade, or remove this value. It is separate from `version`, which is the save revision hash. Legacy definitions are migrated by Synapse before MCP access; a future or failed document cannot be fetched, updated, run, or deleted through MCP. `app_workflow_definition_inspect` applies the same migration gate and returns `valid: false` for future or failed schemas; do not interpret or edit a definition after that result. `app_workflow_definition_list` may report `loadError`; do not call `app_workflow_definition_delete` for such an entry. `rawExportAvailable` only means a future document can be preserved through the Synapse UI's protected raw export path. That path writes the untouched workflow JSON document, not an importable Synapse workflow package, and rejects symbolic-link destinations.

## Workflow Sharing Boundary

Workflow sharing is currently a Synapse UI flow, not an MCP definition operation. The UI exports one `.synapse-workflow` ZIP container with the entry workflow and all recursively referenced child workflows. It preserves workflow config literals, reports sensitive/high-risk field locations without showing their values, and does not include local file bytes, run history, parameter presets, Automation instances, or node implementation code.

Import uses up to six fixed steps to check content, risks/capabilities, model mappings, project mappings, external files/environments, and the final change plan. Model references used by several nodes are mapped once as a group. A same-lineage revision updates the existing local workflow IDs, preserves run history and parameter presets, disables only incompatible linked Automation items, and creates one undo point. Re-importing the same artifact is idempotent. Missing required capabilities or unresolved resources block import.

An **open_file** node is exported as configuration only; the target file bytes are never included. A literal `filePath` is an external read-only file dependency that must be mapped on import, while a path derived from a workflow parameter or upstream output remains owned by that source. Import requires `workflow.node.open_file@1.0.0` and reports the node as `shell.execute` high risk; it must not be downgraded to a script when that capability is unavailable.

Do not simulate share import by calling `app_workflow_definition_create` or `app_workflow_definition_update` with copied JSON. That bypasses recursive child inclusion, stable dependency mappings, capability checks, lineage updates, crash recovery, and undo. Use the UI sharing flow when the user wants a reproducible workflow package. The V1/V2/V3 JSON readers remain for historical imports, but new exports use package format V4; package `formatVersion`, workflow `meta.schemaVersion`, save `version`, and node capability versions are independent.

## Node Types

- **text** — Builds one deterministic text output from a template and explicit variable bindings. Empty templates return an empty string. No provider or project needed.
- **prompt** — Sends a prompt to an AI model, returns the response as output. Requires a provider.
- **switch** — Evaluates input via AI, returns a branch label. Only the matching branch's downstream nodes execute. Requires a provider.
- **http_request** — Sends an HTTP request (GET/POST/PUT/PATCH/DELETE) and returns the response. Supports headers, query params, JSON/text body, auth (bearer/basic), and timeout. No provider needed.
- **script** — Executes a shell script (posix/cmd/powershell) in the effective project workspace and returns stdout as output. Supports env vars, timeout, and login shell mode. Requires workflow `defaultProjectId`; no provider needed.
- **workflow_call** — Calls another saved workflow, maps parent context into the child workflow params, and returns the child workflow End output. No provider needed on the call node.
- **document_template_docx_generate** — Generates a DOCX from a template using a JSON file or inline JSON data, then returns the generated output path. No provider needed.
- **text_extract** — Extracts complete text from one local PDF or DOCX file. No provider needed.
- **open_file** — Submits one existing local regular file to the operating system's default application and returns the submitted path. No provider or project needed.
- **codex** — Runs local `codex exec` in the selected project or an optional task working directory, passes the prompt through stdin, and returns Codex's final reply text. Requires an execution project, but does not use Synapse provider/model fields.
- **claude_code** — Runs local `claude -p` in the selected project or an optional task working directory, passes the prompt as the print query, and returns Claude Code's final reply text. Requires an execution project, but does not use Synapse provider/model fields.
- **end** — Terminal node (every workflow has exactly one). Defines the final output template. Cannot be deleted.

## Provider / Model Configuration

Only **prompt** and **switch** nodes require a provider (AI service), model tier, and execution project. **script**, **codex**, and **claude_code** nodes require an execution project but do not use `providerId` or `modelTier`. **text**, **http_request**, **workflow_call**, **document_template_docx_generate**, **text_extract**, and **open_file** execute without provider or project configuration on that node. Inside a workflow called by **workflow_call**, child prompt/switch nodes still need effective project/provider/model settings, and child script/codex/claude_code nodes still need an effective project. Configure project/provider/model with these exact field names:

- **Workflow defaults** — Set `defaultProjectId`, `defaultProviderId`, `defaultModelTier`, and optionally `defaultNodeTimeoutMins` on the workflow definition. Prompt/switch nodes inherit project/provider/model/timeout defaults unless they override; script nodes use `defaultProjectId` as their execution project; codex/claude_code nodes inherit project and timeout defaults unless they override. When no timeout is configured for prompt/switch/codex/claude_code, the default is 60 minutes.
- **Node overrides** — Set `projectId`, `providerId`, `modelTier`, and optionally `timeoutMins` directly on prompt/switch config. For codex config, set Codex CLI fields such as `projectId`, `workingDirectory`, `timeoutMins`, `enableSearch`, `additionalWritableDirs`, `images`, `configOverrides`, and debug or safety flags. For claude_code config, set Claude Code CLI fields such as `projectId`, `workingDirectory`, `timeoutMins`, `permissionMode`, `model`, `settingSources`, `settingsPath`, `mcpConfigPath`, `allowedTools`, `disallowedTools`, `additionalDirectories`, and debug flags. Do not set `providerId` or `modelTier` on codex or claude_code nodes.
- **Project validity** — Any effective script/codex/claude_code execution project must refer to a currently configured Synapse project or repository. For script nodes this is currently workflow `defaultProjectId`; for codex/claude_code it can be a node override or inherited default. If a project was deleted, update the workflow default or the local CLI node before saving or running.

To discover available providers, call `app_workflow_node_type_describe` with `nodeType: "prompt"` (or `"switch"`). The response includes an `availableProviders` array:
```json
{ "id": "provider-id", "name": "Provider Name", "models": { "default": "model-name", "haiku": "...", "sonnet": "...", "opus": "..." } }
```

Valid `modelTier` values: `"default"`, `"haiku"`, `"sonnet"`, `"opus"`. Use the provider's `id` as `providerId` and pick a tier whose model is available. In your final reply, use the same terms: `providerId = ...`, `modelTier = ...`; do not rename them to "默认档", "模型档位", or other aliases.

Users may paste a provider/model reference copied from Synapse settings in this format:

```text
synapse-provider-model://<providerId>/<modelTier>
```

When you see this URI, parse it as `providerId = <providerId>` and `modelTier = <modelTier>`. For example, `synapse-provider-model://local-claude-code/sonnet` means `providerId = "local-claude-code"` and `modelTier = "sonnet"`. Use those two fields in workflow defaults or prompt/switch node config.

## Creating a Workflow (Standard Flow)

1. Call `app_workflow_node_type_list` to see available node types.
2. Call `app_workflow_node_type_describe` for every node type you will configure. Include every field listed in `configSchema.required`, including required booleans and arrays. Use `nodeType: "prompt"` or `"switch"` before choosing any AI node config; use the exact node type `"workflow_call"` (not `"app_workflow_call"`) before creating a nested workflow call node; use `nodeType: "document_template_docx_generate"` before configuring document generation; use `nodeType: "text_extract"` before configuring text extraction; use `nodeType: "open_file"` before configuring default-app file opening; use `nodeType: "codex"` before setting Codex CLI options; use `nodeType: "claude_code"` before setting Claude Code CLI options.
3. Call `app_workflow_definition_create` with `name`, `defaultProjectId`, `defaultProviderId`, `defaultModelTier`, and optional `defaultNodeTimeoutMins` when known. This returns `{ id, versionHash }` and creates a workflow with a default end node.
4. If defaults were not set during create, call `app_workflow_definition_get`, update the full definition with `defaultProjectId`, `defaultProviderId`, `defaultModelTier`, and optional `defaultNodeTimeoutMins`, then call `app_workflow_definition_update`.
5. Call `app_workflow_param_update` to define input parameters.
6. Choose one save strategy:
   - For complex graphs, fetch the workflow, build the complete valid DAG locally, then call `app_workflow_definition_update`.
   - For incremental edits, create each new node with a schema-valid `node.config` and already connected by passing `incomingEdges` and/or `outgoingEdges` to `app_workflow_node_create`. This keeps strict validation intact because disconnected intermediate nodes are not saved.
   - A useful incremental pattern is to build from the existing End node backward: create the node with `outgoingEdges: [{ "to": "end-node-id" }]`, then add or update upstream connected nodes.
7. Use `app_workflow_edge_create` for extra structural edges only when the graph remains valid after that single edge is saved. For switch nodes, include a `branch` field matching a branch id.
8. Update node configs with `app_workflow_node_update`: add final prompt templates, Codex/Claude Code CLI options, workflow_call `paramTemplates`, and `variables`, including `node_output` bindings only after the referenced upstream path exists.
9. Call `app_workflow_layout_update` after node/edge changes.
10. Call `app_workflow_definition_inspect` and fix errors before executing.
11. Call `app_workflow_run_execute` with only params declared by the Workflow. Omit `params` when there are no values; when provided, `params` must be an object. Unknown keys and non-object parameter bags are rejected before the run starts. Returns `{ runId }`.
12. Poll `app_workflow_run_get` with the workflowId and runId (2-3 second intervals) until status is `completed`, `failed`, or `cancelled`.
13. To cancel an active run, call `app_workflow_run_disable` with the same workflowId and runId.

Use `app_workflow_run_list` with an integer `limit` from 1 to 20 when recent run history is needed. Synapse applies this bound before decoding and migrating snapshot contents.

Large node outputs are bounded in renderer events, run status, and persisted snapshots. Treat `[truncated]` markers or `__synapseTruncated: true` as a history-size boundary, not as the value used between nodes during execution.

If `app_workflow_run_get` returns `definitionMigration`, the archived run's embedded workflow definition is protected because migration failed or it comes from a future schema version. Do not interpret, reconstruct, rerun, or reuse that unavailable definition; report the diagnostic instead.

Strict validation runs after every MCP mutation. Do not create disconnected placeholders and plan to connect them later; that save will be rejected. Use connected `app_workflow_node_create` calls or a full `app_workflow_definition_update` instead.

Workflow node IDs must use only letters, numbers, `_`, or `-`. Never create or preserve node IDs containing path separators, `..`, absolute paths, or spaces.

## Workflow Parameters

Workflow params support five types:
- `text` — string input.
- `number` — numeric input.
- `file` — a file resource reference.
- `directory` — a directory resource reference.
- `option` — 选项 input. Each option's label and value are the same string.

For `file` and `directory`, the parameter value is a resource reference, not file bytes. The current local form is:

```json
{ "kind": "local_path", "entryType": "file", "path": "/absolute/path/to/file.txt" }
```

For directories, use `"entryType": "directory"` and a directory path. When calling `app_workflow_run_execute` from MCP, you may pass either this object or a plain local path string. Synapse normalizes plain strings to `local_path`, verifies that the path exists, and checks the expected file/directory kind before the run starts. Leading and trailing whitespace is part of a local path and is preserved; do not trim it.

Set `allowMultiple: true` on a file/directory definition to accept multiple resources. Defaults and run values then use an ordered, non-empty array with at most 100 unique items; one item is still an array. Run arrays may mix absolute local path strings and matching resource objects. Any invalid item rejects the entire run and identifies its index.

When defining defaults with `app_workflow_param_update`, use `null` for required params. For optional file/directory params, use the same resource object shape as above, or an array of those objects when `allowMultiple: true`. Local multi-resource defaults must exist, match the declared resource type, and resolve to distinct resources; aliases such as symbolic links cannot bypass duplicate checks. Do not inline file bytes into params.

For `option` params, define `options` as an array of strings and optionally set `allowCustomOption`. Example:

```json
{ "name": "report_type", "type": "option", "default": "周报", "options": ["日报", "周报"], "allowCustomOption": false }
```

When calling `app_workflow_run_execute`, pass an option param as a string. If `allowCustomOption` is false or omitted, the run value must match one configured option string. If `allowCustomOption` is true, the run may pass a non-empty custom string. Custom run values are not saved back to the workflow definition.

## Variable Bindings

Nodes declare a `variables` array. Each binding has:
- `name` — referenced in the prompt template as `{{name}}`
- `source` — one of:
  - `{ type: "param", param: "paramName" }` — workflow input parameter
  - `{ type: "node_output", node: "nodeId" }` — output from an upstream node
  - `{ type: "static", value: "..." }` — hardcoded string

## Template Fields

Use `{{variableName}}` to interpolate bound variables into text-node output templates, prompt text, codex/claude_code prompt text, end output templates, HTTP request text fields, workflow_call child parameter templates, and `open_file.filePath`. A text node preserves whitespace exactly, accepts an empty template as `""`, and does not receive upstream output unless that output is explicitly bound and referenced. Script node variables are injected as environment variables instead of template text; do not write `{{variableName}}` inside `script`. Use `$variableName` in POSIX, `%variableName%` in cmd, or `$env:variableName` in PowerShell. A single file/directory variable is its path string; a multi-resource variable is an ordered JSON array of paths. All referenced template variables must be declared in the node's `variables` array.

Script node `node_output` is the exact stdout string. If a downstream node needs a path, ID, JSON scalar, or other single value, write scripts with `printf` or strip inside the producing script so the output does not include an accidental trailing newline.

## Calling Another Workflow

Use a **workflow_call** node when the parent workflow should run another saved workflow.

Config fields:
- `workflowId` — child workflow ID. Do not set this to the current workflow ID.
- `variables` — bindings from the parent workflow params, upstream node outputs, or static values.
- `paramTemplates` — object whose keys are child text/number/option param names and whose values are template strings using `{{variableName}}`. Existing single file/directory string templates remain compatible; do not use templates for multi-resource params.
- `paramBindings` — object whose keys are child param names and whose values are typed bindings. Use this for file/directory child params so resource references pass through without becoming strings.

Recommended MCP flow:
1. Call `app_workflow_definition_list` to find the child workflow ID, then `app_workflow_definition_get` to read its current `params`.
2. Create the workflow_call node with minimal valid config:
   ```json
   { "workflowId": "child-workflow-id", "variables": [], "paramTemplates": {}, "paramBindings": {} }
   ```
3. Create edges so upstream nodes exist before using `node_output` bindings.
4. Update the workflow_call config with variable bindings and `paramTemplates`, for example:
   ```json
   {
     "workflowId": "child-workflow-id",
     "variables": [
       { "name": "search_result", "source": { "type": "node_output", "node": "search-node-id" } },
       { "name": "audience", "source": { "type": "param", "param": "audience" } }
     ],
     "paramTemplates": {
       "topic": "请根据 {{search_result}} 输出摘要",
       "style": "面向 {{audience}}，语气克制"
     },
     "paramBindings": {
       "input_file": { "mode": "value", "source": { "type": "param", "param": "input_file" } }
     }
   }
   ```
5. Run `app_workflow_definition_inspect` after updating. It catches direct self-calls, missing required child parameter templates or bindings, unbound variables in `paramTemplates` and template-mode `paramBindings`, value bindings that reference missing parent workflow params or use a different declared parameter type, file/directory parent bindings whose `allowMultiple` value differs from the child parameter, and string/template sources used for multi-resource child params.

Do not put both `paramTemplates.<name>` and `paramBindings.<name>` on the same child parameter. Every `paramBindings` value source of type `param` must name a parameter declared by the parent workflow whose declared type matches the child parameter. For file/directory child params, the parent parameter must also use the same `allowMultiple` value. Existing single-resource configs may still receive an absolute path string from `paramTemplates`, `static`, or `node_output`. Multi-resource child params must directly bind a matching multi-resource parent param; they reject templates, `static`, and `node_output`. Single and multi resource params are never converted automatically.

At runtime, the call node reads and validates the child workflow's latest saved definition before any child node executes. It returns only the child workflow End output as the workflow_call node output. It does not lock a child version and does not expose arbitrary child node outputs.

## Generating a DOCX

Use a **document_template_docx_generate** node with `templatePath`, `outputPath`, `dataSource`, `overwrite`, and `variables`. Set `dataPath` when `dataSource` is `dataPath`, or `dataJson` when it is `inline`. Paths and inline JSON support `{{variable}}` interpolation. The node output is the generated output path; generation metadata is available in the result outputs.

## Extracting Document Text

Use a **text_extract** node with only `filePath` and `variables`. `filePath` must resolve to one absolute local `.pdf` or `.docx` path and may use `{{variable}}` interpolation from a workflow parameter or upstream output. The node output is the complete extracted text, including a successful empty string for an empty document. Result metadata contains `format`, `fileName`, `size`, and PDF `pages` when available; it does not repeat the text. The node does not support OCR, multiple files, Drive references, or URLs.

## Opening a Local File with the Default Application

Use an **open_file** node with only `filePath` and `variables`. After interpolation, `filePath` must be an absolute path to an existing local regular file. URLs, `file://` values, directories, symbolic links, multiple files, file-type restrictions, and selecting a specific application are not supported. The node requires both `fs.read.outside-userdata` and `shell.exec`; any denial fails before the operating-system request is submitted.

Success means Electron accepted the `shell.openPath()` request and returned an empty error string. The primary output and `outputs.path` are the exact submitted absolute path. It does not wait for or guarantee that the default application finishes launching, gains focus, or loads the file. Manual runs, nested workflows, reruns, and Automation all perform the real action; Automation or reruns can therefore open the file repeatedly. Cancellation is checked immediately before submission, but a submitted operating-system request cannot be revoked.

## Running Codex

Use a **codex** node when the workflow should run the user's local Codex CLI in a project directory.

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

Config fields:

- `prompt` — Codex instruction template. Use `{{variableName}}` placeholders declared in `variables`.
- `variables` — bindings from workflow params, upstream node outputs, or static values.
- `projectId?` — execution project. If omitted, the node inherits workflow `defaultProjectId`. The effective project must exist in the current Synapse project or repository configuration.
- `workingDirectory?` — per-task working directory. Supports `{{variableName}}`, must already exist, and becomes both process cwd and Codex `--cd`. It is not automatically added to `additionalWritableDirs`.
- `timeoutMins?` — optional node timeout in minutes.
- `approvalPolicy` — `"never"`, `"on-request"`, or `"untrusted"`.
- `sandbox` — `"read-only"`, `"workspace-write"`, or `"danger-full-access"`.
- `model?` / `profile?` — optional Codex CLI model/profile.
- `enableSearch` — passes Codex search support when enabled.
- `features.goals` — `"default"`, `"enabled"`, or `"disabled"`.
- `skipGitRepoCheck`, `strictConfig`, `bypassApprovalsAndSandbox`, `bypassHookTrust` — Codex CLI execution flags.
- `additionalWritableDirs` — extra writable directories outside the actual working directory, passed as repeated `--add-dir`.
- `images` — image paths passed as repeated `--image`.
- `configOverrides` — array of `{ "key": "...", "value": "..." }` entries passed as repeated `--config key=value`.
- `captureDebugArtifacts` — stores sanitized debug artifacts and paths when true.

Do not set `providerId` or `modelTier` on codex nodes. They run local `codex exec`, not a Synapse provider. When `bypassApprovalsAndSandbox` is true, keep `approvalPolicy` and `sandbox` in the config for schema validity, but Codex execution uses the bypass flag instead of approval/sandbox CLI flags.

At runtime, the node passes the interpolated prompt through stdin and returns only Codex's final reply as the node output. By default it runs in the resolved project via `--cd`. If `workingDirectory` is set, Synapse interpolates and trims it, requires an existing directory, then uses it as both process cwd and Codex `--cd`; with `workspace-write`, Codex's current workspace is the actual working directory plus any `additionalWritableDirs`. Debug metadata is stored under `outputs.codexDebug`; downstream `node_output` bindings receive the final reply text, not stdout/stderr or debug JSON.

## Running Claude Code

Use a **claude_code** node when the workflow should run the user's local Claude Code CLI in a project directory.

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

Config fields:

- `prompt` — Claude Code instruction template. Use `{{variableName}}` placeholders declared in `variables`.
- `variables` — bindings from workflow params, upstream node outputs, or static values.
- `projectId?` — execution project. If omitted, the node inherits workflow `defaultProjectId`. The effective project must exist in the current Synapse project or repository configuration.
- `workingDirectory?` — per-task working directory. Supports `{{variableName}}`, must already exist, and becomes the Claude Code process cwd.
- `timeoutMins?` — optional node timeout in minutes. If omitted, the node inherits `defaultNodeTimeoutMins`, then falls back to 60 minutes.
- `permissionMode` — `"default"`, `"acceptEdits"`, `"plan"`, `"auto"`, `"dontAsk"`, or `"bypassPermissions"`. Default is `"acceptEdits"`.
- `model?` / `maxTurns?` — optional Claude Code CLI model and turn limit.
- `outputFormat` — `"stream-json"`, `"json"`, or `"text"`. Default is `"stream-json"`.
- `verbose`, `safeMode`, `bareMode`, `noSessionPersistence` — Claude Code print-mode flags.
- `settingSources` — array of `"user"`, `"project"`, and/or `"local"`; must contain at least one value and no duplicates.
- `settingsPath?` / `mcpConfigPath?` — optional files. Values support `{{variableName}}`, resolve relative to the effective working directory, and must already exist.
- `strictMcpConfig` — passes `--strict-mcp-config`.
- `additionalDirectories` — extra directories passed as repeated `--add-dir`. Values support `{{variableName}}` and must resolve to existing directories before run.
- `allowedTools` / `disallowedTools` — repeated Claude Code tool allow/deny rules.
- `captureDebugArtifacts` — stores sanitized debug artifacts and paths when true.

Do not set `providerId` or `modelTier` on claude_code nodes. They run local `claude -p`, not a Synapse provider. The local `claude` executable is resolved from the user's merged PATH; Synapse does not install or select Claude Code for this node.

At runtime, the node passes the interpolated prompt as the `claude -p` query argument and returns only Claude Code's final reply as the node output. If `workingDirectory` is set, Synapse interpolates and trims it, requires an existing directory, then uses it as process cwd. Debug metadata is stored under `outputs.claudeCodeDebug`; downstream `node_output` bindings receive the final reply text, not stdout/stderr or debug JSON.

## Switch Branching

A switch node's config includes `branches: [{ id, label }]` and an optional `defaultBranch`. The AI evaluates the prompt and returns one branch id. Only edges with matching `branch` field activate downstream nodes.

Switch branches are mutually exclusive paths:
- Connect each branch only to the nodes that belong to that branch.
- A branch may fan out to multiple parallel nodes, but those parallel nodes must be specific to that branch.
- Do not connect every branch to the same set of branch-specific nodes. If the paths need to merge, first connect each branch to its own nodes, then connect those nodes to a shared downstream node.
- After reconnecting switch edges, inspect the saved definition and verify each `branch` maps to the intended target node IDs.

## Best Practices

- Always store returned `nodeId` and `edgeId` after creation — you cannot retrieve them later without fetching the full definition.
- Call `app_workflow_node_type_describe` with a node type to get its full config JSON Schema and available providers before configuring.
- Always query available providers before setting `providerId` — do not guess provider IDs.
- Prefer setting `defaultProjectId`/`defaultProviderId`/`defaultModelTier` on the workflow rather than repeating on every prompt/switch node. Script, Codex, and Claude Code nodes inherit `defaultProjectId`; Codex and Claude Code also inherit `defaultNodeTimeoutMins`. None of these local execution nodes inherit provider/model defaults.
- For codex nodes, use `app_workflow_node_type_describe` and configure Codex CLI fields directly; do not set `providerId` or `modelTier`.
- For claude_code nodes, use `app_workflow_node_type_describe` and configure Claude Code CLI fields directly; do not set `providerId` or `modelTier`.
- For workflow_call nodes, configure child workflow params explicitly from the child workflow's current `params`; do not invent param names without reading the child definition.
- Validate with `app_workflow_definition_inspect` before executing.
- Treat `duplicate_switch_branch_targets` warnings as a likely wiring mistake unless the workflow intentionally merges branches immediately.
- Build incrementally with connected saves: create nodes with `incomingEdges`/`outgoingEdges` or use full-definition updates → configure variables → auto-layout → validate → run.
- For complex workflows, sketch the DAG structure first (which nodes, which edges) before making calls.
- After creating, deleting, or reconnecting nodes, call `app_workflow_layout_update` before the final validation or handoff. This method recalculates node positions without opening the UI.
- Avoid long chains of large prompt nodes. Independent prompt nodes run in parallel; use that when possible.
- Do not satisfy a requested node count by making every step a serial AI call. Use `script` nodes for deterministic formatting/filtering, pass summaries instead of full upstream output, and keep the final prompt's input small.
- If a run waits longer than expected, inspect `app_workflow_run_get` for the running/failed node, `durationMs`, configured `timeoutMins`/`defaultNodeTimeoutMins`, and upstream input size. Prompt/switch/codex/claude_code default to 60 minutes unless configured otherwise. For tests or short jobs, set an explicit shorter timeout; for real failures, shorten the prompt/context, split work into parallel branches, or move non-AI transformation into a `script` node before increasing timeout.

## API Reference

See the attached `api-reference.md` for complete tool signatures, parameters, and return values.
