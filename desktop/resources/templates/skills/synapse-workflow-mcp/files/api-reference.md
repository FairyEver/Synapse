# Synapse Workflow MCP — API Reference

All tools are accessed via the `synapse-mcp` MCP server.

---

## Discovery

### workflow_node_type_list

List available node types with summaries. Current built-in node types include `prompt`, `switch`, `http_request`, `script`, `workflow_call`, `codex`, and `end`.

**Params:** none
**Returns:** `[{ type, title, subtitle, color }]`

### workflow_node_type_describe

Get full manifest and config JSON Schema for a node type.

**Params:** `nodeType` (string, required)
**Returns:** `{ type, title, color, ports, configFields, configSchema, availableProviders? }`
**Notes:** Always call this before configuring a node to get the current schema. For `prompt` and `switch` nodes, the response also includes `availableProviders` — an array of `{ id, name, models: { default?, haiku?, sonnet?, opus? } }`. Use this to discover valid `providerId` values. `codex` nodes do not use `providerId` or `modelTier`; inspect `nodeType: "codex"` for Codex CLI fields. If the user provides a copied reference such as `synapse-provider-model://local-claude-code/sonnet`, parse it as `providerId = "local-claude-code"` and `modelTier = "sonnet"`.

---

## Node Type Config Reference

These are the key config fields for each node type. Always call `workflow_node_type_describe` for the full JSON Schema.

### prompt

- `prompt` (string) — prompt template text with `{{variable}}` placeholders
- `variables` (array) — variable bindings
- `providerId?` / `modelTier?` — override workflow-level provider defaults

### switch

- `prompt` (string) — evaluation prompt
- `branches` (array of `{ id, label }`) — possible branch outcomes
- `defaultBranch?` (string) — fallback branch id
- `variables` (array) — variable bindings
- `providerId?` / `modelTier?` — override workflow-level provider defaults

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

No provider needed. Config fields:

- `script` (string) — shell script content
- `shell` (enum: posix/cmd/powershell, default "posix")
- `env?` (object) — key-value environment variables
- `pathStrategy?` (enum: merge/replace) — PATH handling
- `posixLogin?` (boolean) — run as login shell (posix only)
- `timeoutMins?` (number) — execution timeout in minutes
- `variables` (array) — variable bindings

### workflow_call

No provider needed on the call node. It invokes another saved workflow and returns that child workflow's End output.

- `workflowId` (string) — child workflow ID to call. Must not be the current workflow ID.
- `variables` (array) — variable bindings from parent workflow params, upstream node outputs, or static values
- `paramTemplates` (object) — child param name to template string map. Values may use `{{variable}}` placeholders declared in `variables`.

Before configuring `paramTemplates`, call `workflow_definition_get` for the child workflow and read its current `params`. Child prompt/switch nodes still need provider/model/project through the child workflow defaults or child node overrides; child codex nodes still need an effective project. The parent workflow_call node does not lock a child version; each run uses the child workflow's latest saved definition.

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
- `additionalWritableDirs` (string[]) — repeated `--add-dir` values
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

The node passes the prompt through stdin and returns only Codex's final reply text as `output`. By default it runs with `--cd` set to the resolved project workspace. If `workingDirectory` is set, Synapse interpolates and trims it, requires an existing directory, then uses it as both process cwd and Codex `--cd`; configure `additionalWritableDirs` separately for cross-directory writes. Debug metadata is available in `outputs.codexDebug`, but downstream `node_output` bindings receive the final reply text only.

### end

- `outputTemplate` (string) — final output template with `{{variable}}` placeholders
- `variables` (array) — variable bindings

---

## Read

### workflow_definition_list

List all workflow definitions.

**Params:** none
**Returns:** `[{ id, name, description?, version, nodeCount, createdAt, updatedAt }]`

### workflow_definition_get

Get full workflow definition by ID.

**Params:** `workflowId` (string, required)
**Returns:** Full `WorkflowDefinition` object (nodes, edges, params, `defaultProjectId?`, `defaultProviderId?`, `defaultModelTier?`, `defaultNodeTimeoutMins?`) or `null`
### workflow_definition_inspect

Validate a workflow definition without saving.

**Params:** `definition` (object, required) — full WorkflowDefinition
**Returns:** `{ valid, errors, warnings }`
**Notes:** Validation errors may include `nodeId`, `nodeName`, `field`, `retryable`, and `details` such as `missingField`, `providerId`, `modelTier`, `projectId`, and `timeoutMs`.

### workflow_run_get

Get execution status by run ID.

