# Agent Runtime、MCP 与脱敏规则

本文件适用于 Claude Agent SDK 参数、Agent event bridge、MCP 注册/诊断、权限事件、timeline、导出、Usage Analysis 和 provider 预览。

Agent 上下文生命周期以[SDK 原生上下文生命周期设计](../superpowers/specs/2026-09-15-agent-sdk-native-context-lifecycle-design.md)为权威。历史百炼边界实测与预算/交接调查仅用于追溯，不再定义运行时行为。

## 历史写入与容量

长运行性能相关的持久化与显示容量实施状态见 `docs/superpowers/specs/2026-09-13-agent-long-running-capacity-design.md`。历史追加、记录元数据和问题响应须与标题共享会话级读改写串行队列；摘要保存不得将读到的旧 history 回写覆盖新记录。当前整历史 JSON 存储仍未完成分块改造，不能把局部缓存、诊断或计时优化描述为长期稳定性保证。

## SDK 原生上下文生命周期

- 所有 Agent、Relay、Workflow 与 Automation 的 Claude Agent SDK 查询使用持久 Streaming Input；已有 `sdkSessionId` 通过 SDK `resume` 延续。不得为上下文容量创建隐藏 query、交接会话或自动重放用户请求与工具调用。
- 不向 SDK 传 `maxTurns`、宿主自动整理开关/窗口、预计算整理开关、请求体预算或工具输出预算。百炼与其它 Anthropic 兼容 Provider 使用同一路径。
- Read、Bash、MCP、`structuredContent`、数组及图片工具结果不得由 Synapse 截断、替换或因结构完整性检查阻断；SDK 对工具结果和上下文的处理是唯一运行权威。
- 不注入任务清单、证据账本、完成度修正或 Stop 阻断。历史 conversation 中的 `taskListId`、`taskProgressScope`、`contextHandoff`、`contextRecovery` 仅为兼容读取字段，运行时忽略，并在下次正常保存时剥离。`agent.task-progress` 只保留兼容清理，清理失败不得影响保存。
- SDK 的 `status=compacting` 与 `compact_boundary` 继续投影到 timeline。只在 compact 完成或一轮结束后调用 `getContextUsage()`，展示 SDK 返回的 used tokens、窗口、模型及可选 compact threshold；不得混入模型目录上限或本地估算。
- Provider/SDK 返回的请求体过大、rapid refill 或其它异常只结束当前轮，按普通失败投影；不得重试、换 Session、生成恢复状态或提供“整理上下文”操作。已知的 6 MiB 请求体超限必须显示为不可恢复的容量错误，并提示用户减少图片或大型工具结果、或新建对话，不得误报为网络连接中断。内部日志可记录脱敏分类布尔值，但不得记录 prompt、工具正文、路径、Base64 或凭据。

## 跨平台验证

- `test:agent:cross-platform` 覆盖 SDK 参数、会话持久化、SQLite、停止屏障和 timeline，不使用真实服务凭据。Windows runner 显式提供 Git Bash，并隔离 HOME、USERPROFILE、临时目录与用户配置。
- Agent 附件链路在 Windows runner 上原生执行：`attachment-staging-service`、附件 fsync 契约、附件 IPC 和 composer 四组测试。附件落盘对刚写入的文件做 fsync，而 Windows 只允许通过可写句柄 fsync（只读句柄返回 `ERROR_ACCESS_DENIED`）；这条平台差异在 macOS 上不可见，任何附件写入改动都要看 Windows runner 结果。
- macOS 的模拟 Windows 路径测试不等于 Windows 原生执行通过；必须保留 CI/实机结果。当前审计状态见 `docs/reference/2026-09-14-macos-windows-compatibility-audit.md`。

## Claude SDK 配置

