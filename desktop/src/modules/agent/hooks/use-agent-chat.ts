import { useCallback, useEffect, useReducer, useRef } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
import {
  appendAgentTimelineEvent,
  localUserTimelineItem,
} from "@/lib/agent-timeline"
import type {
  SynapseAgentDomainEvent,
  SynapseAgentPendingPermission,
  SynapseAgentPublishedCommand,
  SynapseAgentProviderState,
  SynapseAgentSessionSummary,
  SynapseAgentStatus,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import type { AgentProjectScope } from "../project-resolution"
import { DEFAULT_LOCAL_SESSION_KEY } from "../utils"
import {
  clearConversationUnread,
  incrementUnreadForConversation,
  isSelectedConversation,
  shouldApplyTimelineSnapshot,
  shouldAutoFollowConversation,
  type UnreadState,
} from "../live-sync"
import { chatReducer, initialChatState } from "./use-chat-reducer"

const logger = createRendererLogger("agent")

type TimelineTarget = {
  readonly projectId: string
  readonly sessionKey: string
  readonly conversationId?: string
}

type UseAgentChatState = {
  sessions: SynapseAgentSessionSummary[]
  archivedSessions: SynapseAgentSessionSummary[]
  timeline: SynapseAgentTimelineItem[]
  pendingPermissions: SynapseAgentPendingPermission[]
  status: SynapseAgentStatus | null
  providers: SynapseAgentProviderState | null
  commands: SynapseAgentPublishedCommand[]
  followFeishu: boolean
  setFollowFeishu: (follow: boolean) => void
  unreadByConversationId: UnreadState
  selectedProjectId?: string
  selectedConversationId?: string
  selectedSessionKey: string
  activeProjectId?: string
  loading: boolean
  sending: boolean
  error: string | null
  createSession: (projectId: string, agentType: string) => Promise<void>
  selectSession: (session: SynapseAgentSessionSummary) => Promise<void>
  deleteSession: (session: SynapseAgentSessionSummary) => Promise<void>
  renameSession: (session: SynapseAgentSessionSummary, name: string) => Promise<void>
  refresh: () => Promise<void>
  sendMessage: (content: string) => Promise<void>
  respondPermission: (requestId: string, behavior: "allow" | "deny") => Promise<void>
}

function useAgentChat(
  projectScope: AgentProjectScope,
  options: { readonly inputDirty?: boolean } = {},
): UseAgentChatState {
  const [state, dispatch] = useReducer(chatReducer, initialChatState)
  const {
    sessions,
    archivedSessions,
    timeline,
    pendingPermissions,
    status,
    providers,
    commands,
    followFeishu,
    unreadByConversationId,
    selectedProjectId,
    selectedConversationId,
    selectedSessionKey,
    loading,
    sendingConversationIds,
    error,
  } = state
  const followFeishuRef = useRef(followFeishu)
  const inputDirtyRef = useRef(options.inputDirty ?? false)
  const projectIdsRef = useRef(projectScope.projectIds)
  const defaultProjectIdRef = useRef(projectScope.defaultProjectId)
  const selectedProjectIdRef = useRef<string | undefined>(selectedProjectId)
  const selectedConversationIdRef = useRef<string | undefined>(selectedConversationId)
  const selectedSessionKeyRef = useRef(selectedSessionKey)
  const selectRequestIdRef = useRef(0)
  const timelineVersionRef = useRef(0)
  const projectIdsKey = projectScope.projectIds.join("\u0000")
  followFeishuRef.current = followFeishu
  inputDirtyRef.current = options.inputDirty ?? false
  projectIdsRef.current = projectScope.projectIds
  defaultProjectIdRef.current = projectScope.defaultProjectId
  selectedProjectIdRef.current = selectedProjectId
  selectedConversationIdRef.current = selectedConversationId
  selectedSessionKeyRef.current = selectedSessionKey

  const setFollowFeishu = useCallback((follow: boolean) => {
    followFeishuRef.current = follow
    dispatch({ type: "SET_FOLLOW_FEISHU", followFeishu: follow })
    logger.info("Agent follow Feishu changed.", {
      followFeishu: follow,
      selectedProjectId: selectedProjectIdRef.current,
      selectedConversationId: selectedConversationIdRef.current,
      selectedSessionKey: selectedSessionKeyRef.current,
    })
  }, [])

  const replaceTimeline = useCallback((entries: SynapseAgentTimelineItem[]) => {
    timelineVersionRef.current += 1
    dispatch({ type: "SET_TIMELINE", timeline: entries })
  }, [])

  const updateTimeline = useCallback((
    updater: (current: SynapseAgentTimelineItem[]) => SynapseAgentTimelineItem[],
  ) => {
    timelineVersionRef.current += 1
    dispatch({ type: "UPDATE_TIMELINE", updater })
  }, [])

  const clearTimeline = useCallback(() => {
    replaceTimeline([])
  }, [replaceTimeline])

  const getDefaultProjectId = useCallback(() => (
    selectedProjectIdRef.current
      ?? defaultProjectIdRef.current
      ?? projectIdsRef.current[0]
  ), [])

  const setSelectedSession = useCallback((session: SynapseAgentSessionSummary | undefined) => {
    selectedProjectIdRef.current = session?.projectId
    selectedConversationIdRef.current = session?.id
    selectedSessionKeyRef.current = session?.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY
    dispatch({ type: "SET_SELECTED_PROJECT_ID", selectedProjectId: session?.projectId })
    dispatch({ type: "SET_SELECTED_CONVERSATION_ID", selectedConversationId: session?.id })
    dispatch({ type: "SET_SELECTED_SESSION_KEY", selectedSessionKey: session?.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY })
  }, [])

  const loadTimeline = useCallback(async (target: TimelineTarget) => {
    const bridge = requireSynapseBridge()
    const capturedVersion = timelineVersionRef.current
    const result = await bridge.agent.getTimeline({
      projectId: target.projectId,
      sessionKey: target.sessionKey,
      conversationId: target.conversationId,
      limit: 100,
    })
    if (!shouldApplyTimelineSnapshot(target, {
      projectId: selectedProjectIdRef.current,
      conversationId: selectedConversationIdRef.current,
      sessionKey: selectedSessionKeyRef.current,
    }, {
      capturedVersion,
      currentVersion: timelineVersionRef.current,
    })) {
      return
    }
    replaceTimeline(result.entries)
  }, [replaceTimeline])

  const loadSessionsForProjects = useCallback(async () => {
    const bridge = requireSynapseBridge()
    const groups = await Promise.all(projectIdsRef.current.map(async (projectId) => {
      const projectSessions = await bridge.agent.listSessions(projectId)
      return projectSessions.map((session) => normalizeSessionProject(session, projectId))
    }))
    return sortSessions(groups.flat())
  }, [])

  const loadArchivedSessions = useCallback(async () => {
    const bridge = getSynapseBridge()
    if (!bridge) return
    try {
      const allSessions = await bridge.agent.listAllSessions()
      const currentProjectIds = new Set(projectIdsRef.current)
      const orphans = allSessions.filter((session) => !currentProjectIds.has(session.projectId))
      dispatch({ type: "SET_ARCHIVED_SESSIONS", archivedSessions: orphans })
    } catch {
      dispatch({ type: "SET_ARCHIVED_SESSIONS", archivedSessions: [] })
    }
  }, [])

  const refreshPendingPermissions = useCallback(async () => {
    if (projectIdsRef.current.length === 0) {
      dispatch({ type: "SET_PENDING_PERMISSIONS", pendingPermissions: [] })
      return
    }
    const bridge = requireSynapseBridge()
    const groups = await Promise.all(projectIdsRef.current.map((projectId) =>
      bridge.agent.listPendingPermissions(projectId)))
    dispatch({ type: "SET_PENDING_PERMISSIONS", pendingPermissions: groups.flat() })
  }, [])

  const refreshProjectMeta = useCallback(async (projectId: string | undefined) => {
    if (!projectId) {
      dispatch({ type: "SET_STATUS", status: null })
      dispatch({ type: "SET_PROVIDERS", providers: null })
      dispatch({ type: "SET_COMMANDS", commands: [] })
      return
    }
    const bridge = requireSynapseBridge()
    const [nextStatus, nextProviders, nextCommands] = await Promise.all([
      bridge.agent.status(projectId),
      bridge.agent.getProviders(projectId),
      bridge.agent.listCommands(projectId),
    ])
    dispatch({ type: "SET_STATUS", status: nextStatus })
    dispatch({ type: "SET_PROVIDERS", providers: nextProviders })
    dispatch({ type: "SET_COMMANDS", commands: nextCommands })
  }, [])

  const refreshConversationSnapshot = useCallback(async (target: TimelineTarget) => {
    const bridge = requireSynapseBridge()
    try {
      const [nextSessions, nextPending] = await Promise.all([
        bridge.agent.listSessions(target.projectId),
        bridge.agent.listPendingPermissions(target.projectId),
      ])
      const normalizedSessions = nextSessions.map((session) =>
        normalizeSessionProject(session, target.projectId))
      dispatch({ type: "UPDATE_SESSIONS", updater: (current) => sortSessions([
        ...current.filter((session) => session.projectId !== target.projectId),
        ...normalizedSessions,
      ]) })
      dispatch({ type: "UPDATE_PENDING_PERMISSIONS", updater: (current) => [
        ...current.filter((permission) => permission.projectId !== target.projectId),
        ...nextPending,
      ] })
      logger.info("Agent conversation snapshot refreshed.", {
        projectId: target.projectId,
        targetConversationId: target.conversationId,
        targetSessionKey: target.sessionKey,
        sessionCount: normalizedSessions.length,
        pendingPermissionCount: nextPending.length,
        sessions: sessionSnapshotForLog(normalizedSessions),
      })
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "刷新会话失败"
      logger.error("Agent conversation refresh failed.", rawError)
      dispatch({ type: "SET_ERROR", error: message })
    }
  }, [])

  const refresh = useCallback(async () => {
    if (projectIdsRef.current.length === 0) {
      return
    }
    selectRequestIdRef.current += 1
    const requestId = selectRequestIdRef.current
    dispatch({ type: "SET_LOADING", loading: true })
    dispatch({ type: "SET_ERROR", error: null })
    try {
      const nextSessions = await loadSessionsForProjects()
      const retained = findSessionByRef(
        nextSessions,
        selectedProjectIdRef.current,
        selectedConversationIdRef.current,
      )
      const nextSession = retained
        ?? nextSessions.find((session) => session.active)
        ?? nextSessions[0]
      const nextProjectId = nextSession?.projectId ?? getDefaultProjectId()
      const nextSessionKey = nextSession?.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY
      dispatch({ type: "SET_SESSIONS", sessions: nextSessions })
      await Promise.all([
        refreshPendingPermissions(),
        refreshProjectMeta(nextProjectId),
        loadArchivedSessions(),
      ])
      logger.info("Agent refresh loaded sessions.", {
        projectIds: projectIdsRef.current,
        activeProjectId: nextProjectId,
        sessionCount: nextSessions.length,
        selectedProjectId: nextSession?.projectId,
        selectedConversationId: nextSession?.id,
        selectedSessionKey: nextSessionKey,
        sessions: sessionSnapshotForLog(nextSessions),
      })
      if (requestId !== selectRequestIdRef.current) {
        return
      }
      setSelectedSession(nextSession)
      if (nextProjectId) {
        await loadTimeline({
          projectId: nextProjectId,
          sessionKey: nextSessionKey,
          conversationId: nextSession?.id,
        })
      } else {
        clearTimeline()
      }
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "加载失败"
      logger.error("Agent refresh failed.", rawError)
      dispatch({ type: "SET_ERROR", error: message })
    } finally {
      dispatch({ type: "SET_LOADING", loading: false })
    }
  }, [
    clearTimeline,
    getDefaultProjectId,
    loadArchivedSessions,
    loadSessionsForProjects,
    loadTimeline,
    refreshPendingPermissions,
    refreshProjectMeta,
    setSelectedSession,
  ])

  const createSession = useCallback(async (projectId: string, agentType: string) => {
    if (!projectId || !agentType) return
    const requestId = selectRequestIdRef.current + 1
    selectRequestIdRef.current = requestId
    const bridge = requireSynapseBridge()
    dispatch({ type: "SET_ERROR", error: null })
    try {
      const created = await bridge.agent.createSession({
        projectId,
        sessionKey: DEFAULT_LOCAL_SESSION_KEY,
        name: `新会话 ${formatSessionNameTime(new Date())}`,
        agentType,
      })
      const session = normalizeSessionProject(created, projectId)
      if (requestId !== selectRequestIdRef.current) {
        dispatch({ type: "UPDATE_SESSIONS", updater: (current) => current.some((item) => isSameSession(item, session))
          ? current
          : sortSessions([{ ...session, active: false }, ...current]) })
        toast("新会话已创建")
        return
      }
      setSelectedSession(session)
      dispatch({ type: "UPDATE_SESSIONS", updater: (current) => sortSessions([
        session,
        ...current.map((item) => ({
          ...item,
          active: item.projectId === session.projectId ? false : item.active,
        })).filter((item) => !isSameSession(item, session)),
      ]) })
      dispatch({ type: "UPDATE_UNREAD", updater: (current) => clearConversationUnread(current, session.projectId, session.id) })
      clearTimeline()
      toast("新会话已创建")
      await refresh()
    } catch (rawError) {
      if (requestId !== selectRequestIdRef.current) {
        return
      }
      const message = rawError instanceof Error ? rawError.message : "创建失败"
      logger.error("Agent session create failed.", rawError)
      dispatch({ type: "SET_ERROR", error: message })
    }
  }, [clearTimeline, refresh, setSelectedSession])

  const selectSession = useCallback(async (target: SynapseAgentSessionSummary) => {
    const bridge = requireSynapseBridge()
    const requestId = selectRequestIdRef.current + 1
    selectRequestIdRef.current = requestId
    dispatch({ type: "SET_ERROR", error: null })
    try {
      const switched = await bridge.agent.switchSession({
        projectId: target.projectId,
        sessionKey: target.sessionKey,
        conversationId: target.id,
      })
      if (requestId !== selectRequestIdRef.current) {
        return
      }
      const session = normalizeSessionProject(switched, target.projectId)
      setSelectedSession(session)
      dispatch({ type: "UPDATE_UNREAD", updater: (current) => clearConversationUnread(current, session.projectId, session.id) })
      dispatch({ type: "UPDATE_SESSIONS", updater: (current) => current.map((item) => ({
        ...item,
        active: item.projectId === session.projectId && item.id === session.id,
      })) })
      await refreshProjectMeta(session.projectId)
      await loadTimeline({
        projectId: session.projectId,
        sessionKey: session.sessionKey,
        conversationId: session.id,
      })
    } catch (rawError) {
      if (requestId !== selectRequestIdRef.current) {
        return
      }
      logger.error("Agent session switch failed.", rawError)
      dispatch({ type: "SET_ERROR", error: rawError instanceof Error ? rawError.message : "切换失败" })
    }
  }, [loadTimeline, refreshProjectMeta, setSelectedSession])

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    const selected = findSessionByRef(
      sessions,
      selectedProjectIdRef.current,
      selectedConversationIdRef.current,
    )
    const projectId = selected?.projectId ?? getDefaultProjectId()
    if (!projectId) return
    const conversationId = selected?.id
    const bridge = requireSynapseBridge()
    const sessionKey = selected?.sessionKey ?? selectedSessionKeyRef.current
    const now = new Date().toISOString()
    updateTimeline((current) => [
      ...current,
      localUserTimelineItem(trimmed, now, current.length),
    ])
    if (conversationId) {
      dispatch({ type: "ADD_SENDING_CONVERSATION", conversationId })
    }
    dispatch({ type: "SET_ERROR", error: null })
    try {
      await bridge.agent.send({
        projectId,
        sessionKey,
        content: trimmed,
      })
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "发送失败"
      logger.error("Agent send failed.", rawError)
      dispatch({ type: "SET_ERROR", error: message })
    } finally {
      if (conversationId) {
        dispatch({ type: "REMOVE_SENDING_CONVERSATION", conversationId })
      }
    }
  }, [getDefaultProjectId, sessions, updateTimeline])

  const deleteSession = useCallback(async (target: SynapseAgentSessionSummary) => {
    const requestId = selectRequestIdRef.current + 1
    selectRequestIdRef.current = requestId
    const bridge = requireSynapseBridge()
    dispatch({ type: "SET_ERROR", error: null })
    try {
      const result = await bridge.agent.deleteSession({
        projectId: target.projectId,
        conversationId: target.id,
      })
      if (requestId !== selectRequestIdRef.current) {
        if (result.ok) {
          dispatch({ type: "UPDATE_UNREAD", updater: (current) => clearConversationUnread(current, target.projectId, target.id) })
          toast("会话已删除")
          void refreshConversationSnapshot({
            projectId: target.projectId,
            sessionKey: target.sessionKey,
            conversationId: target.id,
          })
        }
        return
      }
      if (!result.ok) {
        dispatch({ type: "SET_ERROR", error: "会话不存在" })
        return
      }
      dispatch({ type: "UPDATE_UNREAD", updater: (current) => clearConversationUnread(current, target.projectId, target.id) })
      if (selectedProjectIdRef.current === target.projectId && selectedConversationIdRef.current === target.id) {
        const next = sessions.find((session) => !isSameSession(session, target))
        setSelectedSession(next)
        if (next) {
          await loadTimeline({
            projectId: next.projectId,
            sessionKey: next.sessionKey,
            conversationId: next.id,
          })
          await refreshProjectMeta(next.projectId)
        } else {
          clearTimeline()
        }
      }
      dispatch({ type: "UPDATE_SESSIONS", updater: (current) => current.filter((session) => !isSameSession(session, target)) })
      toast("会话已删除")
    } catch (rawError) {
      if (requestId !== selectRequestIdRef.current) {
        return
      }
      const message = rawError instanceof Error ? rawError.message : "删除失败"
      logger.error("Agent session delete failed.", rawError)
      dispatch({ type: "SET_ERROR", error: message })
    }
  }, [
    clearTimeline,
    loadTimeline,
    refresh,
    refreshConversationSnapshot,
    refreshProjectMeta,
    sessions,
    setSelectedSession,
  ])

  const renameSession = useCallback(async (target: SynapseAgentSessionSummary, name: string) => {
    const bridge = requireSynapseBridge()
    dispatch({ type: "SET_ERROR", error: null })
    try {
      await bridge.agent.renameSession({
        projectId: target.projectId,
        conversationId: target.id,
        name,
      })
      dispatch({ type: "UPDATE_SESSIONS", updater: (current) => current.map((session) =>
        isSameSession(session, target) ? { ...session, name } : session) })
      toast("已重命名")
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "重命名失败"
      logger.error("Agent session rename failed.", rawError)
      dispatch({ type: "SET_ERROR", error: message })
    }
  }, [])

  const respondPermission = useCallback(async (
    requestId: string,
    behavior: "allow" | "deny",
  ) => {
    const projectId = pendingPermissions.find((permission) => permission.requestId === requestId)?.projectId
      ?? getDefaultProjectId()
    if (!projectId) return
    const bridge = requireSynapseBridge()
    dispatch({ type: "SET_ERROR", error: null })
    try {
      await bridge.agent.respondPermission({ projectId, requestId, behavior })
      await refreshPendingPermissions()
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "处理失败"
      logger.error("Agent permission response failed.", rawError)
      dispatch({ type: "SET_ERROR", error: message })
    }
  }, [getDefaultProjectId, pendingPermissions, refreshPendingPermissions])

  useEffect(() => {
    if (projectIdsRef.current.length === 0) {
      selectRequestIdRef.current += 1
      dispatch({ type: "RESET" })
      clearTimeline()
      setSelectedSession(undefined)
      void loadArchivedSessions()
      return
    }
    void refresh()
  }, [clearTimeline, loadArchivedSessions, projectIdsKey, refresh, setSelectedSession])

  useEffect(() => {
    if (projectIdsRef.current.length === 0) return undefined
    const bridge = getSynapseBridge()
    if (!bridge) return undefined
    return bridge.agent.onEvent((domainEvent) => {
      if (!projectIdsRef.current.includes(domainEvent.payload.projectId)) {
        logger.info("Agent event ignored for untracked project.", {
          currentProjectIds: projectIdsRef.current,
          eventProjectId: domainEvent.payload.projectId,
          eventType: domainEvent.type,
          conversationId: "conversationId" in domainEvent.payload
            ? domainEvent.payload.conversationId
            : undefined,
          sessionKey: domainEvent.payload.sessionKey,
          platform: domainEvent.payload.platform,
        })
        return
      }
      if (domainEvent.type === "conversationUpdated") {
        const selected = {
          projectId: selectedProjectIdRef.current,
          conversationId: selectedConversationIdRef.current,
          sessionKey: selectedSessionKeyRef.current,
        }
        const selectedUpdate = isSelectedConversation(domainEvent.payload, selected)
        const autoFollow = shouldAutoFollowConversation(domainEvent.payload, {
          followFeishu: followFeishuRef.current,
          inputDirty: inputDirtyRef.current,
          selectedProjectId: selected.projectId,
          selectedConversationId: selected.conversationId,
          selectedSessionKey: selected.sessionKey,
        })
        logger.info("Agent conversation update event received.", {
          projectId: domainEvent.payload.projectId,
          conversationId: domainEvent.payload.conversationId,
          sessionKey: domainEvent.payload.sessionKey,
          platform: domainEvent.payload.platform,
          selectedProjectId: selected.projectId,
          selectedConversationId: selected.conversationId,
          selectedSessionKey: selected.sessionKey,
          selectedUpdate,
          autoFollow,
          followFeishu: followFeishuRef.current,
          inputDirty: inputDirtyRef.current,
        })

        void refreshConversationSnapshot(domainEvent.payload)
        if (selectedUpdate || autoFollow) {
          if (autoFollow) {
            selectRequestIdRef.current += 1
            selectedProjectIdRef.current = domainEvent.payload.projectId
            selectedConversationIdRef.current = domainEvent.payload.conversationId
            selectedSessionKeyRef.current = domainEvent.payload.sessionKey
            dispatch({ type: "SET_SELECTED_PROJECT_ID", selectedProjectId: domainEvent.payload.projectId })
            dispatch({ type: "SET_SELECTED_CONVERSATION_ID", selectedConversationId: domainEvent.payload.conversationId })
            dispatch({ type: "SET_SELECTED_SESSION_KEY", selectedSessionKey: domainEvent.payload.sessionKey })
          }
          dispatch({ type: "UPDATE_UNREAD", updater: (current) => clearConversationUnread(
            current,
            domainEvent.payload.projectId,
            domainEvent.payload.conversationId,
          ) })
          void loadTimeline(domainEvent.payload).catch((rawError: unknown) => {
            const message = rawError instanceof Error ? rawError.message : "加载会话失败"
            logger.error("Agent live timeline refresh failed.", rawError)
            dispatch({ type: "SET_ERROR", error: message })
          })
          return
        }
        dispatch({ type: "UPDATE_UNREAD", updater: (current) => incrementUnreadForConversation(
          current,
          domainEvent.payload,
          selected,
        ) })
        return
      }
      if (!matchesSelectedEvent(domainEvent, {
        projectId: selectedProjectIdRef.current,
        conversationId: selectedConversationIdRef.current,
        sessionKey: selectedSessionKeyRef.current,
      })) {
        logger.debug("Agent stream event ignored for inactive conversation.", {
          projectId: domainEvent.payload.projectId,
          eventType: domainEvent.type,
          sessionKey: domainEvent.payload.sessionKey,
          platform: domainEvent.payload.platform,
          selectedProjectId: selectedProjectIdRef.current,
          selectedConversationId: selectedConversationIdRef.current,
          selectedSessionKey: selectedSessionKeyRef.current,
        })
        return
      }
      logger.debug("Agent stream event applied.", {
        projectId: domainEvent.payload.projectId,
        eventType: domainEvent.type,
        sessionKey: domainEvent.payload.sessionKey,
        platform: domainEvent.payload.platform,
        selectedProjectId: selectedProjectIdRef.current,
        selectedConversationId: selectedConversationIdRef.current,
        selectedSessionKey: selectedSessionKeyRef.current,
      })
      const agentType = sessions.find((session) =>
        session.projectId === selectedProjectIdRef.current
        && session.id === selectedConversationIdRef.current)?.agentType
        ?? status?.agentType
      updateTimeline((current) =>
        appendAgentTimelineEvent(current, domainEvent.payload.event, domainEvent.timestamp, agentType))
      void refreshPendingPermissions()
    })
  }, [
    loadTimeline,
    projectIdsKey,
    refreshConversationSnapshot,
    refreshPendingPermissions,
    sessions,
    status?.agentType,
    updateTimeline,
  ])

  const activeProjectId = selectedProjectId ?? projectScope.defaultProjectId ?? projectScope.projectIds[0]

  return {
    sessions,
    archivedSessions,
    timeline,
    pendingPermissions,
    status,
    providers,
    commands,
    followFeishu,
    setFollowFeishu,
    unreadByConversationId,
    selectedProjectId,
    selectedConversationId,
    selectedSessionKey,
    activeProjectId,
    loading,
    sending: selectedConversationId ? sendingConversationIds.has(selectedConversationId) : false,
    error,
    createSession,
    selectSession,
    deleteSession,
    renameSession,
    refresh,
    sendMessage,
    respondPermission,
  }
}

