import { editorDefinition as antigravityEditorDefinition } from "../editor/antigravity/editor"
import { editorDefinition as claudeCodeEditorDefinition } from "../editor/claude-code/editor"
import { editorDefinition as codexEditorDefinition } from "../editor/codex/editor"
import { editorDefinition as cursorEditorDefinition } from "../editor/cursor/editor"
import { editorDefinition as hermesEditorDefinition } from "../editor/hermes/editor"
import { editorDefinition as windsurfEditorDefinition } from "../editor/windsurf/editor"
import { editorDefinition as workbuddyEditorDefinition } from "../editor/workbuddy/editor"
import { agentDefinition as claudeCodeAgentDefinition } from "../agent/claude-code/agent"
import { mcpDefinition as antigravityMcpDefinition } from "../editor/antigravity/mcp"
import { mcpDefinition as claudeCodeMcpDefinition } from "../editor/claude-code/mcp"
import { mcpDefinition as codexMcpDefinition } from "../editor/codex/mcp"
import { mcpDefinition as cursorMcpDefinition } from "../editor/cursor/mcp"
import { mcpDefinition as hermesMcpDefinition } from "../editor/hermes/mcp"
import { mcpDefinition as windsurfMcpDefinition } from "../editor/windsurf/mcp"
import { mcpDefinition as workbuddyMcpDefinition } from "../editor/workbuddy/mcp"
import { installFormDefinition as claudeCodeInstallFormDefinition } from "../editor/claude-code/forms"
import { installFormDefinition as cursorInstallFormDefinition } from "../editor/cursor/forms"
import { installFormDefinition as hermesInstallFormDefinition } from "../editor/hermes/forms"
import { installFormDefinition as windsurfInstallFormDefinition } from "../editor/windsurf/forms"
import type {
  SynapseAgentDefinition,
  SynapseEditorDefinition,
  SynapseInstallFormDefinition,
  SynapseRendererMcpDefinition,
} from "../types"

export const editorDefinitions = [
  antigravityEditorDefinition,
  claudeCodeEditorDefinition,
  codexEditorDefinition,
  cursorEditorDefinition,
  hermesEditorDefinition,
  windsurfEditorDefinition,
  workbuddyEditorDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseEditorDefinition[]

export const agentDefinitions = [
  claudeCodeAgentDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseAgentDefinition[]

export const mcpDefinitions = [
  { ...antigravityMcpDefinition, icon: antigravityEditorDefinition.icon },
  { ...claudeCodeMcpDefinition, icon: claudeCodeEditorDefinition.icon },
  { ...codexMcpDefinition, icon: codexEditorDefinition.icon },
  { ...cursorMcpDefinition, icon: cursorEditorDefinition.icon },
  { ...hermesMcpDefinition, icon: hermesEditorDefinition.icon },
  { ...windsurfMcpDefinition, icon: windsurfEditorDefinition.icon },
  { ...workbuddyMcpDefinition, icon: workbuddyEditorDefinition.icon },
].sort((left, right) => left.order - right.order) satisfies SynapseRendererMcpDefinition[]

export const installFormDefinitionByEditorId = new Map<string, SynapseInstallFormDefinition>([
  ["claude-code", claudeCodeInstallFormDefinition],
  ["cursor", cursorInstallFormDefinition],
  ["hermes", hermesInstallFormDefinition],
  ["windsurf", windsurfInstallFormDefinition],
])
