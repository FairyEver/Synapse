import { useEffect, useRef, useState } from "react"
import { Check, Clipboard } from "lucide-react"
import { toast } from "sonner"
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
  readonly usage?: Record<string, unknown>
  readonly className?: string
  readonly copyButtonClassName?: string
}

const tokenNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
})

function AgentMessageToolbar({
  timestamp,
  content,
  messageId,
  role,
  usage,
  className,
  copyButtonClassName,
}: AgentMessageToolbarProps) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const formattedTimestamp = timestamp ? formatTime(timestamp) : undefined
  const usageFields = usage ? tokenUsageFields(usage) : undefined

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
      toast("复制失败")
    })
  }

  return (
    <div className={cn("flex items-center justify-end gap-2", className)}>
      {formattedTimestamp ? (
        <time className="text-xs text-muted-foreground">
          {formattedTimestamp}
        </time>
      ) : null}
      {usageFields ? (
        <span aria-label="Token 消耗" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {usageFields.map((field) => (
            <span key={field.label} className="whitespace-nowrap">
              {field.label} {tokenNumberFormatter.format(field.value)}
            </span>
          ))}
        </span>
      ) : null}
      <button
        type="button"
        className={cn(
          "inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground",
          copyButtonClassName,
        )}
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

function tokenUsageFields(usage: Record<string, unknown>): Array<{ label: string; value: number }> | undefined {
  const fields = [
    { label: "输入", value: tokenNumber(usage, ["input_tokens", "inputTokens"]) },
    { label: "输出", value: tokenNumber(usage, ["output_tokens", "outputTokens"]) },
    { label: "缓存读", value: tokenNumber(usage, ["cache_read_input_tokens", "cacheReadInputTokens", "cacheRead"]) },
    { label: "缓存写", value: tokenNumber(usage, ["cache_creation_input_tokens", "cacheCreationInputTokens", "cacheWrite"]) },
  ]
  return fields.some((field) => field.value !== undefined)
    ? fields.map((field) => ({ label: field.label, value: field.value ?? 0 }))
    : undefined
}

function tokenNumber(usage: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = usage[key]
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value)
  }
  return undefined
}

export { AgentMessageToolbar }
export type { AgentMessageToolbarProps }