- 修改 SDK 参数前核对官方文档和当前安装包类型。`Options.env` 是子进程环境；`Options.settings` 是更高优先级 inline/flag settings，两者不能混用。
- Provider 隔离必须同时写两层：顶层 `Options.env`，以及 `Options.settings.env` 中当前 provider 的 `ANTHROPIC_*` 覆盖（至少 base URL、model、auth token/API key 和默认模型变量）。
- `Options.settings.env` 只能放 provider 的 `ANTHROPIC_*` 以及 Provider 显式配置的 `CLAUDE_CODE_MAX_CONTEXT_TOKENS`，不得放 task namespace、`SYNAPSE_SIDE_CHANNEL_TOKEN`、data-server token、普通 shell env 或其它 runtime secret。未显式配置上下文环境变量时必须保持未设置。
- 回归测试必须证明 provider 配置进入 `settings.env`，side-channel 等非 provider secret 不进入。
- 历史回归：提交 `6778d598e` 曾删除 `settings.env: options.env`，导致用户本机配置其它 Claude provider 时混用旧 base URL 与当前模型。遇到 `model not found or not supported`，先检查 `desktop/electron/services/agent-runtime/claude-sdk-session.ts` 的覆盖层。
- SDK 终态只要标记 `is_error` 或 `terminal_reason=api_error`，即使 `subtype=success`、`errors` 为空，也必须按失败结束；SDK 合成的 `is_api_error_message` 不得作为普通 Assistant 回复写入 history。网络中断应投影为可恢复状态并允许用户显式继续，不得自动重放整轮请求，因为已执行工具可能产生不可重复的副作用。
- Agent 与内置 Claude Code 终端使用同一 Provider 环境透传规则；模型能力目录只服务展示、说明与价格，不得推导 SDK/CLI 的上下文环境或生命周期参数。
- Agent SDK 高频事件必须先分类再构造 payload。`system/thinking_tokens` 与未知 SDK 类型不得进入 AgentEvent、EventBus、持久化或轮次结果；只允许不含正文、路径、凭据和原始 payload 的每轮聚合诊断。真实 thinking 文本继续使用 `thinking_delta`。
- Timeline 和 MCP inspect 按持久化记录的连续区间分页，允许在同一用户回合内以及工具调用/结果之间切页；`beforeIndex` 是排他的记录索引，旧用户消息边界游标仍兼容。返回页必须保留稳定记录 ID 与 `toolUseId`，字节超限只缩小当前页，不得整轮删除、用空页或整轮占位符掩盖非空历史。超大单项只裁剪显示投影，不修改持久化原文。
- Renderer 只接收有界显示投影：流式批次最多 128 条/64 KiB、等待确认最多 512 KiB；send 终态最多 32 KiB；timeline 每页最多 100 条/1 MiB、单项与全文分块最多 64 KiB。Renderer 私有全文接口只能接受 project、conversation、history index 和 offset，禁止接受文件路径。
- Renderer 崩溃或持续无响应时，必须按 webContents 所属关系停止其发起的本地交互轮次、结束权限等待并清除未确认批次；不得停止 Automation、Workflow、Relay 或其它 Renderer 的运行。已执行工具保留真实结果，不回滚、不自动重放。详细不变量见 `docs/superpowers/specs/2026-09-12-agent-renderer-capacity-and-recovery-design.md`。
- Agent 用户附件只在主进程受控目录暂存；Renderer 与发送 IPC 只携带版本化 attachment id/metadata，history 只保存用户正文与结构化附件元数据，不得携带原始字节、Base64、data URL 或受控绝对路径。
- 图片只通过“受控原图路径 + Read”进入既有主 query。不得创建图片 content block、附件子 query、隐藏批次会话、摘要回灌、附件 MCP 或读取完整性循环。
- 附件处理不得读取 Provider 类别、模型名称、base URL 或自定义能力覆盖，不按白名单启停。百炼 Kimi、Qwen 和自定义兼容模型使用同一路径清单；模型或 Provider 拒绝时保留原生错误。
- 发送时只接受本轮有序 attachmentId，并同时校验 project、draft、conversation、turn 和所有权；不得接受 Renderer 提供的路径或字节。文件夹选择结果只向 Renderer 返回名称和 attachmentId，真实目录只保存在主进程元数据中；旧历史路径在投影到 Renderer 和导出前收敛为显示名称。路径解析不得读取图片原始字节。
- 同一草稿下的受控附件根目录作为一个精确 `additionalDirectories` 授权。每个已提交附件批次必须轮换草稿范围；附件轮结束后必须关闭对应 live session，下一轮按 SDK session id 恢复，避免旧草稿目录继续留在进程授权中。单独选择的图片和文件不得授权原始父目录；只有用户明确选择的文件夹才可授权该精确真实路径。
- 同一次选择或拖放遇到图片数量、单轮、项目或全局空间配额时，必须释放该次调用已经暂存的全部附件，不得向 Renderer 返回部分批次。其它无效路径仍可按项拒绝，不能破坏同批次有效项。
- 附件孤儿回收必须按当前 `projectId` 过滤后再比较会话集合；任何项目服务都不得用本项目会话列表清理其它项目的 committed 附件。
- Persona 显式禁用 Read 时继续禁用；runtime 不强制启用工具，也不以此判断模型能力。
- 交互式 Agent 的 `Write`、`Edit`、`MultiEdit`、`NotebookEdit` 必须在 PreToolUse 阶段限制到会话 `cwd` 或已明确授权的 `additionalDirectories`；祖先 Git 仓库不得扩大该边界，且 `bypassPermissions` 不得绕过这条直接文件写入边界。校验必须同时约束词法路径和真实路径：已存在目标取目标 `realpath`，新目标取最近存在父目录的 `realpath`，授权根或目标无法安全解析时拒绝，项目内 symlink 不得把写入导向真实根外。该检查是 SDK 工具执行前的 fail-closed 预检，不提供文件描述符级原子写入，不能消除校验后到 SDK 实际写入之间的 TOCTOU 竞态。Bash、MCP 和外部进程不属于这条结构化路径检查，继续服从 SDK permission mode、显式授权及操作系统权限；项目目录不是通用 OS 沙箱。
- 运行时附件清单不写入 history。timeline、权限卡片、工具事件、日志和导出必须把受控附件路径投影为稳定附件标签；存在附件上下文时不得持久化可能拆分路径的流式 `input_json_delta` 正文。
- 附件诊断只允许记录类型和计数；不得记录 attachmentId、名称、路径、哈希、运行时清单、工具输入或模型输出。路径链路不登记为公开 capability/MCP。
- 附件回滚不得恢复 Renderer 原图字节、raw image IPC、Blob URL 或重写用户附件。

