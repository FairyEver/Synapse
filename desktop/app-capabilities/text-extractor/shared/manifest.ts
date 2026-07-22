import {
  TEXT_EXTRACTOR_APP_ID,
  TEXT_EXTRACTOR_CAPABILITY_ID,
  TEXT_EXTRACT_WORKFLOW_NODE_TYPE,
  TEXT_EXTRACTOR_MCP_TOOL_NAME,
} from "./capability"

export const textExtractorCapabilityManifest = {
  id: TEXT_EXTRACTOR_APP_ID,
  app: {
    id: TEXT_EXTRACTOR_APP_ID,
  },
  capabilities: [TEXT_EXTRACTOR_CAPABILITY_ID],
  mcpTools: [TEXT_EXTRACTOR_MCP_TOOL_NAME],
  workflowNodes: [TEXT_EXTRACT_WORKFLOW_NODE_TYPE],
} as const
