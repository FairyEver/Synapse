import { useState } from "react"
import { Folder } from "lucide-react"
import { createRendererLogger } from "@/app-shell/logging"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { arePathsEqualForCompare } from "@/lib/path-compare"
import { getProjectNameFromPath } from "@/lib/path-utils"
import { getRendererPlatform } from "@/lib/runtime-platform"
import type { SynapseProjectConfig } from "@/types/config"

const logger = createRendererLogger("settings.projects")

type ProjectListEditorProps = {
  projects: SynapseProjectConfig[]
  onSave: (projects: SynapseProjectConfig[]) => Promise<void>
}

function isKnowledgeBaseProject(project: SynapseProjectConfig): boolean {
  return project.capabilities?.knowledgeBase?.managed === true
}

function ProjectListEditor({ projects, onSave }: ProjectListEditorProps) {
  const platform = getRendererPlatform()
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
  const [deleteTarget, setDeleteTarget] = useState<{ project: SynapseProjectConfig; sessionCount: number | null } | null>(null)
  const [isKnowledgeBaseDialogOpen, setIsKnowledgeBaseDialogOpen] = useState(false)
  const [knowledgeBaseName, setKnowledgeBaseName] = useState("")
  const [knowledgeBaseError, setKnowledgeBaseError] = useState<string | null>(null)
  const [isCreatingKnowledgeBase, setIsCreatingKnowledgeBase] = useState(false)
  const hasDirectoryPicker = Boolean(window.synapse?.repository)

  const resetForm = () => {
    setDraftName("")
    setDraftPath("")
    setFormError(null)
  }

  const handleOpenChange = (open: boolean) => {
    if (isSubmitting) return
    if (open) logger.info("Add project dialog opened.")
    setIsDialogOpen(open)
    if (!open) {
      resetForm()
    }
  }

  const resetKnowledgeBaseForm = () => {
    setKnowledgeBaseName("")
    setKnowledgeBaseError(null)
  }

  const handleKnowledgeBaseDialogOpenChange = (open: boolean) => {
    if (isCreatingKnowledgeBase) return
    setIsKnowledgeBaseDialogOpen(open)
    if (!open) {
      resetKnowledgeBaseForm()
    }
  }

  const handleAddProject = async () => {
    const nextName = draftName.trim()
    const nextPath = draftPath.trim()

    if (!nextName || !nextPath) {
      setFormError("项目名称和项目路径都不能为空。")
      return
    }

    if (projects.some((project) => arePathsEqualForCompare(project.path, nextPath, { platform }))) {
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
      logger.error("Failed to add project.", { error, name: nextName, path: nextPath })
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

    try {
      logger.info("Opening native directory picker from project settings.")
      const selectedPath = await bridge.chooseDirectory()

      if (!selectedPath) {
        logger.info("Project directory picker was dismissed without selecting a directory.")
        return
      }

      setDraftPath(selectedPath)
      setDraftName((currentName) => (currentName.trim() ? currentName : getProjectNameFromPath(selectedPath)))
      setFormError(null)
    } catch (error) {
      logger.error("Failed to select project directory.", { error })
      setFormError(error instanceof Error ? error.message : "选择目录失败。")
    }
  }

  const handleCreateKnowledgeBase = async () => {
    const name = knowledgeBaseName.trim()
    if (!name) {
      setKnowledgeBaseError("知识库名称不能为空。")
      return
    }
    if (!window.synapse?.knowledgeBase?.createManaged) {
      setKnowledgeBaseError("知识库服务不可用。")
      return
    }

    const projectId = crypto.randomUUID()
    setIsCreatingKnowledgeBase(true)
    setKnowledgeBaseError(null)
    try {
      const result = await window.synapse.knowledgeBase.createManaged({ projectId, name })
      await onSave([
        ...projects,
        {
          id: projectId,
          name,
          path: result.projectPath,
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: result.templateVersion,
              managed: true,
              runtimeId: projectId,
            },
          },
        },
      ])
      setIsKnowledgeBaseDialogOpen(false)
      resetKnowledgeBaseForm()
    } catch (error) {
      logger.error("Failed to create managed knowledge base project.", { error, projectId })
      setKnowledgeBaseError(error instanceof Error ? error.message : "创建失败。")
    } finally {
      setIsCreatingKnowledgeBase(false)
    }
  }

  const handleRemoveProject = async (project: SynapseProjectConfig) => {
    try {
      if (isKnowledgeBaseProject(project)) {
        const bridge = window.synapse?.knowledgeBase
        if (!bridge?.deleteManaged) {
          throw new Error("知识库服务不可用。")
        }
        await bridge.deleteManaged({ projectId: project.id })
      }
      await onSave(projects.filter((item) => item.id !== project.id))
      logger.info("Project removed.", { projectId: project.id })
    } catch (error) {
      logger.error("Failed to remove project.", { projectId: project.id, error })
    }
  }

  const handleEditProject = (project: SynapseProjectConfig) => {
    logger.info("Project edit dialog opened.", { projectId: project.id })
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

    try {
      logger.info("Opening native directory picker for editing project.")
      const selectedPath = await bridge.chooseDirectory()

      if (!selectedPath) {
        logger.info("Project edit directory picker was dismissed.")
        return
      }

      logger.info("Project edit directory selected.", { selectedPath })

      setEditPath(selectedPath)
      setEditError(null)
    } catch (error) {
      logger.error("Failed to select directory for editing project.", { error })
      setEditError(error instanceof Error ? error.message : "选择目录失败。")
    }
  }

  const handleSaveEdit = async () => {
    if (!editingProject) {
      return
    }

    const trimmedName = editName.trim()
    const editingKnowledgeBase = isKnowledgeBaseProject(editingProject)
    const trimmedPath = editingKnowledgeBase ? editingProject.path : editPath.trim()

    if (!trimmedName || (!editingKnowledgeBase && !trimmedPath)) {
      setEditError(editingKnowledgeBase ? "项目名称不能为空。" : "项目名称和项目路径都不能为空。")
      return
    }

    if (!editingKnowledgeBase) {
      const duplicatePath = projects.some(
        (project) =>
          arePathsEqualForCompare(project.path, trimmedPath, { platform })
          && project.id !== editingProject.id,
      )
      if (duplicatePath) {
        setEditError("这个项目路径已经存在了。")
        return
      }
    }

    setIsSavingEdit(true)
    setEditError(null)

    try {
      const projectWithoutLegacyAgent = {
        ...editingProject,
      } as SynapseProjectConfig & { defaultAgentId?: string }
      delete projectWithoutLegacyAgent.defaultAgentId
      const updatedProject: SynapseProjectConfig = {
        ...projectWithoutLegacyAgent,
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
    <div className="flex flex-col gap-2">
      {projects.length > 0 && (
        <div className="flex flex-col gap-2">
          {projects.map((project) => (
            <Card key={project.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{project.name}</span>
                  {isKnowledgeBaseProject(project) ? (
                    <Badge variant="secondary">知识库</Badge>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {!isKnowledgeBaseProject(project) ? (
                  <p className="text-sm text-muted-foreground break-all">
                    {project.path}
                  </p>
                ) : null}
              </CardContent>
              <CardFooter className="justify-end gap-2">
                {isKnowledgeBaseProject(project) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void window.synapse?.knowledgeBase?.openSourceManager({
                        projectId: project.id,
                        projectName: project.name,
                      }).catch((error) => logger.error("Failed to open knowledge base source manager.", { projectId: project.id, error }))
                    }}
                  >
                    资料管理
                  </Button>
                ) : null}
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
                    const bridge = window.synapse?.agent
                    if (!bridge) {
                      setDeleteTarget({ project, sessionCount: null })
                      return
                    }
                    void bridge.listSessions(project.id).then((sessions) => {
                      if (sessions.length > 0) {
                        setDeleteTarget({ project, sessionCount: sessions.length })
                      } else {
                        void handleRemoveProject(project)
                      }
                    }).catch((err) => {
                      logger.error("Failed to list project sessions before deletion.", { projectId: project.id, error: err })
                      setDeleteTarget({ project, sessionCount: null })
                    })
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
        <Dialog open={isKnowledgeBaseDialogOpen} onOpenChange={handleKnowledgeBaseDialogOpenChange}>
          <DialogTrigger asChild>
            <Button variant="outline">新建知识库</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>新建知识库</DialogTitle>
            </DialogHeader>
            <FieldGroup className="gap-2">
              <Field>
                <Label htmlFor="knowledge-base-name">知识库名称</Label>
                <Input
                  id="knowledge-base-name"
                  value={knowledgeBaseName}
                  onChange={(event) => setKnowledgeBaseName(event.target.value)}
                  disabled={isCreatingKnowledgeBase}
                />
              </Field>
              <FieldError>{knowledgeBaseError}</FieldError>
            </FieldGroup>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleKnowledgeBaseDialogOpenChange(false)} disabled={isCreatingKnowledgeBase}>
                取消
              </Button>
              <Button onClick={() => void handleCreateKnowledgeBase()} disabled={isCreatingKnowledgeBase}>
                {isCreatingKnowledgeBase ? "创建中..." : "创建"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button variant="outline">添加项目</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>添加项目</DialogTitle>
          </DialogHeader>
          <FieldGroup className="gap-2">
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
          <FieldGroup className="gap-2">
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
            {editingProject && !isKnowledgeBaseProject(editingProject) ? (
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
            ) : null}
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

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除项目</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.sessionCount === null
                ? `无法确认「${deleteTarget.project.name}」下的 Agent 对话。删除项目后，相关对话将移入「已归档」分组，不会被删除。`
                : `「${deleteTarget?.project.name}」下有 ${deleteTarget?.sessionCount} 条 Agent 对话，删除项目后这些对话将移入「已归档」分组，不会被删除。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return
                const targetId = deleteTarget.project.id
                const targetProject = deleteTarget.project
                setDeleteTarget(null)
                void handleRemoveProject(targetProject)
              }}
            >
              删除项目
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { ProjectListEditor }
