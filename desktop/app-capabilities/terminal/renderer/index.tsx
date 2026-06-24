import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CircleDot, Folder, FolderOpen, Link2Off, MoreHorizontal, Pencil, Plus, Settings, Terminal as TerminalIcon, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import "@xterm/xterm/css/xterm.css"
import { createRendererLogger } from "../../../src/app-shell/logging"
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
import { Input } from "../../../src/components/ui/input"
import { Textarea } from "../../../src/components/ui/textarea"
import {
  ModuleSidebar,
  ModuleSidebarGroup,
  ModuleSidebarList,
  ModuleSidebarRow,
} from "../../../src/components/module-sidebar"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { cn } from "../../../src/lib/utils"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type {
  SynapseTerminalGroup,
  SynapseTerminalCreateSessionInput,
  SynapseTerminalOutputChunk,
  SynapseTerminalSession,
} from "../../../src/types/terminal"
import { createTerminalRenderingOptions } from "./terminal-rendering"

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

const logger = createRendererLogger("terminal.app")

export function TerminalModule() {
  const terminalBridge = requireBridgeDomain("terminal")
  const [groups, setGroups] = useState<SynapseTerminalGroup[]>([])
  const [sessions, setSessions] = useState<SynapseTerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [renameTarget, setRenameTarget] = useState<SynapseTerminalSession | null>(null)
  const [renameTitle, setRenameTitle] = useState("")
  const [renameSaving, setRenameSaving] = useState(false)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [groupDialogMode, setGroupDialogMode] = useState<"create" | "rename" | null>(null)
  const [groupRenameTarget, setGroupRenameTarget] = useState<SynapseTerminalGroup | null>(null)
  const [groupName, setGroupName] = useState("")
  const [groupSaving, setGroupSaving] = useState(false)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<SynapseTerminalGroup | null>(null)
  const [deleteGroupSaving, setDeleteGroupSaving] = useState(false)
  const [groupSettingsTarget, setGroupSettingsTarget] = useState<SynapseTerminalGroup | null>(null)
  const [groupSettingsName, setGroupSettingsName] = useState("")
  const [groupSettingsDefaultCwd, setGroupSettingsDefaultCwd] = useState("")
  const [groupSettingsStartupCommand, setGroupSettingsStartupCommand] = useState("")
  const [groupSettingsSaving, setGroupSettingsSaving] = useState(false)
  const [terminalReadError, setTerminalReadError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openGroupIds, setOpenGroupIds] = useState<Record<string, boolean>>({})
  const terminalContainerRef = useRef<HTMLDivElement | null>(null)

  const activeSession = useMemo(() => {
    if (!activeSessionId) return sessions[0] ?? null
    return sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null
  }, [activeSessionId, sessions])

  const sessionGroups = useMemo(() => groupSessions(groups, sessions), [groups, sessions])

  const refreshSessions = useCallback(async () => {
    const [nextGroups, nextSessions] = await Promise.all([
      terminalBridge.listGroups(),
      terminalBridge.listSessions(),
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

  const createSession = useCallback(async (input: SynapseTerminalCreateSessionInput = {}) => {
    try {
      const session = await terminalBridge.createSession({
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        ...input,
      })
      setSessions((current) => mergeSession(current, session))
      setActiveSessionId(session.id)
      setTerminalReadError(null)
      terminalBridge.listGroups()
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

  const openRenameGroupDialog = useCallback((group: SynapseTerminalGroup) => {
    setGroupDialogMode("rename")
    setGroupRenameTarget(group)
    setGroupName(group.name)
  }, [])

  const openGroupSettingsDialog = useCallback((group: SynapseTerminalGroup) => {
    setGroupSettingsTarget(group)
    setGroupSettingsName(group.name)
    setGroupSettingsDefaultCwd(group.settings?.defaultCwd ?? "")
    setGroupSettingsStartupCommand(group.settings?.startupCommand ?? "")
  }, [])

  const saveGroup = useCallback(async () => {
    const name = groupName.trim()
    if (!name) return
    setGroupSaving(true)
    try {
      if (groupDialogMode === "rename" && groupRenameTarget) {
        const group = await terminalBridge.renameGroup({
          groupId: groupRenameTarget.id,
          name: groupName,
        })
        setGroups((current) => current.map((item) => item.id === group.id ? group : item))
      } else {
        const group = await terminalBridge.createGroup({ name })
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
      const session = await terminalBridge.renameSession({
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
      await terminalBridge.deleteSession({ sessionId: targetId })
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

  const deleteGroup = useCallback(async () => {
    if (!deleteGroupTarget) return
    const groupId = deleteGroupTarget.id
    const removedSessionIds = new Set(sessions
      .filter((session) => session.groupId === groupId)
      .map((session) => session.id))
    setDeleteGroupSaving(true)
    try {
      await terminalBridge.deleteGroup({ groupId })
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

  const resetGroupSettingsDialog = useCallback(() => {
    setGroupSettingsTarget(null)
    setGroupSettingsName("")
    setGroupSettingsDefaultCwd("")
    setGroupSettingsStartupCommand("")
  }, [])

  const saveGroupSettings = useCallback(async () => {
    if (!groupSettingsTarget) return
    const name = groupSettingsName.trim()
    if (!name) return
    const defaultCwd = groupSettingsDefaultCwd.trim()
    const startupCommand = groupSettingsStartupCommand.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
    setGroupSettingsSaving(true)
    try {
      const group = await terminalBridge.updateGroupSettings({
        groupId: groupSettingsTarget.id,
        name,
        settings: {
          ...(defaultCwd ? { defaultCwd } : {}),
          ...(startupCommand ? { startupCommand } : {}),
        },
      })
      setGroups((current) => current.map((item) => item.id === group.id ? group : item))
      resetGroupSettingsDialog()
    } catch (error) {
      logger.error("Failed to update terminal group settings.", error)
      toast.error("保存分组设置失败")
    } finally {
      setGroupSettingsSaving(false)
    }
  }, [
    groupSettingsDefaultCwd,
    groupSettingsName,
    groupSettingsStartupCommand,
    groupSettingsTarget,
    resetGroupSettingsDialog,
    terminalBridge,
  ])

  const headerActions = useMemo(() => (
    <Button type="button" size="sm" onClick={() => { void createSession() }}>
      <Plus data-icon="inline-start" />
      新建终端
    </Button>
  ), [createSession])

  useEffect(() => {
    const container = terminalContainerRef.current
    if (!container || !activeSession) return undefined

    setTerminalReadError(null)
    let disposed = false
    let lastSeq = 0
    const xterm = new Terminal(createTerminalRenderingOptions({
      container,
      disableStdin: activeSession.status !== "running",
    }))
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    xterm.loadAddon(fitAddon)
    xterm.loadAddon(webLinksAddon)
    xterm.open(container)
    const webglContextLossDisposable = loadWebglRenderer(xterm)

    const resizeSession = () => {
      if (disposed) return
      fitAddon.fit()
      const proposed = fitAddon.proposeDimensions()
      const cols = proposed?.cols ?? xterm.cols
      const rows = proposed?.rows ?? xterm.rows
      if (!cols || !rows) return
      void terminalBridge.resizeSession({
        sessionId: activeSession.id,
        cols,
        rows,
      }).catch((error) => {
        logger.warn("Failed to resize terminal session.", error)
      })
    }

    const resizeObserver = new ResizeObserver(resizeSession)
    resizeObserver.observe(container)

    const inputDisposable = xterm.onData((data) => {
      void terminalBridge.writeSession({
        sessionId: activeSession.id,
        data,
      }).catch((error) => {
        logger.error("Failed to write terminal input.", error)
        toast.error("写入终端失败")
      })
    })

    let initialReadComplete = false
    const pendingChunks: SynapseTerminalOutputChunk[] = []
    const writeChunk = (chunk: SynapseTerminalOutputChunk) => {
      if (chunk.seq <= lastSeq) return
      lastSeq = chunk.seq
      xterm.write(chunk.data)
    }

    const unsubscribeData = terminalBridge.onData((event) => {
      if (event.sessionId !== activeSession.id || disposed) return
      if (!initialReadComplete) {
        pendingChunks.push(event.chunk)
        return
      }
      writeChunk(event.chunk)
    })

    const unsubscribeSessionChanged = terminalBridge.onSessionChanged((session) => {
      setSessions((current) => mergeSession(current, session))
    })
    const unsubscribeSessionDeleted = terminalBridge.onSessionDeleted((event) => {
      setSessions((current) => {
        const nextSessions = current.filter((session) => session.id !== event.sessionId)
        setActiveSessionId((currentActiveId) => {
          if (currentActiveId !== event.sessionId) return currentActiveId
          return nextSessions[0]?.id ?? null
        })
        return nextSessions
      })
    })

    terminalBridge.readSession({
      sessionId: activeSession.id,
      afterSeq: 0,
    }).then((result) => {
      if (disposed) return
      for (const chunk of result.chunks) {
        writeChunk(chunk)
      }
      initialReadComplete = true
      for (const chunk of pendingChunks.sort((a, b) => a.seq - b.seq)) {
        writeChunk(chunk)
      }
      pendingChunks.length = 0
    }).catch((error) => {
      logger.error("Failed to read terminal output.", error)
      if (!disposed) {
        setTerminalReadError("读取终端输出失败")
        toast.error("读取终端输出失败")
      }
    })

    return () => {
      disposed = true
      unsubscribeData()
      unsubscribeSessionChanged()
      unsubscribeSessionDeleted()
      inputDisposable.dispose()
      webglContextLossDisposable?.dispose()
      resizeObserver.disconnect()
      xterm.dispose()
    }
  }, [activeSession, terminalBridge])

  return (
    <SystemAppWindowShell
      actions={headerActions}
    >
      <div
        className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background md:grid-cols-[13.5rem_minmax(0,1fr)] md:grid-rows-1"
      >
        <ModuleSidebar
          variant="bare"
          className="max-h-48 min-h-0 border-b bg-background md:max-h-none md:border-b-0 md:border-r"
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
                  headerClassName="pl-0 pr-3"
                  contentClassName="pl-0"
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
                            aria-label={`终端分组操作：${group.name}`}
                          >
                            <MoreHorizontal className="size-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openGroupSettingsDialog(group)}>
                            <Settings />
                            设置
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openRenameGroupDialog(group)}>
                            <Pencil />
                            重命名
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleteGroupTarget(group)}>
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
                        <TerminalSessionDeleteButton
                          disabled={deletingSessionId === session.id}
                          session={session}
                          onDelete={() => { void deleteSession(session) }}
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
        <main className="flex min-h-0 min-w-0 flex-col">
          {activeSession ? (
            <div className="dark flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
              {terminalReadError ? (
                <div className="border-b bg-background px-3 py-2 text-sm text-muted-foreground">{terminalReadError}</div>
              ) : null}
              <div
                ref={terminalContainerRef}
                role="region"
                aria-label="终端输出与输入"
                tabIndex={0}
                className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
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
      </div>
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
        if (!open) resetGroupSettingsDialog()
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>分组设置</DialogTitle>
            <DialogDescription className="sr-only">
              设置分组名称、默认目录和启动命令。
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
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">默认目录</span>
              <Input
                aria-label="默认目录"
                value={groupSettingsDefaultCwd}
                onChange={(event) => setGroupSettingsDefaultCwd(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">启动命令</span>
              <Textarea
                aria-label="启动命令"
                value={groupSettingsStartupCommand}
                onChange={(event) => setGroupSettingsStartupCommand(event.target.value)}
                rows={5}
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={groupSettingsSaving}
              onClick={resetGroupSettingsDialog}
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
              会删除该分组下的终端会话，运行中的会话会停止。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteGroupSaving}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteGroupSaving}
              onClick={() => { void deleteGroup() }}
            >
              删除分组
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SystemAppWindowShell>
  )
}

function TerminalSessionDeleteButton({
  disabled,
  session,
  onDelete,
}: {
  readonly disabled: boolean
  readonly session: SynapseTerminalSession
  readonly onDelete: () => void
}) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      disabled={disabled}
      aria-label={`删除终端会话：${session.title}`}
      title="删除"
      className="text-muted-foreground hover:text-destructive"
      onClick={(event) => {
        event.stopPropagation()
        onDelete()
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Trash2 className="size-3.5" />
    </Button>
  )
}

function TerminalSessionStatusIcon({ status }: { readonly status: SynapseTerminalSession["status"] }) {
  const running = status === "running"
  const Icon = running ? CircleDot : Link2Off
  const label = running ? "运行中" : "已断开"

  return (
    <span
      title={label}
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center",
        running ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

function groupSessions(
  groups: readonly SynapseTerminalGroup[],
  sessions: readonly SynapseTerminalSession[],
): Array<SynapseTerminalGroup & { sessions: SynapseTerminalSession[] }> {
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
      sessions: ungrouped,
    },
  ]
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
  groups: readonly SynapseTerminalGroup[],
  group: SynapseTerminalGroup,
): SynapseTerminalGroup[] {
  const nextGroups = groups.some((item) => item.id === group.id)
    ? groups.map((item) => item.id === group.id ? group : item)
    : [...groups, group]
  return nextGroups.sort((left, right) => left.sortOrder - right.sortOrder)
}

function loadWebglRenderer(xterm: Terminal): { dispose(): void } | undefined {
  try {
    const webglAddon = new WebglAddon()
    const contextLossDisposable = webglAddon.onContextLoss(() => {
      logger.warn("Terminal WebGL renderer context lost; falling back to DOM renderer.")
      webglAddon.dispose()
    })
    xterm.loadAddon(webglAddon)
    return contextLossDisposable
  } catch (error) {
    logger.warn("Terminal WebGL renderer unavailable; falling back to DOM renderer.", { error })
    return undefined
  }
}
