import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Info, MoreHorizontal, RefreshCw } from "lucide-react"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { startTrackedOperation } from "@/lib/ui-tracking"
import type { SynapseGitOperationState, SynapseGitRepository, SynapseGitRepositorySnapshot } from "@/types/git"
import type { GitOperationFailure } from "../hooks/use-git-operations"
import { readOperationFailure } from "../hooks/use-git-operations"
import { useGitHistory } from "../hooks/use-git-history"
import { useGitWorktreeStatus } from "../hooks/use-git-worktree-status"
import { GitBranchSwitcher } from "./git-branch-switcher"
import { GitChangesTab } from "./git-changes-tab"
import { GitDiscardChangesDialog } from "./git-discard-changes-dialog"
import type { GitDiffViewMode } from "./git-diff-viewer-adapter"
import { GitHistoryTab } from "./git-history-tab"
import { canHandleGitFailureAction, getGitFailureActionLabel } from "../lib/git-failure-view"
import { getGitActionPlan, getGitErrorAdvice } from "../lib/git-status-view"

type GitWorkbenchProps = {
  readonly repository: SynapseGitRepository
  readonly onBack: () => void
  readonly onOperationFailure?: (failure: GitOperationFailure | null) => void
  readonly onHandleFailure?: (failure: GitOperationFailure) => void
  readonly onInitialize?: (repository: SynapseGitRepository, onCompleted: () => void | Promise<void>) => void
  readonly onSelectPushRemote?: (
    repositoryId: string,
    trackingStatus: SynapseGitRepositorySnapshot["trackingStatus"],
  ) => Promise<string | null | undefined>
}

