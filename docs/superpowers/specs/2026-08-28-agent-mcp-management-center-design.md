# Agent MCP 管理中心设计

日期：2026-08-28  
状态：待实施  
适用版本：`@anthropic-ai/claude-agent-sdk@0.3.245`

## 1. 决策摘要

本功能设计为 **Agent 当前会话的上游 MCP 管理面板**，入口位于 `AgentConversationWorkspace` 顶栏，并复用现有 `Workspace Auxiliary Panel`。它不进入系统设置，不注册新的 System App、Dock、Capability、MCP Tool、Workflow、Automation 或 Deep Link。

必须保持两个产品表面分离：

| 产品表面 | 管理对象 | 现有/新增入口 |
|---|---|---|
| 系统设置 → MCP | Synapse 自己提供的 loopback `/mcp` Server，以及 Claude Code、Codex、Cursor 等外部客户端是否已注册 Synapse | 保留现有 `window.synapse.mcp` |
| Agent → MCP 管理中心 | 当前 Agent live session 连接的上游 MCP Server | 新增 Agent 工作区辅助面板，使用 `window.synapse.agent.mcp.*` |

目标能力分三层交付：

1. **可观测与控制**：连接状态、重连、临时启停、实际工具数、逐 Server 上下文、失败诊断。
2. **会话内编排**：运行中动态添加/移除 HTTP、SSE、stdio MCP；接收 MCP Elicitation 表单和 URL。
3. **标准授权**：为 `needs-auth` Server 实现完整 MCP OAuth 客户端，不用手填静态 Bearer Token。

这些能力来自 Claude Agent SDK 内的 MCP 客户端、Query 控制通道和 MCP 协议，不依赖 Anthropic 自家模型。DeepSeek 官方模型和阿里云百炼 Anthropic-compatible 模型复用同一条运行路径；模型只需继续正确支持 Anthropic 格式的 tool use。逐工具 token 是 SDK 对当前提示上下文的估算，不等同于第三方 Provider 的计费 token。

## 2. 现状审计

### 2.1 SDK 0.3.245 已提供的能力

| 需求 | SDK 入口 | SDK 返回/限制 | Synapse 当前利用情况 |
|---|---|---|---|
| 当前 MCP 列表与状态 | `Query.mcpServerStatus()` | `connected`、`failed`、`needs-auth`、`pending`、`disabled`，并返回 scope、serverInfo、工具列表和错误 | 未暴露给 Agent 产品层 |
| 重新连接 | `reconnectMcpServer(name)` | 手动发起重连；官方说明远程连接连续五次自动重试失败后才进入 `failed`/`needs-auth` | 未使用 |
| 临时启停 | `toggleMcpServer(name, enabled)` | 操作当前 Query；本设计不得因此改写用户设置文件 | 未使用 |
| 动态添加/移除 | `setMcpServers(servers)` | 替换 SDK/动态来源集合；不移除 settings-file Server，省略 plugin-owned Server 也不会移除它 | 未使用 |
| 实际工具数 | `McpServerStatus.tools` | 已连接 Server 的真实工具清单 | 仅 SDK 内部可见 |
| 逐 MCP 上下文 | `getContextUsage().mcpTools` | 每个工具含 `serverName`、`tokens`、`isLoaded` | 当前只投影会话总占用，不保留 MCP 分项 |
| Elicitation | `Options.onElicitation` | form/url；未提供 callback 时自动 decline；URL 完成另有 `elicitation_complete` 消息 | 未设置，当前会被自动拒绝 |
| OAuth | `needs-auth` 状态 | SDK 不打开浏览器、不执行交互式 OAuth；应用必须自行完成并把 token 放入 Server header | 未实现 |

### 2.2 现有代码边界

- `claude-sdk-session.ts` 已固定加载 `settingSources: ["user", "project", "local"]`，因此用户本机和项目 MCP 会进入当前 Agent 会话。
- `QueryLike`、`SynapseToolRouterQuery` 和 `AgentLiveSession` 当前只穿透 context usage、权限切换、附件目录与文件撤销，没有穿透 MCP 控制方法。
- `AgentContextUsageTracker` 当前把 `getContextUsage()` 收敛为会话总 token，丢弃了 `mcpTools` 的逐工具明细。
- `AgentWorkspaceShell` 已提供会话级、主窗口/独立窗口共用的辅助面板，是本功能的最低正确 UI 宿主。
- 系统设置中的 `McpSettingsPanel` 只显示 Synapse 本地 HTTP MCP Server 和外部客户端注册，不能承载上游会话 MCP。
- 第三方 Provider 的 Synapse MCP 按需加载实验会先 discovery，再用 `strictMcpConfig` 重建有效 MCP，并注入 `synapse-tool-router`。动态 MCP 集合必须与这层基础集合合并，不能调用 `setMcpServers({})` 误删重建后的 Server。
- live session 会被关闭、重建或因空闲回收。会话内临时 MCP 状态不能只挂在某一个 Query 实例上。

