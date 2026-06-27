# Agent 过程分段折叠设计

日期: 2026-06-27
范围: `desktop/src/modules/agent/` 对话时间线渲染层

## 背景

当前 Agent 对话时间线已经能展示结构化事件，包括用户消息、assistant 正式回答、thinking、工具调用、工具结果、权限请求、phase 状态行、SDK annotation 和错误状态。现有折叠主要发生在单个工具或 thinking 组件内部：

- 工具运行中、失败、权限请求默认展开，成功结果默认折叠。
- thinking 是否默认折叠由 `displayProfile.thinkingDefaultCollapsed` 控制。
- `toolCall` 与匹配的 `toolResult` 会在渲染层合为一行。
- 普通 SDK status 事件会隐藏。

这还不等同于 Codex 客户端的主对话体验。Codex 在执行过程中会显示中间过程，让用户看到 Agent 正在思考和调用工具；执行结束后，会把过程信息收进折叠区，让主时间线重点保留用户消息和正式回答。

Synapse 还需要额外保护一个已有风险：同一轮 Agent 执行中可能出现多段 assistant 正式回答。比如 Agent 先回答一段，然后继续读文件或调用工具，最后再给出第二段回答。优化折叠时不能把第一段正式回答归入过程折叠，也不能让后续 result 覆盖它。

## 目标

- 主时间线默认只突出用户消息和 assistant 正式回答。
- thinking、工具、phase、SDK annotation 等过程信息在完成后按段折叠。
- 每一段过程跟随其后的 assistant 正式回答，避免中间正式回答丢失或被误归档。
- 运行中仍能看到当前过程，保留“Agent 正在做什么”的可见性。
- 异常、拒绝、待权限处理的信息不能被默认埋进折叠块。
- 只在 renderer 分组和展示层实现，不迁移历史数据，不改变 IPC schema。

## 非目标

- 不重做 Agent timeline canonical model。
- 不改变 `appendAgentTimelineEvent` 的正式回答合并规则。
- 不改 Agent runtime、Claude SDK、权限审批、会话持久化或导出语义。
- 不新增自定义颜色、独立 CSS 系统、复杂动画或卡片套卡片。
- 不把 task sidebar、artifacts、sources 汇总一并做掉。

## 当前关键约束

`desktop/src/lib/agent-timeline.ts` 已经把以下 item 当作 assistant 正式回答合并边界：

- `toolCall`
- `toolResult`
- `permissionRequest`
- `toolProgress`
- `error`
- `result`

这意味着工具边界之后的 result 不会覆盖工具边界之前的 assistant message。新折叠设计必须尊重这个行为，不在渲染层把 assistant message 当作过程项收走。

## 推荐设计

采用“按 assistant 正式回答切段的过程折叠”。

渲染效果：

```text
用户消息

[过程详情 1]  完成后默认折叠
正式回答 1

[过程详情 2]  完成后默认折叠
正式回答 2

[过程详情 3]  如果最后还有尾随过程，也保留
```

核心原则：

- `message(role=user)` 永远主线展示。
- `message(role=assistant)` 永远主线展示。
- `thinking`、`toolCall`、`toolResult`、`toolProgress`、普通 `sdkEvent`、`phase` 属于过程信息。
- `permissionRequest` 的普通权限卡片继续保持用户可操作，不默认折叠；如果是非待处理历史权限项，可以作为过程项进入折叠组。
- `error` 和 cancelled/failed result 的用户可感知状态不能被静默折叠。

## Item 分类

渲染分组前先把 timeline item 分为三类。

主线信息：

- 用户消息。
- assistant 正式回答。
- 待处理权限请求。
- AskUserQuestion 待用户回答卡片。
- 不可恢复错误。
- 取消、停止、失败等需要用户看到的 turn outcome 提示。

过程信息：

- thinking。
- 工具调用、工具结果和工具输入流进度。
- 普通 phase 状态。
- 普通可见 SDK annotation。
- 已处理、已过期或历史权限事件。

隐藏信息：

- 当前已经隐藏的 generic SDK status。
- 空内容 item。

只有过程信息进入 process group。主线信息直接渲染。

## 分段算法

在 `AgentTimeline` 的渲染准备阶段，把 `timelineDisplayEntries(items)` 的结果再投影成 display groups。

概念类型：

```ts
type AgentTimelineDisplayNode =
  | { kind: "item"; item: SynapseAgentTimelineItem; result?: SynapseAgentToolResultTimelineItem }
  | { kind: "processGroup"; id: string; items: TimelineDisplayEntry[]; state: ProcessGroupState }
```