## Agent 文件检查点

- Agent 文件检查点只属于本地交互式 Agent 会话。它依赖本地 Claude Agent SDK/CLI 的文件跟踪与 `rewindFiles`，不以 Anthropic 自家模型为能力门槛；DeepSeek 官方与百炼 Anthropic 兼容 Provider 使用同一运行路径。
- SDK 必须同时启用 `enableFileCheckpointing` 与 `replay-user-messages`，并把回放用户消息 UUID 仅作为内部恢复锚点。回放消息不得重复进入 timeline、history 正文或导出。
- 启用文件检查点时不得向 SDK 传入 `sessionStore` 或 `sessionStoreFlush`；SDK 0.3.245 明确拒绝该组合，因为外部 store 不镜像 rewind 所需备份 blob。新会话标题使用 Agent Runtime 的首条用户消息回退，不得为 AI title 恢复 transcript 镜像。
- V1 只捕获前台 SDK `Write`、`Edit`、`MultiEdit`、`NotebookEdit` 对当前项目工作区普通文件的修改。Bash、普通 subagent、MCP、外部进程、目录操作、符号链接、硬链接、远程文件和额外目录不属于可恢复集合。
- SDK `rewindFiles` 是实际恢复权威；Synapse sidecar 是审查 Diff、路径身份、文件指纹、并发校验和产品状态权威。timeline/history 只保存相对显示路径与摘要，不得保存绝对路径、源码快照或 patch。
- Diff patch 每文件最多 128 KiB、每检查点最多 512 KiB；超限、二进制或读取失败只保留摘要与安全元数据。全局 64 MiB patch 配额只允许清理 `superseded` 或 `rewound` 的旧载荷，不得清理当前可撤销检查点的指纹和身份元数据。
- 只允许撤销当前会话最后一个 `available` 检查点；发起下一轮用户消息必须先把旧检查点标记为 `superseded`。撤销只恢复文件，不回退对话历史、模型上下文、usage 或工具记录。
- 撤销使用两阶段协议：prepare 产生 5 分钟有效的一次性 operation id；confirm 必须重新校验项目、会话、SDK session、busy 状态、精确文件集合、逐文件写权限、真实父路径和 after 指纹。任一校验失败时不得调用真实 rewind。
- 实际 rewind 后必须逐文件验证 before 指纹。SDK 多文件恢复不是事务；链接跳过或任一文件未恢复时状态为 `partial`，不得报告完全撤销成功。权限检查与最终结果必须写入 `AuditSink`，日志不得包含源码、patch 或文件哈希。
- 检查点详情、单文件 Diff、prepare 与 confirm 是 Agent UI 私有窄 IPC，不注册 Capability、MCP、Workflow、Deep Link 或 System App；Renderer 不获得任意路径读写能力。