## 3. 官方契约形成的产品约束

### 3.1 状态不是一次性初始化结果

`system/init.mcp_servers` 只是 init 发出时的快照。settings-file Server 可能仍为 `pending`，远程 Server 断线重连时也会从 `connected` 回到 `pending`。管理中心必须在面板打开期间轮询 `mcpServerStatus()`，不能把 init 事件当作最终状态。

### 3.2 `pending` 不等于失败

`pending` 可能表示仍在连接、使用缓存工具清单并等待首次调用，或连接截止时间附近的中间状态。只有 `failed` 和 `needs-auth` 可以直接归类为不可用；`pending` 显示“连接中”。

### 3.3 动态 Server 不是全量 MCP 配置

`setMcpServers()` 管理的是 SDK/运行时动态集合：

- settings-file Server 不因 payload 省略而删除；
- plugin-owned Server 也不会因省略而删除；
- 当前 Synapse tool router 模式把重建后的基础 Server 作为 SDK options 传入，底层调用时必须始终携带基础集合、router 和会话 overlay；
- `setMcpServers({})` 不能被产品文案解释为“当前会话已经没有任何 MCP”。

### 3.4 工具数与上下文占用是两个指标

工具搜索默认会延迟加载部分 MCP schema。管理中心必须同时显示：

- `status.tools.length`：Server 实际暴露的工具总数；
- `mcpTools.isLoaded !== false`：当前已加载进模型上下文的工具数/token；
- `mcpTools.isLoaded === false`：已发现但延迟加载的工具数/token。

不能把延迟工具 schema 的 token 计入“当前占用”。

### 3.5 OAuth 与 URL Elicitation 不是同一件事

- **MCP Authorization**：Synapse 作为 MCP Client 授权访问 MCP Server，对应 `needs-auth`。SDK 不提供完整流程。
- **URL Elicitation**：MCP Server 在一次工具调用中要求用户到站外完成第三方授权、付款或输入敏感信息。SDK 直接给出 URL，这个 URL 不能用来替代 MCP Client 自身授权。

UI 和状态机必须使用不同名称与操作。

## 4. 目标与非目标

### 4.1 目标

- 用户能确认当前 live session 真正连接了哪些 MCP、来自哪里、当前是什么状态。
- 用户能在不编辑 `~/.claude.json` 或项目 `.mcp.json` 的情况下完成本会话重连、临时启停和动态增删。
- 用户能看到每个 MCP 暴露工具总数、当前加载工具数、当前上下文 token 和延迟 token。
- Elicitation 不再被 SDK 自动拒绝，用户可以安全提交 form 或明确同意打开 URL。
- 失败信息能区分连接、授权、工具发现、工具调用、Elicitation 和运行时变更阶段，并提供可执行的下一步。
- DeepSeek 官方与百炼 Anthropic-compatible Provider 使用相同功能，不按模型品牌做能力开关。

### 4.2 非目标

- 不在此处编辑、保存或覆盖用户的 Claude Code MCP 配置文件。
- 不把会话临时 Server 变成全局 MCP Server 市场或持久化 Server 目录。
- 不向 Renderer、timeline、history、日志或导出暴露 MCP config、command args、env、header、access token、refresh token 或原始错误正文。
- 不在 V1 展示完整工具 schema、工具描述或原始 tool result。
- 不把 `synapse-tool-router` 的两个 wrapper 工具计成 223 个“已暴露工具”。
- 不用 Elicitation form 收集密码、API key、access token、支付凭据等敏感信息。
- 不要求用户手写静态 Bearer Token 作为远程 MCP 的正式授权方案。

## 5. 信息架构与 UI

### 5.1 入口

在 Agent 对话顶栏增加 `MCP` ghost 小按钮：

