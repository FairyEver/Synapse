import { useState } from "react"
import { ArrowLeft, Info, MoreHorizontal } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitRepository } from "@/types/git"
import type { GitOperationFailure } from "../hooks/use-git-operations"
import { readOperationFailure } from "../hooks/use-git-operations"
import { useGitHistory } from "../hooks/use-git-history"
import { useGitWorktreeStatus } from "../hooks/use-git-worktree-status"
import { GitBranchSwitcher } from "./git-branch-switcher"
import { GitChangesTab } from "./git-changes-tab"
import { GitHistoryTab } from "./git-history-tab"
import { canHandleGitFailureAction, getGitFailureActionLabel } from "../lib/git-failure-view"
import { getGitActionPlan, getGitErrorAdvice } from "../lib/git-status-view"

type GitWorkbenchProps = {
  readonly repository: SynapseGitRepository
  readonly onBack: () => void
  readonly onOperationFailure?: (failure: GitOperationFailure | null) => void
  readonly onHandleFailure?: (failure: GitOperationFailure) => void
}

export function GitWorkbench({ repository, onBack, onOperationFailure, onHandleFailure }: GitWorkbenchProps) {
  const [view, setView] = useState("changes")
  const [busy, setBusy] = useState<"sync" | "pull" | "push" | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [operationFailure, setOperationFailure] = useState<GitOperationFailure | null>(null)
  const [branchRefreshKey, setBranchRefreshKey] = useState(0)
  const status = useGitWorktreeStatus(repository)
  const history = useGitHistory(repository, { enabled: view === "history" })
  const currentBranch = status.snapshot?.currentBranch ?? null
  const actionPlan = getGitActionPlan(status.snapshot, status.error)
  const recommendedAction = actionPlan.primaryAction

  const refreshAll = async () => {
    await status.refresh()
    if (history.hasLoaded) {
      await history.refresh()
    }
  }

  const refreshAfterBranchChange = async () => {
    await refreshAll()
    setBranchRefreshKey((value) => value + 1)
  }

  const run = async (kind: "sync" | "pull" | "push", action: () => Promise<unknown>) => {
    setBusy(kind)
    setOperationError(null)
    setOperationFailure(null)
    try {
      await action()
      await refreshAll()
    } catch (err) {
      const failure = readOperationFailure(err, undefined, repository.id, kind)
      setOperationError(err instanceof Error ? err.message : "操作失败。")
      setOperationFailure(failure)
      onOperationFailure?.(failure)
    } finally {
      setBusy(null)
    }
  }

  const runRecommendedAction = () => {
    if (recommendedAction === "pull") {
      void run("pull", () => requireSynapseBridge().git.pull(repository.id))
      return
    }
    if (recommendedAction === "push") {
      void run("push", () => requireSynapseBridge().git.push(repository.id))
      return
    }
    if (recommendedAction === "sync") {
      void run("sync", () => requireSynapseBridge().git.sync(repository.id))
      return
    }
    setView("changes")
  }

  const recommendedLabel = busy === recommendedAction ? `${actionPlan.primaryLabel}中` : actionPlan.primaryLabel
  const statusLabel = statusStateLabel(actionPlan.statusText, status.snapshot?.ahead, status.snapshot?.behind)
  const showContextNote = Boolean(actionPlan.blockerText || actionPlan.recoveryText)
  const canRunGitOperation = busy === null
  const failureActionLabel = canHandleGitFailureAction(operationFailure) ? getGitFailureActionLabel(operationFailure) : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        className="grid shrink-0 gap-2 border-b bg-background px-4 py-3"
        data-git-workbench-toolbar="true"
      >
        <div
          className="grid min-w-0 gap-3 lg:grid-cols-[minmax(260px,1fr)_minmax(220px,420px)_minmax(220px,1fr)] lg:items-start"
          data-git-workbench-primary-bar="true"
        >
          <div className="flex min-w-0 items-start gap-2" data-git-workbench-repository-context="true">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="mt-0.5 shrink-0"
              aria-label="返回仓库列表"
              onClick={onBack}
            >
              <ArrowLeft />
            </Button>
            <div className="grid min-w-0 gap-1">
              <div className="truncate text-sm font-semibold leading-5">{repository.name}</div>
              <div className="truncate text-xs text-muted-foreground">{repository.localPath}</div>
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 lg:pt-0.5">
            <GitBranchSwitcher
              repository={repository}
              currentBranch={currentBranch}
              disabled={busy !== null}
              mode="select"
              refreshKey={branchRefreshKey}
              onChanged={refreshAfterBranchChange}
            />
            <Badge variant="secondary" className="max-w-28 truncate">
              {statusLabel}
            </Badge>
          </div>
          <div
            className="flex min-w-0 max-w-full flex-wrap items-center justify-start gap-2 lg:justify-end lg:pt-0.5"
            data-git-workbench-action-bar="true"
          >
            <Button
              type="button"
              size="sm"
              disabled={busy !== null || recommendedAction === "none"}
              onClick={runRecommendedAction}
            >
              {recommendedLabel}
            </Button>
            <GitBranchSwitcher
              repository={repository}
              currentBranch={currentBranch}
              disabled={busy !== null}
              mode="create"
              onChanged={refreshAfterBranchChange}
            />
            <DropdownMenu data-track="git-workbench-more-actions">
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="icon-sm" aria-label="更多 Git 操作">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!canRunGitOperation}
                  onSelect={() => void run("pull", () => requireSynapseBridge().git.pull(repository.id))}
                >
                  拉取
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canRunGitOperation}
                  onSelect={() => void run("push", () => requireSynapseBridge().git.push(repository.id))}
                >
                  推送
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canRunGitOperation}
                  onSelect={() => void run("sync", () => requireSynapseBridge().git.sync(repository.id))}
                >
                  同步
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div
          className="grid min-w-0 gap-2 text-xs text-muted-foreground md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
          data-git-workbench-secondary-bar="true"
        >
          <div className="flex min-w-0 items-center gap-2">
            {showContextNote ? (
              <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
                {actionPlan.blockerText ? <Badge variant="outline">{actionPlan.blockerText}</Badge> : null}
                {actionPlan.recoveryText ? <span>{actionPlan.recoveryText}</span> : null}
              </span>
            ) : <span aria-hidden="true" />}
          </div>
          <div
            className="flex min-w-0 max-w-full flex-wrap items-center gap-2 md:justify-end"
            data-git-workbench-metadata-bar="true"
          >
            {status.snapshot?.upstream ? (
              <Badge variant="outline" className="hidden max-w-52 truncate sm:inline-flex">
                {status.snapshot.upstream}
              </Badge>
            ) : null}
            {status.snapshot ? (
              <Badge variant="outline" className="hidden sm:inline-flex">
                ↑{status.snapshot.ahead} ↓{status.snapshot.behind}
              </Badge>
            ) : null}
            <RepositoryDetailsPopover
              repository={repository}
              currentBranch={currentBranch}
              upstream={status.snapshot?.upstream ?? null}
              ahead={status.snapshot?.ahead ?? null}
              behind={status.snapshot?.behind ?? null}
              statusText={actionPlan.statusText}
            />
          </div>
        </div>
      </div>
      {operationError ? (
        <div className="shrink-0 px-4 py-3">
          <Alert variant="destructive">
            <AlertTitle>{operationFailure?.title ?? "操作失败"}</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col gap-2">
                <span>{operationFailure?.message ?? `${operationError} ${getGitErrorAdvice(operationError)}`}</span>
                {operationFailure && failureActionLabel ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => onHandleFailure?.(operationFailure)}
                  >
                    {failureActionLabel}
                  </Button>
                ) : null}
              </div>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      <Tabs value={view} onValueChange={setView} className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
        <div className="shrink-0 border-b bg-background px-4 py-2">
          <TabsList>
            <TabsTrigger value="changes">改动</TabsTrigger>
            <TabsTrigger value="history">历史</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="changes" className="m-0 min-h-0 min-w-0 flex-1 data-[state=inactive]:hidden">
          <GitChangesTab
            repository={repository}
            status={status}
            pushDisabled={busy !== null}
            onCommitted={history.hasLoaded ? history.refresh : undefined}
            onPush={() => void run("push", () => requireSynapseBridge().git.push(repository.id))}
          />
        </TabsContent>
        <TabsContent value="history" className="m-0 min-h-0 min-w-0 flex-1 data-[state=inactive]:hidden">
          <GitHistoryTab history={history} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function statusStateLabel(statusText: string, ahead?: number, behind?: number): string {
  if (ahead === undefined || behind === undefined) return statusText
  if (ahead === 0 && behind === 0) return statusText
  return `${statusText} · ↑${ahead} ↓${behind}`
}

type RepositoryDetailsPopoverProps = {
  readonly repository: SynapseGitRepository
  readonly currentBranch: string | null
  readonly upstream: string | null
  readonly ahead: number | null
  readonly behind: number | null
  readonly statusText: string
}

function RepositoryDetailsPopover({
  repository,
  currentBranch,
  upstream,
  ahead,
  behind,
  statusText,
}: RepositoryDetailsPopoverProps) {
  return (
    <Popover data-track="git-repository-details">
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Info data-icon="inline-start" />
          详情
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 sm:w-96">
        <div className="grid gap-2 text-xs">
          <RepositoryDetail label="路径" value={repository.localPath} />
          <RepositoryDetail label="分支" value={currentBranch ?? "无分支"} />
          <RepositoryDetail label="上游" value={upstream ?? "未设置"} />
          <RepositoryDetail label="状态" value={statusText} />
          <RepositoryDetail label="同步" value={ahead === null || behind === null ? "未知" : `↑${ahead} ↓${behind}`} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function RepositoryDetail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all text-foreground">{value}</span>
    </div>
  )
}
