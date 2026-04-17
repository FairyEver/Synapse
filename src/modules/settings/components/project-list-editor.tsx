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
import type { SettingItem } from "@/modules/settings/types"
import type { SynapseProjectConfig } from "@/types/config"

type ProjectListEditorProps = {
  item: SettingItem
  projects: SynapseProjectConfig[]
  onSave: (projects: SynapseProjectConfig[]) => Promise<void>
}

function ProjectListEditor({ item, projects, onSave }: ProjectListEditorProps) {
  const [draftName, setDraftName] = useState("")
  const [draftPath, setDraftPath] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  const handleAddProject = async () => {
    const nextName = draftName.trim()
    const nextPath = draftPath.trim()

    if (!nextName || !nextPath) {
      setFormError("项目名称和项目路径都不能为空。")
      return
    }

    if (projects.some((project) => project.path === nextPath)) {
      setFormError("这个项目路径已经存在了。")
      return
    }

    setFormError(null)
    await onSave([
      ...projects,
      {
        id: crypto.randomUUID(),
        name: nextName,
        path: nextPath,
      },
    ])
    setDraftName("")
    setDraftPath("")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.label}</CardTitle>
        {item.description ? <CardDescription>{item.description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            还没有项目路径。步骤 17 会直接复用这里的项目列表。
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {projects.map((project) => (
              <div key={project.id} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex flex-col gap-1">
                  <p className="font-medium">{project.name}</p>
                  <p className="break-all text-sm text-muted-foreground">{project.path}</p>
                </div>
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void onSave(projects.filter((itemValue) => itemValue.id !== project.id))
                    }}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Separator />

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">添加项目</p>
            <p className="text-sm text-muted-foreground">
              项目是本地文件夹，不和某个编辑器绑定。
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-project-name">项目名称</Label>
              <Input
                id="settings-project-name"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-project-path">项目路径</Label>
              <Input
                id="settings-project-path"
                value={draftPath}
                onChange={(event) => setDraftPath(event.target.value)}
              />
            </div>
          </div>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <div>
            <Button onClick={() => void handleAddProject()}>添加项目</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export { ProjectListEditor }
