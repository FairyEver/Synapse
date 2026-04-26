import {
  Blocks,
  Braces,
  Database,
  FolderGit2,
  FolderKanban,
  Info,
  Plug,
  ScrollText,
  Settings2,
  Shield,
} from "lucide-react"
import {
  DEFAULT_GLOBAL_CONFIG,
} from "@/constants/defaults"
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
    id: "projects",
    icon: FolderKanban,
    label: "项目",
    description: "项目路径。",
  },
  {
    id: "tools",
    icon: Blocks,
    label: "工具",
    description: "编辑器与命令行工具。",
  },
  {
    id: "connectors",
    icon: Plug,
    label: "连接器",
    description: "飞书远程控制。",
  },
  {
    id: "variables",
    icon: Braces,
    label: "变量",
    description: "安装时替换占位符。",
  },
  {
    id: "data-store",
    icon: Database,
    label: "数据服务",
    description: "本地数据库。",
  },
  {
    id: "logs",
    icon: ScrollText,
    label: "调试",
    description: "日志导出。",
  },
  {
    id: "about",
    icon: Info,
    label: "关于",
    description: "版本与更新。",
  },
  {
    id: "admin",
    icon: Shield,
    label: "管理员",
    description: "仓库维护与高级设置。",
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
    key: "global.projects",
    label: "本地项目",
    category: "projects",
    type: "list",
    defaultValue: DEFAULT_GLOBAL_CONFIG.projects,
    scope: "global",
  },
]

export { settingsCategories, settingsItems }