**Params:** `runId` (string, required)
**Returns:** `{ status, nodeResults, error? }` or snapshot from history, or `null`
**Notes:** Checks in-memory active runs first, then persisted snapshots.
Node results include `durationMs` when available. For failures, inspect the failed node's `error`, `durationMs`, effective provider/model/project fields, timeout config, and upstream input size before retrying.

### workflow_run_list

List run history for a workflow (newest first).

**Params:** `workflowId` (string, required), `limit?` (number, default 20)
**Returns:** Array of run snapshots

---

## Write (Whole Definition)

### workflow_definition_create

Create a new empty workflow with a default end node.

**Params:** `name?` (string), `defaultProjectId?` (string), `defaultProviderId?` (string), `defaultModelTier?` (`"default"|"haiku"|"sonnet"|"opus"`), `defaultNodeTimeoutMins?` (number)
**Returns:** `{ id, versionHash }`
**Notes:** Prompt/switch nodes require an effective project, provider, and model tier. Codex nodes require an effective project but no provider/model tier. Set workflow defaults here or set `projectId`/`providerId`/`modelTier` on each prompt/switch node and `projectId` on each codex node.

### workflow_definition_update

Replace a full workflow definition. Validates before saving.

**Params:** `definition` (object, required) — must include `id`
**Returns:** `{ versionHash }`
**Notes:** Config is replaced entirely, not merged. Include `defaultProjectId`, `defaultProviderId`, `defaultModelTier`, and optional `defaultNodeTimeoutMins` to set workflow-level defaults.

### workflow_definition_delete

Delete a workflow. Cancels active runs and removes snapshots.

**Params:** `workflowId` (string, required)
**Returns:** `{ ok: true }`

---

## Write (Atomic Mutations)

### workflow_node_create

Add a node to a workflow.

**Params:** `workflowId` (string, required), `node: { name, type, position?, config? }`
**Returns:** `{ nodeId, versionHash, validation? }`
**Notes:** Position auto-calculated if omitted. Save `nodeId` for edge creation.

### workflow_node_update

Update a node's name, position, or config.

**Params:** `workflowId` (string, required), `nodeId` (string, required), `patch: { name?, position?, config? }`
**Returns:** `{ versionHash, validation? }`
**Notes:** `config` is replaced entirely (not merged with existing).

### workflow_node_delete

Delete a node and all connected edges.

**Params:** `workflowId` (string, required), `nodeId` (string, required)
**Returns:** `{ removedEdgeCount, versionHash, validation? }`
**Notes:** Cannot delete the end node — will throw an error.

### workflow_edge_create

Add a directed edge between two nodes.

**Params:** `workflowId` (string, required), `from` (string, required), `to` (string, required), `branch?` (string)
**Returns:** `{ edgeId, versionHash, validation? }`
**Notes:** Include `branch` for edges from switch nodes. Switch branches are mutually exclusive; connect each branch only to its own downstream nodes. If multiple branches connect to the same multi-node target set, validation returns a `duplicate_switch_branch_targets` warning.

### workflow_edge_delete

Delete an edge by ID.

**Params:** `workflowId` (string, required), `edgeId` (string, required)
**Returns:** `{ versionHash, validation? }`

### workflow_param_update

Replace the workflow's parameter list entirely.

**Params:** `workflowId` (string, required), `params` (array, required) — each: `{ name, type: "text"|"number", default?, description? }`
**Returns:** `{ versionHash, validation? }`
**Notes:** Pass empty array to clear all params.

---

## Layout

### workflow_layout_update

Reposition all nodes using the same pure auto-layout algorithm as the UI editor. Saves the updated positions.

**Params:** `workflowId` (string, required), `direction?` (string, `"LR"` or `"TB"`, default `"LR"`)
**Returns:** `{ versionHash, validation? }`
**Notes:** `LR` arranges nodes left-to-right, `TB` arranges top-to-bottom. The UI editor reflects the changes on next load. Call this after adding, deleting, or reconnecting nodes so agents can clean up layout without opening the UI.

---

## Execute

### workflow_run_execute

Execute a workflow with parameters.

**Params:** `workflowId` (string, required), `params?` (object — key-value matching param definitions)
**Returns:** `{ runId }`
**Notes:** Poll `workflow_run_get` with the returned runId to track progress.

### workflow_run_disable

Cancel a running workflow execution.

**Params:** `runId` (string, required)
**Returns:** `{ runId, cancelRequested }`

**Notes:** `cancelRequested` is true when Synapse found an active run and sent an abort signal. It is false when the run is no longer active; the request still succeeds idempotently.
