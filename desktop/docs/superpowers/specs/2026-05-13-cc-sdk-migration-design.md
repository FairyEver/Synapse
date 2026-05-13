# CC SDK Migration Design

Synapse 对话系统重构：砍掉 Codex/Hermes 适配器，只保留 Claude Code，用 Agent SDK 替换 spawn CLI，重写 Provider 管理模块。

## 决策记录

- 内置 Agent SDK（binary 随 app 分发，用户无需安装 CC CLI）
- 去掉 AgentAdapter 抽象层，SDK 调用直接嵌入 AgentRuntimeService
- 重写 Provider 模块（对话级别隔离）
- API Key 用 Electron safeStorage 加密存储
- 前后端一起重做
- 分两步迁移：Phase 1 砍掉 Codex/Hermes，Phase 2 引入 SDK + 重写 Provider

## Phase 1：砍掉 Codex/Hermes

纯删除 + 简化，不引入新依赖。目标：所有 agent 相关代码只剩 CC 一条路径。

### 删除清单

**后端文件删除：**
- `electron/services/agent-runtime/adapters/codex-exec.ts` (854 行)
- `electron/services/agent-runtime/adapters/codex-app-server-protocol.ts` (205 行)
- `electron/services/agent-runtime/adapters/codex-app-server-session.ts` (442 行)
- `electron/services/agent-runtime/adapters/hermes-exec.ts` (120 行)
- `electron/services/agent-runtime/agent-availability-service.ts`
- `electron/services/agent-runtime/binary-detect-service.ts`
- `electron/services/provider-config/codex-runtime.ts`
- 对应的 `__tests__/` 文件

**前端文件删除：**
- `src/definitions/agent/codex/` 整个目录
- `src/definitions/agent/hermes/` 整个目录
- `src/modules/agent/components/agent-picker-popover.tsx`

### 代码简化

**AgentRuntimeService：**
- 删除 `AgentAdapterFactory` 类型
- 删除 `adapterFactory` 依赖
- `adapter` 字段直接使用 `ClaudeCodeAdapter` 实例（Phase 2 会替换为 SDK）

**前端 agentType 引用硬编码：**
- `src/modules/prompts/components/prompt-run-dialog.tsx` — 去掉 agent 选择 UI，硬编码 `"claude-code"`
- `src/modules/prompts/hooks/use-prompt-run.ts` — `agentType` 参数固定
- `src/modules/task-scheduler/components/task-form-dialog.tsx` — 去掉 agent 选择
- `src/modules/agent/hooks/use-agent-chat.ts` — 去掉 agentType 切换逻辑
- `src/modules/agent/hooks/use-chat-connection.ts` — 简化
- `src/modules/settings/components/agent-runtime-panel.tsx` — 不再显示多 agent 状态

**后端 agentType 引用：**
- `electron/modules/ops/ipc.ts` — `agentType` 字段保留但默认 `"claude-code"`
- `electron/runtime/data-repo/schemas/placeholders.ts` — schema 中 `agentType` 保留（向后兼容已有数据），新记录默认 `"claude-code"`
- `electron/services/workflow/workflow-engine.ts` — 已经不依赖 agentType，无需改动
- `electron/modules/agent/ipc-sessions.ts` — 简化 adapter 选择逻辑

**不受影响的模块：**
- 编辑器安装（Skills/Rules 安装到 Claude Code / Cursor / Codex 等编辑器的逻辑不变）
- 内容管理（Rules / Skills / Prompts CRUD）
- 仓库 Git 操作

## Phase 2：SDK 替换 + Provider 重写

Phase 2 不再以兼容旧 spawn CLI 架构为目标。它以 Agent SDK 的能力模型为核心，重写 agent runtime 与 provider 管理，同时保留 Synapse 自己的 Electron 边界、IPC 类型和对话数据模型。

### Agent SDK 集成

**依赖：** `@anthropic-ai/claude-agent-sdk`（TypeScript SDK，自带 CC binary）

**包体积影响：** +100-150MB（CC binary）

#### 输入模式

采用 Hybrid 模式：

- 主路径使用 SDK Streaming Input Mode。它是 SDK 推荐模式，支持长生命周期会话、队列消息、中断、图片、权限请求、hook、MCP 与后续扩展。
- 空闲会话可释放。再次进入对话时用 SDK session id 恢复，避免长期占用进程。
- SDK session 异常退出时进入 recovering 状态，用已持久化 session id 恢复。
- 对一次性后台任务或超时任务，可用 `maxTurns` + `AbortController` 创建短生命周期执行。

