// 基础时间单位：用于派生全局配置里的 1 小时时长，避免重复写魔法数字。
const ONE_HOUR_MS = 60 * 60 * 1000

// Agent 会话在最近活动结束后超过该时长时，提示用户新建对话以避免继续沿用长上下文。
export const CONVERSATION_IDLE_ROLLOVER_PROMPT_MS = ONE_HOUR_MS

// 顶部导航菜单：定义每个菜单的内部英文标识、中文显示文案和显示顺序，调整这里即可改变主窗口顶部 tab。
export const APP_NAVIGATION_TABS = [
  { id: "skill", label: "技能" },
  { id: "rule", label: "规则" },
  { id: "prompt", label: "提示词" },
  { id: "agent", label: "对话" },
  { id: "task-scheduler", label: "定时" },
  { id: "automation", label: "自动化" },
  { id: "workflow", label: "工作流", requiresWorkflowEntry: true },
  { id: "drive", label: "云盘" },
  { id: "tools", label: "工具" },
  { id: "editor-scan", label: "IDE" },
  { id: "usage-cc", label: "CC" },
  { id: "usage-codex", label: "Codex" },
  { id: "model-price", label: "价格" },
  { id: "settings", label: "设置" },
] as const

// 工作流入口默认显示开关：为 true 时所有用户直接看到工作流入口；为 false 时继续通过金手指状态控制入口显隐。
export const WORKFLOW_ENTRY_VISIBLE_BY_DEFAULT = false

// 日志复制到剪贴板的最大总字节数：限制设置页复制日志和主进程读取日志的单次文本体积，完整日志应通过导出 zip 获取。
export const LOG_CLIPBOARD_MAX_BYTES = 2 * 1024 * 1024

// 默认激活的顶部导航菜单：主窗口有内容仓库时默认进入这个 tab。
export const DEFAULT_APP_NAVIGATION_TAB_ID = "skill" satisfies AppNavigationTabId

export type AppNavigationTabId = (typeof APP_NAVIGATION_TABS)[number]["id"]
