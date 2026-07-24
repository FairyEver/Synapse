import { TEXT_FILE_WRITER_APP_ID, TEXT_FILE_WRITER_CAPABILITY_ID, TEXT_FILE_WRITER_MCP_TOOL_NAME, TEXT_FILE_WRITER_WORKFLOW_NODE_TYPE } from "./capability"

export const textFileWriterCapabilityManifest = {
  id: TEXT_FILE_WRITER_APP_ID,
  app: null,
  capabilities: [TEXT_FILE_WRITER_CAPABILITY_ID],
  mcpTools: [TEXT_FILE_WRITER_MCP_TOOL_NAME],
  workflowNodes: [TEXT_FILE_WRITER_WORKFLOW_NODE_TYPE],
  deepLinks: [],
} as const
