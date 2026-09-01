# 模块长期边界

本文件只记录跨入口、跨存储或容易被后续改动破坏的稳定边界。修改某个模块前还必须在 `docs/` 中搜索其设计规格和 ADR。

## App 能力包

### Text Extractor

- app id `text-extractor`，namespace `text_extractor`。
- 只读：`app.text_extractor.document.extract` / `app_text_extractor_document_extract` / Workflow `text_extract`。
- 直接保存：`app.text_extractor.document.extract_to_file` / `app_text_extractor_document_extract_to_file`。必须在主进程组合提取与 Text File Writer，正文不得经过 MCP 响应或第二次请求。
- PDF、DOCX、App、MCP、Workflow 复用同一格式中立服务、限制和错误契约。主进程完成权限、审计、安全打开和身份校验；Worker 只接收已验证字节，不重新打开路径。正文、片段和未脱敏完整路径不进入日志/审计。

### Text File Writer

- app id `text-file-writer`，namespace `text_file_writer`，capability `app.text_file_writer.file.write`，tool/node `app_text_file_writer_file_write`，无 Deep Link。
- 所有入口复用能力包 `main/service.ts`：绝对真实目标、默认拒绝覆盖、原子写入、`fs.write.outside-userdata` 权限与审计。
- Writer 不限制扩展名，支持 `utf8/utf16le`；`format` 返回小写末尾扩展名或空字符串。组合调用方仍保留自身扩展名契约：Text Extractor `.txt/.md/.csv`，HTML Generator `.html/.htm`。
- 不设正文长度上限，不记录正文，不在入口复制校验/写入逻辑。

### HTML Generator

- app id `html-generator`，namespace `html_generator`。
- 字符串能力 `app.html_generator.ejs.generate`，文件能力 `app.html_generator.ejs_file.generate`，对应 tool/node 使用下划线形式。
- EJS 模板是受信任可执行配置；Workflow 只允许上游绑定严格 JSON 对象数据，不动态替换模板。
- 所有入口复用单例渲染核心，在一次性 Worker 固定 EJS 版本/options、禁用 include，并执行输入输出限制、超时、终止、调度、`shell.exec` 权限、脱敏错误和审计。
- Worker 不是安全沙箱。生成器不预览、打开、清洗或验证 HTML；文件能力组合 Text File Writer 以 UTF-8 写入绝对 `.html/.htm` 路径。

### File Opener

- app id `file-opener`，namespace `file_opener`，capability `app.file_opener.file.open`，tool/node `app_file_opener_file_open`，Deep Link action `open`。
- 所有入口复用 `FileOpenerService.open()`，参数统一为 `path`；只接受一个已有绝对本地普通文件，拒绝 URL、目录和符号链接。
- 成功只表示操作系统接受请求，不承诺外部应用启动、聚焦或完成加载。

### Terminal

- app id `terminal`，capability 使用 `app.terminal.<subdomain>.<action>`，tool 名严格点转下划线。
- UI、IPC、MCP 复用 `desktop/app-capabilities/terminal/main/service.ts` 的分组、会话、命令、历史和不可变 `sessionId`。
- 启动设置只属于 Terminal：全局入口位于 Terminal Header，分组和快捷命令入口位于对应对象；不得在系统设置中增加重复入口。解析顺序固定为安全系统环境、Synapse 内置、全局、分组、快捷命令、一次性覆盖，配置变化只影响新 PTY。
- `TERM_PROGRAM=Synapse` 与 `TERM_PROGRAM_VERSION` 是受保护宿主身份。环境变量明文只进入加密 body；结构化元数据和 MCP 只能记录键、`set/unset`、来源及 revision。
- 不得新增通用 `shell.exec`、MCP 专属终端、静默输入抢占、隐式停止删除或自动强杀旁路。
- 生命周期、注意三态、写入租约、输入/尺寸修订和输出水位相互正交。loopback MCP 不要求 Terminal 专属 token，但传输层必须提供稳定 `clientId` 与 `controllerInstanceId` 约束租约、幂等、配额和审计。
- 结构元数据使用已注册 `app.terminal.*` DataRepository；原始输出/检查点只进入专属有界加密块存储，安全存储不可用时不得回退明文。
- 普通备份排除输出、检查点、命令正文、活动租约、删除意图和短期幂等记录；恢复中的运行会话转为 `lost`，不得重投生命周期操作。

