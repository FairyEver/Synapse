import { useEffect, useMemo, useRef, useState } from "react"
import { FolderOpen, LoaderCircle } from "lucide-react"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
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
import type { SynapseContentType } from "@/types/content"
import type { SynapseProjectConfig } from "@/types/config"
import type {
  SynapseEditorAdapterSummary,
  SynapseEditorInstallScope,
  SynapseEditorResolvedTarget,
} from "@/types/editor"

const CUSTOM_PROJECT_OPTION = "__custom__"

type InstallTargetState = {
  error: string | null
  isLoading: boolean
  value: SynapseEditorResolvedTarget | null
}

type ResolveEditorTargetInput = {
  editorId: SynapseEditorAdapterSummary["id"]
  projectPath?: string
  scope: SynapseEditorInstallScope
}

type EditorWriteTargetSelection = {
  activeTarget: SynapseEditorResolvedTarget | null
  activeTargetState: InstallTargetState
  projectPath: string
  scope: SynapseEditorInstallScope
}

type EditorWriteTargetInitialSelection = {
  projectId?: string
  projectPath?: string
  scope: SynapseEditorInstallScope
}

type EditorWriteTargetSelectorProps = {
  actionKind: "install" | "copy"
  contentType: Extract<SynapseContentType, "rule" | "skill">
  editor: SynapseEditorAdapterSummary
  initialSelection?: EditorWriteTargetInitialSelection | null
  loggerName: string
  onError?: (message: string) => void
  onSelectionChange: (selection: EditorWriteTargetSelection) => void
  open: boolean
  projects: SynapseProjectConfig[]
  resolveTarget: (input: ResolveEditorTargetInput) => Promise<SynapseEditorResolvedTarget>
}

function createIdleTargetState(): InstallTargetState {
  return {
    error: null,
    isLoading: false,
    value: null,
  }
}

function createTargetSelectionKey(selection: EditorWriteTargetSelection): string {
  const target = selection.activeTarget
  const targetKey = target
    ? [
        target.status,
        target.editorId,
        target.label,
        target.scope,
        target.contentType,
        target.message ?? "",
        target.targetKind ?? "",
        target.targetPath ?? "",
        target.status === "ready" ? String(target.targetExists) : "",
        target.status === "conflict" ? target.conflictContentId : "",
      ].join("\u0000")
    : "none"

  return [
    selection.scope,
    selection.projectPath,
    selection.activeTargetState.error ?? "",
    String(selection.activeTargetState.isLoading),
    targetKey,
  ].join("\u0001")
}

