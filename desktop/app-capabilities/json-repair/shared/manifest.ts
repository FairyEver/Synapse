import {
  JSON_REPAIR_APP_ID,
  JSON_REPAIR_CAPABILITY_ID,
  JSON_REPAIR_MCP_TOOL_NAME,
  JSON_REPAIR_WORKFLOW_NODE_TYPE,
} from "./capability"

export const jsonRepairCapabilityManifest = {
  id: JSON_REPAIR_APP_ID,
  app: null,
  capabilities: [JSON_REPAIR_CAPABILITY_ID],
  mcpTools: [JSON_REPAIR_MCP_TOOL_NAME],
  workflowNodes: [JSON_REPAIR_WORKFLOW_NODE_TYPE],
  deepLinks: [],
} as const
