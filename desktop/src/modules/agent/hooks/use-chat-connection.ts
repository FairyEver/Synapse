import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
import { localUserTimelineItem } from "@/lib/agent-timeline"
import type {
  SynapseAgentPendingPermission,
  SynapseAgentMessageAttachment,
  SynapseAgentMessageTimelineItem,
  SynapseAgentPermissionMode,
  SynapseAgentPermissionScope,
  SynapseAgentSessionSummary,
  SynapseAgentTimelineItem,
  SynapseAgentTimelineResult,
} from "@/types/agent"
import type { AgentConversationTarget } from "@/types/agent-conversation-window"
import type { SynapseAgentBridgeAttachment } from "@/types/bridge"
import { DEFAULT_LOCAL_SESSION_KEY, pendingPermissionKey } from "../utils"
import {
  clearConversationUnread,
  isSelectedConversation,
  shouldApplyTimelineSnapshot,
} from "../live-sync"
import type { AgentDraftAttachment } from "../attachments"
import type { ChatAction, ChatState } from "./use-chat-reducer"

const logger = createRendererLogger("agent")

type TimelineTarget = {
  readonly projectId: string
  readonly sessionKey: string
  readonly conversationId?: string
}

type SendMessageTarget = TimelineTarget

type SendMessageOptions = {
  readonly attachments?: readonly AgentDraftAttachment[]
}

type PermissionResponseTarget = Pick<SynapseAgentPendingPermission, "projectId" | "requestId">

type TimelineLoadMode = "replace" | "refresh-tail"

type ChatConnectionRefs = {
  readonly projectIdsRef: React.RefObject<string[]>
  readonly defaultProjectIdRef: React.RefObject<string | undefined>
  readonly selectedProjectIdRef: React.RefObject<string | undefined>
  readonly selectedConversationIdRef: React.RefObject<string | undefined>
  readonly selectedSessionKeyRef: React.RefObject<string>
  readonly selectRequestIdRef: React.RefObject<number>
  readonly timelineVersionRef: React.RefObject<number>
  readonly pendingConversationIdsRef: React.RefObject<Set<string>>
}

type ChatConnectionResult = {
  readonly replaceTimeline: (entries: SynapseAgentTimelineItem[]) => void
  readonly updateTimeline: (updater: (current: SynapseAgentTimelineItem[]) => SynapseAgentTimelineItem[]) => void
  readonly clearTimeline: () => void
  readonly getDefaultProjectId: () => string | undefined
  readonly setSelectedSession: (session: SynapseAgentSessionSummary | undefined) => void
  readonly loadTimeline: (target: TimelineTarget, mode?: TimelineLoadMode) => Promise<void>
  readonly loadOlderTimeline: () => Promise<void>
  readonly loadArchivedSessions: () => Promise<void>
  readonly refreshPendingPermissions: () => Promise<void>
  readonly refreshProjectMeta: (projectId: string | undefined) => Promise<void>
  readonly refreshConversationSnapshot: (target: TimelineTarget) => Promise<void>
  readonly refresh: () => Promise<void>
  readonly refreshPersonas: () => Promise<void>
  readonly createSession: (
    projectId: string,
    providerId?: string,
    mode?: SynapseAgentPermissionMode,
    modelTier?: string,
    name?: string,
    personaId?: string | null,
  ) => Promise<SynapseAgentSessionSummary | undefined>
  readonly selectSession: (session: SynapseAgentSessionSummary) => Promise<void>
  readonly sendMessage: (content: string, target?: SendMessageTarget, options?: SendMessageOptions) => Promise<boolean>
  readonly deleteSession: (session: SynapseAgentSessionSummary) => Promise<void>
  readonly renameSession: (session: SynapseAgentSessionSummary, name: string) => Promise<void>
  readonly setPermissionMode: (mode: SynapseAgentPermissionMode, target?: AgentConversationTarget) => Promise<void>
  readonly respondPermission: (
    target: PermissionResponseTarget,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
    scope?: SynapseAgentPermissionScope,
  ) => Promise<void>
  readonly cancelTurn: (target?: AgentConversationTarget) => Promise<void>
  readonly forceKillTurn: (target?: AgentConversationTarget) => Promise<void>
}

