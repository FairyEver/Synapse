import { isSystemAppId, type SynapseSystemAppId } from "./types"

const DOCK_PINS_STORAGE_KEY = "synapse.dock.userPinnedAppIds"

type DockPinStorage = Pick<Storage, "getItem" | "setItem">

function normalizeUserPinnedDockAppIds(values: readonly unknown[]): SynapseSystemAppId[] {
  const seen = new Set<SynapseSystemAppId>()
  const result: SynapseSystemAppId[] = []

  for (const value of values) {
    if (typeof value !== "string" || !isSystemAppId(value) || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }

  return result
}

export function readUserPinnedDockAppIds(
  storage: DockPinStorage = window.localStorage,
): SynapseSystemAppId[] {
  try {
    const rawValue = storage.getItem(DOCK_PINS_STORAGE_KEY)
    if (!rawValue) return []
    const parsed = JSON.parse(rawValue) as unknown
    return Array.isArray(parsed) ? normalizeUserPinnedDockAppIds(parsed) : []
  } catch {
    return []
  }
}

export function writeUserPinnedDockAppIds(
  storage: DockPinStorage,
  appIds: readonly unknown[],
): SynapseSystemAppId[] {
  const normalized = normalizeUserPinnedDockAppIds(appIds)
  storage.setItem(DOCK_PINS_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function addUserPinnedDockAppId(
  appIds: readonly SynapseSystemAppId[],
  appId: SynapseSystemAppId,
): SynapseSystemAppId[] {
  return appIds.includes(appId) ? [...appIds] : [...appIds, appId]
}

export function removeUserPinnedDockAppId(
  appIds: readonly SynapseSystemAppId[],
  appId: SynapseSystemAppId,
): SynapseSystemAppId[] {
  return appIds.filter((item) => item !== appId)
}
