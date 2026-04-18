import { useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import type { SynapseProjectConfig } from "@/types/config"

const logger = createRendererLogger("settings.projects")

type ProjectListEditorProps = {
  projects: SynapseProjectConfig[]
  onSave: (projects: SynapseProjectConfig[]) => Promise<void>
}

function getProjectNameFromPath(projectPath: string): string {
  const normalizedPath = projectPath.replace(/[\\/]+$/, "")
  const segments = normalizedPath.split(/[\\/]/).filter((segment) => segment.length > 0)

  return segments.at(-1) ?? projectPath
}

function ProjectListEditor({ projects, onSave }: ProjectListEditorProps) {
  const [draftName, setDraftName] = useState("")
  const [draftPath, setDraftPath] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const hasDirectoryPicker = Boolean(window.synapse?.repository)

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

  const handleChooseProjectPath = async () => {
    const bridge = window.synapse?.repository

    if (!bridge) {
      return
    }

    logger.info("Opening native directory picker from project settings.")
    const selectedPath = await bridge.chooseDirectory()

    if (!selectedPath) {
      logger.info("Project directory picker was dismissed without selecting a directory.")
      return
    }

    setDraftPath(selectedPath)
    setDraftName((currentName) => (currentName.trim() ? currentName : getProjectNameFromPath(selectedPath)))
    setFormError(null)
  }

  return (
    <SettingsGroup>
      {projects.length > 0 ? (
        <div className="flex flex-col divide-y divide-border/60">
          {projects.map((project) => (
            <div key={project.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
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
            <div className="flex gap-2">
              <Input
                id="settings-project-path"
                value={draftPath}
                onChange={(event) => setDraftPath(event.target.value)}
              />
              {hasDirectoryPicker ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void handleChooseProjectPath()
                  }}
                >
                  浏览
                </Button>
              ) : null}
            </div>
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
