import type { AppDeepLinkDeclaration } from "../../manifest"
import {
  FILE_OPENER_APP_ID,
  FILE_OPENER_CAPABILITY_ID,
  FILE_OPENER_MCP_TOOL_NAME,
  FILE_OPENER_WORKFLOW_NODE_TYPE,
} from "./capability"
import { fileOpenInputSchema } from "./schema"

export const fileOpenerCapabilityManifest = {
  id: FILE_OPENER_APP_ID,
  app: null,
  capabilities: [FILE_OPENER_CAPABILITY_ID],
  mcpTools: [FILE_OPENER_MCP_TOOL_NAME],
  workflowNodes: [FILE_OPENER_WORKFLOW_NODE_TYPE],
  deepLinks: [{
    action: "open",
    capabilityId: FILE_OPENER_CAPABILITY_ID,
    paramsSchema: fileOpenInputSchema,
  }],
} as const satisfies {
  readonly id: string
  readonly app: null
  readonly capabilities: readonly string[]
  readonly mcpTools: readonly string[]
  readonly workflowNodes: readonly string[]
  readonly deepLinks: readonly AppDeepLinkDeclaration[]
}