- 无需处理时显示 `MCP`；
- 存在 `failed`、`needs-auth` 或待处理 Elicitation 时显示 `MCP N`；
- 点击打开 `agent.mcp-management` 辅助面板；
- 主 Agent 页面和独立对话窗口复用同一组件；
- 切换会话立即关闭面板，禁止短暂显示上一会话状态。

不在左侧会话导航、全局 App shell 或系统设置增加第二个入口。

### 5.2 面板布局

```text
┌────────────────────────────────────────────┐
│ ←  MCP                         刷新   添加 │
├────────────────────────────────────────────┤
│ 4 已连接 · 1 连接中 · 1 失败               │
│                                            │
│ 待处理                                     │
│ GitHub 需要信息                       回答 │
│                                            │
│ GitHub       已连接   18 工具       1.8K   │
│ Database     连接中    —             —     │
│ Linear       需要授权  12 工具        —     │
│ Synapse      已连接    2 / 可检索 223  420  │
└────────────────────────────────────────────┘
```

视觉规则：

- 复用现有辅助面板 header、`Button`、`Badge`、`Switch`、`DropdownMenu`、`Dialog`、`Input`、`Label`、`ScrollArea`、`Alert` 与主题 token。
- Server 使用单层列表行，不做卡片套卡片，不新增颜色或 CSS。
- 数字右对齐；状态同时使用文字和图标，不只依赖颜色。
- 主列表只显示名称、来源、状态、工具数、上下文和必要操作；诊断详情在选中行后显示。
- 不显示介绍段落。空状态只写：`发送首条消息后可查看会话 MCP。` 或 `会话已休眠，发送消息后恢复。`

### 5.3 状态与动作

| SDK 状态 | 文案 | 主动作 | 次动作 |
|---|---|---|---|
| `pending` | 连接中 | 无 | 详情 |
| `connected` | 已连接 | 临时停用 | 重连、详情 |
| `failed` | 失败 | 重新连接 | 临时停用、复制诊断 |
| `needs-auth` | 需要授权 | 授权 | 临时停用、复制诊断 |
| `disabled` | 已停用 | 启用 | 详情 |

`managed` 或产品内部 Server 可以禁用不允许的动作。动态添加的 Server 额外显示“从本会话移除”；settings、plugin、managed 来源不显示“移除”。

### 5.4 Server 详情

详情只投影安全字段：

- 名称、来源、transport、Server implementation name/version；
- HTTP/SSE 只显示经过净化的 scheme、host 和 path，不显示 userinfo、query、fragment 或 headers；
- 工具总数、当前加载数、延迟数；
- 当前加载 token、延迟 token、统计时间；
- 最近安全诊断、建议操作和最近重连时间；
- 动态 Server 显示“仅本次会话”。

stdio 的 command、args 和 env 不回传 Renderer。即使用户刚刚提交过，也不从主进程再次读取展示。

## 6. 会话状态模型

```ts
type AgentMcpRuntimeAvailability =
  | "not-started"
  | "starting"
  | "live"
  | "dormant"
  | "closed"

type AgentMcpConnectionStatus =
  | "pending"
  | "connected"
  | "failed"
  | "needs-auth"
  | "disabled"

type AgentMcpOrigin =
  | "user"
  | "project"
  | "local"
  | "plugin"
  | "managed"
  | "claudeai"
  | "dynamic"
  | "synapse-internal"
  | "unknown"

interface AgentMcpServerView {
  serverKey: string
  name: string
  status: AgentMcpConnectionStatus
  origin: AgentMcpOrigin
  transport: "stdio" | "http" | "sse" | "sdk" | "proxy" | "unknown"
  serverInfo?: { name: string; version: string }
  endpoint?: { display: string; host: string; suspicious: boolean }
  tools: {
    total: number | null
    loaded: number | null
    deferred: number | null
  }
  context: {
    loadedTokens: number | null
    deferredTokens: number | null
    measurement: "sdk-estimate"
  }
  actions: {
    reconnect: boolean
    toggle: boolean
    remove: boolean
    authorize: boolean
  }
  diagnostic?: AgentMcpDiagnosticView
}

interface AgentMcpSessionSnapshot {
  projectId: string
  conversationId: string
  runtimeGeneration: string
  revision: number
  availability: AgentMcpRuntimeAvailability
  stale: boolean
  servers: AgentMcpServerView[]
  pendingElicitations: AgentMcpElicitationView[]
  refreshedAt: string
}
```