export { useAgentChat }

function normalizeSessionProject(
  session: SynapseAgentSessionSummary,
  projectId: string,
): SynapseAgentSessionSummary {
  return session.projectId === projectId ? session : { ...session, projectId }
}

function sortSessions(
  sessions: readonly SynapseAgentSessionSummary[],
): SynapseAgentSessionSummary[] {
  return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function findSessionByRef(
  sessions: readonly SynapseAgentSessionSummary[],
  projectId: string | undefined,
  conversationId: string | undefined,
): SynapseAgentSessionSummary | undefined {
  if (!projectId || !conversationId) return undefined
  return sessions.find((session) => session.projectId === projectId && session.id === conversationId)
}

function isSameSession(
  left: Pick<SynapseAgentSessionSummary, "projectId" | "id">,
  right: Pick<SynapseAgentSessionSummary, "projectId" | "id">,
): boolean {
  return left.projectId === right.projectId && left.id === right.id
}

function sessionSnapshotForLog(
  sessions: readonly SynapseAgentSessionSummary[],
): Array<Record<string, unknown>> {
  return sessions.slice(0, 10).map((session) => ({
    projectId: session.projectId,
    id: session.id,
    sessionKey: session.sessionKey,
    platform: session.platform,
    sourceLabel: session.sourceLabel,
    active: session.active,
    historyCount: session.historyCount,
    updatedAt: session.updatedAt,
  }))
}

function formatSessionNameTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function matchesSelectedEvent(
  domainEvent: SynapseAgentDomainEvent,
  selected: {
    readonly projectId?: string
    readonly conversationId?: string
    readonly sessionKey: string
  },
): boolean {
  return isSelectedConversation({
    projectId: domainEvent.payload.projectId,
    conversationId: domainEvent.scope?.sessionId,
    sessionKey: domainEvent.payload.sessionKey,
  }, selected)
}
