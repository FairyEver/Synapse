import { databaseAppManifest } from "@/modules/database/app-manifest"
import { documentTemplateAppManifest } from "../../../app-capabilities/document-template/renderer/app-manifest"
import { editorScanAppManifest } from "@/modules/editor-scan/app-manifest"
import { gitAppManifest } from "@/modules/git/app-manifest"
import { modelPriceAppManifest } from "@/modules/model-price/app-manifest"
import { resourceRepositoryAppManifest } from "@/modules/resource-repository/app-manifest"
import { usageMonitorAppManifest } from "@/modules/usage-analysis/app-manifest"
import type { SynapseSystemAppManifest } from "./types"
import { isSystemAppId } from "./types"

const systemApps = [
  resourceRepositoryAppManifest,
  gitAppManifest,
  databaseAppManifest,
  documentTemplateAppManifest,
  editorScanAppManifest,
  usageMonitorAppManifest,
  modelPriceAppManifest,
] as const satisfies readonly SynapseSystemAppManifest[]

export function listSystemApps(): readonly SynapseSystemAppManifest[] {
  return systemApps
}

export function getSystemAppManifest(appId: string): SynapseSystemAppManifest | null {
  if (!isSystemAppId(appId)) return null
  return systemApps.find((app) => app.id === appId) ?? null
}
