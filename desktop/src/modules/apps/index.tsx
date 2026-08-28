import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { requestOpenSettingsDock } from "@/app-shell/navigation"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { useDockPreferences } from "@/modules/apps/hooks/use-dock-preferences"
import { AppLauncherGrid } from "./components/app-launcher-grid"
import { AppSwitchTransition } from "./components/app-switch-transition"
import { EmbeddedSystemAppShell } from "./components/embedded-system-app-shell"
import { SystemAppContent } from "./components/system-app-content"
import { getSystemAppManifest, listLaunchableSystemApps } from "./registry"
import type { SynapseSystemAppId, SynapseSystemAppOpenOptions } from "./types"

type AppsBridge = {
  readonly openSystemApp: (appId: SynapseSystemAppId, options?: SynapseSystemAppOpenOptions) => Promise<void>
}

function requireAppsBridge(): AppsBridge {
  return (requireSynapseBridge() as ReturnType<typeof requireSynapseBridge> & { readonly apps: AppsBridge }).apps
}

type AppsModuleProps = {
  readonly pendingContentOpenRequest?: ContentOpenRequest | null
  readonly onPendingContentOpenRequestConsumed?: (requestId: string) => void
  readonly resetKey?: number
  readonly workflowEntryVisible?: boolean
}

export function AppsModule({
  pendingContentOpenRequest = null,
  onPendingContentOpenRequestConsumed,
  resetKey = 0,
  workflowEntryVisible = false,
}: AppsModuleProps = {}) {
  const [activeAppId, setActiveAppId] = useState<SynapseSystemAppId | null>(null)
  const [resourceContentOpenRequest, setResourceContentOpenRequest] =
    useState<ContentOpenRequest | null>(null)
  const [launcherFocusAppId, setLauncherFocusAppId] =
    useState<SynapseSystemAppId | null>(null)
  const resetKeyRef = useRef(resetKey)
  const dock = useDockPreferences({ workflowEntryVisible })

  useEffect(() => {
    if (!pendingContentOpenRequest) return
    setActiveAppId("resource-repository")
    setResourceContentOpenRequest(pendingContentOpenRequest)
  }, [pendingContentOpenRequest])

  useEffect(() => {
    if (resetKeyRef.current === resetKey) return
    resetKeyRef.current = resetKey
    setActiveAppId(null)
    setResourceContentOpenRequest(null)
  }, [resetKey])

  const openApp = useCallback((appId: SynapseSystemAppId) => {
    setLauncherFocusAppId(null)
    if (appId === "launcher") {
      setActiveAppId(null)
      return
    }
    setActiveAppId(appId)
  }, [])

  const openAppWindow = async (appId: SynapseSystemAppId) => {
    try {
      await requireAppsBridge().openSystemApp(appId)
      setLauncherFocusAppId(appId)
      setActiveAppId(null)
      setResourceContentOpenRequest(null)
    } catch {
      toast.error("打开应用失败")
    }
  }

  const openResourceRepository = useCallback((request: ContentOpenRequest) => {
    setActiveAppId("resource-repository")
    setResourceContentOpenRequest(request)
  }, [])

  const handleResourceContentOpenRequestConsumed = useCallback((requestId: string) => {
    setResourceContentOpenRequest((current) => current?.requestId === requestId ? null : current)
    if (pendingContentOpenRequest?.requestId === requestId) {
      onPendingContentOpenRequestConsumed?.(requestId)
    }
  }, [onPendingContentOpenRequestConsumed, pendingContentOpenRequest])

  const activeApp = activeAppId ? getSystemAppManifest(activeAppId) : null

  if (activeApp) {
    return (
      <AppSwitchTransition transitionKey={activeApp.id} animateOnMount>
        <EmbeddedSystemAppShell
          appName={activeApp.name}
          onBack={() => {
            setLauncherFocusAppId(activeApp.id)
            setActiveAppId(null)
            setResourceContentOpenRequest(null)
          }}
          onOpenWindow={activeApp.window.openable
            ? () => void openAppWindow(activeApp.id)
            : undefined}
        >
          <SystemAppContent
            appId={activeApp.id}
            workflowEntryVisible={workflowEntryVisible}
            resourceContentOpenRequest={resourceContentOpenRequest}
            onResourceContentOpenRequestConsumed={handleResourceContentOpenRequestConsumed}
            onContentOpenRequest={openResourceRepository}
          />
        </EmbeddedSystemAppShell>
      </AppSwitchTransition>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-h-full px-6 py-6">
          <div className="mx-auto max-w-4xl">
            <AppLauncherGrid
              apps={listLaunchableSystemApps({ workflowEntryVisible })}
              focusAppId={launcherFocusAppId}
              pinnedAppIds={dock.dockAppIds}
              disabled={dock.saving}
              onOpenApp={openApp}
              onPinApp={(appId) => void dock.addDockApp(appId)}
              onUnpinApp={(appId) => void dock.removeDockApp(appId)}
              onManageDock={requestOpenSettingsDock}
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
