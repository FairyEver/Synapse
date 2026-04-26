import { type FormEvent, useState } from "react"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useCurrentRepoProfile } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import {
  useActiveRepository,
  useHasRunningRepositoryOperation,
  useRepositoryActions,
  useRepositoryList,
  useRepositoryManager,
} from "@/app-shell/use-repository-manager"
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
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CONTENT_TYPE_DEFINITIONS } from "@/config/content-types"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "@/constants/defaults"
import { getRepositoryNameFromPath } from "@/lib/path-utils"
import { RepositoryListItem } from "@/modules/settings/components/repository-list-item"
import type { SynapseRepositoryConfig } from "@/types/config"
import type {
  SynapseRepositoryInitializationPreview,
  SynapseRepositoryLocalState,
} from "@/types/repository"

const logger = createRendererLogger("settings.repositories")

type RepositoryListEditorProps = {
  onSave: (
    repositories: SynapseRepositoryConfig[],
    activeRepoUuid: string | null,
  ) => Promise<boolean>
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
  onSave,
}: RepositoryListEditorProps) {
  const repositories = useRepositoryList()
  const activeRepository = useActiveRepository()
  const activeRepoUuid = activeRepository?.uuid ?? null
  const manager = useRepositoryManager()
  const { createLocalRepositoryAndAdd, initializeRepository } = useRepositoryActions()
  const {
    checkInitializationPreview,
    chooseDirectory,
    validateDirectory,
  } = manager
  const hasRepositoryBridge = manager.hasRepositoryBridge()
  const { isSwitchingRepository } = useActiveRepositorySwitch()
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
  const [editingRepository, setEditingRepository] = useState<SynapseRepositoryConfig | null>(null)
  const [editName, setEditName] = useState("")
  const [editPath, setEditPath] = useState("")
  const [editError, setEditError] = useState<string | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
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

    try {
      return await onSave(nextRepositories, nextActiveRepoUuid)
    } catch (error) {
      logger.error("Failed to save repository config.", { error, repositoryUuid: nextRepository.uuid })
      setFormError(error instanceof Error ? error.message : "保存失败。")
      return false
    }
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

    const validationResult = await validateDirectory(localPath)
    if (!validationResult.isValid) {
      logger.warn("Chosen repository directory failed validation.", { localPath, message: validationResult.message })
      setFormError(validationResult.message)
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

    if (open) logger.info("Create repository dialog opened.")
    setIsCreateDialogOpen(open)

    if (!open) {
      resetCreateRepositoryForm()
    }
  }

  const handleChooseCreateParentPath = async () => {
    if (!hasRepositoryBridge) {
      setCreateRepositoryError("功能暂不可用，请重启应用。")
      return
    }

    logger.info("Opening native directory picker for new repository parent path.")
    const selectedPath = await chooseDirectory()

    if (!selectedPath) {
      logger.info("New repository parent path picker was dismissed.")
      return
    }

    logger.info("New repository parent path selected.", { selectedPath })
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
      setCreateRepositoryError("功能暂不可用，请重启应用。")
      return
    }

    setIsCreatingRepository(true)
    setCreateRepositoryError(null)

    try {
      const result = await createLocalRepositoryAndAdd({
        name: newRepositoryName.trim(),
        parentPath,
      })

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

  const handleEditRepository = (repository: SynapseRepositoryConfig) => {
    logger.info("Repository edit dialog opened.", { repositoryUuid: repository.uuid })
    setEditingRepository(repository)
    setEditName(repository.name)
    setEditPath(repository.localPath)
    setEditError(null)
  }

  const handleEditDialogClose = () => {
    if (isSavingEdit) {
      return
    }
    setEditingRepository(null)
    setEditName("")
    setEditPath("")
    setEditError(null)
  }

  const handleChooseEditPath = async () => {
    if (!hasRepositoryBridge) {
      setEditError("功能暂不可用，请重启应用。")
      return
    }

    logger.info("Opening native directory picker for editing repository.")
    const selectedPath = await chooseDirectory()

    if (!selectedPath) {
      logger.info("Repository edit directory picker was dismissed.")
      return
    }

    logger.info("Repository edit directory selected.", { selectedPath })
    setEditPath(selectedPath)
    setEditError(null)
  }

  const handleSaveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!editingRepository) {
      return
    }

    const trimmedName = editName.trim()
    const trimmedPath = editPath.trim()

    if (!trimmedName) {
      setEditError("请输入仓库名称。")
      return
    }

    if (!trimmedPath) {
      setEditError("请输入仓库路径。")
      return
    }

    // Check for duplicate path (excluding current repository)
    const duplicatePath = repositories.some(
      (repo) => repo.localPath === trimmedPath && repo.uuid !== editingRepository.uuid
    )
    if (duplicatePath) {
      setEditError("该路径已被其他仓库使用。")
      return
    }

    setIsSavingEdit(true)
    setEditError(null)
    logger.info("Repository edit saving.", { repositoryUuid: editingRepository.uuid, name: trimmedName })

    try {
      const updatedRepository: SynapseRepositoryConfig = {
        ...editingRepository,
        name: trimmedName,
        localPath: trimmedPath,
      }

      const nextRepositories = repositories.map((repo) =>
        repo.uuid === editingRepository.uuid ? updatedRepository : repo
      )

      const saved = await onSave(nextRepositories, activeRepoUuid)

      if (saved) {
        setEditingRepository(null)
        setEditName("")
        setEditPath("")
      }
    } catch (error) {
      logger.error("Failed to update repository.", { error, repositoryUuid: editingRepository.uuid })
      setEditError(error instanceof Error ? error.message : "保存失败。")
    } finally {
      setIsSavingEdit(false)
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

    try {
      await onSave(nextRepositories, nextActiveRepoUuid)
    } catch (error) {
      logger.error("Failed to remove repository.", { error, repositoryUuid })
      setFormError(error instanceof Error ? error.message : "删除失败。")
    }
  }

  const runInitialization = async (repository: SynapseRepositoryConfig) => {
    setInitializingUuid(repository.uuid)
    logger.info("Repository initialization started.", { repositoryUuid: repository.uuid })
    const startedAt = performance.now()

    try {
      const result = await promise(
        () => initializeRepository(repository.uuid),
        {
          loading: "正在初始化目录...",
          success: (result) => result.message ?? "初始化完成。",
          error: (error) => error instanceof Error ? error.message : "初始化失败。",
        },
      )
      logger.info("Repository initialization completed.", { repositoryUuid: repository.uuid, elapsedMs: Math.round(performance.now() - startedAt) })
      return result
    } catch (error) {
      logger.error("Repository initialization failed from settings.", {
        error,
        repositoryUuid: repository.uuid,
      })
      throw error
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
      logger.info("Repository initialization confirm dialog opened.", {
        repositoryUuid: repository.uuid,
        previewCount: preview.nonGitEntries.length,
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
  const hasRunningRepositoryOperation = useHasRunningRepositoryOperation()

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
                placeholder="团队规则仓库"
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

      <Dialog open={editingRepository !== null} onOpenChange={(open) => { if (!open) handleEditDialogClose() }}>
        <FormDialog
          title="修改仓库"
          contentClassName="sm:max-w-[560px]"
          footer={(
            <>
              <FieldError className="sm:mr-auto">{editError}</FieldError>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSavingEdit}
                  onClick={() => handleEditDialogClose()}
                >
                  取消
                </Button>
                <Button type="submit" disabled={isSavingEdit}>
                  {isSavingEdit ? "保存中..." : "保存"}
                </Button>
              </div>
            </>
          )}
          onSubmit={handleSaveEdit}
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-repository-name">仓库名称</Label>
              <Input
                id="edit-repository-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="仓库名称"
                disabled={isSavingEdit}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-repository-path">仓库路径</Label>
              <div className="flex gap-2">
                <Input
                  id="edit-repository-path"
                  value={editPath}
                  onChange={(event) => setEditPath(event.target.value)}
                  placeholder="/path/to/repository"
                  disabled={isSavingEdit}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSavingEdit || !hasRepositoryBridge}
                  onClick={() => void handleChooseEditPath()}
                >
                  选择文件夹
                </Button>
              </div>
            </div>
          </div>
        </FormDialog>
      </Dialog>

      {repositories.length > 0 && (
        <div className="flex flex-col gap-4">
          {repositories.map((repository) => {
            const isActive = repository.uuid === activeRepoUuid

            return (
              <RepositoryListItem
                key={repository.uuid}
                repository={repository}
                isActive={isActive}
                hasRepositoryBridge={hasRepositoryBridge}
                hasRunningRepositoryOperation={hasRunningRepositoryOperation}
                isSwitchingRepository={isSwitchingRepository}
                isOnboardingBlocked={isOnboardingBlocked}
                initializingUuid={initializingUuid}
                onInitialize={handleInitializeRepository}
                onRemove={(uuid) => {
                  logger.info("Repository removal confirm dialog opened.", { repositoryUuid: uuid })
                  setPendingRemovalUuid(uuid)
                }}
                onEdit={handleEditRepository}
              />
            )
          })}
        </div>
      )}

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
                handleCreateDialogOpenChange(true)
              }}
            >
              新建本地仓库
            </Button>
          ) : null}
        </div>
      </div>
    </>
  )
}

export { RepositoryListEditor }