export function GitWorkbench({ repository, onBack, onOperationFailure, onHandleFailure, onInitialize, onSelectPushRemote }: GitWorkbenchProps) {
  const [view, setView] = useState("changes")
  const [busy, setBusy] = useState<"sync" | "pull" | "push" | null>(null)
  const [operationPhase, setOperationPhase] = useState<SynapseGitOperationState["status"] | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [operationFailure, setOperationFailure] = useState<GitOperationFailure | null>(null)
  const [branchRefreshKey, setBranchRefreshKey] = useState(0)
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
  const [diffViewMode, setDiffViewMode] = useState<GitDiffViewMode>("unified")
  const [diffWrap, setDiffWrap] = useState(false)
  const activeOperationIdRef = useRef<string | null>(null)
  const observedBranchRef = useRef<string | null | undefined>(undefined)
  const retryActionRef = useRef<(() => void) | null>(null)
  const discardButtonRef = useRef<HTMLButtonElement>(null)
  const commitButtonRef = useRef<HTMLButtonElement>(null)
  const refreshButtonRef = useRef<HTMLButtonElement>(null)
  const status = useGitWorktreeStatus(repository, { autoRefreshEnabled: busy === null })
  const history = useGitHistory(repository, { enabled: view === "history" && Boolean(status.snapshot && status.snapshot.hasCommits !== false) })
  const initialStatusLoading = status.loading && !status.snapshot && !status.error
  const currentBranch = status.snapshot?.currentBranch ?? null
  const actionPlan = getGitActionPlan(status.snapshot, status.error)
  const recommendedAction = actionPlan.primaryAction
  const changes = status.snapshot?.changes ?? []
  const selectedChanges = changes.filter((change) => status.selectedPaths.includes(change.path))
  const worktreeMutationBlocked = Boolean(status.snapshot && status.snapshot.repositoryOperationState !== "normal")
  const syncBoundaryBlocked = status.snapshot?.trackingStatus === "gone"
    || Boolean(status.snapshot && status.snapshot.ahead > 0 && status.snapshot.behind > 0)
  const remoteIntegrationBlocked = status.snapshot?.hasCommits === false || syncBoundaryBlocked
  const syncBoundaryPlan = syncBoundaryBlocked && status.snapshot
    ? getGitActionPlan({ ...status.snapshot, changeCount: 0, changes: [] })
    : null
  const repositoryDisplayPath = formatRepositoryDisplayPath(repository.localPath)

  useEffect(() => {
    const subscribe = requireSynapseBridge().git.onOperationChanged
    if (typeof subscribe !== "function") return
    return subscribe((state) => {
      if (state.operationId === activeOperationIdRef.current) setOperationPhase(state.status)
    })
  }, [])

  useEffect(() => {
    if (!status.snapshot) return
    const previousBranch = observedBranchRef.current
    observedBranchRef.current = currentBranch
    if (previousBranch === undefined || previousBranch === currentBranch) return
    setBranchRefreshKey((value) => value + 1)
    if (history.hasLoaded) void history.refresh()
  }, [currentBranch, history.hasLoaded, history.refresh, status.snapshot])

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

  const run = async (kind: "sync" | "pull" | "push", action: (operationId: string) => Promise<unknown>) => {
    const eventKey = kind === "sync"
      ? "git.repository.sync"
      : kind === "pull"
        ? "git.repository.pull"
        : "git.repository.push"
    const finishTracking = startTrackedOperation({ component: "git", eventKey })
    const operationId = globalThis.crypto?.randomUUID?.() ?? `git-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    activeOperationIdRef.current = operationId
    setBusy(kind)
    setOperationPhase("queued")
    setOperationError(null)
    setOperationFailure(null)
    try {
      await action(operationId)
      await refreshAll()
      finishTracking("success")
    } catch (err) {
      if (err instanceof Error && (err.name === "GitOperationCancelledError" || /操作已取消/.test(err.message))) {
        finishTracking("cancelled")
        await refreshAll()
        setOperationError(null)
        setOperationFailure(null)
        return
      }
      await refreshAll()
      const failure = readOperationFailure(err, undefined, repository.id, kind)
      finishTracking("failure")
      setOperationError(err instanceof Error ? err.message : "操作失败。")
      setOperationFailure(failure)
      retryActionRef.current = failure && (failure.category === "network" || failure.category === "timeout")
        ? () => { void run(kind, action) }
        : null
      onOperationFailure?.(failure)
    } finally {
      if (activeOperationIdRef.current === operationId) activeOperationIdRef.current = null
      setBusy(null)
      setOperationPhase(null)
    }
  }

  const runPush = async () => {
    if (status.snapshot?.hasCommits === false) {
      onInitialize?.(repository, refreshAll)
      return
    }
    const trackingStatus = status.snapshot?.trackingStatus ?? "detached"
    const remoteName = await onSelectPushRemote?.(repository.id, trackingStatus)
    if (remoteName === null) return
    await run("push", (operationId) => requireSynapseBridge().git.push(repository.id, remoteName, operationId))
  }

  const runRecommendedAction = () => {
    if (recommendedAction === "initialize") {
      onInitialize?.(repository, refreshAll)
      return
    }
    if (recommendedAction === "pull") {
      void run("pull", (operationId) => requireSynapseBridge().git.pull(repository.id, operationId))
      return
    }
    if (recommendedAction === "push") {
      void runPush()
      return
    }
    if (recommendedAction === "sync") {
      void run("sync", (operationId) => requireSynapseBridge().git.sync(repository.id, operationId))
      return
    }
    setView("changes")
    if ((status.snapshot?.changeCount ?? 0) > 0) {
      setCommitDialogOpen(true)
    }
  }

  const recommendedLabel = busy === recommendedAction
    ? (operationPhase === "queued" ? "等待中" : `${actionPlan.primaryLabel}中`)
    : actionPlan.primaryLabel
  const canRunGitOperation = busy === null
  const failureActionLabel = canHandleGitFailureAction(operationFailure) ? getGitFailureActionLabel(operationFailure) : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        className="grid shrink-0 gap-1.5 border-b bg-background px-4 py-2"
        data-git-workbench-toolbar="true"
      >
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2" data-git-workbench-primary-bar="true">
          <div className="flex min-w-0 items-center gap-1.5" data-git-workbench-repository-context="true">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label="返回仓库列表"
              onClick={onBack}
            >
              <ArrowLeft />
            </Button>
            <div className="truncate text-sm font-semibold leading-5">{repository.name}</div>
            <RepositoryDetailsPopover
              repository={repository}
              currentBranch={currentBranch}
              upstream={status.snapshot?.upstream ?? null}
              ahead={status.snapshot?.ahead ?? null}
              behind={status.snapshot?.behind ?? null}
              statusText={actionPlan.statusText}
            />
          </div>
          <GitBranchSwitcher
            repository={repository}
            currentBranch={currentBranch}
            disabled={initialStatusLoading || busy !== null || worktreeMutationBlocked}
            loading={initialStatusLoading}
            mode="select"
            selectWidth="compact"
            refreshKey={branchRefreshKey}
            onChanged={refreshAfterBranchChange}
          />
          <Badge variant="secondary" className="max-w-32 truncate">
            {actionPlan.statusText}
          </Badge>
        </div>
        <div
          className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-2"
          data-git-workbench-action-bar="true"
        >
          <span
            className="max-w-80 truncate text-xs text-muted-foreground"
            title={repository.localPath}
          >
            {repositoryDisplayPath}
          </span>
          <div
            className="flex min-w-0 max-w-full flex-wrap items-center justify-start gap-2 text-sm lg:justify-end"
            data-git-changes-selection-bar="true"
          >
            {view === "changes" && changes.length > 0 ? (
              <>
                <span className="text-muted-foreground">已选 {status.selectedPaths.length} / {changes.length}</span>
                <Button type="button" variant="outline" size="sm" onClick={status.selectAll}>
                  全选
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={status.clearSelection}>
                  全不选
                </Button>
                <Button
                  ref={discardButtonRef}
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy !== null || worktreeMutationBlocked || selectedChanges.length === 0}
                  onClick={() => setDiscardDialogOpen(true)}
                >
                  丢弃改动
                </Button>
              </>
            ) : null}
            <GitBranchSwitcher
              repository={repository}
              currentBranch={currentBranch}
              disabled={initialStatusLoading || busy !== null}
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
                  disabled={!canRunGitOperation || worktreeMutationBlocked || remoteIntegrationBlocked}
                  onSelect={() => void run("pull", (operationId) => requireSynapseBridge().git.pull(repository.id, operationId))}
                >
                  拉取
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canRunGitOperation || Boolean(status.snapshot && status.snapshot.ahead > 0 && status.snapshot.behind > 0)}
                  onSelect={() => void runPush()}
                >
                  推送
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canRunGitOperation || worktreeMutationBlocked || remoteIntegrationBlocked}
                  onSelect={() => void run("sync", (operationId) => requireSynapseBridge().git.sync(repository.id, operationId))}
                >
                  同步
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              ref={refreshButtonRef}
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={busy !== null}
              aria-label="刷新仓库状态"
              onClick={() => void refreshAll()}
            >
              <RefreshCw />
            </Button>
            <Button
              ref={commitButtonRef}
              type="button"
              size="sm"
              disabled={busy !== null || recommendedAction === "none" || (syncBoundaryBlocked && changes.length === 0)}
              onClick={runRecommendedAction}
            >
              {recommendedLabel}
            </Button>
            {busy ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const operationId = activeOperationIdRef.current
                  if (operationId) void requireSynapseBridge().git.cancelOperation(operationId)
                }}
              >
                取消
              </Button>
            ) : null}
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
                    onClick={() => {
                      if (operationFailure.primaryAction === "retry" && retryActionRef.current) {
                        retryActionRef.current()
                        return
                      }
                      onHandleFailure?.(operationFailure)
                    }}
                  >
                    {failureActionLabel}
                  </Button>
                ) : null}
              </div>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      {!operationError && worktreeMutationBlocked ? (
        <div className="shrink-0 px-4 py-3">
          <Alert>
            <AlertTitle>{actionPlan.blockerText}</AlertTitle>
            <AlertDescription>{actionPlan.recoveryText}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      {!operationError && !worktreeMutationBlocked && syncBoundaryBlocked ? (
        <div className="shrink-0 px-4 py-3">
          <Alert>
            <AlertTitle>{syncBoundaryPlan?.blockerText}</AlertTitle>
            <AlertDescription>{syncBoundaryPlan?.recoveryText}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      <GitDiscardChangesDialog
        repository={repository}
        selectedChanges={selectedChanges}
        open={discardDialogOpen}
        onOpenChange={setDiscardDialogOpen}
        returnFocusRef={discardButtonRef}
        onDiscarded={async () => {
          await status.refresh()
          globalThis.setTimeout(() => refreshButtonRef.current?.focus(), 0)
        }}
      />
      <Tabs value={view} onValueChange={setView} className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
        <div className="shrink-0 border-b bg-background px-4 py-2" data-git-workbench-tabs-header="true">
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
            commitDialogOpen={commitDialogOpen}
            onCommitDialogOpenChange={setCommitDialogOpen}
            onCommitted={history.hasLoaded ? history.refresh : undefined}
            onPush={() => void runPush()}
            diffViewMode={diffViewMode}
            diffWrap={diffWrap}
            onDiffViewModeChange={setDiffViewMode}
            onDiffWrapChange={setDiffWrap}
            returnFocusRef={commitButtonRef}
          />
        </TabsContent>
        <TabsContent value="history" className="m-0 min-h-0 min-w-0 flex-1 data-[state=inactive]:hidden">
          <GitHistoryTab
            history={history}
            diffViewMode={diffViewMode}
            diffWrap={diffWrap}
            onDiffViewModeChange={setDiffViewMode}
            onDiffWrapChange={setDiffWrap}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
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
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="仓库详情">
                <Info />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>详情</TooltipContent>
        </Tooltip>
      </TooltipProvider>
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

function formatRepositoryDisplayPath(path: string): string {
  if (path.startsWith("/Users/") || path.startsWith("/home/")) {
    const [, root, user, ...parts] = path.split("/")
    if (root && user && parts.length > 0) return formatCompactPath("~", parts)
  }
  const parts = path.split("/").filter(Boolean)
  if (parts.length > 0 && path.length > 48) return formatCompactPath(path.startsWith("/") ? "/" : "", parts)
  return path
}

function formatCompactPath(prefix: string, parts: readonly string[]): string {
  if (parts.length <= 6) return prefix ? `${prefix}/${parts.join("/")}`.replace("//", "/") : parts.join("/")
  const compact = [...parts.slice(0, 4), "...", ...parts.slice(-2)].join("/")
  return prefix ? `${prefix}/${compact}`.replace("//", "/") : compact
}

function RepositoryDetail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all text-foreground">{value}</span>
    </div>
  )
}
