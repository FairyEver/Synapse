import { useCallback, useEffect, useReducer, useRef } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import type {
  SynapseAgentPendingPermission,
  SynapseAgentPublishedCommand,
  SynapseAgentProviderState,
  SynapseAgentSessionSummary,
  SynapseAgentStatus,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import type { AgentProjectScope } from "../project-resolution"
import type { UnreadState } from "../live-sync"
import { chatReducer, initialChatState } from "./use-chat-reducer"
import type { ChatState } from "./use-chat-reducer"
import { useChatConnection } from "./use-chat-connection"
import { useChatEvents } from "./use-chat-events"

const logger = createRendererLogger("agent")

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
  cancelPhase: ChatState["cancelPhase"]
  error: string | null
  currentConversationModel: string | undefined
  createSession: (projectId: string, agentType: string) => Promise<void>
  selectSession: (session: SynapseAgentSessionSummary) => Promise<void>
  deleteSession: (session: SynapseAgentSessionSummary) => Promise<void>
  renameSession: (session: SynapseAgentSessionSummary, name: string) => Promise<void>
  refresh: () => Promise<void>
  sendMessage: (content: string) => Promise<void>
  respondPermission: (requestId: string, behavior: "allow" | "deny") => Promise<void>
  cancelTurn: () => Promise<void>
  forceKillTurn: () => Promise<void>
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
    cancelPhase,
    error,
    currentConversationModel,
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
  const pendingConversationIdsRef = useRef(new Set<string>())

  const projectIdsKey = projectScope.projectIds.join("\0")

  followFeishuRef.current = followFeishu
  inputDirtyRef.current = options.inputDirty ?? false
  projectIdsRef.current = projectScope.projectIds
  defaultProjectIdRef.current = projectScope.defaultProjectId
  selectedProjectIdRef.current = selectedProjectId
  selectedConversationIdRef.current = selectedConversationId
  selectedSessionKeyRef.current = selectedSessionKey

  const connectionRefs = {
    projectIdsRef,
    defaultProjectIdRef,
    selectedProjectIdRef,
    selectedConversationIdRef,
    selectedSessionKeyRef,
    selectRequestIdRef,
    timelineVersionRef,
    pendingConversationIdsRef,
  }

  const connection = useChatConnection(state, dispatch, connectionRefs)

  const eventRefs = {
    ...connectionRefs,
    followFeishuRef,
    inputDirtyRef,
  }

  useChatEvents(state, dispatch, eventRefs, connection, projectIdsKey)

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

  const { clearTimeline, setSelectedSession, loadArchivedSessions, refresh } = connection

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
    cancelPhase,
    error,
    currentConversationModel,
    createSession: connection.createSession,
    selectSession: connection.selectSession,
    deleteSession: connection.deleteSession,
    renameSession: connection.renameSession,
    refresh: connection.refresh,
    sendMessage: connection.sendMessage,
    respondPermission: connection.respondPermission,
    cancelTurn: connection.cancelTurn,
    forceKillTurn: connection.forceKillTurn,
  }
}

export { useAgentChat }
