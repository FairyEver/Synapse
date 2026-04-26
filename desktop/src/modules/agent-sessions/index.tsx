import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react"
import { Bot, Brain, Check, Copy, Loader2, MessageSquare, Plus, RefreshCw, Send, Slash, Terminal, User, Wrench, X } from "lucide-react"
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
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { formatDateTime } from "@/lib/date-time"
import { cn } from "@/lib/utils"
import type {
  SynapseAgentSessionEventRecord,
  SynapseAgentSessionDetail,
  SynapseAgentSessionSummary,
  SynapseCommandCatalogItem,
  SynapseCommandExecutionResult,
  SynapseCommandGroup,
  SynapseMessageInteraction,
  SynapsePendingPermission,
  SynapseSessionMessage,
  SynapseSessionHistoryEntry,
} from "@/types/agent-session"
import { MessageRenderer } from "./components/message-renderer"

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

function payloadString(record: SynapseAgentSessionEventRecord, key: string): string {
  const value = record.payload[key]
  return typeof value === "string" ? value : ""
}

function payloadNumber(record: SynapseAgentSessionEventRecord, key: string): number | null {
  const value = record.payload[key]
  return typeof value === "number" ? value : null
}

function payloadBoolean(record: SynapseAgentSessionEventRecord, key: string): boolean | null {
  const value = record.payload[key]
  return typeof value === "boolean" ? value : null
}

function toolCodeLanguage(toolName: string, content: string): string {
  if (["shell", "run_shell_command", "Bash"].includes(toolName)) {
    return "bash"
  }
  if (content.includes("\n- ") && content.includes("\n+ ")) {
    return "diff"
  }
  return "text"
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(code)
  }, [code])

  return (
    <div className="overflow-hidden rounded-md border bg-muted">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="text-xs text-muted-foreground">{language || "text"}</span>
        <Button type="button" variant="ghost" size="icon-sm" onClick={copy} aria-label="复制">
          <Copy className="size-3.5" />
        </Button>
      </div>
      <pre className="max-h-80 overflow-auto p-3 text-xs leading-relaxed">
        <code>{code || "无输出"}</code>
      </pre>
    </div>
  )
}

function MarkdownContent({ content }: { content: string }) {
  const blocks: Array<{ type: "text" | "code"; content: string; language?: string }> = []
  const fence = /```([A-Za-z0-9_-]*)\n([\s\S]*?)```/gu
  let cursor = 0
  let match = fence.exec(content)

  while (match) {
    if (match.index > cursor) {
      blocks.push({ type: "text", content: content.slice(cursor, match.index) })
    }
    blocks.push({
      type: "code",
      language: match[1] || "text",
      content: match[2] ?? "",
    })
    cursor = match.index + match[0].length
    match = fence.exec(content)
  }

  if (cursor < content.length || blocks.length === 0) {
    blocks.push({ type: "text", content: content.slice(cursor) || content })
  }

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => block.type === "code" ? (
        <CodeBlock key={`${block.type}:${index}`} code={block.content} language={block.language} />
      ) : (
        <p key={`${block.type}:${index}`} className="whitespace-pre-wrap text-sm leading-relaxed">
          {block.content}
        </p>
      ))}
    </div>
  )
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
        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed">{entry.content}</p>
        ) : (
          <MarkdownContent content={entry.content} />
        )}
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

function eventTitle(record: SynapseAgentSessionEventRecord): string {
  switch (record.type) {
    case "thinking":
      return "思考"
    case "tool_use":
      return payloadString(record, "toolName") || "工具调用"
    case "tool_result":
      return payloadString(record, "toolName") || "工具结果"
    case "permission_request":
      return "权限请求"
    case "permission_response":
      return "权限响应"
    case "result":
      return "完成"
    case "error":
      return "错误"
    case "text":
      return "回复"
  }
}

function eventIcon(record: SynapseAgentSessionEventRecord) {
  switch (record.type) {
    case "thinking":
      return <Brain className="size-4" />
    case "tool_use":
    case "tool_result":
      return <Wrench className="size-4" />
    case "permission_request":
    case "permission_response":
      return <Check className="size-4" />
    case "error":
      return <X className="size-4" />
    case "result":
    case "text":
      return <Terminal className="size-4" />
  }
}

