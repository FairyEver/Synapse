import { useState } from "react"
import { Folder } from "lucide-react"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Label } from "@/components/ui/label"
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
  const [editingProject, setEditingProject] = useState<SynapseProjectConfig | null>(null)
  const [editName, setEditName] = useState("")
  const [editPath, setEditPath] = useState("")
  const [editError, setEditError] = useState<string | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
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
      logger.info("Project added.", { name: nextName, path: nextPath })
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

  const handleEditProject = (project: SynapseProjectConfig) => {
    setEditingProject(project)
    setEditName(project.name)
    setEditPath(project.path)
    setEditError(null)
  }

  const handleEditDialogClose = () => {
    if (isSavingEdit) {
      return
    }
    setEditingProject(null)
    setEditName("")
    setEditPath("")
    setEditError(null)
  }

  const handleChooseEditPath = async () => {
    const bridge = window.synapse?.repository

    if (!bridge) {
      return
    }

    logger.info("Opening native directory picker for editing project.")
    const selectedPath = await bridge.chooseDirectory()

    if (!selectedPath) {
      return
    }

    setEditPath(selectedPath)
    setEditError(null)
  }

  const handleSaveEdit = async () => {
    if (!editingProject) {
      return
    }

    const trimmedName = editName.trim()
    const trimmedPath = editPath.trim()

    if (!trimmedName || !trimmedPath) {
      setEditError("项目名称和项目路径都不能为空。")
      return
    }

    // Check for duplicate path (excluding current project)
    const duplicatePath = projects.some(
      (project) => project.path === trimmedPath && project.id !== editingProject.id
    )
    if (duplicatePath) {
      setEditError("这个项目路径已经存在了。")
      return
    }

    setIsSavingEdit(true)
    setEditError(null)

    try {
      const updatedProject: SynapseProjectConfig = {
        ...editingProject,
        name: trimmedName,
        path: trimmedPath,
      }

      const nextProjects = projects.map((project) =>
        project.id === editingProject.id ? updatedProject : project
      )

      await onSave(nextProjects)
      logger.info("Project updated.", { projectId: editingProject.id })
      setEditingProject(null)
      setEditName("")
      setEditPath("")
    } catch (error) {
      logger.error("Failed to update project.", { error, projectId: editingProject.id })
      setEditError(error instanceof Error ? error.message : "保存失败。")
    } finally {
      setIsSavingEdit(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {projects.length > 0 && (
        <div className="flex flex-col gap-3">
          {projects.map((project) => (
            <Card key={project.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{project.name}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground break-all">
                  {project.path}
                </p>
              </CardContent>
              <CardFooter className="justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEditProject(project)}
                >
                  修改
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    logger.info("Project removed.", { projectId: project.id })
                    void onSave(projects.filter((itemValue) => itemValue.id !== project.id))
                  }}
                >
                  删除
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
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
                placeholder="我的项目"
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
      </div>

      <Dialog open={editingProject !== null} onOpenChange={(open) => { if (!open) handleEditDialogClose() }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>修改项目</DialogTitle>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <Label htmlFor="edit-project-name">项目名称</Label>
              <Input
                id="edit-project-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="我的项目"
                disabled={isSavingEdit}
              />
            </Field>
            <Field>
              <Label htmlFor="edit-project-path">项目路径</Label>
              <div className="flex gap-2">
                <Input
                  id="edit-project-path"
                  value={editPath}
                  onChange={(event) => setEditPath(event.target.value)}
                  placeholder="/path/to/project"
                  disabled={isSavingEdit}
                />
                {hasDirectoryPicker ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleChooseEditPath()}
                    disabled={isSavingEdit}
                  >
                    浏览
                  </Button>
                ) : null}
              </div>
            </Field>
            <FieldError>{editError}</FieldError>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleEditDialogClose()}
              disabled={isSavingEdit}
            >
              取消
            </Button>
            <Button
              onClick={() => void handleSaveEdit()}
              disabled={isSavingEdit}
            >
              {isSavingEdit ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { ProjectListEditor }
