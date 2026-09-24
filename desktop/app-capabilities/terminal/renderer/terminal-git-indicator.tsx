import { GitBranch, RefreshCw } from "lucide-react"
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
    <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" data-terminal-git-status>
      <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate" title={branch}>{branch}</span>
      <span className="shrink-0" title="工作区状态">
        {status.changeCount > 0 ? `${status.changeCount} 个未提交` : "无未提交"}
      </span>
      {status.hasConflicts ? <span className="shrink-0">有冲突</span> : null}
      {status.ahead > 0 || status.behind > 0 ? (
        <span className="shrink-0" title="与上游分支的提交差异">
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
