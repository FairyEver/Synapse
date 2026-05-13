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

### Agent SDK 集成

**依赖：** `@anthropic-ai/claude-agent-sdk`（TypeScript SDK，自带 CC binary）

**包体积影响：** +100-150MB（CC binary）

**新文件：** `electron/services/agent-runtime/claude-sdk-session.ts`

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk"

interface SDKSessionOptions {
  cwd: string
  sessionId?: string
  env: Record<string, string>
  model?: string
  mode?: string
  effort?: string
  abortSignal?: AbortSignal
}

class ClaudeSDKSession implements AgentLiveSession {
  // 封装 SDK query() 调用
  // 将 SDK streaming 事件转换为 AgentEvent 类型
  // 管理会话生命周期（resume / cancel）
}
```

**AgentRuntimeService 改造：**
- 删除 `adapters/` 目录（含 `claude-code.ts`）
- `AgentRuntimeService` 直接持有 `ClaudeSDKSession`
- `AgentLiveSession` 接口保留（它描述的是会话行为，不是适配器抽象）
- `AgentAdapter` 接口删除
- `ClaudeProcessRunner` 接口删除

### Provider 模块重写

**删除：** `electron/services/provider-config/` 整个目录

**新建：** `electron/services/provider/`

```
electron/services/provider/
├── provider-service.ts       — Provider CRUD + 活跃选择
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

从 CC Switch 的 `claudeProviderPresets.ts` 精选，初始版本包含：
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

### 前端 Provider UI

**新增/重做的组件：**
- Provider 管理页面（Settings 内）：列表 + 新增/编辑/删除
- Provider 选择器（对话创建时）：下拉选择当前 provider
- Provider 状态指示（对话界面）：显示当前对话使用的 provider

**删除的组件：**
- `agent-picker-popover.tsx`（Phase 1 已删）
- 旧的 provider 配置 UI（如果有）

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| SDK binary 体积大 (+100-150MB) | 可考虑首次使用时下载，或接受体积增长 |
| SDK 版本与 CC CLI 不同步 | 锁定 SDK 版本，定期升级 |
| safeStorage 在 Linux 上需要 libsecret | 文档说明，fallback 到加密文件 |
| 已有对话数据的 agentType 字段 | 保留字段，默认 "claude-code"，不做数据迁移 |
| Provider 预设需要持续维护 | 初始只做少量预设 + 自定义，后续按需加 |

## 不在范围内

- 编辑器安装逻辑（Skills/Rules 安装到各编辑器不受影响）
- 内容管理模块（Rules / Skills / Prompts CRUD）
- 仓库 Git 操作
- 网站 (website/)
- 服务端 (server/)
