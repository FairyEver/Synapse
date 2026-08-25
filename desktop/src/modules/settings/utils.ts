import type {
  SynapseConfigPatch,
  SynapseProjectConfig,
  SynapseRepositoryConfig,
  SynapseThemeMode,
} from "@/types/config"
import type { SettingItem, SettingsContext } from "@/modules/settings/types"

function getGlobalSettingValue(key: string, context: SettingsContext, fallback: unknown): unknown {
  switch (key) {
    case "themeMode":
      return context.config.global.themeMode
    case "projects":
      return context.config.global.projects
    default:
      return fallback
  }
}

function createGlobalSettingPatch(key: string, value: unknown): SynapseConfigPatch | null {
  switch (key) {
    case "themeMode":
      return { global: { themeMode: String(value ?? "") as SynapseThemeMode } }
    case "projects":
      return { global: { projects: value as SynapseProjectConfig[] } }
    default:
      return null
  }
}

function getSettingValue(item: SettingItem, context: SettingsContext): unknown {
  if (item.getValue) {
    return item.getValue(context)
  }

  if (item.key === "repositories") {
    return context.config.repositories
  }

  if (item.key.startsWith("global.")) {
    return getGlobalSettingValue(item.key.slice("global.".length), context, item.defaultValue)
  }

  if (item.key === "agent.experimentalSynapseToolRouterEnabled") {
    return context.config.agent.experimentalSynapseToolRouterEnabled
  }

  return item.defaultValue
}

function createSettingPatch(item: SettingItem, value: unknown, context: SettingsContext): SynapseConfigPatch | null {
  if (item.readOnly) {
    return null
  }

  if (item.createPatch) {
    return item.createPatch(value, context)
  }

  if (item.key === "repositories") {
    return { repositories: value as SynapseRepositoryConfig[] }
  }

  if (item.key.startsWith("global.")) {
    return createGlobalSettingPatch(item.key.slice("global.".length), value)
  }

  if (item.key === "agent.experimentalSynapseToolRouterEnabled") {
    return { agent: { experimentalSynapseToolRouterEnabled: value === true } }
  }

  return null
}

export { createSettingPatch, getSettingValue }
