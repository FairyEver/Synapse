import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, Command as CommandIcon, Copy } from "lucide-react"
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
  CommandShortcut,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAgentDisplayProfile } from "@/types/agent"
import { AgentPermissionPanel } from "./components/agent-permission-panel"
import { AgentSessionSidebar } from "./components/agent-session-sidebar"
import { AgentTimeline } from "./components/agent-timeline"
import { useAgentChat } from "./hooks/use-agent-chat"
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

function AgentModule() {
  const activeRepository = useActiveRepository()
  const { config } = useAppConfig()
  const projectScope = useMemo(() =>
    resolveAgentProjectScope(activeRepository, config.global.projects),
  [activeRepository, config.global.projects])
  const [draft, setDraft] = useState("")
  const chat = useAgentChat(projectScope, { inputDirty: draft.trim().length > 0 })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const timelineBottomRef = useRef<HTMLDivElement | null>(null)

  const latestEntry = chat.timeline.at(-1)

  useEffect(() => {
    const bottom = timelineBottomRef.current
    if (!bottom) return undefined
    const frame = window.requestAnimationFrame(() => {
      bottom.scrollIntoView({ block: "end" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    chat.selectedProjectId,
    chat.selectedConversationId,
    chat.selectedSessionKey,
    chat.timeline.length,
    latestEntry?.id,
    latestEntry?.timestamp,
    chat.sending,
  ])

  const submitDraft = () => {
    const content = draft.trim()
    if (!content || !chat.activeProjectId) return
    setDraft("")
    void chat.sendMessage(content)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submitDraft()
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return
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
  const sidebar = (
    <AgentSessionSidebar
      sessions={chat.sessions}
      selectedProjectId={chat.selectedProjectId}
      selectedConversationId={chat.selectedConversationId}
      loading={chat.loading || chat.sending}
      followFeishu={chat.followFeishu}
      unreadByConversationId={chat.unreadByConversationId}
      onRefresh={() => void chat.refresh()}
      onCreate={() => void chat.createSession()}
      onSelect={(session) => void chat.selectSession(session)}
      onDelete={(session) => void chat.deleteSession(session)}
      onFollowFeishuChange={chat.setFollowFeishu}
    />
  )

  return (
    <SidebarContentLayout sidebar={sidebar} contentScrollable={false}>
      <div className="flex h-full min-h-0 flex-col gap-0 bg-background">
        <div className="flex items-center justify-between gap-3 px-0 py-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-medium">Agent</h2>
            {selectedCliLabel ? (
              <Badge variant="outline">{selectedCliLabel}</Badge>
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
              <PopoverContent align="end" className="w-80 p-0">
                <Command>
                  <CommandInput placeholder="搜索命令" />
                  <CommandList>
                    <CommandEmpty>无命令</CommandEmpty>
                    <CommandGroup>
                      {chat.commands.map((command) => (
                        <CommandItem
                          key={`${command.source}:${command.name}`}
                          value={`/${command.name}`}
                          onSelect={() => handleCommandSelect(command.name)}
                        >
                          <span className="truncate">/{command.name}</span>
                          <CommandShortcut>{command.kind}</CommandShortcut>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {chat.error ? (
          <Alert variant="destructive">
            <AlertDescription>{chat.error}</AlertDescription>
          </Alert>
        ) : null}

        <AgentPermissionPanel
          pendingPermissions={chat.pendingPermissions}
          onRespond={(requestId, behavior) => void chat.respondPermission(requestId, behavior)}
        />

        <AgentTimeline
          items={chat.timeline}
          profile={selectedDisplayProfile}
          sending={chat.sending}
          onOpenReference={openReference}
          bottomRef={timelineBottomRef}
        />

        <AgentComposer
          draft={draft}
          disabled={!chat.activeProjectId}
          canSend={Boolean(draft.trim() && chat.activeProjectId)}
          onDraftChange={setDraft}
          onInputKeyDown={handleInputKeyDown}
          onSubmit={handleSubmit}
        />
      </div>
    </SidebarContentLayout>
  )
}

function AgentComposer({
  draft,
  disabled,
  canSend,
  onDraftChange,
  onInputKeyDown,
  onSubmit,
}: {
  readonly draft: string
  readonly disabled: boolean
  readonly canSend: boolean
  readonly onDraftChange: (value: string) => void
  readonly onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  readonly onSubmit: (event: FormEvent) => void
}) {
  return (
    <form
      className="mx-auto flex w-full max-w-4xl shrink-0 items-end gap-2 rounded-2xl border border-border bg-background px-3 py-2"
      onSubmit={onSubmit}
    >
      <Textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="输入消息"
        disabled={disabled}
        rows={1}
        className="h-9 min-h-9 flex-1 resize-none overflow-hidden border-0 bg-transparent px-1.5 py-2 shadow-none focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent"
      />
      <Button
        type="submit"
        size="icon"
        className="shrink-0 rounded-full"
        disabled={!canSend}
        aria-label="发送"
      >
        <ArrowUp data-icon="inline-start" />
      </Button>
    </form>
  )
}

export { AgentComposer, AgentModule }