### Notifier

- Sound Notifier 是声音能力包，不是 System App。
- System Notifier 的完整权威规格是 `docs/superpowers/specs/2026-07-23-system-notifier-v1-design.md`。修改前必须完整阅读，不得以本摘要代替。

## MCP

- 系统设置的 MCP 分类是全局 MCP Server 状态、URL 和外部客户端注册信息的唯一 UI 入口；MCP 不注册为 System App，Database 不得重复承载该视图。
- Renderer 只通过顶层 `window.synapse.mcp` bridge 访问 MCP 专属 IPC；不得在 `database` bridge 中恢复兼容别名。
- MCP 设置分类只管理产品入口与客户端注册，不新增 MCP capability/tool，也不改变 loopback HTTP transport、端口、自动注册、ActionRouter 或运行生命周期。底层服务继续聚合全部已注册 capability domain。

## Console 用户 API 秘钥

- 用户 API 秘钥只通过受登录保护的 `/api/console/api-keys` 管理；创建响应只展示一次完整秘钥，数据库只保存 SHA-256 摘要和可识别前缀，列表不得返回摘要或明文。
- 查询、创建、重命名、权限更新和撤销必须绑定当前 `userId`；撤销保留记录并使其失效，审计不得包含完整秘钥、摘要或可还原材料。
- 密钥创建时必须显式选择非空开放 API scopes；已有未撤销密钥可以原地重命名、增删或清空 scopes，但不得通过该接口轮换密钥。首个 canonical scope `drive.public_link.download` 仅授权 `/api/open/v1/drive/public-links/downloads`，不能访问 Console、内部 Drive 或其它业务 API。旧 `drive.share_link.download` 与 `/api/open/v1/drive/share-links/downloads` 只作为已发布集成的兼容入口，不再用于新密钥或新文档。
- 开放 API 使用独立 `OpenApiKeyGuard`；临时下载地址使用十分钟数据库 grant 和仅存摘要的 bearer token。创建下载地址的请求体只接收完整分享 URL，受密码保护时密码保留在 URL query 中。grant 固定 POST 时的不可变文件版本或 Site deployment，源分享/API key/当前 scope/用户失效会阻止新的下载。
- `/api/open/openapi.json` 是开放 API 的权威 OpenAPI 3.1 机器契约发现入口。运行时路由和 strict 请求校验必须复用契约模块导出的路径与 Zod schema；新增、弃用或修改开放接口时必须同批更新契约和契约回归测试，不维护第二份静态 JSON。
- 开放 API 的应用地址使用 `APP_PUBLIC_URL`，文档地址使用 `DOCUMENT_PUBLIC_URL`；生产未配置文档地址时从应用根地址派生 `/document`，DEV 必须显式指向独立的本地文档服务。API capability 和 OpenAPI `externalDocs` 由服务端输出绝对文档地址，契约 `servers` 继续保持版本化相对路径。
- 开放 API 数据面只写固定列 `OpenApiUsageLog`，禁止 URL、密码、token、文件名、路径、storage key、manifest 和文件内容。POST/GET 显式跳过全局 Throttler，不增加密钥、IP、次数或频率限制。

## 客户端埋点

- 桌面端埋点复用 `ui.tracking` renderer 日志与既有日志 IPC，不新增 renderer analytics client、preload API 或并行跨进程通道。
- 网页端只允许在普通用户 Drive 控制台、文件浏览器和分享页采集 `web.drive.*`；平台管理员后台及其它网页领域不得接入。网页 Drive 通过统一边界覆盖交互，通过受控 API 包装记录所有 Drive 请求的成功、失败和耗时。
- 远程事件只允许固定分类、稳定事件键、组件、动作、结果、耗时、内置模块、窗口类型、客户端实例、会话、版本、平台和时间。输入内容、显示文案、URL、路径、文件名、错误文本、堆栈、仓库/资源 ID 与任意 metadata 不得进入远程事件。
- 请求体不得包含 `userId`。服务端只根据有效桌面 Bearer Token 或普通用户 Web 会话 Cookie 关联登录用户；无认证为匿名事件，有但无效的认证信息必须拒绝。登录事件不得降级为匿名发送。
- 埋点投递必须是不可感知的单向副作用：日志 IPC、队列和网络失败不得弹错、递归记录、阻断业务回调或无限等待身份切换。稳定事件键只能来自代码；异步操作必须使用显式稳定操作名并记录结果与耗时，处理器级静态检查负责阻止遗漏回归。
- 原始事件保留 180 天，只能通过平台管理员保护的聚合统计接口查看；不提供普通用户读取、原始事件列表、明细导出或用户排行。完整设计见 `docs/superpowers/specs/2026-09-01-client-telemetry-design.md`。

