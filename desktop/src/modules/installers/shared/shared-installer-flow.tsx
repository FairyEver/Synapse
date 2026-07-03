import { useCallback, useRef, useState, type ReactNode } from "react"

import { readContent, resolveEditorInstallTarget } from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { installSourceToEditor } from "@/app-shell/installers"
import { EditorIcon } from "@/components/editor-icon"
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
import { installFormDefinitionByEditorId } from "@/definitions/generated/renderer-registry"
import {
  VariableSaveConfirmationDialog,
} from "@/modules/content/components/variable-save-confirmation-dialog"
import {
  VariableSubstitutionDialog,
} from "@/modules/content/components/variable-substitution-dialog"
import {
  EditorWriteTargetSelector,
  type EditorWriteTargetInitialSelection,
  type EditorWriteTargetSelection,
  type ResolveEditorTargetInput,
} from "@/modules/content/components/editor-write-target-selector"
import {
  buildUserVariableChangeSet,
  buildUserVariablesPatch,
  hasUserVariableChanges,
  type UserVariableChangeSet,
} from "@/modules/content/lib/repository-variables"
import type { SynapseProjectConfig } from "@/types/config"
import type {
  SynapseEditorAdapterSummary,
  SynapseEditorInstallFormValues,
} from "@/types/editor"
import type {
  SynapseInstallerKind,
  SynapseInstallerSource,
} from "@/types/installers"
import { detectPlaceholders } from "@/lib/variable-substitution"
import { useAppNotifications } from "@/app-shell/notifications"

import {
  type InstallerFlowMode,
  useInstallerFlow,
} from "./use-installer-flow"

type SharedInstallerFlowRenderSourceInputArgs = {
  onSourceReady: (source: SynapseInstallerSource) => void
}

export type SharedInstallerFlowProps = {
  editors: SynapseEditorAdapterSummary[]
  initialEditor?: SynapseEditorAdapterSummary | null
  initialSelection?: EditorWriteTargetInitialSelection | null
  kind?: SynapseInstallerKind
  mode: InstallerFlowMode
  onCancel: () => void
  onInstall?: (state: {
    editor: SynapseEditorAdapterSummary
    source: SynapseInstallerSource
  }) => Promise<void> | void
  onInstalled: () => Promise<void> | void
  projects: SynapseProjectConfig[]
  renderSourceInput?: (args: SharedInstallerFlowRenderSourceInputArgs) => ReactNode
  source?: SynapseInstallerSource
}

type InstallFlowOptions = {
  overwriteConfirmed?: boolean
  replaceConfirmed?: boolean
}

function getKindLabel(kind: SynapseInstallerKind | undefined) {
  if (kind === "skill") {
    return "Skill"
  }
  if (kind === "rule") {
    return "Rule"
  }
  return "内容"
}

async function readInstallerSourceContent(source: SynapseInstallerSource): Promise<string> {
  if (source.kind === "rule") {
    if (source.body !== undefined) return source.body
    if (source.origin === "repository") {
      return (await readContent("rule", source.repositoryContentId ?? source.sourceIdentity)).content
    }
    throw new Error("Rule 安装源正文不可用。")
  }

  if (source.mainContent !== undefined) return source.mainContent
  if (source.origin === "repository") {
    return (await readContent("skill", source.repositoryContentId ?? source.sourceIdentity)).content
  }
  throw new Error("Skill 安装源正文不可用。")
}