状态机：

```text
cold -> warming -> ready -> streaming -> idle -> cold
          ^                         |
          |                         v
          +------ recovering <------+
```

#### 会话模块

新结构：

```text
electron/services/agent-runtime/
├── agent-runtime-service.ts    # service 入口，组装下列模块
├── claude-sdk-session.ts       # SDK query/streaming 封装与状态机
├── session-manager.ts          # conversationId -> SDK session 生命周期
├── conversation-router.ts      # governance、slash command、事件分发
├── types.ts                    # AgentEvent 与 SDK bridge 类型
├── command-registry.ts
├── command-router.ts
├── governance.ts
├── references.ts
├── session-lifecycle.ts
├── session-repository.ts
└── skill-registry.ts
```

删除：

- `electron/services/agent-runtime/adapters/`
- `electron/services/agent-runtime/message-router.ts`
- `AgentAdapter`
- `ClaudeProcessRunner`

保留 `AgentLiveSession` 的语义，但它不再代表外部 CLI 进程适配器，而是代表一个可发送消息、取消当前 turn、关闭和产出事件的 SDK 会话。

#### MessageRouter 处理

`MessageRouter` 不保留原文件。当前 `MessageRouter` 同时承担队列、adapter 路由、权限暂存、压缩、exec turn、side session、事件分发和治理检查。SDK 会内化其中一半以上职责，继续局部修改会留下过时抽象。

重写后的职责拆分：

- `ConversationRouter`：负责入口路由、governance 检查、slash command 拦截、事件分发、outbox/reply target 通知。
- `SessionManager`：负责 conversationId 到 `ClaudeSDKSession` 的创建、恢复、空闲回收、中断和关闭。
- `ClaudeSDKSession`：负责 SDK streaming input、`canUseTool`、AbortController、SDK message bridge、session id 捕获。

旧职责映射：

| 旧职责 | Phase 2 处理 |
| --- | --- |
| adapter 选择 | 删除，只剩 Claude SDK |
| 消息队列 | SDK streaming input 与 `SessionManager` 串行化 |
| 权限暂存 | SDK `canUseTool` callback |
| 手动 JSON lines 解析 | 删除，SDK 直接产出 typed messages |
| 压缩管理 | 使用 SDK compact/status/compactBoundary 事件 |
| side session timeout | `maxTurns` + `AbortController` |
| governance | 保留到 `ConversationRouter` |
| slash command | 保留到 `ConversationRouter` |
| eventBus/outbox/replyTargets | 保留到 `ConversationRouter` |

#### SDK 事件桥接

主进程依赖 SDK，渲染进程不直接 import SDK 包。SDK message 经薄桥接转换为 Synapse 自己的可序列化事件，再通过 IPC 给前端。

桥接层职责：

- 给每个事件加 envelope：`conversationId`、`turnId`、`providerId`、`timestamp`、`sdkSessionId`。
- 把 SDK 对象转成 structured-clone-safe plain object。
- 保留 SDK 原始语义和主要字段，不降级成旧的 7 类事件。
- 高频 partial message 可按帧合并，避免 IPC 洪泛。
- SDK 新增消息类型时优先落到 `sdkRaw` 或 `unknown` 分支，避免前端崩溃。

事件分层：

| 层 | SDK 来源 | Synapse 事件 |
| --- | --- | --- |
| Stream | partial assistant / content block delta | `stream`，含 text/thinking/tool use 增量 |
| Lifecycle | assistant / result / system init | `assistant`、`result`、`sessionInit` |
| System | status / compact boundary | `status`、`compactBoundary` |
| Meta | rate limit、task、hook、auth、files persisted、local command output、prompt suggestion、permission denied | 各自独立事件 |

前端消费 Synapse 类型，不消费 SDK 类型。这样可以完整展示 SDK 能力，同时把 SDK 升级风险限制在主进程桥接层。

#### 权限与用户输入

采用 SDK 默认权限机制：

- `canUseTool` 负责 tool approval 与 `AskUserQuestion`。
- 当 SDK 需要用户确认时，callback 挂起，主进程发送权限请求事件到前端。
- 前端显示确认 UI 后，把 allow/deny 或问题答案返回给当前 pending callback。
- SDK query 被取消时，pending callback 随 signal 结束。
- 后续如需要长期挂起，可以补充 SDK defer hook，但 Phase 2 先实现常驻桌面会话内的等待。