扫描规则：

1. 初始化一个空的 `pendingProcessEntries`。
2. 遇到用户消息：
   - 如果有残留过程项，先输出一个 process group。
   - 输出用户消息。
3. 遇到 assistant 消息：
   - 如果有残留过程项，先输出一个 process group。
   - 输出 assistant 消息。
4. 遇到过程项：
   - 追加到 `pendingProcessEntries`。
5. 扫描结束后如果还有残留过程项，输出最后一个 process group。

重要细节：

- process group 只改变展示结构，不改变原始 timeline。
- `toolCall + toolResult` 仍沿用当前 `timelineDisplayEntries` 的匹配结果，避免回退到单独两行。
- process group 的 key 应由组内第一个和最后一个 item id 组成，保证流式更新时尽量稳定。
- 历史和实时 timeline 共用同一分组逻辑。

## 默认展开策略

需要区分运行中和完成后。

### 运行中

当前活跃过程组默认展开。

活跃判断：

- `sending === true` 且该 process group 是最后一个 display node 或位于最后一个 assistant streaming message 前。
- 组内有 `phase.status === "in-progress"`。
- 组内有尚未匹配 result 的 `toolCall`。
- 组内有 `toolProgress.status === "preparing"`。
- 防御性规则：如果待处理权限事件因未来改动进入 process group，该组强制展开。

### 完成后

普通成功过程组默认折叠。

以下情况默认展开：

- 组内有失败或拒绝的工具结果。
- 组内有 `error` item。
- 组内有 failed phase，且不是 recoverable 的中断提示。
- 防御性规则：如果待处理权限事件因未来改动进入 process group，该组强制展开。

如果只是 completed phase、成功工具、thinking 或普通 sdk annotation，则完成后默认折叠。

### 用户手动状态

用户展开或收起某个 process group 后，本次页面生命周期内尊重用户选择。实现上可在 `AgentTimeline` 中维护：

```ts
const [processGroupOpenOverrides, setProcessGroupOpenOverrides] = useState<Record<string, boolean>>({})
```

如果 group key 因历史刷新变化导致找不到 override，回到默认策略即可。不需要持久化。

## 过程组标题

标题要短，避免解释性文案。

建议文案：

- `过程详情`
- `过程详情 · 3 项`
- `过程详情 · 正在执行`
- `过程详情 · 等待权限`
- `过程详情 · 1 个工具失败`

标题摘要只记录状态和数量，不展示敏感工具输入、命令参数、文件路径或用户正文。

摘要优先级：

1. 等待权限
2. 失败或拒绝
3. 正在执行
4. 普通数量

## 视觉设计

过程组使用现有 shadcn/Radix `Collapsible`，复用 `Button` ghost trigger 和 lucide chevron。

外层应保持轻量 annotation 风格：

- 不做卡片套卡片。
- 不新增自定义颜色。
- 不使用 shadow 做层级。
- 可沿用 `AgentAnnotation` 的窄列语气。
- 折叠内容内部继续渲染现有 `AgentTimelineItem`，保持工具、thinking、phase 的现有样式。

建议结构：

```tsx
<AgentProcessGroup
  entries={group.items}
  open={resolvedOpen}
  status={group.state}
  onOpenChange={...}
>
  {entries.map(renderEntry)}
</AgentProcessGroup>
```

`AgentProcessGroup` 不应包含业务逻辑，只负责标题、折叠状态和内部列表布局。

## 与现有组件的关系

### `AgentTimeline`

新增渲染分组函数：

- 当前：`timelineDisplayEntries(items) -> TimelineDisplayEntry[]`
- 目标：`timelineDisplayEntries(items) -> groupTimelineDisplayEntries(entries, context) -> AgentTimelineDisplayNode[]`

`AgentTimeline` 负责：

- 计算 process groups。
- 保存用户手动 open override。
- 把 group 内部 entry 继续交给 `AgentTimelineItem`。

### `AgentTimelineItem`

保持现有 item-kind 分发。除非为了支持 process group 内部渲染需要补充轻量 props，否则不把分组逻辑放进这里。

### `AgentToolEvent`

保留现有单个工具折叠规则。外层 process group 解决主时间线噪音；内层工具折叠解决长输入输出噪音。

### `AgentThinkingEvent`

保留现有 thinking collapsible。后续如果 process group 已经折叠，thinking 内层是否展开不影响主时间线。展开过程组后，thinking 仍按 profile 或用户点击状态显示。

### `AgentPermissionCard` / `AgentUserQuestionCard`

待处理权限和 AskUserQuestion 必须直接可见。推荐规则：

