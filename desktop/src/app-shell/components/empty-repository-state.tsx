import { useMemo, useState, useSyncExternalStore } from "react"
import { FolderOpen, FolderPlus } from "lucide-react"
import appIcon from "@/assets/icon.png"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import {
  useActiveRepository,
  useRepositoryActions,
  useRepositoryManager,
  useRepositoryList,
} from "@/app-shell/use-repository-manager"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "@/constants/defaults"
import { getRepositoryNameFromPath } from "@/lib/path-utils"
import { cn } from "@/lib/utils"

type EmptyRepositoryStateProps = {
  reason: "no-repositories" | "active-repository-missing"
}

const logger = createRendererLogger("app.empty-repository-state")

function validateRepositoryName(value: string): string | null {
  const nextValue = value.trim()

  if (!nextValue) {
    return "仓库名称不能为空"
  }

  if (nextValue === "." || nextValue === "..") {
    return "仓库名称不能是 . 或 .."
  }

  if (/[\\/]/.test(nextValue)) {
    return "仓库名称不能包含斜杠"
  }

  return null
}

function EmptyRepositoryState({ reason }: EmptyRepositoryStateProps) {
  const repositories = useRepositoryList()
  const activeRepository = useActiveRepository()
  const { addRepository, createLocalRepositoryAndAdd, initializeRepository } = useRepositoryActions()
  const manager = useRepositoryManager()
  const { chooseDirectory, validateDirectory } = manager
  const { isSwitchingRepository, switchActiveRepository } = useActiveRepositorySwitch()
  const { error: showError } = useAppNotifications()

  const isFirstTime = reason === "no-repositories"

  // Subscribe to repository state changes so candidate filtering stays in sync
  // when directories appear/disappear after the initial render.
  const repositoryStatesKey = useSyncExternalStore(
    (callback) => manager.subscribeToRepositoryChanges(callback),
    () => {
      const parts: string[] = []
      for (const [uuid, state] of manager.getAllStates()) {
        parts.push(`${uuid}:${state.status}`)
      }
      return parts.join("|")
    },
  )

  // Other repositories whose local directories exist and can be switched to.
  const availableRepositories = useMemo(() => {
    return repositories.filter((repo) => {
      if (repo.uuid === activeRepository?.uuid) return false
      return manager.getRepositoryState(repo.uuid)?.status === "ready"
    })
  }, [repositories, activeRepository?.uuid, manager, repositoryStatesKey])

  // 新建仓库对话框状态
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [createParentPath, setCreateParentPath] = useState("")
  const [createName, setCreateName] = useState("")
  const [createNameError, setCreateNameError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // 初始化空目录对话框状态
  const [isInitDialogOpen, setIsInitDialogOpen] = useState(false)
  const [initTargetPath, setInitTargetPath] = useState("")
  const [isInitializing, setIsInitializing] = useState(false)

  const resetCreateForm = () => {
    setCreateParentPath("")
    setCreateName("")
    setCreateNameError(null)
    setIsCreating(false)
  }

  const handleChooseDirectory = async () => {
    const startedAt = performance.now()
    logger.info("Existing repository directory chooser opened from empty state.", { reason })

    try {
      const selectedPath = await chooseDirectory()
      if (!selectedPath) {
        logger.info("Existing repository directory chooser dismissed from empty state.", {
          elapsedMs: Math.round(performance.now() - startedAt),
          reason,
        })
        return
      }

      const validationResult = await validateDirectory(selectedPath)
      if (!validationResult.isValid) {
        if (validationResult.missingDirectories.length === 5) {
          logger.info("Chosen directory is empty, offering initialization.", {
            localPath: selectedPath,
          })
          setInitTargetPath(selectedPath)
          setIsInitDialogOpen(true)
          return
        }

        logger.warn("Chosen repository directory failed validation.", {
          elapsedMs: Math.round(performance.now() - startedAt),
          localPath: selectedPath,
          message: validationResult.message,
          missingDirectories: validationResult.missingDirectories,
        })
        showError(validationResult.message, { durationMs: 6000 })
        return
      }

      const name = getRepositoryNameFromPath(selectedPath) || "新仓库"
      const newRepository = {
        uuid: crypto.randomUUID(),
        name,
        localPath: selectedPath,
        contentDirs: { ...DEFAULT_REPOSITORY_CONTENT_DIRECTORIES },
      }

      await addRepository(newRepository, { activate: true })
      logger.info("Repository added from chosen directory.", {
        elapsedMs: Math.round(performance.now() - startedAt),
        localPath: selectedPath,
        repositoryUuid: newRepository.uuid,
      })
    } catch (err) {
      logger.error("Failed to add repository from chosen directory.", {
        elapsedMs: Math.round(performance.now() - startedAt),
        error: err,
        reason,
      })
      showError(err instanceof Error ? err.message : "选择目录失败", { durationMs: 4000 })
    }
  }

  const handleCreateNewRepository = async () => {
    const startedAt = performance.now()
    logger.info("New repository directory chooser opened from empty state.", { reason })

    try {
      const parentPath = await chooseDirectory()
      if (!parentPath) {
        logger.info("New repository directory chooser dismissed from empty state.", {
          elapsedMs: Math.round(performance.now() - startedAt),
          reason,
        })
        return
      }

      logger.info("Create repository dialog opened from empty state.", {
        elapsedMs: Math.round(performance.now() - startedAt),
        parentPath,
      })
      setCreateParentPath(parentPath)
      setCreateName("")
      setCreateNameError(null)
      setIsCreateDialogOpen(true)
    } catch (error) {
      logger.error("Failed to choose parent directory for new repository.", {
        elapsedMs: Math.round(performance.now() - startedAt),
        error,
        reason,
      })
      showError(error instanceof Error ? error.message : "选择目录失败", { durationMs: 4000 })
    }
  }

  const handleCreateSubmit = async () => {
    const nextName = createName.trim()
    const nameError = validateRepositoryName(nextName)
    if (nameError) {
      setCreateNameError(nameError)
      return
    }

    setIsCreating(true)
    setCreateNameError(null)
    const startedAt = performance.now()

    try {
      logger.info("Creating local repository from empty state.", {
        name: nextName,
        parentPath: createParentPath,
      })
      const result = await createLocalRepositoryAndAdd(
        { name: nextName, parentPath: createParentPath },
        { activate: true },
      )
      logger.info("Local repository created from empty state.", {
        elapsedMs: Math.round(performance.now() - startedAt),
        name: nextName,
        parentPath: createParentPath,
        repositoryUuid: result.repository.uuid,
      })
      setIsCreateDialogOpen(false)
      resetCreateForm()
    } catch (err) {
      logger.error("Failed to create local repository.", {
        elapsedMs: Math.round(performance.now() - startedAt),
        error: err,
        name: nextName,
        parentPath: createParentPath,
      })
      const errorMessage = err instanceof Error ? err.message : "创建仓库失败"
      setCreateNameError(errorMessage)
    } finally {
      setIsCreating(false)
    }
  }

  const handleInitConfirm = async () => {
    setIsInitializing(true)
    const startedAt = performance.now()
    const selectedPath = initTargetPath

    try {
      const name = getRepositoryNameFromPath(selectedPath) || "新仓库"
      const newRepository = {
        uuid: crypto.randomUUID(),
        name,
        localPath: selectedPath,
        contentDirs: { ...DEFAULT_REPOSITORY_CONTENT_DIRECTORIES },
      }

      const repos = [...manager.getRepositories(), newRepository]
      await manager.updateConfig({ repositories: repos })
      await manager.refreshRepositoryStates()

      await initializeRepository(newRepository.uuid)
      await manager.switchActiveRepository(newRepository.uuid)

      logger.info("Repository initialized from empty directory.", {
        elapsedMs: Math.round(performance.now() - startedAt),
        localPath: selectedPath,
        repositoryUuid: newRepository.uuid,
      })
      setIsInitDialogOpen(false)
      setInitTargetPath("")
    } catch (err) {
      logger.error("Failed to initialize repository from empty directory.", {
        elapsedMs: Math.round(performance.now() - startedAt),
        error: err,
        localPath: selectedPath,
      })
      showError(err instanceof Error ? err.message : "初始化仓库失败", { durationMs: 4000 })
    } finally {
      setIsInitializing(false)
    }
  }

  const handleSwitchToRepository = async (repositoryUuid: string) => {
    try {
      logger.info("Switching repository from empty state.", { repositoryUuid })
      await switchActiveRepository(repositoryUuid)
    } catch (error) {
      logger.error("Failed to switch repository from empty state.", error)
      showError(error instanceof Error ? error.message : "切换仓库失败", { durationMs: 4000 })
    }
  }

  return (
    <>
      <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
        if (!isCreating) {
          setIsCreateDialogOpen(open)
          if (!open) resetCreateForm()
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建仓库</DialogTitle>
            <DialogDescription>
              在 {createParentPath} 下创建新仓库
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="repo-name">仓库名称 <span className="text-destructive">*</span></Label>
              <Input
                id="repo-name"
                value={createName}
                onChange={(e) => {
                  setCreateName(e.target.value)
                  setCreateNameError(null)
                }}
                placeholder="输入仓库名称"
                disabled={isCreating}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isCreating) {
                    void handleCreateSubmit()
                  }
                }}
              />
              {createNameError && (
                <p className="text-sm text-destructive">{createNameError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateDialogOpen(false)
                resetCreateForm()
              }}
              disabled={isCreating}
            >
              取消
            </Button>
            <Button
              onClick={() => void handleCreateSubmit()}
              disabled={isCreating || !createName.trim()}
            >
              {isCreating ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isInitDialogOpen} onOpenChange={(open) => {
        if (!isInitializing) {
          setIsInitDialogOpen(open)
          if (!open) setInitTargetPath("")
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>初始化仓库</DialogTitle>
            <DialogDescription>
              该目录尚未包含 Synapse 仓库结构，是否将其初始化为 Synapse 仓库？
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground break-all">
            {initTargetPath}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setIsInitDialogOpen(false); setInitTargetPath("") }}
              disabled={isInitializing}
            >
              取消
            </Button>
            <Button onClick={() => void handleInitConfirm()} disabled={isInitializing}>
              {isInitializing ? "初始化中..." : "初始化"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div
        className="flex h-screen w-full items-center justify-center bg-background p-6"
      >
        <div
          className="flex w-full max-w-2xl flex-col gap-6"
        >
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
              <img src={appIcon} alt="Synapse AI Studio" className="size-16 object-contain select-none" draggable={false} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              {isFirstTime ? "欢迎使用 Synapse AI Studio" : "当前仓库不可用"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isFirstTime
                ? "选择一个本地目录开始，或新建一个仓库"
                : "该仓库的本地目录已被删除或移动"}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={handleChooseDirectory}
              className={cn(
                "flex w-full items-start gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <FolderOpen className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">选择已有目录</span>
                <span className="text-sm text-muted-foreground">选择一个已有的本地文件夹作为仓库</span>
              </div>
            </button>

            <button
              type="button"
              onClick={handleCreateNewRepository}
              className={cn(
                "flex w-full items-start gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <FolderPlus className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">新建仓库</span>
                <span className="text-sm text-muted-foreground">在指定位置创建一个新的仓库文件夹</span>
              </div>
            </button>
          </div>

          {availableRepositories.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="px-1 text-xs font-medium text-muted-foreground">切换到其他仓库</span>
              <ScrollArea className="h-auto max-h-48">
                <div className="flex flex-col gap-1 pr-1">
                  {availableRepositories.map((repo) => (
                    <button
                      key={repo.uuid}
                      type="button"
                      disabled={isSwitchingRepository}
                      onClick={() => handleSwitchToRepository(repo.uuid)}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors",
                        "hover:bg-accent hover:text-accent-foreground",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isSwitchingRepository && "pointer-events-none opacity-50"
                      )}
                    >
                      <span className="truncate text-sm font-medium">{repo.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{repo.localPath}</span>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export { EmptyRepositoryState }
export type { EmptyRepositoryStateProps }
