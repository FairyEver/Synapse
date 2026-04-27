import { useCallback, useEffect, useRef, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAgentRuntimeStatus } from "@/types/agent"

const logger = createRendererLogger("settings.agent-runtime")

function createLatestRequestGuard() {
  let activeRequestId = 0

  return {
    begin() {
      activeRequestId += 1
      const requestId = activeRequestId

      return {
        isActive() {
          return requestId === activeRequestId
        },
      }
    },
    cancel() {
      activeRequestId += 1
    },
  }
}

function useAgentRuntimeStatus(projectId?: string) {
  const [status, setStatus] = useState<SynapseAgentRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const requestGuardRef = useRef(createLatestRequestGuard())

  const refresh = useCallback(() => {
    const request = requestGuardRef.current.begin()
    setLoading(true)
    Promise.resolve()
      .then(() => requireSynapseBridge().agent.getRuntimeStatus({ projectId }))
      .then((nextStatus) => {
        if (request.isActive()) {
          setStatus(nextStatus)
        }
      })
      .catch((error) => {
        if (request.isActive()) {
          logger.error("Failed to load agent runtime status.", error)
          setStatus(null)
        }
      })
      .finally(() => {
        if (request.isActive()) {
          setLoading(false)
        }
      })
  }, [projectId])

  useEffect(() => {
    refresh()
    return () => {
      requestGuardRef.current.cancel()
    }
  }, [refresh])

  return { status, loading, refresh }
}

export { createLatestRequestGuard, useAgentRuntimeStatus }
