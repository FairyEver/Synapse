import type { AppProtocolRouteDeclaration } from "../../manifest"
import {
  TERMINAL_APP_ID,
  TERMINAL_CAPABILITY_CATALOG,
  TERMINAL_CAPABILITY_IDS,
} from "./capability"

/**
 * Terminal 能力包不注册任何 Deep Link 路由。
 *
 * 终端会话不跨重启（ADR 0215），任何带会话的链接在下一次启动时必然失效，因此没有可交付的链接形态；
 * 会话定位留给 `app.terminal.session.open` 的不可变 `sessionId`。这里也不注册应用页、Dock 项、
 * Workflow/Automation 节点或通用命令入口。
 */
export const terminalCapabilityManifest = {
  id: TERMINAL_APP_ID,
  app: null,
  capabilities: TERMINAL_CAPABILITY_IDS,
  mcpTools: TERMINAL_CAPABILITY_CATALOG.map((item) => item.toolName),
  workflowNodes: [],
  deepLinks: [],
  protocolRoutes: [],
} as const satisfies {
  readonly id: string
  readonly app: null
  readonly capabilities: readonly string[]
  readonly mcpTools: readonly string[]
  readonly workflowNodes: readonly []
  readonly deepLinks: readonly []
  readonly protocolRoutes: readonly AppProtocolRouteDeclaration[]
}
