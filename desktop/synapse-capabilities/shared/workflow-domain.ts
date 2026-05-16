import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"
import type { CapabilityId } from "./naming"
import { capabilityIdToMcpTool } from "./naming"

// ---------------------------------------------------------------------------
// Capability definitions
// ---------------------------------------------------------------------------

const workflowCapabilities: readonly CapabilityDefinition[] = [
  // Discovery
  { id: "workflow.node_type.list" as CapabilityId, title: "List node types", description: "List available workflow node types with summaries.", mutates: false },
  { id: "workflow.node_type.describe" as CapabilityId, title: "Describe node type", description: "Return full manifest + config JSON Schema for a node type.", mutates: false },
  // Read
  { id: "workflow.definition.list" as CapabilityId, title: "List workflows", description: "List all workflow definitions.", mutates: false },
  { id: "workflow.definition.get" as CapabilityId, title: "Get workflow", description: "Get a full workflow definition by ID.", mutates: false },
  { id: "workflow.definition.inspect" as CapabilityId, title: "Inspect workflow", description: "Validate a workflow definition and return errors/warnings.", mutates: false },
  { id: "workflow.run.get" as CapabilityId, title: "Get run status", description: "Get workflow run status by runId.", mutates: false },
  { id: "workflow.run.list" as CapabilityId, title: "List run history", description: "List run history for a workflow.", mutates: false },
  // Whole write
  { id: "workflow.definition.create" as CapabilityId, title: "Create workflow", description: "Create a new empty workflow with a default end node.", mutates: true },
  { id: "workflow.definition.update" as CapabilityId, title: "Update workflow", description: "Replace a full workflow definition (validate then save).", mutates: true },
  { id: "workflow.definition.delete" as CapabilityId, title: "Delete workflow", description: "Delete a workflow, cancel active runs, and clean up snapshots.", mutates: true },
  // Execute
  { id: "workflow.run.execute" as CapabilityId, title: "Run workflow", description: "Execute a workflow with parameters. Returns runId for polling.", mutates: true },
  { id: "workflow.run.disable" as CapabilityId, title: "Cancel run", description: "Cancel a running workflow execution.", mutates: true },
  // Atomic write
  { id: "workflow.node.create" as CapabilityId, title: "Add node", description: "Add a node to a workflow. Position is auto-calculated if omitted.", mutates: true },
  { id: "workflow.node.update" as CapabilityId, title: "Update node", description: "Update a node's name, position, or config (config is replaced, not merged).", mutates: true },
  { id: "workflow.node.delete" as CapabilityId, title: "Delete node", description: "Delete a node and its connected edges.", mutates: true },
  { id: "workflow.edge.create" as CapabilityId, title: "Add edge", description: "Add a directed edge between two nodes.", mutates: true },
  { id: "workflow.edge.delete" as CapabilityId, title: "Delete edge", description: "Delete an edge by ID.", mutates: true },
  { id: "workflow.param.update" as CapabilityId, title: "Update params", description: "Replace the workflow parameter list.", mutates: true },
]

export const WORKFLOW_DOMAIN: CapabilityDomainDefinition = {
  id: "workflow",
  capabilities: workflowCapabilities,
}

export const WORKFLOW_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  workflowCapabilities.map((c) => [capabilityIdToMcpTool(c.id), c.id]),
)

// ---------------------------------------------------------------------------
// MCP tool definitions (JSON Schema input schemas)
// ---------------------------------------------------------------------------

const SYSTEM_MODEL_DESCRIPTION = `Synapse workflows are directed acyclic graphs (DAGs). Nodes execute in topological order; independent nodes run in parallel. Every workflow must have exactly one "end" node and no cycles. Nodes connect via directed edges (from → to); switch-node edges may carry a "branch" field. Nodes define a "variables" list that binds upstream node outputs or workflow params; reference them in prompt templates with {{variableName}}. Call this tool first to discover available node types, then call workflow_node_type_describe for config details.`

