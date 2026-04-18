import { useEffect, useMemo, useState } from "react"
import { FolderOpen, LoaderCircle } from "lucide-react"
import {
  installToEditor,
  resolveEditorInstallTarget,
} from "@/app-shell/content"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseContentMeta } from "@/types/content"
import type {
  SynapseEditorAdapterSummary,
  SynapseEditorResolvedTarget,
} from "@/types/editor"

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
  const logger = useMemo(
    () => createRendererLogger(`content.install.${item.type}`),
    [item.type],
  )
  const [scope, setScope] = useState<"global" | "project">("global")
  const [projectSelection, setProjectSelection] = useState<string>(CUSTOM_PROJECT_OPTION)
  const [customProjectPath, setCustomProjectPath] = useState("")
  const [globalTargetState, setGlobalTargetState] = useState<InstallTargetState>(createIdleTargetState)
  const [projectTargetState, setProjectTargetState] = useState<InstallTargetState>(createIdleTargetState)
  const [installError, setInstallError] = useState<string | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const hasDirectoryPicker = Boolean(window.synapse?.repository)

  const selectedProject = projects.find((project) => project.id === projectSelection) ?? null
  const projectPath =
    projectSelection === CUSTOM_PROJECT_OPTION ? customProjectPath.trim() : selectedProject?.path ?? ""
  const activeTargetState = scope === "global" ? globalTargetState : projectTargetState
  const activeTarget = activeTargetState.value
  const globalScopeDisabled =
    !editor?.supportsGlobal || globalTargetState.value?.status === "unsupported"
  const projectScopeDisabled = !editor?.supportsProject
  const canInstall = activeTarget?.status === "ready" && !isInstalling

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

  const handleInstall = async () => {
    if (!editor) {
      return
    }

    if (scope === "project" && !projectPath) {
      setInstallError("先选择一个项目目录。")
      return
    }

    if (!activeTarget || activeTarget.status !== "ready") {
      setInstallError("当前还没有可用的安装目标。")
      return
    }

    if (item.type === "skill") {
      const confirmed = window.confirm(
        `安装 Skill 会整体替换目标目录中的现有内容。\n\n目标位置：${activeTarget.targetPath}\n\n确认继续吗？`,
      )

      if (!confirmed) {
        return
      }
    }

    setInstallError(null)
    setIsInstalling(true)

    try {
      const result = await installToEditor({
        editorId: editor.id,
        scope,
        contentId: item.id,
        contentType: item.type,
        projectPath: scope === "project" ? projectPath : undefined,
      })

      logger.info("Content installed from renderer.", {
        contentId: item.id,
        contentType: item.type,
        editorId: editor.id,
        scope,
        targetPath: result.targetPath,
      })

      window.setTimeout(() => {
        window.alert(`安装成功。\n已写入目标位置：\n${result.targetPath}`)
      }, 0)
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

  if (!editor) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>安装到 {editor.label}</DialogTitle>
          <DialogDescription>
            选择安装范围，然后确认写入目标位置。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={scope === "global" ? "secondary" : "outline"}
              disabled={globalScopeDisabled}
              onClick={() => setScope("global")}
            >
              安装到全局
            </Button>
            <Button
              type="button"
              variant={scope === "project" ? "secondary" : "outline"}
              disabled={projectScopeDisabled}
              onClick={() => setScope("project")}
            >
              安装到项目
            </Button>
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
                        {project.name}
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
              ) : selectedProject ? (
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                  {selectedProject.path}
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
                    {activeTarget.targetKind === "file" ? "将写入单个文件。" : "将写入技能目录。"}
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

          {item.type === "skill" ? (
            <p className="text-sm text-muted-foreground">
              安装 Skill 时会整体替换目标目录中的现有内容。
            </p>
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
  )
}

export { ContentInstallDialog }
