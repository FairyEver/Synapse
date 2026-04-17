import { useState } from "react"
import { useRepositoryManager } from "@/app-shell/repository"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "@/constants/defaults"
import type { SettingItem } from "@/modules/settings/types"
import type { SynapseRepositoryConfig } from "@/types/config"
import type { SynapseRepositoryLocalState } from "@/types/repository"

type RepositoryListEditorProps = {
  item: SettingItem
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
  item,
  repositories,
  activeRepoUuid,
  onSave,
}: RepositoryListEditorProps) {
  const { hasRepositoryBridge, operations, states, syncRepository } = useRepositoryManager()
  const [formError, setFormError] = useState<string | null>(null)

  const handleAddRepository = async () => {
    const bridge = window.synapse?.repository

    if (!bridge) {
      setFormError("当前运行实例还没有加载仓库能力桥接。请重新加载窗口或重启 Synapse 后再试。")
      return
    }

    const localPath = await bridge.chooseDirectory()

    if (!localPath) {
      return
    }

    if (repositories.some((repository) => repository.localPath === localPath)) {
      setFormError("这个本地目录已经存在了。")
      return
    }

    const nextRepository: SynapseRepositoryConfig = {
      uuid: crypto.randomUUID(),
      name: getRepositoryNameFromPath(localPath),
      localPath,
      rulesDir: DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.rulesDir,
      skillsDir: DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.skillsDir,
    }
    const nextRepositories = [...repositories, nextRepository]
    const nextActiveRepoUuid = activeRepoUuid ?? nextRepository.uuid

    setFormError(null)
    await onSave(nextRepositories, nextActiveRepoUuid, false)
  }

  const handleRemoveRepository = async (repositoryUuid: string) => {
    const repository = repositories.find((itemValue) => itemValue.uuid === repositoryUuid)

    if (!repository) {
      return
    }

    const shouldDelete = window.confirm(`确认删除仓库“${repository.name}”的本地配置吗？这不会删除你的本地目录。`)

    if (!shouldDelete) {
      return
    }

    const nextRepositories = repositories.filter((itemValue) => itemValue.uuid !== repositoryUuid)
    const removedActiveRepository = repositoryUuid === activeRepoUuid
    const nextActiveRepoUuid = removedActiveRepository ? nextRepositories[0]?.uuid ?? null : activeRepoUuid

    await onSave(nextRepositories, nextActiveRepoUuid, removedActiveRepository)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.label}</CardTitle>
        {item.description ? <CardDescription>{item.description}</CardDescription> : null}
        {!hasRepositoryBridge ? (
          <p className="text-sm text-destructive">
            当前运行实例还没有加载仓库能力桥接。请重新加载窗口或重启 Synapse 后再试。
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            还没有配置本地目录。选择后会写入本地配置，并立即检查当前目录是否具备 Git 能力。
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {repositories.map((repository) => {
              const isActive = repository.uuid === activeRepoUuid
              const operation = operations[repository.uuid]
              const repositoryState = states[repository.uuid]
              const isBusy = Boolean(operation?.isRunning)
              const canSync = repositoryState?.status === "ready" && repositoryState.isGitRepository

              return (
                <div key={repository.uuid} className="flex flex-col gap-3 rounded-lg border p-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{repository.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {isActive ? "当前激活目录" : "已保存"}
                      </p>
                    </div>
                    <p className="break-all text-sm text-muted-foreground">{repository.localPath}</p>
                    <p className="text-xs text-muted-foreground">
                      Rules: {repository.rulesDir} · Skills: {repository.skillsDir}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getRepositoryStatusLabel(repositoryState)}
                    </p>
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
                        当前目录可以作为本地内容源使用，但刷新和后续新建会保持禁用。
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={isBusy || !hasRepositoryBridge || !canSync}
                      onClick={() => {
                        void syncRepository(repository.uuid).catch((error) => {
                          setFormError(error instanceof Error ? error.message : "Git 仓库操作失败。")
                        })
                      }}
                    >
                      {isBusy ? "同步中..." : "同步仓库"}
                    </Button>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => {
                        void handleRemoveRepository(repository.uuid)
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <Separator />

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">添加本地目录</p>
            <p className="text-sm text-muted-foreground">
              Synapse 只记录你选择的本地路径，不负责下载仓库。Git 拉取、认证和初始化默认交给你常用的 Git 工具。
            </p>
          </div>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <div>
            <Button onClick={() => void handleAddRepository()} disabled={!hasRepositoryBridge}>
              选择文件夹
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export { RepositoryListEditor }
