import { editorAdapter as claudeCodeEditorAdapter } from "../claude-code/adapter"
import { editorAdapter as codexEditorAdapter } from "../codex/adapter"
import { editorAdapter as cursorEditorAdapter } from "../cursor/adapter"
import { cliDefinition as claudeCodeCliDefinition } from "../../../../src/ide-definitions/claude-code/cli"
import { cliDefinition as codexCliDefinition } from "../../../../src/ide-definitions/codex/cli"
import { installStrategy as claudeCodeInstallStrategy } from "../claude-code/install"
import { installStrategy as codexInstallStrategy } from "../codex/install"
import { installStrategy as cursorInstallStrategy } from "../cursor/install"
import { scanStrategy as claudeCodeScanStrategy } from "../claude-code/scan"
import { scanStrategy as codexScanStrategy } from "../codex/scan"
import { scanStrategy as cursorScanStrategy } from "../cursor/scan"
import type { EditorAdapter } from "../../editor-adapters/types"
import type { EditorInstallStrategy, EditorScanStrategy } from "../types"

export const editorAdapters = [
  claudeCodeEditorAdapter,
  codexEditorAdapter,
  cursorEditorAdapter,
] satisfies EditorAdapter[]

export const editorAdapterById = new Map(
  editorAdapters.map((adapter) => [adapter.id, adapter]),
)

export const cliDefinitions = [
  claudeCodeCliDefinition,
  codexCliDefinition,
].sort((left, right) => left.order - right.order)

export const editorInstallStrategyById = new Map<string, EditorInstallStrategy>([
  [claudeCodeEditorAdapter.id, claudeCodeInstallStrategy],
  [codexEditorAdapter.id, codexInstallStrategy],
  [cursorEditorAdapter.id, cursorInstallStrategy],
])

export const editorScanStrategyById = new Map<string, EditorScanStrategy>([
  [claudeCodeEditorAdapter.id, claudeCodeScanStrategy],
  [codexEditorAdapter.id, codexScanStrategy],
  [cursorEditorAdapter.id, cursorScanStrategy],
])
