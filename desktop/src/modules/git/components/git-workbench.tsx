import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitRepository } from "@/types/git"
import { useGitHistory } from "../hooks/use-git-history"
import { useGitWorktreeStatus } from "../hooks/use-git-worktree-status"
import { GitBranchSwitcher } from "./git-branch-switcher"
import { GitChangesTab } from "./git-changes-tab"
import { GitHistoryTab } from "./git-history-tab"
import { getGitErrorAdvice, getGitRecommendedAction, getGitStatusText } from "../lib/git-status-view"

type GitWorkbenchProps = {
  readonly repository: SynapseGitRepository
  readonly onBack: () => void
}

export function GitWorkbench({ repository, onBack }: GitWorkbenchProps) {
  const [view, setView] = useState("changes")
  const [busy, setBusy] = useState<"sync" | "pull" | "push" | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const status = useGitWorktreeStatus(repository)
  const history = useGitHistory(repository)
  const currentBranch = status.snapshot?.currentBranch ?? null
  const recommendedAction = getGitRecommendedAction(status.snapshot, status.error)
  const statusText = getGitStatusText(status.snapshot, status.error)

  const refreshAll = async () => {
    await status.refresh()
    await history.refresh()
  }

  const run = async (kind: "sync" | "pull" | "push", action: () => Promise<unknown>) => {
    setBusy(kind)
    setOperationError(null)
    try {
      await action()
      await refreshAll()
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : "操作失败。")
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

  const recommendedLabel = recommendedAction === "pull"
    ? "拉取远程更新"
    : recommendedAction === "push"
      ? "推送本地提交"
      : recommendedAction === "sync"
        ? "同步"
        : recommendedAction === "open"
          ? "提交改动"
          : "已同步"

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        className="grid shrink-0 gap-3 border-b bg-background px-4 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center"
        data-git-workbench-toolbar="true"
      >
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          返回
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{repository.name}</div>
          <div className="truncate text-xs text-muted-foreground">{repository.localPath}</div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="secondary">{currentBranch ?? "无分支"}</Badge>
            {status.snapshot?.upstream ? <Badge variant="outline">{status.snapshot.upstream}</Badge> : null}
            <Badge variant="outline">{statusText}</Badge>
            {status.snapshot ? (
              <Badge variant="outline">↑{status.snapshot.ahead} ↓{status.snapshot.behind}</Badge>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
          <GitBranchSwitcher
            repository={repository}
            currentBranch={currentBranch}
            disabled={busy !== null}
            onChanged={refreshAll}
          />
          <Button
            type="button"
            size="sm"
            disabled={busy !== null || recommendedAction === "none"}
            onClick={runRecommendedAction}
          >
            {busy === recommendedAction ? `${recommendedLabel}中` : recommendedLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void run("pull", () => requireSynapseBridge().git.pull(repository.id))}
          >
            {busy === "pull" ? "拉取中" : "拉取"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void run("push", () => requireSynapseBridge().git.push(repository.id))}
          >
            {busy === "push" ? "推送中" : "推送"}
          </Button>
          {recommendedAction !== "sync" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => void run("sync", () => requireSynapseBridge().git.sync(repository.id))}
            >
              {busy === "sync" ? "同步中" : "同步"}
            </Button>
          ) : null}
        </div>
      </div>
      {operationError ? (
        <div className="shrink-0 px-4 py-3">
          <Alert variant="destructive">
            <AlertTitle>操作失败</AlertTitle>
            <AlertDescription>
              {operationError} {getGitErrorAdvice(operationError)}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      <Tabs value={view} onValueChange={setView} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="shrink-0 border-b bg-background px-4 py-2">
          <TabsList>
            <TabsTrigger value="changes">改动</TabsTrigger>
            <TabsTrigger value="history">历史</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="changes" className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
          <GitChangesTab
            repository={repository}
            status={status}
            pushDisabled={busy !== null}
            onCommitted={history.refresh}
            onPush={() => void run("push", () => requireSynapseBridge().git.push(repository.id))}
          />
        </TabsContent>
        <TabsContent value="history" className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
          <GitHistoryTab history={history} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
