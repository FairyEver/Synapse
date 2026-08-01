# Workflow、数据迁移与 App Capability 规则

修改 Workflow 持久化/分享、App Capability Package、Deep Link 或系统应用数据时，必须阅读本文件。

## 通用数据版本迁移器

- 业务持久化数据需要版本迁移、旧格式兼容或逐级升级时，优先使用 `@synapse/shared/versioned-data-migrator` 导出的 `VersionedDataMigrator`，不得另写并行迁移器。
- 业务模块声明自己的 `schemaVersion`、完整迁移注册表和最终结构校验，并在统一读取入口调用迁移器。
- 迁移器只负责编排内存迁移；事务、备份、并发检查和原子持久化由存储层负责。
- 修改迁移器的公开类型、版本解析/排序、选择与执行顺序、legacy baseline、克隆策略、校验、错误类型或同步约束前，必须搜索所有调用方和注册表，评估历史数据影响。破坏性调整必须同步修改全部调用方、历史 fixture 和多调用方回归测试。

## Workflow 文档版本

- Workflow 持久化文档使用 `meta.schemaVersion` SemVer，由 `WORKFLOW_SCHEMA_VERSION` 声明。它与保存产生的 `version` 内容修订哈希、DataRepository 外层数字版本、分享包 `formatVersion` 相互独立。
- 删除、重命名、收窄、类型或基数变化升 major；新增节点、可选字段或带默认语义的配置升 minor；只修正规范化且不改变兼容边界升 patch。纯 UI、文案、性能、日志或不影响旧数据解释的运行时修复不升级。
- 每次 schema 变化必须新增迁移、历史样本并更新 `workflow-schema/contract.json`。已发布迁移不得原地修改。
- 本地存储、旧仓库目录、导入包和运行快照必须统一经过 `workflow-document-migration.ts`。迁移在内存克隆上执行，通过最终校验后才可持久化。
- 覆盖 `workflows.json` 前必须生成并校验精确字节备份，写入前复查源摘要。失败时保留原文件并阻断覆盖。
- 无版本旧数据按 `0.0.0`。迁移失败或未来版本按单工作流隔离：允许显示诊断和确认删除，禁止编辑、保存、运行、子工作流或 Automation 执行。可识别身份和版本的未来文档只允许原样导出。
- 升级找回只扫描已配置内容仓库的 `<localPath>/workflows/`，必须限制仓库数、目录数、历史版本数、文件大小和总时长；不得扫描整盘、覆盖同 ID 当前数据或删除旧来源。成功/冲突标记按工作流身份永久幂等，防止已删除数据被旧来源复活。

## Workflow 分享包与节点契约

权威规格：`docs/superpowers/specs/2026-05-19-workflow-import-export-design.md`。

- V1/V2/V3 JSON 是历史兼容来源，经只读 adapter 进入统一 V4 导入计划；不得删除 reader、adapter、fixture 或历史测试。
- 每次改动分别判断三条版本线：正文兼容性使用 `WORKFLOW_SCHEMA_VERSION`；容器/manifest/安全协议使用分享包 `formatVersion`；节点能力与最低实现使用 capability 版本。任何一条 bump 都不能替代其它判断。
- 同一 major 的更高 minor/patch 只有在全部 `requiredCapabilities` 支持时可导入。未知必需 capability 必须阻断；不得裁剪正文降级导入。未知可选显示元数据可以忽略。
- 每个已注册 Workflow 节点都必须在 `NodeManifest` 声明纯函数或声明式分享契约，至少覆盖 capability/最低版本、模型、项目、子工作流、资源、敏感字段、高风险权限、显式/继承配置、导入重写和可移植性诊断。
- 节点契约不得读写文件、网络、数据库或 UI。递归、稳定引用、安全 ZIP、映射、导入计划、原子事务、恢复、谱系、撤销和持久化属于中央分享服务。
- 分享包不得携带节点实现、插件代码、可执行文件、安装脚本或任意下载 URL。
- 来源、映射、事务恢复和撤销状态存放在工作流正文之外；包内每个工作流仍分别经过 `workflow-document-migration.ts`。
- 修改分享功能时同步检查 MCP schema、`desktop/app-capabilities/synapse-skill/skill-package/workflow/`、UI、`CONTEXT.md`、ADR 和发布说明。

## App Capability Package

- 同一系统应用同时提供 App UI、MCP、Workflow 或外部入口时，代码放在 `desktop/app-capabilities/<app-id>/`。
- 按职责拆分：`shared/` 放 schema、类型、capability ID、tool 名和 manifest；`main/` 放核心 service、IPC、MCP dispatcher；`renderer/` 放 UI；`workflow-node/` 放节点 schema、manifest、executor、panel 和 card。
- 核心业务逻辑集中在 `main/service.ts` 或同级 core service。UI、IPC、MCP、Workflow 只是入口适配器，不得复制核心逻辑。
- 接入全局 registry 时，专属逻辑仍内聚在能力包内；不得散落到 apps、workflow-nodes、synapse-capabilities 或 bootstrap。
- App capability 使用 `app.<app_namespace>.<subdomain>.<action>`；MCP tool 名严格将点替换为下划线。生成类能力使用 `generate`。
- 本地文件、网络、shell、Agent、Drive 等敏感能力必须统一保留权限、审计、错误脱敏和日志边界。

## Deep Link

- 通用格式：`synapse://app/<app-id>/<action>?<params>`。
- 每个 App 在主进程可导入的 manifest 中通过 `deepLinks` 明确声明 `action → capabilityId → 参数 Schema`；注册 App/capability/MCP 不会自动暴露 Deep Link。
- 协议路由只做严格解析和分发，不得硬编码具体 App，也不得根据无效输入猜测相近 action。
- App Deep Link 不做 Synapse 二次确认、签名、Origin 或调用者可信性校验；安全边界是 manifest 显式声明、Schema 和能力自身的权限/运行条件/审计/脱敏。
- 无效 Deep Link 不得打开或聚焦主窗口；日志不得记录原始 URL。

## 系统应用数据

- 自有业务数据默认使用 `app.<app-id>.<entity>` DataRepository namespace；`app-id` 用短横线，`entity` 用英文复数或明确单例名。
- 不直接手写 SQLite 业务表；表名由 namespace 映射。绕过 DataRepository 必须先在设计文档中说明并获得当前对话确认。
- backend 默认：小型单例配置用 `json`，列表数据优先 `sqlite`，密钥/token 用 `encrypted-json`，追加审计/运行日志用 `jsonl`。
- 记录必须带 `schemaVersion`，schema 放在 `desktop/electron/runtime/data-repo/schemas/` 并注册到 `allSchemas`。
- 旧配置/旧文件迁移必须有幂等标记；成功后清理旧有效来源，避免新数据清空后旧数据复活。失败不得删除旧数据，并允许重试。
- Renderer 不直接读写 DataRepository；通过 core service，再由 IPC、MCP、Workflow 或 App UI 适配调用。

## 参考模板与金手指

- `templates/` 是只读外部参考，除非用户明确要求，不得修改。管理后台优先参考 `templates/shadcn-admin/`。
- 金手指使用稳定命名空间字符串，如 `model:flow:disable`；它是隐藏入口，不是安全边界。
- 触发输入与稳定定义分离。`action` 每次执行一次；`state` 通过统一状态管理器切换，持久化成功后回调。
- 状态不得散落在组件、hook 或 `localStorage`。点击字符按 index 匹配以区分重复字符。
- UI 不暴露金手指提示；日志可记录名称但不得记录完整输入序列。敏感操作仍需权限和审计。
