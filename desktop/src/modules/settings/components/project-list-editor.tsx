import { useEffect, useState } from "react"
import { Folder, Plug } from "lucide-react"
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
import { FeishuConnectorPanel } from "@/modules/settings/components/feishu-connector-panel"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseFeishuConnectorRuntimeStatus } from "@/types/connectors"

const logger = createRendererLogger("settings.projects")

type ProjectListEditorProps = {
  projects: SynapseProjectConfig[]
  onSave: (projects: SynapseProjectConfig[]) => Promise<void>
}

type ConnectorDialogState = {
  project: SynapseProjectConfig
  variant: "setup" | "config"
  initialTab: "status" | "credentials"
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
  const [connectorDialog, setConnectorDialog] = useState<ConnectorDialogState | null>(null)
  const [connectorRefreshToken, setConnectorRefreshToken] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<{ project: SynapseProjectConfig; sessionCount: number } | null>(null)
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
    logger.info("Project edit dialog opened.", { projectId: project.id })
    setEditingProject(project)
    setEditName(project.name)
    setEditPath(project.path)
    setEditError(null)
  }

  const handleOpenConnector = (
    project: SynapseProjectConfig,
    variant: ConnectorDialogState["variant"],
    initialTab: ConnectorDialogState["initialTab"],
  ) => {
    setConnectorDialog({ project, variant, initialTab })
  }

  const handleConnectorChanged = () => {
    setConnectorRefreshToken((value) => value + 1)
    setConnectorDialog((current) => current
      ? {
        ...current,
        variant: "config",
        initialTab: current.variant === "setup" ? "status" : current.initialTab,
      }
      : current)
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
      logger.info("Project edit directory picker was dismissed.")
      return
    }

    logger.info("Project edit directory selected.", { selectedPath })

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
        <div className="flex flex-col gap-4">
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
                <ProjectConnectorButton
                  project={project}
                  refreshToken={connectorRefreshToken}
                  onOpen={handleOpenConnector}
                />
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
                      void onSave(projects.filter((item) => item.id !== project.id))
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
                    }).catch(() => {
                      void onSave(projects.filter((item) => item.id !== project.id))
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

      <Dialog open={connectorDialog !== null} onOpenChange={(open) => { if (!open) setConnectorDialog(null) }}>
        <DialogContent className="max-h-svh overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{connectorDialog?.project.name ?? "飞书连接器"}</DialogTitle>
          </DialogHeader>
          {connectorDialog ? (
            <FeishuConnectorPanel
              key={`${connectorDialog.project.id}:${connectorDialog.variant}:${connectorDialog.initialTab}`}
              projectId={connectorDialog.project.id}
              projectName={connectorDialog.project.name}
              projectPath={connectorDialog.project.path}
              initialTab={connectorDialog.initialTab}
              variant={connectorDialog.variant}
              onConnectorChange={handleConnectorChanged}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除项目</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.project.name}」下有 {deleteTarget?.sessionCount} 条 Agent 对话，删除项目后这些对话将移入「已归档」分组，不会被删除。
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

function ProjectConnectorButton({
  project,
  refreshToken,
  onOpen,
}: {
  project: SynapseProjectConfig
  refreshToken: number
  onOpen: (
    project: SynapseProjectConfig,
    variant: ConnectorDialogState["variant"],
    initialTab: ConnectorDialogState["initialTab"],
  ) => void
}) {
  const [status, setStatus] = useState<SynapseFeishuConnectorRuntimeStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const feishu = window.synapse?.connectors.feishu

  useEffect(() => {
    if (!feishu) {
      setStatus(null)
      return
    }

    let cancelled = false
    setIsLoading(true)

    void feishu.getStatus(project.id).then((nextStatus) => {
      if (!cancelled) setStatus(nextStatus)
    }).catch((error) => {
      logger.error("Failed to load project connector status.", { error, projectId: project.id })
      if (!cancelled) setStatus(null)
    }).finally(() => {
      if (!cancelled) setIsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [feishu, project.id, refreshToken])

  const configured = status?.configured ?? false

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={!feishu || isLoading}
      onClick={() => onOpen(
        project,
        configured ? "config" : "setup",
        configured ? "status" : "credentials",
      )}
    >
      <Plug data-icon="inline-start" />
      {configured ? "连接器配置" : "添加连接器"}
    </Button>
  )
}

export { ProjectListEditor }
