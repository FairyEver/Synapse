import { editorAdapter as antigravityEditorAdapter } from "../../../../src/definitions/editor/antigravity/adapter"
import { editorAdapter as claudeCodeEditorAdapter } from "../../../../src/definitions/editor/claude-code/adapter"
import { editorAdapter as codexEditorAdapter } from "../../../../src/definitions/editor/codex/adapter"
import { editorAdapter as cursorEditorAdapter } from "../../../../src/definitions/editor/cursor/adapter"
import { editorAdapter as hermesEditorAdapter } from "../../../../src/definitions/editor/hermes/adapter"
import { editorAdapter as windsurfEditorAdapter } from "../../../../src/definitions/editor/windsurf/adapter"
import { editorAdapter as workbuddyEditorAdapter } from "../../../../src/definitions/editor/workbuddy/adapter"
import { agentRuntimeDefinition as claudeCodeAgentRuntimeDefinition } from "../../../../src/definitions/agent/claude-code/agent-main"
import { mcpDefinition as antigravityMcpDefinition } from "../../../../src/definitions/editor/antigravity/mcp"
import { mcpDefinition as claudeCodeMcpDefinition } from "../../../../src/definitions/editor/claude-code/mcp"
import { mcpDefinition as codexMcpDefinition } from "../../../../src/definitions/editor/codex/mcp"
import { mcpDefinition as cursorMcpDefinition } from "../../../../src/definitions/editor/cursor/mcp"
import { mcpDefinition as hermesMcpDefinition } from "../../../../src/definitions/editor/hermes/mcp"
import { mcpDefinition as windsurfMcpDefinition } from "../../../../src/definitions/editor/windsurf/mcp"
import { mcpDefinition as workbuddyMcpDefinition } from "../../../../src/definitions/editor/workbuddy/mcp"
import { installStrategy as antigravityInstallStrategy } from "../../../../src/definitions/editor/antigravity/install"
import { installStrategy as claudeCodeInstallStrategy } from "../../../../src/definitions/editor/claude-code/install"
import { installStrategy as codexInstallStrategy } from "../../../../src/definitions/editor/codex/install"
import { installStrategy as cursorInstallStrategy } from "../../../../src/definitions/editor/cursor/install"
import { installStrategy as hermesInstallStrategy } from "../../../../src/definitions/editor/hermes/install"
import { installStrategy as windsurfInstallStrategy } from "../../../../src/definitions/editor/windsurf/install"
import { installStrategy as workbuddyInstallStrategy } from "../../../../src/definitions/editor/workbuddy/install"
import { scanStrategy as antigravityScanStrategy } from "../../../../src/definitions/editor/antigravity/scan"
import { scanStrategy as claudeCodeScanStrategy } from "../../../../src/definitions/editor/claude-code/scan"
import { scanStrategy as codexScanStrategy } from "../../../../src/definitions/editor/codex/scan"
import { scanStrategy as cursorScanStrategy } from "../../../../src/definitions/editor/cursor/scan"
import { scanStrategy as hermesScanStrategy } from "../../../../src/definitions/editor/hermes/scan"
import { scanStrategy as windsurfScanStrategy } from "../../../../src/definitions/editor/windsurf/scan"
import { scanStrategy as workbuddyScanStrategy } from "../../../../src/definitions/editor/workbuddy/scan"
import type {
  AgentRuntimeDefinition,
  EditorAdapter,
  EditorInstallStrategy,
  EditorScanStrategy,
} from "../../../../src/definitions/main-types"
import type { SynapseMcpDefinition } from "../../../../src/definitions/types"

export const editorAdapters = [
  antigravityEditorAdapter,
  claudeCodeEditorAdapter,
  codexEditorAdapter,
  cursorEditorAdapter,
  hermesEditorAdapter,
  windsurfEditorAdapter,
  workbuddyEditorAdapter,
].sort((left, right) => left.order - right.order) satisfies EditorAdapter[]

export const editorAdapterById = new Map(
  editorAdapters.map((adapter) => [adapter.id, adapter]),
)

export const agentRuntimeDefinitions = [
  claudeCodeAgentRuntimeDefinition,
].sort((left, right) => left.order - right.order) satisfies AgentRuntimeDefinition[]

export const agentRuntimeDefinitionById = new Map<string, AgentRuntimeDefinition>(
  agentRuntimeDefinitions.map((definition) => [definition.id, definition]),
)

export const mcpDefinitions = [
  antigravityMcpDefinition,
  claudeCodeMcpDefinition,
  codexMcpDefinition,
  cursorMcpDefinition,
  hermesMcpDefinition,
  windsurfMcpDefinition,
  workbuddyMcpDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseMcpDefinition[]

export const editorInstallStrategyById = new Map<string, EditorInstallStrategy>([
  [antigravityEditorAdapter.id, antigravityInstallStrategy],
  [claudeCodeEditorAdapter.id, claudeCodeInstallStrategy],
  [codexEditorAdapter.id, codexInstallStrategy],
  [cursorEditorAdapter.id, cursorInstallStrategy],
  [hermesEditorAdapter.id, hermesInstallStrategy],
  [windsurfEditorAdapter.id, windsurfInstallStrategy],
  [workbuddyEditorAdapter.id, workbuddyInstallStrategy],
])

export const editorScanStrategyById = new Map<string, EditorScanStrategy>([
  [antigravityEditorAdapter.id, antigravityScanStrategy],
  [claudeCodeEditorAdapter.id, claudeCodeScanStrategy],
  [codexEditorAdapter.id, codexScanStrategy],
  [cursorEditorAdapter.id, cursorScanStrategy],
  [hermesEditorAdapter.id, hermesScanStrategy],
  [windsurfEditorAdapter.id, windsurfScanStrategy],
  [workbuddyEditorAdapter.id, workbuddyScanStrategy],
])
