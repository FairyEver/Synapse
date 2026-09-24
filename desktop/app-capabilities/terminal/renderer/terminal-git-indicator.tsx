import { RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "../../../src/components/ui/button"
import { Spinner } from "../../../src/components/ui/spinner"
import { useTerminalGitStatus } from "./use-terminal-git-status"

export function TerminalGitIndicator({
  sessionId,
  visible,
  disabled,
}: {
  readonly sessionId: string
  readonly visible: boolean
  readonly disabled: boolean
}) {
  const { status, syncing, sync } = useTerminalGitStatus(sessionId, visible)
  if (!status?.isRepository) return null

  const branch = status.branch ?? (status.detachedSha ? `HEAD ${status.detachedSha}` : "HEAD")
  const syncLabel = `同步分支：${branch}`

  return (
    <div className="flex min-w-0 max-w-1/2 items-center gap-2 text-xs text-muted-foreground @max-[200px]:hidden" data-terminal-git-status>
      <span className="min-w-0 truncate" title={branch}>{branch}</span>
      {status.changeCount > 0 ? (
        <span className="hidden shrink-0 @sm:inline" title="未提交行数变化">+{status.insertions} -{status.deletions}</span>
      ) : null}
      {status.hasConflicts ? <span className="hidden shrink-0 @sm:inline">有冲突</span> : null}
      {status.ahead > 0 || status.behind > 0 ? (
        <span className="hidden shrink-0 @lg:inline" title="与上游分支的提交差异">
          {status.ahead > 0 ? `↑${status.ahead}` : ""}
          {status.behind > 0 ? `↓${status.behind}` : ""}
        </span>
      ) : null}
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        disabled={disabled || syncing}
        aria-label={syncLabel}
        title={syncLabel}
        data-track="terminal-pane-git-sync"
        className="shrink-0"
        onClick={(event) => {
          event.stopPropagation()
          void sync().then((result) => {
            if (result.ok) toast("同步完成")
            else if (result.message) toast.error(result.message)
          })
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {syncing ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
      </Button>
    </div>
  )
}