## Drive

- `公开素材`使用稳定、匿名、不过期 `/files/<assetId>`。允许 JPG/JPEG/PNG/WebP/GIF/AVIF/ICO 和 PDF/DOCX/XLSX/PPTX/TXT/MD/CSV；禁止 SVG、主动网页内容、压缩包、可执行、旧 Office 和宏格式。
- 图片 inline，文档 attachment；替换只允许同一大类。需要密码、有效期或敏感控制时使用普通 Drive 分享，不得绕过。
- 独立 HTML 在用户未明确发布整个文件夹时默认 `/share/...`；多文件站点或明确发布文件夹时使用 `/sites/...`。文件夹即使只有 `index.html` 也可发布为 Site；仅指定上传目标文件夹或泛称网站不等于发布整个文件夹。
- Markdown 源文本是协同与版本历史的权威数据。Yjs 更新先进入协同日志，只有检查点进入 `DriveFileVersion`；上传覆盖、历史恢复和 MDXEditor 整文保存必须经过同一 item 级协调器并切换协同代际。
- Markdown 评论锚点独立于讨论串和评论删除状态，服务端投影与解析结果是权威。证据不足只能进入未定位状态，不得由 Renderer 自行搜索并猜测重挂。
- Anchor V2 首次上线会一次性清理旧版评论，不转换 UTF-16 旧坐标；文档、分享标识和历史版本不得随评论清理发生变化。上线后的新评论同时保留 V2 权威锚点与回滚兼容投影。
- Markdown 实时协同仅属于浏览器 Monaco/阅读界面；Drive MCP 内容写入继续走版本化服务，不加入协同房间。分享 `.md` 评论只能通过 `app.drive.link.annotation.*` 能力读取和管理，不得扩展为 presence、协同房间控制或分享正文编辑旁路。

## Agent 与 Knowledge Base

- Agent 会话只能基于已配置项目，新会话绑定 `agentType`；运行状态按 conversation 隔离，同项目多会话不得共享队列、busy 或 live session。
- persona 是 conversation 级固定身份，只能在新建对话时选择，创建后不得在 composer、IPC 或 live session 切换。
- 普通/未绑定模型 persona 使用新建对话选择的模型；绑定模型 persona 固定使用其当前绑定并保存为基础模型。
- conversation 保存 persona ID 和创建时 snapshot，每轮使用当前可访问的最新配置；配置变化关闭并重建 live session。persona 不存在、无权访问或缓存缺失时不得降级普通对话：保留历史查看/复制/导出，禁用发送并引导新建。
- slash menu 只插入，不立即发送，也不是通用命令面板。
- Quick Input 是独立 System App。Agent 只消费其文本；composer 菜单固定向上展开，选择后追加到当前草稿末尾并保留输入焦点，不直接发送。不得恢复“直接发送”开关或塞回 slash menu。
- Agent 项目路径与 Git System App 已登记仓库根路径精确匹配时，可在 composer 复用窄类型化 Git IPC；该入口不得经过 Agent 消息、slash command、MCP 或任意 Git 命令，提交仍必须使用仓库绑定的选择令牌。
- Agent 已配置项目可通过窄类型化 Terminal IPC 以项目目录新建 UI 终端会话，再通过仅含 `sessionId` 的 System App 打开请求定位该会话；虚拟本地对话工作区不提供该入口，也不扩展为 MCP 或 Deep Link。
- 工作区辅助面板属于 Agent 工作区壳，不属于消息组件、全局 App shell 或 `SidebarContentLayout`。宽屏使用会话与辅助面板分栏，窄屏切换为详情视图；面板状态按会话隔离，文件 Diff 只是首个面板描述符。
- 共享只读 Diff renderer 位于 `desktop/src/components/diff/`，Git 通过模块内 adapter 消费，Agent 不得跨模块导入 Git 内部实现。patch 生成与解析复用 desktop 直接生产依赖 `diff`。
- Agent 文件检查点摘要是 turn postlude 与 append-only history 事件；完整 sidecar 存在项目级 `agent.file-checkpoints` DataRepository。四个详情/撤销 IPC 仅供 Agent UI 使用，不扩张公开 Capability、MCP、Workflow、Deep Link、File Opener 或 Git 边界。
- 文件撤销只面向 SDK 支持的当前会话最新检查点，并采用两阶段校验；不等同于 Git discard、Drive Checkpoint、对话回退或模型上下文回退。安全细则见 `docs/agents/agent-runtime-security.md`。
- 其它 Knowledge Base 规则见 `docs/agents/knowledge-base.md`。

