import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { ArrowDown, ArrowUp, Check, CircleDot, CircleHelp, Code2, Copy, Folder, FolderOpen, Link2Off, Mic, MoreHorizontal, PanelLeft, Pencil, Pin, Plus, RotateCw, Settings, Square, Terminal as TerminalIcon, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { useVoiceActionKey } from "../../../src/modules/voice/use-voice-action-key"
import { useVoiceInput } from "../../../src/modules/voice/use-voice-input"
import { describeVoiceInput } from "../../../src/modules/voice/voice-input-presentation"
import { shouldBypassDeleteConfirm } from "../../../src/lib/delete-confirm-bypass"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../src/components/ui/alert-dialog"
import { Button } from "../../../src/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../../src/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../src/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../src/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "../../../src/components/ui/empty"
import { Field, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../src/components/ui/table"
import { Textarea } from "../../../src/components/ui/textarea"
import {
  ModuleSidebar,
  ModuleSidebarGroup,
  ModuleSidebarList,
  ModuleSidebarRow,
} from "../../../src/components/module-sidebar"
import {
  ModuleSidebarSortableGroup,
  ModuleSidebarSortableList,
} from "../../../src/components/module-sidebar-sortable"
import { SidebarContentLayout } from "../../../src/components/sidebar-content-layout"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { runTrackedOperation } from "../../../src/lib/ui-tracking"
import { getRendererPlatform } from "../../../src/lib/runtime-platform"
import { readSidebarCollapsed, writeSidebarCollapsed } from "../../../src/lib/sidebar-layout-storage"
import { cn } from "../../../src/lib/utils"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "../../../src/modules/apps/components/system-app-top-bar"
import type { SynapseSystemAppTerminalOpenRequest } from "../../../src/modules/apps/types"
import type {
  SynapseTerminalGlobalLaunchSettings,
  SynapseTerminalAgentNotificationSettings,
  SynapseTerminalCreateCustomToolbarActionInput,
  SynapseTerminalCustomToolbarAction,
  SynapseTerminalGroup,
  SynapseTerminalGroupCommand,
  SynapseTerminalGroupCommandSummary,
  SynapseTerminalGroupSummary,
  SynapseTerminalCreateSessionInput,
  SynapseTerminalLaunchLayer,
  SynapseTerminalPaneDropEdge,
  SynapseTerminalSession,
  SynapseTerminalUpdateCustomToolbarActionInput,
  SynapseTerminalWorkspace,
} from "../../../src/types/terminal"
import { collectTerminalPaneLeaves } from "../shared/schema"
import { buildTerminalSessionReferenceText } from "../shared/session-reference"
import {
  buildTerminalCommandWrites,
  TERMINAL_COMMAND_ENTER_DELAY_MS,
} from "../shared/terminal-input"
import {
  readTerminalAppearanceSize,
  writeTerminalAppearanceSize,
} from "./terminal-appearance"
import { TerminalLaunchSettingsForm } from "./terminal-launch-settings-form"
import {
  TerminalWorkspaceView,
  type TerminalWorkspaceViewHandle,
} from "./terminal-workspace-view"
import {
  getTerminalToolbarActions,
  isTerminalToolbarActionEnabled,
  resolveTerminalToolbarPayload,
  type TerminalToolbarAction,
} from "./terminal-toolbar-actions"
import { TerminalToolbarManagerDialog } from "./terminal-toolbar-manager-dialog"
import {
  applyGroupOrder,
  moveGroupId,
  type TerminalGroupMoveDirection,
} from "./terminal-group-order"

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const TERMINAL_SIDEBAR_PERSISTENCE_ID = "terminal"
const UNGROUPED_TERMINAL_GROUP_ID = "ungrouped"
const logger = createRendererLogger("terminal.app")

export function TerminalModule({
  openRequest = null,
  onOpenRequestConsumed,
}: {
  readonly openRequest?: SynapseSystemAppTerminalOpenRequest | null
  readonly onOpenRequestConsumed?: (requestId: string) => void
} = {}) {
  const terminalBridge = requireBridgeDomain("terminal")
  const [groups, setGroups] = useState<SynapseTerminalGroupSummary[]>([])
  const [workspaces, setWorkspaces] = useState<SynapseTerminalWorkspace[]>([])
  const [sessions, setSessions] = useState<SynapseTerminalSession[]>([])
  const [customToolbarActions, setCustomToolbarActions] = useState<SynapseTerminalCustomToolbarAction[]>([])
  const [toolbarManagerOpen, setToolbarManagerOpen] = useState(false)
  /** 已填入命令行、还没按 Enter 的语音转写文本。 */
  const [pendingVoiceText, setPendingVoiceText] = useState<string | null>(null)
  const voice = useVoiceInput()
  const voicePresentation = describeVoiceInput(voice.state)
  // 右槽一个位置两件事:能重试就给旋转箭头,否则给对勾。置灰的那两种点不动。
  const isVoiceRetry = voicePresentation.action === "retry" || voicePresentation.action === "retry-disabled"
  const isVoiceActionDisabled = voicePresentation.action === "confirm-disabled" || voicePresentation.action === "retry-disabled"
  /** 转写那一行。终端是宽容器，但一条命令说长了照样撑满，撑满就滚到光标。 */
  const voiceTranscriptRef = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    const element = voiceTranscriptRef.current
    if (element) element.scrollLeft = element.scrollWidth
  }, [voice.state.transcript])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [activePaneIds, setActivePaneIds] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
  const [globalLaunchSettings, setGlobalLaunchSettings] = useState<SynapseTerminalGlobalLaunchSettings | null>(null)
  const [agentNotificationSettings, setAgentNotificationSettings] = useState<SynapseTerminalAgentNotificationSettings | null>(null)
  const [agentNotificationsEnabledDraft, setAgentNotificationsEnabledDraft] = useState(false)
  const [globalLaunchDraft, setGlobalLaunchDraft] = useState<SynapseTerminalLaunchLayer>({})
  const [terminalAppearanceSize, setTerminalAppearanceSize] = useState(readTerminalAppearanceSize)
  const [terminalAppearanceSizeDraft, setTerminalAppearanceSizeDraft] = useState(terminalAppearanceSize)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => (
    readSidebarCollapsed(TERMINAL_SIDEBAR_PERSISTENCE_ID)
  ))
  const [globalLaunchSaving, setGlobalLaunchSaving] = useState(false)
  const [globalLaunchChoosingDirectory, setGlobalLaunchChoosingDirectory] = useState(false)
  const [renameTarget, setRenameTarget] = useState<SynapseTerminalWorkspace | null>(null)
  const [renameTitle, setRenameTitle] = useState("")
  const [renameSaving, setRenameSaving] = useState(false)
  const [sessionRenameTarget, setSessionRenameTarget] = useState<SynapseTerminalSession | null>(null)
  const [sessionRenameTitle, setSessionRenameTitle] = useState("")
  const [sessionRenameSaving, setSessionRenameSaving] = useState(false)
  const [closingWorkspaceId, setClosingWorkspaceId] = useState<string | null>(null)
  const [pendingClosePaneIds, setPendingClosePaneIds] = useState<ReadonlySet<string>>(() => new Set())
  const [groupDialogMode, setGroupDialogMode] = useState<"create" | "rename" | null>(null)
  const [groupRenameTarget, setGroupRenameTarget] = useState<SynapseTerminalGroupSummary | null>(null)
  const [groupName, setGroupName] = useState("")
  const [groupSaving, setGroupSaving] = useState(false)
  const [groupReordering, setGroupReordering] = useState(false)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<SynapseTerminalGroupSummary | null>(null)
  const [deleteGroupSaving, setDeleteGroupSaving] = useState(false)
  const [groupSettingsTarget, setGroupSettingsTarget] = useState<SynapseTerminalGroup | null>(null)
  const [groupSettingsName, setGroupSettingsName] = useState("")
  const [groupSettingsLaunch, setGroupSettingsLaunch] = useState<SynapseTerminalLaunchLayer>({})
  const [groupSettingsSaving, setGroupSettingsSaving] = useState(false)
  const [groupSettingsChoosingDirectory, setGroupSettingsChoosingDirectory] = useState(false)
  const [commandManagerTarget, setCommandManagerTarget] = useState<SynapseTerminalGroup | null>(null)
  const [commandManagerCommands, setCommandManagerCommands] = useState<SynapseTerminalGroupCommandSummary[]>([])
  const [commandFormOpen, setCommandFormOpen] = useState(false)
  const [commandEditTarget, setCommandEditTarget] = useState<SynapseTerminalGroupCommand | null>(null)
  const [commandName, setCommandName] = useState("")
  const [commandText, setCommandText] = useState("")
  const [commandLaunch, setCommandLaunch] = useState<SynapseTerminalLaunchLayer>({})
  const [commandChoosingDirectory, setCommandChoosingDirectory] = useState(false)
  const [commandSaving, setCommandSaving] = useState(false)
  const [commandDeletingId, setCommandDeletingId] = useState<string | null>(null)
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openGroupIds, setOpenGroupIds] = useState<Record<string, boolean>>({})
  const [mountedWorkspaceIds, setMountedWorkspaceIds] = useState<ReadonlySet<string>>(() => new Set())
  const workspaceViewRefs = useRef(new Map<string, TerminalWorkspaceViewHandle>())
  const renameReturnFocusRef = useRef<HTMLElement | null>(null)
  const sessionRenameReturnFocusRef = useRef<HTMLElement | null>(null)
  const deleteGroupReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const createSessionActionRef = useRef<HTMLButtonElement | null>(null)
  const pendingActiveRowFocusRef = useRef(false)
  const createGroupActionRef = useRef<HTMLButtonElement | null>(null)
  const pendingClosePaneIdsRef = useRef(new Set<string>())
  const refreshRequestIdRef = useRef(0)
  const toolbarActionRefreshRequestIdRef = useRef(0)
  const workspaceMutationQueuesRef = useRef(new Map<string, Promise<void>>())

  const activeWorkspace = useMemo(() => {
    if (!activeWorkspaceId) return workspaces[0] ?? null
    return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null
  }, [activeWorkspaceId, workspaces])
  const activeWorkspaceLeaves = activeWorkspace ? collectTerminalPaneLeaves(activeWorkspace.layout) : []
  const activePaneId = activeWorkspace
    ? activePaneIds[activeWorkspace.id] && activeWorkspaceLeaves.some((pane) => pane.paneId === activePaneIds[activeWorkspace.id])
      ? activePaneIds[activeWorkspace.id]!
      : activeWorkspaceLeaves[0]?.paneId ?? null
    : null
  const activePane = activeWorkspaceLeaves.find((pane) => pane.paneId === activePaneId) ?? null
  const activeSession = activePane
    ? sessions.find((session) => session.id === activePane.sessionId) ?? null
    : null
  const terminalSessionStatus = activeSession?.status ?? null
  /**
   * 当前会话的格数归手机时整块锁住。
   *
   * pane 自己锁住的是面板：内容、输入、顶栏按钮。底部命令条在 pane 外面，得自己看这
   * 个条件 —— 否则它一直是绕过锁的第二条路，按钮点一下就写进手机正在用的那个终端。
   */
  const sessionLockedByMobile = activeSession?.sizeOwner?.kind === "mobile"

  useEffect(() => {
    void terminalBridge.agentNotifications.reportActiveSession({
      sessionId: activeSession?.id ?? null,
    }).catch((error) => {
      logger.warn("Failed to report the active Terminal session.", error)
    })
  }, [activeSession?.id, terminalBridge])

  useEffect(() => () => {
    void terminalBridge.agentNotifications.reportActiveSession({ sessionId: null }).catch(() => undefined)
  }, [terminalBridge])

  useEffect(() => {
    // 语音确认后是直接写进 PTY 的，锁住期间不能留着一条走到终端的路。已经开录的就在
    // 这一刻结束：麦克风入口反正已经禁用，让转写条停在锁下面反而是一个点不动的陷阱。
    if (!sessionLockedByMobile) return
    voice.cancel()
  }, [sessionLockedByMobile, voice.cancel])

  useEffect(() => {
    if (!activeWorkspace) return
    setMountedWorkspaceIds((current) => {
      if (current.has(activeWorkspace.id)) return current
      return new Set(current).add(activeWorkspace.id)
    })
  }, [activeWorkspace])

  useEffect(() => {
    const workspaceIds = new Set(workspaces.map((workspace) => workspace.id))
    setMountedWorkspaceIds((current) => {
      const next = new Set([...current].filter((workspaceId) => workspaceIds.has(workspaceId)))
      return next.size === current.size ? current : next
    })
  }, [workspaces])

  const workspaceGroups = useMemo(() => groupWorkspaces(groups, workspaces), [groups, workspaces])
  const sortableGroups = useMemo(
    () => workspaceGroups.filter((group) => group.id !== UNGROUPED_TERMINAL_GROUP_ID),
    [workspaceGroups],
  )
  const ungroupedGroup = useMemo(
    () => workspaceGroups.find((group) => group.id === UNGROUPED_TERMINAL_GROUP_ID) ?? null,
    [workspaceGroups],
  )
  const sortableGroupIds = useMemo(() => sortableGroups.map((group) => group.id), [sortableGroups])
  const activeHeaderWorkspaces = useMemo(() => {
    const sessionsById = new Map(sessions.map((session) => [session.id, session]))
    return workspaceGroups
      .flatMap((group) => group.workspaces)
      .filter((workspace) => !workspace.closing && collectTerminalPaneLeaves(workspace.layout)
        .some((pane) => sessionsById.get(pane.sessionId)?.status === "running"))
  }, [sessions, workspaceGroups])
  const rendererPlatform = getRendererPlatform()
  const toolbarActions = useMemo(
    () => getTerminalToolbarActions(rendererPlatform),
    [rendererPlatform],
  )
  const globalLaunchDirty = globalSettingsOpen
    && (
      JSON.stringify(globalLaunchDraft) !== JSON.stringify(globalLaunchSettings?.settings ?? {})
      || terminalAppearanceSizeDraft !== terminalAppearanceSize
      || agentNotificationsEnabledDraft !== agentNotificationSettings?.enabled
    )
  const groupSettingsDirty = Boolean(groupSettingsTarget) && (
    groupSettingsName !== groupSettingsTarget?.name
    || JSON.stringify(groupSettingsLaunch) !== JSON.stringify(groupSettingsTarget ? launchLayerFromGroup(groupSettingsTarget) : {})
  )
  const commandFormDirty = commandFormOpen && (
    commandName !== (commandEditTarget?.name ?? "")
    || commandText !== (commandEditTarget?.command ?? "")
    || JSON.stringify(commandLaunch) !== JSON.stringify(commandEditTarget?.launch ?? {})
  )

  const requestDiscard = useCallback((dirty: boolean, action: () => void) => {
    if (!dirty) {
      action()
      return
    }
    setDiscardAction(() => action)
  }, [])

  const refreshSessions = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current
    const [nextGroups, nextWorkspaces, nextSessions] = await Promise.all([
      terminalBridge.group.list(),
      terminalBridge.workspace.list(),
      terminalBridge.session.list(),
    ])
    if (requestId !== refreshRequestIdRef.current) return
    setGroups(nextGroups)
    setWorkspaces(nextWorkspaces)
    setSessions(nextSessions)
    setActiveWorkspaceId((current) => {
      if (current && nextWorkspaces.some((workspace) => workspace.id === current)) return current
      return nextWorkspaces[0]?.id ?? null
    })
  }, [terminalBridge])

  const refreshCustomToolbarActions = useCallback(async () => {
    const requestId = ++toolbarActionRefreshRequestIdRef.current
    const actions = await terminalBridge.toolbarAction.list()
    if (requestId === toolbarActionRefreshRequestIdRef.current) setCustomToolbarActions(actions)
  }, [terminalBridge])

  const enqueueWorkspaceMutation = useCallback(<T,>(
    workspaceId: string,
    mutation: () => Promise<T>,
  ): Promise<T> => {
    const previous = workspaceMutationQueuesRef.current.get(workspaceId)
    const run = previous ? previous.then(mutation, mutation) : mutation()
    const settled = run.then(() => undefined, () => undefined)
    workspaceMutationQueuesRef.current.set(workspaceId, settled)
    void settled.then(() => {
      if (workspaceMutationQueuesRef.current.get(workspaceId) === settled) {
        workspaceMutationQueuesRef.current.delete(workspaceId)
      }
    })
    return run
  }, [])

  const getCurrentWorkspace = useCallback(async (workspaceId: string) => (
    (await terminalBridge.workspace.list()).find((workspace) => workspace.id === workspaceId) ?? null
  ), [terminalBridge])

  const refreshAfterWorkspaceMutation = useCallback(async (message: string) => {
    try {
      await refreshSessions()
    } catch (error) {
      logger.warn(message, error)
    }
  }, [refreshSessions])

  const setPaneClosePending = useCallback((paneId: string, pending: boolean) => {
    if (pending) pendingClosePaneIdsRef.current.add(paneId)
    else pendingClosePaneIdsRef.current.delete(paneId)
    setPendingClosePaneIds(new Set(pendingClosePaneIdsRef.current))
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)
    Promise.all([refreshSessions(), refreshCustomToolbarActions()])
      .catch((error) => {
        logger.error("Failed to load terminal sessions.", error)
        if (active) setLoadError("加载终端失败")
        toast.error("加载终端失败")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [refreshCustomToolbarActions, refreshSessions])

  useEffect(() => terminalBridge.operation.onDomainChanged((event) => {
    const refresh = event.eventType?.startsWith("toolbar_action.")
      ? refreshCustomToolbarActions()
      : refreshSessions()
    void refresh.catch((error) => {
      logger.warn("Failed to refresh terminal objects after a domain change.", error)
    })
  }), [refreshCustomToolbarActions, refreshSessions, terminalBridge])

  useEffect(() => {
    if (!openRequest) return
    let cancelled = false
    Promise.all([
      terminalBridge.group.list(),
      terminalBridge.session.get({ sessionId: openRequest.sessionId }),
      terminalBridge.workspace.getForSession({ sessionId: openRequest.sessionId }),
    ])
      .then(([nextGroups, session, workspace]) => {
        if (cancelled) return
        setGroups(nextGroups)
        setSessions((current) => mergeSession(current, session))
        setWorkspaces((current) => mergeWorkspace(current, workspace))
        setActiveWorkspaceId(workspace.id)
        const pane = collectTerminalPaneLeaves(workspace.layout).find((item) => item.sessionId === session.id)
        if (pane) setActivePaneIds((current) => ({ ...current, [workspace.id]: pane.paneId }))
        setOpenGroupIds((current) => ({ ...current, [session.groupId]: true }))
      })
      .catch((error) => {
        if (cancelled) return
        logger.warn("Failed to focus requested terminal session.", error)
        toast.error("终端会话不存在")
      })
      .finally(() => {
        if (!cancelled) onOpenRequestConsumed?.(openRequest.requestId)
      })
    return () => {
      cancelled = true
    }
  }, [onOpenRequestConsumed, openRequest, terminalBridge])

  const createSession = useCallback(async (input: SynapseTerminalCreateSessionInput = {}) => {
    try {
      const session = await runTrackedOperation(
        { component: "terminal", eventKey: "terminal.session.create" },
        () => terminalBridge.session.create({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS, ...input }),
      )
      const workspace = await terminalBridge.workspace.getForSession({ sessionId: session.id })
      setSessions((current) => mergeSession(current, session))
      setWorkspaces((current) => mergeWorkspace(current, workspace))
      setActiveWorkspaceId(workspace.id)
      const paneId = collectTerminalPaneLeaves(workspace.layout)[0]?.paneId
      if (paneId) setActivePaneIds((current) => ({ ...current, [workspace.id]: paneId }))
      terminalBridge.group.list()
        .then(setGroups)
        .catch((error) => {
          logger.warn("Failed to refresh terminal groups after session creation.", error)
          toast.error("刷新终端分组失败")
        })
    } catch (error) {
      logger.error("Failed to create terminal session.", error)
      toast.error("新建终端失败")
    }
  }, [terminalBridge])

  const openRenameDialog = useCallback((workspace: SynapseTerminalWorkspace, returnFocus: HTMLElement) => {
    renameReturnFocusRef.current = returnFocus
    setRenameTarget(workspace)
    setRenameTitle(workspace.title)
  }, [])

  const closeRenameDialog = useCallback(() => {
    setRenameTarget(null)
    setRenameTitle("")
  }, [])

  const openSessionRenameDialog = useCallback((sessionId: string, returnFocus: HTMLElement | null) => {
    const session = sessions.find((item) => item.id === sessionId)
    if (!session) return
    sessionRenameReturnFocusRef.current = returnFocus
    setSessionRenameTarget(session)
    setSessionRenameTitle(session.title)
  }, [sessions])

  const closeSessionRenameDialog = useCallback(() => {
    setSessionRenameTarget(null)
    setSessionRenameTitle("")
  }, [])

  const closeDeleteGroupDialog = useCallback(() => {
    setDeleteGroupTarget(null)
  }, [])

  const openCreateGroupDialog = useCallback(() => {
    setGroupDialogMode("create")
    setGroupRenameTarget(null)
    setGroupName("")
  }, [])

  const openRenameGroupDialog = useCallback((group: SynapseTerminalGroupSummary) => {
    setGroupDialogMode("rename")
    setGroupRenameTarget(group)
    setGroupName(group.name)
  }, [])

  const openGroupSettingsDialog = useCallback(async (group: SynapseTerminalGroupSummary) => {
    try {
      const [details, globalSettings] = await Promise.all([
        terminalBridge.group.get({ groupId: group.id }),
        terminalBridge.globalLaunch.get(),
      ])
      setGlobalLaunchSettings(globalSettings)
      setGroupSettingsTarget(details)
      setGroupSettingsName(details.name)
      setGroupSettingsLaunch(launchLayerFromGroup(details))
    } catch (error) {
      logger.error("Failed to load terminal group settings.", error)
      toast.error("加载分组设置失败")
    }
  }, [terminalBridge])

  const openGlobalSettingsDialog = useCallback(async () => {
    try {
      const [launchSettings, notificationSettings] = await Promise.all([
        terminalBridge.globalLaunch.get(),
        terminalBridge.agentNotifications.get(),
      ])
      setGlobalLaunchSettings(launchSettings)
      setGlobalLaunchDraft(launchSettings.settings ?? {})
      setAgentNotificationSettings(notificationSettings)
      setAgentNotificationsEnabledDraft(notificationSettings.enabled)
      setTerminalAppearanceSizeDraft(terminalAppearanceSize)
      setGlobalSettingsOpen(true)
    } catch (error) {
      logger.error("Failed to load global terminal launch settings.", error)
      toast.error("加载终端设置失败")
    }
  }, [terminalAppearanceSize, terminalBridge])

  const chooseLaunchCwd = useCallback(async (
    setChoosing: (value: boolean) => void,
    setLaunch: (updater: (current: SynapseTerminalLaunchLayer) => SynapseTerminalLaunchLayer) => void,
  ) => {
    setChoosing(true)
    try {
      const selectedPath = await terminalBridge.launch.chooseCwd()
      if (selectedPath) setLaunch((current) => ({ ...current, defaultCwd: selectedPath }))
    } catch (error) {
      logger.error("Failed to choose terminal launch cwd.", error)
      toast.error("选择工作目录失败")
    } finally {
      setChoosing(false)
    }
  }, [terminalBridge])

  const saveGlobalLaunchSettings = useCallback(async () => {
    if (!globalLaunchSettings || !agentNotificationSettings) return
    setGlobalLaunchSaving(true)
    try {
      const launchSettingsChanged = JSON.stringify(globalLaunchDraft)
        !== JSON.stringify(globalLaunchSettings.settings ?? {})
      const notificationSettingsChanged = agentNotificationsEnabledDraft
        !== agentNotificationSettings.enabled
      const [updatedLaunch, updatedNotifications] = await runTrackedOperation(
        { component: "terminal", eventKey: "terminal.settings.update" },
        () => Promise.all([
          launchSettingsChanged
            ? terminalBridge.globalLaunch.update({
                expectedRevision: globalLaunchSettings.revision,
                settings: Object.keys(globalLaunchDraft).length ? globalLaunchDraft : undefined,
              })
            : Promise.resolve(globalLaunchSettings),
          notificationSettingsChanged
            ? terminalBridge.agentNotifications.update({
                enabled: agentNotificationsEnabledDraft,
                expectedRevision: agentNotificationSettings.revision,
              })
            : Promise.resolve(agentNotificationSettings),
        ]),
      )
      writeTerminalAppearanceSize(terminalAppearanceSizeDraft)
      setTerminalAppearanceSize(terminalAppearanceSizeDraft)
      setGlobalLaunchSettings(updatedLaunch)
      setAgentNotificationSettings(updatedNotifications)
      setGlobalSettingsOpen(false)
      toast.success("终端设置已保存")
    } catch (error) {
      try {
        const [launchSettings, notificationSettings] = await Promise.all([
          terminalBridge.globalLaunch.get(),
          terminalBridge.agentNotifications.get(),
        ])
        setGlobalLaunchSettings(launchSettings)
        setGlobalLaunchDraft(launchSettings.settings ?? {})
        setAgentNotificationSettings(notificationSettings)
        setAgentNotificationsEnabledDraft(notificationSettings.enabled)
      } catch (reloadError) {
        logger.warn("Failed to reload terminal settings after save failure.", reloadError)
      }
      logger.error("Failed to save global terminal launch settings.", error)
      toast.error(error instanceof Error && error.message.includes("revision_conflict")
        ? "设置已被其他操作更新，请重新打开后再保存"
        : "保存终端设置失败")
    } finally {
      setGlobalLaunchSaving(false)
    }
  }, [
    agentNotificationSettings,
    agentNotificationsEnabledDraft,
    globalLaunchDraft,
    globalLaunchSettings,
    terminalAppearanceSizeDraft,
    terminalBridge,
  ])

  const saveGroup = useCallback(async () => {
    const name = groupName.trim()
    if (!name) return
    setGroupSaving(true)
    try {
      if (groupDialogMode === "rename" && groupRenameTarget) {
        const group = await runTrackedOperation(
          { component: "terminal", eventKey: "terminal.group.rename" },
          () => terminalBridge.group.rename({ groupId: groupRenameTarget.id, name: groupName }),
        )
        setGroups((current) => current.map((item) => item.id === group.id ? summarizeGroup(group) : item))
      } else {
        const group = await runTrackedOperation(
          { component: "terminal", eventKey: "terminal.group.create" },
          () => terminalBridge.group.create({ name }),
        )
        setGroups((current) => mergeGroup(current, group))
      }
      setGroupDialogMode(null)
      setGroupRenameTarget(null)
      setGroupName("")
    } catch (error) {
      logger.error("Failed to save terminal group.", error)
      toast.error(groupDialogMode === "rename" ? "重命名分组失败" : "新建分组失败")
    } finally {
      setGroupSaving(false)
    }
  }, [groupDialogMode, groupName, groupRenameTarget, terminalBridge])

  const renameWorkspace = useCallback(async () => {
    if (!renameTarget) return
    const title = renameTitle.trim()
    if (!title) return
    setRenameSaving(true)
    try {
      const workspace = await enqueueWorkspaceMutation(renameTarget.id, async () => {
        const current = await getCurrentWorkspace(renameTarget.id)
        if (!current) throw new Error("Terminal workspace not found")
        return runTrackedOperation(
          { component: "terminal", eventKey: "terminal.workspace.rename" },
          () => terminalBridge.workspace.rename({
            workspaceId: current.id,
            title,
            expectedLayoutRevision: current.layoutRevision,
          }),
        )
      })
      setWorkspaces((current) => mergeWorkspace(current, workspace))
      closeRenameDialog()
    } catch (error) {
      logger.error("Failed to rename terminal workspace.", error)
      await refreshAfterWorkspaceMutation("Failed to refresh terminal objects after renaming a workspace.")
      toast.error("重命名终端失败")
    } finally {
      setRenameSaving(false)
    }
  }, [closeRenameDialog, enqueueWorkspaceMutation, getCurrentWorkspace, refreshAfterWorkspaceMutation, renameTarget, renameTitle, terminalBridge])

  const applyWorkspaceMetadata = useCallback(async (
    target: SynapseTerminalWorkspace,
    patch: { readonly pinned?: boolean },
    failureMessage: string,
  ) => {
    try {
      const workspace = await enqueueWorkspaceMutation(target.id, async () => {
        const current = await getCurrentWorkspace(target.id)
        if (!current) throw new Error("Terminal workspace not found")
        return runTrackedOperation(
          { component: "terminal", eventKey: "terminal.workspace.update" },
          () => terminalBridge.workspace.update({
            workspaceId: current.id,
            expectedLayoutRevision: current.layoutRevision,
            ...patch,
          }),
        )
      })
      setWorkspaces((current) => mergeWorkspace(current, workspace))
      return workspace
    } catch (error) {
      logger.error("Failed to update terminal workspace metadata.", error)
      await refreshAfterWorkspaceMutation("Failed to refresh terminal objects after updating a workspace.")
      toast.error(failureMessage)
      return null
    }
  }, [enqueueWorkspaceMutation, getCurrentWorkspace, refreshAfterWorkspaceMutation, terminalBridge])

  const toggleWorkspacePinned = useCallback(async (workspace: SynapseTerminalWorkspace) => {
    await applyWorkspaceMetadata(
      workspace,
      { pinned: !workspace.pinned },
      workspace.pinned ? "取消置顶失败" : "置顶失败",
    )
  }, [applyWorkspaceMetadata])

  const renameSession = useCallback(async () => {
    if (!sessionRenameTarget) return
    const title = sessionRenameTitle.trim()
    if (!title) return
    setSessionRenameSaving(true)
    try {
      const session = await runTrackedOperation(
        { component: "terminal", eventKey: "terminal.session.rename" },
        () => terminalBridge.session.rename({ sessionId: sessionRenameTarget.id, title }),
      )
      setSessions((current) => mergeSession(current, session))
      closeSessionRenameDialog()
    } catch (error) {
      logger.error("Failed to rename terminal session.", error)
      toast.error("重命名对话失败")
    } finally {
      setSessionRenameSaving(false)
    }
  }, [closeSessionRenameDialog, sessionRenameTarget, sessionRenameTitle, terminalBridge])

  const closeWorkspace = useCallback(async (target: SynapseTerminalWorkspace, force = false) => {
    setClosingWorkspaceId(target.id)
    try {
      const result = await enqueueWorkspaceMutation(target.id, async () => {
        const current = await getCurrentWorkspace(target.id)
        if (!current) return { workspaceId: target.id, state: "deleted" as const, remainingSessionIds: [] }
        const eventKey = force ? "terminal.workspace.force_close" : "terminal.workspace.close"
        return runTrackedOperation(
          { component: "terminal", eventKey },
          () => terminalBridge.workspace.close({
            workspaceId: current.id,
            expectedLayoutRevision: current.layoutRevision,
            ...(force ? { force: true } : {}),
          }),
        )
      })
      if (result.state === "deleted") {
        setWorkspaces((current) => current.filter((workspace) => workspace.id !== target.id))
        setActiveWorkspaceId((current) => current === target.id ? null : current)
        pendingActiveRowFocusRef.current = true
      }
      await refreshAfterWorkspaceMutation("Failed to refresh terminal objects after closing a workspace.")
    } catch (error) {
      logger.error("Failed to close terminal workspace.", error)
      await refreshAfterWorkspaceMutation("Failed to refresh terminal objects after a workspace close error.")
      toast.error("关闭终端失败")
    } finally {
      setClosingWorkspaceId((current) => current === target.id ? null : current)
    }
  }, [enqueueWorkspaceMutation, getCurrentWorkspace, refreshAfterWorkspaceMutation, terminalBridge])

  /**
   * Returns focus to the surviving active row once a closed workspace is actually gone.
   *
   * This used to run from a `setTimeout(0)`, which fired before React committed the removal: the
   * closing row still carried `aria-current="page"`, so the query found and focused that very row,
   * and focus fell to `document.body` when the row was then removed. Effects run after the commit,
   * where the closing row can no longer be matched.
   */
  useEffect(() => {
    if (!pendingActiveRowFocusRef.current) return
    pendingActiveRowFocusRef.current = false
    const nextActiveRow = document.querySelector<HTMLElement>(
      '[data-track="terminal-session-select"][aria-current="page"]',
    )
    ;(nextActiveRow ?? createSessionActionRef.current)?.focus()
  }, [activeWorkspaceId, workspaces])

  const splitPane = useCallback(async (paneId: string, direction: "right" | "down") => {
    if (!activeWorkspace) return
    const workspaceId = activeWorkspace.id
    try {
      const result = await enqueueWorkspaceMutation(workspaceId, async () => {
        const current = await getCurrentWorkspace(workspaceId)
        if (!current || !collectTerminalPaneLeaves(current.layout).some((pane) => pane.paneId === paneId)) {
          throw new Error("Terminal pane not found")
        }
        const eventKey = `terminal.pane.split_${direction}`
        return runTrackedOperation(
          { component: "terminal", eventKey },
          () => terminalBridge.pane.split({
            workspaceId,
            paneId,
            direction,
            expectedLayoutRevision: current.layoutRevision,
            cols: DEFAULT_COLS,
            rows: DEFAULT_ROWS,
          }),
        )
      })
      const session = await terminalBridge.session.get({ sessionId: result.sessionId })
      setWorkspaces((current) => mergeWorkspace(current, result.workspace))
      setSessions((current) => mergeSession(current, session))
      setActivePaneIds((current) => ({ ...current, [result.workspace.id]: result.paneId }))
    } catch (error) {
      logger.error("Failed to split terminal pane.", error)
      await refreshAfterWorkspaceMutation("Failed to refresh terminal objects after a pane split error.")
      toast.error(error instanceof Error && error.message.includes("quota_exceeded")
        ? "一个终端最多支持 8 个分屏"
        : "创建分屏失败")
    }
  }, [activeWorkspace, enqueueWorkspaceMutation, getCurrentWorkspace, refreshAfterWorkspaceMutation, terminalBridge])

  const closePane = useCallback(async (paneId: string) => {
    if (!activeWorkspace) return
    if (pendingClosePaneIdsRef.current.has(paneId)) return
    const workspaceId = activeWorkspace.id
    const nextPaneId = collectTerminalPaneLeaves(activeWorkspace.layout)
      .find((pane) => pane.paneId !== paneId && !pendingClosePaneIdsRef.current.has(pane.paneId))?.paneId
    setPaneClosePending(paneId, true)
    if (nextPaneId) {
      setActivePaneIds((current) => ({ ...current, [workspaceId]: nextPaneId }))
    }
    try {
      await enqueueWorkspaceMutation(workspaceId, async () => {
        const current = await getCurrentWorkspace(workspaceId)
        if (!current || !collectTerminalPaneLeaves(current.layout).some((pane) => pane.paneId === paneId)) return
        const force = rendererPlatform === "darwin" && current.closingPaneIds.includes(paneId)
        const eventKey = force ? "terminal.pane.force_close" : "terminal.pane.close"
        await runTrackedOperation(
          { component: "terminal", eventKey },
          () => terminalBridge.pane.close({
            workspaceId,
            paneId,
            expectedLayoutRevision: current.layoutRevision,
            ...(force ? { force: true } : {}),
          }),
        )
        await refreshAfterWorkspaceMutation("Failed to refresh terminal objects after closing a pane.")
      })
    } catch (error) {
      logger.error("Failed to close terminal pane.", error)
      await refreshAfterWorkspaceMutation("Failed to refresh terminal objects after a pane close error.")
      toast.error("关闭分屏失败")
    } finally {
      setPaneClosePending(paneId, false)
    }
  }, [activeWorkspace, enqueueWorkspaceMutation, getCurrentWorkspace, refreshAfterWorkspaceMutation, rendererPlatform, setPaneClosePending, terminalBridge])

  const movePane = useCallback(async (
    sourcePaneId: string,
    targetPaneId: string,
    edge: SynapseTerminalPaneDropEdge,
  ) => {
    if (!activeWorkspace) return
    const workspaceId = activeWorkspace.id
    try {
      const workspace = await enqueueWorkspaceMutation(workspaceId, async () => {
        const current = await getCurrentWorkspace(workspaceId)
        if (!current) throw new Error("Terminal workspace not found")
        return runTrackedOperation(
          { component: "terminal", eventKey: "terminal.pane.move" },
          () => terminalBridge.pane.move({
            workspaceId,
            sourcePaneId,
            targetPaneId,
            edge,
            expectedLayoutRevision: current.layoutRevision,
          }),
        )
      })
      setWorkspaces((current) => mergeWorkspace(current, workspace))
      setActivePaneIds((current) => ({ ...current, [workspace.id]: sourcePaneId }))
    } catch (error) {
      logger.error("Failed to move terminal pane.", error)
      toast.error("移动分屏失败")
      void refreshAfterWorkspaceMutation("Failed to refresh terminal objects after a pane move error.")
    }
  }, [activeWorkspace, enqueueWorkspaceMutation, getCurrentWorkspace, refreshAfterWorkspaceMutation, terminalBridge])

  const updateSplitRatio = useCallback(async (splitId: string, ratio: number) => {
    if (!activeWorkspace) return
    const workspaceId = activeWorkspace.id
    try {
      const workspace = await enqueueWorkspaceMutation(workspaceId, async () => {
        const current = await getCurrentWorkspace(workspaceId)
        if (!current) throw new Error("Terminal workspace not found")
        return terminalBridge.pane.updateRatio({
          workspaceId,
          splitId,
          ratio,
          expectedLayoutRevision: current.layoutRevision,
        })
      })
      setWorkspaces((current) => mergeWorkspace(current, workspace))
    } catch (error) {
      logger.warn("Failed to persist terminal split ratio.", error)
      void refreshAfterWorkspaceMutation("Failed to refresh terminal objects after a split ratio error.")
    }
  }, [activeWorkspace, enqueueWorkspaceMutation, getCurrentWorkspace, refreshAfterWorkspaceMutation, terminalBridge])

  const equalizePane = useCallback(async (paneId: string) => {
    if (!activeWorkspace) return
    const workspaceId = activeWorkspace.id
    try {
      const workspace = await enqueueWorkspaceMutation(workspaceId, async () => {
        const current = await getCurrentWorkspace(workspaceId)
        if (!current) throw new Error("Terminal workspace not found")
        return runTrackedOperation(
          { component: "terminal", eventKey: "terminal.pane.equalize" },
          () => terminalBridge.pane.equalize({
            workspaceId,
            paneId,
            expectedLayoutRevision: current.layoutRevision,
          }),
        )
      })
      setWorkspaces((current) => mergeWorkspace(current, workspace))
    } catch (error) {
      logger.error("Failed to equalize terminal panes.", error)
      toast.error("平分分屏失败")
      void refreshAfterWorkspaceMutation("Failed to refresh terminal objects after a pane equalize error.")
    }
  }, [activeWorkspace, enqueueWorkspaceMutation, getCurrentWorkspace, refreshAfterWorkspaceMutation, terminalBridge])

  const deleteGroup = useCallback(async (target = deleteGroupTarget) => {
    if (!target) return
    const groupId = target.id
    setDeleteGroupSaving(true)
    try {
      await runTrackedOperation(
        { component: "terminal", eventKey: "terminal.group.delete" },
        () => terminalBridge.group.delete({ groupId }),
      )
      setGroups((current) => current.filter((group) => group.id !== groupId))
      setSessions((current) => current.filter((session) => session.groupId !== groupId))
      setWorkspaces((current) => current.filter((workspace) => workspace.groupId !== groupId))
      setActiveWorkspaceId((current) => {
        if (!current) return current
        return workspaces.some((workspace) => workspace.id === current && workspace.groupId === groupId) ? null : current
      })
      // A deleted group has no row left to return to, so focus goes to the control that creates
      // one. Handing it to the close handler keeps it out of the focus trap's way.
      deleteGroupReturnFocusRef.current = createGroupActionRef.current
      setDeleteGroupTarget(null)
    } catch (error) {
      logger.error("Failed to delete terminal group.", error)
      toast.error("删除分组失败")
    } finally {
      setDeleteGroupSaving(false)
    }
  }, [deleteGroupTarget, terminalBridge, workspaces])

  const deleteGroupMembers = deleteGroupTarget
    ? sessions.filter((session) => session.groupId === deleteGroupTarget.id)
    : []
  const deleteGroupHasActiveSessions = deleteGroupMembers.some((session) =>
    session.status === "running" || session.status === "stopping")

  const startDeleteGroup = useCallback((group: SynapseTerminalGroupSummary, event: MouseEvent<HTMLElement>) => {
    if (shouldBypassDeleteConfirm(event)) {
      void deleteGroup(group)
      return
    }
    deleteGroupReturnFocusRef.current = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[aria-label^="终端分组操作："]'),
    ).find((button) => button.getAttribute("aria-label") === `终端分组操作：${group.name}`) ?? null
    setDeleteGroupTarget(group)
  }, [deleteGroup])

  const resetGroupSettingsDialog = useCallback(() => {
    setGroupSettingsTarget(null)
    setGroupSettingsName("")
    setGroupSettingsLaunch({})
    setGroupSettingsChoosingDirectory(false)
  }, [])

  const chooseGroupSettingsDefaultCwd = useCallback(async () => {
    setGroupSettingsChoosingDirectory(true)
    try {
      await chooseLaunchCwd(setGroupSettingsChoosingDirectory, setGroupSettingsLaunch)
    } finally {
      setGroupSettingsChoosingDirectory(false)
    }
  }, [chooseLaunchCwd])

  const saveGroupSettings = useCallback(async () => {
    if (!groupSettingsTarget) return
    const name = groupSettingsName.trim()
    if (!name) return
    setGroupSettingsSaving(true)
    try {
      const group = await runTrackedOperation(
        { component: "terminal", eventKey: "terminal.group.settings-update" },
        () => terminalBridge.group.updateSettings({
          groupId: groupSettingsTarget.id,
          name,
          expectedLaunchRevision: groupSettingsTarget.launchRevision,
          settings: groupSettingsLaunch,
        }),
      )
      setGroups((current) => current.map((item) => item.id === group.id ? summarizeGroup(group) : item))
      resetGroupSettingsDialog()
    } catch (error) {
      logger.error("Failed to update terminal group settings.", error)
      toast.error("保存分组设置失败")
    } finally {
      setGroupSettingsSaving(false)
    }
  }, [
    groupSettingsLaunch,
    groupSettingsName,
    groupSettingsTarget,
    resetGroupSettingsDialog,
    terminalBridge,
  ])

  const persistGroupOrder = useCallback(async (orderedGroupIds: readonly string[]) => {
    if (groupReordering) return
    setGroupReordering(true)
    setGroups((current) => applyGroupOrder(current, orderedGroupIds))
    try {
      const nextGroups = await runTrackedOperation(
        { component: "terminal", eventKey: "terminal.group.reorder" },
        () => terminalBridge.group.reorder({ groupIds: [...orderedGroupIds] }),
      )
      setGroups(nextGroups)
    } catch (error) {
      logger.warn("Failed to persist terminal group order.", error)
      toast.error("调整分组顺序失败")
      try {
        setGroups(await terminalBridge.group.list())
      } catch (refreshError) {
        logger.warn("Failed to refresh terminal groups after a group order error.", refreshError)
      }
    } finally {
      setGroupReordering(false)
    }
  }, [groupReordering, terminalBridge])

  const moveGroup = useCallback((groupId: string, direction: TerminalGroupMoveDirection) => {
    const nextOrder = moveGroupId(sortableGroupIds, groupId, direction)
    if (!nextOrder) return
    void persistGroupOrder(nextOrder)
  }, [persistGroupOrder, sortableGroupIds])

  const openCommandManager = useCallback(async (group: SynapseTerminalGroupSummary) => {
    try {
      const [details, globalSettings] = await Promise.all([
        terminalBridge.group.get({ groupId: group.id }),
        terminalBridge.globalLaunch.get(),
      ])
      setGlobalLaunchSettings(globalSettings)
      setCommandManagerTarget(details)
      setCommandManagerCommands(group.settings?.commands ?? [])
      setCommandFormOpen(false)
      setCommandEditTarget(null)
      setCommandName("")
      setCommandText("")
      setCommandLaunch({})
    } catch (error) {
      logger.error("Failed to load terminal commands.", error)
      toast.error("加载命令失败")
    }
  }, [terminalBridge])

  const openCreateCommandDialog = useCallback(() => {
    setCommandEditTarget(null)
    setCommandName("")
    setCommandText("")
    setCommandLaunch({})
    setCommandFormOpen(true)
  }, [])

  const openEditCommandDialog = useCallback(async (command: SynapseTerminalGroupCommandSummary) => {
    if (!commandManagerTarget) return
    try {
      const details = await terminalBridge.groupCommand.get({
        groupId: commandManagerTarget.id,
        commandId: command.id,
      })
      setCommandEditTarget(details)
      setCommandName(details.name)
      setCommandText(details.command)
      setCommandLaunch(details.launch ?? {})
      setCommandFormOpen(true)
    } catch (error) {
      logger.error("Failed to load terminal command.", error)
      toast.error("加载命令失败")
    }
  }, [commandManagerTarget, terminalBridge])

  const closeCommandForm = useCallback(() => {
    setCommandFormOpen(false)
    setCommandEditTarget(null)
    setCommandName("")
    setCommandText("")
    setCommandLaunch({})
    setCommandChoosingDirectory(false)
  }, [])

  const refreshGroupsForCommandManager = useCallback(async (targetGroupId: string) => {
    const [nextGroups, details] = await Promise.all([
      terminalBridge.group.list(),
      terminalBridge.group.get({ groupId: targetGroupId }),
    ])
    setGroups(nextGroups)
    setCommandManagerTarget(details)
    setCommandManagerCommands(nextGroups.find((group) => group.id === targetGroupId)?.settings?.commands ?? [])
  }, [terminalBridge])

  const saveCommand = useCallback(async () => {
    if (!commandManagerTarget) return
    const name = commandName.trim()
    const command = commandText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
    if (!name || !command) return
    setCommandSaving(true)
    try {
      if (commandEditTarget) {
        await runTrackedOperation(
          { component: "terminal", eventKey: "terminal.command.update" },
          () => terminalBridge.groupCommand.update({
            groupId: commandManagerTarget.id,
            commandId: commandEditTarget.id,
            ...(commandEditTarget.commandRevision ? { expectedCommandRevision: commandEditTarget.commandRevision } : {}),
            name,
            command,
            launch: commandLaunch,
          }),
        )
      } else {
        await runTrackedOperation(
          { component: "terminal", eventKey: "terminal.command.create" },
          () => terminalBridge.groupCommand.create({
            groupId: commandManagerTarget.id,
            expectedCommandCollectionRevision: commandManagerTarget.commandCollectionRevision,
            name,
            command,
            ...(Object.keys(commandLaunch).length ? { launch: commandLaunch } : {}),
          }),
        )
      }
      await refreshGroupsForCommandManager(commandManagerTarget.id)
      closeCommandForm()
    } catch (error) {
      logger.error("Failed to save terminal command.", error)
      toast.error("保存命令失败")
    } finally {
      setCommandSaving(false)
    }
  }, [
    closeCommandForm,
    commandEditTarget,
    commandManagerTarget,
    commandName,
    commandLaunch,
    commandText,
    refreshGroupsForCommandManager,
    terminalBridge,
  ])

  const deleteCommand = useCallback(async (command: SynapseTerminalGroupCommandSummary) => {
    if (!commandManagerTarget) return
    setCommandDeletingId(command.id)
    try {
      await runTrackedOperation(
        { component: "terminal", eventKey: "terminal.command.delete" },
        () => terminalBridge.groupCommand.delete({ groupId: commandManagerTarget.id, commandId: command.id }),
      )
      await refreshGroupsForCommandManager(commandManagerTarget.id)
      if (commandEditTarget?.id === command.id) closeCommandForm()
    } catch (error) {
      logger.error("Failed to delete terminal command.", error)
      toast.error("删除命令失败")
    } finally {
      setCommandDeletingId((current) => current === command.id ? null : current)
    }
  }, [
    closeCommandForm,
    commandEditTarget,
    commandManagerTarget,
    refreshGroupsForCommandManager,
    terminalBridge,
  ])

  const launchCommand = useCallback(async (
    group: SynapseTerminalGroupSummary,
    command: SynapseTerminalGroupCommandSummary,
  ) => {
    try {
      const session = await runTrackedOperation(
        { component: "terminal", eventKey: "terminal.command.launch" },
        () => terminalBridge.groupCommand.launch({
          groupId: group.id,
          commandId: command.id,
          cols: DEFAULT_COLS,
          rows: DEFAULT_ROWS,
        }),
      )
      const workspace = await terminalBridge.workspace.getForSession({ sessionId: session.id })
      setSessions((current) => mergeSession(current, session))
      setWorkspaces((current) => mergeWorkspace(current, workspace))
      setActiveWorkspaceId(workspace.id)
      const paneId = collectTerminalPaneLeaves(workspace.layout)[0]?.paneId
      if (paneId) setActivePaneIds((current) => ({ ...current, [workspace.id]: paneId }))
      terminalBridge.group.list()
        .then(setGroups)
        .catch((error) => {
          logger.warn("Failed to refresh terminal groups after command launch.", error)
          toast.error("刷新终端分组失败")
        })
    } catch (error) {
      logger.error("Failed to launch terminal command.", error)
      toast.error("启动命令失败")
    }
  }, [terminalBridge])

  const runToolbarAction = useCallback(async (action: TerminalToolbarAction) => {
    if (!activeSession || !isTerminalToolbarActionEnabled(action, activeSession.status)) return
    if (action.kind === "xterm-local") {
      if (action.operation === "clear" && activeWorkspace) {
        workspaceViewRefs.current.get(activeWorkspace.id)?.clearActivePane()
      }
      return
    }
    const payload = resolveTerminalToolbarPayload(action, rendererPlatform)
    if (!payload) return
    const writes = action.kind === "shell-command" ? buildTerminalCommandWrites(payload) : [payload]
    try {
      for (const data of writes) {
        if (action.kind === "shell-command" && data === "\r") {
          await new Promise<void>((resolve) => setTimeout(resolve, TERMINAL_COMMAND_ENTER_DELAY_MS))
        }
        await terminalBridge.session.write({ sessionId: activeSession.id, data })
      }
    } catch (error) {
      logger.error("Failed to run terminal toolbar action.", error)
      toast.error("写入终端失败")
    }
  }, [activeSession, activeWorkspace, rendererPlatform, terminalBridge])

  const runCustomToolbarAction = useCallback(async (action: SynapseTerminalCustomToolbarAction) => {
    if (!activeSession || activeSession.status !== "running") return
    try {
      await terminalBridge.session.write({ sessionId: activeSession.id, data: action.content })
      if (action.pressEnter) {
        await new Promise<void>((resolve) => setTimeout(resolve, TERMINAL_COMMAND_ENTER_DELAY_MS))
        await terminalBridge.session.write({ sessionId: activeSession.id, data: "\r" })
      }
    } catch (error) {
      logger.error("Failed to run a custom terminal toolbar action.", error)
      toast.error("写入终端失败")
    }
  }, [activeSession, terminalBridge])

  /**
   * 确认语音输入后写进 PTY，**不补 "\r"**。
   *
   * 这里不能走 buildTerminalCommandWrites —— 那个 helper 会给每一行补 `\r`，是
   * 「执行」语义。终端命令错一个字符就可能是破坏性操作，执行与否必须留给用户按
   * Enter 决定。
   */
  const commitVoiceInput = useCallback(async () => {
    const text = await voice.confirm()
    if (!text.trim()) return
    if (!activeSession || activeSession.status !== "running") return
    try {
      await terminalBridge.session.write({ sessionId: activeSession.id, data: text })
      setPendingVoiceText(text)
    } catch (error) {
      logger.error("Failed to write voice input to the terminal.", error)
      toast.error("写入终端失败")
    }
  }, [activeSession, terminalBridge, voice.confirm])

  /**
   * 录音时命令条整条让位，焦点不在 xterm 上，Enter 只能靠这一层接住。按 Enter 和点
   * 对号是同一条路：文字进命令行但不补回车，执行与否仍由用户决定；焦点如果回到
   * xterm，那个回车归终端，这里不抢。
   */
  useVoiceActionKey({
    action: voicePresentation.action,
    onConfirm: () => { void commitVoiceInput() },
    onRetry: voice.retry,
  })

  // 会话一换，之前那条待执行提示就不再成立。
  useEffect(() => {
    setPendingVoiceText(null)
  }, [activeSession?.id])

  useEffect(() => {
    if (voice.state.phase === "recording") setPendingVoiceText(null)
  }, [voice.state.phase])

  const createCustomToolbarAction = useCallback(async (
    input: SynapseTerminalCreateCustomToolbarActionInput,
  ) => {
    const action = await runTrackedOperation(
      { component: "terminal", eventKey: "terminal.toolbar_action.create" },
      () => terminalBridge.toolbarAction.create(input),
    )
    toolbarActionRefreshRequestIdRef.current += 1
    setCustomToolbarActions((current) => mergeCustomToolbarAction(current, action))
  }, [terminalBridge])

  const updateCustomToolbarAction = useCallback(async (
    input: SynapseTerminalUpdateCustomToolbarActionInput,
  ) => {
    const action = await runTrackedOperation(
      { component: "terminal", eventKey: "terminal.toolbar_action.update" },
      () => terminalBridge.toolbarAction.update(input),
    )
    toolbarActionRefreshRequestIdRef.current += 1
    setCustomToolbarActions((current) => mergeCustomToolbarAction(current, action))
  }, [terminalBridge])

  const deleteCustomToolbarAction = useCallback(async (id: string) => {
    await runTrackedOperation(
      { component: "terminal", eventKey: "terminal.toolbar_action.delete" },
      () => terminalBridge.toolbarAction.delete({ id }),
    )
    toolbarActionRefreshRequestIdRef.current += 1
    setCustomToolbarActions((current) => current.filter((item) => item.id !== id))
  }, [terminalBridge])

  const handleSessionChanged = useCallback((session: SynapseTerminalSession) => {
    setSessions((current) => mergeSession(current, session))
  }, [])

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setSessions((current) => current.filter((session) => session.id !== sessionId))
    setWorkspaces((current) => current.filter((workspace) => (
      workspace.layout.type !== "leaf" || workspace.layout.sessionId !== sessionId
    )))
  }, [])

  const copySessionReference = useCallback(async (
    workspace: SynapseTerminalWorkspace,
    session: SynapseTerminalSession | null,
  ) => {
    try {
      if (!session?.sessionRef) throw new Error("Terminal session reference is unavailable")
      await navigator.clipboard.writeText(buildTerminalSessionReferenceText({
        workspaceId: workspace.id,
        sessionRef: session.sessionRef,
        sessionId: session.id,
      }))
      toast("引用已复制，仅本次运行有效")
    } catch (rawError) {
      logger.warn("Terminal session reference copy failed.", {
        boundary: "renderer.terminal.copy-reference",
        sessionId: session?.id ?? null,
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
      })
      toast.error("复制失败")
    }
  }, [])

  /**
   * Copies the reference of one named session.
   *
   * The pane header is the only place that knows *which* session it speaks for, so it hands over a
   * sessionId rather than letting the caller guess the workspace's active pane.
   */
  const copyPaneSessionReference = useCallback((
    workspace: SynapseTerminalWorkspace,
    sessionId: string,
  ) => {
    void copySessionReference(workspace, sessions.find((session) => session.id === sessionId) ?? null)
  }, [copySessionReference, sessions])

  const selectWorkspace = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId)
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current
      writeSidebarCollapsed(TERMINAL_SIDEBAR_PERSISTENCE_ID, next)
      return next
    })
  }, [])

  const renderGroupActions = (group: SynapseTerminalGroupSummary, index: number) => (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        title="新建终端"
        onClick={() => { void createSession({ groupId: group.id }) }}
      >
        <Plus className="size-3.5" />
        <span className="sr-only">新建终端</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`以命令启动：${group.name}`}
          >
            <Code2 className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {group.settings?.commands?.map((command) => (
            <DropdownMenuItem key={command.id} onClick={() => { void launchCommand(group, command) }}>
              <TerminalIcon />
              {command.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => { void openCommandManager(group) }}>
            <Settings />
            管理命令
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`终端分组操作：${group.name}`}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { void openGroupSettingsDialog(group) }}>
            <Settings />
            设置
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { void openCommandManager(group) }}>
            <Code2 />
            命令
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openRenameGroupDialog(group)}>
            <Pencil />
            重命名
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={groupReordering || index === 0}
            onClick={() => moveGroup(group.id, "up")}
          >
            <ArrowUp />
            上移
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={groupReordering || index === sortableGroups.length - 1}
            onClick={() => moveGroup(group.id, "down")}
          >
            <ArrowDown />
            下移
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={(event) => startDeleteGroup(group, event)}>
            <Trash2 />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )

  const renderGroupWorkspaces = (group: SynapseTerminalGroupSummary & { workspaces: SynapseTerminalWorkspace[] }) => (
    group.workspaces.map((workspace) => (
      <TerminalSidebarWorkspaceRow
        key={workspace.id}
        active={workspace.id === activeWorkspace?.id}
        canForce={rendererPlatform === "darwin"}
        closeDisabled={Boolean(workspace.closing) || closingWorkspaceId === workspace.id}
        closing={Boolean(workspace.closing)}
        lifecycleDisabled={closingWorkspaceId === workspace.id}
        pinned={workspace.pinned}
        status={workspaceStatus(workspace, sessions)}
        title={workspace.title}
        waiting={workspaceWaitingForInput(workspace, sessions)}
        workspaceId={workspace.id}
        onClose={() => { void closeWorkspace(workspace, workspace.closing && rendererPlatform === "darwin") }}
        onRename={(returnFocus) => openRenameDialog(workspace, returnFocus)}
        onSelect={() => selectWorkspace(workspace.id)}
        onTogglePin={() => { void toggleWorkspacePinned(workspace) }}
      />
    ))
  )

  const sidebar = (
    <ModuleSidebar
      variant="bare"
      className="min-h-0 bg-background"
    >
      <div className="flex items-center justify-start">
        <Button ref={createGroupActionRef} type="button" size="sm" variant="outline" onClick={openCreateGroupDialog}>
          <Plus data-icon="inline-start" />
          新建分组
        </Button>
      </div>
      <ModuleSidebarList>
        <div className="grid gap-1">
          {loading ? (
            <>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </>
          ) : workspaceGroups.length > 0 ? (
            <>
              <ModuleSidebarSortableList
                items={sortableGroupIds}
                disabled={groupReordering}
                onReorder={(orderedGroupIds) => { void persistGroupOrder(orderedGroupIds) }}
              >
                {sortableGroups.map((group, index) => (
                  <ModuleSidebarSortableGroup
                    key={group.id}
                    sortableId={group.id}
                    sortableDisabled={groupReordering}
                    open={openGroupIds[group.id] ?? true}
                    onOpenChange={(open) => setOpenGroupIds((current) => ({ ...current, [group.id]: open }))}
                    data-track="terminal-session-group"
                    title={group.name}
                    openIcon={FolderOpen}
                    closedIcon={Folder}
                    actions={renderGroupActions(group, index)}
                  >
                    {renderGroupWorkspaces(group)}
                  </ModuleSidebarSortableGroup>
                ))}
              </ModuleSidebarSortableList>
              {ungroupedGroup ? (
                <ModuleSidebarGroup
                  open={openGroupIds[ungroupedGroup.id] ?? true}
                  onOpenChange={(open) => setOpenGroupIds((current) => ({ ...current, [ungroupedGroup.id]: open }))}
                  data-track="terminal-session-group"
                  title={ungroupedGroup.name}
                  openIcon={FolderOpen}
                  closedIcon={Folder}
                >
                  {renderGroupWorkspaces(ungroupedGroup)}
                </ModuleSidebarGroup>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed px-3 text-sm text-muted-foreground">
              暂无会话
            </div>
          )}
        </div>
      </ModuleSidebarList>
    </ModuleSidebar>
  )

  const sidebarToggleLabel = sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"
  const sidebarToggle = (
    <SystemAppTopBarActionButton
      iconOnly
      type="button"
      aria-label={sidebarToggleLabel}
      aria-expanded={!sidebarCollapsed}
      tooltip={sidebarToggleLabel}
      className="aria-expanded:bg-transparent aria-expanded:hover:bg-muted"
      data-track="terminal-sidebar-toggle"
      onClick={toggleSidebar}
    >
      <PanelLeft />
    </SystemAppTopBarActionButton>
  )
  const headerNavigation = (
    <>
      {sidebarToggle}
      {activeHeaderWorkspaces.length > 0 ? (
        <nav aria-label="活动终端会话" className="no-scrollbar flex h-10 min-w-0 items-center gap-0 overflow-x-auto whitespace-nowrap">
          {activeHeaderWorkspaces.map((workspace) => {
            const session = workspaceActiveSession(workspace, activePaneIds, sessions)
            return (
              <TerminalHeaderSessionTab
                key={workspace.id}
                active={workspace.id === activeWorkspace?.id}
                closeDisabled={workspace.closing || closingWorkspaceId === workspace.id}
                pinned={workspace.pinned}
                title={workspace.title}
                onClose={() => { void closeWorkspace(workspace, workspace.closing && rendererPlatform === "darwin") }}
                onCopyReference={() => { void copySessionReference(workspace, session) }}
                onRename={(returnFocus) => openRenameDialog(workspace, returnFocus)}
                onSelect={() => selectWorkspace(workspace.id)}
                onTogglePin={() => { void toggleWorkspacePinned(workspace) }}
                waiting={workspaceWaitingForInput(workspace, sessions)}
              />
            )
          })}
        </nav>
      ) : null}
    </>
  )

  return (
    <SystemAppWindowShell
      left={headerNavigation}
      embeddedLeftAddon={headerNavigation}
      actions={(
        <>
          <SystemAppTopBarActionButton ref={createSessionActionRef} type="button" onClick={() => { void createSession() }}>
            <Plus data-icon="inline-start" />
            新建
          </SystemAppTopBarActionButton>
          <SystemAppTopBarActionButton type="button" onClick={() => { void openGlobalSettingsDialog() }}>
            <Settings data-icon="inline-start" />
            设置
          </SystemAppTopBarActionButton>
        </>
      )}
    >
      <SidebarContentLayout
        sidebar={sidebar}
        sidebarCollapsed={sidebarCollapsed}
        contentScrollable={false}
        sidebarResizable
        sidebarPersistenceId={TERMINAL_SIDEBAR_PERSISTENCE_ID}
      >
        <main className="flex h-full min-h-0 min-w-0 flex-col">
          {activeWorkspace && activePaneId ? (
            <div className="dark flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
              <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
                {workspaces.map((workspace) => {
                  if (workspace.id !== activeWorkspace.id && !mountedWorkspaceIds.has(workspace.id)) return null
                  const paneLeaves = collectTerminalPaneLeaves(workspace.layout)
                  const workspaceActivePaneId = activePaneIds[workspace.id]
                    && paneLeaves.some((pane) => pane.paneId === activePaneIds[workspace.id])
                    ? activePaneIds[workspace.id]!
                    : paneLeaves[0]?.paneId
                  if (!workspaceActivePaneId) return null
                  const visible = workspace.id === activeWorkspace.id
                  return (
                    <div
                      key={workspace.id}
                      className={cn("h-full min-h-0 min-w-0", !visible && "hidden")}
                    >
                      <TerminalWorkspaceView
                        ref={(handle) => {
                          if (handle) workspaceViewRefs.current.set(workspace.id, handle)
                          else workspaceViewRefs.current.delete(workspace.id)
                        }}
                        activePaneId={workspaceActivePaneId}
                        appearanceSize={terminalAppearanceSize}
                        onActivePaneChange={(paneId) => {
                          setActivePaneIds((current) => ({ ...current, [workspace.id]: paneId }))
                        }}
                        onClosePane={closePane}
                        onCopySessionReference={(sessionId) => copyPaneSessionReference(workspace, sessionId)}
                        onEqualizePane={equalizePane}
                        onMovePane={movePane}
                        onRenameSession={openSessionRenameDialog}
                        onSessionChanged={handleSessionChanged}
                        onSessionDeleted={handleSessionDeleted}
                        onSplitPane={splitPane}
                        onSplitRatioChange={updateSplitRatio}
                        pendingClosePaneIds={pendingClosePaneIds}
                        platform={rendererPlatform}
                        sessions={sessions}
                        visible={visible}
                        workspace={workspace}
                      />
                    </div>
                  )
                })}
              </div>
              {voicePresentation.active ? (
                /* 录音时命令条整条让位:转写和两个按钮共用这一行,高度就是命令条那一行。
                   没有快捷键是有意的 —— Ctrl+C 紧挨着麦克风,误触代价高。 */
                <div
                  data-terminal-toolbar
                  data-voice-toolbar
                  className="flex min-h-10 shrink-0 items-center gap-2 border-t bg-card px-2.5 py-1.5"
                >
                  <p
                    ref={voiceTranscriptRef}
                    data-voice-transcript
                    className="min-w-0 flex-1 overflow-hidden font-mono text-xs whitespace-nowrap text-foreground"
                  >
                    {voice.state.transcript.combined ? (
                      <>
                        {voice.state.transcript.stable}
                        {/* 未定稿的部分还会变，用次要色和定稿文字区分开。 */}
                        <span className="text-muted-foreground">{voice.state.transcript.unstable}</span>
                        {voicePresentation.caretVisible ? (
                          <span aria-hidden="true" className="ml-px inline-block h-3.5 w-0.5 bg-foreground align-middle" />
                        ) : null}
                      </>
                    ) : (
                      /* 刚开录、静音、失败都走这里:占位是这三件事在终端唯一说得出口的地方。 */
                      <span className="text-muted-foreground">{voicePresentation.placeholder}</span>
                    )}
                  </p>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="shrink-0 text-foreground/75 hover:text-foreground"
                    aria-label="取消语音输入"
                    onClick={voice.cancel}
                  >
                    放弃
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    className="shrink-0 rounded-full"
                    aria-label={isVoiceRetry ? "重试语音输入" : "完成语音输入"}
                    disabled={isVoiceActionDisabled}
                    onClick={() => {
                      if (isVoiceRetry) voice.retry()
                      else void commitVoiceInput()
                    }}
                  >
                    {isVoiceRetry ? <RotateCw /> : <Check />}
                  </Button>
                </div>
              ) : null}
              {pendingVoiceText && !voicePresentation.active ? (
                /* 语音已经填进命令行了，但还没执行 —— 提示挂在转写条自己身上，
                   不去动 pane 头，改动半径最小。 */
                <div
                  className="flex shrink-0 items-center gap-2 border-t border-border bg-card px-2.5 py-1.5"
                  data-terminal-pending-voice
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {pendingVoiceText}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">待执行 · Enter 执行</span>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="shrink-0 text-foreground/75 hover:text-foreground"
                    aria-label="忽略待执行提示"
                    onClick={() => setPendingVoiceText(null)}
                  >
                    <X />
                  </Button>
                </div>
              ) : null}
              {toolbarActions.length && !voicePresentation.active ? (
                // 包一层相对定位，好让锁的蒙层只盖命令条 —— 命令条本身是横向滚动容器，
                // 蒙层放进去会跟着内容一起滚。
                <div className="relative shrink-0">
                  <div
                    data-terminal-toolbar
                    className="no-scrollbar flex min-h-10 items-center gap-1 overflow-x-auto border-t bg-card px-2.5 py-1.5 whitespace-nowrap"
                  >
                    {toolbarActions.map((action) => (
                      <div key={action.id} className="flex shrink-0 items-center gap-1">
                        {action.id === "slash-exit" ? (
                          <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 rounded-md px-2 text-foreground/75 transition-[scale,background-color,color] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.96]"
                          aria-label={action.ariaLabel}
                          disabled={!isTerminalToolbarActionEnabled(action, terminalSessionStatus) || sessionLockedByMobile}
                          onClick={() => { void runToolbarAction(action) }}
                        >
                          {action.label}
                        </Button>
                      </div>
                    ))}
                    <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
                    <div data-terminal-custom-toolbar-actions className="flex shrink-0 items-center gap-1">
                      {customToolbarActions.map((action) => (
                        <Button
                          key={action.id}
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 rounded-md px-2 text-foreground/75 transition-[scale,background-color,color] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.96]"
                          aria-label={`${action.pressEnter ? "运行" : "输入"}快捷输入：${action.label}`}
                          disabled={terminalSessionStatus !== "running" || sessionLockedByMobile}
                          onClick={() => { void runCustomToolbarAction(action) }}
                        >
                          {action.label}
                        </Button>
                      ))}
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="text-foreground/75 hover:text-foreground"
                        aria-label="管理自定义快捷输入"
                        disabled={sessionLockedByMobile}
                        onClick={() => setToolbarManagerOpen(true)}
                      >
                        <Pencil />
                      </Button>
                    </div>
                    {voice.available ? (
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="text-foreground/75 hover:text-foreground"
                        aria-label="语音输入"
                        disabled={terminalSessionStatus !== "running" || voice.state.phase === "recording" || sessionLockedByMobile}
                        onClick={() => { void voice.start() }}
                      >
                        <Mic />
                      </Button>
                    ) : null}
                  </div>
                  {sessionLockedByMobile ? (
                    <div
                      aria-hidden="true"
                      data-terminal-toolbar-mobile-overlay
                      className="absolute inset-0 z-10 bg-black/10"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full min-h-0 items-center justify-center">
              <div className="grid justify-items-center gap-2">
                <div className="text-sm text-muted-foreground">{loadError ?? "暂无会话"}</div>
                <Button type="button" onClick={() => { void createSession() }}>
                  <TerminalIcon data-icon="inline-start" />
                  新建终端
                </Button>
              </div>
            </div>
          )}
        </main>
      </SidebarContentLayout>
      <TerminalToolbarManagerDialog
        actions={customToolbarActions}
        open={toolbarManagerOpen}
        onCreate={createCustomToolbarAction}
        onDelete={deleteCustomToolbarAction}
        onOpenChange={setToolbarManagerOpen}
        onUpdate={updateCustomToolbarAction}
      />
      <Dialog open={globalSettingsOpen} onOpenChange={(open) => {
        if (!open && !globalLaunchSaving) requestDiscard(globalLaunchDirty, () => setGlobalSettingsOpen(false))
      }}>
        <DialogContent
          aria-describedby={undefined}
          className="h-[min(42rem,calc(100vh-2rem))] overflow-hidden p-0 sm:max-w-3xl"
          showCloseButton={false}
        >
          <DialogFrame>
            <DialogFrameHeader bordered title="终端设置" />
            <DialogFrameBody className="overflow-hidden">
              <ScrollArea className="h-full" viewportClassName="px-5 py-4">
                <TerminalLaunchSettingsForm
                  value={globalLaunchDraft}
                  inheritedLabel="系统"
                  choosingDirectory={globalLaunchChoosingDirectory}
                  onChooseDirectory={() => { void chooseLaunchCwd(setGlobalLaunchChoosingDirectory, setGlobalLaunchDraft) }}
                  onRevealEnvironmentValue={(key) => terminalBridge.launch.revealEnvironmentValue({ scope: "global", key })}
                  onCopyEnvironmentValue={(key, draftValue) => terminalBridge.launch.copyEnvironmentValue({ scope: "global", key, draftValue })}
                  onChange={setGlobalLaunchDraft}
                  appearanceSize={terminalAppearanceSizeDraft}
                  onAppearanceSizeChange={setTerminalAppearanceSizeDraft}
                  agentNotificationsEnabled={agentNotificationsEnabledDraft}
                  onAgentNotificationsEnabledChange={setAgentNotificationsEnabledDraft}
                />
              </ScrollArea>
            </DialogFrameBody>
            <DialogFrameFooter>
              <Button type="button" variant="outline" disabled={globalLaunchSaving} onClick={() => requestDiscard(globalLaunchDirty, () => setGlobalSettingsOpen(false))}>取消</Button>
              <Button type="button" disabled={globalLaunchSaving} onClick={() => { void saveGlobalLaunchSettings() }}>保存</Button>
            </DialogFrameFooter>
          </DialogFrame>
        </DialogContent>
      </Dialog>
      <Dialog open={groupDialogMode !== null} onOpenChange={(open) => {
        if (!open) {
          setGroupDialogMode(null)
          setGroupRenameTarget(null)
          setGroupName("")
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{groupDialogMode === "rename" ? "重命名分组" : "新建分组"}</DialogTitle>
            <DialogDescription className="sr-only">
              输入分组名称。
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="分组名称"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void saveGroup()
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={groupSaving}
              onClick={() => {
                setGroupDialogMode(null)
                setGroupRenameTarget(null)
                setGroupName("")
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={groupSaving || !groupName.trim()}
              onClick={() => { void saveGroup() }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={groupSettingsTarget !== null} onOpenChange={(open) => {
        if (!open) requestDiscard(groupSettingsDirty, resetGroupSettingsDialog)
      }}>
        <DialogContent className="max-w-[min(56rem,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>分组设置</DialogTitle>
            <DialogDescription className="sr-only">
              设置分组名称和启动环境。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">分组名称</span>
              <Input
                aria-label="分组名称"
                value={groupSettingsName}
                onChange={(event) => setGroupSettingsName(event.target.value)}
                autoFocus
              />
            </label>
            <TerminalLaunchSettingsForm
              value={groupSettingsLaunch}
              inheritedValue={globalLaunchSettings?.settings}
              inheritedLabel="全局"
              choosingDirectory={groupSettingsChoosingDirectory}
              onChooseDirectory={() => { void chooseGroupSettingsDefaultCwd() }}
              onRevealEnvironmentValue={(key) => groupSettingsTarget
                ? terminalBridge.launch.revealEnvironmentValue({ scope: "group", groupId: groupSettingsTarget.id, key })
                : Promise.resolve(null)}
              onCopyEnvironmentValue={(key, draftValue) => groupSettingsTarget
                ? terminalBridge.launch.copyEnvironmentValue({ scope: "group", groupId: groupSettingsTarget.id, key, draftValue })
                : Promise.resolve()}
              onChange={setGroupSettingsLaunch}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={groupSettingsSaving}
              onClick={() => requestDiscard(groupSettingsDirty, resetGroupSettingsDialog)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={groupSettingsSaving || !groupSettingsName.trim()}
              onClick={() => { void saveGroupSettings() }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={commandManagerTarget !== null} onOpenChange={(open) => {
        if (!open) {
          setCommandManagerTarget(null)
          setCommandManagerCommands([])
          closeCommandForm()
        }
      }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>命令</DialogTitle>
            <DialogDescription className="sr-only">
              管理终端分组命令。
            </DialogDescription>
          </DialogHeader>
          {commandManagerCommands.length ? (
            <ScrollArea className="max-h-[min(24rem,calc(100vh-12rem))] rounded-md border">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>名称</TableHead>
                    <TableHead className="w-20 text-right" aria-label="操作" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commandManagerCommands.map((command) => (
                    <TableRow key={command.id}>
                      <TableCell className="min-w-0">
                        <div className="truncate font-medium">{command.name}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`编辑命令：${command.name}`}
                            onClick={() => { void openEditCommandDialog(command) }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`删除命令：${command.name}`}
                            disabled={commandDeletingId === command.id}
                            onClick={() => { void deleteCommand(command) }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <Empty className="min-h-40 border">
              <EmptyHeader>
                <EmptyTitle>暂无命令</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" size="sm" onClick={openCreateCommandDialog}>
                  新增命令
                </Button>
              </EmptyContent>
            </Empty>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={commandSaving}
              onClick={() => {
                setCommandManagerTarget(null)
                setCommandManagerCommands([])
                closeCommandForm()
              }}
            >
              关闭
            </Button>
            {commandManagerCommands.length ? (
              <Button
                type="button"
                disabled={commandSaving}
                onClick={openCreateCommandDialog}
              >
                新增命令
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={commandManagerTarget !== null && commandFormOpen} onOpenChange={(open) => {
        if (!open) requestDiscard(commandFormDirty, closeCommandForm)
      }}>
        <DialogContent className="max-w-[min(56rem,calc(100vw-2rem))]" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{commandEditTarget ? "编辑命令" : "新增命令"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field>
              <FieldLabel htmlFor="terminal-command-name">名称</FieldLabel>
              <Input
                id="terminal-command-name"
                aria-label="命令名称"
                value={commandName}
                onChange={(event) => setCommandName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="terminal-command-content">命令内容</FieldLabel>
              <Textarea
                id="terminal-command-content"
                aria-label="命令内容"
                value={commandText}
                onChange={(event) => setCommandText(event.target.value)}
                rows={5}
              />
            </Field>
            <TerminalLaunchSettingsForm
              value={commandLaunch}
              inheritedValue={mergeLaunchLayers(globalLaunchSettings?.settings, commandManagerTarget ? launchLayerFromGroup(commandManagerTarget) : undefined)}
              inheritedLabel="全局 / 分组"
              choosingDirectory={commandChoosingDirectory}
              onChooseDirectory={() => { void chooseLaunchCwd(setCommandChoosingDirectory, setCommandLaunch) }}
              onRevealEnvironmentValue={(key) => commandManagerTarget && commandEditTarget
                ? terminalBridge.launch.revealEnvironmentValue({ scope: "command", groupId: commandManagerTarget.id, commandId: commandEditTarget.id, key })
                : Promise.resolve(null)}
              onCopyEnvironmentValue={(key, draftValue) => commandManagerTarget
                ? terminalBridge.launch.copyEnvironmentValue({
                    scope: "command",
                    groupId: commandManagerTarget.id,
                    ...(commandEditTarget ? { commandId: commandEditTarget.id } : {}),
                    key,
                    draftValue,
                  })
                : Promise.resolve()}
              onChange={setCommandLaunch}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={commandSaving}
              onClick={() => requestDiscard(commandFormDirty, closeCommandForm)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={commandSaving || !commandName.trim() || !commandText.trim()}
              onClick={() => { void saveCommand() }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={renameTarget !== null} onOpenChange={(open) => {
        if (!open) closeRenameDialog()
      }}>
        <DialogContent onCloseAutoFocus={(event) => {
          // Radix releases its focus trap before this fires; restoring focus from a timer instead
          // raced that trap and lost focus to document.body when the dialog content unmounted.
          event.preventDefault()
          renameReturnFocusRef.current?.focus()
        }}>
          <DialogHeader>
            <DialogTitle>重命名终端</DialogTitle>
            <DialogDescription className="sr-only">
              输入新的终端名称。
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="终端名称"
            value={renameTitle}
            onChange={(event) => setRenameTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void renameWorkspace()
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={renameSaving}
              onClick={closeRenameDialog}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={renameSaving || !renameTitle.trim()}
              onClick={() => { void renameWorkspace() }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={sessionRenameTarget !== null} onOpenChange={(open) => {
        if (!open) closeSessionRenameDialog()
      }}>
        <DialogContent onCloseAutoFocus={(event) => {
          event.preventDefault()
          sessionRenameReturnFocusRef.current?.focus()
        }}>
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
            <DialogDescription className="sr-only">
              输入新的对话名称。
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="对话名称"
            value={sessionRenameTitle}
            onChange={(event) => setSessionRenameTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void renameSession()
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={sessionRenameSaving}
              onClick={closeSessionRenameDialog}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={sessionRenameSaving || !sessionRenameTitle.trim()}
              onClick={() => { void renameSession() }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteGroupTarget !== null} onOpenChange={(open) => {
        if (!open && !deleteGroupSaving) closeDeleteGroupDialog()
      }}>
        <AlertDialogContent onCloseAutoFocus={(event) => {
          event.preventDefault()
          deleteGroupReturnFocusRef.current?.focus()
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>删除分组</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteGroupHasActiveSessions
                ? "请先停止该分组内运行中的终端。"
                : deleteGroupMembers.length
                  ? `将删除 ${deleteGroupMembers.length} 个已结束会话及其保留输出。`
                  : "删除该空分组。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteGroupSaving}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteGroupSaving || deleteGroupHasActiveSessions}
              onClick={() => { void deleteGroup() }}
            >
              删除分组
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={discardAction !== null} onOpenChange={(open) => {
        if (!open) setDiscardAction(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
            <AlertDialogDescription>当前修改尚未保存。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              const action = discardAction
              setDiscardAction(null)
              action?.()
            }}>放弃更改</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SystemAppWindowShell>
  )
}

function TerminalHeaderSessionTab({
  active,
  closeDisabled,
  onClose,
  onCopyReference,
  onRename,
  onSelect,
  onTogglePin,
  pinned,
  title,
  waiting,
}: {
  readonly active: boolean
  readonly closeDisabled: boolean
  readonly onClose: () => void
  readonly onCopyReference: () => void
  readonly onRename: (returnFocus: HTMLElement) => void
  readonly onSelect: () => void
  readonly onTogglePin: () => void
  readonly pinned: boolean
  readonly title: string
  readonly waiting: boolean
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <SystemAppTopBarActionButton
          ref={buttonRef}
          type="button"
          aria-current={active ? "page" : undefined}
          aria-label={`切换到会话：${title}`}
          className={active ? "bg-muted text-foreground" : undefined}
          data-track="terminal-header-session-select"
          onClick={onSelect}
        >
          {waiting ? <TerminalAttentionIndicator /> : null}
          {pinned ? <TerminalPinnedIndicator /> : null}
          <span className="max-w-32 truncate">{title}</span>
        </SystemAppTopBarActionButton>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => {
          if (buttonRef.current) onRename(buttonRef.current)
        }}>
          <Pencil />
          重命名
        </ContextMenuItem>
        <ContextMenuItem onSelect={onTogglePin}>
          <Pin />
          {pinned ? "取消置顶" : "置顶"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCopyReference}>
          <Copy />
          复制引用
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" disabled={closeDisabled} onSelect={onClose}>
          <X />
          关闭
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function TerminalSidebarWorkspaceRow({
  active,
  canForce,
  closeDisabled,
  closing,
  lifecycleDisabled,
  onClose,
  onRename,
  onSelect,
  onTogglePin,
  pinned,
  status,
  title,
  waiting,
  workspaceId,
}: {
  readonly active: boolean
  readonly canForce: boolean
  readonly closeDisabled: boolean
  readonly closing: boolean
  readonly lifecycleDisabled: boolean
  readonly onClose: () => void
  readonly onRename: (returnFocus: HTMLElement) => void
  readonly onSelect: () => void
  readonly onTogglePin: () => void
  readonly pinned: boolean
  readonly status: SynapseTerminalSession["status"]
  readonly title: string
  readonly waiting: boolean
  readonly workspaceId: string
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="w-full min-w-0">
          <ModuleSidebarRow
            active={active}
            data-track="terminal-session-select"
            icon={(
              <>
                {pinned ? <TerminalPinnedIndicator /> : null}
                {waiting ? <TerminalAttentionIndicator /> : <TerminalSessionStatusIcon status={status} />}
              </>
            )}
            rowRef={rowRef}
            trailing={(
              <>
                <TerminalWorkspaceLifecycleButton
                  canForce={canForce}
                  closing={closing}
                  disabled={lifecycleDisabled}
                  title={title}
                  onClose={onClose}
                />
              </>
            )}
            trackValue={workspaceId}
            onSelect={onSelect}
            onDoubleClick={(event) => onRename(event.currentTarget)}
          >
            {title}
          </ModuleSidebarRow>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => {
          const row = rowRef.current
          if (row) onRename(row)
        }}>
          <Pencil />
          重命名
        </ContextMenuItem>
        <ContextMenuItem onSelect={onTogglePin}>
          <Pin />
          {pinned ? "取消置顶" : "置顶"}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" disabled={closeDisabled} onSelect={onClose}>
          <X />
          关闭
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function TerminalWorkspaceLifecycleButton({
  canForce,
  closing,
  disabled,
  onClose,
  title,
}: {
  readonly canForce: boolean
  readonly closing: boolean
  readonly disabled: boolean
  readonly onClose: () => void
  readonly title: string
}) {
  const actionLabel = closing ? (canForce ? "强制关闭" : "正在关闭") : "关闭"
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      disabled={disabled || (closing && !canForce)}
      aria-label={`${actionLabel}终端：${title}`}
      title={actionLabel}
      className="text-muted-foreground hover:text-destructive"
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {closing ? <Square className="size-3.5" /> : <Trash2 className="size-3.5" />}
    </Button>
  )
}

function TerminalSessionStatusIcon({ status }: { readonly status: SynapseTerminalSession["status"] }) {
  const running = status === "running"
  const stopping = status === "stopping"
  const Icon = running ? CircleDot : stopping ? Square : Link2Off
  const label = status === "running"
    ? "运行中"
    : status === "stopping"
      ? "正在停止"
      : status === "ended"
        ? "已结束"
        : status === "failed"
          ? "启动失败"
          : "已失联"

  return (
    <span
      title={label}
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center",
        running ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

function TerminalAttentionIndicator() {
  return (
    <span
      title="等待输入"
      className="inline-flex size-3.5 shrink-0 items-center justify-center text-amber-600 dark:text-amber-400"
    >
      <CircleHelp className="size-3.5" aria-hidden="true" />
      <span className="sr-only">等待输入</span>
    </span>
  )
}

function TerminalPinnedIndicator() {
  return (
    <span
      data-terminal-pinned
      title="已置顶"
      className="inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground"
    >
      <Pin className="size-3.5" aria-hidden="true" />
      <span className="sr-only">已置顶</span>
    </span>
  )
}

function groupWorkspaces(
  groups: readonly SynapseTerminalGroupSummary[],
  workspaces: readonly SynapseTerminalWorkspace[],
): Array<SynapseTerminalGroupSummary & { workspaces: SynapseTerminalWorkspace[] }> {
  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder)
  const grouped = sortedGroups.map((group) => ({
    ...group,
    workspaces: pinFirst(workspaces.filter((workspace) => workspace.groupId === group.id)),
  }))
  const groupedWorkspaceIds = new Set(grouped.flatMap((group) => group.workspaces.map((workspace) => workspace.id)))
  const ungrouped = pinFirst(workspaces.filter((workspace) => !groupedWorkspaceIds.has(workspace.id)))

  if (ungrouped.length === 0) return grouped
  return [
    ...grouped,
    {
      id: UNGROUPED_TERMINAL_GROUP_ID,
      name: "会话",
      createdAt: "",
      updatedAt: "",
      sortOrder: Number.MAX_SAFE_INTEGER,
      groupRevision: 1,
      launchRevision: 1,
      membershipRevision: 1,
      commandCollectionRevision: 1,
      workspaces: ungrouped,
    },
  ]
}

/**
 * 置顶的排前面，其余保持服务端给的顺序（创建时间倒序）。
 *
 * 服务端已经这样排过一次；这里再排是因为置顶切换后只回一个 workspace，列表本身没有重新拉取。
 */
function pinFirst(workspaces: readonly SynapseTerminalWorkspace[]): SynapseTerminalWorkspace[] {
  return [...workspaces].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
}

function workspaceStatus(
  workspace: SynapseTerminalWorkspace,
  sessions: readonly SynapseTerminalSession[],
): SynapseTerminalSession["status"] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  const statuses = collectTerminalPaneLeaves(workspace.layout)
    .map((pane) => sessionById.get(pane.sessionId)?.status)
    .filter((status): status is SynapseTerminalSession["status"] => Boolean(status))
  if (statuses.includes("running")) return "running"
  if (statuses.includes("stopping")) return "stopping"
  if (statuses.includes("failed")) return "failed"
  if (statuses.includes("lost")) return "lost"
  return "ended"
}

function workspaceActiveSession(
  workspace: SynapseTerminalWorkspace,
  activePaneIds: Readonly<Record<string, string>>,
  sessions: readonly SynapseTerminalSession[],
): SynapseTerminalSession | null {
  const leaves = collectTerminalPaneLeaves(workspace.layout)
  const activePaneId = activePaneIds[workspace.id]
  const pane = (activePaneId ? leaves.find((leaf) => leaf.paneId === activePaneId) : undefined) ?? leaves[0]
  if (!pane) return null
  return sessions.find((session) => session.id === pane.sessionId) ?? null
}

function workspaceWaitingForInput(
  workspace: SynapseTerminalWorkspace,
  sessions: readonly SynapseTerminalSession[],
): boolean {
  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  return collectTerminalPaneLeaves(workspace.layout).some(
    (pane) => sessionById.get(pane.sessionId)?.attention.state === "waiting",
  )
}

function mergeSession(
  sessions: readonly SynapseTerminalSession[],
  session: SynapseTerminalSession,
): SynapseTerminalSession[] {
  return sessions.some((item) => item.id === session.id)
    ? sessions.map((item) => item.id === session.id ? session : item)
    : [...sessions, session]
}

function mergeCustomToolbarAction(
  actions: SynapseTerminalCustomToolbarAction[],
  action: SynapseTerminalCustomToolbarAction,
): SynapseTerminalCustomToolbarAction[] {
  return actions.some((item) => item.id === action.id)
    ? actions.map((item) => item.id === action.id ? action : item)
    : [...actions, action]
}

function mergeWorkspace(
  workspaces: readonly SynapseTerminalWorkspace[],
  workspace: SynapseTerminalWorkspace,
): SynapseTerminalWorkspace[] {
  return workspaces.some((item) => item.id === workspace.id)
    ? workspaces.map((item) => item.id === workspace.id
      ? item.layoutRevision > workspace.layoutRevision ? item : workspace
      : item)
    : [...workspaces, workspace]
}

function mergeGroup(
  groups: readonly SynapseTerminalGroupSummary[],
  group: SynapseTerminalGroupSummary | SynapseTerminalGroup,
): SynapseTerminalGroupSummary[] {
  const summary = summarizeGroup(group)
  const nextGroups = groups.some((item) => item.id === group.id)
    ? groups.map((item) => item.id === group.id ? summary : item)
    : [...groups, summary]
  return nextGroups.sort((left, right) => left.sortOrder - right.sortOrder)
}

function summarizeGroup(group: SynapseTerminalGroupSummary | SynapseTerminalGroup): SynapseTerminalGroupSummary {
  const commands = group.settings?.commands?.map(({ id, name, createdAt, updatedAt, commandRevision }) => ({
    id,
    name,
    createdAt,
    updatedAt,
    commandRevision,
  }))
  return {
    id: group.id,
    name: group.name,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    sortOrder: group.sortOrder,
    groupRevision: group.groupRevision,
    launchRevision: group.launchRevision,
    membershipRevision: group.membershipRevision,
    commandCollectionRevision: group.commandCollectionRevision,
    ...(commands?.length ? { settings: { commands } } : {}),
  }
}

function launchLayerFromGroup(group: SynapseTerminalGroup): SynapseTerminalLaunchLayer {
  return {
    ...(group.settings?.defaultCwd ? { defaultCwd: group.settings.defaultCwd } : {}),
    ...(group.settings?.shell ? { shell: group.settings.shell } : {}),
    ...(group.settings?.environment ? { environment: group.settings.environment } : {}),
  }
}

function mergeLaunchLayers(
  lower: SynapseTerminalLaunchLayer | undefined,
  higher: SynapseTerminalLaunchLayer | undefined,
): SynapseTerminalLaunchLayer | undefined {
  if (!lower && !higher) return undefined
  return {
    ...(lower?.defaultCwd ? { defaultCwd: lower.defaultCwd } : {}),
    ...(lower?.shell ? { shell: lower.shell } : {}),
    ...(lower?.environment ? { environment: lower.environment } : {}),
    ...(higher?.defaultCwd ? { defaultCwd: higher.defaultCwd } : {}),
    ...(higher?.shell ? { shell: higher.shell } : {}),
    ...((lower?.environment || higher?.environment) ? {
      environment: { ...lower?.environment, ...higher?.environment },
    } : {}),
  }
}
