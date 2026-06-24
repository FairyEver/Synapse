import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Plus, Square, Terminal as TerminalIcon } from "lucide-react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import "@xterm/xterm/css/xterm.css"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Badge } from "../../../src/components/ui/badge"
import { Button } from "../../../src/components/ui/button"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Switch } from "../../../src/components/ui/switch"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { cn } from "../../../src/lib/utils"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type {
  SynapseTerminalGroup,
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
  const [agentControlPending, setAgentControlPending] = useState(false)
  const terminalContainerRef = useRef<HTMLDivElement | null>(null)

  const activeSession = useMemo(() => {
    if (!activeSessionId) return sessions[0] ?? null
    return sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null
  }, [activeSessionId, sessions])

  const sessionGroups = useMemo(() => groupSessions(groups, sessions), [groups, sessions])
  const canSetAgentControl = "setAgentControl" in terminalBridge && typeof terminalBridge.setAgentControl === "function"
  const statusLabel = activeSession ? getStatusLabel(activeSession.status) : "未启动"
  const canStopSession = activeSession?.status === "running"

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

  const createSession = useCallback(async () => {
    try {
      const session = await terminalBridge.createSession({
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
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

  const setAgentControl = useCallback(async (enabled: boolean) => {
    if (!activeSession || !canSetAgentControl) return
    setAgentControlPending(true)
    try {
      const session = await terminalBridge.setAgentControl({
        sessionId: activeSession.id,
        enabled,
      })
      setSessions((current) => mergeSession(current, session))
    } catch (error) {
      logger.error("Failed to update terminal agent control.", error)
    } finally {
      setAgentControlPending(false)
    }
  }, [activeSession, canSetAgentControl, terminalBridge])

  const headerActions = useMemo(() => (
    <>
      <Badge variant="outline">{statusLabel}</Badge>
      <Button type="button" size="sm" onClick={createSession}>
        <Plus data-icon="inline-start" />
        新建终端
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={!canStopSession} onClick={stopCurrentSession}>
        <Square data-icon="inline-start" />
        停止会话
      </Button>
    </>
  ), [canStopSession, createSession, statusLabel, stopCurrentSession])

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
      <div className="grid h-full min-h-0 grid-cols-[16rem_minmax(0,1fr)] bg-background">
        <aside className="min-h-0 border-r bg-surface">
          <ScrollArea className="h-full">
            <div className="grid gap-3 p-3">
              {sessionGroups.length > 0 ? sessionGroups.map((group) => (
                <div key={group.id} className="grid gap-1">
                  <div className="px-2 text-xs font-medium text-muted-foreground">{group.name}</div>
                  <div className="grid gap-1">
                    {group.sessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        className={cn(
                          "grid min-h-10 w-full min-w-0 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          session.id === activeSession?.id ? "bg-muted text-foreground" : "text-foreground",
                        )}
                        onClick={() => setActiveSessionId(session.id)}
                      >
                        <span className="truncate font-medium">{session.title}</span>
                        <span className="truncate text-xs text-muted-foreground">{session.cwd}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )) : (
                <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  {loading ? "" : "新建会话"}
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col">
          {activeSession ? (
            <>
              <header className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{activeSession.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{activeSession.cwd}</div>
                </div>
                {canSetAgentControl ? (
                  <label className="flex items-center gap-2 text-sm font-medium">
                    Agent 控制
                    <Switch
                      checked={activeSession.agentControl === "enabled"}
                      disabled={agentControlPending}
                      onCheckedChange={setAgentControl}
                    />
                  </label>
                ) : null}
              </header>
              <div className="dark min-h-0 flex-1 overflow-hidden bg-background p-2">
                <div ref={terminalContainerRef} className="h-full min-h-0 min-w-0 overflow-hidden rounded-lg border bg-background" />
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-0 items-center justify-center">
              <Button type="button" onClick={createSession}>
                <TerminalIcon data-icon="inline-start" />
                新建终端
              </Button>
            </div>
          )}
        </main>
      </div>
    </SystemAppWindowShell>
  )
}

function groupSessions(
  groups: readonly SynapseTerminalGroup[],
  sessions: readonly SynapseTerminalSession[],
): Array<{ id: string; name: string; sessions: SynapseTerminalSession[] }> {
  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder)
  const grouped = sortedGroups.map((group) => ({
    id: group.id,
    name: group.name,
    sessions: sessions.filter((session) => session.groupId === group.id),
  })).filter((group) => group.sessions.length > 0)
  const groupedSessionIds = new Set(grouped.flatMap((group) => group.sessions.map((session) => session.id)))
  const ungrouped = sessions.filter((session) => !groupedSessionIds.has(session.id))

  if (ungrouped.length === 0) return grouped
  return [
    ...grouped,
    {
      id: "ungrouped",
      name: "会话",
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

function getStatusLabel(status: SynapseTerminalSession["status"]): string {
  if (status === "running") return "运行中"
  if (status === "exited") return "已退出"
  if (status === "killed") return "已停止"
  if (status === "failed") return "失败"
  return "丢失"
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
