import { useCallback, useMemo, useState } from "react"

import type { SynapseEditorAdapterSummary } from "@/types/editor"
import type {
  SynapseInstallerKind,
  SynapseInstallerSource,
} from "@/types/installers"

export type InstallerFlowMode = "modal" | "page"

export type InstallerFlowStep = "source" | "editor" | "target" | "success"

export type InstallerFlowState = {
  selectedEditor: SynapseEditorAdapterSummary | null
  source: SynapseInstallerSource | null
  step: InstallerFlowStep
}

type UseInstallerFlowOptions = {
  editors: SynapseEditorAdapterSummary[]
  kind?: SynapseInstallerKind
  source?: SynapseInstallerSource
}

export function useInstallerFlow({ editors, kind, source: initialSource }: UseInstallerFlowOptions) {
  const [source, setSource] = useState<SynapseInstallerSource | null>(initialSource ?? null)
  const [selectedEditor, setSelectedEditor] = useState<SynapseEditorAdapterSummary | null>(null)
  const [step, setStep] = useState<InstallerFlowStep>(initialSource ? "editor" : "source")

  const activeKind = source?.kind ?? kind

  const availableEditors = useMemo(
    () => editors
      .filter((editor) => !activeKind || editor.supportedContentTypes.includes(activeKind))
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label)),
    [activeKind, editors],
  )

  const selectSource = useCallback((nextSource: SynapseInstallerSource) => {
    setSource(nextSource)
    setSelectedEditor(null)
    setStep("editor")
  }, [])

  const selectEditor = useCallback((editor: SynapseEditorAdapterSummary) => {
    setSelectedEditor(editor)
    setStep("target")
  }, [])

  const back = useCallback(() => {
    setStep((currentStep) => {
      if (currentStep === "target") {
        return "editor"
      }
      if (currentStep === "editor" && !initialSource) {
        return "source"
      }
      return currentStep
    })
  }, [initialSource])

  const markInstalled = useCallback(() => {
    setStep("success")
  }, [])

  return {
    activeKind,
    availableEditors,
    back,
    markInstalled,
    selectedEditor,
    selectEditor,
    selectSource,
    source,
    step,
  }
}
