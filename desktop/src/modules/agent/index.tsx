import { type FormEvent, type KeyboardEvent, useState } from "react"
import { Command as CommandIcon, Send } from "lucide-react"
import { useActiveRepository } from "@/app-shell/use-repository-manager"
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
import type { SynapseAgentTimelineEntry } from "@/types/agent"
import { AgentPermissionPanel } from "./components/agent-permission-panel"
import { AgentSessionSidebar } from "./components/agent-session-sidebar"
import { useAgentChat } from "./hooks/use-agent-chat"
import { formatEntryTime } from "./utils"

function AgentModule() {
  const activeRepository = useActiveRepository()
  const projectId = activeRepository?.uuid
  const chat = useAgentChat(projectId)
  const [draft, setDraft] = useState("")
  const [paletteOpen, setPaletteOpen] = useState(false)

  const submitDraft = () => {
    const content = draft.trim()
    if (!content || !projectId) return
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
    if (!projectId) return
    setDraft("")
    setPaletteOpen(false)
    void chat.sendMessage(`/${name}`)
  }

  const activeProvider = chat.providers?.providers.find((provider) => provider.active)
  const openReference = (reference: string) => {
    if (!projectId) return
    void requireSynapseBridge().agent.openReference({ projectId, reference })
  }
  const sidebar = (
    <AgentSessionSidebar
      sessions={chat.sessions}
      selectedConversationId={chat.selectedConversationId}
      loading={chat.loading || chat.sending}
      onRefresh={() => void chat.refresh()}
      onCreate={() => void chat.createSession()}
      onSelect={(conversationId) => void chat.selectSession(conversationId)}
      onDelete={(conversationId) => void chat.deleteSession(conversationId)}
    />
  )

  return (
    <SidebarContentLayout sidebar={sidebar} contentScrollable={false}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">{activeRepository?.name ?? "未选择项目"}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activeProvider ? (
              <Badge variant="secondary">{activeProvider.id}</Badge>
            ) : null}
            {chat.providers?.activeModel ? (
              <Badge variant="outline">{chat.providers.activeModel}</Badge>
            ) : null}
            {chat.status?.pendingPermissions ? (
              <Badge variant="outline">权限 {chat.status.pendingPermissions}</Badge>
            ) : null}
            {chat.activityLabel ? (
              <Badge variant="outline">{chat.activityLabel}</Badge>
            ) : null}
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

        <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
          <div className="flex flex-col gap-3 p-3">
            {chat.timeline.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                暂无消息
              </p>
            ) : chat.timeline.map((entry) => (
              <article key={entry.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{labelForRole(entry.role)}</span>
                  <span>{formatEntryTime(entry.timestamp)}</span>
                </div>
                <MessageContent entry={entry} onOpenReference={openReference} />
              </article>
            ))}
          </div>
        </ScrollArea>

        <form className="flex shrink-0 items-end gap-2" onSubmit={handleSubmit}>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="输入消息"
            disabled={!projectId}
            rows={1}
            className="h-8 min-h-8 resize-none overflow-hidden py-1.5 focus-visible:border-input focus-visible:ring-0"
          />
          <Button type="submit" disabled={!draft.trim() || !projectId}>
            <Send data-icon="inline-start" />
            发送
          </Button>
        </form>
      </div>
    </SidebarContentLayout>
  )
}

function MessageContent({
  entry,
  onOpenReference,
}: {
  readonly entry: SynapseAgentTimelineEntry
  readonly onOpenReference: (reference: string) => void
}) {
  const segments = splitLocalReferences(entry.content)
  return (
    <div className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm text-foreground">
      {segments.map((segment, index) => segment.kind === "text" ? (
        <span key={`${entry.id}:text:${String(index)}`}>{segment.value}</span>
      ) : (
        <Button
          key={`${entry.id}:ref:${String(index)}`}
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-1 py-0 align-baseline"
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

export { AgentModule }
