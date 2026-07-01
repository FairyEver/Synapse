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
  initialEditor?: SynapseEditorAdapterSummary | null
  kind?: SynapseInstallerKind
  source?: SynapseInstallerSource
}

export function useInstallerFlow({
  editors,
  initialEditor,
  kind,
  source: initialSource,
}: UseInstallerFlowOptions) {
  const [source, setSource] = useState<SynapseInstallerSource | null>(initialSource ?? null)
  const [selectedEditor, setSelectedEditor] = useState<SynapseEditorAdapterSummary | null>(initialEditor ?? null)
  const [step, setStep] = useState<InstallerFlowStep>(
    initialSource ? initialEditor ? "target" : "editor" : "source",
  )

  const activeKind = source?.kind ?? kind

  const availableEditors = useMemo(
    () => editors
      .filter((editor) => !activeKind || editor.supportedContentTypes.includes(activeKind))
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label)),
    [activeKind, editors],
  )

  const selectSource = useCallback((nextSource: SynapseInstallerSource) => {
    setSource(nextSource)
    setSelectedEditor(initialEditor ?? null)
    setStep(initialEditor ? "target" : "editor")
  }, [initialEditor])

  const selectEditor = useCallback((editor: SynapseEditorAdapterSummary) => {
    setSelectedEditor(editor)
    setStep("target")
  }, [])

  const back = useCallback(() => {
    setStep((currentStep) => {
      if (currentStep === "target") {
        if (initialEditor) {
          return currentStep
        }
        return "editor"
      }
      if (currentStep === "editor" && !initialSource) {
        return "source"
      }
      return currentStep
    })
  }, [initialEditor, initialSource])

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
