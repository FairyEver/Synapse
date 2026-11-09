import { runAppNavigation } from "@/app-shell/navigation-guard"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { requestOpenSettingsDock, type OpenAgentSessionPayload } from "@/app-shell/navigation"
import {
  subscribeContentOpenRequest,
  type ContentOpenRequest,
} from "@/app-shell/content-navigation"
import { AgentModule } from "@/modules/agent"
import { AutomationModule } from "@/modules/automation"
import { DatabaseModule } from "@/modules/database"
import { DriveModule } from "@/modules/drive"
import { TodosModule } from "@/modules/todos"
import { ExternalMailModule } from "@/modules/mail"
import { MailModule } from "@/modules/mail-internal"
import { EditorScanModule } from "@/modules/editor-scan"
import { GitModule } from "@/modules/git"
import { ModelPriceModule } from "@/modules/model-price"
import { ResourceRepositoryModule } from "@/modules/resource-repository"
import { SettingsModule } from "@/modules/settings"
import { WorkflowModule } from "@/modules/workflow"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { useCloudDock } from "@/modules/custom-apps/use-cloud-dock"
import { CustomAppsProvider, useCustomApps } from "@/modules/custom-apps/context"
import { CreateEditCustomAppDialog } from "@/modules/custom-apps/create-edit-dialog"
import { DeleteCustomAppDialog } from "@/modules/custom-apps/delete-dialog"
import { AgentPersonasModule } from "../../../../app-capabilities/agent-personas/renderer"
import { SynapseSkillModule } from "../../../../app-capabilities/synapse-skill/renderer"
import { SkillHubModule } from "../../../../app-capabilities/skill-hub/renderer"
import { SecretsModule } from "../../../../app-capabilities/secrets/renderer"
import { QuickInputModule } from "../../../../app-capabilities/quick-input/renderer"
import { TerminalModule } from "../../../../app-capabilities/terminal/renderer"
import { ConnectorsModule } from "../../../../app-capabilities/connectors/renderer"
import { MeetingModule } from "@/modules/meeting"
import { AppLauncherList } from "./app-launcher-list"
import { AppSwitchTransition } from "./app-switch-transition"
import { EmbeddedSystemAppShell } from "./embedded-system-app-shell"
import { getSystemAppManifest, listLaunchableSystemApps } from "../registry"
import type {
  SynapseSystemAppGitOpenRequest,
  SynapseSystemAppMailInternalOpenRequest,
  TodoOpenRequest,
  SynapseSystemAppId,
  SynapseSystemAppOpenOptions,
  SynapseSystemAppTerminalOpenRequest,
} from "../types"
import type { CustomAppCreateInput, CustomAppDto, CustomAppId, CustomAppUpdateInput } from "@synapse/shared"

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
  readonly meetingOpenRequest?: string | null
  readonly viewOpenRequest?:import("../types").AppViewOpenRequest|null
  readonly todoOpenRequest?: TodoOpenRequest | null
  readonly onTodoOpenRequestConsumed?: (requestId: string) => void
  readonly mailOpenRequest?: import("../../../../app-capabilities/mail/shared/private-schema").MailOpenRequest | null
  readonly onMailOpenRequestConsumed?: (id: string) => void
  readonly mailInternalOpenRequest?: SynapseSystemAppMailInternalOpenRequest | null
  readonly onMailInternalOpenRequestConsumed?: (requestId: string) => void
  readonly onMeetingOpenRequestConsumed?: () => void
  readonly onOpenCustomApp?: (appId: CustomAppId) => void
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
  meetingOpenRequest = null,
  viewOpenRequest=null,
  todoOpenRequest = null,
  onTodoOpenRequestConsumed,
  mailOpenRequest = null, onMailOpenRequestConsumed,
  mailInternalOpenRequest = null,
  onMailInternalOpenRequestConsumed,
  onMeetingOpenRequestConsumed,
  onOpenCustomApp,
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
  if (appId === "todos") return <TodosModule openRequest={todoOpenRequest} onOpenRequestConsumed={onTodoOpenRequestConsumed} />
  if (appId === "mail") return <ExternalMailModule openRequest={mailOpenRequest} onOpenRequestConsumed={onMailOpenRequestConsumed} />
  if (appId === "mail-internal") return <MailModule openRequest={mailInternalOpenRequest} onOpenRequestConsumed={onMailInternalOpenRequestConsumed} />
  if (appId === "automation") return <AutomationModule />
  if (appId === "launcher") {
    return (
      <LauncherContent
        pendingContentOpenRequest={resourceContentOpenRequest}
        onPendingContentOpenRequestConsumed={onResourceContentOpenRequestConsumed}
        resetKey={launcherResetKey}
        workflowEntryVisible={workflowEntryVisible}
          onOpenCustomApp={onOpenCustomApp}
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
  if (appId === "skill-hub") return <SkillHubModule />
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
  if (appId === "model-price") return <ModelPriceModule />
  if (appId === "connectors") return <ConnectorsModule />
  if (appId === "meeting") return <MeetingModule openRequest={meetingOpenRequest} onOpenRequestConsumed={onMeetingOpenRequestConsumed} />

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
  onOpenCustomApp,
}: {
  readonly pendingContentOpenRequest?: ContentOpenRequest | null
  readonly onPendingContentOpenRequestConsumed?: (requestId: string) => void
  readonly resetKey?: number
  readonly workflowEntryVisible?: boolean
  readonly onOpenCustomApp?: (appId: CustomAppId) => void
}) {
  return (
    <CustomAppsProvider>
      <LauncherContentInner
        pendingContentOpenRequest={pendingContentOpenRequest}
        onPendingContentOpenRequestConsumed={onPendingContentOpenRequestConsumed}
        resetKey={resetKey}
        workflowEntryVisible={workflowEntryVisible}
        onOpenCustomApp={onOpenCustomApp}
      />
    </CustomAppsProvider>
  )
}

