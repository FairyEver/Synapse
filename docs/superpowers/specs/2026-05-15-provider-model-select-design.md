# Provider + Model 选择公共组件设计

## 概述

将定时任务 Agent 动作和 Agent 对话新建中的"供应商 + 模型选择"统一为一个公共组件 `ProviderModelSelectDialog`。用户在一个 Dialog 中完成供应商选择和模型档位选择。

## 动机

- 定时任务 Agent 动作需要指定使用哪个供应商的哪个模型
- Agent 对话新建同样需要选供应商 + 模型
- 两个场景的选择逻辑完全一致，应复用同一组件

## 公共组件设计

### 接口

```typescript
type ModelTier = "default" | "haiku" | "sonnet" | "opus"

type ProviderModelSelection = {
  providerId: string
  modelTier: ModelTier
}

type ProviderModelSelectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (selection: ProviderModelSelection) => void
  defaultSelection?: ProviderModelSelection
}
```

### 组件职责

- 纯选择器：只负责让用户选一个 provider + model tier，返回结果
- 不包含任何业务逻辑（不创建对话、不写入配置）
- 调用方拿到 `ProviderModelSelection` 后自行处理

### 文件位置

`desktop/src/components/provider-model-select-dialog.tsx`

放在 `src/components/` 而非某个 module 下，因为它是跨模块公共组件。

### 数据加载

打开时调用 `requireSynapseBridge().agent.listProviders()` 获取已配置供应商列表，过滤 `archived` 条目。

## UI 布局

Dialog 内部为一个表格，三列：

| 列 | 宽度 | 内容 |
|----|------|------|
| Radio | 32px | 单选圆点 |
| 名称 | ~120px | 供应商名称 |
| 模型 | 剩余空间 | 模型档位列表（竖排） |

### 模型列表样式

- 竖排排列，无边框，无 gap
- 间距靠每项自身 padding（上下 4px）撑开
- 未选中行：模型文本半透明
- 选中行：模型文本正常对比度，被选中的档位用背景色高亮
- hover 时加轻微背景色提示可点击
- 格式：`档位 (实际模型名)`，如 `Sonnet (deepseek-v4-pro)`
- 供应商未配置某档位（字段为空）→ 该项不渲染

### 交互逻辑

1. 点击行 → 选中该供应商（Radio 高亮）
2. 点击模型项 → 自动选中所在行供应商 + 高亮该模型
3. 默认预选：active 供应商 + Sonnet 档位
4. 有 `defaultSelection` 时回显已选状态
5. 确认按钮：供应商和模型都选中后才可点击
6. 只有一个供应商时仍显示 Dialog（因为还需选模型）

## 使用场景改造

### 场景一：定时任务 Agent 配置

**数据模型变更：**

```typescript
// desktop/action-packages/builtin/agent/schema.ts
type AgentActionConfig = {
  projectId: string
  agentType: "claude-code"
  providerId: string                                    // 新增
  modelTier: "default" | "haiku" | "sonnet" | "opus"   // 新增
  mode: SynapseAgentPermissionMode
  prompt: string
  sessionPolicy: "fresh" | "resume"
  timeoutMins?: number | null
}
```

**表单改造：**

在 `config.renderer.tsx` 中，将现有的"智能体"disabled 按钮替换为一个触发 `ProviderModelSelectDialog` 的按钮，显示已选的供应商和模型信息。

### 场景二：Agent 对话新建

现有 `ProviderSelectDialog` 替换为 `ProviderModelSelectDialog`：

- `onSelect` 回调中拿到 `providerId` + `modelTier`
- 传入创建对话的逻辑（原有的 `onCreate` 参数扩展为包含 model 信息）
- 保留原有的 auto-create 逻辑作为调用方行为（只有一个供应商时仍需选模型，所以不再自动跳过）

## 运行时模型解析

Synapse Agent 使用 `settingSources: []` 完全隔离（见《SDK 配置隔离决策记录》），所有配置由程序化传入。`modelTier` 在运行时需要解析为实际模型名：

```typescript
// 解析逻辑（主进程 action runner / session-manager 共用）
function resolveModelFromTier(provider: CCProvider, tier: ModelTier): string {
  switch (tier) {
    case "default": return provider.model ?? ""
    case "haiku":   return provider.haikuModel ?? ""
    case "sonnet":  return provider.sonnetModel ?? ""
    case "opus":    return provider.opusModel ?? ""
  }
}
```

解析后的模型名写入 `env.ANTHROPIC_MODEL`，由 SDK 的 `queryOptions.model` 消费。

**为什么存 `modelTier` 而非实际模型名：** 供应商可能更新模型名（如 `deepseek-v4-pro` → `deepseek-v5`），存档位可以在执行时动态解析到最新值，无需逐个更新已保存的定时任务配置。

### 定时任务执行流程

1. Scheduler 触发 Agent action
2. 从 config 中取 `providerId` + `modelTier`
3. 加载 provider 配置，调用 `resolveModelFromTier` 得到实际模型名
4. 构建 env（含 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL`）
5. 传入 SDK session，`settingSources: []` 确保不被 settings.json 覆盖

### Agent 对话新建执行流程

1. 用户选择 provider + modelTier
2. `session-manager.ts` 中 `buildEnv()` 根据 `modelTier` 从 provider 取对应字段
3. 设置 `env.ANTHROPIC_MODEL` 为解析后的实际模型名
4. 创建 session 时传入，SDK 使用该模型

## 迁移策略

1. 新建公共组件 `ProviderModelSelectDialog`
2. 改造定时任务 Agent 配置表单使用新组件
3. 改造 Agent 对话新建使用新组件
4. 废弃旧的 `ProviderSelectDialog`（确认无其他引用后删除）

## 边界情况

- 供应商列表为空 → 显示"暂无 Provider"提示
- 加载失败 → 显示错误信息 + 重试按钮
- 所有档位都未配置的供应商 → 该行仍显示，但模型列无可选项（实际不太可能，至少有 model 字段）
- Dialog 宽度：`sm:max-w-2xl`，与现有一致
