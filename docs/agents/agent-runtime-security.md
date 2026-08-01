# Agent Runtime、MCP 与脱敏规则

本文件适用于 Claude Agent SDK 参数、Agent event bridge、MCP 注册/诊断、权限事件、timeline、导出、Usage Analysis 和 provider 预览。

## Claude SDK 配置

- 修改 SDK 参数前核对官方文档和当前安装包类型。`Options.env` 是子进程环境；`Options.settings` 是更高优先级 inline/flag settings，两者不能混用。
- Provider 隔离必须同时写两层：顶层 `Options.env`，以及 `Options.settings.env` 中当前 provider 的 `ANTHROPIC_*` 覆盖（至少 base URL、model、auth token/API key 和默认模型变量）。
- `Options.settings.env` 只能放 provider 的 `ANTHROPIC_*`，不得放 `SYNAPSE_SIDE_CHANNEL_TOKEN`、data-server token、普通 shell env 或其它 runtime secret。
- 回归测试必须证明 provider 配置进入 `settings.env`，side-channel 等非 provider secret 不进入。
- 历史回归：提交 `6778d598e` 曾删除 `settings.env: options.env`，导致用户本机配置其它 Claude provider 时混用旧 base URL 与当前模型。遇到 `model not found or not supported`，先检查 `desktop/electron/services/agent-runtime/claude-sdk-session.ts` 的覆盖层。

## MCP 命名、传输与 Schema

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
