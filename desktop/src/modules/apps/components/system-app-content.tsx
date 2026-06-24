import { useEffect } from "react"
import { toast } from "sonner"
import type { OpenAgentSessionPayload } from "@/app-shell/navigation"
import {
  subscribeContentOpenRequest,
  type ContentOpenRequest,
} from "@/app-shell/content-navigation"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AgentModule } from "@/modules/agent"
import { AutomationModule } from "@/modules/automation"
import { DatabaseModule } from "@/modules/database"
import { DriveModule } from "@/modules/drive"
import { EditorScanModule } from "@/modules/editor-scan"
import { GitModule } from "@/modules/git"
import { ModelPriceModule } from "@/modules/model-price"
import { ResourceRepositoryModule } from "@/modules/resource-repository"
import { SettingsModule } from "@/modules/settings"
import { UsageMonitorModule } from "@/modules/usage-analysis"
import { WorkflowModule } from "@/modules/workflow"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { DocumentTemplateModule } from "../../../../app-capabilities/document-template/renderer"
import { TerminalModule } from "../../../../app-capabilities/terminal/renderer"
import { ScreenshotModule } from "../../../../app-capabilities/screenshot/renderer"
import { AppLauncherGrid } from "./app-launcher-grid"
import { listSystemApps } from "../registry"
import type { SynapseSystemAppId } from "../types"

type SystemAppContentProps = {
  readonly appId: SynapseSystemAppId
  readonly resourceContentOpenRequest?: ContentOpenRequest | null
  readonly onResourceContentOpenRequestConsumed?: (requestId: string) => void
  readonly onContentOpenRequest?: (request: ContentOpenRequest) => void
  readonly pendingAgentSession?: OpenAgentSessionPayload | null
  readonly onPendingAgentSessionConsumed?: () => void
}

function SystemAppContent({
  appId,
  resourceContentOpenRequest = null,
  onResourceContentOpenRequestConsumed,
  onContentOpenRequest,
  pendingAgentSession = null,
  onPendingAgentSessionConsumed,
}: SystemAppContentProps) {
  useEffect(() => {
    if (appId === "resource-repository" || !onContentOpenRequest) return undefined
    return subscribeContentOpenRequest(onContentOpenRequest)
  }, [appId, onContentOpenRequest])

  if (appId === "agent") {
    return (
      <AgentModule
        pendingAgentSession={pendingAgentSession}
        onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
      />
    )
  }
  if (appId === "workflow") return <WorkflowModule />
  if (appId === "drive") return <DriveModule />
  if (appId === "automation") return <AutomationModule />
  if (appId === "launcher") {
    if (resourceContentOpenRequest) {
      return (
        <ResourceRepositoryModule
          initialContentOpenRequest={resourceContentOpenRequest}
          onInitialContentOpenRequestConsumed={onResourceContentOpenRequestConsumed}
        />
      )
    }
    return <LauncherContent />
  }
  if (appId === "settings") return <SettingsModule />
  if (appId === "resource-repository") {
    return (
      <ResourceRepositoryModule
        initialContentOpenRequest={resourceContentOpenRequest}
        onInitialContentOpenRequestConsumed={onResourceContentOpenRequestConsumed}
      />
    )
  }
  if (appId === "database") return <DatabaseModule />
  if (appId === "document-template") return <DocumentTemplateModule />
  if (appId === "terminal") return <TerminalModule />
  if (appId === "screenshot") return <ScreenshotModule />
  if (appId === "git") return <GitModule />
  if (appId === "editor-scan") return <EditorScanModule />
  if (appId === "usage-monitor") return <UsageMonitorModule />
  if (appId === "model-price") return <ModelPriceModule />

  return null
}

function LauncherContent() {
  const openApp = async (appId: SynapseSystemAppId) => {
    if (appId === "launcher") return
    try {
      await (getSynapseBridge() as ReturnType<typeof getSynapseBridge> & {
        readonly apps?: {
          readonly openSystemApp?: (targetAppId: SynapseSystemAppId) => Promise<void>
        }
      } | undefined)?.apps?.openSystemApp?.(appId)
    } catch {
      toast.error("打开应用失败")
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-h-full px-6 py-7">
          <div className="mx-auto max-w-4xl">
            <AppLauncherGrid apps={listSystemApps()} onOpenApp={(appId) => void openApp(appId)} />
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

export { SystemAppContent }
