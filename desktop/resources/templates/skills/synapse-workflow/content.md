# Synapse Workflow

You have access to Synapse Workflow — a DAG-based workflow engine exposed via the `synapse-mcp` MCP server. Workflows execute nodes in topological order; independent nodes run in parallel.

## Node Types

- **prompt** — Sends a prompt to an AI model, returns the response as output.
- **switch** — Evaluates input via AI, returns a branch label. Only the matching branch's downstream nodes execute.
- **end** — Terminal node (every workflow has exactly one). Defines the final output template. Cannot be deleted.

## Provider / Model Configuration

Prompt and switch nodes require a provider (AI service) and model tier to execute. You can configure these at two levels:

- **Workflow default** — Set `defaultProviderId` and `defaultModelTier` on the workflow definition. All prompt/switch nodes inherit these unless they override.
- **Node override** — Set `providerId` and `modelTier` directly on a node's config to override the workflow default.

To discover available providers, call `workflow_node_type_describe` with `nodeType: "prompt"` (or `"switch"`). The response includes an `availableProviders` array:
```json
{ "id": "provider-id", "name": "Provider Name", "models": { "default": "model-name", "haiku": "...", "sonnet": "...", "opus": "..." } }
```

Valid `modelTier` values: `"default"`, `"haiku"`, `"sonnet"`, `"opus"`. Use the provider's `id` as `providerId` and pick a tier whose model is available.

## Creating a Workflow (Standard Flow)

1. Call `workflow_node_type_list` to see available node types.
2. Call `workflow_node_type_describe` with `nodeType: "prompt"` to discover available providers and their models.
3. Call `workflow_definition_create` with an optional `name`. This returns `{ id, versionHash }` and creates a workflow with a default end node.
4. Set workflow-level defaults via `workflow_definition_update` — include `defaultProviderId` and `defaultModelTier` so nodes inherit them.
5. Call `workflow_param_update` to define input parameters (each has `name`, `type: "text"|"number"`, optional `default` and `description`).
6. Call `workflow_node_create` for each processing node. Save the returned `nodeId` — you need it to connect edges.
7. Call `workflow_edge_create` to connect nodes. For switch nodes, include a `branch` field matching a branch id.
8. Call `workflow_node_update` to configure each node (set prompt template, variable bindings, optionally override provider/model).
9. Call `workflow_layout_update` to auto-arrange nodes (optional — useful after batch creation to clean up overlapping positions).
10. Call `workflow_definition_inspect` to validate. Fix any errors before executing.
11. Call `workflow_run_execute` with params to start execution. Returns `{ runId }`.
12. Poll `workflow_run_get` with the runId (2-3 second intervals) until status is `completed` or `failed`.

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

## Best Practices

- Always store returned `nodeId` and `edgeId` after creation — you cannot retrieve them later without fetching the full definition.
- Call `workflow_node_type_describe` with a node type to get its full config JSON Schema and available providers before configuring.
- Always query available providers before setting `providerId` — do not guess provider IDs.
- Prefer setting `defaultProviderId`/`defaultModelTier` on the workflow rather than repeating on every node.
- Validate with `workflow_definition_inspect` before executing.
- Build incrementally: create nodes → connect edges → configure → auto-layout → validate → run.
- For complex workflows, sketch the DAG structure first (which nodes, which edges) before making calls.
- After batch-creating nodes, call `workflow_layout_update` to auto-arrange positions before validating.

## API Reference

See the attached `api-reference.md` for complete tool signatures, parameters, and return values.
