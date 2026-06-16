import { toast } from "sonner"
import { ModulePage } from "@/components/module-page"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { AppLauncherGrid } from "./components/app-launcher-grid"
import { listSystemApps } from "./registry"
import type { SynapseSystemAppId } from "./types"

export function AppsModule() {
  const openApp = async (appId: SynapseSystemAppId) => {
    try {
      await requireSynapseBridge().apps.openSystemApp(appId)
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
