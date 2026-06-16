import { databaseAppDefinition } from "@/modules/database/app-definition"
import { editorScanAppDefinition } from "@/modules/editor-scan/app-definition"
import { modelPriceAppDefinition } from "@/modules/model-price/app-definition"
import { resourceRepositoryAppDefinition } from "@/modules/resource-repository/app-definition"
import { usageMonitorAppDefinition } from "@/modules/usage-analysis/app-definition"
import type { SynapseSystemAppDefinition, SynapseSystemAppId } from "./types"
import { isSystemAppId } from "./types"

const systemAppDefinitions = [
  resourceRepositoryAppDefinition,
  databaseAppDefinition,
  editorScanAppDefinition,
  usageMonitorAppDefinition,
  modelPriceAppDefinition,
] as const satisfies readonly SynapseSystemAppDefinition[]

export function listSystemAppDefinitions(): readonly SynapseSystemAppDefinition[] {
  return systemAppDefinitions
}

export function parseSystemAppId(value: string | null | undefined): SynapseSystemAppId | null {
  return typeof value === "string" && isSystemAppId(value) ? value : null
}

export function getSystemAppDefinition(appId: string): SynapseSystemAppDefinition | null {
  if (!isSystemAppId(appId)) return null
  return systemAppDefinitions.find((app) => app.id === appId) ?? null
}
