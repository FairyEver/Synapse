import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MoreHorizontal, Pencil, Plus, RotateCcw, Square, Terminal as TerminalIcon, Trash2 } from "lucide-react"
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
import { Badge } from "../../../src/components/ui/badge"
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
import { ScrollArea } from "../../../src/components/ui/scroll-area"
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
  const [deleteTarget, setDeleteTarget] = useState<SynapseTerminalSession | null>(null)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [groupDialogMode, setGroupDialogMode] = useState<"create" | "rename" | null>(null)
  const [groupRenameTarget, setGroupRenameTarget] = useState<SynapseTerminalGroup | null>(null)
  const [groupName, setGroupName] = useState("")
  const [groupSaving, setGroupSaving] = useState(false)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<SynapseTerminalGroup | null>(null)
  const [deleteGroupSaving, setDeleteGroupSaving] = useState(false)
  const terminalContainerRef = useRef<HTMLDivElement | null>(null)

  const activeSession = useMemo(() => {
    if (!activeSessionId) return sessions[0] ?? null
    return sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null
  }, [activeSessionId, sessions])

  const sessionGroups = useMemo(() => groupSessions(groups, sessions), [groups, sessions])
  const statusLabel = activeSession ? getStatusLabel(activeSession.status) : "未启动"
  const canStopSession = activeSession?.status === "running"
  const canRestartSession = Boolean(activeSession && activeSession.status !== "running")

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
    refreshSessions()
      .catch((error) => {
        logger.error("Failed to load terminal sessions.", error)
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
      terminalBridge.listGroups()
        .then(setGroups)
        .catch((error) => {
          logger.warn("Failed to refresh terminal groups after session creation.", error)
        })
    } catch (error) {
      logger.error("Failed to create terminal session.", error)
    }
  }, [terminalBridge])

  const restartActiveSession = useCallback(async () => {
    if (!activeSession || activeSession.status === "running") return
    await createSession({
      groupId: activeSession.groupId,
      title: activeSession.title,
      cwd: activeSession.cwd,
      cols: activeSession.cols,
      rows: activeSession.rows,
    })
  }, [activeSession, createSession])

  const stopCurrentSession = useCallback(async () => {
    if (!activeSession) return
    try {
      await terminalBridge.stopSession({ sessionId: activeSession.id })
      const session = await terminalBridge.getSession({ sessionId: activeSession.id })
      setSessions((current) => mergeSession(current, session))
    } catch (error) {
      logger.error("Failed to stop terminal session.", error)
    }
  }, [activeSession, terminalBridge])

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
    } finally {
      setRenameSaving(false)
    }
  }, [renameTarget, renameTitle, terminalBridge])

  const deleteSession = useCallback(async () => {
    if (!deleteTarget) return
    const targetId = deleteTarget.id
    setDeleteSaving(true)
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
      setDeleteTarget(null)
    } catch (error) {
      logger.error("Failed to delete terminal session.", error)
    } finally {
      setDeleteSaving(false)
    }
  }, [deleteTarget, terminalBridge])

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
    } finally {
      setDeleteGroupSaving(false)
    }
  }, [deleteGroupTarget, sessions, terminalBridge])

  const headerActions = useMemo(() => (
    <Button type="button" size="sm" onClick={() => { void createSession() }}>
      <Plus data-icon="inline-start" />
      新建终端
    </Button>
  ), [createSession])

  useEffect(() => {
    const container = terminalContainerRef.current
    if (!container || !activeSession) return undefined

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
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background md:grid-cols-[13.5rem_minmax(0,1fr)] md:grid-rows-1">
        <aside className="max-h-48 min-h-0 border-b bg-surface md:max-h-none md:border-b-0 md:border-r">
          <ScrollArea className="h-full">
            <div className="grid gap-2 p-2">
              <div className="flex items-center justify-end">
                <Button type="button" size="sm" variant="outline" onClick={openCreateGroupDialog}>
                  <Plus data-icon="inline-start" />
                  新建分组
                </Button>
              </div>
              {loading ? (
                <div className="grid gap-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : sessionGroups.length > 0 ? sessionGroups.map((group) => (
                <div key={group.id} className="grid gap-1">
                  <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-2">
                    <div className="truncate text-xs font-medium text-muted-foreground">{group.name}</div>
                    {group.id !== "ungrouped" ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`终端分组操作：${group.name}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { void createSession({ groupId: group.id }) }}>
                            <TerminalIcon />
                            新建终端
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
                    ) : null}
                  </div>
                  <div className="grid gap-1">
                    {group.sessions.map((session) => (
                      <div
                        key={session.id}
                        className={cn(
                          "grid min-h-9 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center rounded-lg transition-colors hover:bg-muted",
                          session.id === activeSession?.id ? "bg-muted text-foreground" : "text-foreground",
                        )}
                      >
                        <button
                          type="button"
                          className="grid min-h-9 min-w-0 content-center px-2 py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => setActiveSessionId(session.id)}
                        >
                          <span className="truncate font-medium">{session.title}</span>
                          <span className="truncate text-xs text-muted-foreground">{session.cwd}</span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`终端会话操作：${session.title}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openRenameDialog(session)}>
                              <Pencil />
                              重命名
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(session)}>
                              <Trash2 />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                </div>
              )) : (
                <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed px-3 text-sm text-muted-foreground">
                  暂无会话
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col">
          {activeSession ? (
            <>
              <header className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{activeSession.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{activeSession.cwd}</div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <Badge variant="outline">{statusLabel}</Badge>
                  {canRestartSession ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => { void restartActiveSession() }}>
                      <RotateCcw data-icon="inline-start" />
                      在此处新开
                    </Button>
                  ) : null}
                  {canStopSession ? (
                    <Button type="button" size="sm" variant="outline" onClick={stopCurrentSession}>
                      <Square data-icon="inline-start" />
                      停止会话
                    </Button>
                  ) : null}
                </div>
              </header>
              <div className="dark min-h-0 flex-1 overflow-hidden bg-background">
                <div ref={terminalContainerRef} className="h-full min-h-0 min-w-0 overflow-hidden rounded-lg border bg-background" />
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-0 items-center justify-center">
              <Button type="button" onClick={() => { void createSession() }}>
                <TerminalIcon data-icon="inline-start" />
                新建终端
              </Button>
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
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => {
        if (!open) setDeleteTarget(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除终端</AlertDialogTitle>
            <AlertDialogDescription>
              会停止该终端并删除保留输出。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSaving}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteSaving}
              onClick={() => { void deleteSession() }}
            >
              删除终端
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

function getStatusLabel(status: SynapseTerminalSession["status"]): string {
  if (status === "running") return "运行中"
  if (status === "exited") return "已退出"
  if (status === "killed") return "已停止"
  if (status === "failed") return "失败"
  return "已断开"
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
