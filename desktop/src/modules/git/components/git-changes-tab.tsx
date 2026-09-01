import { useEffect, useState, type RefObject } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { startTrackedOperation } from "@/lib/ui-tracking"
import type { SynapseGitRepository, SynapseGitWorkingTreeChange } from "@/types/git"
import type { useGitWorktreeStatus } from "../hooks/use-git-worktree-status"
import { getGitActionPlan } from "../lib/git-status-view"
import { GitDiffViewer, type GitDiffViewMode } from "./git-diff-viewer-adapter"

type GitChangesTabProps = {
  readonly repository: SynapseGitRepository
  readonly status: ReturnType<typeof useGitWorktreeStatus>
  readonly onCommitted?: () => void | Promise<void>
  readonly onPush?: () => void
  readonly pushDisabled?: boolean
  readonly commitDialogOpen: boolean
  readonly onCommitDialogOpenChange: (open: boolean) => void
  readonly diffViewMode: GitDiffViewMode
  readonly diffWrap: boolean
  readonly onDiffViewModeChange: (mode: GitDiffViewMode) => void
  readonly onDiffWrapChange: (wrap: boolean) => void
  readonly returnFocusRef?: RefObject<HTMLButtonElement | null>
}

type CommitNotice = {
  readonly text: string
  readonly canPush: boolean
}

const statusIndicators: Record<SynapseGitWorkingTreeChange["status"], {
  readonly label: string
  readonly letter: string
  readonly className: string
}> = {
  added: { label: "新增", letter: "A", className: "text-chart-3" },
  modified: { label: "修改", letter: "M", className: "text-chart-1" },
  deleted: { label: "删除", letter: "D", className: "text-destructive" },
  renamed: { label: "重命名", letter: "R", className: "text-chart-5" },
  replaced: { label: "替换", letter: "T", className: "text-foreground" },
  untracked: { label: "未跟踪", letter: "U", className: "text-chart-2" },
  conflicted: { label: "冲突", letter: "C", className: "text-destructive" },
  unknown: { label: "未知", letter: "X", className: "text-muted-foreground" },
}

