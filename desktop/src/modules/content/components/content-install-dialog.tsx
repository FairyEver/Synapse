import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LoaderCircle } from "lucide-react"
import {
  installToEditor,
  readContent,
  resolveEditorInstallTarget,
} from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
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
import { getContentTypeDefinition } from "@/config/content-types"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseContentMeta } from "@/types/content"
import type {
  SynapseContentInstallResult,
  SynapseEditorAdapterSummary,
  SynapseEditorInstallFormValues,
} from "@/types/editor"
import { VariableSubstitutionDialog } from "./variable-substitution-dialog"
import { VariableSaveConfirmationDialog } from "./variable-save-confirmation-dialog"
import { detectPlaceholders } from "@/lib/variable-substitution"
import { installFormDefinitionByEditorId } from "@/definitions/generated/renderer-registry"
import {
  buildUserVariableChangeSet,
  buildUserVariablesPatch,
  hasUserVariableChanges,
  type UserVariableChangeSet,
} from "@/modules/content/lib/repository-variables"
import {
  EditorWriteTargetSelector,
  type EditorWriteTargetInitialSelection,
  type EditorWriteTargetSelection,
  type ResolveEditorTargetInput,
} from "./editor-write-target-selector"

type ContentInstallDialogProps = {
  editor: SynapseEditorAdapterSummary | null
  initialSelection?: EditorWriteTargetInitialSelection | null
  initialContent?: string | null
  item: SynapseContentMeta
  onInstalled?: () => Promise<void> | void
  onOpenChange: (open: boolean) => void
  open: boolean
  preparedSourceId?: string
  projects: SynapseProjectConfig[]
}

type InstallFlowOptions = {
  overwriteConfirmed?: boolean
  replaceConfirmed?: boolean
}

async function detectInstallPlaceholders(
  preloadedContent: string | null,
  readCurrentContent: () => Promise<string>,
): Promise<string[]> {
  const content = preloadedContent ?? await readCurrentContent()
  return detectPlaceholders(content, { includeCodeBlocks: true })
}

