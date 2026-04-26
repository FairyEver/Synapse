import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseAgentPendingPermission,
  SynapseAgentPublishedCommand,
  SynapseAgentProviderState,
  SynapseAgentSessionSummary,
  SynapseAgentStatus,
  SynapseAgentTimelineEntry,
} from "@/types/agent"
import {
  DEFAULT_LOCAL_SESSION_KEY,
  agentEventToTimelineEntry,
  defaultSessionId,
  defaultSessionKey,
  localUserTimelineEntry,
} from "../utils"

const logger = createRendererLogger("agent")

type UseAgentChatState = {
  sessions: SynapseAgentSessionSummary[]
  timeline: SynapseAgentTimelineEntry[]
  pendingPermissions: SynapseAgentPendingPermission[]
  status: SynapseAgentStatus | null
  providers: SynapseAgentProviderState | null
  commands: SynapseAgentPublishedCommand[]
  selectedConversationId?: string
  selectedSessionKey: string
  activityLabel: string | null
  loading: boolean
  sending: boolean
  error: string | null
  createSession: () => Promise<void>
  selectSession: (conversationId: string) => Promise<void>
  deleteSession: (conversationId: string) => Promise<void>
  refresh: () => Promise<void>
  sendMessage: (content: string) => Promise<void>
  respondPermission: (requestId: string, behavior: "allow" | "deny") => Promise<void>
}

