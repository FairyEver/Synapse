// 基础时间单位：用于派生全局配置里的 1 小时时长，避免重复写魔法数字。
const ONE_HOUR_MS = 60 * 60 * 1000

// 桌面更新深链允许验证的凭证最大字符数：与服务端验证请求上限保持一致，超限请求只进入手动更新页。
export const DESKTOP_UPDATE_INTENT_TOKEN_MAX_LENGTH = 4_096

// 桌面更新凭证在线验证超时（毫秒）：网络异常时快速降级到手动更新，不阻塞更新页导航。
export const DESKTOP_UPDATE_INTENT_VERIFY_TIMEOUT_MS = 3_000

// 文档文本提取单个源文件最大字节数：读取前后限制 PDF/DOCX 输入占用的主进程内存。
export const DOCUMENT_TEXT_EXTRACTION_MAX_FILE_BYTES = 50 * 1024 * 1024

// 文档文本提取规范化正文最大 UTF-8 字节数：超限时明确失败，禁止静默截断正文。
export const DOCUMENT_TEXT_EXTRACTION_MAX_TEXT_BYTES = 5 * 1024 * 1024

// 文档文本提取 PDF 最大页数：限制异常文档在 Worker 中的解析规模。
export const DOCUMENT_TEXT_EXTRACTION_MAX_PDF_PAGES = 2_000

// 文档文本提取单次 Worker 执行超时（毫秒）：从 Worker 启动后限制异常文档长期占用资源。
export const DOCUMENT_TEXT_EXTRACTION_TIMEOUT_MS = 60_000

// 文档文本提取 Worker 的 V8 老生代堆上限（MiB）：隔离恶意或异常文档的内存影响。
export const DOCUMENT_TEXT_EXTRACTION_WORKER_MAX_OLD_GENERATION_MB = 512

// 文档文本提取全局并发数：限制所有 App、MCP 与 Workflow 请求共享的 Worker 数量。
export const DOCUMENT_TEXT_EXTRACTION_MAX_CONCURRENCY = 2

// Agent 会话在最近活动结束后超过该时长时，提示用户新建对话以避免继续沿用长上下文。
export const CONVERSATION_IDLE_ROLLOVER_PROMPT_MS = ONE_HOUR_MS

// 工作流入口默认显示开关：为 true 时所有用户直接看到工作流入口；为 false 时继续通过金手指状态控制入口显隐。
export const WORKFLOW_ENTRY_VISIBLE_BY_DEFAULT = false

// 工作流多值文件或文件夹参数的最大资源数量：统一限制定义默认值、运行参数、预设和 MCP 输入的单参数体积。
export const WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS = 100

// 旧资源仓库工作流找回最多扫描的已配置仓库数：限制升级初始化阶段遍历异常多的历史仓库。
export const WORKFLOW_LEGACY_RECOVERY_MAX_REPOSITORIES = 50

// 旧资源仓库工作流找回最多扫描的工作流目录总数：限制首次加载期间的目录遍历规模。
export const WORKFLOW_LEGACY_RECOVERY_MAX_DIRECTORIES = 2_000

// 旧资源仓库单个工作流最多检查的历史版本数：优先从最新版本向前找可解析文档。
export const WORKFLOW_LEGACY_RECOVERY_MAX_VERSIONS_PER_WORKFLOW = 100

// 旧资源仓库工作流找回单个版本文件最大字节数：读取前后双重限制异常大 JSON 占用内存。
export const WORKFLOW_LEGACY_RECOVERY_MAX_VERSION_BYTES = 1024 * 1024

// 旧资源仓库工作流找回总扫描时长（毫秒）：避免首次工作流列表长期等待历史文件扫描。
export const WORKFLOW_LEGACY_RECOVERY_TIMEOUT_MS = 3_000

// 工作流分享包允许的最大压缩文件字节数：限制外部 ZIP 在解析前占用的内存。
export const WORKFLOW_SHARE_PACKAGE_MAX_COMPRESSED_BYTES = 16 * 1024 * 1024

// 工作流分享包允许的最大 ZIP 条目数：覆盖 manifest、工作流文档和未来受控扩展。
export const WORKFLOW_SHARE_PACKAGE_MAX_ENTRIES = 256

// 工作流分享包单个条目的最大解压字节数：限制异常工作流文档或扩展文件。
export const WORKFLOW_SHARE_PACKAGE_MAX_FILE_BYTES = 2 * 1024 * 1024

// 工作流分享包 manifest 的最大字节数：限制依赖清单和风险位置数量。
export const WORKFLOW_SHARE_PACKAGE_MAX_MANIFEST_BYTES = 1024 * 1024

// 工作流分享包全部条目解压后的最大总字节数：防止压缩炸弹占用过多内存。
export const WORKFLOW_SHARE_PACKAGE_MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024

