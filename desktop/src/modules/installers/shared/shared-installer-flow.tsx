import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"

import { readContent, resolveEditorInstallTarget } from "@/app-shell/content"
import { inspectSkillEnvSource, installSourceToEditor } from "@/app-shell/installers"
import { createRendererLogger } from "@/app-shell/logging"
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
  SkillEnvValuesDialog,
} from "@/modules/content/components/skill-env-values-dialog"
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
  buildUserSecretChangeSet,
  hasUserSecretChanges,
  type UserSecretChangeSet,
} from "@/modules/content/lib/repository-variables"
import type { SynapseProjectConfig } from "@/types/config"
import type {
  SynapseEditorAdapterSummary,
  SynapseEditorInstallFormValues,
} from "@/types/editor"
import type {
  SynapseInstallerKind,
  SynapseInstallerSource,
  SynapseSkillEnvDeclaration,
} from "@/types/installers"
import { detectPlaceholders } from "@/lib/variable-substitution"
import { useAppNotifications } from "@/app-shell/notifications"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { SecretSafeView } from "../../../../app-capabilities/secrets/shared/schema"

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

const logger = createRendererLogger("installer.flow")

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

function findValueByName(
  values: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!values) return undefined
  if (Object.hasOwn(values, name)) return values[name]
  const entry = Object.entries(values).find(([candidate]) => candidate.toLowerCase() === name.toLowerCase())
  return entry?.[1]
}

