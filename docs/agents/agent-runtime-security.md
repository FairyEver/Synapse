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
- 发送时只接受本轮有序 attachmentId，并同时校验 project、draft、conversation、turn 和所有权；不得接受 Renderer 提供的路径或字节。路径解析不得读取图片原始字节。
- 同一草稿下的受控附件根目录作为一个精确 `additionalDirectories` 授权。单独选择的图片和文件不得授权原始父目录；只有用户明确选择的文件夹才可授权该精确真实路径。
- Persona 显式禁用 Read 时继续禁用；runtime 不强制启用工具，也不以此判断模型能力。模型是否调用 Read、调用次数和是否读完不属于 Synapse 的完成条件。
- 运行时附件清单不写入 history。timeline、权限卡片、工具事件、日志和导出必须把受控附件路径投影为稳定附件标签；存在附件上下文时不得持久化可能拆分路径的流式 `input_json_delta` 正文。
- 附件诊断只允许记录类型和计数；不得记录 attachmentId、名称、路径、哈希、运行时清单、工具输入或模型输出。路径链路不登记为公开 capability/MCP。
- 附件回滚不得恢复 Renderer 原图字节、raw image IPC、Blob URL 或重写用户附件。

## MCP 命名、传输与 Schema

- “Synapse MCP 工具按需加载”是默认关闭的 Agent 实验功能，只对创建时已固化开启且使用非 Anthropic 官方端点的对话生效。Anthropic 官方端点继续使用 SDK 原生工具模式；对话切换 Provider/端点时按快照与端点重新计算，不读取当前全局开关改写旧对话。
- 实验会话必须先用正常 `settingSources` 做一次不消费用户 prompt、不发送模型请求的 MCP discovery，再以 `strictMcpConfig: true` 重建其它可序列化 MCP，移除 `synapse-mcp` 并注入进程内 `synapse-tool-router`。不得用 `disallowedTools`、运行时 toggle 或同名 server 覆盖模拟隔离。
- 只要 discovery 失败、MCP 配置无法无损重建、存在显式 `mcp__synapse-mcp__*` 权限规则、policy helper 或 Synapse server 工具策略，整次会话必须回退完整 MCP。回退只记录安全 reason 枚举并显示一次会话状态；header、环境变量、凭据和 MCP 配置正文不得进入日志、事件、history 或导出。
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
