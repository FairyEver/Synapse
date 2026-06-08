import { Button } from "@/components/ui/button"

interface AgentConversationRolloverPromptProps {
  readonly onStartNewConversation: () => void
}

function AgentConversationRolloverPrompt({
  onStartNewConversation,
}: AgentConversationRolloverPromptProps) {
  return (
    <div className="mb-2 flex w-full min-w-0 items-center justify-center gap-1 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
      <span>继续当前对话可能按完整上下文计费，您可以</span>
      {" "}
      <Button
        type="button"
        variant="link"
        size="sm"
        aria-label="新建对话"
        data-track="agent-conversation-idle-new"
        onClick={onStartNewConversation}
        className="h-auto p-0 text-sm"
      >
        新建对话
      </Button>
    </div>
  )
}

export { AgentConversationRolloverPrompt }
export type { AgentConversationRolloverPromptProps }
