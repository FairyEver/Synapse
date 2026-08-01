import { useMemo, useState, type MouseEvent } from "react"
import { Download, MoreHorizontal, RefreshCw, Trash2, Upload } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SynapseGitRepository, SynapseGitRepositorySummary } from "@/types/git"
import type { GitOperationBusyState, GitOperationFailure, GitRepositoryOperation } from "../hooks/use-git-operations"
import { canHandleGitFailureAction, getGitFailureActionLabel } from "../lib/git-failure-view"
import {
  getGitChangeCount,
  getGitActionPlan,
  isGitUnavailable,
  needsGitAttention,
} from "../lib/git-status-view"

type GitRepositoryListProps = {
  readonly summaries: readonly SynapseGitRepositorySummary[]
  readonly loading: boolean
  readonly error: string | null
  readonly failure?: GitOperationFailure | null
  readonly busy: GitOperationBusyState
  readonly onOpenRepository: (repository: SynapseGitRepository) => void
  readonly onPull: (repositoryId: string) => void
  readonly onPush: (repositoryId: string, trackingStatus: "tracked" | "untracked" | "detached") => void
  readonly onSync: (repositoryId: string) => void
  readonly onCancel: (repositoryId: string) => void
  readonly onRemoveRepository: (repositoryId: string) => Promise<boolean>
  readonly onHandleFailure?: (failure: GitOperationFailure) => void
}

function stopAction(
  event: MouseEvent<HTMLButtonElement>,
  action: () => void,
) {
  event.stopPropagation()
  action()
}

function isGlobalBusy(busy: GitOperationBusyState): boolean {
  return busy.global !== null
}

function isRepositoryBusy(busy: GitOperationBusyState, repositoryId: string): boolean {
  return busy.repositories[repositoryId] !== undefined
}

function isRepositoryOperationBusy(
  busy: GitOperationBusyState,
  repositoryId: string,
  operation: GitRepositoryOperation,
): boolean {
  return busy.repositories[repositoryId] === operation
}

function operationLabel(operation: GitRepositoryOperation, phase?: string): string {
  const suffix = phase === "queued" ? "等待中" : "执行中"
  if (operation === "pull") return `拉取${suffix}`
  if (operation === "push") return `推送${suffix}`
  if (operation === "sync") return `同步${suffix}`
  return "删除中"
}