function PermissionEventCard({
  record,
  pending,
  onDecision,
}: {
  record: SynapseAgentSessionEventRecord
  pending: boolean
  onDecision: (record: SynapseAgentSessionEventRecord, decision: "allow" | "deny") => void
}) {
  const toolName = payloadString(record, "toolName") || "tool"
  const toolInput = payloadString(record, "toolInput")
  const message: SynapseSessionMessage = {
    id: `${record.sessionId}:${record.seq}`,
    sessionId: record.sessionId,
    role: "assistant",
    content: "",
    createdAt: record.timestamp,
    card: {
      header: { title: "权限请求" },
      elements: [
        { type: "markdown", content: `**${toolName}**\n\n${toolInput || "无输入"}` },
        {
          type: "actions",
          buttons: [
            { text: "允许", type: "primary", value: "perm:allow" },
            { text: "拒绝", type: "danger", value: "perm:deny" },
          ],
        },
      ],
    },
  }

  const handleInteraction = (interaction: SynapseMessageInteraction) => {
    if (!pending || interaction.kind !== "button") {
      return
    }
    if (interaction.value === "perm:allow") {
      onDecision(record, "allow")
    }
    if (interaction.value === "perm:deny") {
      onDecision(record, "deny")
    }
  }

  return (
    <div className={cn(!pending && "pointer-events-none opacity-70")}>
      <MessageRenderer message={message} onInteraction={handleInteraction} />
    </div>
  )
}

function EventRecordItem({
  record,
  pendingPermission,
  onPermissionDecision,
}: {
  record: SynapseAgentSessionEventRecord
  pendingPermission: SynapsePendingPermission | null
  onPermissionDecision: (record: SynapseAgentSessionEventRecord, decision: "allow" | "deny") => void
}) {
  const toolName = payloadString(record, "toolName")
  const toolInput = payloadString(record, "toolInput")
  const toolResult = payloadString(record, "toolResult")
  const content = payloadString(record, "content")
  const error = payloadString(record, "error")
  const status = payloadString(record, "toolStatus")
  const exitCode = payloadNumber(record, "toolExitCode")
  const success = payloadBoolean(record, "toolSuccess")
  const requestId = payloadString(record, "requestId")
  const isPendingPermission = record.type === "permission_request"
    && pendingPermission?.requestId === requestId

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground">{eventIcon(record)}</span>
          <span className="truncate">{eventTitle(record)}</span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">#{record.seq}</span>
      </div>
      {record.type === "thinking" || record.type === "text" || record.type === "result" ? (
        <MarkdownContent content={content} />
      ) : null}
      {record.type === "tool_use" ? (
        <CodeBlock code={toolInput} language={toolCodeLanguage(toolName, toolInput)} />
      ) : null}
      {record.type === "tool_result" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {status ? <Badge variant="outline">{status}</Badge> : null}
            {exitCode !== null ? <Badge variant="secondary">exit {exitCode}</Badge> : null}
            {success !== null ? <Badge variant={success ? "secondary" : "destructive"}>{success ? "ok" : "failed"}</Badge> : null}
          </div>
          <CodeBlock code={toolResult} language="text" />
        </div>
      ) : null}
      {record.type === "permission_request" ? (
        <PermissionEventCard record={record} pending={isPendingPermission} onDecision={onPermissionDecision} />
      ) : null}
      {record.type === "permission_response" ? (
        <Badge variant={payloadString(record, "decision") === "allow" ? "secondary" : "destructive"}>
          {payloadString(record, "decision") === "allow" ? "允许" : "拒绝"}
        </Badge>
      ) : null}
      {record.type === "error" ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">{formatDateTime(record.timestamp)}</p>
    </div>
  )
}

function EventStream({
  events,
  pendingPermission,
  onPermissionDecision,
}: {
  events: SynapseAgentSessionEventRecord[]
  pendingPermission: SynapsePendingPermission | null
  onPermissionDecision: (record: SynapseAgentSessionEventRecord, decision: "allow" | "deny") => void
}) {
  if (events.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">事件</h2>
        <Badge variant="outline">{events.length}</Badge>
      </div>
      <div className="flex flex-col gap-3">
        {events.map((record) => (
          <EventRecordItem
            key={`${record.sessionId}:${record.seq}`}
            record={record}
            pendingPermission={pendingPermission}
            onPermissionDecision={onPermissionDecision}
          />
        ))}
      </div>
    </div>
  )
}

