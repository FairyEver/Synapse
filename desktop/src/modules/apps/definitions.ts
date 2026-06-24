import { databaseAppDefinition } from "../database/app-definition"
import { documentTemplateAppDefinition } from "../../../app-capabilities/document-template/renderer/app-definition"
import { terminalAppDefinition } from "../../../app-capabilities/terminal/renderer/app-definition"
import { editorScanAppDefinition } from "../editor-scan/app-definition"
import { gitAppDefinition } from "../git/app-definition"
import { modelPriceAppDefinition } from "../model-price/app-definition"
import { resourceRepositoryAppDefinition } from "../resource-repository/app-definition"
import { usageMonitorAppDefinition } from "../usage-analysis/app-definition"
import type { SynapseSystemAppDefinition, SynapseSystemAppId } from "./types"
import { isSystemAppId } from "./types"

const systemAppDefinitions = [
  resourceRepositoryAppDefinition,
  gitAppDefinition,
  databaseAppDefinition,
  documentTemplateAppDefinition,
  terminalAppDefinition,
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
