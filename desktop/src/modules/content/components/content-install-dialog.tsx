import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LoaderCircle } from "lucide-react"
import {
  installToEditor,
  readContent,
  resolveEditorInstallTarget,
} from "@/app-shell/content"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useActiveRepository, useRepositoryActions } from "@/app-shell/use-repository-manager"
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
  SynapseEditorAdapterSummary,
  SynapseEditorInstallFormValues,
} from "@/types/editor"
import { VariableSubstitutionDialog } from "./variable-substitution-dialog"
import { VariableSaveConfirmationDialog } from "./variable-save-confirmation-dialog"
import { detectPlaceholders } from "@/lib/variable-substitution"
import { installFormDefinitionByEditorId } from "@/definitions/generated/renderer-registry"
import {
  buildRepositoryVariableChangeSet,
  buildRepositoryVariablesPatch,
  hasRepositoryVariableChanges,
  type RepositoryVariableChangeSet,
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
  item: SynapseContentMeta
  onInstalled?: () => Promise<void> | void
  onOpenChange: (open: boolean) => void
  open: boolean
  projects: SynapseProjectConfig[]
}

async function detectInstallPlaceholders(
  preloadedContent: string | null,
  readCurrentContent: () => Promise<string>,
): Promise<string[]> {
  const content = preloadedContent ?? await readCurrentContent()
  return detectPlaceholders(content)
}

function ContentInstallDialog({
  editor,
  initialSelection,
  item,
  onInstalled,
  onOpenChange,
  open,
  projects,
}: ContentInstallDialogProps) {
  const definition = getContentTypeDefinition(item.type)
  const logger = useMemo(
    () => createRendererLogger(`content.install.${item.type}`),
    [item.type],
  )
  const { promise, warning } = useAppNotifications()
  const activeRepository = useActiveRepository()
  const { updateRepository } = useRepositoryActions()
  const [preloadedContent, setPreloadedContent] = useState<string | null>(null)
  const [isVariableConfirmOpen, setIsVariableConfirmOpen] = useState(false)
  const [isVariableSaveConfirmOpen, setIsVariableSaveConfirmOpen] = useState(false)
  const [detectedPlaceholders, setDetectedPlaceholders] = useState<string[]>([])
  const [pendingVariableChanges, setPendingVariableChanges] =
    useState<RepositoryVariableChangeSet | null>(null)
  const [isSavingVariables, setIsSavingVariables] = useState(false)
  const pendingSubstitutionsRef = useRef<Record<string, string> | undefined>(undefined)
  const variableConfirmPassedRef = useRef(false)
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
    setPreloadedContent(null)
    setIsVariableConfirmOpen(false)
    setIsVariableSaveConfirmOpen(false)
    setDetectedPlaceholders([])
    setPendingVariableChanges(null)
    setIsSavingVariables(false)
    pendingSubstitutionsRef.current = undefined
    variableConfirmPassedRef.current = false
    skipVariableSaveLockRef.current = false
  }, [editor?.id, open])

  useEffect(() => {
    if (!open) return

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
  }, [item.id, item.type, open])

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
    replaceConfirmed?: boolean,
  ) => {
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
      replaceConfirmed: Boolean(replaceConfirmed),
      scope,
      targetPath: activeTarget.targetPath,
    })

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
          replaceConfirmed,
          variableSubstitutions: pendingSubstitutionsRef.current,
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
        elapsedMs: Math.round(performance.now() - startedAt),
        editorId: editor.id,
        replaceConfirmed: Boolean(replaceConfirmed),
        scope,
        targetPath: result.targetPath,
      })
      await onInstalled?.()
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
    const filtered = Object.fromEntries(
      Object.entries(substitutions).filter(([, v]) => v.length > 0),
    )
    pendingSubstitutionsRef.current = Object.keys(filtered).length > 0 ? filtered : undefined
    variableConfirmPassedRef.current = true

    if (activeRepository) {
      const changes = buildRepositoryVariableChangeSet(activeRepository, substitutions)

      if (hasRepositoryVariableChanges(changes)) {
        setPendingVariableChanges(changes)
        setIsVariableConfirmOpen(false)
        setIsVariableSaveConfirmOpen(true)
        return
      }
    }

    setIsVariableConfirmOpen(false)
    await handleInstall()
  }

  const continueInstallAfterVariableSaveDecision = async () => {
    setIsVariableSaveConfirmOpen(false)
    setPendingVariableChanges(null)
    await handleInstall()
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
      if (activeRepository && pendingVariableChanges) {
        const patch = buildRepositoryVariablesPatch(activeRepository, pendingVariableChanges)
        if (patch) {
          await updateRepository(activeRepository.uuid, patch)
        }
      }
    } catch (error) {
      logger.warn("Failed to save variables to repository.", { error })
      warning("变量未保存，安装会继续。")
    } finally {
      setIsSavingVariables(false)
    }

    await continueInstallAfterVariableSaveDecision()
  }

  const handleInstall = async () => {
    if (!variableConfirmPassedRef.current) {
      try {
        const placeholders = await detectInstallPlaceholders(preloadedContent, async () => {
          const file = await readContent(item.type, item.id)
          setPreloadedContent(file.content)
          return file.content
        })
        if (placeholders.length > 0) {
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

    if (activeTarget.status === "conflict" && item.type === "skill") {
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

    if (definition.install.kind === "directory-overwrite" && activeTarget.status === "ready" && activeTarget.targetExists) {
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

    await runInstall()
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
        repositoryVariables={activeRepository?.variables ?? []}
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

export { ContentInstallDialog, detectInstallPlaceholders }
