import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseIdentityState } from "@/types/identity"

const DEFAULT_IDENTITY_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的身份桥接。请确认你打开的是桌面应用窗口，而不是独立浏览器页面。"

type RendererIdentityBridge = NonNullable<Window["synapse"]>["identity"]

function getIdentityBridge(): RendererIdentityBridge | undefined {
  return getSynapseBridge()?.identity
}

function readIdentityState(): Promise<SynapseIdentityState> {
  const bridge = getIdentityBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_IDENTITY_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getState()
}

function updateIdentityDisplayName(displayName: string): Promise<SynapseIdentityState> {
  const bridge = getIdentityBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_IDENTITY_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.updateDisplayName(displayName)
}

function replaceIdentityUserId(userId: string): Promise<SynapseIdentityState> {
  const bridge = getIdentityBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_IDENTITY_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.replaceUserId(userId)
}

function generateNewIdentity(): Promise<SynapseIdentityState> {
  const bridge = getIdentityBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_IDENTITY_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.generateNewId()
}

export {
  generateNewIdentity,
  readIdentityState,
  replaceIdentityUserId,
  updateIdentityDisplayName,
}
