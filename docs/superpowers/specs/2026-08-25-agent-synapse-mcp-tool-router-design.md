# Agent Synapse MCP 工具按需加载设计

> Superseded note: `search`/`invoke` 已从进程内实验升级为 `/mcp` 的**唯一**公开工具表面。本文件中「`/mcp`、Claude Code 注册、公开工具名、schema 与 225/223 能力数量不变」以及「两个 router 工具只存在于 Agent SDK 进程内会话」的描述已失效；权威现状见 `docs/agents/capability-registry.md` 与 `docs/agents/agent-runtime-security.md`。进程内注入流程本身仍然有效。
>
> 中文检索范围另有更新：下方「内部协议」一节中「中文常用的云盘、文件和列表词汇映射到规范索引词，不为单个模型维护别名」的表述已被 `docs/superpowers/specs/2026-09-22-synapse-tool-router-chinese-search-lexicon-design.md` 取代 —— 中文支持从 7 条别名扩展为覆盖全部工具名段的中文词表。

## 目标

在不改变公开 Synapse MCP、权限语义或已有对话的前提下，为第三方 Anthropic-compatible Provider 提供默认开启的工具按需加载实验，降低 223 个 Synapse 工具 schema 的初始上下文占用。

## 产品边界

- 系统设置“实验功能”下提供“Synapse MCP 工具按需加载”，默认开启，异常配置归一化为关闭，缺省配置使用默认开启。
- 开关只在新建对话时写入 `agentConfig.experimentalSynapseToolRouterEnabled`；缺少字段的旧对话按默认开启处理，显式 false 继续关闭。
- 实际模式由对话快照与 Provider 端点共同决定。Anthropic 官方端点不启用；第三方端点启用。对话内切换 Provider 时重新创建 live session 并重新计算。
- `/mcp`、Claude Code 注册、公开工具名、schema 与 225/223 能力数量不变。两个 router 工具只存在于 Agent SDK 进程内会话。

## 启动流程

1. 以 `user`、`project`、`local` 正常 setting sources 解析 SDK 设置。
2. 创建不读取真实用户 prompt 的 discovery query，只等待初始化与 `mcpServerStatus()`，随后关闭。
3. 把会话显式注入的非 Synapse Server 记录为预期集合；等待 pending 最多 5 秒。缺失、离线、待授权或超时只记录安全诊断并排除该项。
4. 从有效配置移除 `synapse-mcp`，保留其它可重建且已连接的 stdio、HTTP 或 SSE server；可选配置不支持时只排除该项。
5. 以 `strictMcpConfig: true` 创建正式 query，注入进程内 `synapse-tool-router`。可选连接器失败不能恢复全量 Synapse schema。

整体 discovery 失败、重名、policy helper、Synapse server 级工具策略、原始 Synapse 权限规则或路由器创建失败时，使用 strict 空 MCP 集合，仅保留受现有权限约束的内置工具。任何情况下不得全量回退，也不得通过路由器绕过原工具权限。日志只记录名称和安全 reason/status，不记录配置、header、环境变量或凭据。

## 内部协议

`search({ query, domain?, limit? })` 使用现有 Fuse.js 搜索完整注册表。索引覆盖工具名、action ID、capability title、domain、描述、schema 字段及中英文 domain 别名。`query` 可选：给了就搜索，不给就返回该 domain（或全部域）的一行式索引，此时 limit 上限 200、并回报 total；搜索模式 limit 仍为 1–5；精确名称优先，自然语言查询先按词命中覆盖、规范 action 精确度和语义词距离重排，再以 Fuse score 与名称稳定排序。中文常用的云盘、文件和列表词汇映射到规范索引词，不为单个模型维护别名。结果返回原始工具名、domain、描述和完整 `inputSchema`。

`invoke({ toolName, arguments? })` 只接受注册表中的规范 `app_*` 工具名。执行直接进入现有 action router，不使用 HTTP 回环；结果复用公共 `/mcp` 归一化，并继续经过 `PermissionGuard`、`AuditSink` 与取消信号。结构化日志仅包含工具名、domain、状态和耗时。

## 权限与投影

- `search` 只读；Persona 完全禁用工具或未允许任何 Synapse 工具时拒绝。
- `invoke` 先还原 `mcp__synapse-mcp__<tool>`：`plan` 只允许注册表只读 action，`dontAsk` 拒绝，`bypassPermissions` 允许进入底层 guard/audit，其它模式按真实工具和参数进入既有授权流程。
- 主 Agent 与子 Agent 的 Persona/allowlist 均按真实工具校验。SDK 侧只暴露 router wrapper，host 侧保留原始 allowlist 用于逐次执行判定。
- 权限卡片、assistant tool block、toolUse、toolResult、history 与导出按 `toolUseId` 投影为真实工具名和参数；`search` 保留 router 名。为避免 envelope 或受控附件路径泄漏，相关流式 `input_json_delta` 不持久化正文。
- 同一 live session 的回退提示最多发出一次；历史恢复显示同一状态，不保存内部 reason 或配置。

## 验证

- 配置默认值、异常归一化、IPC 往返与设置保存。
- 对话快照、旧对话兼容、第三方/官方端点与 Provider 切换。
- discovery 不读取真实 prompt、strict MCP 重建、其它 MCP 保留及所有安全回退。
- 223 工具索引、精确/中英文/domain/schema 搜索、稳定排序、限制与空结果。
- invoke 未知工具、参数、取消、公共 MCP 结果一致性、权限模式、Persona/子 Agent、事件投影与一次性回退。
- Desktop typecheck、受影响 Vitest、hard constraints、packaged asar、IPC codegen 与 `git diff --check`。

真实百炼请求属于有计费外部调用，需在明确授权并具备可用凭据时执行；自动化门禁以不发模型请求的 discovery 与 fake SDK query 证明初始工具集合边界。
