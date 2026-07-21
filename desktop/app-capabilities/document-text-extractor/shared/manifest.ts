import {
  DOCUMENT_TEXT_EXTRACTOR_APP_ID,
  DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID,
  DOCUMENT_TEXT_EXTRACTOR_MCP_TOOL_NAME,
} from "./capability"

export const documentTextExtractorCapabilityManifest = {
  id: DOCUMENT_TEXT_EXTRACTOR_APP_ID,
  app: {
    id: DOCUMENT_TEXT_EXTRACTOR_APP_ID,
  },
  capabilities: [DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID],
  mcpTools: [DOCUMENT_TEXT_EXTRACTOR_MCP_TOOL_NAME],
  workflowNodes: [],
} as const
