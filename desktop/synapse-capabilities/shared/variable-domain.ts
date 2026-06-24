import type { CapabilityId } from "./naming"
import {
  buildPrimaryAndLegacyMcpToolActions,
  withPrimaryAndLegacyMcpTools,
} from "./mcp-aliases"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const variableCapabilities: readonly CapabilityDefinition[] = [
  {
    id: "app.settings.variable.item.list" as CapabilityId,
    title: "List variables",
    description: "List user local variables without values.",
    mutates: false,
  },
  {
    id: "app.settings.variable.item.get" as CapabilityId,
    title: "Get variable",
    description: "Get one local variable, optionally including its value.",
    mutates: false,
  },
  {
    id: "app.settings.variable.item.create" as CapabilityId,
    title: "Create variable",
    description: "Create one user local variable.",
    mutates: true,
  },
  {
    id: "app.settings.variable.item.update" as CapabilityId,
    title: "Update variable",
    description: "Update or rename one existing local variable.",
    mutates: true,
  },
  {
    id: "app.settings.variable.item.upsert" as CapabilityId,
    title: "Upsert variable",
    description: "Create or update one local variable.",
    mutates: true,
  },
  {
    id: "app.settings.variable.item.delete" as CapabilityId,
    title: "Delete variable",
    description: "Delete one user local variable.",
    mutates: true,
  },
]

export const VARIABLE_DOMAIN: CapabilityDomainDefinition = {
  id: "variable",
  capabilities: variableCapabilities,
}

export const VARIABLE_MCP_TOOL_ACTIONS: Record<string, string> = buildPrimaryAndLegacyMcpToolActions(
  variableCapabilities,
  { legacyPrefix: "variable", primaryPrefix: "app_settings_variable" },
)

const nameProperty = {
  type: "string",
  description: "Variable name. Must contain only letters, digits, and underscores.",
}

const descriptionProperty = {
  type: "string",
  description: "Optional description. Pass an empty string to clear an existing description.",
}

const valueProperty = {
  type: "string",
  description: "Variable value. Values are treated as sensitive and are never returned by mutation tools.",
}

export function buildVariableTools(): McpToolDefinition[] {
  return withPrimaryAndLegacyMcpTools([
    {
      name: "variable_item_list",
      description: "List user-scoped Synapse local variables without returning values.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "variable_item_get",
      description: "Get one user-scoped local variable. The value is returned only when includeValue is true.",
      inputSchema: {
        type: "object",
        properties: {
          name: nameProperty,
          includeValue: {
            type: "boolean",
            description: "When true, return the variable value. Use only when the user explicitly needs the stored value.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "variable_item_create",
      description: "Create one local variable. Fails if a case-insensitive name match already exists.",
      inputSchema: {
        type: "object",
        properties: {
          name: nameProperty,
          value: valueProperty,
          description: descriptionProperty,
        },
        required: ["name", "value"],
      },
    },
    {
      name: "variable_item_update",
      description: "Update an existing local variable. Omitted fields keep their current values.",
      inputSchema: {
        type: "object",
        properties: {
          name: nameProperty,
          newName: {
            type: "string",
            description: "Optional replacement name. Must not collide with another user variable.",
          },
          value: valueProperty,
          description: descriptionProperty,
        },
        required: ["name"],
      },
    },
    {
      name: "variable_item_upsert",
      description: "Create or update one local variable. Creating requires value; updating changes only provided fields.",
      inputSchema: {
        type: "object",
        properties: {
          name: nameProperty,
          value: valueProperty,
          description: descriptionProperty,
        },
        required: ["name"],
      },
    },
    {
      name: "variable_item_delete",
      description: "Delete one local variable by name.",
      inputSchema: {
        type: "object",
        properties: {
          name: nameProperty,
        },
        required: ["name"],
      },
    },
  ], { legacyPrefix: "variable", primaryPrefix: "app_settings_variable" })
}
