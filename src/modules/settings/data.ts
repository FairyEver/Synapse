import {
  FileText,
  FolderGit2,
  FolderKanban,
  Info,
  Logs,
  Settings2,
} from "lucide-react"
import {
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_REPOSITORY_CONTENT_DIRECTORIES,
} from "@/constants/defaults"
import { CONTENT_TYPE_DEFINITIONS } from "@/config/content-types"
import type { SettingItem, SettingsCategory } from "@/modules/settings/types"
import { SYNAPSE_THEME_MODE_OPTIONS } from "@/types/config"

const settingsCategories: SettingsCategory[] = [
  {
    id: "general",
    icon: Settings2,
    label: "通用",
    description: "身份和外观。",
  },
  {
    id: "repositories",
    icon: FolderGit2,
    label: "仓库",
    description: "本地目录。",
  },
  {
    id: "content",
    icon: FileText,
    label: "内容",
    description: "内容目录与整理。",
  },
  {
    id: "projects",
    icon: FolderKanban,
    label: "项目",
    description: "项目路径。",
  },
  {
    id: "logs",
    icon: Logs,
    label: "日志",
    description: "运行日志。",
  },
  {
    id: "about",
    icon: Info,
    label: "关于",
    description: "版本与更新。",
  },
]

const contentDirectoryItems: SettingItem[] = CONTENT_TYPE_DEFINITIONS.map((definition) => ({
  key: `activeRepository.contentDirs.${definition.id}`,
  label: `${definition.pluralLabel} 主目录名`,
  description: `当前 ${definition.pluralLabel} 内容存储的目录名称`,
  category: "content",
  type: "text",
  defaultValue: DEFAULT_REPOSITORY_CONTENT_DIRECTORIES[definition.id],
  readOnly: true,
  visible: ({ activeRepository }) => activeRepository !== null,
  scope: "repo",
}))

const settingsItems: SettingItem[] = [
  {
    key: "global.themeMode",
    label: "外观",
    category: "general",
    type: "select",
    defaultValue: DEFAULT_GLOBAL_CONFIG.themeMode,
    options: SYNAPSE_THEME_MODE_OPTIONS.map((value) => ({
      label:
        value === "light"
          ? "浅色"
          : value === "dark"
            ? "深色"
            : "跟随系统",
      value,
    })),
    scope: "global",
  },
  {
    key: "repositories",
    label: "本地仓库目录",
    category: "repositories",
    type: "list",
    defaultValue: [],
    scope: "global",
  },
  ...contentDirectoryItems,
  {
    key: "global.projects",
    label: "本地项目",
    category: "projects",
    type: "list",
    defaultValue: DEFAULT_GLOBAL_CONFIG.projects,
    scope: "global",
  },
]

export { settingsCategories, settingsItems }
