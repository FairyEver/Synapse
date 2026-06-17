import { ExternalLink } from "lucide-react"

import { Button } from "@/components/ui/button"

type AgentDetachedPlaceholderProps = {
  readonly onShowWindow: () => void
}

function AgentDetachedPlaceholder({ onShowWindow }: AgentDetachedPlaceholderProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm font-medium">已经在新窗口打开</p>
      <Button type="button" variant="outline" size="sm" onClick={onShowWindow}>
        <ExternalLink data-icon="inline-start" />
        显示窗口
      </Button>
    </div>
  )
}

export { AgentDetachedPlaceholder }
