import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"
import type { CapabilityId } from "./naming"
import {
  buildPrimaryAndLegacyMcpToolActions,
  withPrimaryAndLegacyMcpTools,
} from "./mcp-aliases"

// ---------------------------------------------------------------------------
// Capability definitions
// ---------------------------------------------------------------------------

const workflowCapabilities: readonly CapabilityDefinition[] = [
  // Discovery
  { id: "app.workflow.node_type.list" as CapabilityId, title: "List node types", description: "List available workflow node types with summaries.", mutates: false },
  { id: "app.workflow.node_type.describe" as CapabilityId, title: "Describe node type", description: "Return full manifest + config JSON Schema for a node type.", mutates: false },
  // Read
  { id: "app.workflow.definition.list" as CapabilityId, title: "List workflows", description: "List all workflow definitions.", mutates: false },
  { id: "app.workflow.definition.get" as CapabilityId, title: "Get workflow", description: "Get a full workflow definition by ID.", mutates: false },
  { id: "app.workflow.definition.inspect" as CapabilityId, title: "Inspect workflow", description: "Validate a workflow definition and return errors/warnings.", mutates: false },
  { id: "app.workflow.run.get" as CapabilityId, title: "Get run status", description: "Get workflow run status by workflowId and runId.", mutates: false },
  { id: "app.workflow.run.list" as CapabilityId, title: "List run history", description: "List up to 20 run-history snapshots for a workflow.", mutates: false },
  // Whole write
  { id: "app.workflow.definition.create" as CapabilityId, title: "Create workflow", description: "Create a new empty workflow with a default end node.", mutates: true },
  { id: "app.workflow.definition.update" as CapabilityId, title: "Update workflow", description: "Replace a full workflow definition (validate then save).", mutates: true },
  { id: "app.workflow.definition.delete" as CapabilityId, title: "Delete workflow", description: "Delete a current workflow, cancel active runs, and clean up snapshots. Protected future-schema or migration-failed documents cannot be deleted.", mutates: true },
  // Execute
  { id: "app.workflow.run.execute" as CapabilityId, title: "Run workflow", description: "Execute a workflow with parameters. Returns runId for polling.", mutates: true },
  { id: "app.workflow.run.disable" as CapabilityId, title: "Cancel run", description: "Cancel a running workflow execution. Returns whether an active run received the abort signal.", mutates: true },
  // Atomic write
  { id: "app.workflow.node.create" as CapabilityId, title: "Add node", description: "Add a node to a workflow. Position is auto-calculated if omitted.", mutates: true },
  { id: "app.workflow.node.update" as CapabilityId, title: "Update node", description: "Update a node's name, position, or config (config is replaced, not merged).", mutates: true },
  { id: "app.workflow.node.delete" as CapabilityId, title: "Delete node", description: "Delete a node and its connected edges.", mutates: true },
  { id: "app.workflow.edge.create" as CapabilityId, title: "Add edge", description: "Add a directed edge between two nodes.", mutates: true },
  { id: "app.workflow.edge.delete" as CapabilityId, title: "Delete edge", description: "Delete an edge by ID.", mutates: true },
  { id: "app.workflow.param.update" as CapabilityId, title: "Update params", description: "Replace the workflow parameter list.", mutates: true },
  // Layout
  { id: "app.workflow.layout.update" as CapabilityId, title: "Auto-layout", description: "Reposition workflow nodes using the same pure auto-layout algorithm as the UI editor.", mutates: true },
]

export const WORKFLOW_DOMAIN: CapabilityDomainDefinition = {
  id: "workflow",
  capabilities: workflowCapabilities,
}

export const WORKFLOW_MCP_TOOL_ACTIONS: Record<string, string> = buildPrimaryAndLegacyMcpToolActions(
  workflowCapabilities,
  { legacyPrefix: "workflow", primaryPrefix: "app_workflow" },
)

// ---------------------------------------------------------------------------
// MCP tool definitions (JSON Schema input schemas)
// ---------------------------------------------------------------------------

