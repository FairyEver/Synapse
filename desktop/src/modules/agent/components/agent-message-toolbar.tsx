import { useState } from "react"
import { Check, Clipboard } from "lucide-react"
import { createRendererLogger } from "@/app-shell/logging"
import { cn } from "@/lib/utils"

const logger = createRendererLogger("agent")

interface AgentMessageToolbarProps {
  readonly timestamp?: string
  readonly content: string
  readonly className?: string
}

function AgentMessageToolbar({ timestamp, content, className }: AgentMessageToolbarProps) {
  const [copied, setCopied] = useState(false)
  const formattedTimestamp = timestamp ? formatTime(timestamp) : undefined

  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch((rawError: unknown) => {
      logger.error("Agent message copy failed.", {
        boundary: "renderer.agent.message-toolbar",
        contentLength: content.length,
        ...errorLogMeta(rawError),
      })
    })
  }

  return (
    <div className={cn("flex items-center justify-end gap-2", className)}>
      {formattedTimestamp ? (
        <time className="text-xs text-muted-foreground">
          {formattedTimestamp}
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

function formatTime(timestamp: string): string | undefined {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

function errorLogMeta(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const text = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: text.length,
  }
}

export { AgentMessageToolbar }
export type { AgentMessageToolbarProps }
