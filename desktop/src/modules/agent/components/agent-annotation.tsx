import { cn } from "@/lib/utils"
import { ReactNode } from "react"

interface AgentAnnotationProps {
  readonly children: ReactNode
  readonly className?: string
}

export function AgentAnnotation({ children, className }: AgentAnnotationProps) {
  return (
    <div className={cn("border-l-2 border-muted ml-1 pl-3", className)}>
      {children}
    </div>
  )
}