- pending permission 作为主线 item 渲染，不进入默认折叠的 process group。
- 已处理历史权限请求可以进入 process group。

这样用户不会因为外层折叠漏掉必须处理的动作。

## 信息保留策略

正式信息的定义：

- `message(role=user)`
- `message(role=assistant)`
- 用户必须响应的 pending permission / question
- 不可恢复的错误 alert

这些信息默认不折叠。

过程信息的定义：

- thinking
- tool call/result/progress
- 普通 phase 状态
- 普通 sdk annotation
- 已处理权限事件

这些信息可以被过程组折叠，但不会被删除。

多段回答场景必须满足：

```text
assistant A
tool
assistant B
tool
assistant C
```

最终展示为：

```text
assistant A
[过程详情]
assistant B
[过程详情]
assistant C
```

不能变成：

```text
[过程详情包含 assistant A 和 B]
assistant C
```

也不能把 A、B、C 合成一条消息。

## 边界场景

### 只有过程，没有正式回答

例如 Agent 启动后失败，或用户取消前没有 assistant message。

展示：

```text
用户消息
[过程详情 · 失败]  默认展开
错误或停止提示
```

如果只有成功工具但没有正式回答，也必须保留过程组，不丢信息。

### assistant streaming 后 result 为空

现有逻辑会把 streaming assistant 标记为完成并保留原内容。分组逻辑不改变这一点。

### result 作为 standalone assistant message

现有逻辑会把非空 result 提升为 assistant message。分组逻辑应把它当作正式回答边界。

### SDK status

当前隐藏的 generic status 继续隐藏。可见 sdk annotation 进入过程组，native slash annotation 可以进入过程组，但如果后面没有正式回答也要保留。

### 历史刷新

数据库快照替换 timeline 后重新分组。用户手动 open override 可以丢失，不影响数据完整性。

## 测试计划

### 单元测试

新增或扩展 `agent-timeline.test.tsx`：

- `groups process entries before an assistant message`
- `keeps assistant messages outside process groups`
- `creates separate process groups between multiple assistant messages`
- `keeps pending permission outside collapsed process groups`
- `opens failed process groups by default`
- `collapses successful completed process groups by default`
- `keeps active process group open while sending`
- `preserves matched tool result inside grouped tool call`

新增纯函数测试更好：

- 如果把 `groupTimelineDisplayEntries` 抽为可测试函数，可以单独验证分组结果，不依赖 markup 字符串。

### 回归测试

覆盖已有风险：

```text
stream assistant "I will inspect"
tool result
result "Final answer"
```

断言最终有两条 assistant message，且工具过程被放在两条 message 之间的 process group 中。

再覆盖更复杂场景：

```text
assistant A
thinking
tool call/result
assistant B
thinking
tool call/result
assistant C
```

断言 A/B/C 都在主线展示，两个过程组分别位于 A-B 和 B-C 之间。

## 验证方式

- `pnpm --filter @synapse/desktop test -- agent-timeline`
- 如果实现触及具体组件快照或 DOM 状态，再补跑相关组件测试：
  - `agent-tool-event`
  - `agent-thinking-event`
  - `agent-timeline-item`

本设计不要求启动 dev server。若实现后需要人工检查体验，再按仓库规则使用 `pnpm dev:desktop`。

## 实施顺序建议

1. 抽出 `groupTimelineDisplayEntries` 纯函数和类型。
2. 给分组函数补充多段 assistant 回归测试。
3. 新增 `AgentProcessGroup` 轻量组件。
4. 在 `AgentTimeline` 中接入 display nodes。
5. 加入 open override 和默认展开策略。
6. 扩展异常、pending permission、active sending 场景测试。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 中间 assistant 正式回答被折叠 | assistant message 永远作为分段硬边界，并写回归测试 |
| pending permission 被埋进折叠 | pending permission 直接主线展示或强制展开 |
| 流式过程中 UI 跳动 | active group 默认展开，完成后再折叠 |
| group key 不稳定导致手动状态丢失 | key 使用首尾 item id，手动状态只做页面生命周期内体验增强 |
| 工具结果匹配被破坏 | 先执行现有 `timelineDisplayEntries`，再做过程分组 |

## 成功标准

- 完成后的主对话流只突出用户消息和 assistant 正式回答。
- 多段 assistant 正式回答全部保留在主线。
- 成功过程默认折叠，异常和权限不被隐藏。
- 展开过程组后，用户仍能看到原有 thinking、工具输入输出、phase 状态和 SDK annotation。
- 不需要迁移历史数据，不改变 runtime 或 IPC schema。