function mergeConfirmedValuesForSecretSave(
  legacyValues: Record<string, string> | undefined,
  skillEnvValues: Record<string, string> | undefined,
): Record<string, string> {
  const valuesByNormalizedName = new Map<string, readonly [string, string]>()
  for (const values of [legacyValues, skillEnvValues]) {
    for (const [name, value] of Object.entries(values ?? {})) {
      valuesByNormalizedName.set(name.toLowerCase(), [name, value])
    }
  }
  return Object.fromEntries(valuesByNormalizedName.values())
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
  const { warning } = useAppNotifications()
  const secretsBridge = useMemo(() => requireBridgeDomain("secrets"), [])
  const flow = useInstallerFlow({ editors, initialEditor, kind, source: initialSource })
  const variableConfirmPassedRef = useRef(false)
  const pendingInstallOptionsRef = useRef<InstallFlowOptions>({})
  const pendingSkillEnvReplacementValuesRef = useRef<Record<string, string> | undefined>(undefined)
  const pendingSkillEnvSecretNamesRef = useRef<Record<string, string> | undefined>(undefined)
  const pendingSkillEnvValuesRef = useRef<Record<string, string> | undefined>(undefined)
  const pendingLegacySecretNamesRef = useRef<Record<string, string> | undefined>(undefined)
  const pendingLegacySubstitutionsRef = useRef<Record<string, string> | undefined>(undefined)
  const pendingInstallWarningRef = useRef<string | undefined>(undefined)
  const [selection, setSelection] = useState<EditorWriteTargetSelection | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState("")
  const [detectedPlaceholders, setDetectedPlaceholders] = useState<string[]>([])
  const [skillEnvDeclarations, setSkillEnvDeclarations] = useState<SynapseSkillEnvDeclaration[]>([])
  const [userSecrets, setUserSecrets] = useState<SecretSafeView[]>([])
  const [skillEnvInitialValues, setSkillEnvInitialValues] = useState<Record<string, string>>({})
  const [legacyInitialValues, setLegacyInitialValues] = useState<Record<string, string>>({})
  const [isSkillEnvConfirmOpen, setIsSkillEnvConfirmOpen] = useState(false)
  const [isVariableConfirmOpen, setIsVariableConfirmOpen] = useState(false)
  const [pendingSecretChanges, setPendingSecretChanges] = useState<UserSecretChangeSet | null>(null)
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
    pendingSkillEnvReplacementValuesRef.current = undefined
    pendingSkillEnvSecretNamesRef.current = undefined
    pendingSkillEnvValuesRef.current = undefined
    pendingLegacySecretNamesRef.current = undefined
    pendingLegacySubstitutionsRef.current = undefined
    variableConfirmPassedRef.current = false
    pendingInstallOptionsRef.current = {}
    setPendingSecretChanges(null)
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
        pendingInstallWarningRef.current = undefined
        await onInstall?.({ editor: flow.selectedEditor, source: flow.source })
        if (!onInstall) {
          const result = await installSourceToEditor({
            editorId: flow.selectedEditor.id,
            overwriteConfirmed,
            projectPath: selection.scope === "project" ? selection.projectPath : undefined,
            replaceConfirmed,
            replacedSourceIdentity: activeTarget.status === "conflict" ? activeTarget.conflictContentId : undefined,
            scope: selection.scope,
            source: flow.source,
            installFormValues,
            skillEnvReplacementValues: pendingSkillEnvReplacementValuesRef.current,
            skillEnvSecretNames: pendingSkillEnvSecretNamesRef.current,
            skillEnvValues: pendingSkillEnvValuesRef.current,
            variableSecretNames: pendingLegacySecretNamesRef.current,
            variableSubstitutions: pendingLegacySubstitutionsRef.current,
          })
          pendingInstallWarningRef.current = result.warning
        }
        setIsCompletionRetryPending(true)
      }
      await onInstalled()
      const installWarning = pendingInstallWarningRef.current
      pendingInstallWarningRef.current = undefined
      if (installWarning) warning(installWarning)
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
        if (flow.source.kind === "rule") {
          const content = await readInstallerSourceContent(flow.source)
          const placeholders = detectPlaceholders(content, { includeCodeBlocks: true })
          if (placeholders.length > 0) {
            const list = await secretsBridge.item.list()
            setUserSecrets(list.secrets)
            setLegacyInitialValues(Object.fromEntries(placeholders.map((name) => [
              name,
              findValueByName(pendingLegacySubstitutionsRef.current, name) ?? "",
            ])))
            pendingInstallOptionsRef.current = options
            setDetectedPlaceholders(placeholders)
            setIsVariableConfirmOpen(true)
            return
          }
        } else {
          const inspection = await inspectSkillEnvSource(flow.source)
          const names = [
            ...inspection.declarations.map(({ name }) => name),
            ...inspection.legacyPlaceholders,
          ]
          setSkillEnvDeclarations(inspection.declarations)
          setDetectedPlaceholders(inspection.legacyPlaceholders)

          if (names.length > 0) {
            const list = await secretsBridge.item.list()
            const envInitialValues = Object.fromEntries(inspection.declarations.map(({ name, defaultValue }) => [
              name,
              findValueByName(pendingSkillEnvValuesRef.current, name)
                ?? defaultValue
                ?? "",
            ]))
            const nextLegacyInitialValues = Object.fromEntries(inspection.legacyPlaceholders.map((name) => [
              name,
              findValueByName(pendingLegacySubstitutionsRef.current, name)
                ?? "",
            ]))

            setUserSecrets(list.secrets)
            setSkillEnvInitialValues(envInitialValues)
            setLegacyInitialValues(nextLegacyInitialValues)
            pendingInstallOptionsRef.current = options
            if (inspection.declarations.length > 0) {
              setIsSkillEnvConfirmOpen(true)
            } else {
              setIsVariableConfirmOpen(true)
            }
            return
          }

          variableConfirmPassedRef.current = true
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
      && !activeTarget.ownedTargetExists
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

  const continueInstallAfterValueConfirmation = async () => {
    variableConfirmPassedRef.current = true
    const confirmedValues = mergeConfirmedValuesForSecretSave(
      pendingLegacySubstitutionsRef.current,
      pendingSkillEnvValuesRef.current,
    )
    const changes = buildUserSecretChangeSet(userSecrets, confirmedValues)
    if (hasUserSecretChanges(changes)) {
      setPendingSecretChanges(changes)
      setIsSkillEnvConfirmOpen(false)
      setIsVariableConfirmOpen(false)
      setIsVariableSaveConfirmOpen(true)
      return
    }

    setIsSkillEnvConfirmOpen(false)
    setIsVariableConfirmOpen(false)
    await handleInstall(pendingInstallOptionsRef.current)
  }

  const handleSkillEnvConfirm = async (
    values: Record<string, string>,
    secretNames: Record<string, string>,
    replacementValues: Record<string, string>,
  ) => {
    pendingSkillEnvValuesRef.current = values
    pendingSkillEnvReplacementValuesRef.current = Object.keys(replacementValues).length > 0
      ? replacementValues
      : undefined
    pendingSkillEnvSecretNamesRef.current = Object.keys(secretNames).length > 0 ? secretNames : undefined
    setIsSkillEnvConfirmOpen(false)

    if (detectedPlaceholders.length > 0) {
      setIsVariableConfirmOpen(true)
      return
    }

    await continueInstallAfterValueConfirmation()
  }

  const handleVariableConfirm = async (
    substitutions: Record<string, string>,
    secretNames: Record<string, string>,
  ) => {
    const filtered = Object.fromEntries(
      Object.entries(substitutions).filter(([, value]) => value.length > 0),
    )
    pendingLegacySubstitutionsRef.current = Object.keys(filtered).length > 0 ? filtered : undefined
    pendingLegacySecretNamesRef.current = Object.keys(secretNames).length > 0 ? secretNames : undefined
    await continueInstallAfterValueConfirmation()
  }

  const continueInstallAfterVariableSaveDecision = async () => {
    setIsVariableSaveConfirmOpen(false)
    setPendingSecretChanges(null)
    await handleInstall(pendingInstallOptionsRef.current)
  }

  const handleSaveVariableChanges = async () => {
    if (isSavingVariables) return
    const secretsToSave = pendingSecretChanges
      ? [...pendingSecretChanges.newSecrets, ...pendingSecretChanges.updatedSecrets]
      : []
    let savedCount = 0
    setIsSavingVariables(true)
    try {
      for (const secret of secretsToSave) {
        await secretsBridge.item.upsert(secret)
        savedCount += 1
      }
    } catch (saveError) {
      logger.error("Failed to save installer substitution secrets.", {
        errorName: saveError instanceof Error ? saveError.name : typeof saveError,
        savedCount,
        totalCount: secretsToSave.length,
      })
      warning("密钥保存失败，请重试或仅本次使用。")
      return
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
      <SkillEnvValuesDialog
        declarations={skillEnvDeclarations}
        initialValues={skillEnvInitialValues}
        isProjectScope={scope === "project"}
        onConfirm={handleSkillEnvConfirm}
        onOpenChange={(next) => {
          if (!next) {
            variableConfirmPassedRef.current = false
          }
          setIsSkillEnvConfirmOpen(next)
        }}
        open={isSkillEnvConfirmOpen}
        secrets={userSecrets}
      />
      <VariableSubstitutionDialog
        open={isVariableConfirmOpen}
        onOpenChange={(next) => {
          if (!next) {
            variableConfirmPassedRef.current = false
          }
          setIsVariableConfirmOpen(next)
        }}
        placeholders={detectedPlaceholders}
        secrets={userSecrets}
        initialValues={legacyInitialValues}
        showOneShotWarning={flow.source?.kind === "skill"}
        onConfirm={handleVariableConfirm}
      />
      <VariableSaveConfirmationDialog
        changes={pendingSecretChanges}
        isSubmitting={isSavingVariables || installing}
        onOpenChange={(next) => {
          if (!next) {
            setPendingSecretChanges(null)
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
                    pendingInstallWarningRef.current = undefined
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
                pendingInstallWarningRef.current = undefined
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
