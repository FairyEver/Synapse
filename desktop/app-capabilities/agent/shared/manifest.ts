import type { AppProtocolRouteDeclaration } from "../../manifest"
import {
  AGENT_APP_ID,
  AGENT_CONVERSATION_CAPABILITY_IDS,
  AGENT_CONVERSATION_CAPABILITY_CATALOG,
  AGENT_CONVERSATION_OPEN_CAPABILITY_ID,
} from "./capability"
import {
  agentConversationProtocolRouteParamsSchema,
} from "./schema"

export const agentConversationCapabilityManifest = {
  id: AGENT_APP_ID,
  app: null,
  capabilities: AGENT_CONVERSATION_CAPABILITY_IDS,
  mcpTools: AGENT_CONVERSATION_CAPABILITY_CATALOG.map((item) => item.toolName),
  workflowNodes: [],
  deepLinks: [],
  protocolRoutes: [{
    hostname: "threads",
    action: "open",
    capabilityId: AGENT_CONVERSATION_OPEN_CAPABILITY_ID,
    paramsSchema: agentConversationProtocolRouteParamsSchema,
  }],
} as const satisfies {
  readonly id: string
  readonly app: null
  readonly capabilities: readonly string[]
  readonly mcpTools: readonly string[]
  readonly workflowNodes: readonly string[]
  readonly deepLinks: readonly []
  readonly protocolRoutes: readonly AppProtocolRouteDeclaration[]
}
