import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react"
import { Bot, Loader2, MessageSquare, Plus, RefreshCw, Send, User } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { formatDateTime } from "@/lib/date-time"
import { cn } from "@/lib/utils"
import type {
  SynapseAgentSessionDetail,
  SynapseAgentSessionSummary,
  SynapseSessionHistoryEntry,
} from "@/types/agent-session"

const logger = createRendererLogger("agent.sessions")

function shortSessionId(id: string): string {
  return id.slice(0, 8)
}

function sessionTitle(session: SynapseAgentSessionSummary): string {
  return session.name || session.userName || shortSessionId(session.id)
}

function previewContent(message: SynapseSessionHistoryEntry | null): string {
  return message?.content.replace(/\s+/g, " ").trim() || "无消息"
}

function defaultSessionKey(projectName: string): string {
  return `bridge:web-admin:${projectName}`
}

function HistoryMessage({ entry }: { entry: SynapseSessionHistoryEntry }) {
  const isUser = entry.role === "user"

  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <Bot className="size-4 text-muted-foreground" />
        </div>
      ) : null}
      <div className={cn(
        "max-w-[80%] rounded-md border px-3 py-2 text-sm",
        isUser ? "bg-primary text-primary-foreground" : "bg-background text-foreground",
      )}>
        <p className="whitespace-pre-wrap leading-relaxed">{entry.content}</p>
        <p className={cn(
          "mt-2 text-xs",
          isUser ? "text-primary-foreground/70" : "text-muted-foreground",
        )}>
          {formatDateTime(entry.timestamp)}
        </p>
      </div>
      {isUser ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <User className="size-4 text-muted-foreground" />
        </div>
      ) : null}
    </div>
  )
}