function useAgentChat(projectId: string | undefined): UseAgentChatState {
  const [sessions, setSessions] = useState<SynapseAgentSessionSummary[]>([])
  const [timeline, setTimeline] = useState<SynapseAgentTimelineEntry[]>([])
  const [pendingPermissions, setPendingPermissions] = useState<SynapseAgentPendingPermission[]>([])
  const [status, setStatus] = useState<SynapseAgentStatus | null>(null)
  const [providers, setProviders] = useState<SynapseAgentProviderState | null>(null)
  const [commands, setCommands] = useState<SynapseAgentPublishedCommand[]>([])
  const [selectedConversationId, setSelectedConversationIdRaw] = useState<string | undefined>()
  const [selectedSessionKey, setSelectedSessionKeyRaw] = useState(DEFAULT_LOCAL_SESSION_KEY)
  const [activityLabel, setActivityLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeSendCount, setActiveSendCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const selectedConversationIdRef = useRef<string | undefined>(selectedConversationId)
  const selectedSessionKeyRef = useRef(selectedSessionKey)
  selectedConversationIdRef.current = selectedConversationId
  selectedSessionKeyRef.current = selectedSessionKey

  const loadTimeline = useCallback(async (target: {
    readonly sessionKey: string
    readonly conversationId?: string
  }) => {
    if (!projectId) {
      setTimeline([])
      return
    }
    const bridge = requireSynapseBridge()
    const result = await bridge.agent.getTimeline({
      projectId,
      sessionKey: target.sessionKey,
      conversationId: target.conversationId,
      limit: 100,
    })
    setTimeline(result.entries)
  }, [projectId])

  const refreshPendingPermissions = useCallback(async () => {
    if (!projectId) {
      setPendingPermissions([])
      return
    }
    const bridge = requireSynapseBridge()
    setPendingPermissions(await bridge.agent.listPendingPermissions(projectId))
  }, [projectId])

  const refresh = useCallback(async () => {
    if (!projectId) {
      return
    }
    const bridge = requireSynapseBridge()
    setLoading(true)
    setError(null)
    try {
      const [nextStatus, nextSessions, nextProviders, nextPending, nextCommands] = await Promise.all([
        bridge.agent.status(projectId),
        bridge.agent.listSessions(projectId),
        bridge.agent.getProviders(projectId),
        bridge.agent.listPendingPermissions(projectId),
        bridge.agent.listCommands(projectId),
      ])
      const currentConversationId = selectedConversationIdRef.current
      const nextConversationId = currentConversationId
        && nextSessions.some((session) => session.id === currentConversationId)
        ? currentConversationId
        : defaultSessionId(nextSessions)
      const nextSessionKey = nextSessions.find((session) => session.id === nextConversationId)?.sessionKey
        ?? defaultSessionKey(nextSessions)
      setStatus(nextStatus)
      setSessions(nextSessions)
      setProviders(nextProviders)
      setPendingPermissions(nextPending)
      setCommands(nextCommands)
      selectedConversationIdRef.current = nextConversationId
      selectedSessionKeyRef.current = nextSessionKey
      setSelectedConversationIdRaw(nextConversationId)
      setSelectedSessionKeyRaw(nextSessionKey)
      await loadTimeline({ sessionKey: nextSessionKey, conversationId: nextConversationId })
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "加载失败"
      logger.error("Agent refresh failed.", rawError)
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [loadTimeline, projectId])

  const createSession = useCallback(async () => {
    if (!projectId) return
    const bridge = requireSynapseBridge()
    setError(null)
    try {
      const session = await bridge.agent.createSession({
        projectId,
        sessionKey: DEFAULT_LOCAL_SESSION_KEY,
        name: `新会话 ${formatSessionNameTime(new Date())}`,
      })
      selectedConversationIdRef.current = session.id
      selectedSessionKeyRef.current = session.sessionKey
      setSessions((current) => [session, ...current.map((item) => ({ ...item, active: false }))])
      setSelectedConversationIdRaw(session.id)
      setSelectedSessionKeyRaw(session.sessionKey)
      setTimeline([])
      toast("新会话已创建")
      await refresh()
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "创建失败"
      logger.error("Agent session create failed.", rawError)
      setError(message)
    }
  }, [projectId, refresh])

  const selectSession = useCallback(async (conversationId: string) => {
    if (!projectId) return
    const target = sessions.find((session) => session.id === conversationId)
    if (!target) return
    const bridge = requireSynapseBridge()
    setError(null)
    try {
      const session = await bridge.agent.switchSession({
        projectId,
        sessionKey: target.sessionKey,
        conversationId: target.id,
      })
      selectedConversationIdRef.current = session.id
      selectedSessionKeyRef.current = session.sessionKey
      setSelectedConversationIdRaw(session.id)
      setSelectedSessionKeyRaw(session.sessionKey)
      setSessions((current) => current.map((session) => ({
        ...session,
        active: session.id === target.id,
      })))
      await loadTimeline({ sessionKey: session.sessionKey, conversationId: session.id })
    } catch (rawError) {
      logger.error("Agent session switch failed.", rawError)
      setError(rawError instanceof Error ? rawError.message : "切换失败")
    }
  }, [loadTimeline, projectId, sessions])

  const sendMessage = useCallback(async (content: string) => {
    if (!projectId) return
    const trimmed = content.trim()
    if (!trimmed) return
    const bridge = requireSynapseBridge()
    const sessionKey = sessions.find((session) => session.id === selectedConversationIdRef.current)?.sessionKey
      ?? selectedSessionKeyRef.current
    const now = new Date().toISOString()
    setTimeline((current) => [
      ...current,
      localUserTimelineEntry(trimmed, now, current.length),
    ])
    setActiveSendCount((count) => count + 1)
    setActivityLabel("等待 Agent")
    setError(null)
    try {
      await bridge.agent.send({
        projectId,
        sessionKey,
        content: trimmed,
      })
      await refresh()
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "发送失败"
      logger.error("Agent send failed.", rawError)
      setError(message)
    } finally {
      setActiveSendCount((count) => Math.max(0, count - 1))
      setActivityLabel(null)
    }
  }, [projectId, refresh, sessions])

  const deleteSession = useCallback(async (conversationId: string) => {
    if (!projectId) return
    const bridge = requireSynapseBridge()
    const remaining = sessions.filter((session) => session.id !== conversationId)
    setError(null)
    try {
      const result = await bridge.agent.deleteSession({ projectId, conversationId })
      if (!result.ok) {
        setError("会话不存在")
        return
      }
      if (selectedConversationIdRef.current === conversationId) {
        const next = remaining[0]
        if (next) {
          const session = await bridge.agent.switchSession({
            projectId,
            sessionKey: next.sessionKey,
            conversationId: next.id,
          })
          selectedConversationIdRef.current = session.id
          selectedSessionKeyRef.current = session.sessionKey
          setSelectedConversationIdRaw(session.id)
          setSelectedSessionKeyRaw(session.sessionKey)
        } else {
          selectedConversationIdRef.current = undefined
          selectedSessionKeyRef.current = DEFAULT_LOCAL_SESSION_KEY
          setSelectedConversationIdRaw(undefined)
          setSelectedSessionKeyRaw(DEFAULT_LOCAL_SESSION_KEY)
          setTimeline([])
        }
      }
      toast("会话已删除")
      await refresh()
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "删除失败"
      logger.error("Agent session delete failed.", rawError)
      setError(message)
    }
  }, [projectId, refresh, sessions])

  const respondPermission = useCallback(async (
    requestId: string,
    behavior: "allow" | "deny",
  ) => {
    if (!projectId) return
    const bridge = requireSynapseBridge()
    setError(null)
    try {
      await bridge.agent.respondPermission({ projectId, requestId, behavior })
      await refreshPendingPermissions()
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "处理失败"
      logger.error("Agent permission response failed.", rawError)
      setError(message)
    }
  }, [projectId, refreshPendingPermissions])

  useEffect(() => {
    if (!projectId) {
      setSessions([])
      setTimeline([])
      setPendingPermissions([])
      setStatus(null)
      setProviders(null)
      setCommands([])
      setSelectedConversationIdRaw(undefined)
      setSelectedSessionKeyRaw(DEFAULT_LOCAL_SESSION_KEY)
      setActivityLabel(null)
      setError(null)
      setLoading(false)
      setActiveSendCount(0)
      return
    }
    void refresh()
  }, [projectId, refresh])

  useEffect(() => {
    if (!projectId) return undefined
    const bridge = requireSynapseBridge()
    return bridge.agent.onEvent((domainEvent) => {
      if (domainEvent.payload.projectId !== projectId) return
      const eventConversationId = domainEvent.scope?.sessionId
      const selectedConversation = selectedConversationIdRef.current
      if (selectedConversation && eventConversationId !== selectedConversation) return
      if (!selectedConversation && domainEvent.payload.sessionKey !== selectedSessionKeyRef.current) return
      setActivityLabel(activityLabelForEvent(domainEvent.payload.event))
      setTimeline((current) => appendAgentEvent(current, domainEvent.payload.event, domainEvent.timestamp))
      void refreshPendingPermissions()
    })
  }, [projectId, refreshPendingPermissions])

  return {
    sessions,
    timeline,
    pendingPermissions,
    status,
    providers,
    commands,
    selectedConversationId,
    selectedSessionKey,
    activityLabel,
    loading,
    sending: activeSendCount > 0,
    error,
    createSession,
    selectSession,
    deleteSession,
    refresh,
    sendMessage,
    respondPermission,
  }
}

export { useAgentChat }

function appendAgentEvent(
  current: readonly SynapseAgentTimelineEntry[],
  event: Parameters<typeof agentEventToTimelineEntry>[0],
  timestamp: string,
): SynapseAgentTimelineEntry[] {
  const entry = agentEventToTimelineEntry(event, timestamp, current.length)
  if (!entry.content.trim()) return [...current]

  const last = current.at(-1)
  if (event.type === "text" && last?.role === "assistant") {
    if (last.content === entry.content || last.content.endsWith(entry.content)) return [...current]
    return [
      ...current.slice(0, -1),
      {
        ...last,
        content: `${last.content}${entry.content}`,
        timestamp,
      },
    ]
  }

  if (event.type === "result" && last?.role === "assistant") {
    if (last.content === entry.content) return [...current]
    return [
      ...current.slice(0, -1),
      {
        ...last,
        content: entry.content,
        timestamp,
      },
    ]
  }

  return [...current, entry]
}

function activityLabelForEvent(
  event: Parameters<typeof agentEventToTimelineEntry>[0],
): string | null {
  switch (event.type) {
    case "thinking":
      return "思考中"
    case "toolUse":
      return `${event.toolName} 运行中`
    case "toolResult":
      return "处理结果"
    case "text":
      return "回复中"
    case "permissionRequest":
      return "等待确认"
    case "result":
    case "error":
      return null
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

function formatSessionNameTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}
