import type { SynapseSystemAppDefinition, SynapseSystemAppId } from "./types"
import { isSystemAppId } from "./types"

const systemAppDefinitions: readonly SynapseSystemAppDefinition[] = [
  {
    id: "resource-repository",
    type: "system",
    name: "资源仓库",
    windowTitle: "资源仓库",
    defaultView: "skill",
    removable: false,
    renameable: false,
    iconEditable: false,
  },
  {
    id: "database",
    type: "system",
    name: "本地数据库",
    windowTitle: "本地数据库",
    removable: false,
    renameable: false,
    iconEditable: false,
  },
  {
    id: "editor-scan",
    type: "system",
    name: "IDE 管理",
    windowTitle: "IDE 管理",
    removable: false,
    renameable: false,
    iconEditable: false,
  },
  {
    id: "usage-monitor",
    type: "system",
    name: "用量监控",
    windowTitle: "用量监控",
    defaultView: "cc",
    removable: false,
    renameable: false,
    iconEditable: false,
  },
  {
    id: "model-price",
    type: "system",
    name: "价格管理",
    windowTitle: "价格管理",
    removable: false,
    renameable: false,
    iconEditable: false,
  },
] as const

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
