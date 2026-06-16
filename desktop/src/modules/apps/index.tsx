import { toast } from "sonner"
import { ModuleContentPanel } from "@/components/module-page"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { AppLauncherGrid } from "./components/app-launcher-grid"
import { listSystemApps } from "./registry"
import type { SynapseSystemAppId, SynapseSystemAppOpenOptions } from "./types"

type AppsBridge = {
  readonly openSystemApp: (appId: SynapseSystemAppId, options?: SynapseSystemAppOpenOptions) => Promise<void>
}

function requireAppsBridge(): AppsBridge {
  return (requireSynapseBridge() as ReturnType<typeof requireSynapseBridge> & { readonly apps: AppsBridge }).apps
}

export function AppsModule() {
  const openApp = async (appId: SynapseSystemAppId) => {
    try {
      await requireAppsBridge().openSystemApp(appId)
    } catch {
      toast.error("打开应用失败")
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-h-full px-3 py-3">
          <ModuleContentPanel className="mx-auto max-w-2xl overflow-hidden">
            <AppLauncherGrid apps={listSystemApps()} onOpenApp={(appId) => void openApp(appId)} />
          </ModuleContentPanel>
        </div>
      </ScrollArea>
    </div>
  )
}
