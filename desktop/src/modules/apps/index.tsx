import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { AppLauncherGrid } from "./components/app-launcher-grid"
import { EmbeddedSystemAppShell } from "./components/embedded-system-app-shell"
import { SystemAppContent } from "./components/system-app-content"
import { getSystemAppManifest, listSystemApps } from "./registry"
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
}

export function AppsModule({
  pendingContentOpenRequest = null,
  onPendingContentOpenRequestConsumed,
}: AppsModuleProps = {}) {
  const [activeAppId, setActiveAppId] = useState<SynapseSystemAppId | null>(null)
  const [resourceContentOpenRequest, setResourceContentOpenRequest] =
    useState<ContentOpenRequest | null>(null)

  useEffect(() => {
    if (!pendingContentOpenRequest) return
    setActiveAppId("resource-repository")
    setResourceContentOpenRequest(pendingContentOpenRequest)
  }, [pendingContentOpenRequest])

  const openApp = useCallback((appId: SynapseSystemAppId) => {
    if (appId === "launcher") {
      setActiveAppId(null)
      return
    }
    setActiveAppId(appId)
  }, [])

  const openAppWindow = async (appId: SynapseSystemAppId) => {
    try {
      await requireAppsBridge().openSystemApp(appId)
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
      <EmbeddedSystemAppShell
        appName={activeApp.name}
        onBack={() => {
          setActiveAppId(null)
          setResourceContentOpenRequest(null)
        }}
        onOpenWindow={() => void openAppWindow(activeApp.id)}
      >
        <SystemAppContent
          appId={activeApp.id}
          resourceContentOpenRequest={resourceContentOpenRequest}
          onResourceContentOpenRequestConsumed={handleResourceContentOpenRequestConsumed}
          onContentOpenRequest={openResourceRepository}
        />
      </EmbeddedSystemAppShell>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-h-full px-6 py-7">
          <div className="mx-auto max-w-4xl">
            <AppLauncherGrid apps={listSystemApps()} onOpenApp={openApp} />
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