## MCP 命名、传输与 Schema

- Agent 分组查询与新建对话分别使用 `agent.conversation.read` / `agent.conversation.control` 权限、既有客户端限流与无正文审计。新建只接受默认分组、已配置项目或已有对话所属的可用分组，不接受任意工作目录、来源、permission mode 或继承旧对话身份；普通身份与模型/权限默认值由主进程确定。幂等键作用域为客户端和创建操作，并复用进程内有界 10 分钟缓存；已创建成功后的界面刷新失败不能触发重复创建。

- “Synapse MCP 工具按需加载”默认开启，仅用于非 Anthropic 官方端点；保留用户/会话显式关闭的选择，缺少快照的旧对话使用默认按需模式。Anthropic 官方端点继续使用 SDK 原生工具模式；对话切换 Provider/端点时按快照与端点重新计算，不读取当前全局开关改写旧对话。
- 实验会话必须先用正常 `settingSources` 做一次不消费用户 prompt、不发送模型请求的 MCP discovery，再以 `strictMcpConfig: true` 重建其它可序列化 MCP，移除 `synapse-mcp` 并注入进程内 `synapse-tool-router`。不得用 `disallowedTools`、运行时 toggle 或同名 server 覆盖模拟隔离。该 router 模块同时是 `/mcp` 公开表面的实现来源，两条路径共用同一份工具定义与 instructions，不得各自维护一份。
- 路由模式中任何异常都不得回退完整 MCP：可选连接器缺失、失败、待授权或 pending 超时，只排除该连接器并保留路由器及其它可重建 MCP；不可重建的可选配置也只排除该项。discovery 整体失败、重名、显式原始 Synapse 权限规则、policy helper、Synapse server 工具策略或路由器创建失败时，使用 `strictMcpConfig: true` 和空 MCP 集合，保留受现有权限限制的内置工具，不能绕过原权限策略。诊断仅记录名称、安全 reason 与状态，禁止配置、header、env 或凭据正文。
- `search` 与 `invoke` 是所有 MCP 客户端的**仅有两个**公开工具；内置 Agent 会话与 `/mcp` 共用同一实现、同一份工具定义和同一 instructions。`search` 只读且可自动允许；`invoke` 必须把原始 Synapse 工具名和参数投影回 Persona、子 Agent allowlist、permission mode、权限卡片、toolUse/toolResult、history 与导出，并以 `toolUseId` 关联。底层执行仍走同一 action router、`PermissionGuard`、`AuditSink` 和公共 MCP 结果归一化。两个表面都必须随 `initialize` 返回说明两段式调用流程的 instructions；新增第三个公开工具必须先修订本条。
- 自动注册/清理 Synapse MCP 时移除旧 server：`synapse-data`、`synapse-database`、`synapse-services`，以及旧权限 allowlist 工具名；不得自动新增 `mcp__synapse-mcp__*` allowlist。
- MCP 工具顶层 `inputSchema` 必须是普通对象，禁止顶层 `oneOf`、`anyOf`、`allOf`。跨字段条件由 dispatcher/service 校验，并在描述中说明。新增/修改工具时运行 `buildAllMcpTools()` 顶层兼容性测试。
- 公开工具名只使用由 `app.*` capability 派生的规范 `app_*`。旧 `database_*`、`model_price_*`、`repository_*`、`automation_*`、`workflow_*`、`content_*`、`drive_*` 前缀不是兼容别名，调用必须返回 `Unknown tool`。唯一例外是公开 MCP 表面上的两个路由包装工具 `search` 与 `invoke`：它们不是 capability、不映射任何 capability id、不出现在 `MCP_TOOL_ACTIONS` 中，并且是仅有的两个非 `app_*` 公开工具名。除这两个名字外不得新增任何非 `app_*` 公开工具名；所有 capability 调用仍必须使用规范 `app_*` 名字。
- API、MCP、IPC、preload 使用同一 `app.<namespace>.<resource>.<action>` 语义源：HTTP action 保留点，MCP 将点替换为下划线，IPC 使用 `synapse:app:<namespace>:<resource>:<action>`，bridge 去掉 `app`、snake_case 转 camelCase 并按资源嵌套。
- UI 专用 IPC operation 也遵守 `app.*`，但不得因此注册为 MCP。旧 action/channel/bridge 不保留别名、转发或 fallback。
- `app.agent.conversation.open` 仍是只定位本机界面的公开导航能力。Agent Conversation Deep Link 唯一格式为 `synapse://threads/<thread-id>`，不携带项目查询参数；主进程严格校验路径短引用，再通过有界摘要扫描跨本机持久化项目解析唯一对话。不得注册或解析旧 `synapse://app/agent/open?projectId=...&conversationId=...` 入口。MCP 可直接接收完整 `deepLink`，后续调用优先使用 `projectId + conversationRef`。混合目标、歧义匹配、损坏校验和与其它畸形链接必须在读取前拒绝。链接本身不得包含标题、session key、timeline、消息正文、密钥或授权。冷启动待处理请求只驻留内存并在 Renderer 确认消费后清除。
- Agent Conversation MCP 可分页读取所有来源的界面可见时间线和运行状态，但只允许控制 `local` / `local-renderer` 用户对话。读取必须递归遮盖敏感字段并移除 provider/SDK 会话标识、原始 SDK payload、Base64 和内部 artifact URL；单项 64 KiB、整页 1 MiB。审计只记录项目、对话、回合、请求、动作、结果和正文/答案长度，不记录正文、thinking、工具输入输出或答案。
- Agent Conversation 控制采用协作语义而非独占租约。异步发送以 MCP 客户端内的幂等键接纳；steer、优雅停止、强停和权限响应必须匹配当前精确 `turnId`，权限响应还必须匹配仍 pending 的 `requestId`、kind 与 tool name。优雅停止不得超时自动强停，强停只通过独立高风险 capability 执行。
- Agent Conversation `observe` 只返回 revision、变化类型、历史数量和运行快照，不重复返回正文；最长等待 30 秒，并限制每对话 4、每客户端 8、全局 32 个并发观察。普通“接管”或“监视”不构成底层工具授权；allow 仍须当前用户明确批准具体操作并继续经过 Shell、文件、网络等既有 `PermissionGuard`。
- Synapse MCP 只通过 loopback HTTP `/mcp` 提供，不要求静态 token、Authorization/Bearer；不再支持 stdio bridge，旧配置必须自动迁移。内部 data-server `/api` 仍使用 `data-server.json` token，不得作为 MCP 传输入口。
- 未来远程 MCP 认证必须采用标准 OAuth 或客户端支持方案，不得要求手写静态 Bearer。
- 诊断必须区分 HTTP server 是否运行，以及 `~/.claude.json` 是否注册 `synapse-mcp`；不得用 `~/.claude/settings.json` 或旧 allowlist 推断 server 存在。

