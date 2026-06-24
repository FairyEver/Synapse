// 基础时间单位：用于派生全局配置里的 1 小时时长，避免重复写魔法数字。
const ONE_HOUR_MS = 60 * 60 * 1000

// Agent 会话在最近活动结束后超过该时长时，提示用户新建对话以避免继续沿用长上下文。
export const CONVERSATION_IDLE_ROLLOVER_PROMPT_MS = ONE_HOUR_MS

// 顶部导航菜单：定义每个菜单的内部英文标识、中文显示文案和显示顺序，调整这里即可改变主窗口顶部 tab。
export const APP_NAVIGATION_TABS = [
  { id: "agent", label: "对话" },
  { id: "workflow", label: "工作流", requiresWorkflowEntry: true },
  { id: "drive", label: "云盘" },
  { id: "automation", label: "自动化" },
  { id: "apps", label: "应用" },
  { id: "settings", label: "设置" },
] as const

// 工作流入口默认显示开关：为 true 时所有用户直接看到工作流入口；为 false 时继续通过金手指状态控制入口显隐。
export const WORKFLOW_ENTRY_VISIBLE_BY_DEFAULT = false

// 日志复制到剪贴板的最大总字节数：限制设置页复制日志和主进程读取日志的单次文本体积，完整日志应通过导出 zip 获取。
export const LOG_CLIPBOARD_MAX_BYTES = 2 * 1024 * 1024

// 配置备份导入文件最大字节数：限制设置页从外部 JSON 恢复配置时主进程读取和解析的单文件体积。
export const CONFIG_BACKUP_IMPORT_MAX_BYTES = 2 * 1024 * 1024

// 终端会话单个 session 的输出保留上限：限制后台任务长时间输出占用内存和磁盘，超出后按最旧输出滚动清理。
export const TERMINAL_SESSION_OUTPUT_RETENTION_BYTES = 10 * 1024 * 1024

// Data Store 单表导出最大行数：限制表级导出一次可处理的记录数量，避免主进程长时间构造超大 SQL。
export const DATA_STORE_TABLE_EXPORT_MAX_ROWS = 10_000

// Data Store 单表导出 payload 最大字节数：限制嵌入导出 SQL 的 JSON/base64 元数据体积。
export const DATA_STORE_TABLE_EXPORT_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024

// Data Store 单表导出单元格最大字节数：限制文本和 BLOB 单元格序列化前后的体积，避免大字段放大内存占用。
export const DATA_STORE_TABLE_EXPORT_MAX_CELL_BYTES = 1024 * 1024

// Data Store 表导入文件最大字节数：限制从外部 SQL 文件读取和解析的单文件体积。
export const DATA_STORE_TABLE_IMPORT_MAX_FILE_BYTES = 32 * 1024 * 1024

// Automation Ingress Webhook 运行记录持久化保留上限：限制 webhook.runs 本地历史无限增长。
export const AUTOMATION_INGRESS_WEBHOOK_RUN_RETENTION_LIMIT = 1000

// Automation Ingress Webhook 运行记录列表返回上限：限制单次状态查询和 UI 展示读取的历史数量。
export const AUTOMATION_INGRESS_WEBHOOK_RUN_LIST_LIMIT = 100

// Reply Outbox 已发送记录保留上限：按回复目标保留最近的已发送事件，避免长会话外部回复历史无限增长。
export const REPLY_OUTBOX_SENT_RETENTION_LIMIT = 500

// 知识库资料目录上传最大文件数：限制外部文件夹递归复制进托管 .raw 时的单次文件数量，避免误选大目录拖垮主进程。
export const KNOWLEDGE_BASE_RAW_UPLOAD_MAX_FILES = 2_000

// 知识库资料目录上传最大目录深度：限制外部文件夹递归复制进托管 .raw 时的嵌套层数，避免异常深目录长时间遍历。
export const KNOWLEDGE_BASE_RAW_UPLOAD_MAX_DEPTH = 16

// 知识库资料目录上传单文件最大字节数：限制外部文件夹递归复制时的单个文件大小，超出后跳过该文件。
export const KNOWLEDGE_BASE_RAW_UPLOAD_MAX_FILE_BYTES = 256 * 1024 * 1024

// 知识库资料目录上传总字节数：限制外部文件夹递归复制进托管 .raw 时的单次总写入体积，避免误选大目录占满磁盘。
export const KNOWLEDGE_BASE_RAW_UPLOAD_MAX_TOTAL_BYTES = 1024 * 1024 * 1024

// 知识库资料导出最大选中条目数：限制单次从托管 .raw 导出到外部目录的顶层条目数量。
export const KNOWLEDGE_BASE_RAW_EXPORT_MAX_ENTRIES = 200

// 知识库资料导出最大文件数：限制目录递归导出时实际写入外部目录的文件数量。
export const KNOWLEDGE_BASE_RAW_EXPORT_MAX_FILES = 2_000

// 知识库资料导出最大目录深度：限制目录递归导出时遍历 .raw 子目录的嵌套层数。
export const KNOWLEDGE_BASE_RAW_EXPORT_MAX_DEPTH = 16

// 知识库资料导出单文件最大字节数：限制目录递归导出时的单个文件大小，超出后跳过该顶层导出条目。
export const KNOWLEDGE_BASE_RAW_EXPORT_MAX_FILE_BYTES = 256 * 1024 * 1024

// 知识库资料导出总字节数：限制单次导出写入外部目录的总数据量，避免误选大目录占满磁盘。
export const KNOWLEDGE_BASE_RAW_EXPORT_MAX_TOTAL_BYTES = 1024 * 1024 * 1024

// CC Switch JSON 配置导入最大字节数：限制设置页读取外部 .cc-switch/config.json 的单次解析体积。
export const CC_SWITCH_IMPORT_JSON_MAX_BYTES = 2 * 1024 * 1024

// CC Switch SQLite Provider 导入最大行数：限制设置页预览 cc-switch.db 时单次读取的 Claude provider 数量。
export const CC_SWITCH_IMPORT_MAX_PROVIDER_ROWS = 500

// 默认激活的顶部导航菜单：主窗口有内容仓库时默认进入这个 tab。
export const DEFAULT_APP_NAVIGATION_TAB_ID = "apps" satisfies AppNavigationTabId

export type AppNavigationTabId = (typeof APP_NAVIGATION_TABS)[number]["id"]
