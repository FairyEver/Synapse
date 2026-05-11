import { useEffect } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { appendAgentTimelineEvent } from "@/lib/agent-timeline"
import type { SynapseAgentDomainEvent } from "@/types/agent"
import { reducePhaseEvent } from "../utils/phase-reducer"
import {
  clearConversationUnread,
  incrementUnreadForConversation,
  isSelectedConversation,
  shouldAutoFollowConversation,
} from "../live-sync"
import type { ChatAction, ChatState } from "./use-chat-reducer"
import type { ChatConnectionRefs, ChatConnectionResult, TimelineTarget } from "./use-chat-connection"

const logger = createRendererLogger("agent")

type ChatEventRefs = ChatConnectionRefs & {
  readonly followFeishuRef: React.RefObject<boolean>
  readonly inputDirtyRef: React.RefObject<boolean>
}

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
    selectRequestIdRef,
    followFeishuRef,
    inputDirtyRef,
    pendingConversationIdsRef,
  } = refs
  const { loadTimeline, refreshConversationSnapshot, refreshPendingPermissions, updateTimeline } = connection

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
          platform: "platform" in domainEvent.payload ? domainEvent.payload.platform : undefined,
        })
        return
      }
      if (domainEvent.type === "phase.update") {
        const payload = domainEvent.payload
        const selectedProject = selectedProjectIdRef.current
        const selectedConv = selectedConversationIdRef.current
        const selectedSession = selectedSessionKeyRef.current
        const sameProject = payload.projectId === selectedProject
        const sameSessionKey = payload.sessionKey === selectedSession
        const inPendingConv = Boolean(payload.conversationId)
          && pendingConversationIdsRef.current.has(payload.conversationId)
        const sameConv = payload.conversationId
          ? payload.conversationId === selectedConv
            || inPendingConv
          : sameSessionKey
        if (!inPendingConv && (!sameProject || !sameConv)) {
          logger.debug("Phase event ignored for inactive conversation.", {
            projectId: payload.projectId,
            sessionKey: payload.sessionKey,
            conversationId: payload.conversationId,
            phase: payload.phase,
            status: payload.status,
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
          eventTimestamp: domainEvent.timestamp,
        }))
        if (payload.phase === "cancel_pending") {
          dispatch({ type: "SET_CANCEL_PHASE", cancelPhase: "cancel_pending" })
        }
        if (payload.phase === "cancelled" || payload.phase === "failed" || (payload.phase === "completed" && payload.status === "done")) {
          // All terminal phases reset cancelPhase back to idle so the next
          // turn starts with a clean state.
          dispatch({ type: "CANCEL_RESET" })
          if (payload.conversationId) {
            dispatch({ type: "REMOVE_SENDING_CONVERSATION", conversationId: payload.conversationId })
          }
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
        // Track this conversationId so subsequent phase.update events for it
        // are accepted before selectSession has finished updating the refs.
        const pendingId = domainEvent.payload.conversationId
        pendingConversationIdsRef.current.add(pendingId)
        setTimeout(() => { pendingConversationIdsRef.current.delete(pendingId) }, 30_000)
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
      const agentType = state.sessions.find((session) =>
        session.projectId === selectedProjectIdRef.current
        && session.id === selectedConversationIdRef.current)?.agentType
        ?? state.status?.agentType
      updateTimeline((current) =>
        appendAgentTimelineEvent(current, domainEvent.payload.event, domainEvent.timestamp, agentType))
      const event = domainEvent.payload.event
      if (event.type === "result" && event.metadata?.model) {
        dispatch({ type: "SET_CURRENT_CONVERSATION_MODEL", model: event.metadata.model })
      }
      void refreshPendingPermissions()
    })
  }, [
    dispatch,
    followFeishuRef,
    inputDirtyRef,
    loadTimeline,
    projectIdsKey,
    projectIdsRef,
    refreshConversationSnapshot,
    refreshPendingPermissions,
    selectRequestIdRef,
    selectedConversationIdRef,
    selectedProjectIdRef,
    selectedSessionKeyRef,
    state.sessions,
    state.status?.agentType,
    updateTimeline,
  ])
}

export { useChatEvents }
export type { ChatEventRefs }

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
