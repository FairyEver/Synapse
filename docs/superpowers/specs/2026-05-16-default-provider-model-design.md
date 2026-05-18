# 默认供应商和模型

## 概述

在系统设置 > 智能体卡片中，"默认权限模式"下方新增"默认供应商和模型"设置项。设置后，Agent 对话、定时任务（Agent 类型）、工作流节点在新建时自动使用该默认值，用户无需每次手动选择，但仍可随时更改。

## 决策记录

| 项目 | 决策 |
|------|------|
| 作用域 | 全局（所有项目共用一个默认值） |
| 存储格式 | 精简：仅 `{ providerId, modelTier }` |
| 未设置时行为 | 各处与当前行为一致（用户手动选） |
| 默认 provider 不可用时 | 静默忽略，回退当前行为 |
| Agent 对话创建 | 对话框仍弹出，默认值预选，用户点确认即可 |
| UI 组件 | 复用 `ProviderModelSelectDialog` |

## §1 数据层

### Config 类型

文件：`desktop/src/types/config.ts`

```ts
export type SynapseAgentGlobalConfig = {
  defaultPermissionMode: SynapseAgentPermissionMode
  defaultProviderModel: { providerId: string; modelTier: ModelTier } | null
}
```

### 默认值

文件：`desktop/src/constants/defaults.ts`

```ts
export const DEFAULT_AGENT_GLOBAL_CONFIG: SynapseAgentGlobalConfig = {
  defaultPermissionMode: "default",
  defaultProviderModel: null,
}
```

### 归一化

文件：`desktop/src/lib/config.ts` — `normalizeAgentGlobalConfig`

新增 `defaultProviderModel` 字段处理：
- 如果值是对象且 `providerId` 是非空字符串、`modelTier` 是 `MODEL_TIERS` 中的合法值，保留。
- 否则回退 `null`。

### Patch 类型

`SynapseConfigPatch` 已有 `agent?: Partial<SynapseAgentGlobalConfig>`，无需修改。`applySynapseConfigPatch` 的 `{ ...config.agent, ...patch.agent }` 展开逻辑天然支持新字段。

## §2 设置面板

文件：`desktop/src/modules/settings/components/agent-defaults-panel.tsx`

在 `AgentDefaultsContent` 组件中，"默认权限模式" `SettingsFieldRow` 下方新增一行：

```
SettingsFieldRow
  label: "默认供应商和模型"
  controlClassName: "w-full md:w-[220px]"
  children:
    Button (variant=outline, full width, justify-between)
      未选时显示 "选择供应商 + 模型"（muted 色）
      已选时显示 "{providerName} · {modelName}"
      右侧 ChevronDown 图标
    ProviderModelSelectDialog
      defaultSelection: config.agent.defaultProviderModel ?? undefined
      onSelect: 保存 { providerId, modelTier } 到 config
```

### 显示标签解析

已选时需要将 `providerId` + `modelTier` 解析为可读标签。使用与 `AgentActionFields` 相同的模式：

- `useEffect` 监听 `providerId` / `modelTier` 变化
- 调用 `requireSynapseBridge().agent.listProviders()` 查找匹配 provider
- 根据 `modelTier` 取对应模型名
- 组装为 "{provider.name} {modelName}" 格式

### 清除默认值

已设置默认供应商后，按钮行右侧显示一个"清除"按钮（`variant=outline`, `size=sm`）。点击后将 `defaultProviderModel` 设为 `null` 并保存，按钮文字恢复为 "选择供应商 + 模型"。未设置时不显示清除按钮。

## §3 消费端：Agent 对话

文件：`desktop/src/modules/agent/components/agent-session-sidebar.tsx`

当前新建会话时打开 `ProviderModelSelectDialog`，`defaultSelection` 未传入。

变更：
- 从 config context 读取 `config.agent.defaultProviderModel`
- 传入 `defaultSelection={{ providerId, modelTier }}`（如果有值）
- `ProviderModelSelectDialog` 内部已有逻辑：如果 `defaultSelection` 的 provider 存在，预选它；不存在则 fallback 到 `activeProvider`
- 无需修改 dialog 组件本身

## §4 消费端：定时任务

文件：`desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`

`AgentActionFields` 在新建任务时的初始 config 中 `providerId` 为空。

变更：
- 新建 agent 类型任务时，从 config 读取默认值填充 `providerId` 和 `modelTier`
- 编辑已有任务时保持原值
- 初始化逻辑在任务表单 state 初始化处，不影响 `AgentActionFields` 组件本身
- `ProviderModelSelectDialog` 的 `defaultSelection` 自然跟随 config 中的值

## §5 消费端：工作流节点

文件：`desktop/src/modules/workflow/editor/canvas.tsx`

`defaultConfig(type)` 当前为 prompt/switch 节点返回空 `providerId`。

变更：
- `defaultConfig` 需要接收默认 provider/model 参数
- 方案：`Canvas` 组件内使用 `useAppConfig()` 读取 config，`onDrop` 回调中取 `config.agent.defaultProviderModel` 传给 `defaultConfig(type, defaultProviderModel)`
- `defaultConfig` 签名变为 `defaultConfig(type: string, providerModel?: { providerId: string; modelTier: ModelTier } | null)`
- 如果有默认值且节点类型是 prompt/switch，config 中填入 `providerId` + `modelTier`
- 如果无默认值，保持当前行为

## 测试要点

1. **Config 归一化**：`normalizeAgentGlobalConfig` 对合法值、非法值、缺失值的处理
2. **设置面板**：选择保存、显示标签解析、未设置状态
3. **Agent 对话**：有默认值时 dialog 预选正确；无默认值时行为不变
4. **定时任务**：新建任务时 provider 预填充；编辑任务时保持原值
5. **工作流节点**：拖入节点自带默认 provider；无默认值时 provider 为空
