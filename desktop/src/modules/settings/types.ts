import type { LucideIcon } from "lucide-react"
import type {
  SynapseConfig,
  SynapseConfigPatch,
  SynapseProjectConfig,
  SynapseRepositoryConfig,
} from "@/types/config"

type SettingsCategoryId = "account" | "general" | "dock" | "repositories" | "projects" | "claude-code" | "troubleshooting" | "about" | "admin"

type SettingsItemType = "text" | "select" | "toggle" | "number" | "path" | "list"

type SettingsScope = "global" | "repo"

type SettingsOption = {
  label: string
  value: string
}

type SettingsContext = {
  config: SynapseConfig
  activeRepository: SynapseRepositoryConfig | null
}

type SettingsCategory = {
  id: SettingsCategoryId
  icon: LucideIcon
  label: string
  description: string
}

type SettingItem = {
  key: string
  label: string
  description?: string
  category: SettingsCategoryId
  type: SettingsItemType
  defaultValue: unknown
  options?: SettingsOption[]
  validation?: (value: unknown, context: SettingsContext) => string | null
  visible?: (context: SettingsContext) => boolean
  scope: SettingsScope
  readOnly?: boolean
  getValue?: (context: SettingsContext) => unknown
  createPatch?: (value: unknown, context: SettingsContext) => SynapseConfigPatch | null
}

type SettingsListValue = SynapseRepositoryConfig[] | SynapseProjectConfig[]

export type {
  SettingItem,
  SettingsCategory,
  SettingsCategoryId,
  SettingsContext,
  SettingsItemType,
  SettingsListValue,
  SettingsOption,
  SettingsScope,
}