function LauncherContentInner({
  pendingContentOpenRequest = null,
  onPendingContentOpenRequestConsumed,
  resetKey = 0,
  workflowEntryVisible = false,
  onOpenCustomApp,
}: {
  readonly pendingContentOpenRequest?: ContentOpenRequest | null
  readonly onPendingContentOpenRequestConsumed?: (requestId: string) => void
  readonly resetKey?: number
  readonly workflowEntryVisible?: boolean
  readonly onOpenCustomApp?: (appId: CustomAppId) => void
}) {
  const [activeAppId, setActiveAppId] = useState<SynapseSystemAppId | null>(null)
  const [resourceContentOpenRequest, setResourceContentOpenRequest] =
    useState<ContentOpenRequest | null>(null)
  const [launcherFocusAppId, setLauncherFocusAppId] =
    useState<SynapseSystemAppId | null>(null)
  const resetKeyRef = useRef(resetKey)
  const dock = useCloudDock({ workflowEntryVisible })
  const customApps = useCustomApps()
  const [customDialog, setCustomDialog] = useState<{ mode: "create" | "edit"; app: CustomAppDto | null } | null>(null)
  const [deleteApp, setDeleteApp] = useState<CustomAppDto | null>(null)

  useEffect(() => {
    if (!pendingContentOpenRequest) return
    void runAppNavigation(() => {
      setActiveAppId("resource-repository")
      setResourceContentOpenRequest(pendingContentOpenRequest)
    })
  }, [pendingContentOpenRequest])

  useEffect(() => {
    if (resetKeyRef.current === resetKey) return
    resetKeyRef.current = resetKey
    void runAppNavigation(() => { setActiveAppId(null); setResourceContentOpenRequest(null) })
  }, [resetKey])

  useEffect(() => {
    const availableAppIds = new Set(customApps.state.snapshot?.apps.map((app) => app.id) ?? [])
    if (customDialog?.app && !availableAppIds.has(customDialog.app.id)) setCustomDialog(null)
    if (deleteApp && !availableAppIds.has(deleteApp.id)) setDeleteApp(null)
  }, [customApps.state.snapshot, customDialog?.app, deleteApp])

  const openApp = useCallback((appId: SynapseSystemAppId) => {
    void runAppNavigation(() => {
      setLauncherFocusAppId(null)
      setActiveAppId(appId)
    })
  }, [])

  const openAppWindow = (appId: SynapseSystemAppId) => runAppNavigation(async () => {
    try {
      const appsBridge = (getSynapseBridge() as ReturnType<typeof getSynapseBridge> & {
        readonly apps?: AppsBridge
      } | undefined)?.apps
      if (!appsBridge?.openSystemApp) {
        throw new Error("System app window bridge is unavailable.")
      }
      await appsBridge.openSystemApp(appId)
      await runAppNavigation(() => {
        setLauncherFocusAppId(appId)
        setActiveAppId(null)
        setResourceContentOpenRequest(null)
      })
    } catch {
      toast.error("打开应用失败")
    }
  })

  const openResourceRepository = useCallback((request: ContentOpenRequest) => {
    void runAppNavigation(() => { setActiveAppId("resource-repository"); setResourceContentOpenRequest(request) })
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
          onBack={() => { void runAppNavigation(() => {
            setLauncherFocusAppId(activeApp.id)
            setActiveAppId(null)
            setResourceContentOpenRequest(null)
          }) }}
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
    <>
      <AppLauncherList
        key={resetKey}
        apps={listLaunchableSystemApps({ workflowEntryVisible })}
        focusAppId={launcherFocusAppId}
        pinnedAppIds={dock.dockAppIds}
        disabled={!dock.canEdit || dock.saving}
        onOpenApp={openApp}
        onPinApp={(appId) => void dock.addDockApp(appId)}
        onUnpinApp={(appId) => void dock.removeDockApp(appId)}
        onManageDock={requestOpenSettingsDock}
        customApps={customApps.state.snapshot?.apps.filter((app) => app.kind === "web") ?? []}
        canEditCustomApps={customApps.editable && dock.canEdit && !dock.saving}
        onCreateCustomApp={() => setCustomDialog({ mode: "create", app: null })}
        onOpenCustomApp={(app) => onOpenCustomApp?.(app.id)}
        onEditCustomApp={(app) => setCustomDialog({ mode: "edit", app })}
        onDeleteCustomApp={setDeleteApp}
      />
      <CreateEditCustomAppDialog
        open={customDialog !== null}
        mode={customDialog?.mode ?? "create"}
        app={customDialog?.app}
        disabled={!customApps.editable}
        onClose={() => setCustomDialog(null)}
        fetchFavicon={customApps.fetchFavicon}
        chooseIcon={customApps.chooseIcon}
        onSubmit={async (input) => {
          if (customDialog?.mode === "create") {
            await customApps.create(input as CustomAppCreateInput)
          } else if (customDialog?.app) {
            await customApps.update(customDialog.app.id, input as CustomAppUpdateInput)
          }
        }}
      />
      <DeleteCustomAppDialog
        app={deleteApp}
        onClose={() => setDeleteApp(null)}
        onConfirm={async (app) => {
          await customApps.delete(app.id, crypto.randomUUID())
          setDeleteApp(null)
        }}
      />
    </>
  )
}

export { SystemAppContent }
