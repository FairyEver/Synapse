# Provider 引用保护设计

## 概述

当用户修改或删除已被定时任务、Agent 对话、Workflow 节点引用的 Provider 时，系统需要保护这些引用不会无声地失效。

本设计引入：
1. Provider 物理删除能力
2. 删除前引用扫描 + 迁移向导（Delete Guard）
3. 执行时优雅降级（Graceful Fallback）
4. Tier 映射缺失时的 UI 警告

## 背景

三个消费者通过 `providerId` (string) + `modelTier` (enum) 引用 Provider：

| 消费者 | 存储 | 自动执行 | 迁移支持 |
|---|---|---|---|
| 定时任务 | `ScheduledTaskEntryV2.action.config` (DataNamespace) | ✅ | ✅ |
| Workflow 节点 | `PromptNodeConfig` / `SwitchNodeConfig` (JSON 文件) | ✅ | ✅ |
| Agent 对话 | `ConversationEntryV1.providerId` (DataNamespace) | ❌ | ❌（仅展示警告） |

现有 tier 抽象层（`modelTier` → 运行时通过 `resolveTierFromEnv` 解析为具体模型）已天然抵御模型映射变更：修改 provider 的 `sonnetModel` 后，已保存引用自动跟随新映射。

主要风险场景：Provider 被物理删除或归档后，`ProviderService.getProvider(id)` 抛 `"Provider not found"`，导致执行路径崩溃。

## 设计决策

- **物理删除**：本次引入。清除 provider 数据 + 关联 secret。
- **迁移范围**：定时任务 + Workflow 节点。Agent 对话为历史记录，不自动迁移。
- **交互方式**：删除/归档前展示影响面，提供"迁移到其他供应商"一键操作。
- **Tier 降级**：展示 UI 警告（不阻止执行，运行时 fallback 到主模型）。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Renderer                              │
├─────────────────────────────────────────────────────────────┤
│  provider-panel.tsx                                          │
│    └── ProviderDeleteDialog (新)                             │
│         ├── scanReferences → 展示影响面                       │
│         ├── ProviderModelSelectDialog → 选择迁移目标          │
│         └── migrateReferences + deleteProvider               │
│                                                              │
│  TaskCard / PromptNodePanel / AgentHeader                    │
│    └── validateProviderReference() → 展示警告                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC
┌──────────────────────────┴──────────────────────────────────┐
│                     Main Process                             │
├─────────────────────────────────────────────────────────────┤
│  ProviderService                                             │
│    ├── deleteProvider(id)      ← 新增                        │
│    ├── listAllProviders()      ← 新增                        │
│    └── buildEnvSafe(id, ctx)   ← 新增                        │
│                                                              │
│  ProviderReferenceScanner      ← 新增                        │
│    ├── scan(providerId)                                      │
│    └── migrate(input)                                        │
│                                                              │
│  AgentAction executor          ← 增加 buildEnvSafe 兜底      │
│  Workflow prompt node executor  ← 增加 buildEnvSafe 兜底     │
└─────────────────────────────────────────────────────────────┘
```

## 模块设计

### 1. ProviderReferenceScanner

新文件：`electron/services/provider/provider-reference-scanner.ts`

```typescript
interface ProviderReference {
  kind: "scheduled-task" | "workflow-node" | "conversation"
  entityId: string
  entityName: string
  nodeId?: string
  nodeName?: string
  providerId: string
  modelTier: string
}

interface ProviderReferenceScanResult {
  providerId: string
  references: ProviderReference[]
  taskCount: number
  workflowNodeCount: number
  conversationCount: number
}

interface MigrateProviderReferencesInput {
  sourceProviderId: string
  targetProviderId: string
  targetModelTier: ModelTier
  scope: ("scheduled-task" | "workflow-node")[]
}

interface MigrateProviderReferencesResult {
  migratedTasks: number
  migratedWorkflowNodes: number
  errors: Array<{ entityId: string; error: string }>
}
```

依赖注入，通过构造函数接收 adapter 接口：

```typescript
interface ProviderReferenceScannerDeps {
  listTasks: () => Promise<Array<{ id: string; name: string; action: TaskActionRef }>>
  updateTaskAction: (id: string, action: TaskActionRef) => Promise<void>
  listWorkflowNodes: () => Promise<Array<{
    workflowId: string; workflowName: string
    nodeId: string; nodeName: string
    providerId: string; modelTier: string
  }>>
  updateWorkflowNodeProvider: (
    workflowId: string, nodeId: string,
    providerId: string, modelTier: string
  ) => Promise<void>
  listConversations: () => Promise<Array<{ id: string; name: string; providerId?: string }>>
}
```

### 2. ProviderService 新增方法

#### `deleteProvider(id: string): Promise<void>`

1. 禁止删除 `local-claude-code`
2. 若该 provider 为 active，先切换 active 到 `local-claude-code`
3. 删除 secret（`provider:{id}:api-key` + secretEnvRefs）
4. 从 DataNamespace 物理删除 provider 记录

#### `listAllProviders(): Promise<readonly CCProvider[]>`

与 `listProviders()` 相同，但不过滤 archived。用于 renderer 引用验证。

#### `buildEnvSafe(providerId, context?): Promise<BuildEnvSafeResult>`

```typescript
type BuildEnvSafeResult =
  | { ok: true; env: Record<string, string> }
  | { ok: false; reason: "not_found" | "archived" | "secret_error"; message: string }
