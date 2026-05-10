import { useCallback, useRef } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
import { localUserTimelineItem } from "@/lib/agent-timeline"
import type {
  SynapseAgentSessionSummary,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { DEFAULT_LOCAL_SESSION_KEY } from "../utils"
import {
  clearConversationUnread,
  shouldApplyTimelineSnapshot,
} from "../live-sync"
import type { ChatAction, ChatState } from "./use-chat-reducer"

const logger = createRendererLogger("agent")

type TimelineTarget = {
  readonly projectId: string
  readonly sessionKey: string
  readonly conversationId?: string
}

type ChatConnectionRefs = {
  readonly projectIdsRef: React.RefObject<string[]>
  readonly defaultProjectIdRef: React.RefObject<string | undefined>
  readonly selectedProjectIdRef: React.RefObject<string | undefined>
  readonly selectedConversationIdRef: React.RefObject<string | undefined>
  readonly selectedSessionKeyRef: React.RefObject<string>
  readonly selectRequestIdRef: React.RefObject<number>
  readonly timelineVersionRef: React.RefObject<number>
}

type ChatConnectionResult = {
  readonly replaceTimeline: (entries: SynapseAgentTimelineItem[]) => void
  readonly updateTimeline: (updater: (current: SynapseAgentTimelineItem[]) => SynapseAgentTimelineItem[]) => void
  readonly clearTimeline: () => void
  readonly getDefaultProjectId: () => string | undefined
  readonly setSelectedSession: (session: SynapseAgentSessionSummary | undefined) => void
  readonly loadTimeline: (target: TimelineTarget) => Promise<void>
  readonly loadArchivedSessions: () => Promise<void>
  readonly refreshPendingPermissions: () => Promise<void>
  readonly refreshProjectMeta: (projectId: string | undefined) => Promise<void>
  readonly refreshConversationSnapshot: (target: TimelineTarget) => Promise<void>
  readonly refresh: () => Promise<void>
  readonly createSession: (projectId: string, agentType: string) => Promise<void>
  readonly selectSession: (session: SynapseAgentSessionSummary) => Promise<void>
  readonly sendMessage: (content: string) => Promise<void>
  readonly deleteSession: (session: SynapseAgentSessionSummary) => Promise<void>
  readonly renameSession: (session: SynapseAgentSessionSummary, name: string) => Promise<void>
  readonly respondPermission: (requestId: string, behavior: "allow" | "deny") => Promise<void>
  readonly cancelTurn: () => Promise<void>
  readonly forceKillTurn: () => Promise<void>
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
  } = refs

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
    replaceTimeline([])
  }, [replaceTimeline])

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
    // Strip empty entries that may have been persisted during cancel/error
    // paths (e.g. empty error records, empty assistant messages).
    const dbEntries = result.entries.filter((entry) => {
      if (entry.kind === "error") return Boolean(entry.message && entry.message.trim().length > 0)
      if (entry.kind === "message" && entry.role !== "user") return entry.content.trim().length > 0
      return true
    })
    // Phase items are renderer-only in Plan A (not persisted). When DB-backed
    // entries replace the timeline, preserve in-flight phase rows AND anchor
    // them right after the most recent user message — sorting by `timestamp`
    // is unreliable because the backend stamps the user message at persist
    // time (often AFTER the IPC handler has already emitted the early
    // `submitted` / `received` events), which would float phase rows above
    // the user bubble.
    updateTimeline((current) => {
      // Only preserve phase items that are still in-progress (belong to the
      // active turn). Completed / failed / cancelled phase rows from previous
      // turns must NOT survive a DB-backed timeline reload — otherwise they
      // accumulate across turns and appear under the wrong user message.
      const activePhaseItems = current.filter(
        (item) => item.kind === "phase" && item.status === "in-progress",
      )
      if (activePhaseItems.length === 0) return [...dbEntries]
      let lastUserIdx = -1
      for (let i = dbEntries.length - 1; i >= 0; i--) {
        const candidate = dbEntries[i]
        if (candidate.kind === "message" && candidate.role === "user") {
          lastUserIdx = i
          break
        }
      }
      if (lastUserIdx < 0) return [...dbEntries, ...activePhaseItems]
      const out: SynapseAgentTimelineItem[] = [...dbEntries]
      out.splice(lastUserIdx + 1, 0, ...activePhaseItems)
      return out
    })
  }, [updateTimeline, selectedConversationIdRef, selectedProjectIdRef, selectedSessionKeyRef, timelineVersionRef])

  const loadSessionsForProjects = useCallback(async () => {
    const bridge = requireSynapseBridge()
    const groups = await Promise.all(projectIdsRef.current.map(async (projectId) => {
      const projectSessions = await bridge.agent.listSessions(projectId)
      return projectSessions.map((session) => normalizeSessionProject(session, projectId))
    }))
    return sortSessions(groups.flat())
  }, [projectIdsRef])

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
      bridge.agent.getProviders(projectId),
      bridge.agent.listCommands(projectId),
    ])
    dispatch({ type: "SET_STATUS", status: nextStatus })
    dispatch({ type: "SET_PROVIDERS", providers: nextProviders })
    dispatch({ type: "SET_COMMANDS", commands: nextCommands })
  }, [dispatch])

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
    dispatch,
    getDefaultProjectId,
    loadArchivedSessions,
    loadSessionsForProjects,
    loadTimeline,
    projectIdsRef,
    refreshPendingPermissions,
    refreshProjectMeta,
    selectRequestIdRef,
    selectedConversationIdRef,
    selectedProjectIdRef,
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
      await refresh()
    } catch (rawError) {
      if (requestId !== selectRequestIdRef.current) {
        return
      }
      const message = rawError instanceof Error ? rawError.message : "创建失败"
      logger.error("Agent session create failed.", rawError)
      dispatch({ type: "SET_ERROR", error: message })
    }
  }, [clearTimeline, dispatch, refresh, selectRequestIdRef, setSelectedSession])

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
      const isNotFound = rawError instanceof Error && rawError.message.includes("不存在")
      if (isNotFound) {
        const remaining = state.sessions.filter((item) => !isSameSession(item, target))
        dispatch({ type: "UPDATE_SESSIONS", updater: () => remaining })
        const next = remaining[0]
        if (next) {
          setSelectedSession(next)
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
      dispatch({ type: "SET_ERROR", error: rawError instanceof Error ? rawError.message : "切换失败" })
    }
  }, [clearTimeline, dispatch, loadTimeline, refreshProjectMeta, selectRequestIdRef, setSelectedSession, state.sessions])

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    const selected = findSessionByRef(
      state.sessions,
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
        clientSubmittedAt: now,
      })
      // NOTE: send() resolves when the message is enqueued, NOT when the turn
      // completes.  REMOVE_SENDING_CONVERSATION is handled by the terminal
      // phase event handler in use-chat-events (cancelled / completed / failed)
      // so we must NOT remove here — doing so causes `sending` to briefly flash
      // false between enqueue and actual turn completion.
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "发送失败"
      logger.error("Agent send failed.", rawError)
      dispatch({ type: "SET_ERROR", error: message })
      // Only remove on enqueue failure — the turn never started, so no phase
      // event will fire to clean it up.
      if (conversationId) {
        dispatch({ type: "REMOVE_SENDING_CONVERSATION", conversationId })
      }
    }
  }, [dispatch, getDefaultProjectId, selectedConversationIdRef, selectedProjectIdRef, selectedSessionKeyRef, state.sessions, updateTimeline])

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
          toast("会话已删除")
        }
        return
      }
      if (!result.ok) {
        dispatch({ type: "SET_ERROR", error: "会话不存在" })
        return
      }
      dispatch({ type: "UPDATE_UNREAD", updater: (current) => clearConversationUnread(current, target.projectId, target.id) })
      dispatch({ type: "UPDATE_SESSIONS", updater: (current) => current.filter((session) => !isSameSession(session, target)) })
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
          } catch {
            setSelectedSession(next)
            await loadTimeline({
              projectId: next.projectId,
              sessionKey: next.sessionKey,
              conversationId: next.id,
            })
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
      const message = rawError instanceof Error ? rawError.message : "删除失败"
      logger.error("Agent session delete failed.", rawError)
      dispatch({ type: "SET_ERROR", error: message })
    }
  }, [
    clearTimeline,
    dispatch,
    loadTimeline,
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
        isSameSession(session, target) ? { ...session, name } : session) })
      toast("已重命名")
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : "重命名失败"
      logger.error("Agent session rename failed.", rawError)
      dispatch({ type: "SET_ERROR", error: message })
    }
  }, [dispatch])

  const respondPermission = useCallback(async (
    requestId: string,
    behavior: "allow" | "deny",
  ) => {
    const projectId = state.pendingPermissions.find((permission) => permission.requestId === requestId)?.projectId
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
  }, [dispatch, getDefaultProjectId, refreshPendingPermissions, state.pendingPermissions])

  const cancelTurn = useCallback(async () => {
    const projectId = selectedProjectIdRef.current ?? getDefaultProjectId()
    const conversationId = selectedConversationIdRef.current
    if (!projectId || !conversationId) return
    const bridge = requireSynapseBridge()
    dispatch({ type: "CANCEL_REQUESTED" })
    try {
      const result = await bridge.agent.cancelTurn({ projectId, conversationId })
      if (result.status === "hard-killed") {
        dispatch({ type: "SET_CANCEL_PHASE", cancelPhase: "cancelled" })
      }
    } catch (rawError) {
      logger.error("Agent cancel turn failed.", rawError)
      dispatch({ type: "CANCEL_RESET" })
    }
  }, [dispatch, getDefaultProjectId, selectedConversationIdRef, selectedProjectIdRef])

  const forceKillTurn = useCallback(async () => {
    const projectId = selectedProjectIdRef.current ?? getDefaultProjectId()
    const conversationId = selectedConversationIdRef.current
    if (!projectId || !conversationId) return
    const bridge = requireSynapseBridge()
    try {
      await bridge.agent.forceKillTurn({ projectId, conversationId })
      dispatch({ type: "SET_CANCEL_PHASE", cancelPhase: "cancelled" })
    } catch (rawError) {
      logger.error("Agent force kill turn failed.", rawError)
    }
  }, [dispatch, getDefaultProjectId, selectedConversationIdRef, selectedProjectIdRef])

  return {
    replaceTimeline,
    updateTimeline,
    clearTimeline,
    getDefaultProjectId,
    setSelectedSession,
    loadTimeline,
    loadArchivedSessions,
    refreshPendingPermissions,
    refreshProjectMeta,
    refreshConversationSnapshot,
    refresh,
    createSession,
    selectSession,
    sendMessage,
    deleteSession,
    renameSession,
    respondPermission,
    cancelTurn,
    forceKillTurn,
  }
}

export { useChatConnection }
export type { ChatConnectionRefs, ChatConnectionResult, TimelineTarget }

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
