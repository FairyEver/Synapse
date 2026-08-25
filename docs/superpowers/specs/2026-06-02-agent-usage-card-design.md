# Agent 用量统计卡片设计

## 背景

Agent 对话结束后，当前界面在消息工具栏里用一行文字显示会话累计 token。信息密度低，也无法表达本轮增量、费用和趋势。目标是把这行摘要升级为每轮 assistant 回复后的独立用量统计卡片。

本设计只覆盖 Agent 对话消息末尾的用量展示，不改变 Usage Analysis 页面、定价规则管理、消息正文渲染、composer 或会话列表。

该卡片的 token 是会话累计计费口径，不是模型当前上下文占用。顶栏实时上下文会随 SDK 流事件更新并可在压缩后下降；本卡片继续按每轮结果累计，二者同时保留、互不推导。

## 目标

- 每轮回复结束后，在 assistant 消息正文下方显示一张独立的用量统计卡片。
- 卡片展示会话累计 token、本轮增量、本轮占累计比例、本轮费用、会话累计费用。
- 卡片高度尽量低，不打断消息流阅读。
- 在应用最小窗口宽度下保持单行横向布局，不做响应式换行。
- 复制按钮复制一段适合人类阅读的完整用量摘要。

## 非目标

- 不新增全局 Usage dashboard。
- 不重新设计 Agent 页面外壳。
- 不在卡片里提供定价编辑入口。
- 不做复杂图表交互、hover drilldown 或展开详情。
- 不为了原型效果引入新图表依赖。

## 信息结构

卡片标题为 `用量统计`。标题行只保留必要摘要：

- `用量统计`
- 本轮费用
- 会话累计费用
- 估算标记
- 时间
- 复制按钮

模型名不放在标题后。模型信息可以由 Agent 页面右上角或当前会话上下文承担；在卡片里重复会让标题行节奏变乱。

主体分两块：

- 左侧：token 分布条和 token 明细
- 右侧：最近 5 轮小型堆叠柱图

Token 分类按现有字段保持：

- 输入
- 输出
- 缓存读
- 缓存写
- 思考，仅在数据存在时显示；如果为了保持列宽稳定需要保留空列，可以显示 0。

每个 token 项显示三类信息：

- 累计值，例如 `10,248`
- 本轮增量，例如 `+2,104`
- 本轮占累计比例，例如 `21%`

比例口径：`本轮该类增量 / 当前会话该类累计`。分母为 0 时显示 `0%`。

## 视觉规则

卡片应是消息流里的轻量统计组件，不是 dashboard 卡片。

- 宽度跟 assistant 消息主体一致，沿用当前 `max-w-[76ch]` 的视觉范围，但实现时需要保证最小窗口下不会换行。
- 高度目标约 130-150px。费用 label 不单独占行。
- 标题行、费用、时间、复制按钮在同一基线附近。
- 数字使用统一字号和字重；累计 token 是主数字，本轮增量和比例是次信息。
- 数字列必须对齐。增量和百分比应有稳定宽度，避免每项看起来漂移。
- 不使用卡片套卡片，不额外加阴影。
- 颜色只使用现有 shadcn token 和 `--chart-*` token。
- 不使用 hex/rgb/hsl 字面色、渐变、glow、emoji 或内联 style。

## 布局细节

推荐横向结构：

```text
┌ 用量统计  本轮 ¥0.18  累计 ¥1.42  估算 i              14:32  copy ┐
├────────────────────────────────────────────────────────────────────┤
│ distribution bar                                      │ 最近 5 轮  │
│ 输入      输出      缓存读      缓存写      思考       │ mini bars  │
│ 10,248    3,812     42,180      1,216       680        │           │
│ +2,104 21% +846 22% +9,640 23% +0 0% +180 26%         │           │
└────────────────────────────────────────────────────────────────────┘
```

实现时不要照搬原型里的粗略尺寸。应根据真实组件渲染结果微调：

- `grid-template-columns` 使用稳定列宽，避免五个 token 项宽度不均。
- 图表区域固定宽度，避免挤压 token 数字。
- 分布条与 token 项左边缘对齐。
- 右侧小图只做趋势辅助，不抢占主视觉。