export function GitChangesTab({
  repository,
  status,
  onCommitted,
  onPush,
  pushDisabled,
  commitDialogOpen,
  onCommitDialogOpenChange,
  diffViewMode,
  diffWrap,
  onDiffViewModeChange,
  onDiffWrapChange,
  returnFocusRef,
}: GitChangesTabProps) {
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [preparedSelectionId, setPreparedSelectionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [commitNotice, setCommitNotice] = useState<CommitNotice | null>(null)
  const changes = status.snapshot?.changes ?? []
  const actionPlan = getGitActionPlan(status.snapshot, status.error)
  const hasConflicts = Boolean(status.snapshot?.hasConflicts)
  const worktreeMutationBlocked = Boolean(status.snapshot && status.snapshot.repositoryOperationState !== "normal")
  const selectedPathsKey = JSON.stringify(status.selectedPaths)
  const commitDisabled = busy || preparing || !preparedSelectionId || hasConflicts || worktreeMutationBlocked || status.selectedPaths.length === 0 || !message.trim()

  useEffect(() => {
    if (!commitDialogOpen) return
    setError(null)
    setCommitNotice(null)
  }, [commitDialogOpen])

  useEffect(() => {
    if (!commitDialogOpen) {
      setPreparedSelectionId(null)
      setPreparing(false)
      return
    }
    if (hasConflicts || worktreeMutationBlocked || selectedPathsKey === "[]") {
      setPreparedSelectionId(null)
      setPreparing(false)
      return
    }

    let active = true
    const selectedPaths = JSON.parse(selectedPathsKey) as string[]
    setPreparing(true)
    setPreparedSelectionId(null)
    setError(null)
    void requireSynapseBridge().git.prepareChangeSelection({
      repositoryId: repository.id,
      paths: selectedPaths,
    }).then((selection) => {
      if (active) setPreparedSelectionId(selection.selectionId)
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "无法确认所选改动。")
    }).finally(() => {
      if (active) setPreparing(false)
    })
    return () => {
      active = false
    }
  }, [commitDialogOpen, hasConflicts, repository.id, selectedPathsKey, worktreeMutationBlocked])

  const commit = async () => {
    const finishTracking = startTrackedOperation({ component: "git", eventKey: "git.commit" })
    setBusy(true)
    setError(null)
    setCommitNotice(null)
    try {
      if (!preparedSelectionId) throw new Error("请重新审阅所选改动后再提交。")
      await requireSynapseBridge().git.commit({
        repositoryId: repository.id,
        message: message.trim(),
        selectionId: preparedSelectionId,
      })
      setPreparedSelectionId(null)
      setMessage("")
      const nextSnapshot = await status.refresh()
      await onCommitted?.()
      finishTracking("success")
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
      finishTracking("failure")
      const nextError = err instanceof Error ? err.message : "提交失败。"
      if (nextError.includes("重新审阅") || nextError.includes("已过期")) setPreparedSelectionId(null)
      setError(nextError)
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
    if (!open) setPreparedSelectionId(null)
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
              <TooltipProvider>
                {changes.map((change) => {
                  const checked = status.selectedPaths.includes(change.path)
                  const active = status.selectedFile?.path === change.path
                  const indicator = statusIndicators[change.status]
                  return (
                    <div
                      key={`${change.path}:${change.originalPath ?? ""}`}
                      data-active={active ? "true" : undefined}
                      className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center data-[active=true]:bg-muted"
                    >
                      <span className="flex items-center pl-3">
                        <Checkbox
                          aria-label={`选择 ${change.path}`}
                          checked={checked}
                          onCheckedChange={() => status.togglePath(change.path)}
                        />
                      </span>
                      <button
                        type="button"
                        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 py-1.5 pr-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                        onClick={() => void status.loadDiff(change)}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              aria-label={indicator.label}
                              className={`inline-flex size-4 shrink-0 items-center justify-center text-sm font-bold ${indicator.className}`}
                            >
                              {indicator.letter}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right">{indicator.label}</TooltipContent>
                        </Tooltip>
                        <span className="min-w-0 truncate text-sm font-normal">{change.path}</span>
                      </button>
                    </div>
                  )
                })}
              </TooltipProvider>
            )}
          </div>
        </ScrollArea>
        <ScrollArea
          className="min-h-0 min-w-0 max-w-full"
          data-git-changes-detail-pane="true"
          viewportClassName="min-w-0 max-w-full overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!max-w-full"
        >
          <div className="min-w-0 max-w-full overflow-hidden" data-git-changes-detail-content="true">
            {status.error ? (
              <div className="p-4">
                <Alert variant="destructive">
                  <AlertTitle>读取失败</AlertTitle>
                  <AlertDescription>{status.error}</AlertDescription>
                </Alert>
              </div>
            ) : status.diffLoading ? (
              <div className="p-4"><GitDiffSkeleton /></div>
            ) : status.diff ? (
              <GitDiffViewer
                path={status.diff.path}
                originalPath={status.diff.originalPath}
                statusLabel={status.selectedFile ? statusIndicators[status.selectedFile.status].label : undefined}
                text={status.diff.text}
                binary={status.diff.binary}
                truncated={status.diff.truncated}
                mode={diffViewMode}
                wrap={diffWrap}
                onModeChange={onDiffViewModeChange}
                onWrapChange={onDiffWrapChange}
              />
            ) : (
              <div className="p-4">
                <Empty className="min-h-64 border bg-muted/20">
                  <EmptyHeader>
                    <EmptyTitle>选择文件查看差异</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
      <Dialog
        open={commitDialogOpen}
        onOpenChange={handleCommitDialogOpenChange}
        data-track="git-commit-dialog"
      >
        <DialogContent
          className="sm:max-w-lg"
          showCloseButton={!busy}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef?.current) return
            event.preventDefault()
            returnFocusRef.current.focus()
          }}
        >
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
            {worktreeMutationBlocked ? (
              <Alert>
                <AlertTitle>{actionPlan.blockerText}</AlertTitle>
                <AlertDescription>{actionPlan.recoveryText}</AlertDescription>
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
            <Button type="button" disabled={commitDisabled} onClick={() => void commit()} data-track="git.commit.submit">
              {preparing ? "准备中" : busy ? "提交中" : "提交选中文件"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function GitListSkeleton() {
  return (
    <div className="grid gap-0 p-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 py-1.5">
          <Skeleton className="size-4" />
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-full max-w-56" />
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
