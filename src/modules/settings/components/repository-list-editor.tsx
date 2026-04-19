import { type FormEvent, useState } from "react"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useCurrentRepoProfile } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useRepositoryManager } from "@/app-shell/repository"
import { DelayedConfirmAlertDialog } from "@/components/delayed-confirm-alert-dialog"
import { FormDialog } from "@/components/form-dialog"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { CONTENT_TYPE_DEFINITIONS } from "@/config/content-types"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "@/constants/defaults"
import { getRepositoryNameFromPath } from "@/lib/path-utils"
import { RepositoryDisplayNameField } from "@/modules/settings/components/repository-display-name-field"
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

function validateLocalRepositoryName(value: string): string | null {
  const nextValue = value.trim()

  if (!nextValue) {
    return "先输入本地仓库名称。"
  }

  if (nextValue === "." || nextValue === "..") {
    return "本地仓库名称不能是 . 或 ..。"
  }

  if (/[\\/]/.test(nextValue)) {
    return "本地仓库名称不能包含斜杠。"
  }

  return null
}

function RepositoryListEditor({
  repositories,
  activeRepoUuid,
  onSave,
}: RepositoryListEditorProps) {
  const {
    checkInitializationPreview,
    chooseDirectory,
    createLocalRepository,
    hasRepositoryBridge,
    initializeStructure,
    operations,
    states,
    syncRepository,
  } = useRepositoryManager()
  const {
    isSwitchingRepository,
    switchActiveRepository,
  } = useActiveRepositorySwitch()
  const { currentRepoProfileState } = useCurrentRepoProfile()
  const { promise } = useAppNotifications()
  const [formError, setFormError] = useState<string | null>(null)
  const [manualPath, setManualPath] = useState("")
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newRepositoryName, setNewRepositoryName] = useState("")
  const [newRepositoryParentPath, setNewRepositoryParentPath] = useState("")
  const [createRepositoryError, setCreateRepositoryError] = useState<string | null>(null)
  const [isCreatingRepository, setIsCreatingRepository] = useState(false)
  const [pendingRemovalUuid, setPendingRemovalUuid] = useState<string | null>(null)
  const [initializingUuid, setInitializingUuid] = useState<string | null>(null)
  const [initializationTarget, setInitializationTarget] = useState<{
    preview: SynapseRepositoryInitializationPreview
    repository: SynapseRepositoryConfig
  } | null>(null)

  const saveRepositoryConfig = async (nextRepository: SynapseRepositoryConfig) => {
    if (repositories.some((repository) => repository.localPath === nextRepository.localPath)) {
      setFormError("这个本地目录已经存在了。")
      return false
    }

    const nextRepositories = [...repositories, nextRepository]
    const nextActiveRepoUuid = activeRepoUuid ?? nextRepository.uuid

    setFormError(null)
    logger.info("Saving new repository from settings.", {
      localPath: nextRepository.localPath,
      repositoryUuid: nextRepository.uuid,
    })

    return onSave(nextRepositories, nextActiveRepoUuid, false)
  }

  const saveRepository = async (localPath: string) => {
    const nextLocalPath = localPath.trim()

    if (!nextLocalPath) {
      setFormError("先输入本地目录路径。")
      return
    }

    const saved = await saveRepositoryConfig({
      uuid: crypto.randomUUID(),
      name: getRepositoryNameFromPath(nextLocalPath),
      localPath: nextLocalPath,
      contentDirs: { ...DEFAULT_REPOSITORY_CONTENT_DIRECTORIES },
    })

    if (saved) {
      setManualPath("")
    }
  }

  const handleAddRepository = async () => {
    if (!hasRepositoryBridge) {
      logger.warn("Repository bridge unavailable while adding repository.")
      await saveRepository(manualPath)
      return
    }

    logger.info("Opening native directory picker from repository settings.")
    const localPath = await chooseDirectory()

    if (!localPath) {
      logger.info("Native directory picker was dismissed without selecting a directory.")
      return
    }

    await saveRepository(localPath)
  }

  const resetCreateRepositoryForm = () => {
    setNewRepositoryName("")
    setNewRepositoryParentPath("")
    setCreateRepositoryError(null)
    setIsCreatingRepository(false)
  }

  const handleCreateDialogOpenChange = (open: boolean) => {
    if (isCreatingRepository) {
      return
    }

    setIsCreateDialogOpen(open)

    if (!open) {
      resetCreateRepositoryForm()
    }
  }

  const handleChooseCreateParentPath = async () => {
    if (!hasRepositoryBridge) {
      setCreateRepositoryError("当前运行实例还没有加载仓库能力桥接。")
      return
    }

    const selectedPath = await chooseDirectory()

    if (!selectedPath) {
      return
    }

    setNewRepositoryParentPath(selectedPath)
    setCreateRepositoryError(null)
  }

  const handleCreateLocalRepository = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nameError = validateLocalRepositoryName(newRepositoryName)

    if (nameError) {
      setCreateRepositoryError(nameError)
      return
    }

    const parentPath = newRepositoryParentPath.trim()

    if (!parentPath) {
      setCreateRepositoryError("先选择保存位置。")
      return
    }

    if (!hasRepositoryBridge) {
      setCreateRepositoryError("当前运行实例还没有加载仓库能力桥接。")
      return
    }

    setIsCreatingRepository(true)
    setCreateRepositoryError(null)

    try {
      const result = await createLocalRepository({
        name: newRepositoryName.trim(),
        parentPath,
      })
      const saved = await saveRepositoryConfig(result.repository)

      if (!saved) {
        setCreateRepositoryError("本地仓库已创建，但写入设置失败。稍后可以再把这个目录加回来。")
        return
      }

      logger.info("Created local repository from settings.", {
        localPath: result.repository.localPath,
        repositoryUuid: result.repository.uuid,
      })
      setIsCreateDialogOpen(false)
      resetCreateRepositoryForm()
    } catch (error) {
      logger.error("Failed to create local repository from settings.", error)
      setCreateRepositoryError(error instanceof Error ? error.message : "创建本地仓库失败。")
    } finally {
      setIsCreatingRepository(false)
    }
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
  const hasRunningRepositoryOperation = Object.values(operations).some((operation) => operation.isRunning)

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

      <Dialog open={isCreateDialogOpen} onOpenChange={handleCreateDialogOpenChange}>
        <FormDialog
          title="新建本地仓库"
          description="会创建默认目录结构，并写入示例 Rule 和 Skill。"
          contentClassName="sm:max-w-[560px]"
          footer={(
            <>
              <FieldError className="sm:mr-auto">{createRepositoryError}</FieldError>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isCreatingRepository}
                  onClick={() => handleCreateDialogOpenChange(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={isCreatingRepository}>
                  {isCreatingRepository ? "创建中..." : "创建"}
                </Button>
              </div>
            </>
          )}
          onSubmit={handleCreateLocalRepository}
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-local-repository-name">仓库名称</Label>
              <Input
                id="create-local-repository-name"
                value={newRepositoryName}
                onChange={(event) => setNewRepositoryName(event.target.value)}
                placeholder="例如：团队规则仓库"
                disabled={isCreatingRepository}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="create-local-repository-parent-path">保存位置</Label>
              <div className="flex gap-2">
                <Input
                  id="create-local-repository-parent-path"
                  value={newRepositoryParentPath}
                  onChange={(event) => setNewRepositoryParentPath(event.target.value)}
                  placeholder="/path/to/folder"
                  disabled={isCreatingRepository}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={isCreatingRepository}
                  onClick={() => {
                    void handleChooseCreateParentPath()
                  }}
                >
                  选择文件夹
                </Button>
              </div>
            </div>
          </div>
        </FormDialog>
      </Dialog>

      <SettingsGroup>
        {repositories.length > 0 ? (
          <ItemGroup>
            {repositories.map((repository) => {
              const isActive = repository.uuid === activeRepoUuid
              const operation = operations[repository.uuid]
              const repositoryState = states[repository.uuid]
              const isBusy = Boolean(operation?.isRunning) || initializingUuid === repository.uuid
              const canSync = repositoryState?.status === "ready" && repositoryState.isGitRepository
              const canInitialize = repositoryState?.status === "ready" && !isOnboardingBlocked

              return (
                <Item key={repository.uuid} variant="outline" className="items-start">
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
                    <FieldError>{operation?.error}</FieldError>
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
                      disabled={isActive || isBusy || hasRunningRepositoryOperation || isSwitchingRepository}
                      onClick={() => {
                        if (!isActive) {
                          void switchActiveRepository(repository.uuid)
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
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
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
          <FieldError>{formError}</FieldError>
          <div className="flex flex-wrap gap-2">
            <Button variant={hasRepositoryBridge ? "outline" : "default"} onClick={() => void handleAddRepository()}>
              {hasRepositoryBridge ? "选择现有文件夹" : "添加目录"}
            </Button>
            {hasRepositoryBridge ? (
              <Button
                onClick={() => {
                  setCreateRepositoryError(null)
                  setIsCreateDialogOpen(true)
                }}
              >
                新建本地仓库
              </Button>
            ) : null}
          </div>
        </div>
      </SettingsGroup>
    </>
  )
}

export { RepositoryListEditor }
