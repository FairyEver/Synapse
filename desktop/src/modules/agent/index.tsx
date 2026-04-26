import { type FormEvent, useState } from "react"
import { Send } from "lucide-react"
import { useActiveRepository } from "@/app-shell/use-repository-manager"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { AgentPermissionPanel } from "./components/agent-permission-panel"
import { AgentSessionSidebar } from "./components/agent-session-sidebar"
import { useAgentChat } from "./hooks/use-agent-chat"
import { formatEntryTime } from "./utils"

function AgentModule() {
  const activeRepository = useActiveRepository()
  const projectId = activeRepository?.uuid
  const chat = useAgentChat(projectId)
  const [draft, setDraft] = useState("")

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const content = draft.trim()
    if (!content || chat.sending) return
    setDraft("")
    void chat.sendMessage(content)
  }

  const activeProvider = chat.providers?.providers.find((provider) => provider.active)
  const sidebar = (
    <AgentSessionSidebar
      sessions={chat.sessions}
      selectedSessionKey={chat.selectedSessionKey}
      loading={chat.loading}
      onRefresh={() => void chat.refresh()}
      onSelect={chat.setSelectedSessionKey}
    />
  )

  return (
    <SidebarContentLayout sidebar={sidebar} contentScrollable={false}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Agent</h2>
            <p className="truncate text-sm text-muted-foreground">
              {activeRepository?.name ?? "未选择项目"}
            </p>
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
                <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm text-foreground">
                  {entry.content}
                </p>
              </article>
            ))}
          </div>
        </ScrollArea>

        <form className="flex shrink-0 items-end gap-2" onSubmit={handleSubmit}>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="输入消息"
            disabled={!projectId || chat.sending}
            className="min-h-20"
          />
          <Button type="submit" disabled={!draft.trim() || !projectId || chat.sending}>
            <Send data-icon="inline-start" />
            发送
          </Button>
        </form>
      </div>
    </SidebarContentLayout>
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

export { AgentModule }