function EditorWriteTargetSelector({
  actionKind,
  contentType,
  editor,
  initialSelection,
  loggerName,
  onError,
  onSelectionChange,
  open,
  projects,
  resolveTarget,
}: EditorWriteTargetSelectorProps) {
  const definition = getContentTypeDefinition(contentType)
  const copy = actionKind === "copy"
  const logger = useMemo(() => createRendererLogger(loggerName), [loggerName])
  const [scope, setScope] = useState<SynapseEditorInstallScope>("global")
  const [projectSelection, setProjectSelection] = useState<string>(CUSTOM_PROJECT_OPTION)
  const [customProjectPath, setCustomProjectPath] = useState("")
  const [globalTargetState, setGlobalTargetState] = useState<InstallTargetState>(createIdleTargetState)
  const [projectTargetState, setProjectTargetState] = useState<InstallTargetState>(createIdleTargetState)
  const lastSelectionKeyRef = useRef<string | null>(null)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const hasDirectoryPicker = Boolean(window.synapse?.repository)

  const selectedProject = projects.find((project) => project.id === projectSelection) ?? null
  const projectPath =
    projectSelection === CUSTOM_PROJECT_OPTION ? customProjectPath.trim() : selectedProject?.path ?? ""
  const activeTargetState = scope === "global" ? globalTargetState : projectTargetState
  const activeTarget = activeTargetState.value
  const globalScopeDisabled =
    !editor.supportsGlobal || globalTargetState.value?.status === "unsupported"
  const projectScopeDisabled = !editor.supportsProject

  useEffect(() => {
    if (!open) {
      return
    }

    const nextScope =
      initialSelection?.scope === "project" && editor.supportsProject
        ? "project"
        : initialSelection?.scope === "global" && editor.supportsGlobal
          ? "global"
          : editor.supportsGlobal ? "global" : "project"
    const initialProject = initialSelection?.projectId
      ? projects.find((project) => project.id === initialSelection.projectId)
      : null

    setScope(nextScope)
    if (initialProject) {
      setProjectSelection(initialProject.id)
      setCustomProjectPath("")
    } else if (initialSelection?.projectPath) {
      setProjectSelection(CUSTOM_PROJECT_OPTION)
      setCustomProjectPath(initialSelection.projectPath)
    } else {
      setProjectSelection(projects[0]?.id ?? CUSTOM_PROJECT_OPTION)
      setCustomProjectPath("")
    }
    setGlobalTargetState(createIdleTargetState())
    setProjectTargetState(createIdleTargetState())
  }, [
    editor.id,
    editor.supportsGlobal,
    editor.supportsProject,
    initialSelection?.projectId,
    initialSelection?.projectPath,
    initialSelection?.scope,
    open,
    projects,
  ])

  useEffect(() => {
    if (!open || !editor.supportsGlobal) {
      return
    }

    let cancelled = false
    const startedAt = performance.now()

    setGlobalTargetState({
      error: null,
      isLoading: true,
      value: null,
    })

    void resolveTarget({
      editorId: editor.id,
      scope: "global",
    })
      .then((value) => {
        if (cancelled) {
          return
        }

        logger.info("Resolved global editor target.", {
          editorId: editor.id,
          elapsedMs: Math.round(performance.now() - startedAt),
          status: value.status,
          targetKind: value.targetKind,
          targetPath: value.targetPath,
        })
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

        const message = error instanceof Error
          ? error.message
          : copy ? "解析全局复制位置失败。" : "解析全局安装位置失败。"
        logger.error("Failed to resolve global editor target.", {
          editorId: editor.id,
          elapsedMs: Math.round(performance.now() - startedAt),
          error,
        })
        setGlobalTargetState({
          error: message,
          isLoading: false,
          value: null,
        })
        onError?.(message)
      })

    return () => {
      cancelled = true
    }
  }, [copy, editor.id, editor.supportsGlobal, logger, onError, open, resolveTarget])

  useEffect(() => {
    if (!open || !editor.supportsProject) {
      return
    }

    if (!projectPath) {
      setProjectTargetState(createIdleTargetState())
      return
    }

    let cancelled = false
    const startedAt = performance.now()

    setProjectTargetState({
      error: null,
      isLoading: true,
      value: null,
    })

    void resolveTarget({
      editorId: editor.id,
      projectPath,
      scope: "project",
    })
      .then((value) => {
        if (cancelled) {
          return
        }

        logger.info("Resolved project editor target.", {
          editorId: editor.id,
          elapsedMs: Math.round(performance.now() - startedAt),
          projectPath,
          status: value.status,
          targetKind: value.targetKind,
          targetPath: value.targetPath,
        })
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

        const message = error instanceof Error
          ? error.message
          : copy ? "解析项目复制位置失败。" : "解析项目安装位置失败。"
        logger.error("Failed to resolve project editor target.", {
          editorId: editor.id,
          elapsedMs: Math.round(performance.now() - startedAt),
          error,
          projectPath,
        })
        setProjectTargetState({
          error: message,
          isLoading: false,
          value: null,
        })
        onError?.(message)
      })

    return () => {
      cancelled = true
    }
  }, [copy, editor.id, editor.supportsProject, logger, onError, open, projectPath, resolveTarget])

  useEffect(() => {
    if (scope === "global" && globalScopeDisabled && editor.supportsProject) {
      setScope("project")
    }
  }, [editor.supportsProject, globalScopeDisabled, scope])

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    const nextSelection = {
      activeTarget,
      activeTargetState,
      projectPath,
      scope,
    }
    const nextSelectionKey = createTargetSelectionKey(nextSelection)
    if (lastSelectionKeyRef.current === nextSelectionKey) {
      return
    }

    lastSelectionKeyRef.current = nextSelectionKey
    onSelectionChangeRef.current(nextSelection)
  }, [activeTarget, activeTargetState, onSelectionChange, projectPath, scope])

  const handleBrowseDirectory = async () => {
    const bridge = window.synapse?.repository

    if (!bridge) {
      return
    }

    try {
      const selectedPath = await bridge.chooseDirectory()

      if (!selectedPath) {
        return
      }

      setProjectSelection(CUSTOM_PROJECT_OPTION)
      setCustomProjectPath(selectedPath)
    } catch (error) {
      logger.error("Failed to choose editor target directory.", {
        editorId: editor.id,
        error,
      })
      onError?.("打开目录选择器失败。")
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-center">
        <Tabs
          data-track="install-scope"
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
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="editor-install-project">项目目录</Label>
            <Select
              data-track="install-project-select"
              value={projectSelection}
              onValueChange={setProjectSelection}
            >
              <SelectTrigger id="editor-install-project" className="w-full">
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
              <Label htmlFor="editor-install-project-path">目录路径</Label>
              <div className="flex gap-2">
                <Input
                  id="editor-install-project-path"
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
              {copy ? "正在解析复制路径" : "正在解析安装路径"}
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
                {copy
                  ? "该位置已存在同名 Skill，复制后会替换旧 Skill。"
                  : "该位置已存在同名 Skill，安装将替换旧 Skill（旧 Skill 会被备份）。"}
              </p>
            </>
          ) : activeTarget ? (
            <p className="text-muted-foreground">
              {activeTarget.message ?? (copy
                ? "当前环境暂时不能复制到这个位置。"
                : "当前环境暂时不能安装到这个位置。")}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {copy ? "先选择一个可用的复制范围。" : "先选择一个可用的安装范围。"}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export { EditorWriteTargetSelector }
export type {
  EditorWriteTargetInitialSelection,
  EditorWriteTargetSelection,
  ResolveEditorTargetInput,
}
