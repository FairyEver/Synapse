import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { SynapseEditorId } from "@/types/editor"
import type { InstallStatusMap } from "@/types/install-status"

type InstallStatusContextValue = {
  statusMap: InstallStatusMap
  uninstall: (contentId: string, editorId: SynapseEditorId) => Promise<void>
}

const InstallStatusContext = createContext<InstallStatusContextValue | null>(null)

function InstallStatusProvider({ children }: { children: ReactNode }) {
  const [statusMap, setStatusMap] = useState<InstallStatusMap>({})

  useEffect(() => {
    if (!window.synapse) return

    window.synapse.installStatus.getAll().then(setStatusMap)

    const unsubscribe = window.synapse.installStatus.onChanged((event) => {
      setStatusMap((prev) => {
        const next = { ...prev }
        if (event.editors.length > 0) {
          next[event.contentId] = event.editors
        } else {
          delete next[event.contentId]
        }
        return next
      })
    })

    return unsubscribe
  }, [])

  async function uninstall(contentId: string, editorId: SynapseEditorId): Promise<void> {
    if (!window.synapse) return
    await window.synapse.installStatus.uninstall({ contentId, editorId })
  }

  return (
    <InstallStatusContext.Provider value={{ statusMap, uninstall }}>
      {children}
    </InstallStatusContext.Provider>
  )
}

function useInstallStatus(contentId: string): SynapseEditorId[] {
  const ctx = useContext(InstallStatusContext)
  if (!ctx) return []
  return ctx.statusMap[contentId] ?? []
}

function useUninstallFromEditor(): (contentId: string, editorId: SynapseEditorId) => Promise<void> {
  const ctx = useContext(InstallStatusContext)
  if (!ctx) return async () => {}
  return ctx.uninstall
}

export { InstallStatusProvider, useInstallStatus, useUninstallFromEditor }
