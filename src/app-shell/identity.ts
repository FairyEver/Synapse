import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseLocalIdentityState } from "@/types/identity"

const DEFAULT_IDENTITY_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的身份桥接。请确认你打开的是桌面应用窗口，而不是独立浏览器页面。"

type RendererIdentityBridge = NonNullable<Window["synapse"]>["identity"]

function getIdentityBridge(): RendererIdentityBridge | undefined {
  return getSynapseBridge()?.identity
}

function readLocalIdentityState(): Promise<SynapseLocalIdentityState> {
  const bridge = getIdentityBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_IDENTITY_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getLocalState()
}

function adoptExistingIdentityUserId(
  userId: string,
  repoId: string,
): Promise<SynapseLocalIdentityState> {
  const bridge = getIdentityBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_IDENTITY_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.adoptExistingUserId(userId, repoId)
}

function generateNewIdentity(): Promise<SynapseLocalIdentityState> {
  const bridge = getIdentityBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_IDENTITY_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.generateNewId()
}

export {
  adoptExistingIdentityUserId,
  generateNewIdentity,
  readLocalIdentityState,
}
