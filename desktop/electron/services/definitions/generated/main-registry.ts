import { editorAdapter as claudeCodeEditorAdapter } from "../../../../src/definitions/editor/claude-code/adapter"
import { editorAdapter as codexEditorAdapter } from "../../../../src/definitions/editor/codex/adapter"
import { editorAdapter as cursorEditorAdapter } from "../../../../src/definitions/editor/cursor/adapter"
import { editorAdapter as windsurfEditorAdapter } from "../../../../src/definitions/editor/windsurf/adapter"
import { cliDefinition as claudeCodeCliDefinition } from "../../../../src/definitions/editor/claude-code/cli"
import { cliDefinition as codexCliDefinition } from "../../../../src/definitions/editor/codex/cli"
import { mcpDefinition as claudeCodeMcpDefinition } from "../../../../src/definitions/editor/claude-code/mcp"
import { mcpDefinition as codexMcpDefinition } from "../../../../src/definitions/editor/codex/mcp"
import { mcpDefinition as cursorMcpDefinition } from "../../../../src/definitions/editor/cursor/mcp"
import { mcpDefinition as windsurfMcpDefinition } from "../../../../src/definitions/editor/windsurf/mcp"
import { installStrategy as claudeCodeInstallStrategy } from "../../../../src/definitions/editor/claude-code/install"
import { installStrategy as codexInstallStrategy } from "../../../../src/definitions/editor/codex/install"
import { installStrategy as cursorInstallStrategy } from "../../../../src/definitions/editor/cursor/install"
import { installStrategy as windsurfInstallStrategy } from "../../../../src/definitions/editor/windsurf/install"
import { scanStrategy as claudeCodeScanStrategy } from "../../../../src/definitions/editor/claude-code/scan"
import { scanStrategy as codexScanStrategy } from "../../../../src/definitions/editor/codex/scan"
import { scanStrategy as cursorScanStrategy } from "../../../../src/definitions/editor/cursor/scan"
import { scanStrategy as windsurfScanStrategy } from "../../../../src/definitions/editor/windsurf/scan"
import type { EditorAdapter, EditorInstallStrategy, EditorScanStrategy } from "../../../../src/definitions/main-types"
import type { SynapseMcpDefinition } from "../../../../src/definitions/types"

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
