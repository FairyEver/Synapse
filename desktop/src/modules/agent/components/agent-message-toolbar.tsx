import { useState } from "react"
import { Check, Clipboard } from "lucide-react"
import { cn } from "@/lib/utils"

interface AgentMessageToolbarProps {
  readonly timestamp?: string
  readonly content: string
  readonly className?: string
}

function AgentMessageToolbar({ timestamp, content, className }: AgentMessageToolbarProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className={cn("flex items-center justify-end gap-2", className)}>
      {timestamp ? (
        <time className="text-xs text-muted-foreground">
          {formatTime(timestamp)}
        </time>
      ) : null}
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        onClick={handleCopy}
        aria-label="复制"
      >
        {copied
          ? <Check className="size-3.5" />
          : <Clipboard className="size-3.5" />}
      </button>
    </div>
  )
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

export { AgentMessageToolbar }
export type { AgentMessageToolbarProps }
