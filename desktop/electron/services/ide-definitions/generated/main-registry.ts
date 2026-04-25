import { editorAdapter as claudeCodeEditorAdapter } from "../../../../src/ide-definitions/claude-code/adapter"
import { editorAdapter as codexEditorAdapter } from "../../../../src/ide-definitions/codex/adapter"
import { editorAdapter as cursorEditorAdapter } from "../../../../src/ide-definitions/cursor/adapter"
import { editorAdapter as windsurfEditorAdapter } from "../../../../src/ide-definitions/windsurf/adapter"
import { cliDefinition as claudeCodeCliDefinition } from "../../../../src/ide-definitions/claude-code/cli"
import { cliDefinition as codexCliDefinition } from "../../../../src/ide-definitions/codex/cli"
import { mcpDefinition as claudeCodeMcpDefinition } from "../../../../src/ide-definitions/claude-code/mcp"
import { mcpDefinition as codexMcpDefinition } from "../../../../src/ide-definitions/codex/mcp"
import { mcpDefinition as cursorMcpDefinition } from "../../../../src/ide-definitions/cursor/mcp"
import { mcpDefinition as windsurfMcpDefinition } from "../../../../src/ide-definitions/windsurf/mcp"
import { installStrategy as claudeCodeInstallStrategy } from "../../../../src/ide-definitions/claude-code/install"
import { installStrategy as codexInstallStrategy } from "../../../../src/ide-definitions/codex/install"
import { installStrategy as cursorInstallStrategy } from "../../../../src/ide-definitions/cursor/install"
import { installStrategy as windsurfInstallStrategy } from "../../../../src/ide-definitions/windsurf/install"
import { scanStrategy as claudeCodeScanStrategy } from "../../../../src/ide-definitions/claude-code/scan"
import { scanStrategy as codexScanStrategy } from "../../../../src/ide-definitions/codex/scan"
import { scanStrategy as cursorScanStrategy } from "../../../../src/ide-definitions/cursor/scan"
import { scanStrategy as windsurfScanStrategy } from "../../../../src/ide-definitions/windsurf/scan"
import type { EditorAdapter, EditorInstallStrategy, EditorScanStrategy } from "../../../../src/ide-definitions/main-types"
import type { SynapseMcpDefinition } from "../../../../src/ide-definitions/types"

export const editorAdapters = [
  claudeCodeEditorAdapter,
  codexEditorAdapter,
  cursorEditorAdapter,
  windsurfEditorAdapter,
] satisfies EditorAdapter[]

export const editorAdapterById = new Map(
  editorAdapters.map((adapter) => [adapter.id, adapter]),
)

export const cliDefinitions = [
  claudeCodeCliDefinition,
  codexCliDefinition,
].sort((left, right) => left.order - right.order)

export const mcpDefinitions = [
  claudeCodeMcpDefinition,
  codexMcpDefinition,
  cursorMcpDefinition,
  windsurfMcpDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseMcpDefinition[]

export const editorInstallStrategyById = new Map<string, EditorInstallStrategy>([
  [claudeCodeEditorAdapter.id, claudeCodeInstallStrategy],
  [codexEditorAdapter.id, codexInstallStrategy],
  [cursorEditorAdapter.id, cursorInstallStrategy],
  [windsurfEditorAdapter.id, windsurfInstallStrategy],
])

export const editorScanStrategyById = new Map<string, EditorScanStrategy>([
  [claudeCodeEditorAdapter.id, claudeCodeScanStrategy],
  [codexEditorAdapter.id, codexScanStrategy],
  [cursorEditorAdapter.id, cursorScanStrategy],
  [windsurfEditorAdapter.id, windsurfScanStrategy],
])
