# Agent 会话架构重构设计

## 概述

重构 Agent 面板的会话机制，从"隐式推导"变为"显式选择"，实现 per-conversation 独立运行时状态，支持同一项目下多种 Agent 并行执行。

## 目标

1. 创建会话时显式选择项目和 Agent 类型
2. 每个会话拥有独立的运行时状态（进程、队列、忙碌标志）
3. 同一项目下多个会话可并行执行，互不阻塞
4. 为未来新增 Agent 类型提供清晰的扩展路径

## 非目标

- 不支持选择任意目录（只能选已配置的项目）
- 不暴露空闲超时设置到 UI（硬编码 10 分钟）
- 不做 per-conversation model/mode 的 UI（数据结构预留，UI 后续再做）

---

## 设计详情

### 1. 创建会话 UI 流程

用户点击 "+" 按钮后弹出 Dialog（模态框），内含两个下拉菜单：

**第一个下拉：选择项目**
- 数据源：`config.global.projects` + `config.repositories`
- 如果只有一个项目，自动选中但仍然展示
- 如果当前 Agent 面板已有 `selectedProjectId`，默认选中它

**第二个下拉：选择 Agent**
- 初始状态：禁用（disabled），直到第一个下拉有选中值
- 数据源：`agentDefinitions`（从 renderer-registry），过滤掉本机未安装的
- 默认值：该项目的 `ProviderConfigService.getActiveAgentType(projectId)` 结果
- 如果项目没有设置默认 agent，不预选

**确认按钮**：两个都选好后可点击，调用 `createSession({ projectId, agentType })`。

### 2. Runtime 架构：Per-Conversation State

#### State 管理

```typescript
// 改前
private readonly states = Map<string, RuntimeSessionState>
// key = "${projectId}:${workspaceKey}:active:${sessionKey}"

// 改后
private readonly states = Map<string, RuntimeSessionState>
// key = conversationId
```

每个 RuntimeSessionState 包含：
- `liveSession: AgentLiveSession` — 该会话独占的 CLI 进程
- `queue: QueuedTurn[]` — 该会话独立的消息队列
- `busy: boolean` — 该会话是否正在执行
- `pending: PendingPermissionState` — 该会话的权限请求
- `lastActivity: number` — 最后活动时间（用于空闲回收）

#### 并行执行

同一项目下的多个会话各自独立执行，不共享队列，不互相阻塞。用户自行管理并行写入风险。

#### 空闲回收

LiveSession 空闲超过 10 分钟自动 close。下次发消息时通过 `--resume` 重新启动，AI 上下文不丢失（Claude Code 会话历史持久化在磁盘）。

唯一代价：冷启动延迟 1-3 秒。

### 3. Adapter 选择逻辑

#### 改前

adapter 由 project container 初始化时确定，所有会话共享同一个 adapter（或通过 adapterFactory 动态切换）。

#### 改后

每次 processQueue 时根据 conversation.agentType 解析 adapter：

```
消息进入 → 找到 conversation（已有 agentType）
         → resolveAdapter(conversation.agentType)
         → 用 conversationId 获取对应 state
         → state.liveSession 存活且 agentType 匹配? 复用 : 创建新进程
```

resolveAdapter 内部：
1. 从 `agentRuntimeDefinitionsByStringId` 获取 definition
2. 调用 `definition.createAdapter(runtimeView, runner)`
3. 可缓存 adapter 实例（同一 agentType 不需要每次重建）

### 4. 数据模型变化

#### ConversationEntryV1

```typescript
{
  // 现有字段不变
  agentType: string              // 改为创建时写入（之前是事后记录）
  agentConfig?: {                // 新增：会话级配置预留（本次不暴露 UI）
    model?: string
    mode?: string
    env?: Record<string, string>
  }
}
```

#### CreateAgentSessionInput

```typescript
export interface CreateAgentSessionInput {
  // 现有字段...
  readonly agentType?: string    // 新增
}
```

#### IPC createSession 请求

```typescript
{
  projectId: z.string(),
  sessionKey: z.string().optional(),
  name: z.string().optional(),
  agentType: z.string().optional(),  // 新增
}
```

### 5. Agent Availability Service

新增服务，负责检测本机哪些 agent 可用：

```typescript
interface AgentAvailability {
  agentType: string
  available: boolean
  binaryPath?: string
  version?: string
}
```

- 启动时检测一次（通过 `whichBin()` 检查 runtime.binaries），缓存结果
- 前端创建会话时只展示 available: true 的 agent
- 未来扩展：支持远程 agent（不需要本地 binary）

### 6. Session 列表 UI 变化

会话列表中每个 session 展示绑定的 agent 类型：
- agent icon（小图标，在会话名称旁边）
- 运行中的会话显示对应 agent 的状态标签

### 7. 向后兼容

**旧会话数据迁移：**
- 旧会话 `agentType` 为空时，fallback 到 `ProviderConfigService.getActiveAgentType(projectId)`
- 不做数据迁移脚本，lazy 填充：下次使用时写入
- 新创建的会话必须有 agentType

**RuntimeSessionState：**
- 内存态，服务重启时 states map 为空，不需要迁移
- LiveSession 通过 `--resume` 恢复

---

## 扩展路径

未来新增 Agent 类型的步骤：
1. `src/definitions/agent/<name>/` — 加定义文件（id, label, icon, modes, capabilities, runtime）
2. `electron/services/agent-runtime/adapters/<name>.ts` — 加 adapter 实现
3. 注册到 `main-registry.ts`
4. 完成（UI 自动从 agentDefinitions 读取，无需额外改动）

未来 per-conversation 配置：
- 数据结构已预留 `agentConfig` 字段
- 后续加 UI 即可让用户在会话级别覆盖 model/mode

---

## 关键文件

| 文件 | 改动类型 |
|------|----------|
| `desktop/src/modules/agent/` | 新增创建会话 Dialog 组件 |
| `desktop/src/modules/agent/hooks/use-agent-chat.ts` | createSession 传入 agentType |
| `desktop/electron/modules/agent/ipc.ts` | createSession handler 接受 agentType |
| `desktop/electron/services/agent-runtime/session-repository.ts` | createSession 写入 agentType |
| `desktop/electron/services/agent-runtime/agent-runtime-service.ts` | state key 改为 conversationId，adapter 按 conversation 选择，空闲回收逻辑 |
| `desktop/electron/services/agent-runtime/index.ts` | createAgentRuntimeProjectService 调整 |
| `desktop/src/definitions/generated/renderer-registry.ts` | 无改动（已有 agentDefinitions 导出） |
| `desktop/electron/services/provider-config/provider-config-service.ts` | 无改动（已有 getActiveAgentType） |
