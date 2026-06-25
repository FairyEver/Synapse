import { useCallback, useState, type ReactNode } from "react"

import { resolveEditorInstallTarget } from "@/app-shell/content"
import { installSourceToEditor } from "@/app-shell/installers"
import { EditorIcon } from "@/components/editor-icon"
import { Button } from "@/components/ui/button"
import {
  EditorWriteTargetSelector,
  type EditorWriteTargetSelection,
  type ResolveEditorTargetInput,
} from "@/modules/content/components/editor-write-target-selector"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseEditorAdapterSummary } from "@/types/editor"
import type {
  SynapseInstallerKind,
  SynapseInstallerSource,
} from "@/types/installers"

import {
  type InstallerFlowMode,
  useInstallerFlow,
} from "./use-installer-flow"

type SharedInstallerFlowRenderSourceInputArgs = {
  onSourceReady: (source: SynapseInstallerSource) => void
}

export type SharedInstallerFlowProps = {
  editors: SynapseEditorAdapterSummary[]
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

function getKindLabel(kind: SynapseInstallerKind | undefined) {
  if (kind === "skill") {
    return "Skill"
  }
  if (kind === "rule") {
    return "Rule"
  }
  return "内容"
}

export function SharedInstallerFlow({
  editors,
  kind,
  mode,
  onCancel,
  onInstall,
  onInstalled,
  projects,
  renderSourceInput,
  source: initialSource,
}: SharedInstallerFlowProps) {
  const flow = useInstallerFlow({ editors, kind, source: initialSource })
  const [selection, setSelection] = useState<EditorWriteTargetSelection | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState("")

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

  const handleInstall = async () => {
    const activeTarget = selection?.activeTarget
    if (
      !flow.source
      || !flow.selectedEditor
      || !selection
      || (activeTarget?.status !== "ready" && activeTarget?.status !== "conflict")
    ) {
      return
    }
    const replaceConfirmed = activeTarget.status === "conflict"
    const overwriteConfirmed = activeTarget.status === "ready"
      && flow.source.kind === "skill"
      && activeTarget.targetKind === "directory"
      && activeTarget.targetExists

    if (replaceConfirmed && !window.confirm("确认替换目标 Skill？")) {
      return
    }
    if (overwriteConfirmed && !window.confirm("确认覆盖目标目录？")) {
      return
    }

    setInstalling(true)
    setError("")
    try {
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
        })
      }
      await onInstalled()
      flow.markInstalled()
    } catch (err) {
      setError(err instanceof Error ? err.message : "安装失败")
    } finally {
      setInstalling(false)
    }
  }

  const containerClassName = mode === "page"
    ? "mx-auto flex w-full max-w-2xl flex-col gap-4 p-6"
    : "flex w-full flex-col gap-4"

  return (
    <section className={containerClassName}>
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
              loggerName="installer.flow.target"
              open
              projects={projects}
              resolveTarget={resolveTarget}
              onError={setError}
              onSelectionChange={setSelection}
            />
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={flow.back} disabled={installing}>上一步</Button>
            <Button
              type="button"
              onClick={handleInstall}
              disabled={
                installing
                || (selection?.activeTarget?.status !== "ready" && selection?.activeTarget?.status !== "conflict")
              }
            >
              {installing ? "安装中" : "安装"}
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
