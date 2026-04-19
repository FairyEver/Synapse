import { useState } from "react"
import { useCurrentRepoProfile } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useRepositoryManager } from "@/app-shell/repository"
import { DelayedConfirmAlertDialog } from "@/components/delayed-confirm-alert-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CONTENT_TYPE_DEFINITIONS } from "@/config/content-types"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "@/constants/defaults"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import type { SynapseRepositoryConfig } from "@/types/config"
import type {
  SynapseRepositoryInitializationPreview,
  SynapseRepositoryLocalState,
} from "@/types/repository"

const logger = createRendererLogger("settings.repositories")

type RepositoryListEditorProps = {
  repositories: SynapseRepositoryConfig[]
  activeRepoUuid: string | null
  onSave: (
    repositories: SynapseRepositoryConfig[],
    activeRepoUuid: string | null,
    reloadAfterUpdate: boolean,
  ) => Promise<boolean>
}

function getRepositoryStatusLabel(repositoryState?: SynapseRepositoryLocalState): string {
  if (!repositoryState) {
    return "正在检查目录状态..."
  }

  if (repositoryState.status !== "ready") {
    return "本地目录不存在"
  }

  return repositoryState.isGitRepository ? "Git 仓库已连接" : "本地目录已连接（非 Git 仓库）"
}

function getRepositoryNameFromPath(localPath: string): string {
  const normalizedPath = localPath.replace(/[\\/]+$/, "")
  const segments = normalizedPath.split(/[\\/]/).filter((segment) => segment.length > 0)

  return segments.at(-1) ?? localPath
}

