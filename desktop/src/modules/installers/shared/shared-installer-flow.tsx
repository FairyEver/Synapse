import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
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
  projects: string[]
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
  renderSourceInput,
  source: initialSource,
}: SharedInstallerFlowProps) {
  const flow = useInstallerFlow({ editors, kind, source: initialSource })

  const handleInstall = async () => {
    if (!flow.source || !flow.selectedEditor) {
      return
    }
    await onInstall?.({ editor: flow.selectedEditor, source: flow.source })
    await onInstalled()
    flow.markInstalled()
  }

  const containerClassName = mode === "page"
    ? "mx-auto flex w-full max-w-2xl flex-col gap-4 p-6"
    : "flex w-full flex-col gap-4"

  return (
    <section className={containerClassName}>
      {flow.step === "source" ? (
        <div className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-medium">选择{getKindLabel(flow.activeKind)}来源</h2>
          {renderSourceInput?.({ onSourceReady: flow.selectSource }) ?? null}
        </div>
      ) : null}

      {flow.step === "editor" ? (
        <div className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-medium">选择编辑器</h2>
          <div className="grid gap-2">
            {flow.availableEditors.map((editor) => (
              <Button
                key={editor.id}
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => flow.selectEditor(editor)}
              >
                {editor.label}
              </Button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
          </div>
        </div>
      ) : null}

      {flow.step === "target" ? (
        <div className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-medium">目标位置</h2>
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            {flow.selectedEditor?.label}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={flow.back}>上一步</Button>
            <Button type="button" onClick={handleInstall}>安装</Button>
          </div>
        </div>
      ) : null}

      {flow.step === "success" ? (
        <div className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-medium">安装完成</h2>
          <div className="flex justify-end">
            <Button type="button" onClick={onCancel}>完成</Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
