import { useAppNotifications } from "@/app-shell/notifications"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useRepositoryManager } from "@/app-shell/repository"
import { useCurrentRepoProfile } from "@/app-shell/identity-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { Progress } from "@/components/ui/progress"
import { CONTENT_TYPE_DEFINITIONS } from "@/config/content-types"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "@/constants/defaults"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseRepositoryConfig } from "@/types/config"
import type { SynapseRepositoryLocalState } from "@/types/repository"
import type { RepositoryOperationState } from "@/app-shell/repository"
import { RepositoryDisplayNameField } from "@/modules/settings/components/repository-display-name-field"

type RepositoryListItemProps = {
  repository: SynapseRepositoryConfig
  isActive: boolean
  isBusy: boolean
  canSync: boolean
  canInitialize: boolean
  hasRepositoryBridge: boolean
  hasRunningRepositoryOperation: boolean
  isSwitchingRepository: boolean
  isOnboardingBlocked: boolean
  repositoryState?: SynapseRepositoryLocalState
  operation?: RepositoryOperationState
  initializingUuid: string | null
  activeRepoUuid: string | null
  onInitialize: (repository: SynapseRepositoryConfig) => void
  onRemove: (repositoryUuid: string) => void
}

const logger = createRendererLogger("settings")

function getRepositoryStatusLabel(repositoryState: SynapseRepositoryLocalState | undefined): string {
  if (!repositoryState) {
    return "未连接"
  }

  if (repositoryState.status !== "ready") {
    return "本地目录不存在"
  }

  return repositoryState.isGitRepository ? "Git 仓库已连接" : "本地目录已连接（非 Git 仓库）"
}

function RepositoryListItem({
  repository,
  isActive,
  isBusy,
  canSync,
  canInitialize,
  hasRepositoryBridge,
  hasRunningRepositoryOperation,
  isSwitchingRepository,
  isOnboardingBlocked,
  repositoryState,
  operation,
  initializingUuid,
  activeRepoUuid,
  onInitialize,
  onRemove,
}: RepositoryListItemProps) {
  const { syncRepository } = useRepositoryManager()
  const { switchActiveRepository } = useActiveRepositorySwitch()
  const { currentRepoProfileState } = useCurrentRepoProfile()
  const { promise } = useAppNotifications()

  const handleSync = async () => {
    try {
      await promise(
        () => syncRepository(repository.uuid),
        {
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
      try {
        await switchActiveRepository(repository.uuid)
      } catch (error) {
        logger.error("Repository switch failed from settings.", {
          error,
          repositoryUuid: repository.uuid,
        })
      }
    }
  }

  return (
    <Item variant="outline" className="items-start">
      <ItemContent className="min-w-0 gap-3">
        <div className="flex flex-col gap-1.5">
          <ItemTitle className="w-full flex-wrap justify-between">
            <span className="min-w-0 flex-1 truncate">{repository.name}</span>
            <Badge variant={isActive ? "secondary" : "outline"}>
              {isActive ? "当前目录" : "已保存"}
            </Badge>
          </ItemTitle>
          <ItemDescription className="line-clamp-none break-all">
            {repository.localPath}
          </ItemDescription>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <p>
              {CONTENT_TYPE_DEFINITIONS.map((definition) => (
                `${definition.pluralLabel}: ${
                  repository.contentDirs[definition.id]
                  ?? DEFAULT_REPOSITORY_CONTENT_DIRECTORIES[definition.id]
                }`
              )).join(" · ")}
            </p>
            {hasRepositoryBridge ? <p>{getRepositoryStatusLabel(repositoryState)}</p> : null}
            {repositoryState?.gitRootPath
            && repositoryState.gitRootPath !== repository.localPath ? (
              <p className="break-all">Git 根目录：{repositoryState.gitRootPath}</p>
            ) : null}
            {repositoryState?.status === "ready" && !repositoryState.isGitRepository ? (
              <p>当前目录不是 Git 仓库，内容只保存在本地。</p>
            ) : null}
          </div>
        </div>
        {operation?.isRunning ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{operation.statusText ?? "正在执行 Git 操作..."}</span>
              {operation.percent !== null ? <span>{operation.percent}%</span> : null}
            </div>
            <Progress value={operation.percent ?? 24} />
          </div>
        ) : null}
        {repositoryState?.status === "ready" ? (
          <RepositoryDisplayNameField
            repositoryUuid={repository.uuid}
            isActiveRepository={isActive}
            disabled={isBusy}
          />
        ) : null}
      </ItemContent>
      <ItemActions className="w-full flex-wrap justify-end sm:w-auto sm:self-start">
        {hasRepositoryBridge ? (
          <Button
            size="sm"
            disabled={isBusy || !canSync}
            onClick={() => void handleSync()}
          >
            {isBusy ? "同步中..." : "同步仓库"}
          </Button>
        ) : null}
        <Button
          variant={isActive ? "secondary" : "outline"}
          size="sm"
          disabled={isActive || isBusy || hasRunningRepositoryOperation || isSwitchingRepository}
          onClick={() => void handleSwitch()}
        >
          {isActive ? "当前目录" : "切换为当前目录"}
        </Button>
        {canInitialize ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => onInitialize(repository)}
          >
            {initializingUuid === repository.uuid ? "初始化中..." : "初始化"}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={isBusy}
          onClick={() => onRemove(repository.uuid)}
        >
          删除
        </Button>
      </ItemActions>
    </Item>
  )
}

export { RepositoryListItem }