## 数据设计

现有 assistant result metadata 已包含：

- `usage`
- `costUsd`
- `costCny`
- `costCurrency`

现有累计 usage 由 `conversation-router` 的 `cumulativeUsageMetadata()` 写入 assistant history metadata。当前缺口是卡片还需要本轮 usage 和累计费用。

建议卡片输入数据在 renderer 层归一化为：

```ts
interface AgentUsageCardData {
  totalUsage: NormalizedUsage
  turnUsage: NormalizedUsage
  totalCostCny?: number
  turnCostCny?: number
  estimated: boolean
  timestamp?: string
}
```

本轮 usage 来源优先级：

1. result event 的原始 `usage`
2. 如果历史记录只有累计 usage，则通过当前累计减上一条 assistant 累计推导
3. 无法推导时只显示累计值，增量显示 `--`

会话累计费用来源优先级：

1. 后端持久化累计费用字段，如果后续补齐
2. renderer 根据本轮 result cost 对历史 assistant metadata 求和
3. 无法可靠计算时只显示本轮费用

费用展示优先使用 CNY，沿用现有 `formatSynapseCost`。

## 复制内容

点击复制按钮复制完整摘要，而不是复制 JSON 或只复制回复正文。

建议格式：

```text
用量统计：本轮费用 ¥0.18，会话累计费用 ¥1.42。
Token 累计：输入 10,248（本轮 +2,104，占累计 21%）、输出 3,812（本轮 +846，占累计 22%）、缓存读 42,180（本轮 +9,640，占累计 23%）、缓存写 1,216（本轮 +0，占累计 0%）、思考 680（本轮 +180，占累计 26%）。
价格按当前模型估算。
```

如果某项数据缺失，应省略缺失项或显示“暂不可用”，不要复制 `undefined`、`NaN` 或内部字段名。

## 组件边界

新增组件建议放在 Agent 模块内，而不是替换共享 `TokenUsageSummary`：

- `desktop/src/modules/agent/components/agent-usage-card.tsx`
- `desktop/src/modules/agent/utils/agent-usage-card.ts`

`TokenUsageSummary` 继续供 action result 和 workflow node result 使用。

`AgentMessageToolbar` 保留时间与复制回复能力。对有 usage 的 assistant 消息，新的用量卡片负责展示 usage；toolbar 不再重复渲染 usage 一行。

## 状态处理

- 无 usage：不渲染卡片。
- 有 usage 无 cost：显示 token，隐藏费用或显示费用暂不可用。
- 有累计无本轮：显示累计，增量和比例使用 `--`。
- 费用估算：显示 `估算 i`，tooltip 文案短句即可，例如 `价格按当前模型估算`。
- 思考 token 不存在：默认隐藏；如果隐藏会破坏列宽节奏，可保留为 0，但需要一致。

## 测试

单元测试：

- usage 归一化支持 snake_case 和 camelCase。
- 本轮增量百分比按 `turn / total` 计算。
- total 为 0 时比例为 0。
- 复制文本不包含 `undefined`、`NaN`。
- 缺失 cost 时不渲染错误金额。

组件测试：

- 有 usage 的 assistant 消息渲染卡片。
- 无 usage 的 assistant 消息不渲染卡片。
- 卡片标题为 `用量统计`。
- toolbar 不再重复出现旧的 `会话累计 输入...` 一行。
- 复制按钮写入完整摘要。

静态检查：

```bash
rg -n "style=\{|#[0-9a-fA-F]{3,8}|rgb\(|hsl\(|bg-\[|text-\[|from-|to-|gradient|console\.log" desktop/src/modules/agent desktop/src/components/token-usage-summary.tsx
```

预期：本次改动范围内没有新增违规样式或生产 `console.log`。

## 验收标准

- 在 Synapse 最小窗口宽度下，卡片主体不换行，文字不重叠。
- 卡片高度明显低于原型第一版，费用不单独占行。
- 标题行节奏稳定，数字列对齐。
- 点击复制得到完整、自然、可读的用量摘要。
- 视觉只使用现有 shadcn/Radix 基线和 token。
