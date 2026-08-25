# Agent 顶栏实时上下文占用设计

## 背景

回复下方的用量统计卡展示会话累计计费 token，适合回看费用与历史增量，但不能回答“当前主线程还占用了多少模型上下文”。两者口径不同：缓存 token 会在多轮累计计费，而模型自动压缩后当前上下文可以下降。

## 产品行为

- 模型信息后显示 `上下文 58K / 200K · 29%` 和短进度条。
- 窄顶栏显示 `上下文 29%` 和进度条，精确值保留在 Tooltip。
- Tooltip 显示已用、剩余、SDK 运行窗口，以及目录中可用的模型上限、最大输入/输出、配置来源和官方资料日期。
- SDK 尚未给出可靠窗口时只在顶栏显示已用 token；目录官方上限只出现在 Tooltip，不计算百分比。完全无快照时不渲染。
- SDK 运行窗口与目录官方上限不一致时同时显示，例如 `运行窗口 200,000 / 模型上限 1,000,000`。
- 自动压缩允许占用下降，不增加警告色、点击操作或阈值状态。
- 主界面与独立对话窗口复用 `AgentConversationWorkspace` 内的同一组件。

## 数据契约

```ts
interface AgentContextUsage {
  usedTokens: number
  contextWindowTokens?: number
  model?: string
  modelContext?: AgentModelContextReference
  contextWindowConfigurationSource?: "catalog" | "provider-env"
}
```

`assistant`、`stream` 和 `compactBoundary` 事件可携带实时快照。最终 `result.metadata.contextUsage` 保存稳定快照，沿现有 Agent 事件与时间线 IPC 传递，不新增 IPC 通道。

## SDK 聚合规则

1. 只处理 `parent_tool_use_id` 为空的主线程事件，子智能体事件不改变快照。
2. 优先读取 `usage.iterations` 的最后一项；没有有效项时，将 input、cache read、cache creation 与 output token 求和。
3. `message_delta` 保留上一份输入与缓存分项，用最新累计 output 更新，避免 SDK 的空字段导致归零。
4. 收到 `compact_boundary` 后，通过当前 `Query.getContextUsage()` 读取完整的 `totalTokens/maxTokens/model`；`compact_metadata.post_tokens` 只代表压缩摘要，不进入顶栏统计。
5. 压缩后上下文查询失败时清空当前快照，等待下一份可靠 usage，不影响压缩命令结果，也不保留摘要 token 或压缩前旧值。
6. 普通回复的窗口上限只读取 `modelUsage.*.contextWindow`：优先精确匹配当前主线程模型；只有一个有效候选时才回退。
7. 模型变化后清除旧的 SDK 运行窗口，直到新结果确认。允许维护 Provider scope 内经过官方来源核验的模型上下文目录，但它只能配置新 SDK 会话和提供 Tooltip 参考，不能替代 SDK 实际窗口。
8. 非有限数、负数、非整数和无效窗口不进入快照。

## 模型目录边界

- tier/Persona 模型解析完成后，以规范化 Base URL + 精确模型 ID/官方别名匹配目录；禁止模型家族猜测和版本截断。
- 用户显式设置的 `CLAUDE_CODE_MAX_CONTEXT_TOKENS` 优先；否则已知模型把目录总窗口注入新 SDK 会话。
- 未知模型、未配置模型和未登记聚合平台不注入。
- 派生配置参与会话复用判断，变化后新建 SDK 会话。
- 目录不得用于附件、图片、工具、视觉或模型能力路由。

## Renderer 状态

- reducer 保存当前会话的 `contextUsage`。
- 选择其它会话时立即清空；历史加载后从最近一条 result/assistant metadata 恢复。
- 实时事件到达时立即更新，不等待 50ms 的文本流批次；时间线增量刷新不得覆盖更新的实时值。

## 展示规则

- 百分比四舍五入；进度条值限制在 0–100%，已用和窗口原始 token 不改写。
- 百分比和顶栏分母只使用 SDK 实际 `contextWindowTokens`，不从 `modelContext` 推导。
- 使用现有 `Progress`、`Tooltip`、主题 token 与 Tailwind container query。
- 不新增 CSS、颜色、依赖、卡片层级或装饰文案。

## 与累计用量的边界

| 指标 | 顶栏当前上下文 | 回复下方用量卡 |
|---|---|---|
| 回答的问题 | 当前主线程占用多少模型窗口 | 截至该回复累计计费多少 token 与费用 |
| 更新时机 | SDK 流事件、压缩边界、结果 | 每轮结果持久化 |
| 是否可能下降 | 会，压缩后可下降 | 不会，随会话累计 |
| 缓存 token | 当前迭代上下文组成 | 每轮缓存读写累计计费 |

两个展示必须同时保留，不能用其中一个推导或替换另一个。

## 验证

- SDK 聚合：流式输入/输出、iterations 优先、缓存求和、压缩下降、主子线程隔离、模型匹配、未知窗口和异常数字。
- 数据链路：result 持久化、IPC 校验、历史恢复、会话切换重置、实时事件不被批处理覆盖。
- UI：完整/窄宽度、未知窗口、超出 100% 以及主窗口/独立窗口复用。