`runtimeGeneration` 在每次 Query 重建时更换。所有写操作必须带 `serverKey + runtimeGeneration + revision`，主进程拒绝旧面板对新 Query 的操作。

`serverKey` 是 live session 内部生成的不可猜标识，主进程持有 `serverKey → SDK server name` 映射。Renderer 不得直接提交任意 SDK server name 执行重连、启停或删除。

## 7. 临时状态生命周期

“临时”定义为当前应用进程中的当前 Agent conversation：

- 动态添加列表和启停 override 存在 `RuntimeSessionState` 的内存 sidecar；
- Provider、Persona、上下文配置或 tool router 导致 Query 重建时自动重放；
- 空闲回收后重新唤醒同一 conversation 时自动重放；
- 应用退出、conversation reset/delete 或用户主动移除时清空；
- 不写入 ConversationEntry、history、DataRepository、配置文件或导出包。

会话休眠时可以保留最后一次安全快照，但必须标记“上次状态”，所有动作禁用。不得为了打开管理面板而悄悄创建 discovery Query、启动 stdio 进程或建立网络连接。

## 8. 主进程架构

```text
Agent UI
  └── window.synapse.agent.mcp.*
      └── agent IPC（UI 私有）
          └── AgentRuntimeService
              └── AgentMcpSessionController（按 conversation）
                  ├── RuntimeSessionState 临时 overlay / revision / diagnostics
                  ├── AgentLiveSession MCP 控制接口
                  └── ClaudeSDKSession / SynapseToolRouterQuery
                      └── Claude Agent SDK Query
```

目标新增：

```text
desktop/electron/services/agent-runtime/agent-mcp-session-controller.ts
desktop/electron/services/agent-runtime/agent-mcp-diagnostics.ts
desktop/electron/modules/agent/ipc-mcp.ts
desktop/src/types/agent-mcp.ts
desktop/src/modules/agent/hooks/use-agent-mcp-session.ts
desktop/src/modules/agent/components/agent-mcp-management-panel.tsx
desktop/src/modules/agent/components/agent-mcp-add-dialog.tsx
desktop/src/modules/agent/components/agent-mcp-elicitation-dialog.tsx
```

现有三个接口层必须同步扩展：

```ts
interface QueryLike {
  mcpServerStatus?(): Promise<McpServerStatus[]>
  getContextUsage?(): Promise<SDKControlGetContextUsageResponse>
  reconnectMcpServer?(name: string): Promise<void>
  toggleMcpServer?(name: string, enabled: boolean): Promise<void>
  setMcpServers?(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult>
}

interface AgentLiveSession {
  getMcpSnapshot?(): Promise<AgentMcpRuntimeSnapshot>
  reconnectMcpServer?(serverName: string): Promise<void>
  toggleMcpServer?(serverName: string, enabled: boolean): Promise<void>
  replaceDynamicMcpServers?(servers: AgentDynamicMcpConfigMap): Promise<McpSetServersResult>
}
```

`DynamicQuery` 与 `SynapseToolRouterQuery` 都必须完整穿透。不能只修改默认 Query 包装器，否则启用 tool router 的 DeepSeek/百炼会话会缺少功能。

## 9. 状态刷新与并发控制

面板刷新策略：

1. 打开时立即请求一次 status + context。
2. 面板可见且存在 `pending` 时每 3 秒刷新 status。
3. 面板可见且全部稳定时每 15 秒刷新 status。
4. context 每 10 秒刷新一次，并在 init、compact、turn result 和 MCP 变更后立即刷新。
5. 面板隐藏后停止轮询；主进程仍可由 init、Elicitation 和操作结果更新快照。

同一 conversation 的 MCP 写操作进入一条串行队列：

- 操作前校验 runtime generation 与 revision；
- 操作中该 Server 显示局部 busy，不锁死整个对话 UI；
- 操作后始终重新拉取 `mcpServerStatus()` 和 `getContextUsage()`；
- SDK 抛错或 `McpSetServersResult.errors` 非空时，以重新拉取的状态为权威；
- Query 在操作期间更换时返回稳定错误 `SESSION_CHANGED`，Renderer 刷新，不自动重试写操作。

## 10. 动态添加与移除

### 10.1 动态集合算法

Controller 分开维护：

```ts
queryOwnedBase   // 当前 Query wrapper 通过 options.mcpServers 持有的基础集合
internalServers  // synapse-tool-router 等产品内部 Server
dynamicOverlay   // 用户在当前 conversation 临时添加的集合
```

