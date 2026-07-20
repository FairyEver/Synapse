import { useCallback, useEffect, useRef, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  AutomationCreateInput,
  AutomationItem,
  AutomationRun,
  AutomationStopRunResult,
  AutomationUpdateInput,
} from "@/types/automation"

const logger = createRendererLogger("automation.hooks")

function useAutomationItems() {
  const [items, setItems] = useState<AutomationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)
  const latestRefreshIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const refreshId = latestRefreshIdRef.current + 1
    latestRefreshIdRef.current = refreshId
    const isLatestRefresh = () => latestRefreshIdRef.current === refreshId

    try {
      if (!hasLoadedRef.current) setLoading(true)
      const nextItems = await requireSynapseBridge().automation.item.list()
      if (!isLatestRefresh()) return
      hasLoadedRef.current = true
      setItems(nextItems)
      setError(null)
    } catch (refreshError) {
      if (!isLatestRefresh()) return
      logger.warn("Automation list refresh failed.", {
        action: "listItems",
        boundary: "renderer.automation.list",
        errorType: refreshError instanceof Error ? refreshError.name : typeof refreshError,
        errorLength: errorMessageLength(refreshError),
      })
      setError("读取自动化失败")
    } finally {
      if (isLatestRefresh()) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return requireSynapseBridge().automation.item.onChanged(() => {
      void refresh()
    })
  }, [refresh])

  return {
    items,
    loading,
    error,
    refresh,
  }
}

async function createAutomation(input: AutomationCreateInput): Promise<AutomationItem> {
  return requireSynapseBridge().automation.item.create(input)
}

async function updateAutomation(id: string, patch: AutomationUpdateInput): Promise<AutomationItem> {
  return requireSynapseBridge().automation.item.update({ id, patch })
}

async function deleteAutomation(id: string): Promise<{ deleted: boolean }> {
  return requireSynapseBridge().automation.item.delete(id)
}

async function setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationItem> {
  return requireSynapseBridge().automation.item.setEnabled({ id, enabled })
}

async function runAutomation(id: string): Promise<AutomationRun | null> {
  return requireSynapseBridge().automation.run.execute(id)
}

async function stopAutomationRun(runId: string): Promise<AutomationStopRunResult> {
  return requireSynapseBridge().automation.run.disable(runId)
}

async function listAutomationRuns(automationId: string, limit = 100): Promise<AutomationRun[]> {
  return requireSynapseBridge().automation.run.list(automationId, { limit })
}

function errorMessageLength(error: unknown): number {
  if (error instanceof Error) return error.message.length
  return String(error).length
}

export {
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  runAutomation,
  setAutomationEnabled,
  stopAutomationRun,
  updateAutomation,
  useAutomationItems,
}
