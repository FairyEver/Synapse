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

type AgentSessionSidebarProps = {
  sessions: SynapseAgentSessionSummary[]
  selectedConversationId?: string
  loading: boolean
  followFeishu: boolean
  unreadByConversationId: Record<string, number>
  onRefresh: () => void
  onCreate: () => void
  onSelect: (conversationId: string) => void
  onDelete: (conversationId: string) => void
  onFollowFeishuChange: (follow: boolean) => void
}

function AgentSessionSidebar({
  sessions,
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
          const unread = unreadByConversationId[session.id] ?? 0
          const trailing = (
            <SessionTrailing updatedAt={session.updatedAt} unread={unread} />
          )
          return (
            <div key={session.id} className="flex items-center gap-1">
              <ModuleSidebarItem
                active={session.id === selectedConversationId || (!selectedConversationId && session.active)}
                className="min-w-0 flex-1"
                trailing={trailing}
                onClick={() => onSelect(session.id)}
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
                      <AlertDialogAction onClick={() => onDelete(session.id)}>
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
