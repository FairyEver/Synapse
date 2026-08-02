import { useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitFileChange, SynapseGitRepository } from "@/types/git"
import { gitCommitPathsForSelection } from "../hooks/use-git-worktree-status"
import type { useGitWorktreeStatus } from "../hooks/use-git-worktree-status"
import { getGitActionPlan } from "../lib/git-status-view"

type GitChangesTabProps = {
  readonly repository: SynapseGitRepository
  readonly status: ReturnType<typeof useGitWorktreeStatus>
  readonly onCommitted?: () => void | Promise<void>
  readonly onPush?: () => void
  readonly pushDisabled?: boolean
  readonly commitDialogOpen: boolean
  readonly onCommitDialogOpenChange: (open: boolean) => void
}

type CommitNotice = {
  readonly text: string
  readonly canPush: boolean
}

const statusLabels: Record<SynapseGitFileChange["status"], string> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
  renamed: "重命名",
  untracked: "未跟踪",
  conflicted: "冲突",
  unknown: "未知",
}

export function GitChangesTab({
  repository,
  status,
  onCommitted,
  onPush,
  pushDisabled,
  commitDialogOpen,
  onCommitDialogOpenChange,
}: GitChangesTabProps) {
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commitNotice, setCommitNotice] = useState<CommitNotice | null>(null)
  const changes = status.snapshot?.changes ?? []
  const actionPlan = getGitActionPlan(status.snapshot, status.error)
  const hasConflicts = Boolean(status.snapshot?.hasConflicts)
  const commitDisabled = busy || hasConflicts || status.selectedPaths.length === 0 || !message.trim()

  const commit = async () => {
    setBusy(true)
    setError(null)
    setCommitNotice(null)
    try {
      const selectedPaths = [...status.selectedPaths]
      const selectedChanges = changes.filter((change) => selectedPaths.includes(change.path))
      const confirmedSnapshot = await status.refresh({ background: true })
      if (!confirmedSnapshot) throw new Error("无法确认当前改动，请刷新后重试。")
      const confirmedChanges = new Map(confirmedSnapshot.changes.map((change) => [change.path, change]))
      const selectionChanged = selectedChanges.some((change) => {
        const confirmed = confirmedChanges.get(change.path)
        return !confirmed
          || confirmed.originalPath !== change.originalPath
          || confirmed.status !== change.status
      })
      if (selectionChanged) {
        throw new Error("所选文件已发生变化，请确认最新改动后重试。")
      }
      await requireSynapseBridge().git.commit({
        repositoryId: repository.id,
        message: message.trim(),
        paths: gitCommitPathsForSelection(confirmedSnapshot.changes, selectedPaths),
      })
      setMessage("")
      const nextSnapshot = await status.refresh()
      await onCommitted?.()
      if (nextSnapshot && nextSnapshot.changeCount > 0) {
        setCommitNotice({ text: `还有 ${nextSnapshot.changeCount} 个改动。`, canPush: false })
        return
      }
      if (nextSnapshot && nextSnapshot.ahead > 0) {
        setCommitNotice({ text: "可以推送本地提交。", canPush: true })
        return
      }
      setCommitNotice({ text: "已提交。", canPush: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败。")
    } finally {
      setBusy(false)
    }
  }

  const handleCommitDialogOpenChange = (open: boolean) => {
    if (busy) return
    if (open) {
      setError(null)
      setCommitNotice(null)
    }
    onCommitDialogOpenChange(open)
  }

  return (
    <div className="grid h-full min-h-0 min-w-0">
      <div className="grid min-h-0 min-w-0 gap-0 bg-background md:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
        <ScrollArea className="min-h-0 min-w-0 border-b md:border-r md:border-b-0">
          <div className="min-h-full divide-y divide-border">
            {status.snapshot?.changesTruncated ? (
              <Alert className="rounded-none border-x-0 border-t-0">
                <AlertTitle>改动较多</AlertTitle>
                <AlertDescription>
                  仅展示前 10,000 项，共 {status.snapshot.changeCount} 项。
                </AlertDescription>
              </Alert>
            ) : null}
            {status.loading ? (
              <GitListSkeleton />
            ) : changes.length === 0 ? (
              <Empty className="min-h-40 rounded-none border-0 bg-transparent">
                <EmptyHeader>
                  <EmptyTitle>暂无改动</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              changes.map((change) => {
                const checked = status.selectedPaths.includes(change.path)
                const active = status.selectedFile?.path === change.path
                return (
                  <div
                    key={`${change.path}:${change.originalPath ?? ""}`}
                    role="button"
                    tabIndex={0}
                    data-active={active ? "true" : undefined}
                    className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[active=true]:bg-muted"
                    onClick={() => void status.loadDiff(change)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void status.loadDiff(change)
                    }}
                  >
                    <Checkbox
                      aria-label={`选择 ${change.path}`}
                      checked={checked}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={() => status.togglePath(change.path)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{change.path}</span>
                      <span className="mt-1 block">
                        <Badge variant="outline">{statusLabels[change.status]}</Badge>
                      </span>
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
        <ScrollArea
          className="min-h-0 min-w-0 max-w-full"
          data-git-changes-detail-pane="true"
          viewportClassName="min-w-0 max-w-full overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!max-w-full"
        >
          <div className="min-w-0 max-w-full overflow-hidden p-4" data-git-changes-detail-content="true">
            {status.diffLoading ? (
              <GitDiffSkeleton />
            ) : status.diff ? (
              <div className="grid min-w-0 gap-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{status.diff.path}</div>
                    {status.selectedFile ? (
                      <div className="mt-1">
                        <Badge variant="outline">{statusLabels[status.selectedFile.status]}</Badge>
                      </div>
                    ) : null}
                  </div>
                </div>
                {status.diff.truncated ? (
                  <Alert>
                    <AlertTitle>差异内容已截断</AlertTitle>
                    <AlertDescription>内容过大，仅显示前 2 MiB。</AlertDescription>
                  </Alert>
                ) : null}
                <pre className="block w-full min-w-0 max-w-full overflow-x-auto rounded-lg border bg-muted p-3 text-xs leading-relaxed text-foreground">
                  {status.diff.binary ? "文件已变更。" : <GitDiffText text={status.diff.text || "没有文本差异。"} />}
                </pre>
              </div>
            ) : (
              <Empty className="min-h-64 border bg-muted/20">
                <EmptyHeader>
                  <EmptyTitle>选择文件查看差异</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </ScrollArea>
      </div>
      <Dialog
        open={commitDialogOpen}
        onOpenChange={handleCommitDialogOpenChange}
        data-track="git-commit-dialog"
      >
        <DialogContent className="sm:max-w-lg" showCloseButton={!busy} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>提交改动</DialogTitle>
          </DialogHeader>
          <div className="grid min-w-0 gap-3">
            {status.error || error ? (
              <Alert variant="destructive">
                <AlertTitle>操作失败</AlertTitle>
                <AlertDescription>{status.error ?? error}</AlertDescription>
              </Alert>
            ) : null}
            {hasConflicts ? (
              <Alert variant="destructive">
                <AlertTitle>{actionPlan.blockerText ?? "发生冲突"}</AlertTitle>
                <AlertDescription>{actionPlan.recoveryText ?? "处理冲突后再继续。"}</AlertDescription>
              </Alert>
            ) : null}
            {commitNotice ? (
              <Alert>
                <AlertTitle>已提交</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  <span>{commitNotice.text}</span>
                  {commitNotice.canPush && onPush ? (
                    <Button type="button" variant="outline" size="sm" disabled={pushDisabled} onClick={onPush}>
                      推送
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="text-sm text-muted-foreground">
              已选 {status.selectedPaths.length} / {changes.length}
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="git-commit-message">提交说明</Label>
              <Textarea
                id="git-commit-message"
                className="min-h-24 min-w-0 max-w-full"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => handleCommitDialogOpenChange(false)}
            >
              取消
            </Button>
            <Button type="button" disabled={commitDisabled} onClick={() => void commit()}>
              {busy ? "提交中" : "提交选中文件"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function GitDiffText({ text }: { readonly text: string }) {
  return (
    <>
      {text.split(/\r?\n/).map((line, index) => {
        const isAddition = line.startsWith("+") && !line.startsWith("+++")
        const isDeletion = line.startsWith("-") && !line.startsWith("---")
        return (
          <span
            key={`${index}:${line}`}
            className={
              isDeletion
                ? "block whitespace-pre text-destructive"
                : isAddition
                  ? "block whitespace-pre bg-background font-medium"
                  : "block whitespace-pre"
            }
          >
            {line || " "}
          </span>
        )
      })}
    </>
  )
}

function GitListSkeleton() {
  return (
    <div className="grid gap-0 p-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 py-2">
          <Skeleton className="size-4" />
          <span className="grid min-w-0 gap-2">
            <Skeleton className="h-4 w-full max-w-56" />
            <Skeleton className="h-5 w-12" />
          </span>
        </div>
      ))}
    </div>
  )
}

function GitDiffSkeleton() {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-5 w-12" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
