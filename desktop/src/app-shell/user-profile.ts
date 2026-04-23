import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseRepoProfileState,
  SynapseUserProfile,
} from "@/types/identity"

const DEFAULT_USER_PROFILE_BRIDGE_ERROR_MESSAGE =
  "当前页面没有加载 Synapse 的用户资料桥接。请确认你打开的是桌面应用窗口，而不是独立浏览器页面。"

type RendererUserProfileBridge = NonNullable<Window["synapse"]>["userProfile"]

function getUserProfileBridge(): RendererUserProfileBridge | undefined {
  return getSynapseBridge()?.userProfile
}

function readRepoProfileState(repoId: string): Promise<SynapseRepoProfileState> {
  const bridge = getUserProfileBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_USER_PROFILE_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.getRepoState(repoId)
}

function listRepoProfiles(
  repoId: string,
): Promise<ReadonlyMap<string, SynapseUserProfile>> {
  const bridge = getUserProfileBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_USER_PROFILE_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.listRepoProfiles(repoId)
}

function updateRepoDisplayName(
  repoId: string,
  displayName: string,
): Promise<SynapseUserProfile> {
  const bridge = getUserProfileBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError(DEFAULT_USER_PROFILE_BRIDGE_ERROR_MESSAGE))
  }

  return bridge.updateDisplayName(repoId, displayName)
}

export {
  listRepoProfiles,
  readRepoProfileState,
  updateRepoDisplayName,
}
