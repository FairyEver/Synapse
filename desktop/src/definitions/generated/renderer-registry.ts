import { editorDefinition as claudeCodeEditorDefinition } from "../editor/claude-code/editor"
import { editorDefinition as codexEditorDefinition } from "../editor/codex/editor"
import { editorDefinition as cursorEditorDefinition } from "../editor/cursor/editor"
import { editorDefinition as windsurfEditorDefinition } from "../editor/windsurf/editor"
import { cliDefinition as claudeCodeCliDefinition } from "../editor/claude-code/cli"
import { cliDefinition as codexCliDefinition } from "../editor/codex/cli"
import { mcpDefinition as claudeCodeMcpDefinition } from "../editor/claude-code/mcp"
import { mcpDefinition as codexMcpDefinition } from "../editor/codex/mcp"
import { mcpDefinition as cursorMcpDefinition } from "../editor/cursor/mcp"
import { mcpDefinition as windsurfMcpDefinition } from "../editor/windsurf/mcp"
import { installFormDefinition as claudeCodeInstallFormDefinition } from "../editor/claude-code/forms"
import { installFormDefinition as cursorInstallFormDefinition } from "../editor/cursor/forms"
import { installFormDefinition as windsurfInstallFormDefinition } from "../editor/windsurf/forms"
import type { SynapseCliDefinition, SynapseEditorDefinition, SynapseInstallFormDefinition, SynapseRendererMcpDefinition } from "../types"

export const editorDefinitions = [
  claudeCodeEditorDefinition,
  codexEditorDefinition,
  cursorEditorDefinition,
  windsurfEditorDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseEditorDefinition[]

export const cliDefinitions = [
  claudeCodeCliDefinition,
  codexCliDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseCliDefinition[]

export const mcpDefinitions = [
  { ...claudeCodeMcpDefinition, icon: claudeCodeEditorDefinition.icon },
  { ...codexMcpDefinition, icon: codexEditorDefinition.icon },
  { ...cursorMcpDefinition, icon: cursorEditorDefinition.icon },
  { ...windsurfMcpDefinition, icon: windsurfEditorDefinition.icon },
].sort((left, right) => left.order - right.order) satisfies SynapseRendererMcpDefinition[]

export const installFormDefinitionByEditorId = new Map<string, SynapseInstallFormDefinition>([
  ["claude-code", claudeCodeInstallFormDefinition],
  ["cursor", cursorInstallFormDefinition],
  ["windsurf", windsurfInstallFormDefinition],
])
