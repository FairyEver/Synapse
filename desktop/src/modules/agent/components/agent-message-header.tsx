import { Bot, User } from "lucide-react"
import { cn } from "@/lib/utils"

interface AgentMessageHeaderProps {
  readonly role: "user" | "assistant"
  readonly agentName?: string
  readonly timestamp?: string
  readonly className?: string
}

function AgentMessageHeader({
  role,
  agentName,
  timestamp,
  className,
}: AgentMessageHeaderProps) {
  const isUser = role === "user"
  const displayName = isUser ? "You" : (agentName ?? "Agent")
  const Icon = isUser ? User : Bot

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        isUser ? "flex-row-reverse justify-start" : "flex-row justify-start",
        className,
      )}
    >
      <div className="flex size-6 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <span className="text-sm font-medium">{displayName}</span>
      {timestamp ? (
        <time className="text-xs text-muted-foreground">
          {formatTimestamp(timestamp)}
        </time>
      ) : null}
    </div>
  )
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

export { AgentMessageHeader, formatTimestamp }
export type { AgentMessageHeaderProps }
