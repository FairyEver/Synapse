import { Bot, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
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
  selectedSessionKey: string
  loading: boolean
  onRefresh: () => void
  onSelect: (sessionKey: string) => void
}

function AgentSessionSidebar({
  sessions,
  selectedSessionKey,
  loading,
  onRefresh,
  onSelect,
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
      <ModuleSidebarList>
        {items.map((session) => (
          <ModuleSidebarItem
            key={session.id}
            active={session.sessionKey === selectedSessionKey}
            icon={Bot}
            trailing={session.updatedAt ? (
              <span className="text-xs text-muted-foreground">
                {formatEntryTime(session.updatedAt)}
              </span>
            ) : null}
            onClick={() => onSelect(session.sessionKey)}
          >
            {sessionLabel(session)}
          </ModuleSidebarItem>
        ))}
      </ModuleSidebarList>
    </ModuleSidebar>
  )
}

export { AgentSessionSidebar }
