# 供应商 + 模型信息增强显示

日期: 2026-05-15

## 目标

在两个场景中增强供应商和模型信息的可见性：

1. 定时任务列表卡片 — 为 Agent 类型任务显示供应商和模型
2. 工作流节点 — 在编辑器和运行器中显示人类可读的供应商名称和模型名称

## Change 1: 定时任务卡片

### 现状

`task-card.tsx` 底部 metadata 区域显示两行：`上次` 和 `范围`。

### 数据来源

Agent 任务 (`builtin.agent`) 的 `task.action.config` 已存储 `providerName`、`modelName`、`providerId`、`modelTier`。无需额外数据查询。

### 设计

- 在 `上次`/`范围` 行上方，为 `builtin.agent` 类型任务有条件地插入 `供应商` + `模型` 两行
- 格式与现有行一致，label 列宽度从 `2.5rem` 调整为 `3rem`（适配三字标签"供应商"）
- 显示优先级：`providerName` → `providerId` fallback；`modelName` → `modelTier` fallback
- 非 Agent 任务不显示这两行，保持现有布局

### 涉及文件

| 文件 | 变更 |
|------|------|
| `desktop/src/modules/task-scheduler/components/task-card.tsx` | 增加条件渲染 `供应商`/`模型` 行 |

## Change 2: 工作流节点

### 现状

- `PromptNodeCard` 和 `SwitchNodeCard` 显示 `{config.providerId} · {config.modelTier}`，是原始 ID
- `PromptNodeConfig` / `SwitchNodeConfig` schema 只存 `providerId` + `modelTier`
- Panel 选择器 (`prompt/panel.tsx`, `switch/panel.tsx`) 丢弃了 `ProviderModelSelectDialog` 返回的 `providerName`/`modelName`

### 决策

- **不扩展 schema**，保持 `PromptNodeConfig`/`SwitchNodeConfig` 不变
- 运行时通过 `providerId` 查询 Provider 列表获取显示名

### 设计: Context + 共享 Hook

#### 新建 provider-lookup-context

文件: `desktop/workflow-nodes/provider-lookup-context.tsx`

```tsx
type ProviderLookup = {
  getProviderName: (providerId: string) => string | undefined
  getModelName: (providerId: string, modelTier: ModelTier) => string | undefined
}
```

- `useProviderLookup()` hook — 调用 `window.synapse.agent.listProviders()` 加载一次，缓存结果
- `ProviderLookupContext` — React context 供 card 组件消费
- `ProviderLookupProvider` — context provider 组件，在 mount 时加载 provider 列表

#### 修改 PromptNodeCard

将当前的单行 `{config.providerId} · {config.modelTier}` / `"未选择供应商"` 改为两行：

```
供应商  {resolvedProviderName || providerId || "未选择"}
模型    {resolvedModelName || modelTier || "未选择"}
```

未选择时（`!config.providerId`）仍显示单行 `"未选择供应商"`。

编辑态和运行态使用同一个 card 组件，行为一致。运行态 `status === "running"` 时的 progressLabel 显示不受影响。

#### 修改 SwitchNodeCard

同 PromptNodeCard 逻辑。注意 `SWITCH_HEADER_H` 常量需要相应增大以容纳多出的一行文字（约 +16px）。

#### Editor / Runner 顶层 wrap

- `desktop/src/modules/workflow/editor/editor-app.tsx` — 在 ReactFlow 外层 wrap `ProviderLookupProvider`
- `desktop/src/modules/workflow/runner/runner-app.tsx` — 同上

#### Panel 选择器按钮文案

`prompt/panel.tsx` 和 `switch/panel.tsx` 中的选择按钮当前显示 `{config.providerId} · {TIER_LABELS[config.modelTier]}`。改为使用 context 解析后的名称：`{providerName} · {modelName}`。

### 涉及文件

| 文件 | 变更类型 |
|------|----------|
| `desktop/workflow-nodes/provider-lookup-context.tsx` | 新建 |
| `desktop/workflow-nodes/prompt/card.tsx` | 修改显示为两行 |
| `desktop/workflow-nodes/switch/card.tsx` | 修改显示为两行 |
| `desktop/workflow-nodes/switch/constants.ts` | 调整 `SWITCH_HEADER_H` |
| `desktop/workflow-nodes/prompt/panel.tsx` | 按钮文案使用解析名称 |
| `desktop/workflow-nodes/switch/panel.tsx` | 按钮文案使用解析名称 |
| `desktop/src/modules/workflow/editor/editor-app.tsx` | wrap ProviderLookupProvider |
| `desktop/src/modules/workflow/runner/runner-app.tsx` | wrap ProviderLookupProvider |

## 不在范围内

- 不修改 `PromptNodeConfig` / `SwitchNodeConfig` schema
- 不修改 `promptNodeManifest.cardSummary` / `switchNodeManifest.cardSummary`（这些用于非 UI 场景的文本摘要，保持原样）
- 不为非 Agent 类型定时任务添加供应商/模型显示
- 不添加 provider 列表的实时刷新或 WebSocket 订阅

## 权衡

| 维度 | 说明 |
|------|------|
| 数据准确性 | 运行时查询始终反映最新的 provider 名称 |
| 性能 | 每个 window 启动时查一次 provider 列表，后续从内存读取 |
| Schema 兼容性 | 不改工作流节点 schema，现有工作流定义零迁移 |
| Task card | 直接读 action.config 已有字段，零额外开销 |
