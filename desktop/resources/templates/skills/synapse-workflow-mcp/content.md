# Synapse Workflow MCP

You have access to Synapse Workflow MCP tools for creating, editing, validating, and running Synapse workflow definitions. Synapse workflows are DAG-based: nodes execute in topological order, and independent nodes run in parallel. When you add, delete, or reconnect workflow nodes, finish by calling `workflow_layout_update` so the saved workflow opens with a clean layout in the UI.

## Scope Boundary

Use this skill only for Synapse workflow definitions, workflow nodes, workflow edges, workflow validation, workflow layout, and workflow runs.

Do not treat this as the umbrella skill for every Synapse MCP capability. Database tables and rows, scheduler tasks, built-in rules, built-in skills, prompts, and other Synapse resource publishing flows should live in their own dedicated Synapse MCP skills or rules when available.

If a user asks for another Synapse MCP domain while this skill is active, switch to the matching dedicated skill or rule if available. If no dedicated resource exists, use the relevant MCP tools directly and keep the workflow-specific guidance here out of that task.

## Node Types

- **prompt** — Sends a prompt to an AI model, returns the response as output. Requires a provider.
- **switch** — Evaluates input via AI, returns a branch label. Only the matching branch's downstream nodes execute. Requires a provider.
- **http_request** — Sends an HTTP request (GET/POST/PUT/PATCH/DELETE) and returns the response. Supports headers, query params, JSON/text body, auth (bearer/basic), and timeout. No provider needed.
- **script** — Executes a shell script (posix/cmd/powershell) and returns stdout as output. Supports env vars, timeout, and login shell mode. No provider needed.
- **end** — Terminal node (every workflow has exactly one). Defines the final output template. Cannot be deleted.

## Provider / Model Configuration

Only **prompt** and **switch** nodes require a provider (AI service) and an execution project. **http_request** and **script** nodes execute without provider configuration. Configure project/provider/model with these exact field names:

- **Workflow defaults** — Set `defaultProjectId`, `defaultProviderId`, `defaultModelTier`, and optionally `defaultNodeTimeoutMins` on the workflow definition. Prompt/switch nodes inherit these unless they override.
- **Node overrides** — Set `projectId`, `providerId`, `modelTier`, and optionally `timeoutMins` directly on a node's config.

To discover available providers, call `workflow_node_type_describe` with `nodeType: "prompt"` (or `"switch"`). The response includes an `availableProviders` array:
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

1. Call `workflow_node_type_list` to see available node types.
2. Call `workflow_node_type_describe` with `nodeType: "prompt"` before choosing any AI node config. Use the returned `availableProviders` to choose the exact `providerId` and `modelTier`.
3. Call `workflow_definition_create` with `name`, `defaultProjectId`, `defaultProviderId`, `defaultModelTier`, and optional `defaultNodeTimeoutMins` when known. This returns `{ id, versionHash }` and creates a workflow with a default end node.
4. If defaults were not set during create, call `workflow_definition_get`, update the full definition with `defaultProjectId`, `defaultProviderId`, `defaultModelTier`, and optional `defaultNodeTimeoutMins`, then call `workflow_definition_update`.
5. Call `workflow_param_update` to define input parameters.
6. Create schema-valid node placeholders with `workflow_node_create`. For prompt/switch placeholders, include minimal valid prompt text and `variables: []`; do not bind `node_output` variables yet. Save every returned `nodeId`.
7. Create all structural edges with `workflow_edge_create`. For switch nodes, include a `branch` field matching a branch id.
8. Update node configs with `workflow_node_update`: add final prompt templates and `variables`, including `node_output` bindings now that upstream edges exist.
9. Call `workflow_layout_update` after node/edge changes.
10. Call `workflow_definition_inspect` and fix errors before executing.
11. Call `workflow_run_execute` with params to start execution. Returns `{ runId }`.
12. Poll `workflow_run_get` with the runId (2-3 second intervals) until status is `completed` or `failed`.

The create order is fixed for workflows with node-to-node variables: create schema-valid node placeholders → create edges → update node `variables` → layout → inspect. This avoids illegal references to nodes that are not upstream yet.

## Variable Bindings

Nodes declare a `variables` array. Each binding has:
- `name` — referenced in the prompt template as `{{name}}`
- `source` — one of:
  - `{ type: "param", param: "paramName" }` — workflow input parameter
  - `{ type: "node_output", node: "nodeId" }` — output from an upstream node
  - `{ type: "static", value: "..." }` — hardcoded string

## Prompt Templates

Use `{{variableName}}` to interpolate bound variables into prompt text. All referenced variables must be declared in the node's `variables` array.

## Switch Branching

A switch node's config includes `branches: [{ id, label }]` and an optional `defaultBranch`. The AI evaluates the prompt and returns one branch id. Only edges with matching `branch` field activate downstream nodes.

Switch branches are mutually exclusive paths:
- Connect each branch only to the nodes that belong to that branch.
- A branch may fan out to multiple parallel nodes, but those parallel nodes must be specific to that branch.
- Do not connect every branch to the same set of branch-specific nodes. If the paths need to merge, first connect each branch to its own nodes, then connect those nodes to a shared downstream node.
- After reconnecting switch edges, inspect the saved definition and verify each `branch` maps to the intended target node IDs.

## Best Practices

- Always store returned `nodeId` and `edgeId` after creation — you cannot retrieve them later without fetching the full definition.
- Call `workflow_node_type_describe` with a node type to get its full config JSON Schema and available providers before configuring.
- Always query available providers before setting `providerId` — do not guess provider IDs.
- Prefer setting `defaultProjectId`/`defaultProviderId`/`defaultModelTier` on the workflow rather than repeating on every node.
- Validate with `workflow_definition_inspect` before executing.
- Treat `duplicate_switch_branch_targets` warnings as a likely wiring mistake unless the workflow intentionally merges branches immediately.
- Build incrementally: create nodes → connect edges → configure → auto-layout → validate → run.
- For complex workflows, sketch the DAG structure first (which nodes, which edges) before making calls.
- After creating, deleting, or reconnecting nodes, call `workflow_layout_update` before the final validation or handoff. This method recalculates node positions without opening the UI.
- Avoid long chains of large prompt nodes. Independent prompt nodes run in parallel; use that when possible.
- Do not satisfy a requested node count by making every step a serial AI call. Use `script` nodes for deterministic formatting/filtering, pass summaries instead of full upstream output, and keep the final prompt's input small.
- If a run fails with a timeout such as `Execution exceeded 120000ms`, inspect `workflow_run_get` for the failed node, `durationMs`, configured `timeoutMins`/`defaultNodeTimeoutMins`, and upstream input size. Then shorten the prompt/context, split work into parallel branches, or move non-AI transformation into a `script` node before increasing timeout.

## API Reference

See the attached `api-reference.md` for complete tool signatures, parameters, and return values.
