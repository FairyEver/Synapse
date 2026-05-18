# 工作流节点供应商 + 模型选择

> 日期: 2026-05-15
> 状态: 已确认

## 背景

Agent 对话和定时任务 Agent 动作已改造为通过 `ProviderModelSelectDialog` 选择供应商 + 模型（`providerId` + `modelTier`）。工作流中的 Prompt 节点和 Switch 节点仍使用旧的 `agent` 字段（`"claude-code"` 等硬编码 agentType），需要统一。

## 决策

| 决策点 | 结论 |
|--------|------|
| 改造范围 | Prompt 节点 + Switch 节点同步改造 |
| 交互方式 | 弹窗选择（复用 `ProviderModelSelectDialog`） |
| 数据迁移 | 不兼容，旧节点需手动重新配置 |

## 改造清单

### 1. Schema 变更

**`prompt/schema.ts`**:
- 移除 `agent: z.string().min(1)`
- 新增 `providerId: z.string().min(1)` + `modelTier: z.enum(["default", "haiku", "sonnet", "opus"])`

**`switch/schema.ts`**:
- 同上

### 2. 配置面板 UI

**`prompt/panel.tsx`** 和 **`switch/panel.tsx`**:
- "执行配置" CollapsibleSection 内移除 Agent Select 下拉
- 替换为 Button trigger + `ProviderModelSelectDialog`
- 按钮文案：已选 → `${providerId} · ${tierLabel}`，未选 → "选择供应商 + 模型"
- 移除 `agentDefinitions`、`AgentIcon`、`getAgentLabel` 导入

### 3. 运行时桥接

**`workflow-nodes/types.ts`** — `AgentSendDeps.sendToAgent` 签名:
```typescript
sendToAgent: (input: {
  providerId: string
  modelTier: string
  prompt: string
  abortSignal: AbortSignal
}) => Promise<{
  status: "success" | "failed"
  response: string
  error?: string
  durationMs: number
}>
```

**`electron/bootstrap/descriptors.ts`** — `sendToAgent` 实现:
- 参数从 `{ agent, prompt, abortSignal }` 改为 `{ providerId, modelTier, prompt, abortSignal }`
- `agentRuntime.sendScheduled` 调用透传 `providerId` 和 `modelTier`
- `agentType` 硬编码为 `"claude-code"`

### 4. 执行器

**`prompt/executor.main.ts`**:
- `sendToAgent` 调用传 `{ providerId: config.providerId, modelTier: config.modelTier, prompt, abortSignal }`
- 日志字段更新

**`switch/executor.main.ts`**:
- 同上

### 5. Manifest

**`prompt/manifest.ts`**:
- `cardSummary` 标题: `c.providerId ? \`${c.providerId} · ${c.modelTier}\` : "未选择供应商"`
- `configFields` 更新

**`switch/manifest.ts`**:
- 同上模式

### 6. 测试

- `prompt/__tests__/executor.test.ts` — config 结构和 sendToAgent mock
- `switch/__tests__/executor.test.ts` — 同上
- `electron/services/__tests__/workflow-engine.test.ts` — sendToAgent mock 签名

## 不变的部分

- `ProviderModelSelectDialog` 组件
- `ProviderModelSelection` / `ModelTier` 类型
- Agent 对话和定时任务逻辑
