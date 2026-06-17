import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SynapseGitRepository } from "@/types/git"

type GitWorkbenchProps = {
  readonly repository: SynapseGitRepository
  readonly onBack: () => void
}

export function GitWorkbench({ repository, onBack }: GitWorkbenchProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          返回
        </Button>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{repository.name}</div>
          <div className="truncate text-xs text-muted-foreground">{repository.localPath}</div>
        </div>
      </div>
    </div>
  )
}
