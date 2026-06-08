import { MessageSquarePlus } from "lucide-react"
import { Button } from "@/components/ui/button"

interface AgentConversationRolloverPromptProps {
  readonly disabled: boolean
  readonly onStartNewConversation: () => void
}

function AgentConversationRolloverPrompt({
  disabled,
  onStartNewConversation,
}: AgentConversationRolloverPromptProps) {
  return (
    <div className="mt-2 flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-muted/60 px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">这个对话已经很长</div>
        <div className="text-xs text-muted-foreground">新对话会保留当前项目和模型。</div>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={disabled}
        onClick={onStartNewConversation}
        className="shrink-0"
      >
        <MessageSquarePlus data-icon="inline-start" />
        开始新对话
      </Button>
    </div>
  )
}

export { AgentConversationRolloverPrompt }
export type { AgentConversationRolloverPromptProps }
