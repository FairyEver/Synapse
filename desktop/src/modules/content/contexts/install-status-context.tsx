import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseEditorId } from "@/types/editor"
import type { InstallStatusEntry, InstallStatusMap, InstallStatusUninstallResult } from "@/types/install-status"

const logger = createRendererLogger("content.install-status")

type InstallStatusContextValue = {
  statusMap: InstallStatusMap
  uninstall: (contentId: string, editorId: SynapseEditorId) => Promise<InstallStatusUninstallResult>
}

const InstallStatusContext = createContext<InstallStatusContextValue | null>(null)

function InstallStatusProvider({ children }: { children: ReactNode }) {
  const [statusMap, setStatusMap] = useState<InstallStatusMap>({})

  useEffect(() => {
    if (!window.synapse) return

    let stale = false
    const changedContentIds = new Set<string>()

    const unsubscribe = window.synapse.installStatus.onChanged((event) => {
      changedContentIds.add(event.contentId)
      setStatusMap((prev) => {
        const next = { ...prev }
        if (event.entries.length > 0) {
          next[event.contentId] = event.entries
        } else {
          delete next[event.contentId]
        }
        return next
      })
    })

    window.synapse.installStatus.getAll().then((snapshot) => {
      if (stale) return
      setStatusMap((prev) => mergeInstallStatusSnapshot(snapshot, prev, changedContentIds))
    }).catch((error) => {
      if (stale) return
      logger.error("Failed to load install status.", {
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: (error instanceof Error ? error.message : String(error)).length,
      })
    })

    return () => {
      stale = true
      unsubscribe()
    }
  }, [])

  async function uninstall(contentId: string, editorId: SynapseEditorId): Promise<InstallStatusUninstallResult> {
    if (!window.synapse) return {}
    return window.synapse.installStatus.uninstall({ contentId, editorId })
  }

  return (
    <InstallStatusContext.Provider value={{ statusMap, uninstall }}>
      {children}
    </InstallStatusContext.Provider>
  )
}

function useInstallStatus(contentId: string): InstallStatusEntry[] {
  const ctx = useContext(InstallStatusContext)
  if (!ctx) return []
  return ctx.statusMap[contentId] ?? []
}

function useUninstallFromEditor(): (contentId: string, editorId: SynapseEditorId) => Promise<InstallStatusUninstallResult> {
  const ctx = useContext(InstallStatusContext)
  if (!ctx) return async () => ({})
  return ctx.uninstall
}

function mergeInstallStatusSnapshot(
  snapshot: InstallStatusMap,
  current: InstallStatusMap,
  changedContentIds: ReadonlySet<string>,
): InstallStatusMap {
  const next = { ...snapshot }
  for (const contentId of changedContentIds) {
    if (current[contentId]?.length) {
      next[contentId] = current[contentId]
    } else {
      delete next[contentId]
    }
  }
  return next
}

export { InstallStatusProvider, mergeInstallStatusSnapshot, useInstallStatus, useUninstallFromEditor }