const SYSTEM_MODEL_DESCRIPTION = `Synapse workflows are directed acyclic graphs (DAGs). Nodes execute in topological order; independent nodes run in parallel. Workflow params support text, number, file, directory, and option types; option labels and values are the same string, and custom run values are not saved back to the definition. file/directory values are resource references such as { kind: "local_path", entryType: "file", path: "/abs/file.txt" }; set allowMultiple=true to accept an ordered, non-empty array of up to 100 unique references. Available node types include prompt, switch, http_request, script, workflow_call, document_template_docx_generate, codex, claude_code, and end. The nested-workflow node type is exactly "workflow_call"; "app_workflow_call" is not a valid node type. Every workflow must have exactly one "end" node and no cycles. Nodes connect via directed edges (from → to); switch-node edges may carry a "branch" field. Switch branches are mutually exclusive: connect each branch only to its own downstream nodes, then merge after those branch-specific nodes if needed. Nodes define a "variables" list that binds upstream node outputs or workflow params. Use {{variableName}} only in supported template fields; script variables are injected as environment variables instead of template text. A workflow_call node invokes another saved workflow and maps text/number/option child params through paramTemplates. Every child param without a default requires a non-empty template or binding before save, and every value binding from a parent param must reference a param declared by the parent workflow. Single file/directory child params retain legacy string-template and static/node_output value-binding compatibility. Multi-select file/directory child params must use a paramBindings value binding from a parent param with the same resource kind and allowMultiple=true; templates and string value sources are rejected before save. The node returns the child workflow's End output. A document_template_docx_generate node generates a DOCX from a template and either a JSON file or inline JSON data. A script node runs shell code in the effective project workspace, so workflow defaultProjectId is required because script config has no node-level projectId field. A codex node runs local codex exec, needs an effective project, may set a per-task workingDirectory, and returns Codex's final reply text. A claude_code node runs the user's local Claude Code CLI via claude -p, needs an effective project, may set workingDirectory and Claude Code settings/MCP paths, and returns Claude Code's final reply text. Call this tool first to discover available node types, then call workflow_node_type_describe for config details.`

const modelTierSchema = {
  type: "string",
  enum: ["default", "haiku", "sonnet", "opus"],
  description: "Model tier used with providerId. Discover valid providerId/modelTier pairs with workflow_node_type_describe.",
}

const variableBindingSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "Variable name referenced as {{name}}." },
    source: {
      type: "object",
      description: "Variable source: { type: 'param', param }, { type: 'node_output', node }, or { type: 'static', value }.",
    },
  },
  required: ["name", "source"],
}

const workflowNodeIdSchema = {
  type: "string",
  pattern: "^[A-Za-z0-9_-]+$",
  description: "Workflow node ID. Use only letters, numbers, underscore, or hyphen.",
}

const incomingEdgeCreateSchema = {
  type: "object",
  properties: {
    from: { ...workflowNodeIdSchema, description: "Existing upstream node ID to connect into the new node." },
    branch: { type: "string", description: "Required when the upstream node is a switch branch." },
  },
  required: ["from"],
}

const outgoingEdgeCreateSchema = {
  type: "object",
  properties: {
    to: { ...workflowNodeIdSchema, description: "Existing downstream node ID to connect from the new node." },
    branch: { type: "string", description: "Use only when the new node itself is a switch node." },
  },
  required: ["to"],
}

const codexFeatureStateSchema = {
  type: "string",
  enum: ["default", "enabled", "disabled"],
  description: "codex only: feature state passed as --enable/--disable when not default.",
}

const codexConfigOverrideSchema = {
  type: "object",
  properties: {
    key: { type: "string", minLength: 1, description: "codex only: non-empty Codex config key." },
    value: { type: "string", description: "codex only: raw Codex config value." },
  },
  required: ["key", "value"],
}

const workflowParamTypeSchema = {
  type: "string",
  enum: ["text", "number", "file", "directory", "option"],
  description: "Workflow parameter type. file and directory params receive resource references, not file bytes. option params use the same string for label and value.",
}

const workflowParamDefaultDescription = "Default value. Use null for required params. For file/directory, use a resource ref such as { kind: 'local_path', entryType: 'file', path: '/abs/file.txt' } or { kind: 'local_path', entryType: 'directory', path: '/abs/dir' }. When allowMultiple=true, use a non-empty array of up to 100 unique refs. For option params, the default must be one of the configured option strings; allowCustomOption only permits custom values at run time."

const workflowParamSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    type: workflowParamTypeSchema,
    default: { description: workflowParamDefaultDescription },
    description: { type: "string" },
    options: {
      type: "array",
      items: { type: "string" },
      description: "Allowed option strings for option params. Label and value are the same string.",
    },
    allowCustomOption: {
      type: "boolean",
      description: "When true, runs may pass a custom option string; custom run values are not saved back to the workflow definition.",
    },
    allowMultiple: {
      type: "boolean",
      description: "file/directory only. When true, defaults and run values are ordered non-empty arrays with at most 100 unique resources.",
    },
  },
  required: ["name", "type"],
  allOf: [{
    if: {
      properties: { type: { enum: ["text", "number", "option"] } },
      required: ["type"],
    },
    then: { not: { required: ["allowMultiple"] } },
  }],
}

const workflowDefinitionSchema = {
  type: "object",
  description: "Full WorkflowDefinition object. Preserve the Synapse-managed meta.schemaVersion returned by definition_get; it is separate from the version save revision. Include workflow defaults such as defaultProjectId when prompt/switch/script/codex/claude_code nodes inherit it, defaultProviderId and defaultModelTier when prompt/switch nodes inherit them, and defaultNodeTimeoutMins when prompt/switch/codex/claude_code nodes inherit it.",
  properties: {
    meta: {
      type: "object",
      description: "Synapse-managed schema metadata. Preserve the full object returned by definition_get on whole-definition updates.",
      properties: {
        schemaVersion: { type: "string", description: "SemVer workflow document schema version managed by Synapse." },
      },
      required: ["schemaVersion"],
    },
    id: { type: "string", minLength: 1 },
    name: { type: "string" },
    description: { type: "string" },
    version: { type: "string" },
    createdAt: { type: "number" },
    updatedAt: { type: "number" },
    defaultProjectId: { type: "string", description: "Workflow-level default project/repository id. Prompt, switch, codex, and claude_code nodes need this unless their config sets projectId. Script nodes also need this because script config has no node-level projectId." },
    defaultProviderId: { type: "string", description: "Workflow-level default providerId. Prompt and switch nodes need this unless their config sets providerId." },
    defaultModelTier: modelTierSchema,
    defaultNodeTimeoutMins: { type: "number", description: "Workflow-level default timeout in minutes for prompt, switch, codex, and claude_code nodes." },
    params: {
      type: "array",
      items: workflowParamSchema,
    },
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: workflowNodeIdSchema,
          name: { type: "string" },
          type: { type: "string" },
          position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
          config: {
            type: "object",
            description: "Node config. Prompt/switch support providerId, modelTier, projectId, timeoutMins, prompt, and variables. script uses script, shell, env, pathStrategy, posixLogin, timeoutMins, and variables; resolved variables are injected as environment variables, not {{template}} text, and it needs workflow defaultProjectId because it has no node-level projectId. codex uses prompt, variables, projectId, optional workingDirectory, timeoutMins, approvalPolicy, sandbox, model/profile, Codex feature flags, writable dirs, images, configOverrides, and debug artifact capture. claude_code uses prompt, variables, projectId, optional workingDirectory, timeoutMins, permissionMode, model, maxTurns, outputFormat, settingSources, settingsPath, mcpConfigPath, allowed/disallowed tools, additionalDirectories, and debug artifact capture. workflow_call uses workflowId, variables, paramTemplates, and paramBindings to call a child workflow without provider fields; its exact node type is workflow_call, not app_workflow_call. document_template_docx_generate uses templatePath, outputPath, dataSource, dataPath or dataJson, overwrite, and variables.",
            properties: {
              providerId: { type: "string" },
              modelTier: modelTierSchema,
              projectId: { type: "string" },
              timeoutMins: { type: "number" },
              prompt: { type: "string", description: "prompt/switch/codex/claude_code only: prompt or instruction template. Local CLI prompts are sent to codex exec via stdin and to claude -p as the print query argument." },
              variables: { type: "array", items: variableBindingSchema },
              workflowId: { type: "string", description: "workflow_call only: child workflow ID to invoke." },
              paramTemplates: { type: "object", description: "workflow_call only: child text/number/option parameter name to template string map. Legacy single file/directory templates remain accepted; multi-select resource params cannot use templates." },
              paramBindings: { type: "object", description: "workflow_call only: child parameter name to typed binding map. Template bindings use { mode: 'template', template: '{{variable}}' } and every placeholder must be declared in variables. A param value source must reference a declared parent workflow param. Single file/directory params may use param, node_output, or static string value sources. Multi-select resource params must directly bind a parent param with the same resource kind and allowMultiple value." },
              templatePath: { type: "string", description: "document_template_docx_generate only: DOCX template path. Supports {{variable}} interpolation." },
              outputPath: { type: "string", description: "document_template_docx_generate only: generated DOCX output path. Supports {{variable}} interpolation." },
              dataSource: { type: "string", enum: ["dataPath", "inline"], description: "document_template_docx_generate only: use a JSON file path or inline JSON data." },
              dataPath: { type: "string", description: "document_template_docx_generate only: JSON data file path when dataSource is dataPath. Supports {{variable}} interpolation." },
              dataJson: { type: "string", description: "document_template_docx_generate only: inline JSON text when dataSource is inline. Supports {{variable}} interpolation." },
              overwrite: { type: "boolean", default: false, description: "document_template_docx_generate only: whether an existing output file may be replaced." },
              approvalPolicy: { type: "string", enum: ["never", "on-request", "untrusted"], description: "codex only: Codex approval policy, e.g. never, on-request, or untrusted." },
              sandbox: { type: "string", enum: ["read-only", "workspace-write", "danger-full-access"], description: "codex only: Codex sandbox mode, e.g. read-only, workspace-write, or danger-full-access." },
              workingDirectory: { type: "string", description: "codex/claude_code only: optional per-task working directory. Supports {{variable}} interpolation and must already exist. For codex it becomes process cwd and Codex --cd; for claude_code it becomes process cwd." },
              model: { type: "string", description: "codex/claude_code only: optional local CLI model name." },
              profile: { type: "string", description: "codex only: optional Codex profile passed to codex exec." },
              enableSearch: { type: "boolean", description: "codex only: pass --search before exec." },
              features: {
                type: "object",
                description: "codex only: Codex feature flags.",
                properties: { goals: codexFeatureStateSchema },
                required: ["goals"],
              },
              skipGitRepoCheck: { type: "boolean", description: "codex only: pass --skip-git-repo-check." },
              strictConfig: { type: "boolean", description: "codex only: pass --strict-config." },
              bypassApprovalsAndSandbox: { type: "boolean", description: "codex only: pass --dangerously-bypass-approvals-and-sandbox instead of approval/sandbox flags." },
              bypassHookTrust: { type: "boolean", description: "codex only: pass --dangerously-bypass-hook-trust." },
              additionalWritableDirs: { type: "array", items: { type: "string", minLength: 1 }, description: "codex only: repeated --add-dir entries. Values may use {{variable}} interpolation and must resolve to existing directories before run." },
              images: { type: "array", items: { type: "string", minLength: 1 }, description: "codex only: repeated --image entries. Values may use {{variable}} interpolation and must resolve to existing files before run." },
              configOverrides: { type: "array", items: codexConfigOverrideSchema, description: "codex only: repeated Codex config overrides as { key, value } entries." },
              permissionMode: { type: "string", enum: ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"], description: "claude_code only: Claude Code permission mode passed to claude -p." },
              maxTurns: { type: "number", description: "claude_code only: optional maximum Claude Code turns." },
              outputFormat: { type: "string", enum: ["text", "json", "stream-json"], description: "claude_code only: Claude Code output format." },
              verbose: { type: "boolean", description: "claude_code only: pass --verbose." },
              safeMode: { type: "boolean", description: "claude_code only: pass --safe-mode." },
              bareMode: { type: "boolean", description: "claude_code only: pass --bare." },
              noSessionPersistence: { type: "boolean", description: "claude_code only: pass --no-session-persistence." },
              settingSources: { type: "array", items: { type: "string", enum: ["user", "project", "local"] }, description: "claude_code only: setting sources passed to Claude Code." },
              settingsPath: { type: "string", description: "claude_code only: optional Claude Code settings path. Supports {{variable}} interpolation." },
              mcpConfigPath: { type: "string", description: "claude_code only: optional Claude Code MCP config path. Supports {{variable}} interpolation." },
              strictMcpConfig: { type: "boolean", description: "claude_code only: pass --strict-mcp-config." },
              additionalDirectories: { type: "array", items: { type: "string", minLength: 1 }, description: "claude_code only: additional working directories. Values may use {{variable}} interpolation and must resolve to existing directories before run." },
              allowedTools: { type: "array", items: { type: "string", minLength: 1 }, description: "claude_code only: allowed Claude Code tools." },
              disallowedTools: { type: "array", items: { type: "string", minLength: 1 }, description: "claude_code only: disallowed Claude Code tools." },
              captureDebugArtifacts: { type: "boolean", description: "codex/claude_code only: when true, store sanitized debug artifacts and expose CLI debug paths in run output." },
            },
          },
        },
        required: ["id", "name", "type", "position", "config"],
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          branch: { type: "string" },
        },
        required: ["id", "from", "to"],
      },
    },
  },
  required: ["meta", "id", "name", "params", "nodes", "edges"],
}

