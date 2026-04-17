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
    description: "维护全局昵称和界面语言。",
  },
  {
    id: "repositories",
    label: "仓库",
    description: "管理本地仓库目录。",
  },
  {
    id: "content",
    label: "内容",
    description: "配置当前目录里的 Rules / Skills 主目录。",
  },
  {
    id: "projects",
    label: "项目",
    description: "维护本地项目路径，为后续安装流程预留入口。",
  },
  {
    id: "logs",
    label: "日志",
    description: "查看当前运行日志并导出文本文件。",
  },
  {
    id: "about",
    label: "关于",
    description: "查看版本信息并预留更新入口。",
  },
]

const settingsItems: SettingItem[] = [
  {
    key: "global.displayName",
    label: "显示昵称",
    description: "用于后续生成 Rule / Skill 的 author 字段，也会参与 PR 分支命名。",
    category: "general",
    type: "text",
    defaultValue: DEFAULT_GLOBAL_CONFIG.displayName,
    scope: "global",
  },
  {
    key: "global.language",
    label: "界面语言",
    description: "当前先提供界面层配置项，语言资源会在后续迭代中逐步补齐。",
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
    description: "管理目录和当前激活项。",
    category: "repositories",
    type: "list",
    defaultValue: [],
    scope: "global",
  },
  {
    key: "activeRepository.rulesDir",
    label: "Rules 主目录名",
    description: "当前目录下 Rules 的顶层目录。切换目录时这项配置会一起切换。",
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
    description: "当前目录下 Skills 的顶层目录。切换目录时这项配置会一起切换。",
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
    description: "项目列表属于全局配置，不随仓库切换。后续安装流程会直接复用这里的路径。",
    category: "projects",
    type: "list",
    defaultValue: DEFAULT_GLOBAL_CONFIG.projects,
    scope: "global",
  },
  {
    key: "app.version",
    label: "当前版本",
    description: "版本号直接来自应用构建信息。",
    category: "about",
    type: "text",
    defaultValue: packageJson.version,
    scope: "global",
    readOnly: true,
    getValue: () => packageJson.version,
  },
]

export { settingsCategories, settingsItems }
