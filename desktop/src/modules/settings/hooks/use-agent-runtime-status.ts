import { useCallback, useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAgentRuntimeStatus } from "@/types/agent"

const logger = createRendererLogger("settings.agent-runtime")

function useAgentRuntimeStatus(projectId?: string) {
  const [status, setStatus] = useState<SynapseAgentRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    Promise.resolve()
      .then(() => requireSynapseBridge().agent.getRuntimeStatus({ projectId }))
      .then(setStatus)
      .catch((error) => {
        logger.error("Failed to load agent runtime status.", error)
        setStatus(null)
      })
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { status, loading, refresh }
}

export { useAgentRuntimeStatus }
