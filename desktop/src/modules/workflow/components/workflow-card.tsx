import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { WorkflowMeta } from "@/types/workflow"
import { GitBranch, Play } from "lucide-react"

interface WorkflowCardProps { meta: WorkflowMeta; onOpen: () => void; onRun: () => void }

export function WorkflowCard({ meta, onOpen, onRun }: WorkflowCardProps) {
  return (
    <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onDoubleClick={onOpen}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          {meta.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{meta.nodeCount} 个节点</span>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onRun() }}>
          <Play className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  )
}