## Workflow 与 Automation

- Workflow 保持外层 DAG；MCP/agent 写操作走 get → mutate → validate → save，校验失败不得保存，不得删除 end 节点。
- 文件/文件夹参数用 `allowMultiple` 明确单选/多选。多选是有序、非空、最多 100 项且不重复的资源引用数组；两者不得自动转换。子工作流直接绑定时资源类型与 `allowMultiple` 必须一致。
- loop 退出由子图真实节点和 Loop Output 的 continue/break 出口表达，不得退回隐藏配置表达式。
- Scheduler 子进程环境经过 allowlist；`PATH` 按用户配置和 login shell 合并；运行诊断必须保留并用于失败排查。

## Rule、Skill、Content 与 Secrets

- 写入编辑器目录、覆盖、替换、备份失败等敏感路径必须确认、权限检查和审计；备份失败阻断替换。安装与复制文案不得混用。
- 资源仓库非只读 Skill 采用协作编辑：有写权限且完成仓库身份配置的用户可更新，原 `createdBy` 不变并记录修改者；删除、恢复、永久删除仅创建者。该规则不改变云 Skill Repository owner 模型，不扩展到 Rule/Prompt。
- 云 Skill Repository 的 owner 删除为永久删除，删除后立即释放同一 owner 下的名称；管理员对公开仓库的下架仍保留可恢复记录并继续占用原名称。两种删除语义不得混用。
- Skill 卸载统一使用 `skill-uninstaller`：无路径只扫已注册 Agent 全局 Skill 根，有路径则受限递归；单个 `SKILL.md` 最大 1 MiB，超限标记不完整并继续下级；执行前重验名称、真实路径和符号链接，确认后只移入系统废纸篓。IDE 管理不得另写删除逻辑。
- 可持续配置在根 `.env.example` 声明，安装器生成/合并本地 `.env`；每个 Skill 最多 100 个变量。不得把真实 `.env` 写入资源仓库，也不得把持续同步值替换进 `SKILL.md`。
- 密钥名称与 `.env` key 构成关联，创建后不可改名；Secrets update 至少包含 `value` 或 `description`。值变化只扫描可信编辑器 Skill 目录，经用户确认进入内存串行队列，不保存安装实例、不静默改写。
- Skill `.env` 扫描、重装合并和队列更新上限 1 MiB。macOS/Linux 新文件默认 owner-only；重装不放宽权限。Windows 可扫描但队列写入逐项失败并提示手动处理，不降级非原子写。
- 发布统一排除 `.env`、`.env.*`（根 `.env.example` 除外）、`.synapse.json`、`.synapse.repository.json`、其它隐藏项和符号链接。`.synapse.json` 只存资源仓库身份，云身份只存 `.synapse.repository.json`。
- 云上传读取身份时拒绝符号链接/非普通文件，校验路径在 Skill 目录内且读取前后身份未变化，并经过本地文件读取权限和审计；失败必须在远端更新前阻断。
- 发布不得基于正文中 token/Authorization/URL 参数模式或 `id_rsa`、`.pem`、`.key` 文件名做硬阻断；仍必须执行路径、容量、符号链接、运行时 `.env` 排除和权限规则。
- 发布保存区分本地提交与远端同步。只有预检快照、保存后内容和身份文件并发复查一致时更新关联；仓库已保存但关联失败时不得重复提交，提供重试关联入口。

## 扫描与发布

- 扫描详情“发布到仓库”不得静默落库；覆盖路径只预填本地版本并进入内容详情编辑态，用户保存后才写入。
- 修改编辑器 Rule/Skill/Prompt 安装、扫描、复制或兼容策略前，阅读 `docs/reference/editor-integration-matrix.md`。
