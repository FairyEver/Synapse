import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import type { SynapseProjectConfig } from "@/types/config"

type ProjectListEditorProps = {
  projects: SynapseProjectConfig[]
  onSave: (projects: SynapseProjectConfig[]) => Promise<void>
}

function ProjectListEditor({ projects, onSave }: ProjectListEditorProps) {
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
    <SettingsGroup>
      {projects.length > 0 ? (
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
      ) : null}

      <div className="flex flex-col gap-4">
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
    </SettingsGroup>
  )
}

export { ProjectListEditor }