每次调用底层 `setMcpServers()` 时发送：

```ts
effectiveServers = {
  ...queryOwnedBase,
  ...internalServers,
  ...dynamicOverlay,
}
```

普通 Query 的 `queryOwnedBase` 通常为空，settings-file 和 plugin Server 继续由 CLI 管理，不复制进 payload。tool-router Query 的 `queryOwnedBase` 是 discovery 后被重建进 `options.mcpServers` 的 Server，因此每次动态变更都必须重新携带。不得只发送 `dynamicOverlay`。名称与 settings、plugin、基础或内部 Server 冲突时直接拒绝，不允许覆盖 `synapse-mcp` 或 `synapse-tool-router`。

### 10.2 支持的配置

目标支持：

| Transport | 表单 | 安全要求 |
|---|---|---|
| HTTP | 名称、URL | 仅 `https`；loopback 开发 Server 可用 `http`；不接受手填 Authorization header |
| SSE | 名称、URL | 与 HTTP 相同；UI 标明兼容 transport，不默认推荐 |
| stdio | 名称、command、args、环境变量引用 | 显式确认本地进程启动；env 只绑定现有 Secrets 引用，不在配置中保存明文 |
| SDK in-process | 不提供 UI | 只由 Synapse 代码注册 |

HTTP/SSE URL 必须拒绝 userinfo 和 fragment。query 参数可以作为连接语义进入主进程，但不得回传、记录或导出；日志只保留净化后的 origin/path。

动态 stdio 启动属于 agent spawn / shell 敏感操作，动态 HTTP/SSE 属于网络连接；两者在调用 SDK 前必须经过 `PermissionGuard`，结果写入 `AuditSink`。审计只记录 conversation、transport、Server 安全标识、动作和 outcome。

## 11. 工具数与逐 MCP 上下文

主进程按 `serverName` 聚合 `getContextUsage().mcpTools`：

```ts
loadedTokens = sum(tokens where isLoaded !== false)
deferredTokens = sum(tokens where isLoaded === false)
loadedTools = count(isLoaded !== false)
deferredTools = count(isLoaded === false)
totalTools = mcpServerStatus.tools?.length ?? null
```

规则：

- `isLoaded` 缺失时按已加载处理，兼容旧返回。
- context 调用失败不影响连接状态；该 Server 显示 `—`，保留工具数。
- 第三方 Provider 一律显示 Tooltip：`由 Agent SDK 估算，不代表供应商计费。`
- `synapse-tool-router` 产品名显示为 `Synapse（按需加载）`：实际暴露 `2` 个 wrapper 工具，另显示 `可检索 223`；223 来自当前 capability registry，不计入已暴露工具数。
- 完整 `synapse-mcp` 按 `mcpServerStatus.tools.length` 显示真实公开工具数，不写死 223。

## 12. Elicitation

### 12.1 Runtime 协议

在 `ClaudeSDKSession` 的 Query options 设置 `onElicitation`。主进程为每个请求生成内部 `elicitationKey`，并只在内存维护：

```ts
interface PendingAgentMcpElicitation {
  elicitationKey: string
  conversationId: string
  runtimeGeneration: string
  serverName: string
  mode: "form" | "url"
  message: string
  requestedSchema?: RestrictedElicitationSchema
  url?: string
  sdkRequestId: string
  sdkElicitationId?: string
  expiresAt: string
  resolve(result: ElicitationResult): void
}
```

SDK `requestId`、`elicitationId` 和 Server name 不作为 Renderer 可执行标识。Renderer 只拿 `elicitationKey`，主进程完成映射和 runtime generation 校验。

多个 Elicitation 可以排队，但同一时间只打开一个 Dialog。新请求通过 Agent domain event 通知；Renderer 丢失事件后仍可从 snapshot 恢复待处理项。

### 12.2 Form mode

- 只实现 MCP 规范允许的顶层 primitive 字段与 enum，不执行任意 JSON Schema。
- 支持 required、string、number、integer、boolean、enum，以及有限的 date/date-time/email 格式。
- nested object/array、`$ref`、脚本化 pattern 或未知 schema 返回 `cancel`，并产生 `unsupported_elicitation_schema` 诊断。
- Dialog 必须显示请求 Server、请求原因、全部字段和“提交 / 拒绝”。关闭 Dialog 返回 `cancel`，不能默认为 accept。
- 检测字段标题/描述中含密码、token、secret、API key、支付凭据等敏感请求时拒绝渲染提交，并提示 Server 应使用 URL mode。
- 用户填写内容只在 Renderer 表单和主进程 pending promise 中短暂存在；不进入 timeline、history、日志、审计正文、Usage Analysis 或导出。

