import type { SynapseBridge } from "@/types/bridge"

const DEFAULT_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的 Electron bridge。请确认你打开的是桌面应用窗口，而不是独立浏览器页面。"

function getSynapseBridge(): SynapseBridge | undefined {
  return window.synapse
}

function createMissingBridgeError(message = DEFAULT_BRIDGE_ERROR_MESSAGE): Error {
  return new Error(message)
}

function requireSynapseBridge(message = DEFAULT_BRIDGE_ERROR_MESSAGE): SynapseBridge {
  const bridge = getSynapseBridge()

  if (!bridge) {
    throw createMissingBridgeError(message)
  }

  return bridge
}

export {
  createMissingBridgeError,
  getSynapseBridge,
  requireSynapseBridge,
}