function SessionListItem({
  session,
  selected,
  onSelect,
}: {
  session: SynapseAgentSessionSummary
  selected: boolean
  onSelect: (session: SynapseAgentSessionSummary) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(session)}
      className={cn(
        "w-full rounded-md border p-3 text-left transition-colors",
        selected ? "border-primary bg-muted" : "border-border bg-background hover:bg-muted",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{sessionTitle(session)}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
            {previewContent(session.lastMessage)}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDateTime(session.updatedAt || session.createdAt)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{session.projectName}</Badge>
        <Badge variant="outline">{session.platform || "-"}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">{session.historyCount}</span>
      </div>
    </button>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

function AgentSessionsModule() {
  const { config, isReady } = useAppConfig()
  const [sessions, setSessions] = useState<SynapseAgentSessionSummary[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [detail, setDetail] = useState<SynapseAgentSessionDetail | null>(null)
  const [loading, setLoading] = useState(!isReady)
  const [detailLoading, setDetailLoading] = useState(false)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [pendingMessage, setPendingMessage] = useState<SynapseSessionHistoryEntry | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const projects = config.global.projects
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === detail?.projectId) ?? projects[0] ?? null,
    [detail?.projectId, projects],
  )

  const loadDetail = useCallback(async (session: SynapseAgentSessionSummary) => {
    setSelectedId(session.id)
    setDetailLoading(true)
    setError(null)
    try {
      const nextDetail = await requireBridgeDomain("agentSessions").getDetail({
        projectId: session.projectId,
        sessionId: session.id,
        historyLimit: 200,
      })
      setDetail(nextDetail)
    } catch (loadError) {
      logger.error("Failed to load agent session detail.", loadError)
      setError(loadError instanceof Error ? loadError.message : "读取会话失败。")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await requireBridgeDomain("agentSessions").list()
      setSessions(result.sessions)
      const nextSelected = result.sessions.find((session) => session.id === selectedId) ?? result.sessions[0] ?? null
      if (nextSelected) {
        await loadDetail(nextSelected)
      } else {
        setSelectedId("")
        setDetail(null)
      }
    } catch (loadError) {
      logger.error("Failed to load agent sessions.", loadError)
      setError(loadError instanceof Error ? loadError.message : "读取会话失败。")
    } finally {
      setLoading(false)
    }
  }, [loadDetail, selectedId])

  const createSession = useCallback(async () => {
    const project = selectedProject ?? projects[0] ?? null
    if (!project) {
      return
    }

    setDetailLoading(true)
    setError(null)
    try {
      const created = await requireBridgeDomain("agentSessions").create({
        projectId: project.id,
        sessionKey: defaultSessionKey(project.name),
      })
      const result = await requireBridgeDomain("agentSessions").list()
      setSessions(result.sessions)
      setSelectedId(created.id)
      setDetail(created)
    } catch (createError) {
      logger.error("Failed to create agent session.", createError)
      setError(createError instanceof Error ? createError.message : "创建会话失败。")
    } finally {
      setDetailLoading(false)
    }
  }, [projects, selectedProject])

  const handleSend = useCallback(async () => {
    if (!detail || sending) {
      return
    }

    const content = input.trim()
    if (!content) {
      return
    }

    const optimisticMessage: SynapseSessionHistoryEntry = {
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    }

    setInput("")
    setSending(true)
    setSendError(null)
    setPendingMessage(optimisticMessage)

    try {
      const result = await requireBridgeDomain("agentSessions").send({
        projectId: detail.projectId,
        sessionId: detail.id,
        sessionKey: detail.sessionKey,
        message: content,
      })
      const list = await requireBridgeDomain("agentSessions").list()
      setSessions(list.sessions)
      setSelectedId(result.session.id)
      setDetail(result.session)
      if (result.status === "error" || result.status === "timed_out") {
        setInput(content)
        setSendError(result.error ?? "发送失败。")
      }
    } catch (sendFailure) {
      logger.error("Failed to send agent session message.", sendFailure)
      setInput(content)
      setSendError(sendFailure instanceof Error ? sendFailure.message : "发送失败。")
    } finally {
      setPendingMessage(null)
      setSending(false)
    }
  }, [detail, input, sending])

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }, [handleSend])

  useEffect(() => {
    if (!isReady) {
      return
    }

    void refresh()
  }, [isReady, refresh])

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto bg-muted/30 p-4" data-module="agent-sessions">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">会话</h1>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" onClick={refresh} disabled={loading}>
            <RefreshCw data-icon="inline-start" className={cn("size-4", loading ? "animate-spin" : "")} />
          </Button>
          <Button type="button" onClick={createSession} disabled={!projects.length || detailLoading}>
            <Plus data-icon="inline-start" className="size-4" />
            新会话
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
        <Card className="min-h-0">
          <CardHeader>
            <CardTitle>列表</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0">
            {loading ? (
              <LoadingState />
            ) : sessions.length === 0 ? (
              <Empty className="min-h-48">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessageSquare />
                  </EmptyMedia>
                  <EmptyTitle>暂无会话</EmptyTitle>
                  <EmptyDescription>先新建一个项目会话。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ScrollArea className="h-[calc(100vh-18rem)] pr-3">
                <div className="flex flex-col gap-2">
                  {sessions.map((session) => (
                    <SessionListItem
                      key={`${session.projectId}:${session.id}`}
                      session={session}
                      selected={session.id === selectedId}
                      onSelect={loadDetail}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="min-h-0">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>{detail ? sessionTitle(detail) : "消息"}</CardTitle>
                {detail ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{detail.projectName}</Badge>
                    <Badge variant="outline">{detail.platform || "-"}</Badge>
                    {detail.active ? <Badge>当前</Badge> : null}
                  </div>
                ) : null}
              </div>
              {detail ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {detail.historyCount}
                </span>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-col gap-3">
            <div className="min-h-0 flex-1">
              {detailLoading ? (
                <LoadingState />
              ) : !detail ? (
                <Empty className="min-h-64">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageSquare />
                    </EmptyMedia>
                    <EmptyTitle>选择会话</EmptyTitle>
                    <EmptyDescription>从左侧打开消息历史。</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : detail.history.length === 0 && !pendingMessage ? (
                <Empty className="min-h-64">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageSquare />
                    </EmptyMedia>
                    <EmptyTitle>暂无消息</EmptyTitle>
                    <EmptyDescription>当前会话还没有消息。</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ScrollArea className="h-[calc(100vh-22rem)] pr-4">
                  <div className="flex flex-col gap-4">
                    {detail.history.map((entry, index) => (
                      <HistoryMessage key={`${entry.timestamp}:${index}`} entry={entry} />
                    ))}
                    {pendingMessage ? <HistoryMessage entry={pendingMessage} /> : null}
                  </div>
                </ScrollArea>
              )}
            </div>
            {detail ? (
              <form
                className="flex items-end gap-2 border-t pt-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleSend()
                }}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {sendError ? (
                    <p className="text-sm text-destructive">{sendError}</p>
                  ) : null}
                  <Textarea
                    value={input}
                    onChange={(event) => {
                      setInput(event.currentTarget.value)
                      setSendError(null)
                    }}
                    onKeyDown={handleInputKeyDown}
                    placeholder="输入消息"
                    disabled={sending}
                    rows={3}
                  />
                </div>
                <Button type="submit" size="icon-lg" disabled={sending || !input.trim()}>
                  {sending ? (
                    <Loader2 data-icon="inline-start" className="size-4 animate-spin" />
                  ) : (
                    <Send data-icon="inline-start" className="size-4" />
                  )}
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

export { MessageRenderer } from "./components/message-renderer"
export {
  collectRichCardInteractions,
  renderRichCardFallback,
  resolveInteractionDispatch,
  richCardHasInteractions,
  toRenderableMessage,
} from "./message-interactions"
export { AgentSessionsModule }
