import { useEffect, useRef } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { AgentConversationOpenRequest } from "@/types/agent-navigation"

const logger = createRendererLogger("agent-conversation-open-request")

type AgentConversationOpenRequestControls = {
  acknowledge: () => Promise<void>
}

type AgentConversationOpenRequestHandler = (
  request: AgentConversationOpenRequest,
  controls: AgentConversationOpenRequestControls,
) => void | Promise<void>

export function useAgentConversationOpenRequest(
  handler: AgentConversationOpenRequestHandler,
): void {
  const handlerRef = useRef(handler)
  const lastHandledRequestIdRef = useRef(0)
  handlerRef.current = handler

  useEffect(() => {
    const bridge = getSynapseBridge()?.agent
    if (!bridge) return

    let cancelled = false
    const handleRequest = (request: AgentConversationOpenRequest) => {
      if (cancelled || request.requestId <= lastHandledRequestIdRef.current) return
      lastHandledRequestIdRef.current = request.requestId
      void Promise.resolve(handlerRef.current(request, {
        acknowledge: () => bridge.acknowledgeConversationOpenRequest(request.requestId),
      })).catch((error) => {
        logger.error("Failed to handle Agent conversation open request.", {
          requestId: request.requestId,
          errorName: error instanceof Error ? error.name : typeof error,
        })
      })
    }

    const unsubscribe = bridge.onOpenConversation(handleRequest)
    void bridge.getPendingConversationOpenRequest()
      .then((request) => {
        if (request) handleRequest(request)
      })
      .catch((error) => {
        logger.error("Failed to read pending Agent conversation open request.", {
          errorName: error instanceof Error ? error.name : typeof error,
        })
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
}

export type {
  AgentConversationOpenRequestControls,
  AgentConversationOpenRequestHandler,
}

