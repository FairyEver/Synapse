import { cn } from "@/lib/utils"

interface AgentMessageHeaderProps {
  readonly agentIcon?: string
  readonly timestamp?: string
  readonly className?: string
}

function AgentMessageHeader({
  agentIcon,
  timestamp,
  className,
}: AgentMessageHeaderProps) {
  const formattedTimestamp = timestamp ? formatTimestamp(timestamp) : undefined

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        className,
      )}
    >
      {agentIcon ? (
        <img
          src={agentIcon}
          alt=""
          className="size-5 rounded"
        />
      ) : null}
      {formattedTimestamp ? (
        <time className="text-xs text-muted-foreground">
          {formattedTimestamp}
        </time>
      ) : null}
    </div>
  )
}

function formatTimestamp(timestamp: string): string | undefined {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

export { AgentMessageHeader, formatTimestamp }
export type { AgentMessageHeaderProps }
