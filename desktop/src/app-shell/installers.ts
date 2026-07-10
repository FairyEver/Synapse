import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseContentInstallResult } from "@/types/editor"
import type {
  SynapseInstallSourceToEditorPayload,
  SynapseInstallSourceToEditorTargetsPayload,
  SynapseInstallSourceToEditorTargetsResult,
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
  SynapseRuleInstallerSource,
  SynapseSkillEnvInspectionResult,
  SynapseSkillInstallerSource,
} from "@/types/installers"

const DEFAULT_INSTALLERS_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 安装器桥接。"

type RendererInstallersBridge = NonNullable<Window["synapse"]>["installers"]

function requireInstallersBridge(): RendererInstallersBridge {
  const bridge = getSynapseBridge()?.installers
  if (!bridge) {
    throw createMissingBridgeError(DEFAULT_INSTALLERS_BRIDGE_ERROR_MESSAGE)
  }
  return bridge
}

async function prepareLocalSkillSource(
  payload: SynapsePrepareLocalSkillSourcePayload,
): Promise<SynapseSkillInstallerSource> {
  return requireInstallersBridge().prepareLocalSkillSource(payload)
}

async function prepareInlineRuleSource(
  payload: SynapsePrepareInlineRuleSourcePayload,
): Promise<SynapseRuleInstallerSource> {
  return requireInstallersBridge().prepareInlineRuleSource(payload)
}

async function inspectSkillEnvSource(
  source: SynapseSkillInstallerSource,
): Promise<SynapseSkillEnvInspectionResult> {
  return requireInstallersBridge().inspectSkillEnvSource(source)
}

async function installSourceToEditor(
  payload: SynapseInstallSourceToEditorPayload,
): Promise<SynapseContentInstallResult> {
  return requireInstallersBridge().installSourceToEditor(payload)
}

async function installSourceToEditorTargets(
  payload: SynapseInstallSourceToEditorTargetsPayload,
): Promise<SynapseInstallSourceToEditorTargetsResult> {
  return requireInstallersBridge().installSourceToEditorTargets(payload)
}

export {
  inspectSkillEnvSource,
  installSourceToEditorTargets,
  installSourceToEditor,
  prepareInlineRuleSource,
  prepareLocalSkillSource,
}
