import { useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
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
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import type { SynapseProjectConfig } from "@/types/config"
import { getProjectNameFromPath } from "@/lib/path-utils"

const logger = createRendererLogger("settings.projects")

type ProjectListEditorProps = {
  projects: SynapseProjectConfig[]
  onSave: (projects: SynapseProjectConfig[]) => Promise<void>
}

function ProjectListEditor({ projects, onSave }: ProjectListEditorProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [draftPath, setDraftPath] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const hasDirectoryPicker = Boolean(window.synapse?.repository)

  const resetForm = () => {
    setDraftName("")
    setDraftPath("")
    setFormError(null)
  }

  const handleOpenChange = (open: boolean) => {
    if (isSubmitting) return
    setIsDialogOpen(open)
    if (!open) {
      resetForm()
    }
  }

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

    setIsSubmitting(true)
    setFormError(null)

    try {
      await onSave([
        ...projects,
        {
          id: crypto.randomUUID(),
          name: nextName,
          path: nextPath,
        },
      ])
      setIsDialogOpen(false)
      resetForm()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "添加失败。")
    } finally {
      setIsSubmitting(false)
    }
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
        <ItemGroup>
          {projects.map((project) => (
            <Item key={project.id} variant="outline" className="items-start">
              <ItemContent className="min-w-0">
                <ItemTitle className="w-full">{project.name}</ItemTitle>
                <ItemDescription className="line-clamp-none break-all">
                  {project.path}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="w-full justify-end sm:w-auto sm:self-start">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void onSave(projects.filter((itemValue) => itemValue.id !== project.id))
                  }}
                >
                  删除
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      ) : null}

      <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button variant="outline">添加项目</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>添加项目</DialogTitle>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <Label htmlFor="dialog-project-name">项目名称</Label>
              <Input
                id="dialog-project-name"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="例如：我的项目"
                disabled={isSubmitting}
              />
            </Field>
            <Field>
              <Label htmlFor="dialog-project-path">项目路径</Label>
              <div className="flex gap-2">
                <Input
                  id="dialog-project-path"
                  value={draftPath}
                  onChange={(event) => setDraftPath(event.target.value)}
                  placeholder="/path/to/project"
                  disabled={isSubmitting}
                />
                {hasDirectoryPicker ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleChooseProjectPath()}
                    disabled={isSubmitting}
                  >
                    浏览
                  </Button>
                ) : null}
              </div>
            </Field>
            <FieldError>{formError}</FieldError>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              取消
            </Button>
            <Button
              onClick={() => void handleAddProject()}
              disabled={isSubmitting}
            >
              {isSubmitting ? "添加中..." : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsGroup>
  )
}

export { ProjectListEditor }
