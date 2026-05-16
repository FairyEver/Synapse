# Synapse Workflow MCP — API Reference

All tools are accessed via the `synapse-mcp` MCP server.

---

## Discovery

### workflow_node_type_list

List available node types with summaries.

**Params:** none
**Returns:** `[{ type, title, subtitle, color }]`

### workflow_node_type_describe

Get full manifest and config JSON Schema for a node type.

**Params:** `nodeType` (string, required)
**Returns:** `{ type, title, color, ports, configFields, configSchema }`
**Notes:** Always call this before configuring a node to get the current schema.

---

## Read

### workflow_definition_list

List all workflow definitions.

**Params:** none
**Returns:** `[{ id, name, description?, version, nodeCount, createdAt, updatedAt }]`

### workflow_definition_get

Get full workflow definition by ID.

**Params:** `workflowId` (string, required)
**Returns:** Full `WorkflowDefinition` object (nodes, edges, params) or `null`
### workflow_definition_inspect

Validate a workflow definition without saving.

**Params:** `definition` (object, required) — full WorkflowDefinition
**Returns:** `{ valid, errors, warnings }`

### workflow_run_get

Get execution status by run ID.

**Params:** `runId` (string, required)
**Returns:** `{ status, nodeResults, error? }` or snapshot from history, or `null`
**Notes:** Checks in-memory active runs first, then persisted snapshots.

### workflow_run_list

List run history for a workflow (newest first).

**Params:** `workflowId` (string, required), `limit?` (number, default 20)
**Returns:** Array of run snapshots

---

## Write (Whole Definition)

### workflow_definition_create

Create a new empty workflow with a default end node.

**Params:** `name?` (string)
**Returns:** `{ id, versionHash }`

### workflow_definition_update

Replace a full workflow definition. Validates before saving.

**Params:** `definition` (object, required) — must include `id`
**Returns:** `{ versionHash }`
**Notes:** Config is replaced entirely, not merged.

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
**Notes:** Include `branch` for edges from switch nodes.

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

## Execute

### workflow_run_execute

Execute a workflow with parameters.

**Params:** `workflowId` (string, required), `params?` (object — key-value matching param definitions)
**Returns:** `{ runId }`
**Notes:** Poll `workflow_run_get` with the returned runId to track progress.

### workflow_run_disable

Cancel a running workflow execution.

**Params:** `runId` (string, required)
**Returns:** `{ ok: true }`
