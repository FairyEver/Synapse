import { useCallback, useEffect, useRef, useState } from "react"
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
  defaultSessionKey,
} from "../utils"

const logger = createRendererLogger("agent")

type UseAgentChatState = {
  sessions: SynapseAgentSessionSummary[]
  timeline: SynapseAgentTimelineEntry[]
  pendingPermissions: SynapseAgentPendingPermission[]
  status: SynapseAgentStatus | null
  providers: SynapseAgentProviderState | null
  commands: SynapseAgentPublishedCommand[]
  selectedSessionKey: string
  loading: boolean
  sending: boolean
  error: string | null
  setSelectedSessionKey: (sessionKey: string) => void
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
  const [selectedSessionKey, setSelectedSessionKeyRaw] = useState(DEFAULT_LOCAL_SESSION_KEY)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedSessionKeyRef = useRef(selectedSessionKey)
  selectedSessionKeyRef.current = selectedSessionKey

  const loadTimeline = useCallback(async (sessionKey: string) => {
    if (!projectId) {
      setTimeline([])
      return
    }
    const bridge = requireSynapseBridge()
    const result = await bridge.agent.getTimeline({
      projectId,
      sessionKey,
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
      const currentSessionKey = selectedSessionKeyRef.current
      const nextSessionKey = nextSessions.some((session) => session.sessionKey === currentSessionKey)
        ? currentSessionKey
        : defaultSessionKey(nextSessions)
      setStatus(nextStatus)
      setSessions(nextSessions)
      setProviders(nextProviders)
      setPendingPermissions(nextPending)
      setCommands(nextCommands)
      setSelectedSessionKeyRaw(nextSessionKey)
      await loadTimeline(nextSessionKey)
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "加载失败"
      logger.error("Agent refresh failed.", rawError)
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [loadTimeline, projectId])

  const setSelectedSessionKey = useCallback((sessionKey: string) => {
    setSelectedSessionKeyRaw(sessionKey)
    void loadTimeline(sessionKey).catch((rawError) => {
      logger.error("Agent timeline load failed.", rawError)
      setError(rawError instanceof Error ? rawError.message : "加载失败")
    })
  }, [loadTimeline])

  const sendMessage = useCallback(async (content: string) => {
    if (!projectId) return
    const trimmed = content.trim()
    if (!trimmed) return
    const bridge = requireSynapseBridge()
    setSending(true)
    setError(null)
    try {
      await bridge.agent.send({
        projectId,
        sessionKey: selectedSessionKeyRef.current,
        content: trimmed,
      })
      await refresh()
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "发送失败"
      logger.error("Agent send failed.", rawError)
      setError(message)
    } finally {
      setSending(false)
    }
  }, [projectId, refresh])

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
      setSelectedSessionKeyRaw(DEFAULT_LOCAL_SESSION_KEY)
      setError(null)
      setLoading(false)
      setSending(false)
      return
    }
    void refresh()
  }, [projectId, refresh])

  useEffect(() => {
    if (!projectId) return undefined
    const bridge = requireSynapseBridge()
    return bridge.agent.onEvent((domainEvent) => {
      if (domainEvent.payload.projectId !== projectId) return
      if (domainEvent.payload.sessionKey !== selectedSessionKeyRef.current) return
      setTimeline((current) => [
        ...current,
        agentEventToTimelineEntry(domainEvent.payload.event, domainEvent.timestamp, current.length),
      ])
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
    selectedSessionKey,
    loading,
    sending,
    error,
    setSelectedSessionKey,
    refresh,
    sendMessage,
    respondPermission,
  }
}

export { useAgentChat }
