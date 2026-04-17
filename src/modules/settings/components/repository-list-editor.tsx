import { useState } from "react"
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

function RepositoryListEditor({
  item,
  repositories,
  activeRepoUuid,
  onSave,
}: RepositoryListEditorProps) {
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
            还没有配置仓库。添加后会写入本地配置，克隆与同步会在步骤 6 接入。
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {repositories.map((repository) => {
              const isActive = repository.uuid === activeRepoUuid

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
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={isActive ? "secondary" : "outline"}
                      size="sm"
                      disabled={isActive}
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
              新仓库会自动生成 UUID 作为本地缓存目录名。
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