这意味着对话中仍会弹出权限确认；只是实现通道从旧的自定义 pending permission 队列换成 SDK 的 `canUseTool` callback。

### Provider 模块重写

**删除：** `electron/services/provider-config/` 整个目录

**新建：** `electron/services/provider/`

```
electron/services/provider/
├── provider-service.ts       — Provider CRUD + 活跃选择 + buildEnv(providerId)
├── provider-secret-store.ts  — safeStorage 加密存取 API Key
├── provider-presets.ts       — 内置预设列表（参考 CC Switch）
└── types.ts                  — 类型定义
```

#### 数据模型

```typescript
interface CCProvider {
  id: string
  name: string
  category: ProviderCategory
  baseUrl?: string              // ANTHROPIC_BASE_URL
  apiKeyField: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY"
  active?: boolean
  model?: string                // ANTHROPIC_MODEL
  haikuModel?: string           // ANTHROPIC_DEFAULT_HAIKU_MODEL
  sonnetModel?: string          // ANTHROPIC_DEFAULT_SONNET_MODEL
  opusModel?: string            // ANTHROPIC_DEFAULT_OPUS_MODEL
  env: Record<string, string>   // 其他环境变量（如 CLAUDE_CODE_USE_BEDROCK）
  icon?: string
  iconColor?: string
  notes?: string
  sortIndex?: number
  createdAt: number
}

type ProviderCategory =
  | "official"        // Anthropic 直连
  | "cn_official"     // 国产官方（DeepSeek、智谱、Kimi…）
  | "cloud_provider"  // AWS Bedrock、GCP Vertex
  | "aggregator"      // OpenRouter、SiliconFlow…
  | "third_party"     // 第三方中转
  | "custom"          // 用户自定义
```

#### 预设列表

从 CC Switch 的 `claudeProviderPresets.ts` 转换。Synapse 不写 `~/.claude/settings.json`，只保留运行时 env 映射和表单元数据。

初始版本包含：

- Claude Official
- AWS Bedrock (AKSK)
- AWS Bedrock (API Key)
- 盛算云 (Shengsuanyun)
- DeepSeek
- 智谱 GLM
- Kimi
- 百炼 (Bailian)
- OpenRouter
- SiliconFlow
- AiHubMix
- 自定义（用户填 URL + Key）

后续可按需扩充。

#### 存储策略

采用 SQLite 单一存储：

- Provider 明文元数据存普通列或 JSON 列。
- API Key 由 `safeStorage.encryptString()` 加密后存 SQLite blob。
- active provider 记录在 provider 表中，保证同一时间只有一个 active。
- 删除 provider 前检查是否被 conversation 引用；已被引用的 provider 不物理删除，改为 archived，保证历史对话可恢复 env 元数据。

CC Switch 的做法是把 provider 与 key 明文写入本地 JSON，并切换时写入 Claude Code settings。Synapse 是运行时宿主，不做全局写文件切换，因此不沿用该存储方式。

#### Secret 存储

```typescript
// provider-secret-store.ts
import { safeStorage } from "electron"

class ProviderSecretStore {
  // 加密存储：safeStorage.encryptString(apiKey) → Buffer → 写入 SQLite blob
  // 解密读取：safeStorage.decryptString(buffer) → string
  async setApiKey(providerId: string, apiKey: string): Promise<void>
  async getApiKey(providerId: string): Promise<string | undefined>
  async deleteApiKey(providerId: string): Promise<void>
}
```

如果 `safeStorage.isEncryptionAvailable()` 为 false，ProviderSecretStore 返回明确错误，UI 提示用户当前系统环境不支持安全保存密钥；Phase 2 不落回明文。

#### 对话级 Provider 绑定

- 对话创建时记录 `providerId`（存入 conversation entry）
- 发送消息时：`ProviderService.buildEnv(providerId)` → 构建完整 env
- SDK `query()` 调用时注入 env：

```typescript
query({
  prompt,
  options: {
    cwd,
    sessionId,
    env: providerService.buildEnv(conversation.providerId),
  },
})
```

- 已有对话不可切换 provider（避免 session 混乱）
- 新对话默认使用"活跃 provider"（用户可在创建时选择其他）

#### Conversation 数据模型

Phase 2 使用新的 SQLite 表记录 SDK 对话，和旧 data-repo conversation entry 隔离。旧数据不迁移，旧字段保留用于兼容读取。

