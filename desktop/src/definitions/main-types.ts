import type {
  ClaudeProcessRunner,
} from "../../electron/services/agent-runtime/adapters/claude-code"
import type {
  CodexProcessRunner,
} from "../../electron/services/agent-runtime/adapters/codex-exec"
import type { AgentAdapter } from "../../electron/services/agent-runtime/types"
import type {
  ProviderConfigView,
  ProviderRuntimeView,
} from "../../electron/services/provider-config/types"
import type { SynapseContentAttachmentRecord, SynapseContentDetail } from "../types/content"
import type { SynapseContentType } from "../types/content"
import type {
  SynapseEditorAdapterSummary,
  SynapseEditorInstallFormValues,
  SynapseEditorResolvedTarget,
  SynapseInstallToEditorPayload,
} from "../types/editor"
import type { SynapseAgentBaseDefinition } from "./types"

export type EditorAdapterResolveContext = {
  contentId: string
  contentType: SynapseContentType
  skillName?: string
  skillTitle?: string
  ruleName?: string
}

export type EditorGlobalDirectoryPaths = {
  rulesPath: string | null
  skillsPath: string | null
}

export type EditorScanPathConfig = {
  globalSkillsPath: string | null
  globalSkillPaths?: readonly string[]
  globalRulesPath: string | null
  rulesSupported: boolean
  detectionDir: string
  projectPaths: (projectPath: string) => {
    skillsPath: string
    rulesPath: string
  }
}

export interface EditorAdapter extends SynapseEditorAdapterSummary {
  resolveGlobalDirectoryPaths(): EditorGlobalDirectoryPaths
  resolveGlobalTarget(context: EditorAdapterResolveContext): Promise<SynapseEditorResolvedTarget>
  resolveProjectTarget(
    projectPath: string,
    context: EditorAdapterResolveContext,
  ): Promise<SynapseEditorResolvedTarget>
  getScanPathConfig(): EditorScanPathConfig
}

export type PrepareRuleFileContentContext = {
  payload: SynapseInstallToEditorPayload
  targetPath: string
  ruleBody: string
  readExistingTextFile: (targetPath: string) => Promise<string>
}

export type PrepareSkillDirectoryContext = {
  payload: SynapseInstallToEditorPayload
  targetPath: string
  stagingDirectoryPath: string
  detail: SynapseContentDetail<"skill">
  repositoryRootPath: string
  writeTextFile: (filePath: string, content: string) => Promise<void>
  copyAttachment: (
    attachment: SynapseContentAttachmentRecord,
    targetPath: string,
  ) => Promise<void>
}

export type ReadRuleProjectFormValuesContext = {
  targetPath: string
  readExistingTextFile: (targetPath: string) => Promise<string>
}

export type EditorInstallStrategy = {
  prepareRuleFileContent(context: PrepareRuleFileContentContext): Promise<string>
  prepareSkillDirectory?(context: PrepareSkillDirectoryContext): Promise<void>
  readRuleProjectFormValues?(
    context: ReadRuleProjectFormValuesContext,
  ): Promise<SynapseEditorInstallFormValues | null>
}

export type EditorScanRuleItem = import("../types/editor-scan").EditorScanRuleItem

export type EditorScanStrategy = {
  scanRules(rulesPath: string | null): Promise<EditorScanRuleItem[]>
}

export type AgentRuntimeProcessRunner = CodexProcessRunner & ClaudeProcessRunner

export type AgentRuntimeEnvInput = {
  readonly provider?: ProviderConfigView
  readonly apiKey?: string
  readonly model?: string
}

export type AgentRuntimeEnvResult = {
  readonly env: Record<string, string | undefined>
  readonly extraEnvAllowlist?: readonly string[]
}

export type AgentRuntimeDefinition = SynapseAgentBaseDefinition & {
  createAdapter(
    view: ProviderRuntimeView,
    runner: AgentRuntimeProcessRunner,
  ): AgentAdapter
  buildEnv(input: AgentRuntimeEnvInput): AgentRuntimeEnvResult
}
