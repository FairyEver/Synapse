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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { cn } from "@/lib/utils"
import type { SynapseAgentTimelineEntry } from "@/types/agent"
import { AgentPermissionPanel } from "./components/agent-permission-panel"
import { AgentSessionSidebar } from "./components/agent-session-sidebar"
import { useAgentChat } from "./hooks/use-agent-chat"
import { resolveAgentProjectScope } from "./project-resolution"
import {
  agentCliLabel,
  formatAgentTranscript,
  formatEntryTime,
  thinkingIndicatorText,
} from "./utils"

const logger = createRendererLogger("agent")

function AgentModule() {
  const activeRepository = useActiveRepository()
  const { config } = useAppConfig()
  const projectScope = useMemo(() =>
    resolveAgentProjectScope(activeRepository, config.global.projects),
  [activeRepository, config.global.projects])
  const [draft, setDraft] = useState("")
  const chat = useAgentChat(projectScope, { inputDirty: draft.trim().length > 0 })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [thinkingFrame, setThinkingFrame] = useState(0)
  const timelineBottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!chat.sending) {
      setThinkingFrame(0)
      return undefined
    }
    const interval = window.setInterval(() => {
      setThinkingFrame((current) => current + 1)
    }, 500)
    return () => window.clearInterval(interval)
  }, [chat.sending])

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
    latestEntry?.content,
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
  const selectedCliLabel = agentCliLabel(selectedSession?.agentType)
  const openReference = (reference: string) => {
    const projectId = chat.selectedProjectId ?? chat.activeProjectId
    if (!projectId) return
    void requireSynapseBridge().agent.openReference({ projectId, reference })
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
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
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

        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <div className="flex min-w-0 flex-col gap-3 py-1 pr-2">
            {chat.timeline.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                暂无消息
              </p>
            ) : chat.timeline.map((entry) => (
              <AgentMessageItem
                key={entry.id}
                entry={entry}
                onOpenReference={openReference}
              />
            ))}
            {chat.sending ? (
              <AgentWaitingIndicator text={thinkingIndicatorText(thinkingFrame)} />
            ) : null}
            <div ref={timelineBottomRef} aria-hidden="true" />
          </div>
        </ScrollArea>

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
    <form className="flex shrink-0 items-end gap-2 rounded-full bg-muted/50 px-2 py-1.5" onSubmit={onSubmit}>
      <Textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="输入消息"
        disabled={disabled}
        rows={1}
        className="h-8 min-h-8 flex-1 resize-none overflow-hidden border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent"
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

function AgentWaitingIndicator({ text }: { readonly text: string }) {
  return (
    <article className="flex justify-start" aria-live="polite">
      <div className="flex max-w-[78%] flex-col items-start gap-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Agent</span>
        </div>
        <div className="max-w-full rounded-2xl rounded-bl-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {text}
        </div>
      </div>
    </article>
  )
}

function AgentMessageItem({
  entry,
  onOpenReference,
}: {
  readonly entry: SynapseAgentTimelineEntry
  readonly onOpenReference: (reference: string) => void
}) {
  const outgoing = entry.role === "user"
  return (
    <article className={cn("flex min-w-0", outgoing ? "justify-end" : "justify-start")}>
      <div className={cn(
        "flex min-w-0 max-w-[78%] flex-col gap-1",
        outgoing ? "items-end" : "items-start",
      )}>
        <div className={cn(
          "flex items-center gap-2 text-xs text-muted-foreground",
          outgoing ? "justify-end" : "justify-start",
        )}>
          <span>{labelForRole(entry.role)}</span>
          <span>{formatEntryTime(entry.timestamp)}</span>
        </div>
        <MessageContent
          entry={entry}
          outgoing={outgoing}
          onOpenReference={onOpenReference}
        />
      </div>
    </article>
  )
}

function MessageContent({
  entry,
  outgoing,
  onOpenReference,
}: {
  readonly entry: SynapseAgentTimelineEntry
  readonly outgoing: boolean
  readonly onOpenReference: (reference: string) => void
}) {
  const segments = splitLocalReferences(entry.content)
  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-hidden whitespace-pre-wrap break-all rounded-2xl px-3 py-2 text-sm leading-relaxed",
        outgoing
          ? "rounded-br-md bg-gradient-to-b from-blue-500 to-blue-600 text-white"
          : "rounded-bl-md bg-muted/50 text-foreground",
      )}
    >
      {segments.map((segment, index) => segment.kind === "text" ? (
        <span key={`${entry.id}:text:${String(index)}`}>{segment.value}</span>
      ) : (
        <Button
          key={`${entry.id}:ref:${String(index)}`}
          type="button"
          variant="link"
          size="sm"
          className={cn(
            "h-auto min-w-0 max-w-full whitespace-normal break-all px-1 py-0 text-left align-baseline",
            outgoing ? "text-inherit hover:text-inherit" : null,
          )}
          onClick={() => onOpenReference(segment.value)}
        >
          {segment.value}
        </Button>
      ))}
    </div>
  )
}

function labelForRole(role: "user" | "assistant" | "system" | "tool"): string {
  switch (role) {
    case "user":
      return "用户"
    case "assistant":
      return "Agent"
    case "tool":
      return "工具"
    case "system":
      return "系统"
    default: {
      const exhaustive: never = role
      return exhaustive
    }
  }
}

type MessageSegment =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "reference"; readonly value: string }

const LOCAL_REFERENCE_PATTERN = /(\[[^\]]+\]\((?:file:\/\/|\.{1,2}\/|\/|[\w.-]+\/)[^)]+\)|(?:file:\/\/|\.{1,2}\/|\/|[\w.-]+\/)[^\s`),]+(?::\d+(?::\d+)?)?)/g

function splitLocalReferences(content: string): readonly MessageSegment[] {
  const segments: MessageSegment[] = []
  let lastIndex = 0
  for (const match of content.matchAll(LOCAL_REFERENCE_PATTERN)) {
    const value = match[0]
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ kind: "text", value: content.slice(lastIndex, index) })
    }
    segments.push({ kind: "reference", value })
    lastIndex = index + value.length
  }
  if (lastIndex < content.length) {
    segments.push({ kind: "text", value: content.slice(lastIndex) })
  }
  return segments.length > 0 ? segments : [{ kind: "text", value: content }]
}

export { AgentComposer, AgentMessageItem, AgentModule }