```text
agent_conversations
├── id              TEXT PRIMARY KEY
├── project_id      TEXT NOT NULL
├── title           TEXT NOT NULL
├── provider_id     TEXT NOT NULL
├── sdk_session_id  TEXT
├── status          TEXT NOT NULL      -- active | archived
├── message_count   INTEGER NOT NULL
├── total_tokens    INTEGER NOT NULL
├── total_cost_usd  REAL NOT NULL
├── created_at      TEXT NOT NULL
└── updated_at      TEXT NOT NULL

agent_conversation_messages
├── id              TEXT PRIMARY KEY
├── conversation_id TEXT NOT NULL
├── role            TEXT NOT NULL      -- user | assistant | system | tool
├── content         TEXT NOT NULL
├── content_blocks  TEXT               -- JSON, SDK bridge blocks
├── thinking        TEXT
├── tool_uses       TEXT               -- JSON array
├── usage           TEXT               -- JSON object
├── cost_usd        REAL
└── created_at      TEXT NOT NULL

agent_conversation_events
├── id              TEXT PRIMARY KEY
├── conversation_id TEXT NOT NULL
├── turn_id         TEXT NOT NULL
├── event_type      TEXT NOT NULL
├── payload         TEXT NOT NULL      -- JSON, bridge event payload
└── created_at      TEXT NOT NULL
```

设计要点：

- `provider_id` 创建后不可改。
- `sdk_session_id` 捕获 SDK 初始化结果，用于恢复。
- message 表存可展示的归并结果，event 表存细粒度 SDK bridge 事件，方便后续重放、调试和增强 UI。
- 成本与 token 由 SDK result 消息累加。
- 后续扩展多供应商运营字段时优先扩 provider 表，不污染 conversation 表。

### 前端 Provider UI

UI 遵守当前 shadcn/Radix baseline，不新增自定义颜色或视觉体系。

**新增/重做的组件：**

- Settings 内新增 Provider 管理页面：列表、新增、编辑、归档/删除、设为活跃。
- 对话创建时增加 Provider 选择器：默认选活跃 provider，可在创建前切换。
- 对话界面显示当前 provider 状态：名称、可用/缺 key/不可用状态。
- API Key 输入只在编辑表单中出现；列表只显示是否已配置。
- 已绑定历史对话不显示切换入口。

**删除的组件：**
- `agent-picker-popover.tsx`（Phase 1 已删）
- 旧的 provider 配置 UI（如果有）

前端不展示 SDK/架构说明，只展示用户操作需要的信息。

### 实施顺序

1. 安装 SDK，建立 `ClaudeSDKSession`、bridge 类型和基础测试。
2. 重写 agent runtime：删除 adapters 和 `message-router.ts`，拆出 `SessionManager` 与 `ConversationRouter`。
3. 新建 provider service、secret store、presets 和 SQLite 存储。
4. 加入 conversation provider 绑定和 SDK env 注入。
5. 重做 IPC 与前端 Provider UI。
6. 删除旧 provider-config 调用点，补齐类型检查、单元测试和 hard constraints 检查。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| SDK binary 体积大 (+100-150MB) | 可考虑首次使用时下载，或接受体积增长 |
| SDK 版本与 CC CLI 不同步 | 锁定 SDK 版本，定期升级 |
| SDK 消息类型持续扩展 | bridge 层保留 unknown/sdkRaw 分支，前端不会因未知类型崩溃 |
| streaming input 常驻资源 | `SessionManager` 做 idle 回收，恢复时使用 sdk session id |
| 权限 callback 长时间等待 | 使用 AbortController 取消；后续需要跨进程长期挂起时再补 defer hook |
| safeStorage 在 Linux 上需要 libsecret | Phase 2 不明文 fallback；UI 明确提示安全存储不可用 |
| 已有对话数据的 agentType 字段 | 保留旧字段，SDK 新表和旧 data-repo entry 隔离 |
| Provider 预设需要持续维护 | 预设转换源参考 CC Switch，Synapse 保留自定义 provider |
| MessageRouter 重写范围大 | 先用单元测试锁住 governance、slash command、eventBus、cancel、provider env 等行为 |

## 不在范围内

- 编辑器安装逻辑（Skills/Rules 安装到各编辑器不受影响）
- 内容管理模块（Rules / Skills / Prompts CRUD）
- 仓库 Git 操作
- 网站 (website/)
- 服务端 (server/)
