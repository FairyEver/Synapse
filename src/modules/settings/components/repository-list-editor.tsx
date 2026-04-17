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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  DEFAULT_REPOSITORY_CONTENT_DIRECTORIES,
} from "@/constants/defaults"
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
  ) => Promise<void>
}

function getRepositoryStatusLabel(repositoryState?: SynapseRepositoryLocalState): string {
  if (!repositoryState) {
    return "正在检查本地状态..."
  }

  switch (repositoryState.status) {
    case "ready":
      return repositoryState.isShallow ? "本地缓存已就绪（浅克隆）" : "本地缓存已就绪"
    case "invalid":
      return "本地目录不完整，可重新克隆"
    case "missing":
    default:
      return "还没有执行首次克隆"
  }
}

function getRepositoryActionLabel(repositoryState?: SynapseRepositoryLocalState): string {
  if (!repositoryState || repositoryState.status === "missing") {
    return "首次克隆"
  }

  if (repositoryState.status === "invalid") {
    return "重新克隆"
  }

  return "同步仓库"
}

function RepositoryListEditor({
  item,
  repositories,
  activeRepoUuid,
  onSave,
}: RepositoryListEditorProps) {
  const { cloneRepository, operations, states, syncRepository } = useRepositoryManager()
  const [draftName, setDraftName] = useState("")
  const [draftUrl, setDraftUrl] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  const handleAddRepository = async () => {
    const nextName = draftName.trim()
    const nextUrl = draftUrl.trim()

    if (!nextName || !nextUrl) {
      setFormError("仓库名称和仓库地址都不能为空。")
      return
    }

    if (repositories.some((repository) => repository.url === nextUrl)) {
      setFormError("这个仓库地址已经存在了。")
      return
    }

    const nextRepository: SynapseRepositoryConfig = {
      uuid: crypto.randomUUID(),
      name: nextName,
      url: nextUrl,
      credentialContext: null,
      rulesDir: DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.rulesDir,
      skillsDir: DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.skillsDir,
    }
    const nextRepositories = [...repositories, nextRepository]
    const nextActiveRepoUuid = activeRepoUuid ?? nextRepository.uuid

    setFormError(null)
    await onSave(nextRepositories, nextActiveRepoUuid, activeRepoUuid === null)
    setDraftName("")
    setDraftUrl("")
  }

  const handleRemoveRepository = async (repositoryUuid: string) => {
    const repository = repositories.find((itemValue) => itemValue.uuid === repositoryUuid)

    if (!repository) {
      return
    }

    const shouldDelete = window.confirm(`确认删除仓库“${repository.name}”的本地配置吗？`)

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
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            还没有配置仓库。添加后会写入本地配置，并可以立即执行首次浅克隆。
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {repositories.map((repository) => {
              const isActive = repository.uuid === activeRepoUuid
              const operation = operations[repository.uuid]
              const repositoryState = states[repository.uuid]
              const actionLabel = getRepositoryActionLabel(repositoryState)
              const isBusy = Boolean(operation?.isRunning)

              return (
                <div key={repository.uuid} className="flex flex-col gap-3 rounded-lg border p-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{repository.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {isActive ? "当前激活仓库" : "已保存"}
                      </p>
                    </div>
                    <p className="break-all text-sm text-muted-foreground">{repository.url}</p>
                    <p className="text-xs text-muted-foreground">
                      Rules: {repository.rulesDir} · Skills: {repository.skillsDir}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getRepositoryStatusLabel(repositoryState)}
                    </p>
                    {repositoryState?.localPath ? (
                      <p className="break-all text-xs text-muted-foreground">
                        本地目录：{repositoryState.localPath}
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
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={isBusy}
                      onClick={() => {
                        const operationPromise =
                          repositoryState?.status === "ready"
                            ? syncRepository(repository.uuid)
                            : cloneRepository(repository.uuid)

                        void operationPromise.catch(() => {})
                      }}
                    >
                      {isBusy
                        ? operation?.operation === "clone"
                          ? "克隆中..."
                          : "同步中..."
                        : actionLabel}
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
                      {isActive ? "当前仓库" : "切换为当前仓库"}
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
            <p className="text-sm font-medium">添加仓库</p>
            <p className="text-sm text-muted-foreground">
              新仓库会自动生成 UUID 作为本地缓存目录名，首次克隆固定使用 `--depth=1`。
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-repository-name">仓库名称</Label>
              <Input
                id="settings-repository-name"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-repository-url">仓库地址</Label>
              <Input
                id="settings-repository-url"
                value={draftUrl}
                onChange={(event) => setDraftUrl(event.target.value)}
              />
            </div>
          </div>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <div>
            <Button onClick={() => void handleAddRepository()}>添加仓库</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export { RepositoryListEditor }
