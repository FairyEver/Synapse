import { useCallback, useEffect, useRef, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  AutomationCreateInput,
  AutomationItem,
  AutomationRun,
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
      const nextItems = await requireSynapseBridge().automation.listItems()
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
    return requireSynapseBridge().automation.onChanged(() => {
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
  return requireSynapseBridge().automation.createItem(input)
}

async function updateAutomation(id: string, patch: AutomationUpdateInput): Promise<AutomationItem> {
  return requireSynapseBridge().automation.updateItem({ id, patch })
}

async function deleteAutomation(id: string): Promise<{ deleted: boolean }> {
  return requireSynapseBridge().automation.deleteItem(id)
}

async function setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationItem> {
  return requireSynapseBridge().automation.setItemEnabled({ id, enabled })
}

async function runAutomation(id: string): Promise<AutomationRun | null> {
  return requireSynapseBridge().automation.runItem(id)
}

async function stopAutomationRun(runId: string): Promise<{ stopped: boolean }> {
  return requireSynapseBridge().automation.stopRun(runId)
}

async function listAutomationRuns(automationId: string, limit = 100): Promise<AutomationRun[]> {
  return requireSynapseBridge().automation.listRuns(automationId, { limit })
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
