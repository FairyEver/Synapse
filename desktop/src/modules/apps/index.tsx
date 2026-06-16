import { toast } from "sonner"
import { ModulePage } from "@/components/module-page"
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
    <ModulePage title="应用">
      <AppLauncherGrid apps={listSystemApps()} onOpenApp={(appId) => void openApp(appId)} />
    </ModulePage>
  )
}
