import { Plus, RefreshCw, Trash2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  ModuleSidebar,
  ModuleSidebarItem,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import {
  DEFAULT_LOCAL_SESSION_KEY,
  formatEntryTime,
  sessionLabel,
} from "../utils"
import { conversationUnreadKey } from "../live-sync"

type AgentSessionSidebarProps = {
  sessions: SynapseAgentSessionSummary[]
  selectedProjectId?: string
  selectedConversationId?: string
  loading: boolean
  followFeishu: boolean
  unreadByConversationId: Record<string, number>
  onRefresh: () => void
  onCreate: () => void
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
  onFollowFeishuChange: (follow: boolean) => void
}

function AgentSessionSidebar({
  sessions,
  selectedProjectId,
  selectedConversationId,
  loading,
  followFeishu,
  unreadByConversationId,
  onRefresh,
  onCreate,
  onSelect,
  onDelete,
  onFollowFeishuChange,
}: AgentSessionSidebarProps) {
  const items = sessions.length > 0
    ? sessions
    : [{
      projectId: "",
      id: DEFAULT_LOCAL_SESSION_KEY,
      sessionKey: DEFAULT_LOCAL_SESSION_KEY,
      name: "本地会话",
      active: true,
      historyCount: 0,
      createdAt: "",
      updatedAt: "",
    } satisfies SynapseAgentSessionSummary]

  return (
    <ModuleSidebar variant="bare">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold">会话</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={loading}
            onClick={onCreate}
            title="新建会话"
          >
            <Plus />
            <span className="sr-only">新建会话</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={loading}
            onClick={onRefresh}
            title="刷新"
          >
            <RefreshCw />
            <span className="sr-only">刷新</span>
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between px-1">
        <Label htmlFor="agent-follow-feishu" className="text-xs text-muted-foreground">
          跟随飞书
        </Label>
        <Switch
          id="agent-follow-feishu"
          size="sm"
          checked={followFeishu}
          onCheckedChange={onFollowFeishuChange}
        />
      </div>
      <ModuleSidebarList>
        {items.map((session) => {
          const canDelete = sessions.length > 0
          const unread = session.projectId
            ? unreadByConversationId[conversationUnreadKey(session.projectId, session.id)] ?? 0
            : 0
          const trailing = (
            <SessionTrailing updatedAt={session.updatedAt} unread={unread} />
          )
          return (
            <div key={sessionItemKey(session)} className="flex items-center gap-1">
              <ModuleSidebarItem
                active={isSelectedSession(session, selectedProjectId, selectedConversationId)
                  || (!selectedConversationId && session.active)}
                className="min-w-0 flex-1"
                trailing={trailing}
                onClick={() => {
                  if (sessions.length > 0) onSelect(session)
                }}
              >
                {sessionLabel(session)}
              </ModuleSidebarItem>
              {canDelete ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={loading}
                      title="删除会话"
                    >
                      <Trash2 />
                      <span className="sr-only">删除会话</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>删除此会话？</AlertDialogTitle>
                      <AlertDialogDescription>会话记录将被删除。</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onDelete(session)}>
                        删除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
          )
        })}
      </ModuleSidebarList>
    </ModuleSidebar>
  )
}

function sessionItemKey(session: Pick<SynapseAgentSessionSummary, "projectId" | "id">): string {
  return `${session.projectId}:${session.id}`
}

function isSelectedSession(
  session: Pick<SynapseAgentSessionSummary, "projectId" | "id">,
  selectedProjectId: string | undefined,
  selectedConversationId: string | undefined,
): boolean {
  return session.projectId === selectedProjectId && session.id === selectedConversationId
}

function SessionTrailing({
  updatedAt,
  unread,
}: {
  readonly updatedAt?: string
  readonly unread: number
}) {
  if (!updatedAt && unread <= 0) {
    return null
  }
  return (
    <span className="flex items-center gap-1">
      {unread > 0 ? (
        <Badge variant="secondary" className="h-5 px-1.5 text-xs">
          {unread}
          <span className="sr-only"> 条未读</span>
        </Badge>
      ) : null}
      {updatedAt ? (
        <span className="text-xs text-muted-foreground">
          {formatEntryTime(updatedAt)}
        </span>
      ) : null}
    </span>
  )
}

export { AgentSessionSidebar }