```

不改现有 `buildEnv`（保持向后兼容），新方法供需要优雅降级的路径使用。

### 3. IPC Channels

| Channel | 方向 | 用途 |
|---|---|---|
| `provider:scan-references` | renderer → main | 扫描引用 |
| `provider:delete` | renderer → main | 物理删除 |
| `provider:migrate-references` | renderer → main | 批量迁移引用 |
| `provider:list-all` | renderer → main | 列出含 archived 的全部 provider |

### 4. 执行时兜底

#### 定时任务执行器

`action-packages/builtin/agent/executor.main.ts` 中，`sendScheduled` 前通过 `buildEnvSafe` 检查 provider 可用性。不可用时返回：

```typescript
{ status: "failed", error: "供应商已删除或不可用，请重新配置", metrics: { durationMs: 0 } }
```

#### Workflow 节点执行

Workflow prompt/switch 节点执行时，如果 `buildEnvSafe` 返回 `ok: false`，节点输出 error 状态并携带人可读的失败原因。

#### Agent 对话

现有 `conversationRouter` 的 try-catch 已经会向 timeline 展示错误消息。确保 `getProvider` 抛出的 `"Provider not found"` 文案改为人可读的 `"供应商不可用"`。

### 5. Tier 降级警告

新文件：`src/lib/provider-reference-validation.ts`

```typescript
type ProviderReferenceStatus =
  | { valid: true }
  | { valid: false; reason: "provider_not_found" }
  | { valid: false; reason: "provider_archived" }
  | { degraded: true; reason: "tier_unavailable"; fallbackModel?: string }

function validateProviderReference(
  providerId: string,
  modelTier: ModelTier,
  providers: readonly SynapseAgentProvider[],
  allProviders: readonly SynapseAgentProvider[],
): ProviderReferenceStatus
```

纯函数，renderer 侧本地判断。

展示位置：
- **TaskCard**：provider 名称旁显示 ⚠️ 图标 + tooltip
- **Workflow PromptNodePanel / SwitchNodePanel**：provider 按钮文案变为 destructive 色 + tooltip
- **Agent 对话头部**：仅当 `provider_not_found` / `provider_archived` 时显示提示

数据来源复用现有 `listProviders` IPC + 新增 `provider:list-all`。

### 6. Delete Dialog UI

新文件：`src/modules/settings/components/provider-delete-dialog.tsx`

Props：
```typescript
{
  provider: SynapseAgentProvider | null  // null = closed
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}
```

对话框结构：
```
┌─────────────────────────────────────────┐
│ 删除供应商 "{name}"                      │
├─────────────────────────────────────────┤
│ 该供应商被以下内容引用：                  │
│                                         │
│ 定时任务 (N)                             │
│   • 任务名称1                            │
│   • 任务名称2                            │
│                                         │
│ 工作流节点 (M)                           │
│   • "工作流名" → 节点名                  │
│                                         │
│ Agent 会话 (K)                           │
│   （不迁移，仅标记失效）                  │
│                                         │
├─────────────────────────────────────────┤
│ [迁移到其他供应商]  [仍然删除]  [取消]    │
└─────────────────────────────────────────┘
```

"迁移到其他供应商" → 打开 `ProviderModelSelectDialog`（过滤掉当前 provider）→ 确认后调 `provider:migrate-references` → 成功后调 `provider:delete`。

### 7. Provider Panel 入口变更

`ProviderRowActions` 中：
- 保留"归档"：也走 reference scan + 警告流程（因为归档后 provider 在选择列表中不可见，用户无法在 UI 中重新选回）
- 新增"删除"：走完整 Delete Guard + 迁移向导

## 文件清单

### 新增

| 文件 | 用途 |
|---|---|
| `electron/services/provider/provider-reference-scanner.ts` | 引用扫描 + 迁移逻辑 |
| `src/modules/settings/components/provider-delete-dialog.tsx` | 删除确认 + 迁移向导 UI |
| `src/lib/provider-reference-validation.ts` | Renderer 侧引用验证纯函数 |

### 修改

| 文件 | 变更 |
|---|---|
| `electron/services/provider/provider-service.ts` | 新增 `deleteProvider`, `listAllProviders`, `buildEnvSafe` |
| `electron/services/provider/index.ts` | 导出新方法 |
| IPC 注册 (channels + preload + bridge types) | 4 个新 channel |
| `action-packages/builtin/agent/executor.main.ts` | provider 可用性前置检查 |
| `src/modules/settings/components/provider-panel.tsx` | 增加删除入口，调用 ProviderDeleteDialog |
| `src/modules/task-scheduler/task-card.tsx` | tier 降级警告展示 |
| `workflow-nodes/prompt/panel.tsx` | tier 降级警告展示 |
| `workflow-nodes/switch/panel.tsx` | tier 降级警告展示 |
| `src/modules/agent/index.tsx` (header area) | provider 不可用警告 |

## 不做的事

- 不改现有 `buildEnv` 签名（向后兼容）
- 不改 `ProviderModelSelection` / `PromptNodeConfig` / `AgentActionConfig` 的 schema
- 不迁移 Agent 对话的 provider 引用
- 不阻止 tier 降级执行（仅 UI 警告）
- 不引入跨模块事件订阅（静态扫描代替实时推送）
