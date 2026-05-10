import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useState } from "react"
import { Clock, Command as CommandIcon, Copy } from "lucide-react"
import { toast } from "sonner"
import { useAppConfig } from "@/app-shell/config"
import { useActiveRepository } from "@/app-shell/use-repository-manager"
import { createRendererLogger } from "@/app-shell/logging"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AgentComposer } from "./components/agent-composer"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
import { getRendererPlatform } from "@/lib/runtime-platform"
import type { OpenAgentSessionPayload } from "@/app-shell/navigation"
import type { SynapseAgentAvailability, SynapseAgentDisplayProfile } from "@/types/agent"
import { useAgentRuntimeStatus } from "@/modules/settings/hooks/use-agent-runtime-status"

import { AgentSessionSidebar, type ProjectOption } from "./components/agent-session-sidebar"
import { AgentTimeline } from "./components/agent-timeline"
import { useAgentChat } from "./hooks/use-agent-chat"
import { useStickToBottom } from "./hooks/use-stick-to-bottom"
import { resolveAgentProjectScope } from "./project-resolution"
import {
  agentCliLabel,
  formatAgentTranscript,
} from "./utils"

const logger = createRendererLogger("agent")

const DEFAULT_AGENT_DISPLAY_PROFILE: SynapseAgentDisplayProfile = {
  agentLabel: "Agent",
  thinkingDefaultCollapsed: true,
  toolDefaultCollapsed: "auto",
  toolPreviewLines: 6,
  toolPreviewChars: 1200,
  statusLabels: {
    pending: "Pending",
    running: "Running",
    success: "Done",
    error: "Failed",
    denied: "Denied",
  },
}

type AgentModuleProps = {
  pendingAgentSession?: OpenAgentSessionPayload | null
  onPendingAgentSessionConsumed?: () => void
}

