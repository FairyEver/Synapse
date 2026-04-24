import { ideDefinition as claudeCodeIdeDefinition } from "../claude-code/ide"
import { ideDefinition as codexIdeDefinition } from "../codex/ide"
import { ideDefinition as cursorIdeDefinition } from "../cursor/ide"
import { cliDefinition as claudeCodeCliDefinition } from "../claude-code/cli"
import { cliDefinition as codexCliDefinition } from "../codex/cli"
import { mcpDefinition as claudeCodeMcpDefinition } from "../claude-code/mcp"
import { mcpDefinition as codexMcpDefinition } from "../codex/mcp"
import { mcpDefinition as cursorMcpDefinition } from "../cursor/mcp"
import { installFormDefinition as claudeCodeInstallFormDefinition } from "../claude-code/forms"
import { installFormDefinition as cursorInstallFormDefinition } from "../cursor/forms"
import type { SynapseCliDefinition, SynapseIdeDefinition, SynapseInstallFormDefinition, SynapseMcpDefinition } from "../types"

export const ideDefinitions = [
  claudeCodeIdeDefinition,
  codexIdeDefinition,
  cursorIdeDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseIdeDefinition[]

export const cliDefinitions = [
  claudeCodeCliDefinition,
  codexCliDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseCliDefinition[]

export const mcpDefinitions = [
  claudeCodeMcpDefinition,
  codexMcpDefinition,
  cursorMcpDefinition,
].sort((left, right) => left.order - right.order) satisfies SynapseMcpDefinition[]

export const installFormDefinitionByEditorId = new Map<string, SynapseInstallFormDefinition>([
  ["claude-code", claudeCodeInstallFormDefinition],
  ["cursor", cursorInstallFormDefinition],
])
