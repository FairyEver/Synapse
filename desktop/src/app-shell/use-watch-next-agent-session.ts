import { useEffect, useRef } from "react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import {
  type WatchNextAgentSessionPayload,
  requestOpenAgentSession,
  subscribeCancelWatchNextAgentSession,
  subscribeWatchNextAgentSession,
} from "@/app-shell/navigation"
import type { SynapseAgentConversationUpdatedPayload } from "@/types/agent"
import type { OpenAgentSessionPayload } from "@/types/agent-navigation"

type PendingAgentSessionWatch = WatchNextAgentSessionPayload & {
  expiresAt: number
}

function isWatchedAgentSessionEvent(
  watch: PendingAgentSessionWatch | null,
  payload: SynapseAgentConversationUpdatedPayload,
  now = Date.now(),
): boolean {
  if (watch === null || now >= watch.expiresAt) return false
  if (payload.projectId !== watch.projectId) return false
  if (watch.platform && payload.platform !== watch.platform) return false
  if (watch.sessionKeyPrefix && !payload.sessionKey.startsWith(watch.sessionKeyPrefix)) return false
  return true
}

function openAgentSessionPayloadFromWatchedEvent(
  watch: PendingAgentSessionWatch | null,
  payload: SynapseAgentConversationUpdatedPayload,
  now = Date.now(),
): OpenAgentSessionPayload | null {
  if (!isWatchedAgentSessionEvent(watch, payload, now)) return null
  const sourceFilter = sourceFilterForPlatform(payload.platform)
  return {
    projectId: payload.projectId,
    conversationId: payload.conversationId,
    sessionKey: payload.sessionKey,
    ...(sourceFilter ? { sourceFilter } : {}),
  }
}

export function useWatchNextAgentSession(): void {
  const pendingWatchRef = useRef<PendingAgentSessionWatch | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const clearWatch = () => {
      if (timer !== null) clearTimeout(timer)
      pendingWatchRef.current = null
      timer = null
    }
    const unsubscribe = subscribeWatchNextAgentSession((payload) => {
      if (timer !== null) clearTimeout(timer)
      pendingWatchRef.current = { ...payload, expiresAt: Date.now() + 120_000 }
      timer = setTimeout(() => {
        pendingWatchRef.current = null
        timer = null
      }, 120_000)
    })
    const unsubscribeCancel = subscribeCancelWatchNextAgentSession(({ projectId }) => {
      if (pendingWatchRef.current?.projectId === projectId) {
        clearWatch()
      }
    })
    return () => {
      unsubscribe()
      unsubscribeCancel()
      clearWatch()
    }
  }, [])

  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge) return
    return bridge.agent.onEvent((domainEvent) => {
      if (domainEvent.type !== "conversationUpdated") return
      const watch = pendingWatchRef.current
      const payload = openAgentSessionPayloadFromWatchedEvent(watch, domainEvent.payload)
      if (payload) {
        pendingWatchRef.current = null
        requestOpenAgentSession(payload)
      }
    })
  }, [])
}

function sourceFilterForPlatform(
  platform: string | undefined,
): OpenAgentSessionPayload["sourceFilter"] | undefined {
  switch (platform) {
    case "local":
    case "local-renderer":
      return "user"
    case "scheduled":
    case "workflow":
    case "webhook":
    case "relay":
      return platform
    case undefined:
      return undefined
    default:
      return "bridge"
  }
}

export { isWatchedAgentSessionEvent, openAgentSessionPayloadFromWatchedEvent }
