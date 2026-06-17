import { useState, type MouseEvent } from "react"
import { Download, GitPullRequest, RefreshCw, Trash2, Upload } from "lucide-react"
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
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import type { SynapseGitRepository, SynapseGitRepositoryRemoveInput, SynapseGitRepositoryRemoveMode } from "@/types/git"
import type { GitOperationBusyState, GitRepositoryOperation } from "../hooks/use-git-operations"

type GitRepositoryListProps = {
  readonly repositories: readonly SynapseGitRepository[]
  readonly loading: boolean
  readonly error: string | null
  readonly environmentMessage: string | null
  readonly busy: GitOperationBusyState
  readonly onOpenRepository: (repository: SynapseGitRepository) => void
  readonly onPull: (repositoryId: string) => void
  readonly onPush: (repositoryId: string) => void
  readonly onSync: (repositoryId: string) => void
  readonly onRemoveRepository: (input: SynapseGitRepositoryRemoveInput) => Promise<boolean>
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

export function GitRepositoryList({
  repositories,
  loading,
  error,
  environmentMessage,
  busy,
  onOpenRepository,
  onPull,
  onPush,
  onSync,
  onRemoveRepository,
}: GitRepositoryListProps) {
  const globalActionDisabled = isGlobalBusy(busy)
  const [removalTarget, setRemovalTarget] = useState<SynapseGitRepository | null>(null)
  const [removalMode, setRemovalMode] = useState<SynapseGitRepositoryRemoveMode>("keep-local")
  const [removalError, setRemovalError] = useState<string | null>(null)

  const closeRemovalDialog = () => {
    setRemovalTarget(null)
    setRemovalMode("keep-local")
    setRemovalError(null)
  }

  const openRemovalDialog = (repository: SynapseGitRepository) => {
    setRemovalTarget(repository)
    setRemovalMode("keep-local")
    setRemovalError(null)
  }

  const handleRemoveRepository = async () => {
    if (!removalTarget) return

    setRemovalError(null)
    const removed = await onRemoveRepository({
      repositoryId: removalTarget.id,
      mode: removalMode,
    })

    if (removed) {
      closeRemovalDialog()
      return
    }

    setRemovalError(removalMode === "trash-local" ? "移到废纸篓失败。" : "删除记录失败。")
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 Git 仓库？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>选择是否同时处理本地目录。</p>
                <RadioGroup
                  value={removalMode}
                  onValueChange={(value) => setRemovalMode(value as SynapseGitRepositoryRemoveMode)}
                  disabled={isRepositoryOperationBusy(busy, removalTarget?.id ?? "", "remove")}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="git-remove-keep-local" value="keep-local" />
                    <Label htmlFor="git-remove-keep-local">仅移除列表记录</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id="git-remove-trash-local" value="trash-local" />
                    <Label htmlFor="git-remove-trash-local">移到废纸篓并移除记录</Label>
                  </div>
                </RadioGroup>
                {removalMode === "trash-local" && removalTarget ? (
                  <p className="break-all">目录：{removalTarget.localPath}</p>
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
              variant={removalMode === "trash-local" ? "destructive" : "default"}
              disabled={isRepositoryOperationBusy(busy, removalTarget?.id ?? "", "remove")}
              onClick={() => {
                void handleRemoveRepository()
              }}
            >
              {isRepositoryOperationBusy(busy, removalTarget?.id ?? "", "remove")
                ? "删除中..."
                : removalMode === "trash-local" ? "移到废纸篓" : "删除记录"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
              </Empty>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-lg border bg-background">
                {repositories.map((repository) => {
                  const repositoryActionDisabled = globalActionDisabled || isRepositoryBusy(busy, repository.id)

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
                        <span className="block truncate text-sm font-medium">{repository.name}</span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">{repository.localPath}</span>
                      </span>
                      <span className="flex flex-wrap gap-2 md:justify-end">
                        <Button
                          type="button"
                          size="sm"
                          disabled={repositoryActionDisabled}
                          onClick={(event) => stopAction(event, () => onSync(repository.id))}
                        >
                          <RefreshCw
                            data-icon="inline-start"
                            className={isRepositoryOperationBusy(busy, repository.id, "sync") ? "animate-spin" : undefined}
                          />
                          同步
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={repositoryActionDisabled}
                          onClick={(event) => stopAction(event, () => onPull(repository.id))}
                        >
                          <Download data-icon="inline-start" />
                          拉取
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={repositoryActionDisabled}
                          onClick={(event) => stopAction(event, () => onPush(repository.id))}
                        >
                          <Upload data-icon="inline-start" />
                          推送
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={repositoryActionDisabled}
                          onClick={(event) => stopAction(event, () => onOpenRepository(repository))}
                        >
                          进入
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={repositoryActionDisabled}
                          onClick={(event) => stopAction(event, () => openRemovalDialog(repository))}
                        >
                          <Trash2 data-icon="inline-start" />
                          删除
                        </Button>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
