import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { CircleDot, Code2, Folder, FolderOpen, Link2Off, MoreHorizontal, Pencil, Plus, Settings, Square, Terminal as TerminalIcon, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
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
import { SidebarContentLayout } from "../../../src/components/sidebar-content-layout"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { runTrackedOperation } from "../../../src/lib/ui-tracking"
import { getRendererPlatform } from "../../../src/lib/runtime-platform"
import { cn } from "../../../src/lib/utils"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "../../../src/modules/apps/components/system-app-top-bar"
import type { SynapseSystemAppTerminalOpenRequest } from "../../../src/modules/apps/types"
import type {
  SynapseTerminalGlobalLaunchSettings,
  SynapseTerminalGroup,
  SynapseTerminalGroupCommand,
  SynapseTerminalGroupCommandSummary,
  SynapseTerminalGroupSummary,
  SynapseTerminalCreateSessionInput,
  SynapseTerminalLaunchLayer,
  SynapseTerminalSession,
  SynapseTerminalWorkspace,
} from "../../../src/types/terminal"
import { collectTerminalPaneLeaves, removeTerminalPane } from "../shared/schema"
import { encodeTerminalCommandInput } from "../shared/terminal-input"
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

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
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
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [activePaneIds, setActivePaneIds] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
  const [globalLaunchSettings, setGlobalLaunchSettings] = useState<SynapseTerminalGlobalLaunchSettings | null>(null)
  const [globalLaunchDraft, setGlobalLaunchDraft] = useState<SynapseTerminalLaunchLayer>({})
  const [terminalAppearanceSize, setTerminalAppearanceSize] = useState(readTerminalAppearanceSize)
  const [terminalAppearanceSizeDraft, setTerminalAppearanceSizeDraft] = useState(terminalAppearanceSize)
  const [globalLaunchSaving, setGlobalLaunchSaving] = useState(false)
  const [globalLaunchChoosingDirectory, setGlobalLaunchChoosingDirectory] = useState(false)
  const [renameTarget, setRenameTarget] = useState<SynapseTerminalWorkspace | null>(null)
  const [renameTitle, setRenameTitle] = useState("")
  const [renameSaving, setRenameSaving] = useState(false)
  const [closingWorkspaceId, setClosingWorkspaceId] = useState<string | null>(null)
  const [groupDialogMode, setGroupDialogMode] = useState<"create" | "rename" | null>(null)
  const [groupRenameTarget, setGroupRenameTarget] = useState<SynapseTerminalGroupSummary | null>(null)
  const [groupName, setGroupName] = useState("")
  const [groupSaving, setGroupSaving] = useState(false)
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
  const workspaceViewRef = useRef<TerminalWorkspaceViewHandle | null>(null)
  const renameReturnFocusRef = useRef<HTMLElement | null>(null)
  const deleteGroupReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const createSessionActionRef = useRef<HTMLButtonElement | null>(null)
  const createGroupActionRef = useRef<HTMLButtonElement | null>(null)

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

  const workspaceGroups = useMemo(() => groupWorkspaces(groups, workspaces), [groups, workspaces])
  const rendererPlatform = getRendererPlatform()
  const toolbarActions = useMemo(
    () => getTerminalToolbarActions(rendererPlatform),
    [rendererPlatform],
  )
  const globalLaunchDirty = globalSettingsOpen
    && (
      JSON.stringify(globalLaunchDraft) !== JSON.stringify(globalLaunchSettings?.settings ?? {})
      || terminalAppearanceSizeDraft !== terminalAppearanceSize
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
    const [nextGroups, nextWorkspaces, nextSessions] = await Promise.all([
      terminalBridge.group.list(),
      terminalBridge.workspace.list(),
      terminalBridge.session.list(),
    ])
    setGroups(nextGroups)
    setWorkspaces(nextWorkspaces)
    setSessions(nextSessions)
    setActiveWorkspaceId((current) => {
      if (current && nextWorkspaces.some((workspace) => workspace.id === current)) return current
      return nextWorkspaces[0]?.id ?? null
    })
  }, [terminalBridge])

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)
    refreshSessions()
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
  }, [refreshSessions])

  useEffect(() => terminalBridge.operation.onDomainChanged(() => {
    void refreshSessions().catch((error) => {
      logger.warn("Failed to refresh terminal objects after a domain change.", error)
    })
  }), [refreshSessions, terminalBridge])

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
    globalThis.setTimeout(() => {
      renameReturnFocusRef.current?.focus()
      renameReturnFocusRef.current = null
    }, 0)
  }, [])

  const closeDeleteGroupDialog = useCallback(() => {
    setDeleteGroupTarget(null)
    globalThis.setTimeout(() => {
      deleteGroupReturnFocusRef.current?.focus()
      deleteGroupReturnFocusRef.current = null
    }, 0)
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
      const settings = await terminalBridge.globalLaunch.get()
      setGlobalLaunchSettings(settings)
      setGlobalLaunchDraft(settings.settings ?? {})
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
    if (!globalLaunchSettings) return
    setGlobalLaunchSaving(true)
    try {
      const updated = await runTrackedOperation(
        { component: "terminal", eventKey: "terminal.settings.update" },
        () => terminalBridge.globalLaunch.update({
          expectedRevision: globalLaunchSettings.revision,
          settings: Object.keys(globalLaunchDraft).length ? globalLaunchDraft : undefined,
        }),
      )
      writeTerminalAppearanceSize(terminalAppearanceSizeDraft)
      setTerminalAppearanceSize(terminalAppearanceSizeDraft)
      setGlobalLaunchSettings(updated)
      setGlobalSettingsOpen(false)
      toast.success("终端设置已保存")
    } catch (error) {
      logger.error("Failed to save global terminal launch settings.", error)
      toast.error(error instanceof Error && error.message.includes("revision_conflict")
        ? "设置已被其他操作更新，请重新打开后再保存"
        : "保存终端设置失败")
    } finally {
      setGlobalLaunchSaving(false)
    }
  }, [globalLaunchDraft, globalLaunchSettings, terminalAppearanceSizeDraft, terminalBridge])

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
      const workspace = await runTrackedOperation(
        { component: "terminal", eventKey: "terminal.workspace.rename" },
        () => terminalBridge.workspace.rename({
          workspaceId: renameTarget.id,
          title,
          expectedLayoutRevision: renameTarget.layoutRevision,
        }),
      )
      setWorkspaces((current) => mergeWorkspace(current, workspace))
      closeRenameDialog()
    } catch (error) {
      logger.error("Failed to rename terminal workspace.", error)
      toast.error("重命名终端失败")
    } finally {
      setRenameSaving(false)
    }
  }, [closeRenameDialog, renameTarget, renameTitle, terminalBridge])

  const closeWorkspace = useCallback(async (target: SynapseTerminalWorkspace, force = false) => {
    setClosingWorkspaceId(target.id)
    try {
      const result = await runTrackedOperation(
        { component: "terminal", eventKey: force ? "terminal.workspace.force_close" : "terminal.workspace.close" },
        () => terminalBridge.workspace.close({
          workspaceId: target.id,
          expectedLayoutRevision: target.layoutRevision,
          ...(force ? { force: true } : {}),
        }),
      )
      if (result.state === "deleted") {
        setWorkspaces((current) => current.filter((workspace) => workspace.id !== target.id))
        setActiveWorkspaceId((current) => current === target.id ? null : current)
        globalThis.setTimeout(() => {
          const nextActiveRow = document.querySelector<HTMLElement>(
            '[data-track="terminal-session-select"][aria-current="page"]',
          )
          ;(nextActiveRow ?? createSessionActionRef.current)?.focus()
        }, 0)
      }
    } catch (error) {
      logger.error("Failed to close terminal workspace.", error)
      toast.error("关闭终端失败")
    } finally {
      setClosingWorkspaceId((current) => current === target.id ? null : current)
    }
  }, [terminalBridge])

  const splitPane = useCallback(async (paneId: string, direction: "right" | "down") => {
    if (!activeWorkspace) return
    try {
      const result = await runTrackedOperation(
        { component: "terminal", eventKey: `terminal.pane.split_${direction}` },
        () => terminalBridge.pane.split({
          workspaceId: activeWorkspace.id,
          paneId,
          direction,
          expectedLayoutRevision: activeWorkspace.layoutRevision,
          cols: DEFAULT_COLS,
          rows: DEFAULT_ROWS,
        }),
      )
      const session = await terminalBridge.session.get({ sessionId: result.sessionId })
      setWorkspaces((current) => mergeWorkspace(current, result.workspace))
      setSessions((current) => mergeSession(current, session))
      setActivePaneIds((current) => ({ ...current, [result.workspace.id]: result.paneId }))
    } catch (error) {
      logger.error("Failed to split terminal pane.", error)
      toast.error(error instanceof Error && error.message.includes("quota_exceeded")
        ? "一个终端最多支持 8 个分屏"
        : "创建分屏失败")
    }
  }, [activeWorkspace, terminalBridge])

  const closePane = useCallback(async (paneId: string) => {
    if (!activeWorkspace) return
    const force = rendererPlatform === "darwin" && activeWorkspace.closingPaneIds.includes(paneId)
    try {
      await runTrackedOperation(
        { component: "terminal", eventKey: force ? "terminal.pane.force_close" : "terminal.pane.close" },
        () => terminalBridge.pane.close({
          workspaceId: activeWorkspace.id,
          paneId,
          expectedLayoutRevision: activeWorkspace.layoutRevision,
          ...(force ? { force: true } : {}),
        }),
      )
    } catch (error) {
      logger.error("Failed to close terminal pane.", error)
      toast.error("关闭分屏失败")
    }
  }, [activeWorkspace, rendererPlatform, terminalBridge])

  const updateSplitRatio = useCallback(async (splitId: string, ratio: number) => {
    if (!activeWorkspace) return
    try {
      const workspace = await terminalBridge.pane.updateRatio({
        workspaceId: activeWorkspace.id,
        splitId,
        ratio,
        expectedLayoutRevision: activeWorkspace.layoutRevision,
      })
      setWorkspaces((current) => mergeWorkspace(current, workspace))
    } catch (error) {
      logger.warn("Failed to persist terminal split ratio.", error)
      void refreshSessions()
    }
  }, [activeWorkspace, refreshSessions, terminalBridge])

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
      setDeleteGroupTarget(null)
      deleteGroupReturnFocusRef.current = null
      globalThis.setTimeout(() => createGroupActionRef.current?.focus(), 0)
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
      if (action.operation === "clear") workspaceViewRef.current?.clearActivePane()
      return
    }
    const payload = resolveTerminalToolbarPayload(action, rendererPlatform)
    if (!payload) return
    const data = action.kind === "shell-command" ? encodeTerminalCommandInput(payload) : payload
    try {
      await terminalBridge.session.write({ sessionId: activeSession.id, data })
    } catch (error) {
      logger.error("Failed to run terminal toolbar action.", error)
      toast.error("写入终端失败")
    }
  }, [activeSession, rendererPlatform, terminalBridge])

  const handleSessionChanged = useCallback((session: SynapseTerminalSession) => {
    setSessions((current) => mergeSession(current, session))
  }, [])

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setSessions((current) => current.filter((session) => session.id !== sessionId))
    setWorkspaces((current) => current.flatMap((workspace) => {
      const pane = collectTerminalPaneLeaves(workspace.layout).find((item) => item.sessionId === sessionId)
      if (!pane) return [workspace]
      const layout = removeTerminalPane(workspace.layout, pane.paneId)
      return layout ? [{ ...workspace, layout }] : []
    }))
  }, [])

  const selectActivePane = useCallback((paneId: string) => {
    if (!activeWorkspace) return
    setActivePaneIds((current) => ({ ...current, [activeWorkspace.id]: paneId }))
  }, [activeWorkspace])

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
          ) : workspaceGroups.length > 0 ? workspaceGroups.map((group) => (
            <ModuleSidebarGroup
              key={group.id}
              open={openGroupIds[group.id] ?? true}
              onOpenChange={(open) => setOpenGroupIds((current) => ({ ...current, [group.id]: open }))}
              data-track="terminal-session-group"
              title={group.name}
              openIcon={FolderOpen}
              closedIcon={Folder}
              actions={group.id !== "ungrouped" ? (
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
                      <DropdownMenuItem variant="destructive" onClick={(event) => startDeleteGroup(group, event)}>
                        <Trash2 />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : null}
            >
              {group.workspaces.map((workspace) => (
                <ModuleSidebarRow
                  key={workspace.id}
                  active={workspace.id === activeWorkspace?.id}
                  data-track="terminal-session-select"
                  icon={<TerminalSessionStatusIcon status={workspaceStatus(workspace, sessions)} />}
                  trailing={
                    <TerminalWorkspaceLifecycleButton
                      canForce={rendererPlatform === "darwin"}
                      closing={workspace.closing}
                      disabled={closingWorkspaceId === workspace.id}
                      title={workspace.title}
                      onClose={() => { void closeWorkspace(workspace, workspace.closing && rendererPlatform === "darwin") }}
                    />
                  }
                  trackValue={workspace.id}
                  onSelect={() => setActiveWorkspaceId(workspace.id)}
                  onDoubleClick={(event) => openRenameDialog(workspace, event.currentTarget)}
                >
                  {workspace.title}
                </ModuleSidebarRow>
              ))}
            </ModuleSidebarGroup>
          )) : (
            <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed px-3 text-sm text-muted-foreground">
              暂无会话
            </div>
          )}
        </div>
      </ModuleSidebarList>
    </ModuleSidebar>
  )

  return (
    <SystemAppWindowShell actions={(
      <>
        <SystemAppTopBarActionButton ref={createSessionActionRef} type="button" onClick={() => { void createSession() }}>
          <Plus data-icon="inline-start" />
          新建终端
        </SystemAppTopBarActionButton>
        <SystemAppTopBarActionButton type="button" onClick={() => { void openGlobalSettingsDialog() }}>
          <Settings data-icon="inline-start" />
          终端设置
        </SystemAppTopBarActionButton>
      </>
    )}>
      <SidebarContentLayout
        sidebar={sidebar}
        contentScrollable={false}
        sidebarResizable
        sidebarPersistenceId="terminal"
      >
        <main className="flex h-full min-h-0 min-w-0 flex-col">
          {activeWorkspace && activePaneId ? (
            <div className="dark flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
              {toolbarActions.length ? (
                <div
                  data-terminal-toolbar
                  className="flex min-h-10 shrink-0 items-center gap-1 overflow-x-auto border-b bg-card px-2.5 py-1.5 whitespace-nowrap"
                >
                  {toolbarActions.map((action) => (
                    <div key={action.id} className="flex shrink-0 items-center gap-1">
                      {action.id === "claude" ? (
                        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-md px-2 text-foreground/75 transition-[scale,background-color,color] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.96]"
                        aria-label={action.ariaLabel}
                        disabled={!isTerminalToolbarActionEnabled(action, terminalSessionStatus)}
                        onClick={() => { void runToolbarAction(action) }}
                      >
                        {action.label}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
                <TerminalWorkspaceView
                  ref={workspaceViewRef}
                  activePaneId={activePaneId}
                  appearanceSize={terminalAppearanceSize}
                  onActivePaneChange={selectActivePane}
                  onClosePane={closePane}
                  onSessionChanged={handleSessionChanged}
                  onSessionDeleted={handleSessionDeleted}
                  onSplitPane={splitPane}
                  onSplitRatioChange={updateSplitRatio}
                  platform={rendererPlatform}
                  sessions={sessions}
                  workspace={activeWorkspace}
                />
              </div>
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
            <DialogFrameBody className="overflow-auto px-5 py-4">
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
              />
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
            <div className="max-h-[min(24rem,calc(100vh-12rem))] overflow-auto rounded-md border">
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
            </div>
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
        <DialogContent>
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
      <AlertDialog open={deleteGroupTarget !== null} onOpenChange={(open) => {
        if (!open && !deleteGroupSaving) closeDeleteGroupDialog()
      }}>
        <AlertDialogContent>
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

function groupWorkspaces(
  groups: readonly SynapseTerminalGroupSummary[],
  workspaces: readonly SynapseTerminalWorkspace[],
): Array<SynapseTerminalGroupSummary & { workspaces: SynapseTerminalWorkspace[] }> {
  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder)
  const grouped = sortedGroups.map((group) => ({
    ...group,
    workspaces: workspaces.filter((workspace) => workspace.groupId === group.id),
  }))
  const groupedWorkspaceIds = new Set(grouped.flatMap((group) => group.workspaces.map((workspace) => workspace.id)))
  const ungrouped = workspaces.filter((workspace) => !groupedWorkspaceIds.has(workspace.id))

  if (ungrouped.length === 0) return grouped
  return [
    ...grouped,
    {
      id: "ungrouped",
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

function mergeSession(
  sessions: readonly SynapseTerminalSession[],
  session: SynapseTerminalSession,
): SynapseTerminalSession[] {
  return sessions.some((item) => item.id === session.id)
    ? sessions.map((item) => item.id === session.id ? session : item)
    : [...sessions, session]
}

function mergeWorkspace(
  workspaces: readonly SynapseTerminalWorkspace[],
  workspace: SynapseTerminalWorkspace,
): SynapseTerminalWorkspace[] {
  return workspaces.some((item) => item.id === workspace.id)
    ? workspaces.map((item) => item.id === workspace.id ? workspace : item)
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
