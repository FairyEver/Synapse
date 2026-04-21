import { useState } from "react"
import { FolderOpen, FolderPlus, Package } from "lucide-react"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "@/constants/defaults"
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
  const { addRepository, createLocalRepositoryAndAdd } = useRepositoryActions()
  const { chooseDirectory, validateDirectory } = useRepositoryManager()
  const { isSwitchingRepository, switchActiveRepository } = useActiveRepositorySwitch()
  const { error: showError } = useAppNotifications()

  const hasOtherRepositories = repositories.length > 0
  const isFirstTime = reason === "no-repositories"

  // 新建仓库对话框状态
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [createParentPath, setCreateParentPath] = useState("")
  const [createName, setCreateName] = useState("")
  const [createNameError, setCreateNameError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const resetCreateForm = () => {
    setCreateParentPath("")
    setCreateName("")
    setCreateNameError(null)
    setIsCreating(false)
  }

  const handleChooseDirectory = async () => {
    try {
      const selectedPath = await chooseDirectory()
      if (!selectedPath) return

      const validationResult = await validateDirectory(selectedPath)
      if (!validationResult.isValid) {
        showError(validationResult.message, { durationMs: 6000 })
        return
      }

      const name = selectedPath.split("/").pop() || "新仓库"
      const newRepository = {
        uuid: crypto.randomUUID(),
        name,
        localPath: selectedPath,
        contentDirs: { ...DEFAULT_REPOSITORY_CONTENT_DIRECTORIES },
      }

      logger.info("Directory chosen for new repository.", { localPath: selectedPath })
      await addRepository(newRepository, { activate: true })
    } catch (err) {
      logger.error("Failed to choose repository directory.", err)
      showError(err instanceof Error ? err.message : "选择目录失败", { durationMs: 4000 })
    }
  }

  const handleCreateNewRepository = async () => {
    const parentPath = await chooseDirectory()
    if (!parentPath) return

    logger.info("Create repository dialog opened from empty state.", { parentPath })
    setCreateParentPath(parentPath)
    setCreateName("")
    setCreateNameError(null)
    setIsCreateDialogOpen(true)
  }

  const handleCreateSubmit = async () => {
    const nameError = validateRepositoryName(createName)
    if (nameError) {
      setCreateNameError(nameError)
      return
    }

    setIsCreating(true)
    setCreateNameError(null)

    try {
      logger.info("Creating local repository from empty state.", {
        name: createName.trim(),
        parentPath: createParentPath,
      })
      await createLocalRepositoryAndAdd(
        { name: createName.trim(), parentPath: createParentPath },
        { activate: true },
      )
      logger.info("Local repository created from empty state.", {
        name: createName.trim(),
        parentPath: createParentPath,
      })
      setIsCreateDialogOpen(false)
      resetCreateForm()
    } catch (err) {
      logger.error("Failed to create local repository.", err)
      const errorMessage = err instanceof Error ? err.message : "创建仓库失败"
      setCreateNameError(errorMessage)
    } finally {
      setIsCreating(false)
    }
  }

  const handleSwitchToRepository = async (repositoryUuid: string) => {
    try {
      logger.info("Switching repository from empty state.", { repositoryUuid })
      await switchActiveRepository(repositoryUuid)
    } catch (error) {
      logger.error("Failed to switch repository from empty state.", error)
    }
  }

  const availableRepositories = repositories.filter(
    (repo) => repo.uuid !== activeRepository?.uuid
  )

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
      <div className="flex h-screen w-full items-center justify-center bg-background p-6">
        <div className="flex w-full max-w-2xl flex-col gap-6">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Package className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              {isFirstTime ? "欢迎使用 Synapse" : "当前仓库不可用"}
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

          {hasOtherRepositories && availableRepositories.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">切换到其他仓库</CardTitle>
                <CardDescription>
                  你已配置 {repositories.length} 个仓库，可以选择切换到其他可用仓库
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-auto max-h-48">
                  <div className="flex flex-col gap-2 pr-4">
                    {availableRepositories.map((repo) => (
                      <button
                        key={repo.uuid}
                        type="button"
                        disabled={isSwitchingRepository}
                        onClick={() => handleSwitchToRepository(repo.uuid)}
                        className={cn(
                          "flex w-full flex-col gap-1 rounded-md border border-border bg-background p-3 text-left transition-colors",
                          "hover:bg-accent hover:text-accent-foreground",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isSwitchingRepository && "pointer-events-none opacity-50"
                        )}
                      >
                        <span className="truncate font-medium">{repo.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{repo.localPath}</span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

export { EmptyRepositoryState }
export type { EmptyRepositoryStateProps }