### 12.3 URL mode

- 显示完整 URL，并单独突出实际 hostname；Punycode、userInfo、非 HTTPS 和非 loopback HTTP 显示阻断或警告。
- 不预取 URL、favicon、title 或页面元数据。
- 只有用户点击“打开并继续”后，才通过受 `PermissionGuard`/`AuditSink` 保护的系统浏览器打开。
- 浏览器打开成功后向 SDK 返回 `{ action: "accept" }`；失败时不 accept。
- `elicitation_complete` 到达后按 Server + opaque elicitation id 关闭“等待完成”状态。
- “拒绝”返回 `decline`；会话关闭、请求 abort、Renderer 销毁或超时返回 `cancel`。

## 13. MCP OAuth 授权

### 13.1 为什么不能只做“打开 OAuth URL”

`needs-auth` 不携带一个可以直接交给用户的完整 SDK OAuth 流程。Synapse 必须作为原生 MCP OAuth Client 实现：

1. 读取主进程中的 Server URL，并处理 401 `WWW-Authenticate` challenge。
2. 发现 OAuth Protected Resource Metadata 和 Authorization Server Metadata。
3. 按 MCP 规范获得 client id：预注册、Client ID Metadata Document 或受支持的 Dynamic Client Registration。
4. 生成 PKCE verifier/challenge、state 和目标 resource。
5. 使用 `NetworkServiceRegistry` 建立受控 loopback callback；不复用账号登录的 `synapse://auth/desktop/callback`。
6. 经用户确认后在系统浏览器打开 authorization URL。
7. 校验 state、issuer、redirect URI 和 authorization response。
8. 通过受控 outbound HTTP 交换 token；access token 必须绑定 MCP resource。
9. 把 token 注入主进程有效 MCP config，并在当前 turn 结束后安全重建/恢复同一 SDK session。
10. token 到期时按规范刷新；失败回到 `needs-auth`。

如果 Server 不支持 Synapse 可用的 client registration 方式，显示 `该服务不支持自动授权`，不得降级让用户粘贴静态 Bearer。

“授权”动作只对可安全序列化的 HTTP/SSE Server 开放。开始流程前必须证明当前有效 MCP 集合能够无损重建，并且目标不是 `sdk`、proxy、managed、产品内部或无法保留所有权的 plugin Server；任一条件不满足时保持 `needs-auth` 并显示“不支持自动授权”。不得为了给单个 Server 注入 token 而丢失其它 settings、plugin、权限策略或 tool-router 语义。

### 13.2 Token 存储

OAuth 阶段新增 Agent 私有 encrypted DataRepository namespace，例如 `agent.mcp-oauth-tokens`：

- key 由 canonical MCP resource、issuer 和 client id 的哈希构成；
- encrypted body 保存 access token、refresh token、scope、expiresAt；
- 元数据只保存不可逆 resource hash、issuer origin、时间和状态；
- `safeStorage` 不可用时不落明文，授权流程在交换 token 前阻断；
- 不复用可被 Secrets App/MCP 枚举或读取的公开用户 Secrets 列表；
- 配置备份、Agent 对话导出和诊断包排除 token body。

OAuth 完成后不在活跃 turn 中强制替换 Query。Controller 标记待应用授权，在 turn terminal state 后通过当前 SDK session id 恢复；重建失败保留对话并显示安全错误，不回退静态 token。

## 14. 调用失败诊断

### 14.1 数据来源

- `mcpServerStatus().error`：连接、启动、握手和授权错误；
- `McpSetServersResult.errors`：动态集合变更错误；
- `PostToolUseFailure` / tool result：单次工具调用失败；
- Query/SDK 状态：会话关闭、控制通道失败、超时；
- Elicitation callback：unsupported schema、拒绝、取消、URL 打开失败；
- OAuth service：发现、注册、回调、issuer/state、token exchange、refresh。

### 14.2 诊断模型

