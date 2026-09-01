import { Folder, FolderGit2 } from "lucide-react"
import { useAppNotifications } from "@/app-shell/notifications"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useCurrentRepoProfile } from "@/app-shell/identity-context"
import {
  useRepositoryActions,
  useRepositoryOperation,
  useRepositoryState,
} from "@/app-shell/use-repository-manager"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { CONTENT_TYPE_DEFINITIONS } from "@/config/content-types"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "@/constants/defaults"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseRepositoryConfig } from "@/types/config"
import type { SynapseRepositoryLocalState } from "@/types/repository"
import { RepositoryDisplayNameField } from "@/modules/settings/components/repository-display-name-field"

type RepositoryListItemProps = {
  repository: SynapseRepositoryConfig
  isActive: boolean
  hasRepositoryBridge: boolean
  hasRunningRepositoryOperation: boolean
  isSwitchingRepository: boolean
  isOnboardingBlocked: boolean
  initializingUuid: string | null
  onInitialize: (repository: SynapseRepositoryConfig) => void
  onRemove: (repositoryUuid: string) => void
  onEdit: (repository: SynapseRepositoryConfig) => void
}

const logger = createRendererLogger("settings")

function getRepositoryStatusLabel(repositoryState: SynapseRepositoryLocalState | undefined): string {
  if (!repositoryState) {
    return "未连接"
  }

  if (repositoryState.status === "missing") {
    return "本地目录不存在"
  }

  if (repositoryState.status === "inaccessible") {
    return "本地目录无法访问"
  }

  return repositoryState.isGitRepository ? "Git 仓库已连接" : "本地目录已连接（非 Git 仓库）"
}

function RepositoryListItem({
  repository,
  isActive,
  hasRepositoryBridge,
  hasRunningRepositoryOperation,
  isSwitchingRepository,
  isOnboardingBlocked,
  initializingUuid,
  onInitialize,
  onRemove,
  onEdit,
}: RepositoryListItemProps) {
  const repositoryState = useRepositoryState(repository.uuid)
  const operation = useRepositoryOperation(repository.uuid)
  const { syncRepository } = useRepositoryActions()
  const { switchActiveRepository } = useActiveRepositorySwitch()
  const { currentRepoProfileState } = useCurrentRepoProfile()
  const { promise, error: notifyError } = useAppNotifications()
  const isBusy = Boolean(operation?.isRunning) || initializingUuid === repository.uuid
  const canSync = repositoryState?.status === "ready" && repositoryState.isGitRepository
  const canInitialize = repositoryState?.status === "ready" && !isOnboardingBlocked

  const handleSync = async () => {
    logger.info("Repository sync initiated from settings.", { repositoryUuid: repository.uuid })
    try {
      await promise(
        () => syncRepository(repository.uuid),
        {
          trackingName: "settings.repository.sync",
          loading: "正在同步仓库...",
          success: (result) => result.message ?? "仓库同步完成。",
          error: (error) => error instanceof Error ? error.message : "Git 仓库操作失败。",
        },
      )
    } catch (error) {
      logger.error("Repository sync failed from settings.", {
        error,
        repositoryUuid: repository.uuid,
      })
    }
  }

  const handleSwitch = async () => {
    if (!isActive) {
      logger.info("Repository switch initiated from settings.", { repositoryUuid: repository.uuid })
      try {
        await switchActiveRepository(repository.uuid)
      } catch (error) {
        logger.error("Repository switch failed from settings.", {
          error,
          repositoryUuid: repository.uuid,
        })
        notifyError(error instanceof Error ? error.message : "切换仓库失败")
      }
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {repositoryState?.isGitRepository ? (
            <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 truncate">{repository.name}</span>
          {isActive && <Badge variant="secondary">当前目录</Badge>}
          {repositoryState?.status === "missing" && (
            <Badge variant="destructive">目录不存在</Badge>
          )}
          {repositoryState?.status === "inaccessible" && (
            <Badge variant="destructive">无法访问</Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground break-all">
          {repository.localPath}
        </p>

        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p>
            {CONTENT_TYPE_DEFINITIONS.map((definition) => (
              `${definition.pluralLabel}: ${
                repository.contentDirs[definition.id]
                ?? DEFAULT_REPOSITORY_CONTENT_DIRECTORIES[definition.id]
              }`
            )).join(" · ")}
          </p>
          {hasRepositoryBridge && <p>{getRepositoryStatusLabel(repositoryState)}</p>}
          {repositoryState?.gitRootPath
            && repositoryState.gitRootPath !== repository.localPath && (
              <p className="break-all">Git 根目录：{repositoryState.gitRootPath}</p>
            )}
          {repositoryState?.status === "ready" && !repositoryState.isGitRepository && (
            <p>当前目录不是 Git 仓库，内容只保存在本地。</p>
          )}
        </div>

        {operation?.isRunning && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{operation.statusText ?? "正在执行 Git 操作..."}</span>
              {operation.percent !== null && <span>{operation.percent}%</span>}
            </div>
            <Progress value={operation.percent ?? 24} />
          </div>
        )}

        {repositoryState?.status === "ready" && (
          <RepositoryDisplayNameField
            repositoryUuid={repository.uuid}
            isActiveRepository={isActive}
            disabled={isBusy}
          />
        )}
      </CardContent>

      <CardFooter className="justify-end gap-2">
        {repositoryState?.status !== "missing" && (
          <>
            {!isActive && (
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy || hasRunningRepositoryOperation || isSwitchingRepository}
                onClick={() => void handleSwitch()}
              >
                切换为当前目录
              </Button>
            )}
            {hasRepositoryBridge && (
              <Button
                size="sm"
                disabled={isBusy || !canSync}
                onClick={() => void handleSync()}
              >
                {isBusy ? "同步中..." : "同步仓库"}
              </Button>
            )}
            {canInitialize && (
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={() => onInitialize(repository)}
              >
                {initializingUuid === repository.uuid ? "初始化中..." : "初始化"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onClick={() => onEdit(repository)}
            >
              修改
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={isBusy}
          onClick={() => onRemove(repository.uuid)}
        >
          删除
        </Button>
      </CardFooter>
    </Card>
  )
}

export { RepositoryListItem }
