import { agentAppDefinition } from "../agent/app-definition"
import { automationAppDefinition } from "../automation/app-definition"
import { databaseAppDefinition } from "../database/app-definition"
import { driveAppDefinition } from "../drive/app-definition"
import { documentTemplateAppDefinition } from "../../../app-capabilities/document-template/renderer/app-definition"
import { terminalAppDefinition } from "../../../app-capabilities/terminal/renderer/app-definition"
import { screenshotAppDefinition } from "../../../app-capabilities/screenshot/renderer/app-definition"
import { editorScanAppDefinition } from "../editor-scan/app-definition"
import { gitAppDefinition } from "../git/app-definition"
import { modelPriceAppDefinition } from "../model-price/app-definition"
import { resourceRepositoryAppDefinition } from "../resource-repository/app-definition"
import { settingsAppDefinition } from "../settings/app-definition"
import { usageMonitorAppDefinition } from "../usage-analysis/app-definition"
import { workflowAppDefinition } from "../workflow/app-definition"
import { launcherAppDefinition } from "./launcher-app-definition"
import type { SynapseSystemAppDefinition, SynapseSystemAppId } from "./types"
import { isSystemAppId } from "./types"

const systemAppDefinitions = [
  agentAppDefinition,
  workflowAppDefinition,
  driveAppDefinition,
  automationAppDefinition,
  launcherAppDefinition,
  settingsAppDefinition,
  resourceRepositoryAppDefinition,
  gitAppDefinition,
  databaseAppDefinition,
  documentTemplateAppDefinition,
  terminalAppDefinition,
  screenshotAppDefinition,
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