export function buildWorkflowTools(): McpToolDefinition[] {
  return [
    // Discovery
    {
      name: "workflow_node_type_list",
      description: SYSTEM_MODEL_DESCRIPTION,
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "workflow_node_type_describe",
      description: "Return the full manifest for a node type including config JSON Schema, port definitions, and field descriptors. For prompt and switch nodes, also returns `availableProviders` — a list of configured providers with their model names per tier.",
      inputSchema: {
        type: "object",
        properties: { nodeType: { type: "string", description: "Node type identifier (e.g. \"prompt\", \"switch\", \"end\")." } },
        required: ["nodeType"],
      },
    },
    // Read
    {
      name: "workflow_definition_list",
      description: "List all workflow definitions with metadata (id, name, description, version, nodeCount, timestamps).",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "workflow_definition_get",
      description: "Get the full workflow definition JSON by workflow ID. Returns null if not found.",
      inputSchema: {
        type: "object",
        properties: { workflowId: { type: "string", description: "Workflow ID." } },
        required: ["workflowId"],
      },
    },
    {
      name: "workflow_definition_inspect",
      description: "Validate a workflow definition and return { valid, errors, warnings }.",
      inputSchema: {
        type: "object",
        properties: { definition: { type: "object", description: "Full WorkflowDefinition object to validate." } },
        required: ["definition"],
      },
    },
    {
      name: "workflow_run_get",
      description: "Get workflow run status by runId. Returns run status including per-node results, or null if not found.",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string", description: "Run ID returned by workflow_run_execute." } },
        required: ["runId"],
      },
    },
    {
      name: "workflow_run_list",
      description: "List run history (snapshots) for a workflow, newest first.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          limit: { type: "number", description: "Maximum entries to return. Defaults to 20." },
        },
        required: ["workflowId"],
      },
    },
    // Whole write
    {
      name: "workflow_definition_create",
      description: "Create a new empty workflow with a default end node. Returns { id, versionHash }.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "Optional workflow name. Defaults to \"新工作流\"." } },
      },
    },
    {
      name: "workflow_definition_update",
      description: "Replace a full workflow definition. The definition must include the workflow id. Validates before saving.",
      inputSchema: {
        type: "object",
        properties: { definition: { type: "object", description: "Full WorkflowDefinition object including id." } },
        required: ["definition"],
      },
    },
    {
      name: "workflow_definition_delete",
      description: "Delete a workflow by ID. Cancels any active runs and removes run snapshots.",
      inputSchema: {
        type: "object",
        properties: { workflowId: { type: "string", description: "Workflow ID to delete." } },
        required: ["workflowId"],
      },
    },
    // Execute
    {
      name: "workflow_run_execute",
      description: "Execute a workflow with the given parameters. Returns { runId } on success. Use workflow_run_get to poll.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID to execute." },
          params: { type: "object", description: "Key-value parameters matching the workflow's param definitions." },
        },
        required: ["workflowId"],
      },
    },
    {
      name: "workflow_run_disable",
      description: "Cancel a running workflow execution by sending an abort signal.",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string", description: "Run ID to cancel." } },
        required: ["runId"],
      },
    },
    // Atomic write
    {
      name: "workflow_node_create",
      description: "Add a node to a workflow. Position is auto-calculated if omitted. Validates before saving.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          node: {
            type: "object",
            description: "Node specification.",
            properties: {
              name: { type: "string", description: "Display name for the node." },
              type: { type: "string", description: "Node type (e.g. \"prompt\", \"switch\", \"end\")." },
              position: { type: "object", description: "Optional { x, y } position. Auto-calculated if omitted.", properties: { x: { type: "number" }, y: { type: "number" } } },
              config: { type: "object", description: "Node configuration. Use workflow_node_type_describe to see required fields." },
            },
            required: ["name", "type"],
          },
        },
        required: ["workflowId", "node"],
      },
    },
    {
      name: "workflow_node_update",
      description: "Update a node's name, position, or config. Config is replaced entirely (not merged). Validates after update.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          nodeId: { type: "string", description: "Node ID to update." },
          patch: {
            type: "object",
            description: "Fields to update. Only provided fields are changed.",
            properties: {
              name: { type: "string" },
              position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
              config: { type: "object", description: "Replaces the entire config object." },
            },
          },
        },
        required: ["workflowId", "nodeId", "patch"],
      },
    },
    {
      name: "workflow_node_delete",
      description: "Delete a node and all its connected edges. Cannot delete the end node.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          nodeId: { type: "string", description: "Node ID to delete." },
        },
        required: ["workflowId", "nodeId"],
      },
    },
    {
      name: "workflow_edge_create",
      description: "Add a directed edge between two nodes. For switch nodes, include a branch field.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          from: { type: "string", description: "Source node ID." },
          to: { type: "string", description: "Target node ID." },
          branch: { type: "string", description: "Optional branch name for switch node edges." },
        },
        required: ["workflowId", "from", "to"],
      },
    },
    {
      name: "workflow_edge_delete",
      description: "Delete an edge by its ID.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          edgeId: { type: "string", description: "Edge ID to delete." },
        },
        required: ["workflowId", "edgeId"],
      },
    },
    {
      name: "workflow_param_update",
      description: "Replace the workflow's parameter list entirely. Pass an empty array to clear all params.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          params: {
            type: "array",
            description: "New parameter list.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string", enum: ["text", "number"] },
                default: { description: "Default value." },
                description: { type: "string" },
              },
              required: ["name", "type"],
            },
          },
        },
        required: ["workflowId", "params"],
      },
    },
  ]
}