export function SharedInstallerFlow({
  editors,
  initialEditor,
  initialSelection,
  kind,
  mode,
  onCancel,
  onInstall,
  onInstalled,
  projects,
  renderSourceInput,
  source: initialSource,
}: SharedInstallerFlowProps) {
  const { config, updateConfig } = useAppConfig()
  const { warning } = useAppNotifications()
  const userVariables = config.global.variables
  const flow = useInstallerFlow({ editors, initialEditor, kind, source: initialSource })
  const variableConfirmPassedRef = useRef(false)
  const pendingInstallOptionsRef = useRef<InstallFlowOptions>({})
  const pendingSubstitutionsRef = useRef<Record<string, string> | undefined>(undefined)
  const [selection, setSelection] = useState<EditorWriteTargetSelection | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState("")
  const [detectedPlaceholders, setDetectedPlaceholders] = useState<string[]>([])
  const [isVariableConfirmOpen, setIsVariableConfirmOpen] = useState(false)
  const [pendingVariableChanges, setPendingVariableChanges] = useState<UserVariableChangeSet | null>(null)
  const [isVariableSaveConfirmOpen, setIsVariableSaveConfirmOpen] = useState(false)
  const [isSavingVariables, setIsSavingVariables] = useState(false)
  const [isOverwriteConfirmOpen, setIsOverwriteConfirmOpen] = useState(false)
  const [isConflictConfirmOpen, setIsConflictConfirmOpen] = useState(false)
  const [isRuleProjectInstallFormOpen, setIsRuleProjectInstallFormOpen] = useState(false)
  const [isRuleGlobalInstallFormOpen, setIsRuleGlobalInstallFormOpen] = useState(false)
  const [isCompletionRetryPending, setIsCompletionRetryPending] = useState(false)

  const scope = selection?.scope ?? "global"
  const activeTarget = selection?.activeTarget ?? null
  const installFormDefinition = flow.selectedEditor ? installFormDefinitionByEditorId.get(flow.selectedEditor.id) : undefined
  const RuleProjectInstallForm = installFormDefinition?.RuleProjectInstallForm
  const RuleGlobalInstallForm = installFormDefinition?.RuleGlobalInstallForm

  const resolveTarget = useCallback(async (input: ResolveEditorTargetInput) => {
    if (!flow.source) {
      throw new Error("安装源不可用。")
    }
    return resolveEditorInstallTarget({
      editorId: input.editorId,
      scope: input.scope,
      projectPath: input.projectPath,
      contentType: flow.source.kind,
      contentId: flow.source.sourceIdentity,
      preparedSourceId: flow.source.preparedSourceId,
      skillName: flow.source.kind === "skill" ? flow.source.name : undefined,
      skillTitle: flow.source.kind === "skill" ? flow.source.title : undefined,
      ruleName: flow.source.kind === "rule" ? flow.source.name : undefined,
    })
  }, [flow.source])

  const resetVariableInstallAttempt = useCallback(() => {
    pendingSubstitutionsRef.current = undefined
    variableConfirmPassedRef.current = false
    pendingInstallOptionsRef.current = {}
    setPendingVariableChanges(null)
  }, [])

  const runInstall = async (
    installFormValues?: SynapseEditorInstallFormValues,
    options: InstallFlowOptions = {},
  ) => {
    const replaceConfirmed = Boolean(options.replaceConfirmed)
    const overwriteConfirmed = Boolean(options.overwriteConfirmed)

    if (
      !flow.source
      || !flow.selectedEditor
      || !selection
      || (activeTarget?.status !== "ready" && activeTarget?.status !== "conflict")
    ) {
      return
    }

    setInstalling(true)
    setError("")
    try {
      if (!isCompletionRetryPending) {
        await onInstall?.({ editor: flow.selectedEditor, source: flow.source })
        if (!onInstall) {
          await installSourceToEditor({
            editorId: flow.selectedEditor.id,
            overwriteConfirmed,
            projectPath: selection.scope === "project" ? selection.projectPath : undefined,
            replaceConfirmed,
            replacedSourceIdentity: activeTarget.status === "conflict" ? activeTarget.conflictContentId : undefined,
            scope: selection.scope,
            source: flow.source,
            installFormValues,
            variableSubstitutions: pendingSubstitutionsRef.current,
          })
        }
        setIsCompletionRetryPending(true)
      }
      await onInstalled()
      setIsCompletionRetryPending(false)
      flow.markInstalled()
    } catch (err) {
      setError(err instanceof Error ? err.message : "安装失败")
    } finally {
      setInstalling(false)
    }
  }

  const handleInstall = async (options: InstallFlowOptions = {}) => {
    const replaceConfirmed = Boolean(options.replaceConfirmed)
    const overwriteConfirmed = Boolean(options.overwriteConfirmed)

    if (
      !flow.source
      || !flow.selectedEditor
      || !selection
      || (activeTarget?.status !== "ready" && activeTarget?.status !== "conflict")
    ) {
      return
    }

    if (!variableConfirmPassedRef.current) {
      try {
        const content = await readInstallerSourceContent(flow.source)
        const placeholders = detectPlaceholders(content, { includeCodeBlocks: true })
        if (placeholders.length > 0) {
          pendingInstallOptionsRef.current = options
          setDetectedPlaceholders(placeholders)
          setIsVariableConfirmOpen(true)
          return
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "读取安装源失败。")
        return
      }
    }

    if (activeTarget.status === "conflict" && flow.source.kind === "skill" && !replaceConfirmed) {
      setIsConflictConfirmOpen(true)
      return
    }

    if (
      activeTarget.status === "ready"
      && activeTarget.targetKind === "directory"
      && activeTarget.targetExists
      && flow.source.kind === "skill"
      && !overwriteConfirmed
    ) {
      setIsOverwriteConfirmOpen(true)
      return
    }

    if (flow.source.kind === "rule" && scope === "global" && RuleGlobalInstallForm) {
      if (activeTarget.status !== "ready") {
        setError("当前还没有可用的安装目标。")
        return
      }
      setError("")
      setIsRuleGlobalInstallFormOpen(true)
      return
    }

    if (flow.source.kind === "rule" && scope === "project" && RuleProjectInstallForm) {
      if (activeTarget.status !== "ready") {
        setError("当前还没有可用的安装目标。")
        return
      }
      setError("")
      setIsRuleProjectInstallFormOpen(true)
      return
    }

    await runInstall(undefined, { replaceConfirmed, overwriteConfirmed })
  }

  const handleVariableConfirm = async (substitutions: Record<string, string>) => {
    const filtered = Object.fromEntries(
      Object.entries(substitutions).filter(([, value]) => value.length > 0),
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
    await handleInstall(pendingInstallOptionsRef.current)
  }

  const continueInstallAfterVariableSaveDecision = async () => {
    setIsVariableSaveConfirmOpen(false)
    setPendingVariableChanges(null)
    await handleInstall(pendingInstallOptionsRef.current)
  }

  const handleSaveVariableChanges = async () => {
    if (isSavingVariables) return
    setIsSavingVariables(true)
    try {
      if (pendingVariableChanges) {
        const patch = buildUserVariablesPatch(userVariables, pendingVariableChanges)
        if (patch) {
          await updateConfig(patch)
        }
      }
    } catch {
      warning("变量未保存，安装会继续。")
    } finally {
      setIsSavingVariables(false)
    }

    await continueInstallAfterVariableSaveDecision()
  }

  const sourceDescription = flow.source?.description ?? ""

  const containerClassName = mode === "page"
    ? "mx-auto flex w-full max-w-2xl flex-col gap-4 p-6"
    : "flex w-full flex-col gap-4"

  return (
    <section className={containerClassName}>
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
        isSubmitting={isSavingVariables || installing}
        onOpenChange={(next) => {
          if (!next) {
            setPendingVariableChanges(null)
            variableConfirmPassedRef.current = false
          }
          setIsVariableSaveConfirmOpen(next)
        }}
        onSave={handleSaveVariableChanges}
        onSkip={continueInstallAfterVariableSaveDecision}
        open={isVariableSaveConfirmOpen}
      />

      {RuleGlobalInstallForm && flow.source?.kind === "rule" ? (
        <RuleGlobalInstallForm
          editorId={flow.selectedEditor?.id ?? ""}
          item={{ description: sourceDescription }}
          isSubmitting={installing}
          onConfirm={(values) => {
            setIsRuleGlobalInstallFormOpen(false)
            void runInstall(values, pendingInstallOptionsRef.current)
          }}
          onError={setError}
          onOpenChange={(next) => {
            if (!installing) setIsRuleGlobalInstallFormOpen(next)
          }}
          open={isRuleGlobalInstallFormOpen}
          target={activeTarget?.status === "ready" ? activeTarget : null}
        />
      ) : null}

      {RuleProjectInstallForm && flow.source?.kind === "rule" ? (
        <RuleProjectInstallForm
          editorId={flow.selectedEditor?.id ?? ""}
          item={{ description: sourceDescription }}
          isSubmitting={installing}
          onConfirm={(values) => {
            setIsRuleProjectInstallFormOpen(false)
            void runInstall(values, pendingInstallOptionsRef.current)
          }}
          onError={setError}
          onOpenChange={(next) => {
            if (!installing) setIsRuleProjectInstallFormOpen(next)
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
              Skill 安装会整体替换目标目录中的现有内容。
            </AlertDialogDescription>
            {activeTarget?.status === "ready" ? (
              <div className="mt-1 rounded-md bg-muted/40 px-3 py-2 font-mono text-xs break-all text-muted-foreground">
                {activeTarget.targetPath}
              </div>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={installing}
              onClick={() => {
                resetVariableInstallAttempt()
                setIsOverwriteConfirmOpen(false)
              }}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={installing}
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
              该位置已存在同名 Skill，替换后旧 Skill 将移到桌面备份。
            </AlertDialogDescription>
            {activeTarget?.status === "conflict" ? (
              <div className="mt-1 rounded-md bg-muted/40 px-3 py-2 font-mono text-xs break-all text-muted-foreground">
                {activeTarget.targetPath}
              </div>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={installing}
              onClick={() => {
                resetVariableInstallAttempt()
                setIsConflictConfirmOpen(false)
              }}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={installing}
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

      {flow.step === "source" ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-balance font-heading text-base font-medium">选择{getKindLabel(flow.activeKind)}来源</h2>
          {renderSourceInput?.({ onSourceReady: flow.selectSource }) ?? null}
        </div>
      ) : null}

      {flow.step === "editor" ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-balance font-heading text-base font-medium">选择编辑器</h2>
          <div className="grid gap-1.5">
            {flow.availableEditors.length > 0 ? (
              flow.availableEditors.map((editor) => (
                <Button
                  key={editor.id}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start gap-2.5 whitespace-normal bg-muted/30 p-2.5 text-left hover:bg-muted/60"
                  onClick={() => {
                    setSelection(null)
                    setError("")
                    setIsCompletionRetryPending(false)
                    flow.selectEditor(editor)
                  }}
                >
                  <EditorIcon editorId={editor.id} className="size-8" />
                  <span className="min-w-0 truncate font-medium">{editor.label}</span>
                </Button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">当前没有可用编辑器。</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
          </div>
        </div>
      ) : null}

      {flow.step === "target" ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-balance font-heading text-base font-medium">目标位置</h2>
          {flow.source && flow.selectedEditor ? (
            <EditorWriteTargetSelector
              actionKind="install"
              contentType={flow.source.kind}
              editor={flow.selectedEditor}
              initialSelection={initialSelection}
              loggerName="installer.flow.target"
              open
              projects={projects}
              resolveTarget={resolveTarget}
              onError={setError}
              onSelectionChange={(nextSelection) => {
                setSelection(nextSelection)
                setIsCompletionRetryPending(false)
              }}
            />
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={initialEditor ? onCancel : flow.back}
              disabled={installing}
            >
              {initialEditor ? "取消" : "上一步"}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleInstall()
              }}
              disabled={
                installing
                || (selection?.activeTarget?.status !== "ready" && selection?.activeTarget?.status !== "conflict")
              }
            >
              {installing ? "安装中" : isCompletionRetryPending ? "重试完成记录" : "安装"}
            </Button>
          </div>
        </div>
      ) : null}

      {flow.step === "success" ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-balance font-heading text-base font-medium">安装完成</h2>
          <div className="flex justify-end">
            <Button type="button" onClick={onCancel}>完成</Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