function AgentModule({ pendingAgentSession, onPendingAgentSessionConsumed }: AgentModuleProps) {
  const activeRepository = useActiveRepository()
  const { config } = useAppConfig()
  const platform = getRendererPlatform()
  const projectScope = useMemo(() =>
    resolveAgentProjectScope(activeRepository, config.global.projects, platform),
  [activeRepository, config.global.projects, platform])
  const { status: runtimeStatus, loading: runtimeLoading } = useAgentRuntimeStatus()
  const hasAvailableCli = useMemo(() => {
    if (!runtimeStatus) return null
    return runtimeStatus.agents.some((agent) => agent.cli.installed)
  }, [runtimeStatus])
  const [draft, setDraft] = useState("")
  const [availableAgents, setAvailableAgents] = useState<SynapseAgentAvailability[]>([])
  const chat = useAgentChat(projectScope, { inputDirty: draft.trim().length > 0 })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const latestEntry = chat.timeline.at(-1)
  const stick = useStickToBottom({
    contentSignal: [
      chat.timeline.length,
      latestEntry?.id,
      latestEntry?.timestamp,
      chat.sending,
    ],
    latestEntryId: latestEntry?.id,
  })

  const projectOptions: ProjectOption[] = useMemo(() =>
    config.global.projects.map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
    })),
  [config.global.projects])

  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge) return
    void bridge.agent.getAvailableAgents().then(setAvailableAgents)
  }, [])

  useEffect(() => {
    stick.forcePin()
    // forcePin is stable; only fire when the active session identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.selectedProjectId, chat.selectedConversationId, chat.selectedSessionKey])

  useEffect(() => {
    if (!pendingAgentSession) return
    const target = chat.sessions.find(
      (s) => s.id === pendingAgentSession.conversationId
        && s.projectId === pendingAgentSession.projectId,
    )
    if (target) {
      const prompt = pendingAgentSession.prompt
      void chat.selectSession(target).then(() => {
        if (prompt) {
          void chat.sendMessage(prompt)
        }
      })
      onPendingAgentSessionConsumed?.()
    }
  }, [pendingAgentSession, chat.sessions, chat.selectSession, chat.sendMessage, onPendingAgentSessionConsumed])

  const submitDraft = () => {
    const content = draft.trim()
    if (!content || !chat.activeProjectId) return
    setDraft("")
    stick.forcePin()
    void chat.sendMessage(content)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submitDraft()
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return
    // Skip while IME is composing (Chinese / Japanese / Korean input). The
    // first Enter that confirms an IME candidate fires keydown with
    // `isComposing=true` (or keyCode 229 on legacy paths) and must not be
    // treated as a submit, otherwise the user sees a trailing newline in the
    // sent message and a partial submission.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    submitDraft()
  }

  const handleCommandSelect = (name: string) => {
    if (!chat.activeProjectId) return
    setDraft("")
    setPaletteOpen(false)
    void chat.sendMessage(`/${name}`)
  }

  const handleCopyTranscript = async () => {
    const projectId = chat.selectedProjectId ?? chat.activeProjectId
    if (!projectId || chat.timeline.length === 0) return
    try {
      const result = await requireSynapseBridge().agent.getTimeline({
        projectId,
        sessionKey: chat.selectedSessionKey,
        conversationId: chat.selectedConversationId,
      })
      const transcript = formatAgentTranscript(result.entries)
      if (!transcript.trim()) return
      await window.navigator.clipboard.writeText(transcript)
      toast("已复制")
    } catch (rawError) {
      logger.error("Agent transcript copy failed.", rawError)
      toast("复制失败")
    }
  }

  const activeProvider = chat.providers?.providers.find((provider) => provider.active)
  const selectedSession = chat.sessions.find((session) =>
    session.projectId === chat.selectedProjectId && session.id === chat.selectedConversationId)
    ?? chat.sessions.find((session) => session.active)
  const selectedAgentDefinition = agentDefinitions.find((definition) =>
    definition.id === selectedSession?.agentType)
  const selectedDisplayProfile = selectedAgentDefinition?.displayProfile
    ?? DEFAULT_AGENT_DISPLAY_PROFILE
  const selectedCliLabel = agentCliLabel(selectedSession?.agentType)
  const openReference = (reference: string) => {
    const projectId = chat.selectedProjectId ?? chat.activeProjectId
    if (!projectId) return
    void getSynapseBridge()?.agent.openReference({ projectId, reference })
  }

  if (!runtimeLoading && hasAvailableCli === false) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          未检测到可用的 Agent CLI，请在设置中确认安装状态
        </p>
      </div>
    )
  }

  const sidebar = (
    <AgentSessionSidebar
      sessions={chat.sessions}
      archivedSessions={chat.archivedSessions}
      projects={projectOptions}
      availableAgents={availableAgents}
      selectedProjectId={chat.selectedProjectId}
      selectedConversationId={chat.selectedConversationId}
      followFeishu={chat.followFeishu}
      unreadByConversationId={chat.unreadByConversationId}
      onCreateSession={(projectId, agentType) => void chat.createSession(projectId, agentType)}
      onSelect={(session) => void chat.selectSession(session)}
      onDelete={(session) => void chat.deleteSession(session)}
      onDeleteOthers={(keep) => {
        const others = chat.sessions.filter(
          (s) => s.projectId === keep.projectId && s.id !== keep.id,
        )
        for (const session of others) void chat.deleteSession(session)
      }}
      onRename={(session, name) => void chat.renameSession(session, name)}
      onFollowFeishuChange={chat.setFollowFeishu}
    />
  )

  return (
    <SidebarContentLayout sidebar={sidebar} contentScrollable={false}>
      <div className="relative flex h-full min-h-0 flex-col gap-0 bg-background">
        <div className="flex items-center justify-between gap-3 px-0 py-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-medium">Agent</h2>
            {selectedCliLabel ? (
              <Badge variant="outline" className="flex items-center gap-1">
                {selectedCliLabel}
                {selectedSession?.platform === "scheduled" && (
                  <Clock className="size-3 text-muted-foreground" />
                )}
              </Badge>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activeProvider ? (
              <Badge variant="secondary">{activeProvider.id}</Badge>
            ) : null}
            {chat.providers?.activeModel ? (
              <Badge variant="outline">{chat.providers.activeModel}</Badge>
            ) : null}
            {chat.pendingPermissions.length > 0 ? (
              <Badge variant="outline">权限 {chat.pendingPermissions.length}</Badge>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!chat.activeProjectId || chat.timeline.length === 0}
              onClick={() => void handleCopyTranscript()}
            >
              <Copy data-icon="inline-start" />
              复制
            </Button>
            <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <CommandIcon data-icon="inline-start" />
                  命令
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-40 p-0">
                <Command>
                  <CommandInput placeholder="搜索命令" />
                  <CommandList>
                    <CommandEmpty>无命令</CommandEmpty>
                    <CommandGroup>
                      {(selectedAgentDefinition?.commands ?? []).map((command) => (
                        <CommandItem
                          key={command.name}
                          value={`/${command.name}`}
                          onSelect={() => handleCommandSelect(command.name)}
                        >
                          <span className="truncate">/{command.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {!selectedSession && chat.sessions.length === 0 && !chat.loading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">请创建新的会话</p>
          </div>
        ) : (
          <>
            {chat.error ? (
              <Alert variant="destructive">
                <AlertDescription>{chat.error}</AlertDescription>
              </Alert>
            ) : null}

            <AgentTimeline
              items={chat.timeline}
              profile={selectedDisplayProfile}
              agentIcon={selectedAgentDefinition?.icon}
              sending={chat.sending}
              pendingPermissions={chat.pendingPermissions}
              onOpenReference={openReference}
              onRespondPermission={(requestId, behavior) => void chat.respondPermission(requestId, behavior)}
              viewportRef={stick.viewportRef}
              showJumpToBottom={!stick.isPinned && stick.hasUnread}
              onJumpToBottom={() => stick.scrollToBottom({ behavior: "smooth" })}
            />

            <AgentComposer
              draft={draft}
              disabled={!chat.activeProjectId}
              canSend={Boolean(draft.trim() && chat.activeProjectId)}
              sending={chat.sending}
              cancelPhase={chat.cancelPhase}
              onDraftChange={setDraft}
              onInputKeyDown={handleInputKeyDown}
              onSubmit={handleSubmit}
              onCancelTurn={() => void chat.cancelTurn()}
              onForceKillTurn={() => void chat.forceKillTurn()}
            />
          </>
        )}
      </div>
    </SidebarContentLayout>
  )
}

export { AgentComposer, AgentModule }
