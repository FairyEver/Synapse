import { useEffect, useRef, useState } from "react"
import { ChevronDown, Folder } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { ProjectAddDialog } from "@/app-shell/components/project-add-dialog"
import type { ProjectAddInput, ProjectAddResult } from "@/app-shell/use-project-actions"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { arePathsEqualForCompare } from "@/lib/path-compare"
import { getRendererPlatform } from "@/lib/runtime-platform"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import { SettingsSectionHeading } from "@/modules/settings/components/settings-section-heading"
import { KnowledgeBaseImportDialog } from "@/modules/settings/components/knowledge-base-import-dialog"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseKnowledgeBaseTransferProgress } from "@/types/knowledge-base"

const logger = createRendererLogger("settings.projects")

const SAFE_KNOWLEDGE_BASE_CREATE_ERRORS = new Set([
  "知识库存储位置不可用。",
  "知识库存储位置不可用。请在设置中重新检测。",
  "知识库存储迁移正在进行。",
  "知识库存储迁移正在进行，请稍后再试。",
])

type ProjectListEditorProps = {
  projects: SynapseProjectConfig[]
  onSave: (projects: SynapseProjectConfig[]) => Promise<void>
  onAddProject: (input: ProjectAddInput) => Promise<ProjectAddResult>
  onRefresh: () => Promise<void>
}

function isKnowledgeBaseProject(project: SynapseProjectConfig): boolean {
  return project.capabilities?.knowledgeBase?.managed === true
}

function formatDeleteProjectDescription(target: { project: SynapseProjectConfig; sessionCount: number | null } | null): string {
  if (!target) return ""
  if (target.sessionCount === null) {
    return `无法确认「${target.project.name}」下的 Agent 对话。删除项目后，相关对话将移入「已归档」分组，不会被删除。`
  }
  if (target.sessionCount === 0) {
    return `确认删除「${target.project.name}」？`
  }
  return `「${target.project.name}」下有 ${target.sessionCount} 条 Agent 对话，删除项目后这些对话将移入「已归档」分组，不会被删除。`
}

function formatKnowledgeBaseCreateError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : ""
  return SAFE_KNOWLEDGE_BASE_CREATE_ERRORS.has(message) ? message : "创建知识库失败。"
}

const IDLE_TRANSFER_PROGRESS: SynapseKnowledgeBaseTransferProgress = {
  active: false,
  operation: "idle",
  phase: "idle",
  cancellable: false,
  copiedBytes: 0,
  totalBytes: null,
  message: "",
}

