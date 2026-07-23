import {
  HTML_GENERATOR_APP_ID,
  HTML_GENERATOR_CAPABILITY_IDS,
  HTML_GENERATOR_MCP_TOOL_NAMES,
  HTML_GENERATOR_WORKFLOW_NODE_TYPES,
} from "./capability"

export const htmlGeneratorCapabilityManifest = {
  id: HTML_GENERATOR_APP_ID,
  app: { id: HTML_GENERATOR_APP_ID },
  capabilities: HTML_GENERATOR_CAPABILITY_IDS,
  mcpTools: HTML_GENERATOR_MCP_TOOL_NAMES,
  workflowNodes: HTML_GENERATOR_WORKFLOW_NODE_TYPES,
  deepLinks: [],
} as const