function ContentInstallDialog({
  editor,
  initialContent,
  initialSelection,
  item,
  onInstalled,
  onOpenChange,
  open,
  preparedSourceId,
  projects,
}: ContentInstallDialogProps) {
  const definition = getContentTypeDefinition(item.type)
  const logger = useMemo(
    () => createRendererLogger(`content.install.${item.type}`),
    [item.type],
  )
  const { promise, warning } = useAppNotifications()
  const { config, updateConfig } = useAppConfig()
  const userVariables = config.global.variables
  const [preloadedContent, setPreloadedContent] = useState<string | null>(null)
  const [isVariableConfirmOpen, setIsVariableConfirmOpen] = useState(false)
  const [isVariableSaveConfirmOpen, setIsVariableSaveConfirmOpen] = useState(false)
  const [detectedPlaceholders, setDetectedPlaceholders] = useState<string[]>([])
  const [pendingVariableChanges, setPendingVariableChanges] =
    useState<UserVariableChangeSet | null>(null)
  const [isSavingVariables, setIsSavingVariables] = useState(false)
  const pendingSubstitutionsRef = useRef<Record<string, string> | undefined>(undefined)
  const variableConfirmPassedRef = useRef(false)
  const pendingInstallOptionsRef = useRef<InstallFlowOptions>({})
  const skipVariableSaveLockRef = useRef(false)
  const [selection, setSelection] = useState<EditorWriteTargetSelection | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const [isOverwriteConfirmOpen, setIsOverwriteConfirmOpen] = useState(false)
  const [isConflictConfirmOpen, setIsConflictConfirmOpen] = useState(false)
  const [isRuleProjectInstallFormOpen, setIsRuleProjectInstallFormOpen] = useState(false)
  const [isRuleGlobalInstallFormOpen, setIsRuleGlobalInstallFormOpen] = useState(false)

  const scope = selection?.scope ?? "global"
  const projectPath = selection?.projectPath ?? ""
  const activeTarget = selection?.activeTarget ?? null
  const canInstall = (activeTarget?.status === "ready" || (activeTarget?.status === "conflict" && item.type === "skill")) && !isInstalling
  const installFormDefinition = editor ? installFormDefinitionByEditorId.get(editor.id) : undefined
  const RuleProjectInstallForm = installFormDefinition?.RuleProjectInstallForm
  const RuleGlobalInstallForm = installFormDefinition?.RuleGlobalInstallForm

  useEffect(() => {
    if (!open) {
      return
    }

    setSelection(null)
    setInstallError(null)
    setIsInstalling(false)
    setIsOverwriteConfirmOpen(false)
    setIsConflictConfirmOpen(false)
    setIsRuleProjectInstallFormOpen(false)
    setIsRuleGlobalInstallFormOpen(false)
    setPreloadedContent(initialContent ?? null)
    setIsVariableConfirmOpen(false)
    setIsVariableSaveConfirmOpen(false)
    setDetectedPlaceholders([])
    setPendingVariableChanges(null)
    setIsSavingVariables(false)
    pendingSubstitutionsRef.current = undefined
    variableConfirmPassedRef.current = false
    pendingInstallOptionsRef.current = {}
    skipVariableSaveLockRef.current = false
  }, [editor?.id, initialContent, open])

  useEffect(() => {
    if (!open) return
    if (initialContent !== undefined) {
      setPreloadedContent(initialContent ?? null)
      return
    }

    let cancelled = false

    void readContent(item.type, item.id)
      .then((file) => {
        if (!cancelled) setPreloadedContent(file.content)
      })
      .catch((preloadError) => {
        if (!cancelled) {
          logger.warn("Failed to preload content for install.", {
            contentId: item.id,
            error: preloadError,
          })
          warning("内容预加载失败，安装时将重新读取")
        }
      })

    return () => { cancelled = true }
  }, [initialContent, item.id, item.type, open])

  const resolveInstallTarget = useCallback((input: ResolveEditorTargetInput) => (
    resolveEditorInstallTarget({
      editorId: input.editorId,
      scope: input.scope,
      contentId: item.id,
      contentType: item.type,
      projectPath: input.scope === "project" ? input.projectPath : undefined,
      skillName: item.type === "skill" ? item.name : undefined,
      skillTitle: item.type === "skill" ? item.title : undefined,
      ruleName: item.type === "rule" ? item.name : undefined,
    })
  ), [item.id, item.name, item.title, item.type])

  const runInstall = async (
    installFormValues?: SynapseEditorInstallFormValues,
    options: InstallFlowOptions = {},
  ) => {
    const overwriteConfirmed = Boolean(options.overwriteConfirmed)
    const replaceConfirmed = Boolean(options.replaceConfirmed)

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
    const startedAt = performance.now()

    logger.info("Content install initiated from renderer.", {
      contentId: item.id,
      contentType: item.type,
      editorId: editor.id,
      hasInstallFormValues: Boolean(installFormValues),
      hasVariableSubstitutions: Boolean(pendingSubstitutionsRef.current),
      overwriteConfirmed,
      replaceConfirmed,
      scope,
      targetPath: activeTarget.targetPath,
    })

    const replacedContentId = activeTarget.status === "conflict" && replaceConfirmed
      ? activeTarget.conflictContentId
      : undefined

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
          ruleName: item.type === "rule" ? item.name : undefined,
          installFormValues,
          overwriteConfirmed,
          replaceConfirmed,
          replacedContentId,
          preparedSourceId,
          variableSubstitutions: pendingSubstitutionsRef.current,
        }),
        {
          loading: `正在安装到 ${editor.label}...`,
          success: (value: SynapseContentInstallResult) => {
            const base = `已写入 ${value.targetPath}${replaceConfirmed ? "（旧 Skill 已移到桌面备份）" : ""}`
            return value.warning ? `${base}（${value.warning}）` : base
          },
          error: (error) => error instanceof Error ? error.message : "安装失败。",
        },
      )

      logger.info("Content installed from renderer.", {
        contentId: item.id,
        contentType: item.type,
        elapsedMs: Math.round(performance.now() - startedAt),
        editorId: editor.id,
        replaceConfirmed: Boolean(replaceConfirmed),
        scope,
        targetPath: result.targetPath,
      })
      try {
        await onInstalled?.()
      } catch (refreshError) {
        setInstallError("本地已写入，但安装完成记录失败，请重试。")
        logger.warn("Post-install refresh failed; install itself succeeded.", {
          contentId: item.id,
          contentType: item.type,
          editorId: editor.id,
          error: refreshError,
        })
        return
      }
      setIsRuleProjectInstallFormOpen(false)
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : "安装失败。"

      logger.error("Content install failed from renderer.", {
        contentId: item.id,
        contentType: item.type,
        elapsedMs: Math.round(performance.now() - startedAt),
        editorId: editor.id,
        error,
        overwriteConfirmed,
        replaceConfirmed: Boolean(replaceConfirmed),
        scope,
        targetPath: activeTarget.targetPath,
      })

      setInstallError(message)
    } finally {
      setIsInstalling(false)
    }
  }

  const handleInstallFormError = useCallback((message: string) => {
    setInstallError(message)
  }, [])

  const handleVariableConfirm = async (
    substitutions: Record<string, string>,
  ) => {
    const installOptions = pendingInstallOptionsRef.current
    const filtered = Object.fromEntries(
      Object.entries(substitutions).filter(([, v]) => v.length > 0),
    )
    pendingSubstitutionsRef.current = Object.keys(filtered).length > 0 ? filtered : undefined
    variableConfirmPassedRef.current = true

    const changes = buildUserVariableChangeSet(userVariables, substitutions)

    if (hasUserVariableChanges(changes)) {
      setPendingVariableChanges(changes)
      setIsVariableConfirmOpen(false)
      setIsVariableSaveConfirmOpen(true)
      return
    }

    setIsVariableConfirmOpen(false)
    await handleInstall(installOptions)
  }

  const continueInstallAfterVariableSaveDecision = async () => {
    const installOptions = pendingInstallOptionsRef.current
    setIsVariableSaveConfirmOpen(false)
    setPendingVariableChanges(null)
    await handleInstall(installOptions)
  }

  const handleSkipVariableSave = async () => {
    if (skipVariableSaveLockRef.current) return
    skipVariableSaveLockRef.current = true
    await continueInstallAfterVariableSaveDecision()
  }

  const handleSaveVariableChanges = async () => {
    if (isSavingVariables) {
      return
    }

    setIsSavingVariables(true)
    try {
      if (pendingVariableChanges) {
        const patch = buildUserVariablesPatch(userVariables, pendingVariableChanges)
        if (patch) {
          await updateConfig(patch)
        }
      }
    } catch (error) {
      logger.warn("Failed to save user variables.", { error })
      warning("变量未保存，安装会继续。")
    } finally {
      setIsSavingVariables(false)
    }

    await continueInstallAfterVariableSaveDecision()
  }

  const resetVariableInstallAttempt = () => {
    pendingSubstitutionsRef.current = undefined
    variableConfirmPassedRef.current = false
    pendingInstallOptionsRef.current = {}
    setPendingVariableChanges(null)
  }

  const handleInstall = async (options: InstallFlowOptions = {}) => {
    const overwriteConfirmed = Boolean(options.overwriteConfirmed)
    const replaceConfirmed = Boolean(options.replaceConfirmed)

    if (!variableConfirmPassedRef.current) {
      try {
        const placeholders = await detectInstallPlaceholders(preloadedContent, async () => {
          if (initialContent !== undefined) {
            return initialContent ?? ""
          }
          const file = await readContent(item.type, item.id)
          setPreloadedContent(file.content)
          return file.content
        })
        if (placeholders.length > 0) {
          pendingInstallOptionsRef.current = options
          setDetectedPlaceholders(placeholders)
          setIsVariableConfirmOpen(true)
          return
        }
      } catch (error) {
        logger.warn("Failed to read content before install.", {
          contentId: item.id,
          error,
        })
        setInstallError("读取内容失败，请稍后重试。")
        return
      }
    }

    if (!activeTarget || !canInstall) {
      setInstallError("当前还没有可用的安装目标。")
      return
    }

    if (activeTarget.status === "conflict" && item.type === "skill" && !replaceConfirmed) {
      logger.info("Skill conflict confirm dialog opened.", {
        contentId: item.id,
        contentType: item.type,
        editorId: editor?.id ?? null,
        scope,
        targetPath: activeTarget.targetPath,
      })
      setIsConflictConfirmOpen(true)
      return
    }

    if (definition.install.kind === "directory-overwrite" && activeTarget.status === "ready" && activeTarget.targetExists && !overwriteConfirmed) {
      logger.info("Overwrite confirm dialog opened.", {
        contentId: item.id,
        contentType: item.type,
        editorId: editor?.id ?? null,
        scope,
        targetPath: activeTarget.targetPath,
      })
      setIsOverwriteConfirmOpen(true)
      return
    }

    if (item.type === "rule" && scope === "global" && RuleGlobalInstallForm) {
      if (activeTarget.status !== "ready") {
        setInstallError("当前还没有可用的安装目标。")
        return
      }

      setInstallError(null)
      setIsRuleGlobalInstallFormOpen(true)
      return
    }

    if (item.type === "rule" && scope === "project" && RuleProjectInstallForm) {
      if (activeTarget.status !== "ready") {
        setInstallError("当前还没有可用的安装目标。")
        return
      }

      setInstallError(null)
      setIsRuleProjectInstallFormOpen(true)
      return
    }

    await runInstall(undefined, { overwriteConfirmed, replaceConfirmed })
  }

  if (!editor) {
    return null
  }

  return (
    <>
      <VariableSubstitutionDialog
        open={isVariableConfirmOpen}
        onOpenChange={(next) => {
          if (!next) {
            variableConfirmPassedRef.current = false
          }
          setIsVariableConfirmOpen(next)
        }}
        placeholders={detectedPlaceholders}
        variables={userVariables}
        onConfirm={handleVariableConfirm}
      />
      <VariableSaveConfirmationDialog
        changes={pendingVariableChanges}
        isSubmitting={isSavingVariables || isInstalling}
        onOpenChange={(next) => {
          if (!next) {
            setPendingVariableChanges(null)
            variableConfirmPassedRef.current = false
          }
          setIsVariableSaveConfirmOpen(next)
        }}
        onSave={handleSaveVariableChanges}
        onSkip={handleSkipVariableSave}
        open={isVariableSaveConfirmOpen}
      />

      {RuleGlobalInstallForm && item.type === "rule" ? (
        <RuleGlobalInstallForm
          editorId={editor.id}
          item={item}
          isSubmitting={isInstalling}
          onConfirm={(values) => {
            logger.info("Rule global install form confirmed.", {
              contentId: item.id,
              contentType: item.type,
              editorId: editor.id,
              scope,
              targetPath: activeTarget?.status === "ready" ? activeTarget.targetPath : null,
            })
            void runInstall(values)
          }}
          onError={handleInstallFormError}
          onOpenChange={(next) => {
            if (isInstalling) {
              return
            }
            setIsRuleGlobalInstallFormOpen(next)
          }}
          open={isRuleGlobalInstallFormOpen}
          target={activeTarget?.status === "ready" ? activeTarget : null}
        />
      ) : null}

      {RuleProjectInstallForm && item.type === "rule" ? (
        <RuleProjectInstallForm
          editorId={editor.id}
          item={item}
          isSubmitting={isInstalling}
          onConfirm={(values) => {
            logger.info("Rule project install form confirmed.", {
              contentId: item.id,
              contentType: item.type,
              editorId: editor.id,
              scope,
              targetPath: activeTarget?.status === "ready" ? activeTarget.targetPath : null,
            })
            void runInstall(values)
          }}
          onError={handleInstallFormError}
          onOpenChange={(next) => {
            if (isInstalling) {
              return
            }
            setIsRuleProjectInstallFormOpen(next)
          }}
          open={isRuleProjectInstallFormOpen}
          target={activeTarget?.status === "ready" ? activeTarget : null}
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
            <AlertDialogCancel
              disabled={isInstalling}
              onClick={() => {
                resetVariableInstallAttempt()
                setIsOverwriteConfirmOpen(false)
              }}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isInstalling}
              onClick={() => {
                setIsOverwriteConfirmOpen(false)
                void handleInstall({ overwriteConfirmed: true })
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
              该位置已存在同名 Skill，替换后旧 Skill 将移到桌面，名称为 <code className="text-xs bg-muted px-1 rounded">原名称-synapse备份</code>。
            </AlertDialogDescription>
            {activeTarget?.status === "conflict" ? (
              <div className="mt-1 rounded-md bg-muted/40 px-3 py-2 font-mono text-xs break-all text-muted-foreground">
                {activeTarget.targetPath}
              </div>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isInstalling}
              autoFocus
              onClick={() => {
                resetVariableInstallAttempt()
                setIsConflictConfirmOpen(false)
              }}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isInstalling}
              onClick={() => {
                setIsConflictConfirmOpen(false)
                void handleInstall({ replaceConfirmed: true })
              }}
            >
              替换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && isInstalling) return
          onOpenChange(nextOpen)
        }}
        data-track="content-install-dialog"
      >
        <DialogContent
          className="sm:max-w-lg"
          onEscapeKeyDown={(event) => {
            if (isInstalling) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (isInstalling) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>安装到 {editor.label}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            {item.type === "rule" || item.type === "skill" ? (
              <EditorWriteTargetSelector
                actionKind="install"
                contentType={item.type}
                editor={editor}
                initialSelection={initialSelection}
                loggerName={`content.install.${item.type}`}
                onError={setInstallError}
                onSelectionChange={setSelection}
                open={open}
                projects={projects}
                resolveTarget={resolveInstallTarget}
              />
            ) : null}

            {definition.install.kind === "directory-overwrite" ? (
              <p className="text-sm text-muted-foreground">{definition.install.confirmMessage}</p>
            ) : null}

            {installError ? <p className="text-sm text-destructive">{installError}</p> : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isInstalling}
              onClick={() => {
                if (!isInstalling) onOpenChange(false)
              }}
            >
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

export { ContentInstallDialog, detectInstallPlaceholders }