## 安全诊断与脱敏

- 诊断 Knowledge Base slash 来源时只做只读文件证据检查：backing directory、`.claude-plugin/plugin.json`、`skills/<name>/SKILL.md`、`commands/<name>.md` 和 commands 第一层文件名。不得执行目标 slash，也不得读取 Claude 配置、进程列表或任何 secret。
- 权限卡片、工具事件、错误日志、timeline、复制、导出和 Usage Analysis 必须同时脱敏 tool input 与 tool result。
- 规则至少覆盖敏感 key/JSON 字段、shell/env 赋值、Authorization/Bearer、Cookie、`data-server.json` token、`ps aux` 与 `--env KEY=value`；普通路径和 `file_path` 仍保留。
- Electron 与 renderer 复用共享脱敏 helper，不得在主进程、renderer、导出和 Usage Analysis 各写一套正则。
- Usage Analysis 只对 Synapse 内部展示、详情 JSON、事件预览和搜索 snippet 使用脱敏投影；不得改写用户机器上的外部原始 JSONL/日志，rawText 搜索不得返回真实 secret。
- Provider 预览、Agent 环境和 MCP/side-channel 诊断不得展示 `buildEnv`、`getAgentEnv` 或 data-server 配置中的值，只显示 key 是否存在、来源或 `[redacted]`。
- Agent 对话导出可附带 Claude Agent SDK 暴露的脱敏 API StreamEvent，但不得宣称为线级 HTTP 响应或原始 SSE 文本。高频 delta 只在内存中按轮次缓冲，单轮最多 1000 条、512 KiB，完成或失败时批量持久化；单个导出最多包含 8 MiB，超限必须在导出元数据中标记。旧会话未持久化的 delta 不得伪造或声称可恢复。
- JSON 诊断导出必须先对结构化值脱敏再序列化，不得对序列化后的 JSON 字符串做路径替换；所有导出的 JSON 文件必须保持可解析。工具结果中的内嵌 Base64 图片只保留省略标记，不得进入 timeline、history 或诊断正文。
- 相关修改必须用假 canary 回归测试 provider/side-channel token、Authorization/Bearer、Cookie、JSON `token`/`apiKey`、data-server token、`--env KEY=value` 不出现，普通 `/Users/...` 路径仍保留。
- 手工验证只用假 canary，优先只打印、不 export、不写文件、不改配置；不得要求用户提供真实 token。
- **手机端诊断日志（`SynapseMobile/Core/Diagnostics/`）同样受这一节约束**，另有三条自己的不变量：① `DiagnosticValue` 里能装未脱敏内容的只有 `case captured(CapturedText)` 一格，**再给它加第二个这样的 case 属于改变这条边界**；那一格的唯一构造点是 `DiagnosticLog.captureScreen` / `captureInput`，受一个用户可见的开关控制（关掉时连屏幕上的行都不会被拼出来），每秒至多一条、三重限长且先跑脱敏，导出的包与界面必须明示本次是否包含终端内容；② 真实会话/电脑/项目 id 只用进程内的本地别名（`s1`/`d1`/`p1`），不得改用哈希、UUID 派生或任何可跨文件对照的稳定标识，别名表不得落盘；③ 日志放 `Library/Caches/SynapseLogs/` 而不是 Documents，不得移进会被 iCloud 备份的目录。日志只在本机产生、只在用户主动导出时经系统分享离开设备，不得新增自动上传路径。完整规格见 `docs/adr/0220-keep-mobile-diagnostic-logs-on-device-and-de-identify-ids.md`。

