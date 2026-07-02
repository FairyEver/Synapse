import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseSkillRepositoryInstallPrepareResult,
  SynapseSkillRepositoryInstallResolveResult,
} from "@/types/skill-repository-install"

const DEFAULT_SKILL_REPOSITORY_INSTALL_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的安装桥接。"

type RendererSkillRepositoryInstallBridge = NonNullable<Window["synapse"]>["skillRepositoryInstall"]

function requireSkillRepositoryInstallBridge(): RendererSkillRepositoryInstallBridge {
  const bridge = getSynapseBridge()?.skillRepositoryInstall
  if (!bridge) {
    throw createMissingBridgeError(DEFAULT_SKILL_REPOSITORY_INSTALL_BRIDGE_ERROR_MESSAGE)
  }
  return bridge
}

async function resolveSkillRepositoryInstallSession(
  sessionId: string,
): Promise<SynapseSkillRepositoryInstallResolveResult> {
  return requireSkillRepositoryInstallBridge().resolve(sessionId)
}

async function prepareSkillRepositoryInstallPackage(
  sessionId: string,
): Promise<SynapseSkillRepositoryInstallPrepareResult> {
  return requireSkillRepositoryInstallBridge().prepare(sessionId)
}

async function recordSkillRepositoryInstallComplete(sessionId: string): Promise<{ ok: true }> {
  return requireSkillRepositoryInstallBridge().recordComplete(sessionId)
}

export {
  prepareSkillRepositoryInstallPackage,
  recordSkillRepositoryInstallComplete,
  resolveSkillRepositoryInstallSession,
}
