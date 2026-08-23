import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react"
import { CircleDot, Code2, Folder, FolderOpen, Link2Off, MoreHorizontal, Pencil, Plus, Settings, Square, Terminal as TerminalIcon, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import "@xterm/xterm/css/xterm.css"
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
  SynapseTerminalOutputChunk,
  SynapseTerminalResizedEvent,
  SynapseTerminalSession,
} from "../../../src/types/terminal"
import { encodeTerminalCommandInput } from "../shared/terminal-input"
import { isTerminalShiftEnterEvent } from "./terminal-keyboard"
import { createTerminalRenderingOptions } from "./terminal-rendering"
import { TerminalLaunchSettingsForm } from "./terminal-launch-settings-form"
import {
  getTerminalToolbarActions,
  isTerminalToolbarActionEnabled,
  resolveTerminalToolbarPayload,
  type TerminalToolbarAction,
} from "./terminal-toolbar-actions"

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const TERMINAL_WRITE_CHUNK_SIZE = 60 * 1024

const logger = createRendererLogger("terminal.app")

export function TerminalModule({
  openRequest = null,
  onOpenRequestConsumed,
}: {
  readonly openRequest?: SynapseSystemAppTerminalOpenRequest | null
  readonly onOpenRequestConsumed?: (requestId: string) => void
} = {}) {
  const terminalBridge = requireBridgeDomain("terminal")
  const shellBridge = requireBridgeDomain("shell")
  const [groups, setGroups] = useState<SynapseTerminalGroupSummary[]>([])
  const [sessions, setSessions] = useState<SynapseTerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
  const [globalLaunchSettings, setGlobalLaunchSettings] = useState<SynapseTerminalGlobalLaunchSettings | null>(null)
  const [globalLaunchDraft, setGlobalLaunchDraft] = useState<SynapseTerminalLaunchLayer>({})
  const [globalLaunchSaving, setGlobalLaunchSaving] = useState(false)
  const [globalLaunchChoosingDirectory, setGlobalLaunchChoosingDirectory] = useState(false)
  const [renameTarget, setRenameTarget] = useState<SynapseTerminalSession | null>(null)
  const [renameTitle, setRenameTitle] = useState("")
  const [renameSaving, setRenameSaving] = useState(false)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null)
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
  const [terminalReadError, setTerminalReadError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openGroupIds, setOpenGroupIds] = useState<Record<string, boolean>>({})
  const terminalContainerRef = useRef<HTMLDivElement | null>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const terminalGeometrySyncRef = useRef<((refreshRenderer?: boolean) => void) | null>(null)
  const deletedSessionIdsRef = useRef(new Set<string>())

  const activeSession = useMemo(() => {
    if (!activeSessionId) return sessions[0] ?? null
    return sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null
  }, [activeSessionId, sessions])
  const terminalSessionId = activeSession?.id ?? null
  const terminalSessionStatus = activeSession?.status ?? null
  const activeSessionRef = useRef(activeSession)
  activeSessionRef.current = activeSession

  const sessionGroups = useMemo(() => groupSessions(groups, sessions), [groups, sessions])
  const activeSessionRunning = activeSession?.status === "running"
  const rendererPlatform = getRendererPlatform()
  const toolbarActions = useMemo(
    () => getTerminalToolbarActions(rendererPlatform),
    [rendererPlatform],
  )
  const globalLaunchDirty = globalSettingsOpen
    && JSON.stringify(globalLaunchDraft) !== JSON.stringify(globalLaunchSettings?.settings ?? {})
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
    const [nextGroups, nextSessions] = await Promise.all([
      terminalBridge.group.list(),
      terminalBridge.session.list(),
    ])
    setGroups(nextGroups)
    setSessions(nextSessions)
    setActiveSessionId((current) => {
      if (current && nextSessions.some((session) => session.id === current)) return current
      return nextSessions[0]?.id ?? null
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

  useEffect(() => {
    if (!openRequest) return
    let cancelled = false
    Promise.all([
      terminalBridge.group.list(),
      terminalBridge.session.get({ sessionId: openRequest.sessionId }),
    ])
      .then(([nextGroups, session]) => {
        if (cancelled) return
        setGroups(nextGroups)
        setSessions((current) => mergeSession(current, session))
        setActiveSessionId(session.id)
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
      const session = await terminalBridge.session.create({
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        ...input,
      })
      setSessions((current) => mergeSession(current, session))
      setActiveSessionId(session.id)
      setTerminalReadError(null)
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

  const openRenameDialog = useCallback((session: SynapseTerminalSession) => {
    setRenameTarget(session)
    setRenameTitle(session.title)
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
      setGlobalSettingsOpen(true)
    } catch (error) {
      logger.error("Failed to load global terminal launch settings.", error)
      toast.error("加载终端设置失败")
    }
  }, [terminalBridge])

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
      const updated = await terminalBridge.globalLaunch.update({
        expectedRevision: globalLaunchSettings.revision,
        settings: Object.keys(globalLaunchDraft).length ? globalLaunchDraft : undefined,
      })
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
  }, [globalLaunchDraft, globalLaunchSettings, terminalBridge])

  const saveGroup = useCallback(async () => {
    const name = groupName.trim()
    if (!name) return
    setGroupSaving(true)
    try {
      if (groupDialogMode === "rename" && groupRenameTarget) {
        const group = await terminalBridge.group.rename({
          groupId: groupRenameTarget.id,
          name: groupName,
        })
        setGroups((current) => current.map((item) => item.id === group.id ? summarizeGroup(group) : item))
      } else {
        const group = await terminalBridge.group.create({ name })
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

  const renameSession = useCallback(async () => {
    if (!renameTarget) return
    const title = renameTitle.trim()
    if (!title) return
    setRenameSaving(true)
    try {
      const session = await terminalBridge.session.rename({
        sessionId: renameTarget.id,
        title: renameTitle,
      })
      setSessions((current) => mergeSession(current, session))
      setRenameTarget(null)
      setRenameTitle("")
    } catch (error) {
      logger.error("Failed to rename terminal session.", error)
      toast.error("重命名终端失败")
    } finally {
      setRenameSaving(false)
    }
  }, [renameTarget, renameTitle, terminalBridge])

  const deleteSession = useCallback(async (target: SynapseTerminalSession) => {
    const targetId = target.id
    setDeletingSessionId(targetId)
    try {
      await terminalBridge.session.delete({ sessionId: targetId })
      setSessions((current) => {
        const nextSessions = current.filter((session) => session.id !== targetId)
        setActiveSessionId((currentActiveId) => {
          if (currentActiveId !== targetId) return currentActiveId
          return nextSessions[0]?.id ?? null
        })
        return nextSessions
      })
    } catch (error) {
      logger.error("Failed to delete terminal session.", error)
      toast.error("删除终端失败")
    } finally {
      setDeletingSessionId((current) => current === targetId ? null : current)
    }
  }, [terminalBridge])

  const stopSession = useCallback(async (target: SynapseTerminalSession) => {
    setStoppingSessionId(target.id)
    try {
      await terminalBridge.session.stop({ sessionId: target.id, force: target.status === "stopping" })
    } catch (error) {
      logger.error("Failed to stop terminal session.", error)
      toast.error("停止终端失败")
    } finally {
      setStoppingSessionId((current) => current === target.id ? null : current)
    }
  }, [terminalBridge])

  const deleteGroup = useCallback(async (target = deleteGroupTarget) => {
    if (!target) return
    const groupId = target.id
    const removedSessionIds = new Set(sessions
      .filter((session) => session.groupId === groupId)
      .map((session) => session.id))
    setDeleteGroupSaving(true)
    try {
      await terminalBridge.group.delete({ groupId })
      setGroups((current) => current.filter((group) => group.id !== groupId))
      setSessions((current) => {
        const nextSessions = current.filter((session) => session.groupId !== groupId)
        setActiveSessionId((currentActiveId) => {
          if (!currentActiveId || !removedSessionIds.has(currentActiveId)) return currentActiveId
          return nextSessions[0]?.id ?? null
        })
        return nextSessions
      })
      setDeleteGroupTarget(null)
    } catch (error) {
      logger.error("Failed to delete terminal group.", error)
      toast.error("删除分组失败")
    } finally {
      setDeleteGroupSaving(false)
    }
  }, [deleteGroupTarget, sessions, terminalBridge])

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
      const group = await terminalBridge.group.updateSettings({
        groupId: groupSettingsTarget.id,
        name,
        expectedLaunchRevision: groupSettingsTarget.launchRevision,
        settings: groupSettingsLaunch,
      })
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
        await terminalBridge.groupCommand.update({
          groupId: commandManagerTarget.id,
          commandId: commandEditTarget.id,
          ...(commandEditTarget.commandRevision ? { expectedCommandRevision: commandEditTarget.commandRevision } : {}),
          name,
          command,
          launch: commandLaunch,
        })
      } else {
        await terminalBridge.groupCommand.create({
          groupId: commandManagerTarget.id,
          expectedCommandCollectionRevision: commandManagerTarget.commandCollectionRevision,
          name,
          command,
          ...(Object.keys(commandLaunch).length ? { launch: commandLaunch } : {}),
        })
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
      await terminalBridge.groupCommand.delete({
        groupId: commandManagerTarget.id,
        commandId: command.id,
      })
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
      const session = await terminalBridge.groupCommand.launch({
        groupId: group.id,
        commandId: command.id,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      })
      setSessions((current) => mergeSession(current, session))
      setActiveSessionId(session.id)
      setTerminalReadError(null)
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

  const handleTerminalDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [])

  const handleTerminalDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event)) return
    event.preventDefault()

    if (!terminalSessionId || !activeSessionRunning) {
      toast.error("终端未运行")
      return
    }

    const paths = Array.from(event.dataTransfer.files ?? [])
      .map((file) => shellBridge.filePathForDroppedFile(file))
    if (paths.length === 0 || paths.some((path) => !isValidDroppedTerminalPath(path))) {
      toast.error("拖拽路径不可用")
      return
    }

    const validPaths = paths.filter(isValidDroppedTerminalPath)
    const input = formatDroppedTerminalPaths(validPaths)
    void writeTerminalInputChunks({
      input,
      write: (data) => terminalBridge.session.write({
        sessionId: terminalSessionId,
        data,
      }),
    }).catch((error) => {
      logger.error("Failed to write dropped terminal paths.", error)
      toast.error("写入终端失败")
    })
  }, [activeSessionRunning, shellBridge, terminalBridge, terminalSessionId])

  const runToolbarAction = useCallback(async (action: TerminalToolbarAction) => {
    if (!activeSession) return
    if (!isTerminalToolbarActionEnabled(action, activeSession.status)) return

    if (action.kind === "xterm-local") {
      if (action.operation === "clear") {
        xtermRef.current?.clear()
        terminalGeometrySyncRef.current?.(true)
      }
      return
    }

    const payload = resolveTerminalToolbarPayload(action, rendererPlatform)
    if (!payload) return

    const data = action.kind === "shell-command" ? encodeTerminalCommandInput(payload) : payload
    try {
      await terminalBridge.session.write({
        sessionId: activeSession.id,
        data,
      })
    } catch (error) {
      logger.error("Failed to run terminal toolbar action.", error)
      toast.error("写入终端失败")
    }
  }, [activeSession, rendererPlatform, terminalBridge])

  useEffect(() => {
    const container = terminalContainerRef.current
    const initialSession = activeSessionRef.current
    if (!container || !terminalSessionId || !initialSession) return undefined

    setTerminalReadError(null)
    let disposed = false
    let lastSeq = 0
    let attached = false
    let projectionAvailable = false
    let geometrySyncReady = false
    let appliedSizeRevision = initialSession.sizeRevision
    let announcedSizeRevision = initialSession.sizeRevision
    let drainInFlight = false
    let requestedResize = { cols: initialSession.cols, rows: initialSession.rows }
    const pendingChunks: SynapseTerminalOutputChunk[] = []
    const resizeBarriers = new Map<number, SynapseTerminalResizedEvent>()
    const xterm = new Terminal({
      ...createTerminalRenderingOptions({
        container,
        disableStdin: initialSession.status !== "running",
      }),
      cols: initialSession.cols,
      rows: initialSession.rows,
    })
    xtermRef.current = xterm
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      void shellBridge.openExternal(uri).catch((error) => {
        logger.error("Failed to open terminal web link.", error)
        toast.error("打开链接失败")
      })
    })
    xterm.loadAddon(fitAddon)
    xterm.loadAddon(webLinksAddon)
    xterm.open(container)
    const webglRenderer = loadWebglRenderer(xterm)

    const syncTerminalGeometry = (refreshRenderer = false) => {
      if (disposed || !geometrySyncReady || !projectionAvailable) return
      if (refreshRenderer) {
        webglRenderer?.refresh()
      }
      const proposed = fitAddon.proposeDimensions()
      const cols = proposed?.cols ?? xterm.cols
      const rows = proposed?.rows ?? xterm.rows
      if (!cols || !rows) return
      if (xterm.cols === cols && xterm.rows === rows) return
      if (requestedResize.cols === cols && requestedResize.rows === rows) return
      requestedResize = { cols, rows }
      void terminalBridge.session.resize({
        sessionId: terminalSessionId,
        cols,
        rows,
      }).catch((error) => {
        requestedResize = { cols: xterm.cols, rows: xterm.rows }
        logger.warn("Failed to resize terminal session.", error)
      })
    }
    terminalGeometrySyncRef.current = syncTerminalGeometry

    const resizeObserver = new ResizeObserver(() => syncTerminalGeometry())
    resizeObserver.observe(container)

    const writeTerminalInput = (data: string) => {
      if (disposed || xterm.options.disableStdin) return
      void terminalBridge.session.write({
        sessionId: terminalSessionId,
        data,
      }).catch((error) => {
        logger.error("Failed to write terminal input.", error)
        toast.error("写入终端失败")
      })
    }

    xterm.attachCustomKeyEventHandler((event) => {
      if (!isTerminalShiftEnterEvent(event)) return true
      event.preventDefault()
      event.stopPropagation()
      if (event.type === "keydown") writeTerminalInput("\n")
      return false
    })

    const inputDisposable = xterm.onData(writeTerminalInput)

    const writeTerminalData = (data: string) => new Promise<void>((resolve) => {
      if (disposed) {
        resolve()
        return
      }
      xterm.write(data, resolve)
    })

    const writePendingChunksThrough = async (throughOutputSeq: number) => {
      pendingChunks.sort((left, right) => left.seq - right.seq)
      while (!disposed && pendingChunks.length > 0) {
        const chunk = pendingChunks[0]!
        if (chunk.seq > throughOutputSeq) break
        pendingChunks.shift()
        if (chunk.seq <= lastSeq) continue
        await writeTerminalData(chunk.data)
        lastSeq = chunk.seq
      }
    }

    const drainProjection = async () => {
      if (drainInFlight || !attached || !projectionAvailable || disposed) return
      drainInFlight = true
      try {
        while (!disposed) {
          const nextBarrier = [...resizeBarriers.values()]
            .filter((event) => event.sizeRevision > appliedSizeRevision)
            .sort((left, right) => left.sizeRevision - right.sizeRevision)[0]
          if (nextBarrier) {
            await writePendingChunksThrough(nextBarrier.throughOutputSeq)
            if (disposed) return
            xterm.resize(nextBarrier.cols, nextBarrier.rows)
            webglRenderer?.refresh()
            appliedSizeRevision = nextBarrier.sizeRevision
            requestedResize = { cols: nextBarrier.cols, rows: nextBarrier.rows }
            resizeBarriers.delete(nextBarrier.sizeRevision)
            continue
          }
          if (announcedSizeRevision > appliedSizeRevision) return
          if (pendingChunks.length === 0) return
          await writePendingChunksThrough(Number.POSITIVE_INFINITY)
        }
      } finally {
        drainInFlight = false
        const hasApplicableBarrier = [...resizeBarriers.keys()].some((revision) => revision > appliedSizeRevision)
        if (hasApplicableBarrier || (announcedSizeRevision <= appliedSizeRevision && pendingChunks.length > 0)) {
          void drainProjection()
        }
      }
    }

    const unsubscribeData = terminalBridge.operation.onData((event) => {
      if (event.sessionId !== terminalSessionId || disposed) return
      pendingChunks.push(event.chunk)
      void drainProjection()
    })

    const unsubscribeSessionChanged = terminalBridge.operation.onSessionChanged((session) => {
      setSessions((current) => mergeSession(current, session))
      if (session.id !== terminalSessionId || session.sizeRevision <= announcedSizeRevision) return
      announcedSizeRevision = session.sizeRevision
      void drainProjection()
    })
    const unsubscribeSessionDeleted = terminalBridge.operation.onSessionDeleted((event) => {
      deletedSessionIdsRef.current.add(event.sessionId)
      setSessions((current) => {
        const nextSessions = current.filter((session) => session.id !== event.sessionId)
        setActiveSessionId((currentActiveId) => {
          if (currentActiveId !== event.sessionId) return currentActiveId
          return nextSessions[0]?.id ?? null
        })
        return nextSessions
      })
    })
    const unsubscribeResized = terminalBridge.operation.onResized((event) => {
      if (event.sessionId !== terminalSessionId || disposed || event.sizeRevision <= appliedSizeRevision) return
      announcedSizeRevision = Math.max(announcedSizeRevision, event.sizeRevision)
      resizeBarriers.set(event.sizeRevision, event)
      void drainProjection()
    })
    const unsubscribeDomainChanged = terminalBridge.operation.onDomainChanged(() => {
      void refreshSessions().catch((error) => {
        logger.warn("Failed to refresh terminal objects after a domain change.", error)
      })
    })

    const attachProjection = async () => {
      const snapshot = await terminalBridge.session.attach({ sessionId: terminalSessionId })
      if (disposed) return
      setSessions((current) => mergeSession(current, snapshot.session))
      if (snapshot.degraded) {
        setTerminalReadError("终端画面无法恢复")
        attached = true
        return
      }

      xterm.resize(snapshot.cols, snapshot.rows)
      await writeTerminalData(snapshot.serialized)
      if (disposed) return
      lastSeq = snapshot.throughOutputSeq
      appliedSizeRevision = snapshot.sizeRevision
      announcedSizeRevision = Math.max(announcedSizeRevision, snapshot.sizeRevision)
      requestedResize = { cols: snapshot.cols, rows: snapshot.rows }
      for (const revision of resizeBarriers.keys()) {
        if (revision <= appliedSizeRevision) resizeBarriers.delete(revision)
      }
      attached = true
      projectionAvailable = true
      await drainProjection()
      geometrySyncReady = true
      syncTerminalGeometry()
    }

    void attachProjection().catch((error) => {
      logger.error("Failed to attach terminal projection.", error)
      if (!disposed && !deletedSessionIdsRef.current.has(terminalSessionId)) {
        setTerminalReadError("终端画面无法恢复")
        toast.error("终端画面无法恢复")
      }
    })

    return () => {
      disposed = true
      unsubscribeData()
      unsubscribeSessionChanged()
      unsubscribeSessionDeleted()
      unsubscribeResized()
      unsubscribeDomainChanged()
      inputDisposable.dispose()
      webglRenderer?.dispose()
      resizeObserver.disconnect()
      if (terminalGeometrySyncRef.current === syncTerminalGeometry) {
        terminalGeometrySyncRef.current = null
      }
      if (xtermRef.current === xterm) {
        xtermRef.current = null
      }
      xterm.dispose()
    }
  }, [refreshSessions, shellBridge, terminalBridge, terminalSessionId])

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.disableStdin = terminalSessionStatus !== "running"
    }
  }, [terminalSessionStatus])

  const sidebar = (
    <ModuleSidebar
      variant="bare"
      className="min-h-0 bg-background"
    >
      <div className="flex items-center justify-start">
        <Button type="button" size="sm" variant="outline" onClick={openCreateGroupDialog}>
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
          ) : sessionGroups.length > 0 ? sessionGroups.map((group) => (
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
              {group.sessions.map((session) => (
                <ModuleSidebarRow
                  key={session.id}
                  active={session.id === activeSession?.id}
                  data-track="terminal-session-select"
                  icon={<TerminalSessionStatusIcon status={session.status} />}
                  trailing={
                    <TerminalSessionLifecycleButton
                      disabled={deletingSessionId === session.id || stoppingSessionId === session.id}
                      session={session}
                      onDelete={() => { void deleteSession(session) }}
                      onStop={() => { void stopSession(session) }}
                    />
                  }
                  trackValue={session.id}
                  onSelect={() => setActiveSessionId(session.id)}
                  onDoubleClick={() => openRenameDialog(session)}
                >
                  {session.title}
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
        <SystemAppTopBarActionButton type="button" onClick={() => { void createSession() }}>
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
          {activeSession ? (
            <div className="dark flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
              {terminalReadError ? (
                <div className="border-b bg-background px-3 py-2 text-sm text-muted-foreground">{terminalReadError}</div>
              ) : null}
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
              <div
                role="region"
                aria-label="终端输出与输入"
                tabIndex={0}
                onDragOver={handleTerminalDragOver}
                onDrop={handleTerminalDrop}
                className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  ref={terminalContainerRef}
                  data-terminal-xterm-mount
                  className="h-full min-h-0 min-w-0 overflow-hidden"
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
        if (!open) {
          setRenameTarget(null)
          setRenameTitle("")
        }
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
                void renameSession()
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={renameSaving}
              onClick={() => {
                setRenameTarget(null)
                setRenameTitle("")
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={renameSaving || !renameTitle.trim()}
              onClick={() => { void renameSession() }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteGroupTarget !== null} onOpenChange={(open) => {
        if (!open) setDeleteGroupTarget(null)
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
            <AlertDialogAction onClick={() => {
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

function TerminalSessionLifecycleButton({
  disabled,
  session,
  onDelete,
  onStop,
}: {
  readonly disabled: boolean
  readonly session: SynapseTerminalSession
  readonly onDelete: () => void
  readonly onStop: () => void
}) {
  const active = session.status === "running" || session.status === "stopping"
  const actionLabel = session.status === "running" ? "停止" : session.status === "stopping" ? "强制停止" : "删除"
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      disabled={disabled}
      aria-label={`${actionLabel}终端会话：${session.title}`}
      title={actionLabel}
      className={cn("text-muted-foreground", active ? "hover:text-foreground" : "hover:text-destructive")}
      onClick={(event) => {
        event.stopPropagation()
        if (active) onStop()
        else onDelete()
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {active ? <Square className="size-3.5" /> : <Trash2 className="size-3.5" />}
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

function groupSessions(
  groups: readonly SynapseTerminalGroupSummary[],
  sessions: readonly SynapseTerminalSession[],
): Array<SynapseTerminalGroupSummary & { sessions: SynapseTerminalSession[] }> {
  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder)
  const grouped = sortedGroups.map((group) => ({
    ...group,
    sessions: sessions.filter((session) => session.groupId === group.id),
  }))
  const groupedSessionIds = new Set(grouped.flatMap((group) => group.sessions.map((session) => session.id)))
  const ungrouped = sessions.filter((session) => !groupedSessionIds.has(session.id))

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
      sessions: ungrouped,
    },
  ]
}

function isExternalFileDrag(event: DragEvent<HTMLElement>): boolean {
  const types = Array.from(event.dataTransfer.types ?? [])
  if (types.includes("Files")) return true
  return Array.from(event.dataTransfer.files ?? []).length > 0
}

function isValidDroppedTerminalPath(path: string | null): path is string {
  return typeof path === "string" && path.length > 0 && !/[\r\n]/.test(path)
}

function formatDroppedTerminalPaths(paths: readonly string[]): string {
  return `${paths.map(escapeTerminalPath).join(" ")} `
}

function escapeTerminalPath(path: string): string {
  return path.replace(/([\\\s"'`$&;()<>|*?[\]{}!#~])/g, "\\$1")
}

async function writeTerminalInputChunks(options: {
  readonly input: string
  readonly write: (data: string) => Promise<void>
}): Promise<void> {
  for (const chunk of splitTerminalInput(options.input)) {
    await options.write(chunk)
  }
}

function splitTerminalInput(input: string): string[] {
  const chunks: string[] = []
  for (let index = 0; index < input.length; index += TERMINAL_WRITE_CHUNK_SIZE) {
    chunks.push(input.slice(index, index + TERMINAL_WRITE_CHUNK_SIZE))
  }
  return chunks
}

function mergeSession(
  sessions: readonly SynapseTerminalSession[],
  session: SynapseTerminalSession,
): SynapseTerminalSession[] {
  return sessions.some((item) => item.id === session.id)
    ? sessions.map((item) => item.id === session.id ? session : item)
    : [...sessions, session]
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

function loadWebglRenderer(xterm: Terminal): { dispose(): void; refresh(): void } | undefined {
  try {
    const webglAddon = new WebglAddon()
    const contextLossDisposable = webglAddon.onContextLoss(() => {
      logger.warn("Terminal WebGL renderer context lost; falling back to DOM renderer.")
      webglAddon.dispose()
    })
    xterm.loadAddon(webglAddon)
    return {
      dispose: () => contextLossDisposable.dispose(),
      refresh: () => webglAddon.clearTextureAtlas(),
    }
  } catch (error) {
    logger.warn("Terminal WebGL renderer unavailable; falling back to DOM renderer.", { error })
    return undefined
  }
}