## 工具输入、提问与事件关联

- 权限事件中的 `toolInput` / `toolInputRaw` 是展示、权限和审计摘要，可能已脱敏、截断或带 `[truncated]`。除非用户显式编辑并提交 `updatedInput`，不得把摘要回传 runtime 当真实工具参数，尤其不得让 Write/Edit 正文从权限卡片回流。
- AskUserQuestion 返回空答案时，后续敏感写操作必须停止，并反馈“未收到选择，已停止操作。”；不得视为同意或默认值。
- Renderer 内部可用 id/key/index 区分重复题干，但回传 SDK 的 `updatedInput.answers` 必须以原始 `question` 文本为 key、选项文本为 value。重复题干时在 runtime 边界转为不会丢题的 `response` 或 SDK 支持格式。
- 测试普通单题、重复题干、多题缺失、空答案停止，以及不得出现 `User has answered your questions: .`。
- 工具调用与结果的稳定关联键是 `toolUseId`。event bridge、history、IPC、timeline、复制和导出必须端到端保留；存在时只能按它归属，缺失才允许旧数据 fallback。
- 并行结果不得只靠顺序或 `toolName` 猜归属；`toolName` 可重复，也可能只是占位名。

## 权限与日志

- shell、userData 外写文件、网络连接、扩展加载、agent spawn、secret 访问等敏感操作必须经过 `PermissionGuard.check()` 并写入 `AuditSink`。
- 生产日志使用结构化 logger，不记录正文、token、Authorization、Cookie、secret、未脱敏输入或原始异常堆栈中可能包含的敏感数据。
- 日志和审计需要保留排障所需普通路径与资源身份，但不能把脱敏摘要误当作运行输入。
- Agent 回复 Outbox 只保存已有外部 dispatcher 接管的投递事件；本地 Renderer 通过 EventBus 接收事件，不得为其复制 Outbox 记录。已发送记录按回复目标保留最近 500 条，清理必须覆盖先前进程留下的数据，待发送和失败记录不得随已发送记录一起删除。
- `agent.events` 中 `sdkEvent` / `streamDiagnostics` 是原始诊断层，保留 30 天后可由后台维护删除；历史 `sdkEvent + system/thinking_tokens` 可立即分批删除。Conversation history、语义事件、usage、artifact 与 file checkpoint 不得混入该清理。已删除 conversation 的孤儿 `agent.events` 可分批清理。
- 运行数据维护只能在主窗口创建后调度，通过独立 Worker 对 `DataRepository` 内部 SQLite 表执行最多十万行一轮、五百行一批的短事务；中断、超时或锁冲突保留已提交批次并自动重试，不执行启动期 `VACUUM`，不得阻塞 Renderer。权限仅允许 `system:data-maintenance` 对 `runtime-data` 执行 `database.mutate`，结果写入结构化日志、AuditSink 和诊断页。