export function GitRepositoryList({
  summaries,
  loading,
  error,
  failure,
  busy,
  onOpenRepository,
  onPull,
  onPush,
  onSync,
  onCancel,
  onRemoveRepository,
  onHandleFailure,
}: GitRepositoryListProps) {
  const globalActionDisabled = isGlobalBusy(busy)
  const failureActionLabel = canHandleGitFailureAction(failure) ? getGitFailureActionLabel(failure) : null
  const [filter, setFilter] = useState<"all" | "attention" | "clean" | "unavailable">("all")
  const [removalTarget, setRemovalTarget] = useState<SynapseGitRepository | null>(null)
  const [removalError, setRemovalError] = useState<string | null>(null)
  const filteredSummaries = useMemo(() => summaries.filter((summary) => {
    if (filter === "attention") return needsGitAttention(summary.snapshot, summary.error)
    if (filter === "clean") return !needsGitAttention(summary.snapshot, summary.error)
    if (filter === "unavailable") return isGitUnavailable(summary.snapshot, summary.error)
    return true
  }), [filter, summaries])

  const closeRemovalDialog = () => {
    setRemovalTarget(null)
    setRemovalError(null)
  }

  const openRemovalDialog = (repository: SynapseGitRepository) => {
    setRemovalTarget(repository)
    setRemovalError(null)
  }

  const handleRemoveRepository = async () => {
    if (!removalTarget) return

    setRemovalError(null)
    const removed = await onRemoveRepository(removalTarget.id)

    if (removed) {
      closeRemovalDialog()
      return
    }

    setRemovalError("移除记录失败。")
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <AlertDialog
        open={removalTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isRepositoryOperationBusy(busy, removalTarget?.id ?? "", "remove")) {
            closeRemovalDialog()
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>移除 Git 仓库？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>只会从 Synapse 列表移除，本地目录不会改变。</p>
                {removalTarget ? (
                  <p className="break-all text-foreground" data-allow-select="true">
                    目录：{removalTarget.localPath}
                  </p>
                ) : null}
                {removalError ? (
                  <p className="text-destructive">{removalError}</p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRepositoryOperationBusy(busy, removalTarget?.id ?? "", "remove")}>
              取消
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={isRepositoryOperationBusy(busy, removalTarget?.id ?? "", "remove")}
              onClick={() => {
                void handleRemoveRepository()
              }}
            >
              {isRepositoryOperationBusy(busy, removalTarget?.id ?? "", "remove")
                ? "移除中..."
                : "移除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="space-y-3 p-4">
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>{failure?.title ?? "操作失败"}</AlertTitle>
                <AlertDescription>
                  <div className="flex flex-col gap-2">
                    <span>{failure?.message ?? error}</span>
                    {failure && failureActionLabel ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        onClick={() => onHandleFailure?.(failure)}
                      >
                        {failureActionLabel}
                      </Button>
                    ) : null}
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Spinner />
              </div>
            ) : summaries.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>暂无仓库</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
                  <TabsList>
                    <TabsTrigger value="all">全部</TabsTrigger>
                    <TabsTrigger value="attention">需要处理</TabsTrigger>
                    <TabsTrigger value="clean">已同步</TabsTrigger>
                    <TabsTrigger value="unavailable">不可访问</TabsTrigger>
                  </TabsList>
                </Tabs>
                {filteredSummaries.length === 0 ? (
                  <Empty className="border">
                    <EmptyHeader>
                      <EmptyTitle>没有匹配仓库</EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className="divide-y divide-border overflow-hidden rounded-lg border bg-background">
                    {filteredSummaries.map((summary) => {
                      const { repository, snapshot } = summary
                      const repositoryActionDisabled = globalActionDisabled || isRepositoryBusy(busy, repository.id)
                      const actionPlan = getGitActionPlan(snapshot, summary.error)
                      const changeCount = getGitChangeCount(snapshot)
                      const branch = snapshot?.currentBranch ?? "无分支"
                      const isClean = !needsGitAttention(snapshot, summary.error)
                      const runningOperation = busy.repositories[repository.id]
                      const rowFailure = failure?.repositoryId === repository.id ? failure : null
                      const runPrimaryAction = () => {
                        if (actionPlan.primaryAction === "pull") {
                          onPull(repository.id)
                          return
                        }
                        if (actionPlan.primaryAction === "push") {
                          onPush(repository.id, snapshot?.trackingStatus ?? "detached")
                          return
                        }
                        if (actionPlan.primaryAction === "sync") {
                          onSync(repository.id)
                          return
                        }
                        onOpenRepository(repository)
                      }
                      const primaryLabel = runningOperation && actionPlan.primaryAction === runningOperation
                        ? operationLabel(runningOperation, busy.repositoryPhases?.[repository.id])
                        : actionPlan.primaryLabel

                      return (
                        <div
                          key={repository.id}
                          role="button"
                          tabIndex={0}
                          className="grid w-full gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                          onClick={() => onOpenRepository(repository)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") onOpenRepository(repository)
                          }}
                        >
                      <span className="min-w-0">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">{repository.name}</span>
                          <Badge variant={isClean ? "secondary" : "outline"}>{actionPlan.statusText}</Badge>
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">{repository.localPath}</span>
                        <span className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{branch}</span>
                          {snapshot?.upstream ? <span className="truncate">{snapshot.upstream}</span> : null}
                          {changeCount > 0 ? <span>{changeCount} 个改动</span> : null}
                          {snapshot && (snapshot.ahead > 0 || snapshot.behind > 0) ? (
                            <span>↑{snapshot.ahead} ↓{snapshot.behind}</span>
                          ) : null}
                          {summary.error ? <span className="text-destructive">{summary.error}</span> : null}
                          {rowFailure ? <span className="text-destructive">{rowFailure.title}</span> : null}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-2 md:justify-end">
                        <Button
                          type="button"
                          size="sm"
                          disabled={repositoryActionDisabled || actionPlan.primaryAction === "none"}
                          onClick={(event) => stopAction(event, runPrimaryAction)}
                        >
                          {actionPlan.primaryAction === "pull" ? <Download data-icon="inline-start" /> : null}
                          {actionPlan.primaryAction === "push" ? <Upload data-icon="inline-start" /> : null}
                          {actionPlan.primaryAction === "sync" ? (
                            <RefreshCw
                              data-icon="inline-start"
                              className={isRepositoryOperationBusy(busy, repository.id, "sync") ? "animate-spin" : undefined}
                            />
                          ) : null}
                          {primaryLabel}
                        </Button>
                        {runningOperation && runningOperation !== "remove" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={(event) => stopAction(event, () => onCancel(repository.id))}
                          >
                            取消
                          </Button>
                        ) : null}
                        {actionPlan.primaryAction !== "open" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={repositoryActionDisabled}
                            onClick={(event) => stopAction(event, () => onOpenRepository(repository))}
                          >
                            进入
                          </Button>
                        ) : null}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              disabled={repositoryActionDisabled}
                              aria-label={`${repository.name} 更多操作`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                            <DropdownMenuItem onSelect={() => onPull(repository.id)}>
                              <Download data-icon="inline-start" />
                              拉取
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onPush(repository.id, snapshot?.trackingStatus ?? "detached")}>
                              <Upload data-icon="inline-start" />
                              推送
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onSync(repository.id)}>
                              <RefreshCw data-icon="inline-start" />
                              同步
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => openRemovalDialog(repository)}
                            >
                              <Trash2 data-icon="inline-start" />
                              移除仓库
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
