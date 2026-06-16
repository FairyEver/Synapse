import { listSystemAppDefinitions } from "./definitions"
import type { SynapseSystemAppManifest } from "./types"
import { isSystemAppId } from "./types"

const systemApps: readonly SynapseSystemAppManifest[] = listSystemAppDefinitions().map((app) => ({
  ...app,
  icon: `${app.id}.png`,
}))

export function listSystemApps(): readonly SynapseSystemAppManifest[] {
  return systemApps
}

export function getSystemAppManifest(appId: string): SynapseSystemAppManifest | null {
  if (!isSystemAppId(appId)) return null
  return systemApps.find((app) => app.id === appId) ?? null
}