// 工作流分享包单个条目允许的最大解压比：在实际解压前拒绝高度压缩的可疑条目。
export const WORKFLOW_SHARE_PACKAGE_MAX_COMPRESSION_RATIO = 200

// 工作流分享包 ZIP 解析最大同步耗时（毫秒）：限制大量或异常条目长期占用主进程。
export const WORKFLOW_SHARE_PACKAGE_MAX_PARSE_TIME_MS = 2_000

// 单个工作流分享包允许包含的最大工作流数量：限制递归依赖集规模。
export const WORKFLOW_SHARE_PACKAGE_MAX_WORKFLOWS = 100

// 单个工作流分享包允许记录的最大依赖出现位置数量：限制恶意 manifest 的解析和渲染成本。
export const WORKFLOW_SHARE_PACKAGE_MAX_OCCURRENCES = 10_000

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

// Skill 卸载器递归扫描最大目录深度：限制自定义根目录中的异常深层级遍历。
export const SKILL_UNINSTALL_SCAN_MAX_DEPTH = 32

// Skill 卸载器单次最多访问目录数：避免误选超大目录后长期占用主进程。
export const SKILL_UNINSTALL_SCAN_MAX_DIRECTORIES = 50_000

// Skill 卸载器单次扫描超时时间（毫秒）：超时后返回已发现结果并标记扫描未完成。
export const SKILL_UNINSTALL_SCAN_TIMEOUT_MS = 30_000

// Skill 卸载器目录读取并发数：限制递归扫描对本机文件系统的瞬时压力。
export const SKILL_UNINSTALL_SCAN_CONCURRENCY = 8

// Skill 卸载器单个 SKILL.md 最大字节数：避免扫描异常大文件时占用过多主进程内存和磁盘 IO。
export const SKILL_UNINSTALL_SCAN_MAX_SKILL_MD_BYTES = 1024 * 1024

// Skill 卸载器 .synapse.json 身份文件最大字节数：限制扫描和执行复查读取异常元数据的内存与磁盘开销。
export const SKILL_UNINSTALL_MAX_METADATA_BYTES = 64 * 1024

// Skill 卸载器单次执行最大目标数：限制一批权限检查、身份复查和废纸篓操作的规模，较大选择由前端分批提交。
export const SKILL_UNINSTALL_MAX_TARGETS = 100

// Skill Repository 本地身份文件最大字节数：限制上传、更新和关联重试读取异常身份文件的内存与磁盘开销。
export const SKILL_REPOSITORY_IDENTITY_MAX_BYTES = 64 * 1024

// 内容 Skill 本地关联文件最大字节数：限制编辑器扫描、快速发布和关联写入复查读取异常 .synapse.json 的资源开销。
export const CONTENT_SKILL_IDENTITY_MAX_BYTES = 64 * 1024

// Skill 环境变量声明最大数量：统一限制 .env.example 配置字段和密钥关联批量扫描的单次规模。
export const SKILL_ENV_MAX_VARIABLES = 100

// Synapse Skill 主进程 prepared source 的最大缓存条目数：限制 renderer 异常退出或释放 IPC 丢失后的累计占用。
export const SYNAPSE_SKILL_PREPARED_SOURCE_MAX_ENTRIES = 4

// Synapse Skill 主进程 prepared source 的闲置有效期（毫秒）：超过该时长且未安装中的来源会在下次访问时清理。
export const SYNAPSE_SKILL_PREPARED_SOURCE_TTL_MS = 10 * 60 * 1000

// Installer 本地 Skill 安装源缓存最大总字节数：限制待安装内容在主进程中的累计内存占用。
export const INSTALLER_SOURCE_LOCAL_SKILL_CACHE_MAX_BYTES = 100 * 1024 * 1024

// Installer 本地 Skill 安装源缓存最大条目数：限制未主动释放的本地目录来源数量。
export const INSTALLER_SOURCE_LOCAL_SKILL_CACHE_MAX_ENTRIES = 4

// Installer 临时安装源闲置有效期（毫秒）：控制本地 Skill 和内联 Rule 来源的自动过期时间。
export const INSTALLER_SOURCE_TTL_MS = 10 * 60 * 1000

// Skill 环境变量关联扫描单个受信任根最多访问的一级条目数：避免异常大的编辑器 Skill 根长期占用主进程。
export const SKILL_ENV_BINDING_SCAN_MAX_ROOT_ENTRIES = 1_000

// Skill 环境变量关联扫描单个受信任根最多检查的 Skill 目录数：与编辑器 Skill 预览的单根规模边界保持一致。
export const SKILL_ENV_BINDING_SCAN_MAX_SKILLS_PER_ROOT = 200
