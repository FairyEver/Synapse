import { Button } from "@/components/ui/button"

interface AgentConversationRolloverPromptProps {
  readonly onStartNewConversation: () => void
}

function AgentConversationRolloverPrompt({
  onStartNewConversation,
}: AgentConversationRolloverPromptProps) {
  return (
    <div className="agent-conversation-rollover-prompt flex min-w-0 flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-center text-xs text-muted-foreground">
      <span>已空闲较久，继续对话可能无法命中缓存</span>
      <Button
        type="button"
        variant="link"
        size="sm"
        aria-label="新建对话"
        data-track="agent-conversation-idle-new"
        onClick={onStartNewConversation}
        className="h-auto p-0 text-xs"
      >
        新建对话
      </Button>
    </div>
  )
}

export { AgentConversationRolloverPrompt }
export type { AgentConversationRolloverPromptProps }