export function buildWorkflowTools(): McpToolDefinition[] {
  return withPrimaryAndLegacyMcpTools([
    // Discovery
    {
      name: "workflow_node_type_list",
      description: SYSTEM_MODEL_DESCRIPTION,
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "workflow_node_type_describe",
      description: "Return the full manifest for a node type including config JSON Schema, port definitions, and field descriptors. Treat `configSchema.required` as authoritative, including required booleans and arrays. For prompt and switch nodes, also returns `availableProviders` — a list of configured providers with their model names per tier. Codex and Claude Code nodes do not use providerId/modelTier; inspect their schemas for local CLI options.",
      inputSchema: {
        type: "object",
        properties: { nodeType: { type: "string", description: "Node type identifier (e.g. \"prompt\", \"switch\", \"http_request\", \"script\", \"workflow_call\", \"document_template_docx_generate\", \"codex\", \"claude_code\", \"end\")." } },
        required: ["nodeType"],
      },
    },
    // Read
    {
      name: "workflow_definition_list",
      description: "List all workflow definitions with metadata (id, name, description, version, nodeCount, timestamps, and optional loadError/rawExportAvailable diagnostics). A future-schema workflow may be raw-exportable in the UI but remains unavailable to MCP definition_get, mutation, and execution tools.",
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
      description: "Validate a full workflow definition, including the required Synapse-managed meta.schemaVersion, and return { valid, errors, warnings }. Inspection applies the same schema migration gate as save: supported legacy definitions are migrated in memory, while future or failed schemas return valid=false and must not be interpreted or edited. Workflow Call validation rejects missing required child parameter templates or bindings as well as incompatible resource bindings. Errors include nodeId, nodeName, field, details.missingField, providerId/modelTier/projectId, timeoutMs, and retryable when available.",
      inputSchema: {
        type: "object",
        properties: { definition: workflowDefinitionSchema },
        required: ["definition"],
      },
    },
    {
      name: "workflow_run_get",
      description: "Get workflow run status by workflowId and runId. Returns run status including per-node results with durationMs, input size context, timeoutMs/retryable diagnostics when available, or null if not found or not owned by the workflow. Archived snapshots whose embedded definition is protected after a failed or future-version migration include definitionMigration; do not interpret or reuse the unavailable definition.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID used to execute the run." },
          runId: { type: "string", description: "Run ID returned by workflow_run_execute." },
        },
        required: ["workflowId", "runId"],
      },
    },
    {
      name: "workflow_run_list",
      description: "List bounded run history snapshots for a workflow, newest first. The limit is applied before snapshot content is read and migrated.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          limit: { type: "integer", minimum: 1, maximum: 20, description: "Maximum entries to read and return. Defaults to 20." },
        },
        required: ["workflowId"],
      },
    },
    // Whole write
    {
      name: "workflow_definition_create",
      description: "Create a new empty workflow with a default end node. Returns { id, versionHash }. Prompt/switch nodes need defaultProjectId plus providerId/modelTier defaults unless each node sets projectId/providerId/modelTier itself. Script nodes need defaultProjectId. Codex and Claude Code nodes need defaultProjectId unless their config sets projectId.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Optional workflow name. Defaults to \"新工作流\"." },
          defaultProjectId: { type: "string", description: "Workflow-level default project/repository id for prompt, switch, script, codex, and claude_code nodes." },
          defaultProviderId: { type: "string", description: "Workflow-level default providerId for prompt and switch nodes. Discover with workflow_node_type_describe." },
          defaultModelTier: modelTierSchema,
          defaultNodeTimeoutMins: { type: "number", description: "Workflow-level default timeout in minutes for prompt, switch, codex, and claude_code nodes." },
        },
      },
    },
    {
      name: "workflow_definition_update",
      description: "Replace a full workflow definition. The definition must include the workflow id and Synapse-managed meta.schemaVersion. Validates before saving.",
      inputSchema: {
        type: "object",
        properties: { definition: workflowDefinitionSchema },
        required: ["definition"],
      },
    },
    {
      name: "workflow_definition_delete",
      description: "Delete a current workflow by ID. Cancels active runs and removes snapshots. Protected future-schema or migration-failed documents cannot be deleted.",
      inputSchema: {
        type: "object",
        properties: { workflowId: { type: "string", description: "Workflow ID to delete." } },
        required: ["workflowId"],
      },
    },
    // Execute
    {
      name: "workflow_run_execute",
      description: "Execute a workflow with the given parameters. Returns { runId } on success. Use workflow_run_get with this workflowId and the returned runId to poll. For option params, pass strings; closed options must match configured values, while custom-enabled options accept non-empty custom strings.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID to execute." },
          params: { type: "object", description: "Key-value parameters matching the workflow's param definitions. Unknown keys are rejected. For single file/directory params, pass a local path string or resource ref; leading and trailing path whitespace is significant and preserved. When allowMultiple=true, pass an ordered non-empty array of up to 100 unique path strings and/or refs; one item is still an array. For option params, pass a string; closed options must match one configured option value, while allowCustomOption=true accepts a non-empty custom string. Custom run values are not saved back to the workflow definition." },
        },
        required: ["workflowId"],
      },
    },
    {
      name: "workflow_run_disable",
      description: "Cancel a running workflow execution owned by a specific workflow. Returns { runId, cancelRequested }, where cancelRequested=false means the run was not active or did not belong to that workflow and the request was treated as an idempotent success.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID used to execute the run." },
          runId: { type: "string", description: "Run ID to cancel." },
        },
        required: ["workflowId", "runId"],
      },
    },
    // Atomic write
    {
      name: "workflow_node_create",
      description: "Add a node to a workflow. Position is auto-calculated if omitted. Validates before saving. Use incomingEdges/outgoingEdges to create the node and its connecting edges in the same validated mutation; for larger DAG rewrites, prefer workflow_definition_update.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          node: {
            type: "object",
            description: "Node specification.",
            properties: {
              name: { type: "string", description: "Display name for the node." },
              type: { type: "string", description: "Node type (e.g. \"prompt\", \"switch\", \"http_request\", \"script\", \"workflow_call\", \"document_template_docx_generate\", \"codex\", \"claude_code\", \"end\")." },
              position: { type: "object", description: "Optional { x, y } position. Auto-calculated if omitted.", properties: { x: { type: "number" }, y: { type: "number" } } },
              config: { type: "object", description: "Required node configuration. Use workflow_node_type_describe to see required fields and minimal valid config for the selected type." },
            },
            required: ["name", "type", "config"],
          },
          incomingEdges: {
            type: "array",
            description: "Optional edges from existing nodes into the new node, created in the same validated mutation. Each item is { from, branch? }; branch is required when the upstream node is a switch.",
            items: incomingEdgeCreateSchema,
          },
          outgoingEdges: {
            type: "array",
            description: "Optional edges from the new node to existing nodes, created in the same validated mutation. Each item is { to, branch? }; branch is only for switch nodes.",
            items: outgoingEdgeCreateSchema,
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
          nodeId: { ...workflowNodeIdSchema, description: "Node ID to update." },
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
          nodeId: { ...workflowNodeIdSchema, description: "Node ID to delete." },
        },
        required: ["workflowId", "nodeId"],
      },
    },
    {
      name: "workflow_edge_create",
      description: "Add a directed edge between two nodes. For switch nodes, include a branch field and connect only the matching branch's downstream nodes; do not connect every branch to the same set of branch-specific nodes.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          from: { ...workflowNodeIdSchema, description: "Source node ID." },
          to: { ...workflowNodeIdSchema, description: "Target node ID." },
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
            items: workflowParamSchema,
          },
        },
        required: ["workflowId", "params"],
      },
    },
    // Layout
    {
      name: "workflow_layout_update",
      description: "Reposition all nodes in a workflow using the same pure auto-layout algorithm as the UI editor. Saves the updated positions. Call this after adding, deleting, or reconnecting nodes so the workflow opens cleanly in the UI.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          direction: { type: "string", enum: ["LR", "TB"], description: "Layout direction: LR (left-to-right, default) or TB (top-to-bottom)." },
        },
        required: ["workflowId"],
      },
    },
  ], { legacyPrefix: "workflow", primaryPrefix: "app_workflow" })
}
