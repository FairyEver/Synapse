import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { requestOpenSettingsDock, type OpenAgentSessionPayload } from "@/app-shell/navigation"
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
import { useDockPreferences } from "@/modules/apps/hooks/use-dock-preferences"
import { AgentPersonasModule } from "../../../../app-capabilities/agent-personas/renderer"
import { SynapseSkillModule } from "../../../../app-capabilities/synapse-skill/renderer"
import { SecretsModule } from "../../../../app-capabilities/secrets/renderer"
import { QuickInputModule } from "../../../../app-capabilities/quick-input/renderer"
import { TerminalModule } from "../../../../app-capabilities/terminal/renderer"
import { AppLauncherGrid } from "./app-launcher-grid"
import { AppSwitchTransition } from "./app-switch-transition"
import { EmbeddedSystemAppShell } from "./embedded-system-app-shell"
import { getSystemAppManifest, listLaunchableSystemApps } from "../registry"
import type {
  SynapseSystemAppGitOpenRequest,
  SynapseSystemAppId,
  SynapseSystemAppOpenOptions,
  SynapseSystemAppTerminalOpenRequest,
} from "../types"

type AppsBridge = {
  readonly openSystemApp?: (targetAppId: SynapseSystemAppId, options?: SynapseSystemAppOpenOptions) => Promise<void>
}

type SystemAppContentProps = {
  readonly appId: SynapseSystemAppId
  readonly launcherResetKey?: number
  readonly workflowEntryVisible?: boolean
  readonly resourceContentOpenRequest?: ContentOpenRequest | null
  readonly onResourceContentOpenRequestConsumed?: (requestId: string) => void
  readonly onContentOpenRequest?: (request: ContentOpenRequest) => void
  readonly pendingAgentSession?: OpenAgentSessionPayload | null
  readonly onPendingAgentSessionConsumed?: () => void
  readonly gitOpenRequest?: SynapseSystemAppGitOpenRequest | null
  readonly onGitOpenRequestConsumed?: (requestId: string) => void
  readonly terminalOpenRequest?: SynapseSystemAppTerminalOpenRequest | null
  readonly onTerminalOpenRequestConsumed?: (requestId: string) => void
}

function SystemAppContent({
  appId,
  launcherResetKey = 0,
  workflowEntryVisible = false,
  resourceContentOpenRequest = null,
  onResourceContentOpenRequestConsumed,
  onContentOpenRequest,
  pendingAgentSession = null,
  onPendingAgentSessionConsumed,
  gitOpenRequest = null,
  onGitOpenRequestConsumed,
  terminalOpenRequest = null,
  onTerminalOpenRequestConsumed,
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
  if (appId === "agent-personas") return <AgentPersonasModule />
  if (appId === "workflow") return <WorkflowModule />
  if (appId === "drive") return <DriveModule />
  if (appId === "automation") return <AutomationModule />
  if (appId === "launcher") {
    return (
      <LauncherContent
        pendingContentOpenRequest={resourceContentOpenRequest}
        onPendingContentOpenRequestConsumed={onResourceContentOpenRequestConsumed}
        resetKey={launcherResetKey}
        workflowEntryVisible={workflowEntryVisible}
      />
    )
  }
  if (appId === "settings") return <SettingsModule workflowEntryVisible={workflowEntryVisible} />
  if (appId === "resource-repository") {
    return (
      <ResourceRepositoryModule
        initialContentOpenRequest={resourceContentOpenRequest}
        onInitialContentOpenRequestConsumed={onResourceContentOpenRequestConsumed}
      />
    )
  }
  if (appId === "database") return <DatabaseModule />
  if (appId === "synapse-skill") return <SynapseSkillModule />
  if (appId === "secrets") return <SecretsModule />
  if (appId === "quick-input") return <QuickInputModule />
  if (appId === "terminal") {
    return (
      <TerminalModule
        openRequest={terminalOpenRequest}
        onOpenRequestConsumed={onTerminalOpenRequestConsumed}
      />
    )
  }
  if (appId === "git") {
    return (
      <GitModule
        openRequest={gitOpenRequest}
        onOpenRequestConsumed={onGitOpenRequestConsumed}
      />
    )
  }
  if (appId === "editor-scan") return <EditorScanModule />
  if (appId === "usage-monitor") return <UsageMonitorModule />
  if (appId === "model-price") return <ModelPriceModule />

  return assertNever(appId)
}

function assertNever(value: never): never {
  throw new Error(`Unhandled system app: ${String(value)}`)
}

function LauncherContent({
  pendingContentOpenRequest = null,
  onPendingContentOpenRequestConsumed,
  resetKey = 0,
  workflowEntryVisible = false,
}: {
  readonly pendingContentOpenRequest?: ContentOpenRequest | null
  readonly onPendingContentOpenRequestConsumed?: (requestId: string) => void
  readonly resetKey?: number
  readonly workflowEntryVisible?: boolean
}) {
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
    setActiveAppId(appId)
  }, [])

  const openAppWindow = async (appId: SynapseSystemAppId) => {
    try {
      const appsBridge = (getSynapseBridge() as ReturnType<typeof getSynapseBridge> & {
        readonly apps?: AppsBridge
      } | undefined)?.apps
      if (!appsBridge?.openSystemApp) {
        throw new Error("System app window bridge is unavailable.")
      }
      await appsBridge.openSystemApp(appId)
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

export { SystemAppContent }
