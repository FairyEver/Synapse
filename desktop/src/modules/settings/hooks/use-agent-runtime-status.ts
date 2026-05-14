import { useCallback, useEffect, useRef, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAgentRuntimeStatus } from "@/types/agent"

const logger = createRendererLogger("settings.agent-runtime")
const AGENT_RUNTIME_AUTO_REFRESH_INTERVAL_MS = 5_000

type AgentRuntimeRefreshOptions = {
  readonly showLoading?: boolean
}

function createLatestRequestGuard() {
  let activeRequestId = 0

  return {
    begin() {
      activeRequestId += 1
      const requestId = activeRequestId

      return {
        id: requestId,
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
  const [error, setError] = useState<string | null>(null)
  const requestGuardRef = useRef(createLatestRequestGuard())
  const loadingRequestIdRef = useRef(0)
  const loadingRefreshPendingRef = useRef(false)

  const refresh = useCallback((options: AgentRuntimeRefreshOptions = {}) => {
    const request = requestGuardRef.current.begin()
    const showLoading = options.showLoading ?? true
    if (showLoading) {
      loadingRequestIdRef.current = request.id
      loadingRefreshPendingRef.current = true
      setLoading(true)
      setError(null)
    }
    Promise.resolve()
      .then(() => requireSynapseBridge().agent.getRuntimeStatus({ projectId }))
      .then((nextStatus) => {
        if (request.isActive()) {
          setStatus(nextStatus)
          setError(null)
        }
      })
      .catch((err) => {
        if (request.isActive()) {
          logger.error("Failed to load agent runtime status.", {
            boundary: "settings.agent-runtime.status-refresh",
            projectId,
            ...errorDiagnostic(err),
          })
          if (showLoading) {
            setStatus(null)
            setError("加载智能体运行时状态失败")
          }
        }
      })
      .finally(() => {
        if (showLoading && loadingRequestIdRef.current === request.id) {
          loadingRefreshPendingRef.current = false
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

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "hidden") return
      if (loadingRefreshPendingRef.current) return
      refresh({ showLoading: false })
    }
    const timer = window.setInterval(refreshWhenVisible, AGENT_RUNTIME_AUTO_REFRESH_INTERVAL_MS)
    window.addEventListener("focus", refreshWhenVisible)
    document.addEventListener("visibilitychange", refreshWhenVisible)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", refreshWhenVisible)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    }
  }, [refresh])

  return { status, loading, error, refresh }
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : ""
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

export { createLatestRequestGuard, useAgentRuntimeStatus }
