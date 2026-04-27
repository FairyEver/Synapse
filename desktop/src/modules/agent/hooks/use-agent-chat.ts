import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseAgentDomainEvent,
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
import {
  clearConversationUnread,
  incrementUnreadForConversation,
  isSelectedConversation,
  shouldApplyTimelineSnapshot,
  shouldAutoFollowConversation,
  type UnreadState,
} from "../live-sync"

const logger = createRendererLogger("agent")

type UseAgentChatState = {
  sessions: SynapseAgentSessionSummary[]
  timeline: SynapseAgentTimelineEntry[]
  pendingPermissions: SynapseAgentPendingPermission[]
  status: SynapseAgentStatus | null
  providers: SynapseAgentProviderState | null
  commands: SynapseAgentPublishedCommand[]
  followFeishu: boolean
  setFollowFeishu: (follow: boolean) => void
  unreadByConversationId: UnreadState
  selectedConversationId?: string
  selectedSessionKey: string
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

function useAgentChat(
  projectId: string | undefined,
  options: { readonly inputDirty?: boolean } = {},
): UseAgentChatState {
  const [sessions, setSessions] = useState<SynapseAgentSessionSummary[]>([])
  const [timeline, setTimeline] = useState<SynapseAgentTimelineEntry[]>([])
  const [pendingPermissions, setPendingPermissions] = useState<SynapseAgentPendingPermission[]>([])
  const [status, setStatus] = useState<SynapseAgentStatus | null>(null)
  const [providers, setProviders] = useState<SynapseAgentProviderState | null>(null)
  const [commands, setCommands] = useState<SynapseAgentPublishedCommand[]>([])
  const [followFeishu, setFollowFeishuRaw] = useState(false)
  const [unreadByConversationId, setUnreadByConversationId] = useState<UnreadState>({})
  const [selectedConversationId, setSelectedConversationIdRaw] = useState<string | undefined>()
  const [selectedSessionKey, setSelectedSessionKeyRaw] = useState(DEFAULT_LOCAL_SESSION_KEY)
  const [loading, setLoading] = useState(false)
  const [activeSendCount, setActiveSendCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const followFeishuRef = useRef(followFeishu)
  const inputDirtyRef = useRef(options.inputDirty ?? false)
  const selectedConversationIdRef = useRef<string | undefined>(selectedConversationId)
  const selectedSessionKeyRef = useRef(selectedSessionKey)
  const selectRequestIdRef = useRef(0)
  const timelineVersionRef = useRef(0)
  followFeishuRef.current = followFeishu
  inputDirtyRef.current = options.inputDirty ?? false
  selectedConversationIdRef.current = selectedConversationId
  selectedSessionKeyRef.current = selectedSessionKey

  const setFollowFeishu = useCallback((follow: boolean) => {
    followFeishuRef.current = follow
    setFollowFeishuRaw(follow)
  }, [])

  const replaceTimeline = useCallback((entries: SynapseAgentTimelineEntry[]) => {
    timelineVersionRef.current += 1
    setTimeline(entries)
  }, [])

  const updateTimeline = useCallback((
    updater: (current: SynapseAgentTimelineEntry[]) => SynapseAgentTimelineEntry[],
  ) => {
    timelineVersionRef.current += 1
    setTimeline(updater)
  }, [])

  const clearTimeline = useCallback(() => {
    replaceTimeline([])
  }, [replaceTimeline])

  const loadTimeline = useCallback(async (target: {
    readonly sessionKey: string
    readonly conversationId?: string
  }) => {
    if (!projectId) {
      clearTimeline()
      return
    }
    const bridge = requireSynapseBridge()
    const capturedVersion = timelineVersionRef.current
    const result = await bridge.agent.getTimeline({
      projectId,
      sessionKey: target.sessionKey,
      conversationId: target.conversationId,
      limit: 100,
    })
    if (!shouldApplyTimelineSnapshot(target, {
      conversationId: selectedConversationIdRef.current,
      sessionKey: selectedSessionKeyRef.current,
    }, {
      capturedVersion,
      currentVersion: timelineVersionRef.current,
    })) {
      return
    }
    replaceTimeline(result.entries)
  }, [clearTimeline, projectId, replaceTimeline])

  const refreshPendingPermissions = useCallback(async () => {
    if (!projectId) {
      setPendingPermissions([])
      return
    }
    const bridge = requireSynapseBridge()
    setPendingPermissions(await bridge.agent.listPendingPermissions(projectId))
  }, [projectId])

  const refreshConversationSnapshot = useCallback(async (_target: {
    readonly sessionKey: string
    readonly conversationId: string
  }) => {
    if (!projectId) {
      return
    }
    const bridge = requireSynapseBridge()
    try {
      const [nextSessions, nextPending] = await Promise.all([
        bridge.agent.listSessions(projectId),
        bridge.agent.listPendingPermissions(projectId),
      ])
      setSessions(nextSessions)
      setPendingPermissions(nextPending)
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "刷新会话失败"
      logger.error("Agent conversation refresh failed.", rawError)
      setError(message)
    }
  }, [projectId])

  const refresh = useCallback(async () => {
    if (!projectId) {
      return
    }
    selectRequestIdRef.current += 1
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
    const requestId = selectRequestIdRef.current + 1
    selectRequestIdRef.current = requestId
    const bridge = requireSynapseBridge()
    setError(null)
    try {
      const session = await bridge.agent.createSession({
        projectId,
        sessionKey: DEFAULT_LOCAL_SESSION_KEY,
        name: `新会话 ${formatSessionNameTime(new Date())}`,
      })
      if (requestId !== selectRequestIdRef.current) {
        setSessions((current) => current.some((item) => item.id === session.id)
          ? current
          : [{ ...session, active: false }, ...current])
        toast("新会话已创建")
        return
      }
      selectedConversationIdRef.current = session.id
      selectedSessionKeyRef.current = session.sessionKey
      setSessions((current) => [session, ...current.map((item) => ({ ...item, active: false }))])
      setSelectedConversationIdRaw(session.id)
      setSelectedSessionKeyRaw(session.sessionKey)
      setUnreadByConversationId((current) => clearConversationUnread(current, session.id))
      clearTimeline()
      toast("新会话已创建")
      await refresh()
    } catch (rawError) {
      if (requestId !== selectRequestIdRef.current) {
        return
      }
      const message = rawError instanceof Error ? rawError.message : "创建失败"
      logger.error("Agent session create failed.", rawError)
      setError(message)
    }
  }, [clearTimeline, projectId, refresh])

  const selectSession = useCallback(async (conversationId: string) => {
    if (!projectId) return
    const target = sessions.find((session) => session.id === conversationId)
    if (!target) return
    const bridge = requireSynapseBridge()
    const requestId = selectRequestIdRef.current + 1
    selectRequestIdRef.current = requestId
    setError(null)
    try {
      const session = await bridge.agent.switchSession({
        projectId,
        sessionKey: target.sessionKey,
        conversationId: target.id,
      })
      if (requestId !== selectRequestIdRef.current) {
        return
      }
      selectedConversationIdRef.current = session.id
      selectedSessionKeyRef.current = session.sessionKey
      setSelectedConversationIdRaw(session.id)
      setSelectedSessionKeyRaw(session.sessionKey)
      setUnreadByConversationId((current) => clearConversationUnread(current, session.id))
      setSessions((current) => current.map((session) => ({
        ...session,
        active: session.id === target.id,
      })))
      await loadTimeline({ sessionKey: session.sessionKey, conversationId: session.id })
    } catch (rawError) {
      if (requestId !== selectRequestIdRef.current) {
        return
      }
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
    updateTimeline((current) => [
      ...current,
      localUserTimelineEntry(trimmed, now, current.length),
    ])
    setActiveSendCount((count) => count + 1)
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
    }
  }, [projectId, refresh, sessions, updateTimeline])

  const deleteSession = useCallback(async (conversationId: string) => {
    if (!projectId) return
    const requestId = selectRequestIdRef.current + 1
    selectRequestIdRef.current = requestId
    const bridge = requireSynapseBridge()
    const remaining = sessions.filter((session) => session.id !== conversationId)
    const deletedSessionKey = sessions.find((session) => session.id === conversationId)?.sessionKey
      ?? DEFAULT_LOCAL_SESSION_KEY
    let resetUnreadAfterDelete = false
    setError(null)
    try {
      const result = await bridge.agent.deleteSession({ projectId, conversationId })
      if (requestId !== selectRequestIdRef.current) {
        if (result.ok) {
          setUnreadByConversationId((current) => clearConversationUnread(current, conversationId))
          toast("会话已删除")
          void refreshConversationSnapshot({ sessionKey: deletedSessionKey, conversationId })
        }
        return
      }
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
          if (requestId !== selectRequestIdRef.current) {
            setUnreadByConversationId((current) => clearConversationUnread(current, conversationId))
            toast("会话已删除")
            void refreshConversationSnapshot({ sessionKey: deletedSessionKey, conversationId })
            return
          }
          selectedConversationIdRef.current = session.id
          selectedSessionKeyRef.current = session.sessionKey
          setSelectedConversationIdRaw(session.id)
          setSelectedSessionKeyRaw(session.sessionKey)
        } else {
          selectedConversationIdRef.current = undefined
          selectedSessionKeyRef.current = DEFAULT_LOCAL_SESSION_KEY
          setSelectedConversationIdRaw(undefined)
          setSelectedSessionKeyRaw(DEFAULT_LOCAL_SESSION_KEY)
          clearTimeline()
          setUnreadByConversationId({})
          resetUnreadAfterDelete = true
        }
      }
      if (!resetUnreadAfterDelete) {
        setUnreadByConversationId((current) => clearConversationUnread(current, conversationId))
      }
      toast("会话已删除")
      await refresh()
    } catch (rawError) {
      if (requestId !== selectRequestIdRef.current) {
        return
      }
      const message = rawError instanceof Error ? rawError.message : "删除失败"
      logger.error("Agent session delete failed.", rawError)
      setError(message)
    }
  }, [clearTimeline, projectId, refresh, refreshConversationSnapshot, sessions])

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
      selectRequestIdRef.current += 1
      setSessions([])
      clearTimeline()
      setPendingPermissions([])
      setStatus(null)
      setProviders(null)
      setCommands([])
      setUnreadByConversationId({})
      setSelectedConversationIdRaw(undefined)
      setSelectedSessionKeyRaw(DEFAULT_LOCAL_SESSION_KEY)
      setError(null)
      setLoading(false)
      setActiveSendCount(0)
      return
    }
    void refresh()
  }, [clearTimeline, projectId, refresh])

  useEffect(() => {
    if (!projectId) return undefined
    const bridge = requireSynapseBridge()
    return bridge.agent.onEvent((domainEvent) => {
      if (domainEvent.payload.projectId !== projectId) return
      if (domainEvent.type === "conversationUpdated") {
        const selected = {
          conversationId: selectedConversationIdRef.current,
          sessionKey: selectedSessionKeyRef.current,
        }
        const selectedUpdate = isSelectedConversation(domainEvent.payload, selected)
        const autoFollow = shouldAutoFollowConversation(domainEvent.payload, {
          followFeishu: followFeishuRef.current,
          inputDirty: inputDirtyRef.current,
          selectedConversationId: selected.conversationId,
          selectedSessionKey: selected.sessionKey,
        })

        void refreshConversationSnapshot(domainEvent.payload)
        if (selectedUpdate || autoFollow) {
          if (autoFollow) {
            selectRequestIdRef.current += 1
            selectedConversationIdRef.current = domainEvent.payload.conversationId
            selectedSessionKeyRef.current = domainEvent.payload.sessionKey
            setSelectedConversationIdRaw(domainEvent.payload.conversationId)
            setSelectedSessionKeyRaw(domainEvent.payload.sessionKey)
          }
          setUnreadByConversationId((current) => clearConversationUnread(
            current,
            domainEvent.payload.conversationId,
          ))
          void loadTimeline(domainEvent.payload).catch((rawError: unknown) => {
            const message = rawError instanceof Error ? rawError.message : "加载会话失败"
            logger.error("Agent live timeline refresh failed.", rawError)
            setError(message)
          })
          return
        }
        setUnreadByConversationId((current) => incrementUnreadForConversation(
          current,
          domainEvent.payload,
          selected,
        ))
        return
      }
      if (!matchesSelectedEvent(domainEvent, {
        conversationId: selectedConversationIdRef.current,
        sessionKey: selectedSessionKeyRef.current,
      })) return
      updateTimeline((current) => appendAgentEvent(current, domainEvent.payload.event, domainEvent.timestamp))
      void refreshPendingPermissions()
    })
  }, [loadTimeline, projectId, refreshConversationSnapshot, refreshPendingPermissions, updateTimeline])

  return {
    sessions,
    timeline,
    pendingPermissions,
    status,
    providers,
    commands,
    followFeishu,
    setFollowFeishu,
    unreadByConversationId,
    selectedConversationId,
    selectedSessionKey,
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

function formatSessionNameTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function matchesSelectedEvent(
  domainEvent: SynapseAgentDomainEvent,
  selected: { readonly conversationId?: string; readonly sessionKey: string },
): boolean {
  return isSelectedConversation({
    conversationId: domainEvent.scope?.sessionId,
    sessionKey: domainEvent.payload.sessionKey,
  }, selected)
}
