import { ideDefinition as claudeCodeIdeDefinition } from "../claude-code/ide"
import { ideDefinition as codexIdeDefinition } from "../codex/ide"
import { ideDefinition as cursorIdeDefinition } from "../cursor/ide"
import { ideDefinition as windsurfIdeDefinition } from "../windsurf/ide"
import { cliDefinition as claudeCodeCliDefinition } from "../claude-code/cli"
import { cliDefinition as codexCliDefinition } from "../codex/cli"
import { mcpDefinition as claudeCodeMcpDefinition } from "../claude-code/mcp"
import { mcpDefinition as codexMcpDefinition } from "../codex/mcp"
import { mcpDefinition as cursorMcpDefinition } from "../cursor/mcp"
import { mcpDefinition as windsurfMcpDefinition } from "../windsurf/mcp"
import { installFormDefinition as claudeCodeInstallFormDefinition } from "../claude-code/forms"
import { installFormDefinition as cursorInstallFormDefinition } from "../cursor/forms"
import { installFormDefinition as windsurfInstallFormDefinition } from "../windsurf/forms"
import type { SynapseCliDefinition, SynapseIdeDefinition, SynapseInstallFormDefinition, SynapseRendererMcpDefinition } from "../types"

export const ideDefinitions = [
  claudeCodeIdeDefinition,
  codexIdeDefinition,
  cursorIdeDefinition,
  windsurfIdeDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseIdeDefinition[]

export const cliDefinitions = [
  claudeCodeCliDefinition,
  codexCliDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseCliDefinition[]

export const mcpDefinitions = [
  { ...claudeCodeMcpDefinition, icon: claudeCodeIdeDefinition.icon },
  { ...codexMcpDefinition, icon: codexIdeDefinition.icon },
  { ...cursorMcpDefinition, icon: cursorIdeDefinition.icon },
  { ...windsurfMcpDefinition, icon: windsurfIdeDefinition.icon },
].sort((left, right) => left.order - right.order) satisfies SynapseRendererMcpDefinition[]

export const installFormDefinitionByEditorId = new Map<string, SynapseInstallFormDefinition>([
  ["claude-code", claudeCodeInstallFormDefinition],
  ["cursor", cursorInstallFormDefinition],
  ["windsurf", windsurfInstallFormDefinition],
])
