import { useEffect, useReducer, useRef } from "react"
import type {
  SynapseAgentPendingPermission,
  SynapseAgentPermissionMode,
  SynapseAgentPermissionScope,
  SynapseAgentPublishedCommand,
  SynapseAgentProviderState,
  SynapseAgentSessionSummary,
  SynapseAgentStatus,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import type { SynapseAgentPersona } from "@/types/agent-persona"
import type { AgentProjectScope } from "../project-resolution"
import type { AgentConversationTarget } from "@/types/agent-conversation-window"
import type { UnreadState } from "../live-sync"
import { chatReducer, initialChatState } from "./use-chat-reducer"
import type { ChatState } from "./use-chat-reducer"
import { useChatConnection } from "./use-chat-connection"
import type {
  PermissionResponseTarget,
  SendMessageOptions,
  SendMessageTarget,
} from "./use-chat-connection"
import { useChatEvents } from "./use-chat-events"

type UseAgentChatState = {
  sessions: SynapseAgentSessionSummary[]
  archivedSessions: SynapseAgentSessionSummary[]
  timeline: SynapseAgentTimelineItem[]
  pendingPermissions: SynapseAgentPendingPermission[]
  status: SynapseAgentStatus | null
  providers: SynapseAgentProviderState | null
  commands: SynapseAgentPublishedCommand[]
  personas: SynapseAgentPersona[]
  personasLoaded: boolean
  unreadByConversationId: UnreadState
  selectedProjectId?: string
  selectedConversationId?: string
  selectedSessionKey: string
  activeProjectId?: string
  loading: boolean
  sending: boolean
  sendingConversationIds: ReadonlySet<string>
  cancelPhase: ChatState["cancelPhase"]
  error: string | null
  currentConversationModel: string | undefined
  createSession: (
    projectId: string,
    providerId?: string,
    mode?: SynapseAgentPermissionMode,
    modelTier?: string,
    name?: string,
    personaId?: string | null,
  ) => Promise<SynapseAgentSessionSummary | undefined>
  selectSession: (session: SynapseAgentSessionSummary) => Promise<void>
  deleteSession: (session: SynapseAgentSessionSummary) => Promise<void>
  renameSession: (session: SynapseAgentSessionSummary, name: string) => Promise<void>
  refresh: () => Promise<void>
  refreshPersonas: () => Promise<void>
  sendMessage: (content: string, target?: SendMessageTarget, options?: SendMessageOptions) => Promise<boolean>
  setPermissionMode: (mode: SynapseAgentPermissionMode, target?: AgentConversationTarget) => Promise<void>
  respondPermission: (
    target: PermissionResponseTarget,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
    scope?: SynapseAgentPermissionScope,
  ) => Promise<void>
  cancelTurn: (target?: AgentConversationTarget) => Promise<void>
  forceKillTurn: (target?: AgentConversationTarget) => Promise<void>
}

function useAgentChat(
  projectScope: AgentProjectScope,
  _options: { readonly inputDirty?: boolean } = {},
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
    personas,
    personasLoaded,
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

  const projectIdsRef = useRef(projectScope.projectIds)
  const defaultProjectIdRef = useRef(projectScope.defaultProjectId)
  const selectedProjectIdRef = useRef<string | undefined>(selectedProjectId)
  const selectedConversationIdRef = useRef<string | undefined>(selectedConversationId)
  const selectedSessionKeyRef = useRef(selectedSessionKey)
  const selectRequestIdRef = useRef(0)
  const timelineVersionRef = useRef(0)
  const pendingConversationIdsRef = useRef(new Set<string>())

  const projectIdsKey = projectScope.projectIds.join("\0")

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

  useChatEvents(state, dispatch, connectionRefs, connection, projectIdsKey)

  const { clearTimeline, setSelectedSession, loadArchivedSessions, refresh } = connection

  useEffect(() => {
    if (projectIdsRef.current.length === 0) {
      selectRequestIdRef.current += 1
      pendingConversationIdsRef.current.clear()
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
    personas,
    personasLoaded,
    unreadByConversationId,
    selectedProjectId,
    selectedConversationId,
    selectedSessionKey,
    activeProjectId,
    loading,
    sending: selectedConversationId ? sendingConversationIds.has(selectedConversationId) : false,
    sendingConversationIds,
    cancelPhase,
    error,
    currentConversationModel,
    createSession: connection.createSession,
    selectSession: connection.selectSession,
    deleteSession: connection.deleteSession,
    renameSession: connection.renameSession,
    refresh: connection.refresh,
    refreshPersonas: connection.refreshPersonas,
    sendMessage: connection.sendMessage,
    setPermissionMode: connection.setPermissionMode,
    respondPermission: connection.respondPermission,
    cancelTurn: connection.cancelTurn,
    forceKillTurn: connection.forceKillTurn,
  }
}

export { useAgentChat }
