import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
  SynapseRuleInstallerSource,
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

export {
  prepareInlineRuleSource,
  prepareLocalSkillSource,
}