const commandGroupLabels: Record<SynapseCommandGroup, string> = {
  session: "会话",
  settings: "设置",
  info: "信息",
  advanced: "高级",
}

const commandGroupOrder: SynapseCommandGroup[] = ["session", "settings", "info", "advanced"]

function commandStatusLabel(status: SynapseCommandExecutionResult["status"]): string {
  switch (status) {
    case "completed":
      return "完成"
    case "error":
      return "失败"
    case "permission_required":
      return "待确认"
    case "denied":
      return "已拒绝"
  }
}

function CommandPalette({
  open,
  commands,
  loading,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  commands: SynapseCommandCatalogItem[]
  loading: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (command: SynapseCommandCatalogItem) => void
}) {
  const grouped = useMemo(
    () => commandGroupOrder.map((group) => ({
      group,
      commands: commands.filter((command) => command.group === group),
    })).filter((entry) => entry.commands.length > 0),
    [commands],
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="命令"
      description="搜索命令"
      data-track="agent-session-command-palette"
    >
      <CommandInput placeholder="搜索命令" />
      <CommandList>
        <CommandEmpty>{loading ? "加载中" : "没有命令"}</CommandEmpty>
        {grouped.map((entry) => (
          <CommandGroup key={entry.group} heading={commandGroupLabels[entry.group]}>
            {entry.commands.map((command) => (
              <CommandItem
                key={command.id}
                value={`${command.command} ${command.title} ${command.description} ${command.aliases.join(" ")}`}
                disabled={command.disabled}
                onSelect={() => onSelect(command)}
                data-track={`agent-command-${command.id}`}
              >
                <Slash className="size-4 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{command.command}</span>
                    <span className="truncate text-muted-foreground">{command.title}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{command.description}</p>
                </div>
                {command.highRisk ? <Badge variant="outline">确认</Badge> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}

function CommandResultSheet({
  result,
  busy,
  onOpenChange,
  onPermissionDecision,
}: {
  result: SynapseCommandExecutionResult | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onPermissionDecision: (decision: "allow" | "deny") => void
}) {
  return (
    <Sheet open={Boolean(result)} onOpenChange={onOpenChange} data-track="agent-command-result">
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{result?.title ?? "命令"}</SheetTitle>
          <SheetDescription>{result?.command ?? ""}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-4">
          {result ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={result.status === "error" ? "destructive" : "secondary"}>
                  {commandStatusLabel(result.status)}
                </Badge>
                {result.requiresPermission ? <Badge variant="outline">需要确认</Badge> : null}
              </div>
              {result.format === "markdown" ? (
                <MarkdownContent content={result.content} />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.content}</p>
              )}
              {result.error ? <p className="text-sm text-destructive">{result.error}</p> : null}
            </div>
          ) : null}
        </div>
        {result?.requiresPermission ? (
          <SheetFooter>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => onPermissionDecision("deny")}>
                拒绝
              </Button>
              <Button type="button" disabled={busy} onClick={() => onPermissionDecision("allow")}>
                {busy ? <Loader2 data-icon="inline-start" className="size-4 animate-spin" /> : null}
                继续
              </Button>
            </div>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
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
  const [eventsBySession, setEventsBySession] = useState<Record<string, SynapseAgentSessionEventRecord[]>>({})
  const [pendingPermissions, setPendingPermissions] = useState<Record<string, SynapsePendingPermission | null>>({})
  const [permissionBusy, setPermissionBusy] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commands, setCommands] = useState<SynapseCommandCatalogItem[]>([])
  const [commandLoading, setCommandLoading] = useState(false)
  const [commandResult, setCommandResult] = useState<SynapseCommandExecutionResult | null>(null)
  const [commandBusy, setCommandBusy] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const projects = config.global.projects
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === detail?.projectId) ?? projects[0] ?? null,
    [detail?.projectId, projects],
  )
  const currentEvents = detail ? eventsBySession[detail.id] ?? [] : []
  const currentPendingPermission = detail ? pendingPermissions[detail.id] ?? null : null

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

  const loadCommands = useCallback(async () => {
    const project = detail ? projects.find((item) => item.id === detail.projectId) : selectedProject
    if (!project) {
      setCommands([])
      return
    }

    setCommandLoading(true)
    try {
      const result = await requireBridgeDomain("agentSessions").listCommands({
        projectId: project.id,
      })
      setCommands(result.commands)
    } catch (loadError) {
      logger.error("Failed to load agent commands.", loadError)
      setSendError(loadError instanceof Error ? loadError.message : "读取命令失败。")
    } finally {
      setCommandLoading(false)
    }
  }, [detail, projects, selectedProject])

  const openCommandPalette = useCallback(() => {
    setCommandOpen(true)
    void loadCommands()
  }, [loadCommands])

  const applyCommandResult = useCallback(async (result: SynapseCommandExecutionResult) => {
    setCommandResult(result)
    if (result.session) {
      const list = await requireBridgeDomain("agentSessions").list()
      setSessions(list.sessions)
      setSelectedId(result.session.id)
      setDetail(result.session)
    }
  }, [])

  const executeCommand = useCallback(async (
    command: string,
    permissionDecision?: "allow" | "deny",
  ) => {
    if (!detail || commandBusy) {
      return
    }

    setCommandBusy(true)
    setSendError(null)
    try {
      const result = await requireBridgeDomain("agentSessions").executeCommand({
        projectId: detail.projectId,
        sessionId: detail.id,
        sessionKey: detail.sessionKey,
        command,
        ...(permissionDecision ? { permissionDecision } : undefined),
      })
      await applyCommandResult(result)
    } catch (executeError) {
      logger.error("Failed to execute agent command.", executeError)
      setSendError(executeError instanceof Error ? executeError.message : "命令执行失败。")
    } finally {
      setCommandBusy(false)
    }
  }, [applyCommandResult, commandBusy, detail])

  const handleCommandSelect = useCallback((command: SynapseCommandCatalogItem) => {
    setCommandOpen(false)
    void executeCommand(command.command)
  }, [executeCommand])

  const handleCommandPermissionDecision = useCallback((decision: "allow" | "deny") => {
    if (!commandResult) {
      return
    }
    void executeCommand(commandResult.command, decision)
  }, [commandResult, executeCommand])

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
      setEventsBySession((current) => ({
        ...current,
        [result.session.id]: result.events,
      }))
      setPendingPermissions((current) => ({
        ...current,
        [result.session.id]: result.pendingPermission,
      }))
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

  const handlePermissionDecision = useCallback(async (
    record: SynapseAgentSessionEventRecord,
    decision: "allow" | "deny",
  ) => {
    if (!detail || permissionBusy) {
      return
    }

    const requestId = payloadString(record, "requestId")
    if (!requestId) {
      setSendError("权限请求缺少 request id。")
      return
    }

    setPermissionBusy(true)
    setSendError(null)
    try {
      const result = await requireBridgeDomain("agentSessions").respondPermission({
        projectId: detail.projectId,
        sessionId: detail.id,
        requestId,
        decision,
      })
      setEventsBySession((current) => ({
        ...current,
        [detail.id]: [...(current[detail.id] ?? []), result.event],
      }))
      setPendingPermissions((current) => ({
        ...current,
        [detail.id]: result.pendingPermission,
      }))
    } catch (respondError) {
      logger.error("Failed to respond to agent permission request.", respondError)
      setSendError(respondError instanceof Error ? respondError.message : "权限响应失败。")
    } finally {
      setPermissionBusy(false)
    }
  }, [detail, permissionBusy])

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "/" && input.trim() === "") {
      event.preventDefault()
      openCommandPalette()
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }, [handleSend, input, openCommandPalette])

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
              ) : detail.history.length === 0 && !pendingMessage && currentEvents.length === 0 ? (
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
                    <EventStream
                      events={currentEvents}
                      pendingPermission={currentPendingPermission}
                      onPermissionDecision={handlePermissionDecision}
                    />
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
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  onClick={openCommandPalette}
                  disabled={sending || permissionBusy || commandBusy}
                  aria-label="命令"
                >
                  <Slash data-icon="inline-start" className="size-4" />
                </Button>
                <Button type="submit" size="icon-lg" disabled={sending || permissionBusy || !input.trim()}>
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
      <CommandPalette
        open={commandOpen}
        commands={commands}
        loading={commandLoading}
        onOpenChange={setCommandOpen}
        onSelect={handleCommandSelect}
      />
      <CommandResultSheet
        result={commandResult}
        busy={commandBusy}
        onOpenChange={(open) => {
          if (!open) {
            setCommandResult(null)
          }
        }}
        onPermissionDecision={handleCommandPermissionDecision}
      />
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
