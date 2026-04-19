import { useEffect, useMemo, useState } from "react"
import { FolderOpen, LoaderCircle } from "lucide-react"
import {
  installToEditor,
  peekCursorFrontmatter,
  resolveEditorInstallTarget,
} from "@/app-shell/content"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getContentTypeDefinition } from "@/config/content-types"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseContentMeta } from "@/types/content"
import type {
  CursorRuleFrontmatter,
  SynapseEditorAdapterSummary,
  SynapseEditorResolvedTarget,
} from "@/types/editor"
import { CursorFrontmatterDialog } from "./cursor-frontmatter-dialog"

const CUSTOM_PROJECT_OPTION = "__custom__"

type InstallTargetState = {
  error: string | null
  isLoading: boolean
  value: SynapseEditorResolvedTarget | null
}

type ContentInstallDialogProps = {
  editor: SynapseEditorAdapterSummary | null
  item: SynapseContentMeta
  onOpenChange: (open: boolean) => void
  open: boolean
  projects: SynapseProjectConfig[]
}

function createIdleTargetState(): InstallTargetState {
  return {
    error: null,
    isLoading: false,
    value: null,
  }
}

function ContentInstallDialog({
  editor,
  item,
  onOpenChange,
  open,
  projects,
}: ContentInstallDialogProps) {
  const definition = getContentTypeDefinition(item.type)
  const logger = useMemo(
    () => createRendererLogger(`content.install.${item.type}`),
    [item.type],
  )
  const { promise } = useAppNotifications()
  const [scope, setScope] = useState<"global" | "project">("global")
  const [projectSelection, setProjectSelection] = useState<string>(CUSTOM_PROJECT_OPTION)
  const [customProjectPath, setCustomProjectPath] = useState("")
  const [globalTargetState, setGlobalTargetState] = useState<InstallTargetState>(createIdleTargetState)
  const [projectTargetState, setProjectTargetState] = useState<InstallTargetState>(createIdleTargetState)
  const [installError, setInstallError] = useState<string | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const [isOverwriteConfirmOpen, setIsOverwriteConfirmOpen] = useState(false)
  const [isConflictConfirmOpen, setIsConflictConfirmOpen] = useState(false)
  const [isCursorFrontmatterOpen, setIsCursorFrontmatterOpen] = useState(false)
  const [cursorFrontmatterDefaults, setCursorFrontmatterDefaults] =
    useState<CursorRuleFrontmatter | null>(null)
  const hasDirectoryPicker = Boolean(window.synapse?.repository)

  const selectedProject = projects.find((project) => project.id === projectSelection) ?? null
  const selectedProjectLabel =
    selectedProject ? `${selectedProject.name} ${selectedProject.path}` : null
  const projectPath =
    projectSelection === CUSTOM_PROJECT_OPTION ? customProjectPath.trim() : selectedProject?.path ?? ""
  const activeTargetState = scope === "global" ? globalTargetState : projectTargetState
  const activeTarget = activeTargetState.value
  const globalScopeDisabled =
    !editor?.supportsGlobal || globalTargetState.value?.status === "unsupported"
  const projectScopeDisabled = !editor?.supportsProject
  const canInstall = (activeTarget?.status === "ready" || (activeTarget?.status === "conflict" && item.type === "skill")) && !isInstalling

  useEffect(() => {
    if (!open) {
      return
    }

    setScope(editor?.supportsGlobal ? "global" : "project")
    setProjectSelection(projects[0]?.id ?? CUSTOM_PROJECT_OPTION)
    setCustomProjectPath("")
    setGlobalTargetState(createIdleTargetState())
    setProjectTargetState(createIdleTargetState())
    setInstallError(null)
    setIsInstalling(false)
    setIsOverwriteConfirmOpen(false)
    setIsConflictConfirmOpen(false)
    setIsCursorFrontmatterOpen(false)
    setCursorFrontmatterDefaults(null)
  }, [editor?.id, open, projects])

  useEffect(() => {
    if (!open || !editor?.supportsGlobal) {
      return
    }

    let cancelled = false

    setGlobalTargetState({
      error: null,
      isLoading: true,
      value: null,
    })

    void resolveEditorInstallTarget({
      editorId: editor.id,
      scope: "global",
      contentId: item.id,
      contentType: item.type,
      skillName: item.type === "skill" ? item.name : undefined,
      skillTitle: item.type === "skill" ? item.title : undefined,
    })
      .then((value) => {
        if (cancelled) {
          return
        }

        setGlobalTargetState({
          error: null,
          isLoading: false,
          value,
        })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setGlobalTargetState({
          error: error instanceof Error ? error.message : "解析全局安装位置失败。",
          isLoading: false,
          value: null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [editor?.id, editor?.supportsGlobal, item.id, item.type, open])

  useEffect(() => {
    if (!open || !editor?.supportsProject) {
      return
    }

    if (!projectPath) {
      setProjectTargetState(createIdleTargetState())
      return
    }

    let cancelled = false

    setProjectTargetState({
      error: null,
      isLoading: true,
      value: null,
    })

    void resolveEditorInstallTarget({
      editorId: editor.id,
      scope: "project",
      contentId: item.id,
      contentType: item.type,
      projectPath,
      skillName: item.type === "skill" ? item.name : undefined,
      skillTitle: item.type === "skill" ? item.title : undefined,
    })
      .then((value) => {
        if (cancelled) {
          return
        }

        setProjectTargetState({
          error: null,
          isLoading: false,
          value,
        })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        setProjectTargetState({
          error: error instanceof Error ? error.message : "解析项目安装位置失败。",
          isLoading: false,
          value: null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [editor?.id, editor?.supportsProject, item.id, item.type, open, projectPath])

  useEffect(() => {
    if (scope === "global" && globalScopeDisabled && editor?.supportsProject) {
      setScope("project")
    }
  }, [editor?.supportsProject, globalScopeDisabled, scope])

  const handleBrowseDirectory = async () => {
    const bridge = window.synapse?.repository

    if (!bridge) {
      return
    }

    logger.info("Opening native directory picker from install dialog.", {
      editorId: editor?.id ?? null,
      contentId: item.id,
      contentType: item.type,
    })

    const selectedPath = await bridge.chooseDirectory()

    if (!selectedPath) {
      return
    }

    setProjectSelection(CUSTOM_PROJECT_OPTION)
    setCustomProjectPath(selectedPath)
  }

  const runInstall = async (cursorFrontmatter?: CursorRuleFrontmatter, replaceConfirmed?: boolean) => {
    if (!editor) {
      return
    }

    if (scope === "project" && !projectPath) {
      setInstallError("先选择一个项目目录。")
      return
    }

    if (!activeTarget || (activeTarget.status !== "ready" && activeTarget.status !== "conflict")) {
      setInstallError("当前还没有可用的安装目标。")
      return
    }

    setInstallError(null)
    setIsInstalling(true)

    try {
      const result = await promise(
        () => installToEditor({
          editorId: editor.id,
          scope,
          contentId: item.id,
          contentType: item.type,
          projectPath: scope === "project" ? projectPath : undefined,
          skillName: item.type === "skill" ? item.name : undefined,
          skillTitle: item.type === "skill" ? item.title : undefined,
          cursorFrontmatter,
          replaceConfirmed,
        }),
        {
          loading: `正在安装到 ${editor.label}...`,
          success: (value) => `已写入 ${value.targetPath}${replaceConfirmed ? "（旧 Skill 已备份为 -backup）" : ""}`,
          error: (error) => error instanceof Error ? error.message : "安装失败。",
        },
      )

      logger.info("Content installed from renderer.", {
        contentId: item.id,
        contentType: item.type,
        editorId: editor.id,
        scope,
        targetPath: result.targetPath,
      })
      setIsCursorFrontmatterOpen(false)
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : "安装失败。"

      logger.error("Content install failed from renderer.", {
        contentId: item.id,
        contentType: item.type,
        editorId: editor.id,
        error,
      })

      setInstallError(message)
    } finally {
      setIsInstalling(false)
    }
  }

  const openCursorFrontmatterDialog = async () => {
    if (!activeTarget || activeTarget.status !== "ready") {
      setInstallError("当前还没有可用的安装目标。")
      return
    }

    setInstallError(null)
    setIsInstalling(true)

    try {
      const { frontmatter: existing } = await peekCursorFrontmatter({
        targetPath: activeTarget.targetPath,
      })

      setCursorFrontmatterDefaults(
        existing ?? {
          alwaysApply: false,
          description: item.description ?? "",
          globs: "",
        },
      )
      setIsCursorFrontmatterOpen(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取现有规则元数据失败。"

      logger.error("Failed to peek Cursor frontmatter.", {
        contentId: item.id,
        error,
        targetPath: activeTarget.targetPath,
      })

      setInstallError(message)
    } finally {
      setIsInstalling(false)
    }
  }

  const handleInstall = async () => {
    if (definition.install.kind === "directory-overwrite") {
      if (!activeTarget || activeTarget.status !== "ready") {
        setInstallError("当前还没有可用的安装目标。")
        return
      }

      setIsOverwriteConfirmOpen(true)
      return
    }

    // Check for Skill name conflict
    if (activeTarget?.status === "conflict" && item.type === "skill") {
      setIsConflictConfirmOpen(true)
      return
    }

    if (
      editor?.id === "cursor"
      && item.type === "rule"
      && scope === "project"
    ) {
      await openCursorFrontmatterDialog()
      return
    }

    await runInstall()
  }

  if (!editor) {
    return null
  }

  return (
    <>
      {cursorFrontmatterDefaults ? (
        <CursorFrontmatterDialog
          defaults={cursorFrontmatterDefaults}
          isSubmitting={isInstalling}
          onConfirm={(frontmatter) => {
            void runInstall(frontmatter)
          }}
          onOpenChange={(next) => {
            if (isInstalling) {
              return
            }

            setIsCursorFrontmatterOpen(next)
          }}
          open={isCursorFrontmatterOpen}
          targetPath={activeTarget?.status === "ready" ? activeTarget.targetPath : null}
        />
      ) : null}

      <AlertDialog open={isOverwriteConfirmOpen} onOpenChange={setIsOverwriteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认覆盖目标目录？</AlertDialogTitle>
            <AlertDialogDescription>
              {definition.install.kind === "directory-overwrite" ? definition.install.confirmMessage : ""}
            </AlertDialogDescription>
            {activeTarget?.status === "ready" ? (
              <div className="mt-1 rounded-md bg-muted/40 px-3 py-2 font-mono text-xs break-all text-muted-foreground">
                {activeTarget.targetPath}
              </div>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isInstalling}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isInstalling}
              onClick={() => {
                setIsOverwriteConfirmOpen(false)
                void runInstall()
              }}
            >
              继续安装
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isConflictConfirmOpen} onOpenChange={setIsConflictConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认替换 Skill？</AlertDialogTitle>
            <AlertDialogDescription>
              该位置已存在同名 Skill，替换后旧 Skill 将被备份为 <code className="text-xs bg-muted px-1 rounded">-backup</code> 目录，如需删除请手动清理。
            </AlertDialogDescription>
            {activeTarget?.status === "conflict" ? (
              <div className="mt-1 rounded-md bg-muted/40 px-3 py-2 font-mono text-xs break-all text-muted-foreground">
                {activeTarget.targetPath}
              </div>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isInstalling} autoFocus>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isInstalling}
              onClick={() => {
                setIsConflictConfirmOpen(false)
                void runInstall(undefined, true)
              }}
            >
              替换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>安装到 {editor.label}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <div className="flex justify-center">
              <Tabs
                value={scope}
                onValueChange={(value) => {
                  if (value === "global" || value === "project") {
                    setScope(value)
                  }
                }}
              >
                <TabsList>
                  <TabsTrigger value="global" disabled={globalScopeDisabled}>
                    全局
                  </TabsTrigger>
                  <TabsTrigger value="project" disabled={projectScopeDisabled}>
                    项目
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {scope === "project" ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="content-install-project">项目目录</Label>
                  <Select value={projectSelection} onValueChange={setProjectSelection}>
                    <SelectTrigger id="content-install-project" className="w-full">
                      <SelectValue placeholder="选择一个项目" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name} {project.path}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_PROJECT_OPTION}>浏览其他目录</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {projectSelection === CUSTOM_PROJECT_OPTION ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="content-install-project-path">目录路径</Label>
                    <div className="flex gap-2">
                      <Input
                        id="content-install-project-path"
                        value={customProjectPath}
                        onChange={(event) => setCustomProjectPath(event.target.value)}
                        placeholder="/path/to/project"
                      />
                      {hasDirectoryPicker ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            void handleBrowseDirectory()
                          }}
                        >
                          <FolderOpen data-icon="inline-start" />
                          浏览
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-lg border border-border bg-muted/20 px-3 py-3">
              <div className="flex flex-col gap-1 text-sm">
                <p className="font-medium text-foreground">目标位置</p>
                {activeTargetState.isLoading ? (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />
                    正在解析安装路径
                  </p>
                ) : activeTargetState.error ? (
                  <p className="text-destructive">{activeTargetState.error}</p>
                ) : activeTarget?.status === "ready" ? (
                  <>
                    <p className="break-all text-muted-foreground">{activeTarget.targetPath}</p>
                    <p className="text-xs text-muted-foreground">
                      {activeTarget.targetKind === "file"
                        ? "将写入单个文件。"
                        : `将写入 ${definition.singularLabel} 目录。`}
                    </p>
                  </>
                ) : activeTarget?.status === "conflict" ? (
                  <>
                    <p className="break-all text-muted-foreground">{activeTarget.targetPath}</p>
                    <p className="text-xs text-destructive">
                      该位置已存在同名 Skill，安装将替换旧 Skill（旧 Skill 会被备份）。
                    </p>
                  </>
                ) : activeTarget ? (
                  <p className="text-muted-foreground">
                    {activeTarget.message ?? "当前环境暂时不能安装到这个位置。"}
                  </p>
                ) : (
                  <p className="text-muted-foreground">先选择一个可用的安装范围。</p>
                )}
              </div>
            </div>

            {definition.install.kind === "directory-overwrite" ? (
              <p className="text-sm text-muted-foreground">{definition.install.confirmMessage}</p>
            ) : null}

            {installError ? <p className="text-sm text-destructive">{installError}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!canInstall}
              onClick={() => {
                void handleInstall()
              }}
            >
              {isInstalling ? <LoaderCircle className="animate-spin" /> : null}
              安装
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { ContentInstallDialog }