function RepositoryListEditor({
  repositories,
  activeRepoUuid,
  onSave,
}: RepositoryListEditorProps) {
  const {
    checkInitializationPreview,
    hasRepositoryBridge,
    initializeStructure,
    operations,
    states,
    syncRepository,
  } = useRepositoryManager()
  const { currentRepoProfileState } = useCurrentRepoProfile()
  const { promise } = useAppNotifications()
  const [formError, setFormError] = useState<string | null>(null)
  const [manualPath, setManualPath] = useState("")
  const [pendingRemovalUuid, setPendingRemovalUuid] = useState<string | null>(null)
  const [initializingUuid, setInitializingUuid] = useState<string | null>(null)
  const [initializationTarget, setInitializationTarget] = useState<{
    preview: SynapseRepositoryInitializationPreview
    repository: SynapseRepositoryConfig
  } | null>(null)

  const saveRepository = async (localPath: string) => {
    const nextLocalPath = localPath.trim()

    if (!nextLocalPath) {
      setFormError("先输入本地目录路径。")
      return
    }

    if (repositories.some((repository) => repository.localPath === nextLocalPath)) {
      setFormError("这个本地目录已经存在了。")
      return
    }

    const nextRepository: SynapseRepositoryConfig = {
      uuid: crypto.randomUUID(),
      name: getRepositoryNameFromPath(nextLocalPath),
      localPath: nextLocalPath,
      contentDirs: { ...DEFAULT_REPOSITORY_CONTENT_DIRECTORIES },
    }
    const nextRepositories = [...repositories, nextRepository]
    const nextActiveRepoUuid = activeRepoUuid ?? nextRepository.uuid

    setFormError(null)
    logger.info("Saving new repository from settings.", {
      localPath: nextLocalPath,
      repositoryUuid: nextRepository.uuid,
    })
    const saved = await onSave(nextRepositories, nextActiveRepoUuid, false)

    if (saved) {
      setManualPath("")
    }
  }

  const handleAddRepository = async () => {
    const bridge = window.synapse?.repository

    if (!bridge) {
      logger.warn("Repository bridge unavailable while adding repository.")
      await saveRepository(manualPath)
      return
    }

    logger.info("Opening native directory picker from repository settings.")
    const localPath = await bridge.chooseDirectory()

    if (!localPath) {
      logger.info("Native directory picker was dismissed without selecting a directory.")
      return
    }

    await saveRepository(localPath)
  }

  const handleRemoveRepository = async (repositoryUuid: string) => {
    const repository = repositories.find((itemValue) => itemValue.uuid === repositoryUuid)

    if (!repository) {
      return
    }

    const nextRepositories = repositories.filter((itemValue) => itemValue.uuid !== repositoryUuid)
    const removedActiveRepository = repositoryUuid === activeRepoUuid
    const nextActiveRepoUuid = removedActiveRepository ? nextRepositories[0]?.uuid ?? null : activeRepoUuid

    logger.info("Removing repository from settings.", {
      repositoryUuid,
      removedActiveRepository,
    })
    await onSave(nextRepositories, nextActiveRepoUuid, removedActiveRepository)
  }

  const runInitialization = async (repository: SynapseRepositoryConfig) => {
    setInitializingUuid(repository.uuid)

    try {
      await promise(
        () => initializeStructure(repository.uuid),
        {
          loading: "正在初始化目录...",
          success: (result) => result.message ?? "初始化完成。",
          error: (error) => error instanceof Error ? error.message : "初始化失败。",
        },
      )
    } catch (error) {
      logger.error("Repository initialization failed from settings.", {
        error,
        repositoryUuid: repository.uuid,
      })
    } finally {
      setInitializingUuid(null)
      setInitializationTarget(null)
    }
  }

  const handleInitializeRepository = async (repository: SynapseRepositoryConfig) => {
    try {
      const preview = await checkInitializationPreview(repository.uuid)

      if (preview.isEmpty) {
        await runInitialization(repository)
        return
      }

      setInitializationTarget({
        preview,
        repository,
      })
    } catch (error) {
      logger.error("Failed to load repository initialization preview.", {
        error,
        repositoryUuid: repository.uuid,
      })
      setFormError(error instanceof Error ? error.message : "读取初始化预览失败。")
    }
  }

  const previewEntries = initializationTarget?.preview.nonGitEntries ?? []
  const previewList = previewEntries.slice(0, 5)
  const remainingPreviewCount = Math.max(previewEntries.length - previewList.length, 0)
  const isOnboardingBlocked = currentRepoProfileState?.status === "needs-onboarding"

  return (
    <>
      <AlertDialog
        open={pendingRemovalUuid !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRemovalUuid(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这个本地配置？</AlertDialogTitle>
            <AlertDialogDescription>
              这只会移除 Synapse 里的仓库记录，不会删除你的本地目录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRemovalUuid) {
                  void handleRemoveRepository(pendingRemovalUuid)
                }

                setPendingRemovalUuid(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DelayedConfirmAlertDialog
        open={initializationTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setInitializationTarget(null)
          }
        }}
        title="警告"
        description={(
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              初始化会清空该目录下除 <code>.git/</code> 目录之外的所有内容，包括
              <code>.gitignore</code> 等 Git 配置文件，且无法撤销。
            </p>
            <p className="break-all">
              目录：{initializationTarget?.repository.localPath}
            </p>
            <div className="flex flex-col gap-1">
              <p>检测到目录中存在以下内容：</p>
              {previewList.map((entryName) => (
                <p key={entryName}>· {entryName}</p>
              ))}
              {remainingPreviewCount > 0 ? (
                <p>... 等 {remainingPreviewCount} 项</p>
              ) : null}
            </div>
          </div>
        )}
        confirmLabel="确定初始化"
        delaySeconds={3}
        onConfirm={() => {
          if (initializationTarget) {
            void runInitialization(initializationTarget.repository)
          }
        }}
      />

      <SettingsGroup>
        {repositories.length > 0 ? (
          <div className="flex flex-col divide-y divide-border/60">
            {repositories.map((repository) => {
              const isActive = repository.uuid === activeRepoUuid
              const operation = operations[repository.uuid]
              const repositoryState = states[repository.uuid]
              const isBusy = Boolean(operation?.isRunning) || initializingUuid === repository.uuid
              const canSync = repositoryState?.status === "ready" && repositoryState.isGitRepository
              const canInitialize = repositoryState?.status === "ready" && !isOnboardingBlocked

              return (
                <div key={repository.uuid} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{repository.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {isActive ? "当前激活目录" : "已保存"}
                      </p>
                    </div>
                    <p className="break-all text-sm text-muted-foreground">{repository.localPath}</p>
                    <p className="text-xs text-muted-foreground">
                      {CONTENT_TYPE_DEFINITIONS.map((definition) => (
                        `${definition.pluralLabel}: ${
                          repository.contentDirs[definition.id]
                          ?? DEFAULT_REPOSITORY_CONTENT_DIRECTORIES[definition.id]
                        }`
                      )).join(" · ")}
                    </p>
                    {hasRepositoryBridge ? (
                      <p className="text-xs text-muted-foreground">
                        {getRepositoryStatusLabel(repositoryState)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">目录状态和同步暂不可用</p>
                    )}
                    {repositoryState?.gitRootPath && repositoryState.gitRootPath !== repository.localPath ? (
                      <p className="break-all text-xs text-muted-foreground">
                        Git 根目录：{repositoryState.gitRootPath}
                      </p>
                    ) : null}
                    {operation?.isRunning ? (
                      <div className="flex flex-col gap-2 pt-1">
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>{operation.statusText ?? "正在执行 Git 操作..."}</span>
                          {operation.percent !== null ? <span>{operation.percent}%</span> : null}
                        </div>
                        <div className="h-2 rounded bg-muted">
                          <div
                            className="h-full rounded bg-primary transition-[width] duration-200"
                            style={{ width: `${operation.percent ?? 24}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                    {operation?.error ? (
                      <p className="text-sm text-destructive">{operation.error}</p>
                    ) : null}
                    {repositoryState?.status === "ready" && !repositoryState.isGitRepository ? (
                      <p className="text-xs text-muted-foreground">
                        当前目录不是 Git 仓库，不能同步。
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {hasRepositoryBridge ? (
                      <Button
                        size="sm"
                        disabled={isBusy || !canSync}
                        onClick={() => {
                          void promise(
                            () => syncRepository(repository.uuid),
                            {
                              loading: "正在同步仓库...",
                              success: (result) => result.message ?? "仓库同步完成。",
                              error: (error) => error instanceof Error ? error.message : "Git 仓库操作失败。",
                            },
                          ).catch((error) => {
                            logger.error("Repository sync failed from settings.", {
                              error,
                              repositoryUuid: repository.uuid,
                            })
                          })
                        }}
                      >
                        {isBusy ? "同步中..." : "同步仓库"}
                      </Button>
                    ) : null}
                    <Button
                      variant={isActive ? "secondary" : "outline"}
                      size="sm"
                      disabled={isActive || isBusy}
                      onClick={() => {
                        if (!isActive) {
                          void onSave(repositories, repository.uuid, true)
                        }
                      }}
                    >
                      {isActive ? "当前目录" : "切换为当前目录"}
                    </Button>
                    {canInitialize ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => {
                          void handleInitializeRepository(repository)
                        }}
                      >
                        {initializingUuid === repository.uuid ? "初始化中..." : "初始化"}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => {
                        setPendingRemovalUuid(repository.uuid)
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          {!hasRepositoryBridge ? (
            <Input
              value={manualPath}
              onChange={(event) => setManualPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleAddRepository()
                }
              }}
              placeholder="/path/to/project"
            />
          ) : null}
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <div>
            <Button onClick={() => void handleAddRepository()}>
              {hasRepositoryBridge ? "选择文件夹" : "添加目录"}
            </Button>
          </div>
        </div>
      </SettingsGroup>
    </>
  )
}

export { RepositoryListEditor }
