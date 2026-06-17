import type { MouseEvent } from "react"
import { Download, FolderGit2, GitPullRequest, Plus, RefreshCw, Upload } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import type { SynapseGitRepository } from "@/types/git"
import type { GitOperationBusyState } from "../hooks/use-git-operations"

type GitRepositoryListProps = {
  readonly repositories: readonly SynapseGitRepository[]
  readonly loading: boolean
  readonly error: string | null
  readonly environmentMessage: string | null
  readonly busy: GitOperationBusyState
  readonly onClone: () => void
  readonly onAddLocal: () => void
  readonly onOpenRepository: (repository: SynapseGitRepository) => void
  readonly onPull: (repositoryId: string) => void
  readonly onPush: (repositoryId: string) => void
  readonly onSync: (repositoryId: string) => void
}

function stopAction(
  event: MouseEvent<HTMLButtonElement>,
  action: () => void,
) {
  event.stopPropagation()
  action()
}

function isRepositoryBusy(busy: GitOperationBusyState): boolean {
  return busy === "sync" || busy === "pull" || busy === "push"
}

export function GitRepositoryList({
  repositories,
  loading,
  error,
  environmentMessage,
  busy,
  onClone,
  onAddLocal,
  onOpenRepository,
  onPull,
  onPush,
  onSync,
}: GitRepositoryListProps) {
  const actionDisabled = busy !== null

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">Git</div>
          <div className="truncate text-xs text-muted-foreground">{repositories.length} 个仓库</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onAddLocal} disabled={actionDisabled}>
            <FolderGit2 data-icon="inline-start" />
            添加本地仓库
          </Button>
          <Button type="button" size="sm" onClick={onClone} disabled={actionDisabled}>
            <Plus data-icon="inline-start" />
            克隆仓库
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="space-y-3 p-4">
            {environmentMessage ? (
              <Alert>
                <GitPullRequest />
                <AlertTitle>Git 环境</AlertTitle>
                <AlertDescription>{environmentMessage}</AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>操作失败</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Spinner />
              </div>
            ) : repositories.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>暂无仓库</EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button type="button" onClick={onClone} disabled={actionDisabled}>
                      <Plus data-icon="inline-start" />
                      克隆仓库
                    </Button>
                    <Button type="button" variant="outline" onClick={onAddLocal} disabled={actionDisabled}>
                      <FolderGit2 data-icon="inline-start" />
                      添加本地仓库
                    </Button>
                  </div>
                </EmptyContent>
              </Empty>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-lg border bg-background">
                {repositories.map((repository) => (
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
                      <span className="block truncate text-sm font-medium">{repository.name}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{repository.localPath}</span>
                    </span>
                    <span className="flex flex-wrap gap-2 md:justify-end">
                      <Button
                        type="button"
                        size="sm"
                        disabled={actionDisabled}
                        onClick={(event) => stopAction(event, () => onSync(repository.id))}
                      >
                        <RefreshCw data-icon="inline-start" className={busy === "sync" ? "animate-spin" : undefined} />
                        同步
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={actionDisabled}
                        onClick={(event) => stopAction(event, () => onPull(repository.id))}
                      >
                        <Download data-icon="inline-start" />
                        拉取
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={actionDisabled}
                        onClick={(event) => stopAction(event, () => onPush(repository.id))}
                      >
                        <Upload data-icon="inline-start" />
                        推送
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isRepositoryBusy(busy)}
                        onClick={(event) => stopAction(event, () => onOpenRepository(repository))}
                      >
                        进入
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
