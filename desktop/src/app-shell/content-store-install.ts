import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseContentStoreInstallPrepareResult,
  SynapseContentStoreInstallResolveResult,
} from "@/types/content-store-install"

const DEFAULT_CONTENT_STORE_INSTALL_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的安装桥接。"

type RendererContentStoreInstallBridge = NonNullable<Window["synapse"]>["contentStoreInstall"]

function requireContentStoreInstallBridge(): RendererContentStoreInstallBridge {
  const bridge = getSynapseBridge()?.contentStoreInstall
  if (!bridge) {
    throw createMissingBridgeError(DEFAULT_CONTENT_STORE_INSTALL_BRIDGE_ERROR_MESSAGE)
  }
  return bridge
}

async function resolveContentStoreInstallSession(
  sessionId: string,
): Promise<SynapseContentStoreInstallResolveResult> {
  return requireContentStoreInstallBridge().resolve(sessionId)
}

async function prepareContentStoreInstallPackage(
  sessionId: string,
): Promise<SynapseContentStoreInstallPrepareResult> {
  return requireContentStoreInstallBridge().prepare(sessionId)
}

async function recordContentStoreInstallComplete(sessionId: string): Promise<{ ok: true }> {
  return requireContentStoreInstallBridge().recordComplete(sessionId)
}

export {
  prepareContentStoreInstallPackage,
  recordContentStoreInstallComplete,
  resolveContentStoreInstallSession,
}
