import type { SynapseInstallToEditorPayload } from "../../../src/types/editor"

export type PrepareRuleFileContentContext = {
  payload: SynapseInstallToEditorPayload
  targetPath: string
  ruleBody: string
  readExistingTextFile: (targetPath: string) => Promise<string>
}

export type EditorInstallStrategy = {
  prepareRuleFileContent(context: PrepareRuleFileContentContext): Promise<string>
}

export type EditorScanRuleItem = import("../../../src/types/editor-scan").EditorScanRuleItem

export type EditorScanStrategy = {
  scanRules(rulesPath: string | null): Promise<EditorScanRuleItem[]>
}
