import { useEffect, useRef } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { appendAgentTimelineEvent } from "@/lib/agent-timeline"
import type { SynapseAgentDomainEvent, SynapseAgentEvent, SynapseAgentStreamDomainEvent } from "@/types/agent"
import { reducePhaseEvent } from "../utils/phase-reducer"
import {
  clearConversationUnread,
  incrementUnreadForConversation,
  isSelectedConversation,
  shouldApplyPhaseUpdate,
} from "../live-sync"
import type { ChatAction, ChatState } from "./use-chat-reducer"
import type { ChatConnectionRefs, ChatConnectionResult } from "./use-chat-connection"
import { errorLogMeta, pendingPermissionKey } from "../utils"

const logger = createRendererLogger("agent")
// Token-level SDK deltas can arrive hundreds of times per second; batching
// them keeps live text layout stable while preserving event order.
const STREAM_EVENT_FLUSH_DELAY_MS = 50
const REDACTED_SESSION_KEY = "[redacted]"

type ChatEventRefs = ChatConnectionRefs

function useChatEvents(
  state: ChatState,
  dispatch: React.Dispatch<ChatAction>,
  refs: ChatEventRefs,
  connection: Pick<ChatConnectionResult, "loadTimeline" | "refreshConversationSnapshot" | "refreshPendingPermissions" | "updateTimeline">,
  projectIdsKey: string,
): void {
  const {
    projectIdsRef,
    selectedProjectIdRef,
    selectedConversationIdRef,
    selectedSessionKeyRef,
    pendingConversationIdsRef,
  } = refs
  const { loadTimeline, refreshConversationSnapshot, refreshPendingPermissions, updateTimeline } = connection

  const sessionsRef = useRef(state.sessions)
  sessionsRef.current = state.sessions
  const agentTypeRef = useRef(state.status?.agentType)
  agentTypeRef.current = state.status?.agentType
  const streamEventsRef = useRef<SynapseAgentStreamDomainEvent[]>([])
  const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const terminalConversationTimestampsRef = useRef(new Map<string, number>())

  useEffect(() => {
    if (projectIdsRef.current.length === 0) return undefined
    const bridge = getSynapseBridge()
    if (!bridge) return undefined
    const clearStreamFlushTimer = () => {
      if (!streamFlushTimerRef.current) return
      clearTimeout(streamFlushTimerRef.current)
      streamFlushTimerRef.current = undefined
    }
    const agentTypeForSelectedSession = () =>
      sessionsRef.current.find((session) =>
        session.projectId === selectedProjectIdRef.current
        && session.id === selectedConversationIdRef.current)?.agentType
      ?? agentTypeRef.current
    const flushStreamEvents = () => {
      if (streamEventsRef.current.length === 0) return
      clearStreamFlushTimer()
      const selected = {
        projectId: selectedProjectIdRef.current,
        conversationId: selectedConversationIdRef.current,
        sessionKey: selectedSessionKeyRef.current,
      }
      const events = streamEventsRef.current.filter((event) =>
        matchesSelectedEvent(event, selected))
      streamEventsRef.current = []
      if (events.length === 0) return
      const agentType = agentTypeForSelectedSession()
      updateTimeline((current) => events.reduce(
        (next, event) => appendAgentTimelineEvent(next, event.payload.event, event.timestamp, agentType),
        current,
      ))
    }
    const scheduleStreamFlush = () => {
      if (streamFlushTimerRef.current) return
      streamFlushTimerRef.current = setTimeout(flushStreamEvents, STREAM_EVENT_FLUSH_DELAY_MS)
    }
    const unsubscribe = bridge.agent.onEvent((domainEvent) => {
      if (!projectIdsRef.current.includes(domainEvent.payload.projectId)) {
        logger.info("Agent event ignored for untracked project.", {
          currentProjectIds: projectIdsRef.current,
          eventProjectId: domainEvent.payload.projectId,
          eventType: domainEvent.type,
          conversationId: "conversationId" in domainEvent.payload
            ? domainEvent.payload.conversationId
            : undefined,
          sessionKey: redactSessionKey(domainEvent.payload.sessionKey),
          platform: "platform" in domainEvent.payload ? domainEvent.payload.platform : undefined,
        })
        return
      }
      if (!isSdkStreamDeltaEvent(domainEvent)) {
        flushStreamEvents()
      }
      if (domainEvent.type === "phase.update") {
        const payload = domainEvent.payload
        if (isTerminalPhase(payload.phase, payload.status) && payload.conversationId) {
          markConversationTerminal(terminalConversationTimestampsRef.current, payload.conversationId, domainEvent.timestamp)
          pendingConversationIdsRef.current.delete(payload.conversationId)
          dispatch({ type: "REMOVE_SENDING_CONVERSATION", conversationId: payload.conversationId })
        } else if (
          payload.status === "in-progress"
          && payload.conversationId
          && isAfterLastTerminal(
            terminalConversationTimestampsRef.current,
            payload.conversationId,
            domainEvent.timestamp,
          )
        ) {
          dispatch({ type: "ADD_SENDING_CONVERSATION", conversationId: payload.conversationId })
        }
        const selectedProject = selectedProjectIdRef.current
        const selectedConv = selectedConversationIdRef.current
        const selectedSession = selectedSessionKeyRef.current
        const shouldApplyPhase = shouldApplyPhaseUpdate({
          projectId: payload.projectId,
          conversationId: payload.conversationId,
          sessionKey: payload.sessionKey,
        }, {
          projectId: selectedProject,
          conversationId: selectedConv,
          sessionKey: selectedSession,
        }, {
          pendingConversationIds: pendingConversationIdsRef.current,
        })
        if (!shouldApplyPhase) {
          logger.debug("Phase event ignored for inactive conversation.", {
            projectId: payload.projectId,
            sessionKey: redactSessionKey(payload.sessionKey),
            conversationId: payload.conversationId,
            phase: payload.phase,
            status: payload.status,
            selectedProjectId: selectedProject,
            selectedConversationId: selectedConv,
            selectedSessionKey: redactSessionKey(selectedSession),
            pendingConversation: payload.conversationId
              ? pendingConversationIdsRef.current.has(payload.conversationId)
              : false,
          })
          return
        }
        updateTimeline((current) => reducePhaseEvent(current, {
          runId: payload.runId,
          projectId: payload.projectId,
          sessionKey: payload.sessionKey,
          conversationId: payload.conversationId,
          phase: payload.phase,
          status: payload.status,
          startedAt: payload.startedAt,
          completedAt: payload.completedAt,
          errorMessage: payload.errorMessage,
          errorKind: payload.errorKind,
          recoverable: payload.recoverable,
          eventTimestamp: domainEvent.timestamp,
        }))
        if (payload.phase === "cancel_pending") {
          dispatch({ type: "SET_CANCEL_PHASE", cancelPhase: "cancel_pending" })
        }
        if (payload.phase === "cancelled" || payload.phase === "failed" || (payload.phase === "completed" && payload.status === "done")) {
          // All terminal phases reset cancelPhase back to idle so the next
          // turn starts with a clean state.
          dispatch({ type: "CANCEL_RESET" })
        }
        return
      }
      if (domainEvent.type === "conversationUpdated") {
        const selected = {
          projectId: selectedProjectIdRef.current,
          conversationId: selectedConversationIdRef.current,
          sessionKey: selectedSessionKeyRef.current,
        }
        const selectedUpdate = isSelectedConversation(domainEvent.payload, selected)
        logger.info("Agent conversation update event received.", {
          projectId: domainEvent.payload.projectId,
          conversationId: domainEvent.payload.conversationId,
          sessionKey: redactSessionKey(domainEvent.payload.sessionKey),
          platform: domainEvent.payload.platform,
          selectedProjectId: selected.projectId,
          selectedConversationId: selected.conversationId,
          selectedSessionKey: redactSessionKey(selected.sessionKey),
          selectedUpdate,
        })

        const pendingConversation = domainEvent.payload.conversationId
          ? pendingConversationIdsRef.current.has(domainEvent.payload.conversationId)
          : false
        const shouldRefreshSnapshot = selectedUpdate
          || pendingConversation
          || domainEvent.payload.platform !== "workflow"
        if (shouldRefreshSnapshot) {
          void refreshConversationSnapshot(domainEvent.payload)
        }
        if (selectedUpdate) {
          dispatch({ type: "UPDATE_UNREAD", updater: (current) => clearConversationUnread(
            current,
            domainEvent.payload.projectId,
            domainEvent.payload.conversationId,
          ) })
          void loadTimeline(domainEvent.payload, "refresh-tail").catch((rawError: unknown) => {
            logger.error("Agent live timeline refresh failed.", {
              projectId: domainEvent.payload.projectId,
              conversationId: domainEvent.payload.conversationId,
              sessionKey: redactSessionKey(domainEvent.payload.sessionKey),
              platform: domainEvent.payload.platform,
              boundary: "renderer.agent.live-timeline",
              selectedUpdate,
              ...errorLogMeta(rawError),
            })
            dispatch({ type: "SET_ERROR", error: "加载会话失败" })
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
        return
      }
      const activeConversationId = streamEventConversationId(domainEvent)
      if (activeConversationId) {
        if (isTerminalAgentEvent(domainEvent)) {
          markConversationTerminal(terminalConversationTimestampsRef.current, activeConversationId, domainEvent.timestamp)
          pendingConversationIdsRef.current.delete(activeConversationId)
          dispatch({ type: "REMOVE_SENDING_CONVERSATION", conversationId: activeConversationId })
          dispatch({ type: "CANCEL_RESET" })
        } else if (isAfterLastTerminal(
          terminalConversationTimestampsRef.current,
          activeConversationId,
          domainEvent.timestamp,
        )) {
          pendingConversationIdsRef.current.add(activeConversationId)
          dispatch({ type: "ADD_SENDING_CONVERSATION", conversationId: activeConversationId })
        }
      }
      if (isSdkStreamDeltaEvent(domainEvent)) {
        streamEventsRef.current.push(domainEvent)
        scheduleStreamFlush()
        return
      }
      const agentType = agentTypeForSelectedSession()
      updateTimeline((current) =>
        appendAgentTimelineEvent(current, domainEvent.payload.event, domainEvent.timestamp, agentType))
      const event = domainEvent.payload.event
      const resultModel = event.type === "result" ? event.metadata?.model : undefined
      if (resultModel) {
        dispatch({ type: "SET_CURRENT_CONVERSATION_MODEL", model: resultModel })
      }
      // Immediately upsert pending requests into local state so the
      // permission or answer card stays interactive even if the async refresh
      // (listPendingPermissions IPC) fails. A subsequent successful refresh
      // will overwrite with the authoritative server state.
      if (event.type === "permissionRequest") {
        const conversationId = streamEventConversationId(domainEvent)
        if (!conversationId) {
          logger.warn("Agent permission request ignored without conversation scope.", {
            projectId: domainEvent.payload.projectId,
            sessionKey: redactSessionKey(domainEvent.payload.sessionKey),
            platform: domainEvent.payload.platform,
            requestId: event.requestId,
          })
          return
        }
        dispatch({
          type: "UPDATE_PENDING_PERMISSIONS",
          updater: (current) => {
            const pendingPermission = {
              requestId: event.requestId,
              projectId: domainEvent.payload.projectId,
              sessionKey: domainEvent.payload.sessionKey,
              conversationId,
              toolName: event.toolName,
              toolInput: event.toolInput,
              toolInputRaw: event.toolInputRaw,
              questions: event.questions,
              blockedPath: event.blockedPath,
              sessionDirectoryGrantAvailable: event.sessionDirectoryGrantAvailable,
              createdAt: domainEvent.timestamp,
            }
            const key = pendingPermissionKey(pendingPermission)
            if (current.some((permission) => pendingPermissionKey(permission) === key)) return current
            return current.concat(pendingPermission)
          },
        })
      }
      if (shouldRefreshPendingPermissionsAfterEvent(event)) {
        void refreshPendingPermissions().catch((rawError: unknown) => {
          logger.error("Agent pending permissions refresh failed.", {
            projectId: domainEvent.payload.projectId,
            conversationId: streamEventConversationId(domainEvent),
            sessionKey: redactSessionKey(domainEvent.payload.sessionKey),
            platform: domainEvent.payload.platform,
            eventType: domainEvent.type,
            boundary: "renderer.agent.pending-permissions",
            ...errorLogMeta(rawError),
          })
          dispatch({ type: "SET_ERROR", error: "权限刷新失败" })
        })
      }
    })
    return () => {
      clearStreamFlushTimer()
      streamEventsRef.current = []
      unsubscribe()
    }
  }, [
    dispatch,
    loadTimeline,
    projectIdsKey,
    projectIdsRef,
    refreshConversationSnapshot,
    refreshPendingPermissions,
    selectedConversationIdRef,
    selectedProjectIdRef,
    selectedSessionKeyRef,
    updateTimeline,
  ])
}

export { useChatEvents }

function isSdkStreamDeltaEvent(
  event: SynapseAgentDomainEvent,
): event is SynapseAgentStreamDomainEvent & { readonly type: "stream" } {
  return event.type === "stream" && event.payload.event.type === "stream"
}
export type { ChatEventRefs }

function isTerminalPhase(phase: string, status: string): boolean {
  return phase === "cancelled" || phase === "failed" || (phase === "completed" && status === "done")
}

function isTerminalAgentEvent(domainEvent: SynapseAgentDomainEvent): boolean {
  if (!("event" in domainEvent.payload)) return false
  const event = domainEvent.payload.event
  return event.type === "result" || event.type === "error"
}

function shouldRefreshPendingPermissionsAfterEvent(event: SynapseAgentEvent): boolean {
  return event.type === "permissionRequest"
    || event.type === "toolResult"
    || event.type === "result"
    || event.type === "error"
}

function redactSessionKey(sessionKey: string | undefined): string | undefined {
  return sessionKey ? REDACTED_SESSION_KEY : undefined
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
    conversationId: streamEventConversationId(domainEvent),
    sessionKey: domainEvent.payload.sessionKey,
  }, selected)
}

function streamEventConversationId(domainEvent: SynapseAgentDomainEvent): string | undefined {
  if (domainEvent.scope?.sessionId) return domainEvent.scope.sessionId
  if (!("event" in domainEvent.payload)) return undefined

  const event = domainEvent.payload.event
  if (!("conversationId" in event)) return undefined

  const conversationId = event.conversationId
  return typeof conversationId === "string" && conversationId.length > 0
    ? conversationId
    : undefined
}

function markConversationTerminal(
  terminalTimestamps: Map<string, number>,
  conversationId: string,
  timestamp: string,
): void {
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return
  const current = terminalTimestamps.get(conversationId)
  if (current === undefined || parsed > current) {
    terminalTimestamps.set(conversationId, parsed)
  }
}

function isAfterLastTerminal(
  terminalTimestamps: ReadonlyMap<string, number>,
  conversationId: string,
  timestamp: string,
): boolean {
  const terminalAt = terminalTimestamps.get(conversationId)
  if (terminalAt === undefined) return true
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return true
  return parsed > terminalAt
}
