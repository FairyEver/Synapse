import {
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_REPOSITORY_CONTENT_DIRECTORIES,
} from "@/constants/defaults"
import type { SettingItem, SettingsCategory } from "@/modules/settings/types"
import { SYNAPSE_THEME_MODE_OPTIONS } from "@/types/config"

function validateRepositoryDirectoryName(value: unknown): string | null {
  const nextValue = typeof value === "string" ? value.trim() : ""

  if (!nextValue) {
    return "目录名不能为空。"
  }

  if (/[\\/]/.test(nextValue)) {
    return "目录名只能是单层目录，不能包含斜杠。"
  }

  return null
}

const settingsCategories: SettingsCategory[] = [
  {
    id: "general",
    label: "通用",
    description: "身份和外观。",
  },
  {
    id: "repositories",
    label: "仓库",
    description: "本地目录。",
  },
  {
    id: "content",
    label: "内容",
    description: "Rules 和 Skills 目录。",
  },
  {
    id: "projects",
    label: "项目",
    description: "项目路径。",
  },
  {
    id: "logs",
    label: "日志",
    description: "运行日志。",
  },
  {
    id: "about",
    label: "关于",
    description: "版本与更新。",
  },
]

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
  {
    key: "activeRepository.rulesDir",
    label: "Rules 主目录名",
    category: "content",
    type: "text",
    defaultValue: DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.rulesDir,
    validation: validateRepositoryDirectoryName,
    visible: ({ activeRepository }) => activeRepository !== null,
    scope: "repo",
  },
  {
    key: "activeRepository.skillsDir",
    label: "Skills 主目录名",
    category: "content",
    type: "text",
    defaultValue: DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.skillsDir,
    validation: validateRepositoryDirectoryName,
    visible: ({ activeRepository }) => activeRepository !== null,
    scope: "repo",
  },
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
