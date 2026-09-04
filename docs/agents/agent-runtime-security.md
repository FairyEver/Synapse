# Agent Runtime、MCP 与脱敏规则

本文件适用于 Claude Agent SDK 参数、Agent event bridge、MCP 注册/诊断、权限事件、timeline、导出、Usage Analysis 和 provider 预览。

## Claude SDK 配置

- 修改 SDK 参数前核对官方文档和当前安装包类型。`Options.env` 是子进程环境；`Options.settings` 是更高优先级 inline/flag settings，两者不能混用。
- Provider 隔离必须同时写两层：顶层 `Options.env`，以及 `Options.settings.env` 中当前 provider 的 `ANTHROPIC_*` 覆盖（至少 base URL、model、auth token/API key 和默认模型变量）。
- `Options.settings.env` 只能放 provider 的 `ANTHROPIC_*`，不得放 `SYNAPSE_SIDE_CHANNEL_TOKEN`、data-server token、普通 shell env 或其它 runtime secret。
- 回归测试必须证明 provider 配置进入 `settings.env`，side-channel 等非 provider secret 不进入。
- 历史回归：提交 `6778d598e` 曾删除 `settings.env: options.env`，导致用户本机配置其它 Claude provider 时混用旧 base URL 与当前模型。遇到 `model not found or not supported`，先检查 `desktop/electron/services/agent-runtime/claude-sdk-session.ts` 的覆盖层。
- Agent 用户附件只在主进程受控目录暂存；Renderer 与发送 IPC 只携带版本化 attachment id/metadata，history 只保存用户正文与结构化附件元数据，不得携带原始字节、Base64、data URL 或受控绝对路径。
- 图片只通过“受控原图路径 + Read”进入既有主 query。不得创建图片 content block、附件子 query、隐藏批次会话、摘要回灌、附件 MCP 或读取完整性循环。
- 附件处理不得读取 Provider 类别、模型名称、base URL 或自定义能力覆盖，不按白名单启停。百炼 Kimi、Qwen 和自定义兼容模型使用同一路径清单；模型或 Provider 拒绝时保留原生错误。
- 发送时只接受本轮有序 attachmentId，并同时校验 project、draft、conversation、turn 和所有权；不得接受 Renderer 提供的路径或字节。文件夹选择结果只向 Renderer 返回名称和 attachmentId，真实目录只保存在主进程元数据中；旧历史路径在投影到 Renderer 和导出前收敛为显示名称。路径解析不得读取图片原始字节。
- 同一草稿下的受控附件根目录作为一个精确 `additionalDirectories` 授权。每个已提交附件批次必须轮换草稿范围；附件轮结束后必须关闭对应 live session，下一轮按 SDK session id 恢复，避免旧草稿目录继续留在进程授权中。单独选择的图片和文件不得授权原始父目录；只有用户明确选择的文件夹才可授权该精确真实路径。
- 同一次选择或拖放遇到图片数量、单轮、项目或全局空间配额时，必须释放该次调用已经暂存的全部附件，不得向 Renderer 返回部分批次。其它无效路径仍可按项拒绝，不能破坏同批次有效项。
- 附件孤儿回收必须按当前 `projectId` 过滤后再比较会话集合；任何项目服务都不得用本项目会话列表清理其它项目的 committed 附件。
- Persona 显式禁用 Read 时继续禁用；runtime 不强制启用工具，也不以此判断模型能力。模型是否调用 Read、调用次数和是否读完不属于 Synapse 的完成条件。
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

- “Synapse MCP 工具按需加载”是默认关闭的 Agent 实验功能，只对创建时已固化开启且使用非 Anthropic 官方端点的对话生效。Anthropic 官方端点继续使用 SDK 原生工具模式；对话切换 Provider/端点时按快照与端点重新计算，不读取当前全局开关改写旧对话。
- 实验会话必须先用正常 `settingSources` 做一次不消费用户 prompt、不发送模型请求的 MCP discovery，再以 `strictMcpConfig: true` 重建其它可序列化 MCP，移除 `synapse-mcp` 并注入进程内 `synapse-tool-router`。不得用 `disallowedTools`、运行时 toggle 或同名 server 覆盖模拟隔离。
- 只要 discovery 失败、MCP 配置无法无损重建、存在显式 `mcp__synapse-mcp__*` 权限规则、policy helper 或 Synapse server 工具策略，整次会话必须回退完整 MCP。新会话继续把显式注入的 MCP Server 名称固化到 `expectedMcpServerNames` 快照，用于 discovery、诊断和兼容；连接器 MCP 缺失、失败、待授权或超时必须记录安全 reason 与状态，但不得阻断用户 Prompt 或终止普通对话。诊断可记录 Server 名称与状态，不得记录 header、环境变量、凭据或 MCP 配置正文。
- 内部 router 只暴露 `search` 与 `invoke`。`search` 只读且可自动允许；`invoke` 必须把原始 Synapse 工具名和参数投影回 Persona、子 Agent allowlist、permission mode、权限卡片、toolUse/toolResult、history 与导出，并以 `toolUseId` 关联。底层执行仍走同一 action router、`PermissionGuard`、`AuditSink` 和公共 MCP 结果归一化。
- 自动注册/清理 Synapse MCP 时移除旧 server：`synapse-data`、`synapse-database`、`synapse-services`，以及旧权限 allowlist 工具名；不得自动新增 `mcp__synapse-mcp__*` allowlist。
- MCP 工具顶层 `inputSchema` 必须是普通对象，禁止顶层 `oneOf`、`anyOf`、`allOf`。跨字段条件由 dispatcher/service 校验，并在描述中说明。新增/修改工具时运行 `buildAllMcpTools()` 顶层兼容性测试。
- 公开工具名只使用由 `app.*` capability 派生的规范 `app_*`。旧 `database_*`、`model_price_*`、`repository_*`、`automation_*`、`workflow_*`、`content_*`、`drive_*` 前缀不是兼容别名，调用必须返回 `Unknown tool`。
- API、MCP、IPC、preload 使用同一 `app.<namespace>.<resource>.<action>` 语义源：HTTP action 保留点，MCP 将点替换为下划线，IPC 使用 `synapse:app:<namespace>:<resource>:<action>`，bridge 去掉 `app`、snake_case 转 camelCase 并按资源嵌套。
- UI 专用 IPC operation 也遵守 `app.*`，但不得因此注册为 MCP。旧 action/channel/bridge 不保留别名、转发或 fallback。
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
- 相关修改必须用假 canary 回归测试 provider/side-channel token、Authorization/Bearer、Cookie、JSON `token`/`apiKey`、data-server token、`--env KEY=value` 不出现，普通 `/Users/...` 路径仍保留。
- 手工验证只用假 canary，优先只打印、不 export、不写文件、不改配置；不得要求用户提供真实 token。

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
