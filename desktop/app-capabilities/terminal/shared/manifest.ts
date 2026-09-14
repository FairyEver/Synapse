import type { AppProtocolRouteDeclaration } from "../../manifest"
import {
  TERMINAL_APP_ID,
  TERMINAL_CAPABILITY_CATALOG,
  TERMINAL_CAPABILITY_IDS,
  TERMINAL_SESSION_OPEN_CAPABILITY_ID,
} from "./capability"
import {
  TERMINAL_SESSION_DEEP_LINK_HOSTNAME,
  terminalSessionProtocolRouteParamsSchema,
} from "./deep-link"

/**
 * Terminal 能力包只注册一个 Deep Link 短路由：`synapse://terminals/<payload>.<checksum>`。
 *
 * 该路由把完整链接交给 `app.terminal.session.open`，由主进程反查唯一 session 并复用既有 System App
 * 打开请求聚焦，不注册应用页、Dock 项、Workflow/Automation 节点或通用命令入口。
 */
export const terminalCapabilityManifest = {
  id: TERMINAL_APP_ID,
  app: null,
  capabilities: TERMINAL_CAPABILITY_IDS,
  mcpTools: TERMINAL_CAPABILITY_CATALOG.map((item) => item.toolName),
  workflowNodes: [],
  deepLinks: [],
  protocolRoutes: [{
    hostname: TERMINAL_SESSION_DEEP_LINK_HOSTNAME,
    action: "open",
    capabilityId: TERMINAL_SESSION_OPEN_CAPABILITY_ID,
    paramsSchema: terminalSessionProtocolRouteParamsSchema,
  }],
} as const satisfies {
  readonly id: string
  readonly app: null
  readonly capabilities: readonly string[]
  readonly mcpTools: readonly string[]
  readonly workflowNodes: readonly []
  readonly deepLinks: readonly []
  readonly protocolRoutes: readonly AppProtocolRouteDeclaration[]
}
