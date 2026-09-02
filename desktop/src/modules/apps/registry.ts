import { agentAppManifest } from "@/modules/agent/app-manifest"
import { agentPersonasAppManifest } from "../../../app-capabilities/agent-personas/renderer/app-manifest"
import { automationAppManifest } from "@/modules/automation/app-manifest"
import { databaseAppManifest } from "@/modules/database/app-manifest"
import { driveAppManifest } from "@/modules/drive/app-manifest"
import { synapseSkillAppManifest } from "../../../app-capabilities/synapse-skill/renderer/app-manifest"
import { secretsAppManifest } from "../../../app-capabilities/secrets/renderer/app-manifest"
import { quickInputAppManifest } from "../../../app-capabilities/quick-input/renderer/app-manifest"
import { terminalAppManifest } from "../../../app-capabilities/terminal/renderer/app-manifest"
import { editorScanAppManifest } from "@/modules/editor-scan/app-manifest"
import { gitAppManifest } from "@/modules/git/app-manifest"
import { modelPriceAppManifest } from "@/modules/model-price/app-manifest"
import { resourceRepositoryAppManifest } from "@/modules/resource-repository/app-manifest"
import { settingsAppManifest } from "@/modules/settings/app-manifest"
import { usageMonitorAppManifest } from "@/modules/usage-analysis/app-manifest"
import { workflowAppManifest } from "@/modules/workflow/app-manifest"
import { launcherAppManifest } from "./launcher-app-manifest"
import { connectorsAppManifest } from "../../../app-capabilities/connectors/renderer/app-manifest"
import type { SynapseSystemAppManifest } from "./types"
import { isSystemAppId } from "./types"
import { isSystemAppEntryVisible } from "./visibility"

const systemApps = [
  agentAppManifest,
  agentPersonasAppManifest,
  workflowAppManifest,
  driveAppManifest,
  automationAppManifest,
  launcherAppManifest,
  settingsAppManifest,
  resourceRepositoryAppManifest,
  gitAppManifest,
  databaseAppManifest,
  synapseSkillAppManifest,
  secretsAppManifest,
  quickInputAppManifest,
  terminalAppManifest,
  editorScanAppManifest,
  usageMonitorAppManifest,
  modelPriceAppManifest,
  connectorsAppManifest,
] as const satisfies readonly SynapseSystemAppManifest[]

export function listSystemApps(): readonly SynapseSystemAppManifest[] {
  return systemApps
}

export function listLaunchableSystemApps(options?: {
  readonly workflowEntryVisible?: boolean
}): readonly SynapseSystemAppManifest[] {
  return systemApps
    .filter((app) => app.id !== "launcher")
    .filter((app) => isSystemAppEntryVisible(app, {
      workflowEntryVisible: options?.workflowEntryVisible === true,
    }))
}

export function getSystemAppManifest(appId: string): SynapseSystemAppManifest | null {
  if (!isSystemAppId(appId)) return null
  return systemApps.find((app) => app.id === appId) ?? null
}
