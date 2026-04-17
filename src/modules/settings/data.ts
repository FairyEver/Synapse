import packageJson from "../../../package.json"
import {
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_REPOSITORY_CONTENT_DIRECTORIES,
} from "@/constants/defaults"
import type { SettingItem, SettingsCategory } from "@/modules/settings/types"
import { SYNAPSE_LANGUAGE_OPTIONS } from "@/types/config"

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
    description: "昵称和界面语言。",
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
    key: "global.displayName",
    label: "显示昵称",
    category: "general",
    type: "text",
    defaultValue: DEFAULT_GLOBAL_CONFIG.displayName,
    scope: "global",
  },
  {
    key: "global.language",
    label: "界面语言",
    category: "general",
    type: "select",
    defaultValue: DEFAULT_GLOBAL_CONFIG.language,
    options: SYNAPSE_LANGUAGE_OPTIONS.map((value) => ({
      label: value === "zh-CN" ? "简体中文" : "English",
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
  {
    key: "app.version",
    label: "当前版本",
    category: "about",
    type: "text",
    defaultValue: packageJson.version,
    scope: "global",
    readOnly: true,
    getValue: () => packageJson.version,
  },
]

export { settingsCategories, settingsItems }
