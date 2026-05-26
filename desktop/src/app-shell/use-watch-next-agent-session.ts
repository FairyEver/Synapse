import { useEffect, useRef } from "react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import {
  type WatchNextAgentSessionPayload,
  requestOpenAgentSession,
  subscribeCancelWatchNextAgentSession,
  subscribeWatchNextAgentSession,
} from "@/app-shell/navigation"
import type { SynapseAgentConversationUpdatedPayload } from "@/types/agent"

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
      if (isWatchedAgentSessionEvent(watch, domainEvent.payload)) {
        pendingWatchRef.current = null
        requestOpenAgentSession({
          projectId: domainEvent.payload.projectId,
          conversationId: domainEvent.payload.conversationId,
        })
      }
    })
  }, [])
}

export { isWatchedAgentSessionEvent }
