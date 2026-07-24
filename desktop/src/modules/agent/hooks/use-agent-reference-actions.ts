import { useCallback, useMemo } from "react"

import { getSynapseBridge } from "@/lib/electron-bridge"
import type { AgentReferenceActionResult } from "@/types/agent-reference-action"

export interface AgentReferenceActions {
  readonly openDefault: (reference: string) => Promise<AgentReferenceActionResult>
  readonly showInFolder: (reference: string) => Promise<AgentReferenceActionResult>
}

export function useAgentReferenceActions(projectId: string): AgentReferenceActions {
  const openDefault = useCallback((reference: string) => {
    const bridge = getSynapseBridge()
    if (!bridge?.agent.openReferenceDefault) {
      return Promise.reject(new Error("Agent reference action bridge unavailable."))
    }
    return bridge.agent.openReferenceDefault({ projectId, reference })
  }, [projectId])

  const showInFolder = useCallback((reference: string) => {
    const bridge = getSynapseBridge()
    if (!bridge?.agent.showReferenceInFolder) {
      return Promise.reject(new Error("Agent reference action bridge unavailable."))
    }
    return bridge.agent.showReferenceInFolder({ projectId, reference })
  }, [projectId])

  return useMemo(() => ({
    openDefault,
    showInFolder,
  }), [openDefault, showInFolder])
}
