import {
  Activity,
  Bot,
  Braces,
  FolderGit2,
  FolderOpen,
  Info,
  CircleUserRound,
  Settings2,
  Shield,
  TextCursorInput,
} from "lucide-react"
import {
  DEFAULT_GLOBAL_CONFIG,
} from "@/constants/defaults"
import type { SettingItem, SettingsCategory } from "@/modules/settings/types"
import { SYNAPSE_THEME_MODE_OPTIONS } from "@/types/config"

const settingsCategories: SettingsCategory[] = [
  {
    id: "account",
    icon: CircleUserRound,
    label: "账号",
    description: "登录状态。",
  },
  {
    id: "general",
    icon: Settings2,
    label: "基础设置",
    description: "身份、外观与应用数据。",
  },
  {
    id: "repositories",
    icon: FolderGit2,
    label: "资源仓库",
    description: "管理 Synapse 内容仓库。",
  },
  {
    id: "projects",
    icon: FolderOpen,
    label: "项目和知识库",
    description: "管理 Agent 可用项目。",
  },
  {
    id: "quick-inputs",
    icon: TextCursorInput,
    label: "提示词片段",
    description: "维护常用片段。",
  },
  {
    id: "claude-code",
    icon: Bot,
    label: "模型与供应商",
    description: "模型供应商和默认模型。",
  },
  {
    id: "variables",
    icon: Braces,
    label: "私人令牌",
    description: "管理内容安装占位符。",
  },
  {
    id: "troubleshooting",
    icon: Activity,
    label: "诊断日志",
    description: "诊断结果和运行日志。",
  },
  {
    id: "about",
    icon: Info,
    label: "关于 Synapse",
    description: "版本、更新和管理员模式。",
  },
  {
    id: "admin",
    icon: Shield,
    label: "仓库维护",
    description: "当前仓库的维护操作。",
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