function ProjectListEditor({ projects, onSave, onAddProject, onRefresh }: ProjectListEditorProps) {
  const platform = getRendererPlatform()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<SynapseProjectConfig | null>(null)
  const [editName, setEditName] = useState("")
  const [editPath, setEditPath] = useState("")
  const [editError, setEditError] = useState<string | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ project: SynapseProjectConfig; sessionCount: number | null } | null>(null)
  const [isKnowledgeBaseDialogOpen, setIsKnowledgeBaseDialogOpen] = useState(false)
  const [isKnowledgeBaseImportDialogOpen, setIsKnowledgeBaseImportDialogOpen] = useState(false)
  const [knowledgeBaseName, setKnowledgeBaseName] = useState("")
  const [knowledgeBaseError, setKnowledgeBaseError] = useState<string | null>(null)
  const [isCreatingKnowledgeBase, setIsCreatingKnowledgeBase] = useState(false)
  const [openingKnowledgeBaseProjectId, setOpeningKnowledgeBaseProjectId] = useState<string | null>(null)
  const [exportingKnowledgeBaseProjectId, setExportingKnowledgeBaseProjectId] = useState<string | null>(null)
  const [transferProgress, setTransferProgress] = useState(IDLE_TRANSFER_PROGRESS)
  const isKnowledgeBaseCreateInFlightRef = useRef(false)
  const hasDirectoryPicker = Boolean(window.synapse?.settings.repository)

  useEffect(() => {
    const bridge = window.synapse?.knowledgeBase
    const unsubscribe = bridge?.onTransferChanged?.((progress) => {
      if (progress.operation === "export" || progress.operation === "idle") {
        setTransferProgress(progress)
      }
    })
    return () => unsubscribe?.()
  }, [])

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

  const handleCreateKnowledgeBase = async () => {
    if (isKnowledgeBaseCreateInFlightRef.current) return
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
    let shouldCleanupRuntime = false
    isKnowledgeBaseCreateInFlightRef.current = true
    setIsCreatingKnowledgeBase(true)
    setKnowledgeBaseError(null)
    try {
      const result = await window.synapse.knowledgeBase.createManaged({ projectId, name })
      shouldCleanupRuntime = true
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
      if (shouldCleanupRuntime) {
        await window.synapse.knowledgeBase.deleteManaged?.({ projectId, runtimeId: projectId }).catch((cleanupError) => {
          logger.error("Failed to clean up managed knowledge base runtime after create failure.", { cleanupError, projectId })
        })
      }
      logger.error("Failed to create managed knowledge base project.", { error, projectId })
      setKnowledgeBaseError(formatKnowledgeBaseCreateError(error))
    } finally {
      isKnowledgeBaseCreateInFlightRef.current = false
      setIsCreatingKnowledgeBase(false)
    }
  }

  const handleRemoveProject = async (project: SynapseProjectConfig) => {
    let shouldRestoreProject = false
    try {
      const nextProjects = projects.filter((item) => item.id !== project.id)
      if (isKnowledgeBaseProject(project)) {
        const bridge = window.synapse?.knowledgeBase
        if (!bridge?.deleteManaged) {
          throw new Error("知识库服务不可用。")
        }
        const runtimeId = project.capabilities?.knowledgeBase?.runtimeId
        if (!runtimeId) {
          throw new Error("知识库运行时不可用。")
        }
        await onSave(nextProjects)
        shouldRestoreProject = true
        await bridge.deleteManaged({ projectId: project.id, runtimeId })
      } else {
        await onSave(nextProjects)
      }
      logger.info("Project removed.", { projectId: project.id })
    } catch (error) {
      if (shouldRestoreProject) {
        await onSave(projects).catch((rollbackError) => {
          logger.error("Failed to restore project list after managed knowledge base deletion failure.", {
            error: rollbackError,
            projectId: project.id,
          })
        })
      }
      logger.error("Failed to remove project.", { projectId: project.id, error })
      toast("删除项目失败。")
    }
  }

  const handleOpenKnowledgeBaseSources = async (project: SynapseProjectConfig) => {
    try {
      setOpeningKnowledgeBaseProjectId(project.id)
      await window.synapse?.knowledgeBase?.openSourceManager({
        projectId: project.id,
        projectName: project.name,
      })
    } catch (error) {
      logger.error("Failed to open knowledge base source manager.", { projectId: project.id, error })
      toast("打开资料管理失败")
    } finally {
      setOpeningKnowledgeBaseProjectId((current) => current === project.id ? null : current)
    }
  }

  const handleExportKnowledgeBase = async (project: SynapseProjectConfig) => {
    try {
      setExportingKnowledgeBaseProjectId(project.id)
      const result = await window.synapse?.knowledgeBase?.exportManagedFolder({ projectId: project.id })
      if (result) toast("知识库已导出。")
    } catch (error) {
      logger.error("Failed to export managed knowledge base.", { projectId: project.id, error })
      toast(error instanceof Error ? error.message : "导出知识库失败。")
    } finally {
      setExportingKnowledgeBaseProjectId(null)
      setTransferProgress(IDLE_TRANSFER_PROGRESS)
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
    const bridge = window.synapse?.settings.repository

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

  const actionButtons = (
    <div className="flex flex-wrap gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            知识库
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setIsKnowledgeBaseDialogOpen(true)}>新建知识库</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setIsKnowledgeBaseImportDialogOpen(true)}>导入知识库</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={isKnowledgeBaseDialogOpen} onOpenChange={handleKnowledgeBaseDialogOpenChange}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>新建知识库</DialogTitle>
            <DialogDescription className="sr-only">
              输入知识库名称。
            </DialogDescription>
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
      <ProjectAddDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onAddProject={onAddProject}
        trigger={<Button variant="outline">添加项目</Button>}
      />
    </div>
  )

  return (
    <div>
      <SettingsSectionHeading>项目和知识库</SettingsSectionHeading>
      <SettingsGroup sectionClassName="p-0">
        {projects.length > 0 ? (
          <Table className="min-w-[760px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[15rem] px-4">名称</TableHead>
                <TableHead>位置</TableHead>
                <TableHead className="w-[15rem] px-4 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => {
                const knowledgeBaseProject = isKnowledgeBaseProject(project)
                return (
                  <TableRow key={project.id}>
                    <TableCell className="px-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate font-medium" title={project.name}>
                          {project.name}
                        </span>
                        {knowledgeBaseProject ? (
                          <Badge variant="secondary">知识库</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {knowledgeBaseProject ? (
                        <span className="text-muted-foreground">知识库存储</span>
                      ) : (
                        <span
                          className="block truncate text-muted-foreground"
                          title={project.path}
                          data-allow-select="true"
                        >
                          {project.path}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-4">
                      <div className="flex justify-end gap-1">
                        {knowledgeBaseProject ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={openingKnowledgeBaseProjectId === project.id}
                              onClick={() => void handleOpenKnowledgeBaseSources(project)}
                            >
                              资料管理
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={exportingKnowledgeBaseProjectId === project.id}
                              onClick={() => void handleExportKnowledgeBase(project)}
                            >
                              导出
                            </Button>
                          </>
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
                              if (sessions.length > 0 || isKnowledgeBaseProject(project)) {
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
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="px-4 py-6">
            <p className="text-sm text-muted-foreground">暂无项目</p>
          </div>
        )}
        <div className="px-4 py-3">
          {actionButtons}
        </div>
      </SettingsGroup>

      <KnowledgeBaseImportDialog
        open={isKnowledgeBaseImportDialogOpen}
        onOpenChange={setIsKnowledgeBaseImportDialogOpen}
        onImported={onRefresh}
      />

      <Dialog open={exportingKnowledgeBaseProjectId !== null && transferProgress.active && transferProgress.operation === "export"}>
        <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>导出知识库</DialogTitle>
            <DialogDescription className="sr-only">正在导出知识库。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2" role="status" aria-live="polite">
            <p className="text-sm">{transferProgress.message}</p>
            <Progress value={transferProgress.totalBytes ? Math.min(100, Math.round((transferProgress.copiedBytes / transferProgress.totalBytes) * 100)) : 0} />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={!transferProgress.cancellable}
              onClick={() => void window.synapse?.knowledgeBase?.cancelTransfer()}
            >
              取消导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingProject !== null} onOpenChange={(open) => { if (!open) handleEditDialogClose() }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>修改项目</DialogTitle>
            <DialogDescription className="sr-only">
              修改项目信息。
            </DialogDescription>
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
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{formatDeleteProjectDescription(deleteTarget)}</p>
                {deleteTarget && isKnowledgeBaseProject(deleteTarget.project) ? (
                  <p>会同时删除该知识库的托管数据。</p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return
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
