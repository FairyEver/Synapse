import { MessageSquare } from "lucide-react"
import type { PromptNodeConfig } from "./schema"

export function PromptNodeCard({ config, selected }: { config: PromptNodeConfig; selected?: boolean }) {
  return (
    <div className={`rounded-lg border bg-card px-3 py-2 w-52 shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs font-medium text-foreground truncate">{config.agent || "Prompt"}</span>
      </div>
      <p className="text-xs text-muted-foreground truncate">{config.prompt.slice(0, 50) || "无 Prompt"}</p>
    </div>
  )
}
