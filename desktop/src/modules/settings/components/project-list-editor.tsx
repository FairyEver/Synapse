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
  return project.capabilities?.knowledgeBase?.enabled === true
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
  const [knowledgeBasePath, setKnowledgeBasePath] = useState("")
  const [knowledgeBaseError, setKnowledgeBaseError] = useState<string | null>(null)
  const [isCreatingKnowledgeBase, setIsCreatingKnowledgeBase] = useState(false)
  const [markingKnowledgeBaseProjectId, setMarkingKnowledgeBaseProjectId] = useState<string | null>(null)
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

  const handleChooseKnowledgeBasePath = async () => {
    const selectedPath = await window.synapse?.repository?.chooseDirectory()
    if (!selectedPath) return
    setKnowledgeBasePath(selectedPath)
    setKnowledgeBaseName((current) => current.trim() ? current : getProjectNameFromPath(selectedPath))
    setKnowledgeBaseError(null)
  }

  const handleCreateKnowledgeBase = async () => {
    const name = knowledgeBaseName.trim()
    const projectPath = knowledgeBasePath.trim()
    if (!name || !projectPath) {
      setKnowledgeBaseError("项目名称和项目路径都不能为空。")
      return
    }
    if (!window.synapse?.knowledgeBase) {
      setKnowledgeBaseError("知识库服务不可用。")
      return
    }
    if (projects.some((project) => arePathsEqualForCompare(project.path, projectPath, { platform }))) {
      setKnowledgeBaseError("这个项目路径已经存在了。")
      return
    }

    setIsCreatingKnowledgeBase(true)
    setKnowledgeBaseError(null)
    try {
      const result = await window.synapse.knowledgeBase.initialize({ projectPath, mode: "create" })
      await onSave([
        ...projects,
        {
          id: crypto.randomUUID(),
          name,
          path: projectPath,
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: result.templateVersion,
            },
          },
        },
      ])
      setIsKnowledgeBaseDialogOpen(false)
      setKnowledgeBaseName("")
      setKnowledgeBasePath("")
    } catch (error) {
      logger.error("Failed to create knowledge base project.", { error, path: projectPath })
      setKnowledgeBaseError(error instanceof Error ? error.message : "创建失败。")
    } finally {
      setIsCreatingKnowledgeBase(false)
    }
  }

  const handleOpenExistingKnowledgeBase = async () => {
    const selectedPath = await window.synapse?.repository?.chooseDirectory()
    if (!selectedPath || !window.synapse?.knowledgeBase) return
    if (projects.some((project) => arePathsEqualForCompare(project.path, selectedPath, { platform }))) {
      setFormError("这个项目路径已经存在了。")
      return
    }
    const inspection = await window.synapse.knowledgeBase.inspect(selectedPath)
    if (!inspection.isKnowledgeBase) {
      setFormError("未识别为知识库目录。")
      return
    }
    const result = await window.synapse.knowledgeBase.initialize({
      projectPath: selectedPath,
      mode: "repair",
    })
    await onSave([
      ...projects,
      {
        id: crypto.randomUUID(),
        name: getProjectNameFromPath(selectedPath),
        path: selectedPath,
        capabilities: {
          knowledgeBase: {
            enabled: true,
            schemaVersion: 1,
            templateVersion: result.templateVersion,
          },
        },
      },
    ])
  }

  const handleMarkProjectAsKnowledgeBase = async (project: SynapseProjectConfig) => {
    if (!window.synapse?.knowledgeBase) return
    setMarkingKnowledgeBaseProjectId(project.id)
    try {
      const result = await window.synapse.knowledgeBase.initialize({
        projectPath: project.path,
        mode: "repair",
      })
      await onSave(projects.map((item) => item.id === project.id
        ? {
            ...item,
            capabilities: {
              ...item.capabilities,
              knowledgeBase: {
                enabled: true,
                schemaVersion: 1,
                templateVersion: result.templateVersion,
              },
            },
          }
        : item))
    } finally {
      setMarkingKnowledgeBaseProjectId(null)
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
    const trimmedPath = editPath.trim()

    if (!trimmedName || !trimmedPath) {
      setEditError("项目名称和项目路径都不能为空。")
      return
    }

    // Check for duplicate path (excluding current project)
    const duplicatePath = projects.some(
      (project) =>
        arePathsEqualForCompare(project.path, trimmedPath, { platform })
        && project.id !== editingProject.id,
    )
    if (duplicatePath) {
      setEditError("这个项目路径已经存在了。")
      return
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
                <p className="text-sm text-muted-foreground break-all">
                  {project.path}
                </p>
              </CardContent>
              <CardFooter className="justify-end gap-2">
                {!isKnowledgeBaseProject(project) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={markingKnowledgeBaseProjectId === project.id}
                    onClick={() => void handleMarkProjectAsKnowledgeBase(project)}
                  >
                    设为知识库
                  </Button>
                ) : null}
                {isKnowledgeBaseProject(project) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void window.synapse?.knowledgeBase?.openRawDirectory(project.path)
                        .catch((error) => logger.error("Failed to open knowledge base raw directory.", { projectId: project.id, error }))
                    }}
                  >
                    维护文件
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
                        void onSave(projects.filter((item) => item.id !== project.id))
                          .then(() => logger.info("Project removed.", { projectId: project.id }))
                          .catch((err) => logger.error("Failed to remove project.", { projectId: project.id, error: err }))
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
        <Button variant="outline" onClick={() => void handleOpenExistingKnowledgeBase()}>
          打开知识库
        </Button>
        <Dialog open={isKnowledgeBaseDialogOpen} onOpenChange={setIsKnowledgeBaseDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">新建知识库</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>新建知识库</DialogTitle>
            </DialogHeader>
            <FieldGroup className="gap-2">
              <Field>
                <Label htmlFor="knowledge-base-name">项目名称</Label>
                <Input
                  id="knowledge-base-name"
                  value={knowledgeBaseName}
                  onChange={(event) => setKnowledgeBaseName(event.target.value)}
                  disabled={isCreatingKnowledgeBase}
                />
              </Field>
              <Field>
                <Label htmlFor="knowledge-base-path">项目路径</Label>
                <div className="flex gap-2">
                  <Input
                    id="knowledge-base-path"
                    value={knowledgeBasePath}
                    onChange={(event) => setKnowledgeBasePath(event.target.value)}
                    disabled={isCreatingKnowledgeBase}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleChooseKnowledgeBasePath()}
                    disabled={isCreatingKnowledgeBase}
                  >
                    浏览
                  </Button>
                </div>
              </Field>
              <FieldError>{knowledgeBaseError}</FieldError>
            </FieldGroup>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsKnowledgeBaseDialogOpen(false)} disabled={isCreatingKnowledgeBase}>
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
                setDeleteTarget(null)
                void onSave(projects.filter((item) => item.id !== targetId))
                  .then(() => logger.info("Project removed.", { projectId: targetId }))
                  .catch((err) => logger.error("Failed to remove project.", { projectId: targetId, error: err }))
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