```ts
type AgentMcpDiagnosticCode =
  | "auth_required"
  | "authorization_failed"
  | "executable_not_found"
  | "environment_missing"
  | "spawn_failed"
  | "connect_timeout"
  | "connection_refused"
  | "dns_failed"
  | "tls_failed"
  | "protocol_handshake_failed"
  | "transport_closed"
  | "tool_list_failed"
  | "tool_call_timeout"
  | "tool_call_failed"
  | "output_too_large"
  | "unsupported_elicitation_schema"
  | "session_changed"
  | "unknown"

interface AgentMcpDiagnosticView {
  code: AgentMcpDiagnosticCode
  phase: "connect" | "auth" | "discover" | "tool-call" | "elicitation" | "mutation"
  confidence: "exact" | "inferred" | "unknown"
  summary: string
  suggestedAction?: "reconnect" | "authorize" | "check-installation" | "check-network" | "open-config"
  observedAt: string
}
```

原始 SDK error 只能在主进程即时分类，分类后丢弃。不得把完整 error、stack、config、headers、env、URL query、tool input 或 tool result 放入日志、事件或 Renderer。

每个 live session 保留最多 50 条内存诊断。`复制诊断`只输出 SDK/Claude Code 版本、Provider 类别、Server 安全标识、transport、scope、状态、工具计数、诊断 code、时间和重试次数；不复制原始错误。

第三方模型的 malformed tool call、模型未选择工具或 Provider 不支持 tool use 属于 Agent/Provider 诊断，不归因给 MCP Server。

## 15. IPC 与事件契约

建议 operation id：

```text
app.agent.mcp.session.get
app.agent.mcp.server.reconnect
app.agent.mcp.server.set_enabled
app.agent.mcp.server.add
app.agent.mcp.server.remove
app.agent.mcp.authorization.start
app.agent.mcp.authorization.cancel
app.agent.mcp.elicitation.respond
app.agent.mcp.state.changed
```

对应 bridge：

```ts
window.synapse.agent.mcp.session.get(...)
window.synapse.agent.mcp.server.reconnect(...)
window.synapse.agent.mcp.server.setEnabled(...)
window.synapse.agent.mcp.server.add(...)
window.synapse.agent.mcp.server.remove(...)
window.synapse.agent.mcp.authorization.start(...)
window.synapse.agent.mcp.authorization.cancel(...)
window.synapse.agent.mcp.elicitation.respond(...)
window.synapse.agent.mcp.onStateChanged(...)
```

这些是 Agent UI 私有 IPC。不得因为 operation id 使用 `app.*` 就注册同语义 Capability 或 Synapse MCP Tool。实现时应扩展现有 `agentIpcModule`，不扩展顶层 `window.synapse.mcp`。

## 16. 安全硬规则

1. 所有网络连接、外部 URL 打开、stdio process spawn、OAuth secret 读写必须经过 `PermissionGuard` 和 `AuditSink`。
2. Renderer 永远不接收 SDK `McpServerStatus.config` 原值。
3. 原始 config、headers、env、OAuth token、PKCE verifier/state、完整授权 URL、Elicitation form content 不进入结构化日志。
4. Elicitation form 不收集凭据；敏感交互使用 URL mode。
5. Elicitation URL 不自动打开、不预取；显示完整 URL 和真实 host 后由用户确认。
6. MCP OAuth access token 只能发送给它被签发的 canonical resource，禁止 token passthrough。
7. 动态 stdio 不能绕过 Agent 现有 workspace、Persona、tool permission、OS 权限与审计；添加 Server 不等于自动允许其工具。
8. 启停、重连、添加或授权不得隐式修改 `~/.claude.json`、`.mcp.json` 或 plugin 文件。
9. `synapse-mcp` 与 `synapse-tool-router` 是产品内部关键 Server，动态集合不得同名覆盖。
10. 面板关闭或会话销毁时所有未完成 Elicitation 必须 fail-closed。

## 17. 与 DeepSeek 和百炼模型的兼容边界

| 能力 | 是否依赖 Anthropic 模型 | 说明 |
|---|---:|---|
| Server 状态、重连、启停、动态增删 | 否 | Claude Agent SDK/CLI 的本地控制通道 |
| 工具清单与工具总数 | 否 | MCP `tools/list` 结果，由 SDK Client 持有 |
| 逐 Server 上下文 token | 否，但为 SDK 估算 | 统计 SDK 放入当前 prompt 的 MCP schema；不等同第三方计费 |
| Elicitation form/url | 否 | MCP server-to-client 协议；只有在工具流程触发时出现 |
| MCP OAuth | 否 | Synapse 作为原生 OAuth Client 执行 |
| 模型实际调用 MCP 工具 | 依赖兼容质量 | DeepSeek/百炼端点必须正确实现 Anthropic tool use、流式 block 和 tool result 往返 |

