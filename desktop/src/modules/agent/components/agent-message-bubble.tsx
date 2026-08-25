import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface AgentMessageBubbleProps {
  readonly role: "user" | "assistant"
  readonly children: ReactNode
  readonly className?: string
}

export function AgentMessageBubble({
  role,
  children,
  className,
}: AgentMessageBubbleProps) {
  return (
    <div
      className={cn(
        "min-w-0 whitespace-pre-wrap break-words text-sm leading-7 text-foreground",
        role === "user"
          ? "group/message max-w-lg rounded-2xl bg-muted p-4"
          : "max-w-prose px-1 py-2",
        className
      )}
    >
      {children}
    </div>
  )
}
