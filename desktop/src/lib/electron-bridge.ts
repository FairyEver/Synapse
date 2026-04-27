import type { SynapseBridge } from "@/types/bridge"

const DEFAULT_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的 Electron bridge。请确认你打开的是桌面应用窗口，而不是独立浏览器页面。"

type SynapseBridgeDomain = Exclude<keyof SynapseBridge, "platform" | "versions">

function getSynapseBridge(): SynapseBridge | undefined {
  return (window as Window & { synapse?: SynapseBridge }).synapse
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

function requireBridgeDomain<K extends SynapseBridgeDomain>(domain: K): SynapseBridge[K] {
  const bridge = getSynapseBridge()
  const domainBridge = bridge?.[domain]

  if (!domainBridge) {
    throw new Error(`${String(domain)} bridge not available`)
  }

  return domainBridge
}

export {
  createMissingBridgeError,
  getSynapseBridge,
  requireBridgeDomain,
  requireSynapseBridge,
}
