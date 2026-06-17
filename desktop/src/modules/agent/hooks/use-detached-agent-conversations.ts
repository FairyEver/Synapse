import { useEffect, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { AgentDetachedConversation } from "@/types/agent-conversation-window"

const logger = createRendererLogger("agent")

function useDetachedAgentConversations(): readonly AgentDetachedConversation[] {
  const [items, setItems] = useState<AgentDetachedConversation[]>([])

  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge) {
      setItems([])
      return undefined
    }

    let cancelled = false
    void bridge.agent.listDetachedConversationWindows()
      .then((next) => {
        if (!cancelled) setItems([...next])
      })
      .catch((error) => {
        logger.warn("Detached agent conversation list failed.", {
          errorName: error instanceof Error ? error.name : typeof error,
        })
        if (!cancelled) setItems([])
      })

    const unsubscribe = bridge.agent.onDetachedConversationWindowsChanged((next) => {
      setItems([...next])
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return items
}

function isDetachedAgentConversation(
  items: readonly AgentDetachedConversation[],
  target: { readonly projectId?: string; readonly conversationId?: string },
): boolean {
  if (!target.projectId || !target.conversationId) return false
  return items.some((item) =>
    item.projectId === target.projectId && item.conversationId === target.conversationId)
}

export { isDetachedAgentConversation, useDetachedAgentConversations }