function useChatConnection(
  state: ChatState,
  dispatch: React.Dispatch<ChatAction>,
  refs: ChatConnectionRefs,
): ChatConnectionResult {
  const {
    projectIdsRef,
    defaultProjectIdRef,
    selectedProjectIdRef,
    selectedConversationIdRef,
    selectedSessionKeyRef,
    selectRequestIdRef,
    timelineVersionRef,
    pendingConversationIdsRef,
  } = refs

  const respondingPermissionKeysRef = useRef(new Set<string>())
  const timelineLoadRequestIdRef = useRef(0)
  const olderTimelineRequestRef = useRef<Promise<void> | null>(null)
  const timelinePaginationRef = useRef({
    startIndex: state.timelineStartIndex,
    total: state.timelineTotal,
    hasMore: state.timelineHasMore,
  })
  timelinePaginationRef.current = {
    startIndex: state.timelineStartIndex,
    total: state.timelineTotal,
    hasMore: state.timelineHasMore,
  }

  const replaceTimeline = useCallback((entries: SynapseAgentTimelineItem[]) => {
    timelineVersionRef.current += 1
    dispatch({ type: "SET_TIMELINE", timeline: entries })
  }, [dispatch, timelineVersionRef])

  const updateTimeline = useCallback((
    updater: (current: SynapseAgentTimelineItem[]) => SynapseAgentTimelineItem[],
  ) => {
    timelineVersionRef.current += 1
    dispatch({ type: "UPDATE_TIMELINE", updater })
  }, [dispatch, timelineVersionRef])

  const clearTimeline = useCallback(() => {
    timelineLoadRequestIdRef.current += 1
    timelinePaginationRef.current = { startIndex: 0, total: 0, hasMore: false }
    timelineVersionRef.current += 1
    dispatch({
      type: "SET_TIMELINE_PAGE",
      timeline: [],
      startIndex: 0,
      total: 0,
      hasMore: false,
    })
  }, [dispatch, timelineVersionRef])

  const getDefaultProjectId = useCallback(() => (
    selectedProjectIdRef.current
      ?? defaultProjectIdRef.current
      ?? projectIdsRef.current[0]
  ), [defaultProjectIdRef, projectIdsRef, selectedProjectIdRef])

  const setSelectedSession = useCallback((session: SynapseAgentSessionSummary | undefined) => {
    selectedProjectIdRef.current = session?.projectId
    selectedConversationIdRef.current = session?.id
    selectedSessionKeyRef.current = session?.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY
    dispatch({ type: "SET_SELECTED_PROJECT_ID", selectedProjectId: session?.projectId })
    dispatch({ type: "SET_SELECTED_CONVERSATION_ID", selectedConversationId: session?.id })
    dispatch({ type: "SET_SELECTED_SESSION_KEY", selectedSessionKey: session?.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY })
  }, [dispatch, selectedConversationIdRef, selectedProjectIdRef, selectedSessionKeyRef])

  const loadTimeline = useCallback(async (
    target: TimelineTarget,
    mode: TimelineLoadMode = "replace",
  ) => {
    const bridge = requireSynapseBridge()
    const capturedVersion = timelineVersionRef.current
    const requestId = timelineLoadRequestIdRef.current + 1
    timelineLoadRequestIdRef.current = requestId
    let result = await bridge.agent.getTimeline({
      projectId: target.projectId,
      sessionKey: target.sessionKey,
      conversationId: target.conversationId,
      limit: 100,
    })
    if (mode === "refresh-tail" && timelinePaginationRef.current.total > 0) {
      result = await backfillTimelineGap(bridge.agent.getTimeline, target, result, timelinePaginationRef.current.total)
    }
    const selected = {
      projectId: selectedProjectIdRef.current,
      conversationId: selectedConversationIdRef.current,
      sessionKey: selectedSessionKeyRef.current,
    }
    const shouldApply = requestId === timelineLoadRequestIdRef.current
      && shouldApplyTimelineSnapshot(target, selected, {
        capturedVersion,
        currentVersion: timelineVersionRef.current,
      })
    if (!shouldApply) {
      return
    }
    const dbEntries = filterPersistedTimelineEntries(result.entries)
    timelineVersionRef.current += 1
    if (mode === "replace") {
      timelinePaginationRef.current = {
        startIndex: result.startIndex,
        total: result.total,
        hasMore: result.hasMore,
      }
      dispatch({
        type: "SET_TIMELINE_PAGE",
        timeline: [...dbEntries],
        startIndex: result.startIndex,
        total: result.total,
        hasMore: result.hasMore,
      })
      return
    }
    const currentStartIndex = timelinePaginationRef.current.startIndex
    timelinePaginationRef.current = {
      startIndex: currentStartIndex,
      total: Math.max(timelinePaginationRef.current.total, result.total),
      hasMore: currentStartIndex > 0,
    }
    dispatch({
      type: "UPDATE_TIMELINE_PAGE",
      updater: (current) => mergePersistedTimelineTail(current, dbEntries, result.startIndex),
      total: result.total,
    })
  }, [
    dispatch,
    selectedConversationIdRef,
    selectedProjectIdRef,
    selectedSessionKeyRef,
    timelineVersionRef,
  ])

  const loadOlderTimeline = useCallback((): Promise<void> => {
    if (olderTimelineRequestRef.current) return olderTimelineRequestRef.current
    const pagination = timelinePaginationRef.current
    const projectId = selectedProjectIdRef.current
    const conversationId = selectedConversationIdRef.current
    const sessionKey = selectedSessionKeyRef.current
    if (!pagination.hasMore || !projectId || !conversationId) return Promise.resolve()

    const target = { projectId, conversationId, sessionKey }
    dispatch({ type: "SET_LOADING_OLDER", loading: true })
    dispatch({ type: "SET_TIMELINE_HISTORY_ERROR", error: null })
    const request = requireSynapseBridge().agent.getTimeline({
      ...target,
      limit: 100,
      beforeIndex: pagination.startIndex,
    }).then((result) => {
      if (!isSelectedConversation(target, {
        projectId: selectedProjectIdRef.current,
        conversationId: selectedConversationIdRef.current,
        sessionKey: selectedSessionKeyRef.current,
      })) return
      const dbEntries = filterPersistedTimelineEntries(result.entries)
      timelineVersionRef.current += 1
      timelinePaginationRef.current = {
        startIndex: result.startIndex,
        total: Math.max(timelinePaginationRef.current.total, result.total),
        hasMore: result.hasMore,
      }
      dispatch({
        type: "UPDATE_TIMELINE_PAGE",
        updater: (current) => prependTimelineEntries(current, dbEntries),
        startIndex: result.startIndex,
        total: result.total,
      })
    }).catch((rawError: unknown) => {
      if (!isSelectedConversation(target, {
        projectId: selectedProjectIdRef.current,
        conversationId: selectedConversationIdRef.current,
        sessionKey: selectedSessionKeyRef.current,
      })) return
      logger.warn("Agent older timeline load failed.", {
        projectId,
        conversationId,
        beforeIndex: pagination.startIndex,
        boundary: "renderer.agent.timeline.older",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      dispatch({ type: "SET_TIMELINE_HISTORY_ERROR", error: "历史加载失败" })
    }).finally(() => {
      olderTimelineRequestRef.current = null
      dispatch({ type: "SET_LOADING_OLDER", loading: false })
    })
    olderTimelineRequestRef.current = request
    return request
  }, [dispatch, selectedConversationIdRef, selectedProjectIdRef, selectedSessionKeyRef, timelineVersionRef])

  const loadSessionsForProjects = useCallback(async () => {
    const bridge = requireSynapseBridge()
    const groups = await Promise.all(projectIdsRef.current.map(async (projectId) => {
      const projectSessions = await bridge.agent.listSessions(projectId)
      return projectSessions.map((session) => normalizeSessionProject(session, projectId))
    }))
    return sortSessions(groups.flat())
  }, [projectIdsRef])

  const refreshPersonas = useCallback(async () => {
    const bridge = requireSynapseBridge()
    const result = await bridge.agentPersonas.list()
    dispatch({ type: "SET_PERSONAS", personas: result.items })
  }, [dispatch])

  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge) return undefined
    void bridge.agentPersonas.list()
      .then((result) => dispatch({ type: "SET_PERSONAS", personas: result.items }))
      .catch((rawError: unknown) => {
        logger.warn("Agent personas load failed.", {
          boundary: "renderer.agent.personas.load",
          errorName: rawError instanceof Error ? rawError.name : typeof rawError,
          errorLength: errorMessage(rawError).length,
        })
        dispatch({ type: "SET_PERSONAS", personas: [] })
      })
    return bridge.agentPersonas.onChanged((event) => {
      dispatch({ type: "SET_PERSONAS", personas: event.result?.items ?? event.items })
    })
  }, [dispatch])

  const loadArchivedSessions = useCallback(async () => {
    const bridge = getSynapseBridge()
    if (!bridge) return
    try {
      const archivedSessions = await bridge.agent.listAllSessions({
        excludeProjectIds: projectIdsRef.current,
        limit: 200,
      })
      dispatch({ type: "SET_ARCHIVED_SESSIONS", archivedSessions })
    } catch (rawError) {
      logger.warn("Agent archived sessions refresh failed.", {
        projectIds: projectIdsRef.current,
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      toast.error("归档会话加载失败，请重试")
    }
  }, [dispatch, projectIdsRef])

  const refreshPendingPermissions = useCallback(async () => {
    if (projectIdsRef.current.length === 0) {
      dispatch({ type: "SET_PENDING_PERMISSIONS", pendingPermissions: [] })
      return
    }
    const bridge = requireSynapseBridge()
    const groups = await Promise.all(projectIdsRef.current.map((projectId) =>
      bridge.agent.listPendingPermissions(projectId)))
    dispatch({ type: "SET_PENDING_PERMISSIONS", pendingPermissions: groups.flat() })
  }, [dispatch, projectIdsRef])

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
      bridge.agent.getProviders(),
      bridge.agent.listCommands(projectId),
    ])
    dispatch({ type: "SET_STATUS", status: nextStatus })
    dispatch({ type: "SET_PROVIDERS", providers: nextProviders })
    dispatch({ type: "SET_COMMANDS", commands: nextCommands })
  }, [dispatch])

  const refreshPendingPermissionsForPageLoad = useCallback(async (activeProjectId: string | undefined) => {
    try {
      await refreshPendingPermissions()
    } catch (rawError) {
      logger.warn("Agent pending permissions refresh failed.", {
        projectIds: projectIdsRef.current,
        activeProjectId,
        boundary: "renderer.agent.pending-permissions",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      dispatch({ type: "SET_ERROR", error: "权限刷新失败" })
    }
  }, [dispatch, projectIdsRef, refreshPendingPermissions])

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
      logger.error("Agent conversation refresh failed.", {
        projectId: target.projectId,
        targetConversationId: target.conversationId,
        targetSessionKey: target.sessionKey,
        boundary: "renderer.agent.conversation-refresh",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      dispatch({ type: "SET_ERROR", error: "刷新会话失败" })
    }
  }, [dispatch])

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
        refreshPendingPermissionsForPageLoad(nextProjectId),
        refreshProjectMeta(nextProjectId),
        refreshPersonas(),
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
      if (nextSession && nextProjectId) {
        await loadTimeline({
          projectId: nextProjectId,
          sessionKey: nextSessionKey,
          conversationId: nextSession.id,
        })
      } else {
        clearTimeline()
      }
    } catch (rawError) {
      logger.error("Agent refresh failed.", {
        projectIds: projectIdsRef.current,
        selectedProjectId: selectedProjectIdRef.current,
        selectedConversationId: selectedConversationIdRef.current,
        boundary: "renderer.agent.refresh",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      dispatch({ type: "SET_ERROR", error: "加载失败" })
    } finally {
      if (requestId === selectRequestIdRef.current) {
        dispatch({ type: "SET_LOADING", loading: false })
      }
    }
  }, [
    clearTimeline,
    dispatch,
    getDefaultProjectId,
    loadArchivedSessions,
    loadSessionsForProjects,
    loadTimeline,
    loadOlderTimeline,
    projectIdsRef,
    refreshPendingPermissionsForPageLoad,
    refreshProjectMeta,
    refreshPersonas,
    selectRequestIdRef,
    selectedConversationIdRef,
    selectedProjectIdRef,
    setSelectedSession,
  ])

  const createSession = useCallback(async (
    projectId: string,
    providerId?: string,
    mode?: SynapseAgentPermissionMode,
    modelTier?: string,
    name?: string,
    personaId?: string | null,
  ) => {
    if (!projectId) return undefined
    const requestId = selectRequestIdRef.current + 1
    selectRequestIdRef.current = requestId
    const bridge = requireSynapseBridge()
    dispatch({ type: "SET_ERROR", error: null })
    let session: SynapseAgentSessionSummary | undefined
    try {
      const sessionName = name?.trim() || `新会话 ${formatSessionNameTime(new Date())}`
      const created = await bridge.agent.createSession({
        projectId,
        sessionKey: DEFAULT_LOCAL_SESSION_KEY,
        name: sessionName,
        agentType: "claude-code",
        providerId,
        mode,
        modelTier,
        personaId,
      })
      const createdSession = normalizeSessionProject(created, projectId)
      session = createdSession
      if (requestId !== selectRequestIdRef.current) {
        dispatch({ type: "UPDATE_SESSIONS", updater: (current) => current.some((item) => isSameSession(item, createdSession))
          ? current
          : sortSessions([{ ...createdSession, active: false }, ...current]) })
        return createdSession
      }
      setSelectedSession(createdSession)
      dispatch({ type: "UPDATE_SESSIONS", updater: (current) => sortSessions([
        createdSession,
        ...current.map((item) => ({
          ...item,
          active: item.projectId === createdSession.projectId ? false : item.active,
        })).filter((item) => !isSameSession(item, createdSession)),
      ]) })
      dispatch({ type: "UPDATE_UNREAD", updater: (current) => clearConversationUnread(current, createdSession.projectId, createdSession.id) })
      clearTimeline()
    } catch (rawError) {
      if (requestId !== selectRequestIdRef.current) {
        return undefined
      }
      logger.error("Agent session create failed.", {
        projectId,
        providerId,
        mode,
        boundary: "renderer.agent.session-create",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      dispatch({ type: "SET_ERROR", error: recoverableAgentSessionCreateErrorMessage(rawError) ?? "创建失败" })
      return undefined
    }
    // Separate error boundary for post-creation refresh. A refresh failure
    // after a successful create should not be reported as "创建失败".
    try {
      await refresh()
    } catch {
      // refresh() has its own internal error handling; this catch is a safety
      // net in case a synchronous error somehow escapes to prevent an
      // unhandled rejection.
    }
    return session
  }, [clearTimeline, dispatch, refresh, selectRequestIdRef, setSelectedSession])

  const selectSession = useCallback(async (target: SynapseAgentSessionSummary) => {
    const bridge = requireSynapseBridge()
    const requestId = selectRequestIdRef.current + 1
    selectRequestIdRef.current = requestId
    dispatch({ type: "SET_ERROR", error: null })
    dispatch({ type: "SET_CONTEXT_USAGE", contextUsage: undefined })
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
      await Promise.all([
        refreshProjectMeta(session.projectId),
        refreshPendingPermissionsForPageLoad(session.projectId),
      ])
      await loadTimeline({
        projectId: session.projectId,
        sessionKey: session.sessionKey,
        conversationId: session.id,
      })
    } catch (rawError) {
      if (requestId !== selectRequestIdRef.current) {
        return
      }
      logger.error("Agent session switch failed.", {
        projectId: target.projectId,
        conversationId: target.id,
        sessionKey: target.sessionKey,
        boundary: "renderer.agent.session-switch",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      const isNotFound = (rawError as { code?: string })?.code === "AGENT_SESSION_NOT_FOUND"
      if (isNotFound) {
        const remaining = state.sessions.filter((item) => !isSameSession(item, target))
        dispatch({ type: "UPDATE_SESSIONS", updater: () => remaining })
        const next = remaining[0]
        if (next) {
          setSelectedSession(next)
          await refreshPendingPermissionsForPageLoad(next.projectId)
          await loadTimeline({
            projectId: next.projectId,
            sessionKey: next.sessionKey,
            conversationId: next.id,
          })
        } else {
          setSelectedSession(undefined)
          clearTimeline()
        }
        return
      }
      clearTimeline()
      dispatch({ type: "SET_ERROR", error: "切换失败" })
    }
  }, [
    clearTimeline,
    dispatch,
    loadTimeline,
    refreshPendingPermissionsForPageLoad,
    refreshProjectMeta,
    selectRequestIdRef,
    setSelectedSession,
    state.sessions,
  ])

  const sendMessage = useCallback(async (
    content: string,
    target?: SendMessageTarget,
    options: SendMessageOptions = {},
  ) => {
    const attachments = options.attachments ?? []
    const displayContent = content.trim()
    if (!displayContent && attachments.length === 0) return false
    const selected = target
      ? findSessionByRef(state.sessions, target.projectId, target.conversationId)
      : findSessionByRef(
        state.sessions,
        selectedProjectIdRef.current,
        selectedConversationIdRef.current,
      )
    const projectId = target?.projectId ?? selected?.projectId ?? getDefaultProjectId()
    if (!projectId) return false
    const conversationId = target?.conversationId ?? selected?.id
    const sessionKey = target?.sessionKey ?? selected?.sessionKey ?? selectedSessionKeyRef.current
    const now = new Date().toISOString()
    let optimisticItem: SynapseAgentMessageTimelineItem | undefined
    let didAppendOptimisticItem = false
    if (isSelectedTimelineTarget(target ?? {
      projectId,
      sessionKey,
      conversationId,
    }, {
      projectId: selectedProjectIdRef.current,
      conversationId: selectedConversationIdRef.current,
      sessionKey: selectedSessionKeyRef.current,
    })) {
      didAppendOptimisticItem = true
      const nextOptimisticItem = localUserTimelineItem(
        displayContent,
        now,
        state.timeline.length,
        optimisticMessageAttachments(attachments),
      ) as SynapseAgentMessageTimelineItem
      optimisticItem = nextOptimisticItem
      updateTimeline((current) => [...current, nextOptimisticItem])
    }
    if (conversationId) {
      pendingConversationIdsRef.current.add(conversationId)
      dispatch({ type: "ADD_SENDING_CONVERSATION", conversationId })
    }
    dispatch({ type: "SET_ERROR", error: null })
    try {
      const bridge = requireSynapseBridge()
      const result = await bridge.agent.send({
        projectId,
        sessionKey,
        conversationId,
        content: displayContent,
        displayContent,
        attachments: serializeDraftAttachments(attachments),
        clientSubmittedAt: now,
      })
      if (result?.error) throw new Error(result.error)
      // NOTE: send() resolves when the message is enqueued, NOT when the turn
      // completes.  REMOVE_SENDING_CONVERSATION is handled by the terminal
      // phase event handler in use-chat-events (cancelled / completed / failed)
      // so we must NOT remove here — doing so causes `sending` to briefly flash
      // false between enqueue and actual turn completion.
    } catch (rawError) {
      logger.error("Agent send failed.", {
        projectId,
        conversationId,
        sessionKey,
        messageLength: displayContent.length,
        boundary: "renderer.agent.send",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      dispatch({ type: "SET_ERROR", error: sendFailureDisplayMessage(rawError) })
      if (didAppendOptimisticItem && optimisticItem) {
        updateTimeline((current) => current.filter((item) => item.id !== optimisticItem.id))
      }
      // Only remove on enqueue failure — the turn never started, so no phase
      // event will fire to clean it up.
      if (conversationId) {
        pendingConversationIdsRef.current.delete(conversationId)
        dispatch({ type: "REMOVE_SENDING_CONVERSATION", conversationId })
      }
      return false
    }
    return true
  }, [dispatch, getDefaultProjectId, selectedConversationIdRef, selectedProjectIdRef, selectedSessionKeyRef, state.sessions, state.timeline.length, updateTimeline])

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
          dispatch({ type: "UPDATE_SESSIONS", updater: (current) => current.filter((session) => !isSameSession(session, target)) })
          dispatch({ type: "UPDATE_ARCHIVED_SESSIONS", updater: (current) => current.filter((session) => !isSameSession(session, target)) })
          toast("会话已删除")
          try {
            await refresh()
          } catch (refreshError) {
            logger.warn("Agent session list refresh after delete failed.", {
              projectId: target.projectId,
              conversationId: target.id,
              errorName: refreshError instanceof Error ? refreshError.name : typeof refreshError,
            })
          }
        }
        return
      }
      if (!result.ok) {
        dispatch({ type: "SET_ERROR", error: "会话不存在" })
        return
      }
      dispatch({ type: "UPDATE_UNREAD", updater: (current) => clearConversationUnread(current, target.projectId, target.id) })
      dispatch({ type: "UPDATE_SESSIONS", updater: (current) => current.filter((session) => !isSameSession(session, target)) })
      dispatch({ type: "UPDATE_ARCHIVED_SESSIONS", updater: (current) => current.filter((session) => !isSameSession(session, target)) })
      if (selectedProjectIdRef.current === target.projectId && selectedConversationIdRef.current === target.id) {
        const next = state.sessions.find((session) => !isSameSession(session, target))
        if (next) {
          try {
            const switched = await bridge.agent.switchSession({
              projectId: next.projectId,
              sessionKey: next.sessionKey,
              conversationId: next.id,
            })
            const session = normalizeSessionProject(switched, next.projectId)
            setSelectedSession(session)
            await loadTimeline({
              projectId: session.projectId,
              sessionKey: session.sessionKey,
              conversationId: session.id,
            })
            await refreshProjectMeta(session.projectId)
          } catch (rawError) {
            logger.warn("Agent delete fallback switch failed.", {
              projectId: next.projectId,
              deletedConversationId: target.id,
              conversationId: next.id,
              sessionKey: next.sessionKey,
              errorName: rawError instanceof Error ? rawError.name : typeof rawError,
              errorLength: errorMessage(rawError).length,
            })
            try {
              await refresh()
            } catch (refreshError) {
              logger.warn("Agent session list refresh after delete fallback failed.", {
                projectId: next.projectId,
                conversationId: target.id,
                errorName: refreshError instanceof Error ? refreshError.name : typeof refreshError,
              })
            }
          }
        } else {
          setSelectedSession(undefined)
          clearTimeline()
        }
      }
      toast("会话已删除")
    } catch (rawError) {
      if (requestId !== selectRequestIdRef.current) {
        return
      }
      logger.error("Agent session delete failed.", {
        projectId: target.projectId,
        conversationId: target.id,
        sessionKey: target.sessionKey,
        boundary: "renderer.agent.session-delete",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      dispatch({ type: "SET_ERROR", error: "删除失败" })
    }
  }, [
    clearTimeline,
    dispatch,
    loadTimeline,
    refresh,
    refreshProjectMeta,
    selectRequestIdRef,
    selectedConversationIdRef,
    selectedProjectIdRef,
    setSelectedSession,
    state.sessions,
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
        isSameSession(session, target) ? { ...session, name, updatedAt: new Date().toISOString() } : session) })
      dispatch({ type: "UPDATE_ARCHIVED_SESSIONS", updater: (current) => current.map((session) =>
        isSameSession(session, target) ? { ...session, name, updatedAt: new Date().toISOString() } : session) })
      toast("已重命名")
    } catch (rawError) {
      logger.error("Agent session rename failed.", {
        projectId: target.projectId,
        conversationId: target.id,
        sessionKey: target.sessionKey,
        boundary: "renderer.agent.session-rename",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      dispatch({ type: "SET_ERROR", error: "重命名失败" })
    }
  }, [dispatch])

  const setPermissionMode = useCallback(async (
    mode: SynapseAgentPermissionMode,
    target?: AgentConversationTarget,
  ) => {
    const resolved = resolveActionTarget(target, {
      projectId: selectedProjectIdRef.current,
      conversationId: selectedConversationIdRef.current,
    }, getDefaultProjectId)
    const projectId = resolved.projectId
    const conversationId = resolved.conversationId
    if (!projectId || !conversationId) return
    const bridge = requireSynapseBridge()
    dispatch({ type: "SET_ERROR", error: null })
    try {
      const updated = await bridge.agent.setPermissionMode({ projectId, conversationId, mode })
      dispatch({ type: "UPDATE_SESSIONS", updater: (current) =>
        current.map((session) => session.id === updated.id ? updated : session) })
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "切换失败"
      logger.error("Agent permission mode switch failed.", {
        projectId,
        conversationId,
        mode,
        boundary: "renderer.agent.permission-mode",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      dispatch({ type: "SET_ERROR", error: message })
    }
  }, [dispatch, getDefaultProjectId, selectedConversationIdRef, selectedProjectIdRef])

  const respondPermission = useCallback(async (
    target: PermissionResponseTarget,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
    scope?: SynapseAgentPermissionScope,
  ) => {
    const { projectId, requestId } = target
    const permissionKey = pendingPermissionKey(target)
    if (respondingPermissionKeysRef.current.has(permissionKey)) return
    respondingPermissionKeysRef.current.add(permissionKey)
    const bridge = requireSynapseBridge()
    dispatch({ type: "SET_ERROR", error: null })
    try {
      await bridge.agent.respondPermission({ projectId, requestId, behavior, scope, updatedInput, message })
      try {
        await refreshPendingPermissions()
      } catch (refreshError) {
        logger.warn("Permission list refresh failed after responding; permission response itself succeeded.", {
          projectId,
          requestId,
          behavior,
          errorName: refreshError instanceof Error ? refreshError.name : typeof refreshError,
          errorLength: errorMessage(refreshError).length,
        })
      }
    } catch (rawError) {
      logger.error("Agent permission response failed.", {
        projectId,
        requestId,
        behavior,
        boundary: "renderer.agent.permission-response",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      const stalePermission = isPermissionNotPendingError(rawError)
      if (stalePermission) {
        dispatch({
          type: "UPDATE_PENDING_PERMISSIONS",
          updater: (current) => current.filter((permission) =>
            pendingPermissionKey(permission) !== permissionKey),
        })
      }
      try {
        await refreshPendingPermissions()
      } catch (refreshError) {
        logger.warn("Permission list refresh failed after permission response error.", {
          projectId,
          requestId,
          behavior,
          stalePermission,
          errorName: refreshError instanceof Error ? refreshError.name : typeof refreshError,
          errorLength: errorMessage(refreshError).length,
        })
      }
      dispatch({
        type: "SET_ERROR",
        error: stalePermission ? "权限请求已失效，请重新发送或继续当前对话" : "处理失败",
      })
      throw rawError
    } finally {
      respondingPermissionKeysRef.current.delete(permissionKey)
    }
  }, [dispatch, refreshPendingPermissions])

  const cancelTurn = useCallback(async (target?: AgentConversationTarget) => {
    const resolved = resolveActionTarget(target, {
      projectId: selectedProjectIdRef.current,
      conversationId: selectedConversationIdRef.current,
    }, getDefaultProjectId)
    const projectId = resolved.projectId
    const conversationId = resolved.conversationId
    if (!projectId || !conversationId) return
    const bridge = requireSynapseBridge()
    dispatch({ type: "CANCEL_REQUESTED" })
    try {
      const result = await bridge.agent.cancelTurn({ projectId, conversationId })
      if (result.status === "hard-killed") {
        dispatch({ type: "SET_CANCEL_PHASE", cancelPhase: "cancelled" })
      } else if (result.status === "no-active-turn") {
        dispatch({ type: "CANCEL_RESET" })
      }
    } catch (rawError) {
      logger.error("Agent cancel turn failed.", {
        projectId,
        conversationId,
        boundary: "renderer.agent.cancel-turn",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      dispatch({ type: "CANCEL_RESET" })
      dispatch({ type: "SET_ERROR", error: "停止失败" })
    }
  }, [dispatch, getDefaultProjectId, selectedConversationIdRef, selectedProjectIdRef])

  const forceKillTurn = useCallback(async (target?: AgentConversationTarget) => {
    const resolved = resolveActionTarget(target, {
      projectId: selectedProjectIdRef.current,
      conversationId: selectedConversationIdRef.current,
    }, getDefaultProjectId)
    const projectId = resolved.projectId
    const conversationId = resolved.conversationId
    if (!projectId || !conversationId) return
    const bridge = requireSynapseBridge()
    try {
      const result = await bridge.agent.forceKillTurn({ projectId, conversationId })
      if (result.status === "hard-killed") {
        dispatch({ type: "SET_CANCEL_PHASE", cancelPhase: "cancelled" })
      } else if (result.status === "no-active-turn") {
        dispatch({ type: "CANCEL_RESET" })
      }
    } catch (rawError) {
      logger.error("Agent force kill turn failed.", {
        projectId,
        conversationId,
        boundary: "renderer.agent.force-kill-turn",
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessage(rawError).length,
      })
      dispatch({ type: "CANCEL_RESET" })
      dispatch({ type: "SET_ERROR", error: "强制停止失败" })
    }
  }, [dispatch, getDefaultProjectId, selectedConversationIdRef, selectedProjectIdRef])

  return {
    replaceTimeline,
    updateTimeline,
    clearTimeline,
    getDefaultProjectId,
    setSelectedSession,
    loadTimeline,
    loadOlderTimeline,
    loadArchivedSessions,
    refreshPendingPermissions,
    refreshProjectMeta,
    refreshConversationSnapshot,
    refresh,
    refreshPersonas,
    createSession,
    selectSession,
    sendMessage,
    deleteSession,
    renameSession,
    setPermissionMode,
    respondPermission,
    cancelTurn,
    forceKillTurn,
  }
}

export { useChatConnection }
export type {
  ChatConnectionRefs,
  ChatConnectionResult,
  PermissionResponseTarget,
  SendMessageOptions,
  SendMessageTarget,
  TimelineTarget,
  TimelineLoadMode,
}

function filterPersistedTimelineEntries(
  entries: readonly SynapseAgentTimelineItem[],
): SynapseAgentTimelineItem[] {
  return entries.filter((entry) => {
    if (entry.kind === "error") return Boolean(entry.message && entry.message.trim().length > 0)
    if (entry.kind === "message" && entry.role !== "user") return entry.content.trim().length > 0
    return true
  })
}

function mergePersistedTimelineTail(
  current: readonly SynapseAgentTimelineItem[],
  persisted: readonly SynapseAgentTimelineItem[],
  startIndex: number,
): SynapseAgentTimelineItem[] {
  const prefix = current.filter((item) => {
    const index = persistedHistoryIndex(item)
    return index !== undefined && index < startIndex
  })
  return insertActivePhases(dedupeTimelineEntries([...prefix, ...persisted]), current)
}

function prependTimelineEntries(
  current: readonly SynapseAgentTimelineItem[],
  older: readonly SynapseAgentTimelineItem[],
): SynapseAgentTimelineItem[] {
  return dedupeTimelineEntries([...older, ...current])
}

function insertActivePhases(
  persisted: SynapseAgentTimelineItem[],
  current: readonly SynapseAgentTimelineItem[],
): SynapseAgentTimelineItem[] {
  const activePhases = current.filter(
    (item) => item.kind === "phase" && item.status === "in-progress",
  )
  if (activePhases.length === 0) return persisted
  let lastUserIndex = -1
  for (let index = persisted.length - 1; index >= 0; index -= 1) {
    const candidate = persisted[index]
    if (candidate?.kind === "message" && candidate.role === "user") {
      lastUserIndex = index
      break
    }
  }
  const insertionIndex = lastUserIndex < 0 ? persisted.length : lastUserIndex + 1
  persisted.splice(insertionIndex, 0, ...activePhases)
  return persisted
}

function dedupeTimelineEntries(
  entries: readonly SynapseAgentTimelineItem[],
): SynapseAgentTimelineItem[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
}

function persistedHistoryIndex(item: SynapseAgentTimelineItem): number | undefined {
  const match = item.id.match(/:history:(\d+)$/)
  if (!match?.[1]) return undefined
  const index = Number(match[1])
  return Number.isSafeInteger(index) ? index : undefined
}

async function backfillTimelineGap(
  getTimeline: (args: {
    projectId: string
    sessionKey?: string
    conversationId?: string
    limit?: number
    beforeIndex?: number
  }) => Promise<SynapseAgentTimelineResult>,
  target: TimelineTarget,
  latest: SynapseAgentTimelineResult,
  loadedEndIndex: number,
): Promise<SynapseAgentTimelineResult> {
  if (latest.startIndex <= loadedEndIndex) return latest
  const pages = [latest]
  let cursor = latest.startIndex
  while (cursor > loadedEndIndex) {
    const older = await getTimeline({ ...target, limit: 100, beforeIndex: cursor })
    if (older.startIndex >= cursor) {
      throw new Error("Timeline pagination did not advance")
    }
    pages.unshift(older)
    cursor = older.startIndex
    if (!older.hasMore) break
  }
  if (cursor > loadedEndIndex) {
    throw new Error("Timeline pagination gap could not be filled")
  }
  return {
    ...latest,
    entries: dedupeTimelineEntries(pages.flatMap((page) => page.entries)),
    startIndex: cursor,
  }
}

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

function isSelectedTimelineTarget(
  target: SendMessageTarget,
  selected: {
    readonly projectId?: string
    readonly conversationId?: string
    readonly sessionKey: string
  },
): boolean {
  if (target.projectId !== selected.projectId) return false
  if (target.conversationId && selected.conversationId) {
    return target.conversationId === selected.conversationId
  }
  return target.sessionKey === selected.sessionKey
}

function resolveActionTarget(
  explicitTarget: AgentConversationTarget | undefined,
  selected: {
    readonly projectId?: string
    readonly conversationId?: string
  },
  getDefaultProjectId: () => string | undefined,
): { readonly projectId?: string; readonly conversationId?: string } {
  if (explicitTarget) {
    return {
      projectId: explicitTarget.projectId,
      conversationId: explicitTarget.conversationId,
    }
  }
  return {
    projectId: selected.projectId ?? getDefaultProjectId(),
    conversationId: selected.conversationId,
  }
}

function serializeDraftAttachments(
  attachments: readonly AgentDraftAttachment[],
): SynapseAgentBridgeAttachment[] | undefined {
  if (attachments.length === 0) return undefined
  return attachments.map((attachment, order) => ({
    attachmentId: attachment.attachmentId,
    order,
  }))
}

function optimisticMessageAttachments(
  attachments: readonly AgentDraftAttachment[],
): readonly SynapseAgentMessageAttachment[] | undefined {
  if (attachments.length === 0) return undefined
  return attachments.map((attachment) => {
    if (attachment.kind !== "image") {
      return {
        kind: "path",
        path: attachment.name,
        entryType: attachment.kind,
        name: attachment.name,
        byteSize: attachment.byteSize,
      }
    }
    return {
      kind: "image",
      id: attachment.attachmentId,
      name: attachment.name,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
      url: attachment.previewUrl,
    }
  })
}

function sessionSnapshotForLog(
  sessions: readonly SynapseAgentSessionSummary[],
): Array<Record<string, unknown>> {
  return sessions.slice(0, 10).map((session) => ({
    projectId: session.projectId,
    id: session.id,
    platform: session.platform,
    sourceLabel: session.sourceLabel,
    active: session.active,
    historyCount: session.historyCount,
    updatedAt: session.updatedAt,
  }))
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === "string" ? error : "Unknown error"
}

function recoverableAgentSessionCreateErrorMessage(error: unknown): string | null {
  const message = errorMessage(error)
  return isRecoverableKnowledgeBaseWorkspaceErrorMessage(message) ? message : null
}

function isRecoverableKnowledgeBaseWorkspaceErrorMessage(message: string): boolean {
  return message === "知识库运行目录不存在。请重新创建知识库或从备份恢复。"
    || message === "无法访问知识库运行目录。请检查磁盘权限后重试。"
}

function sendFailureDisplayMessage(error: unknown): string {
  const message = errorMessage(error)
  return isAttachmentFailureMessage(message) ? message : "发送失败"
}

function isAttachmentFailureMessage(message: string): boolean {
  return message === "图片附件过大。"
    || message === "附件路径不存在。"
    || message === "附件路径不能是符号链接。"
    || message === "附件路径必须是文件或文件夹。"
    || message === "当前会话无法访问新附件路径。请开启新会话后重试。"
}

function isPermissionNotPendingError(error: unknown): boolean {
  const message = errorMessage(error)
  return message === "该权限请求已不在等待中。"
    || (message.includes("Permission request") && message.includes("is not pending"))
}

function formatSessionNameTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}
