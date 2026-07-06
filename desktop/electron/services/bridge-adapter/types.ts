import type { AgentEvent } from "../agent-runtime"
import type { ReplyTarget } from "../reply-target"
import type { SideChannelPreparedAttachment } from "../side-channel"

export const BRIDGE_ADAPTER_SERVICE_ID = "core.bridge-adapter"

export interface BridgeAdapterSummary {
  readonly platform: string
  readonly capabilities: readonly string[]
  readonly metadata?: Record<string, unknown>
  readonly connected: boolean
  readonly registeredAt: string
  readonly lastSeenAt: string
}

export interface BridgeAdapterStatus {
  readonly started: boolean
  readonly bindAddress?: string
  readonly port?: number
  readonly path: string
  readonly sessionsPath: string
  readonly adapters: readonly BridgeAdapterSummary[]
}

export interface BridgeProjectSummary {
  readonly projectId: string
  readonly name?: string
  readonly workspacePath?: string
  readonly managedKnowledgeBase?: boolean
}

export interface BridgeOutboundDispatcher {
  dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): Promise<void>
  dispatchSideChannelSend(
    target: ReplyTarget,
    payload: {
      readonly message?: string
      readonly attachments: readonly SideChannelPreparedAttachment[]
    },
  ): Promise<void>
}
