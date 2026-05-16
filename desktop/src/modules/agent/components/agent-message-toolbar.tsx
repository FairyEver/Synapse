import { useEffect, useRef, useState } from "react"
import { Check, Clipboard } from "lucide-react"
import { createRendererLogger } from "@/app-shell/logging"
import { track } from "@/lib/ui-tracking"
import { cn } from "@/lib/utils"
import { errorLogMeta } from "../utils"

const logger = createRendererLogger("agent")

interface AgentMessageToolbarProps {
  readonly timestamp?: string
  readonly content: string
  readonly messageId?: string
  readonly role?: "assistant" | "user"
  readonly className?: string
}

function AgentMessageToolbar({ timestamp, content, messageId, role, className }: AgentMessageToolbarProps) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const formattedTimestamp = timestamp ? formatTime(timestamp) : undefined

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const handleCopy = () => {
    const metadata = {
      boundary: "renderer.agent.message-toolbar",
      ...(messageId ? { messageId } : {}),
      ...(role ? { role } : {}),
      contentLength: content.length,
      hasTimestamp: Boolean(formattedTimestamp),
    }
    track({
      component: "agent",
      name: "agent-message-copy",
      action: "click",
      metadata,
    })
    void navigator.clipboard.writeText(content).then(() => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      setCopied(true)
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = undefined
        setCopied(false)
      }, 1500)
    }).catch((rawError: unknown) => {
      logger.error("Agent message copy failed.", {
        ...metadata,
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

export { AgentMessageToolbar }
export type { AgentMessageToolbarProps }
