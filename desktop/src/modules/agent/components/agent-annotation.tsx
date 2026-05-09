import { cn } from "@/lib/utils"
import { ReactNode } from "react"

interface AgentAnnotationProps {
  readonly children: ReactNode
  readonly className?: string
}

export function AgentAnnotation({ children, className }: AgentAnnotationProps) {
  return (
    <div className={cn("pl-2", className)}>
      {children}
    </div>
  )
}
