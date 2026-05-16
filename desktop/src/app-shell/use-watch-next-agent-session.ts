import { useEffect, useRef } from "react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import {
  requestOpenAgentSession,
  subscribeCancelWatchNextAgentSession,
  subscribeWatchNextAgentSession,
} from "@/app-shell/navigation"

export function useWatchNextAgentSession(): void {
  const pendingWatchRef = useRef<{ projectId: string; expiresAt: number } | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const clearWatch = () => {
      if (timer !== null) clearTimeout(timer)
      pendingWatchRef.current = null
      timer = null
    }
    const unsubscribe = subscribeWatchNextAgentSession(({ projectId }) => {
      if (timer !== null) clearTimeout(timer)
      pendingWatchRef.current = { projectId, expiresAt: Date.now() + 120_000 }
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
      if (
        watch !== null
        && domainEvent.payload.projectId === watch.projectId
        && Date.now() < watch.expiresAt
      ) {
        pendingWatchRef.current = null
        requestOpenAgentSession({
          projectId: domainEvent.payload.projectId,
          conversationId: domainEvent.payload.conversationId,
        })
      }
    })
  }, [])
}