因此不新增 `if provider === deepseek/bailian` 分支。可用性门槛应检测 live Query/SDK 方法和 Server 状态，而不是模型品牌。

## 18. 分期建议

### Phase 1：可观测与控制

- Agent 辅助面板入口；
- status、来源、transport、工具总数；
- loaded/deferred 工具与逐 Server token；
- 重连、临时启停；
- 安全诊断与复制诊断；
- normal Query 与 tool-router Query 双路径。

这是优先级最高的一期：价值直接、无新持久化、完全与模型无关。

### Phase 2：会话内动态能力与 Elicitation

- 动态 HTTP/SSE 添加、移除；
- stdio 先只做受控本地 command + Secrets 引用；
- form/url Elicitation；
- pending queue、URL 安全检查、abort/close fail-closed；
- Query 重建与临时 overlay 重放。

### Phase 3：完整 MCP OAuth

- metadata discovery、client registration、PKCE、loopback callback；
- encrypted token vault、refresh、resource binding；
- `needs-auth` 授权、取消和重试；
- session idle 后安全应用授权。

不得把“打开一个 URL”作为 Phase 3 的替代实现。

## 19. 验证计划

### 19.1 SDK 与主进程

- 五种 status、pending 轮询与 connected → pending → failed/needs-auth。
- normal Query、routed Query 的 MCP 方法完整穿透。
- `setMcpServers` 保留 settings、plugin、router 与基础集合；同名冲突拒绝。
- Query 重建、Provider 切换、idle reclaim 后临时 overlay 重放；reset/app restart 清空。
- runtime generation/revision 过期写操作拒绝。
- status.tools 与 mcpTools loaded/deferred 聚合。
- context 查询失败不破坏状态。

### 19.2 Elicitation

- form accept/decline/cancel、required/enum/primitive 校验。
- nested/未知 schema fail-closed。
- 敏感字段拒绝、内容不进入日志/history/export。
- URL 不预取、不自动打开、host 展示、Punycode、userinfo、协议限制。
- openExternal 失败、SDK abort、session close、Renderer 销毁与超时。
- `elicitation_complete` 关联，不用顺序或 Server name 猜测。

### 19.3 OAuth

- Protected Resource / Authorization Server discovery、redirect 限制。
- PKCE/state/issuer/resource 校验、callback 超时和取消。
- client registration 不可用时不降级静态 Bearer。
- access/refresh token 加密、safeStorage 不可用 fail-closed。
- token 不出现在 IPC、日志、审计、备份、导出和错误。

### 19.4 Renderer

- 主窗口与独立窗口复用、宽屏 split/窄屏 detail。
- 会话切换立即清空，休眠状态不触发隐式 Query。
- 状态文字、键盘焦点、屏幕阅读器 label、错误操作下一步。
- 单层列表、数字右对齐、无自定义颜色/CSS/卡片嵌套。

### 19.5 完成门禁

```bash
pnpm --filter @synapse/desktop run test -- --run
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run check:packaged-asar
```

涉及 IPC 后运行 codegen 并验证 preload 契约；涉及长期 Agent/MCP 边界时同步更新 `docs/agents/module-boundaries.md`、`docs/agents/agent-runtime-security.md` 和用户可感知发布说明。该功能不新增公开注册表面，`docs/agents/capability-registry.md` 的数量不变，但实施时仍需核对并记录例外说明。

## 20. 依据

- 当前安装包类型：`desktop/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
- 仓库内版本文档：`docs/claude/sdk/typescript.md`、`docs/claude/sdk/mcp.md`、`docs/claude/sdk/hooks.md`
- [Claude Agent SDK：MCP](https://code.claude.com/docs/en/agent-sdk/mcp)
- [Claude Agent SDK：TypeScript Reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [MCP：Elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation)
- [MCP：Authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- 现有 Synapse tool router：`docs/superpowers/specs/2026-08-25-agent-synapse-mcp-tool-router-design.md`
- 现有 Agent 辅助面板：`docs/superpowers/specs/2026-08-26-agent-file-checkpoint-workspace-panel-design.md`
