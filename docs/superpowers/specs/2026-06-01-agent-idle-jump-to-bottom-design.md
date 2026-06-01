# Agent 空闲回到底部按钮设计

- 日期：2026-06-01
- 范围：`desktop/src/modules/agent/`
- 状态：设计确认中
- 关联设计：`docs/superpowers/specs/2026-05-09-agent-timeline-smart-autoscroll-design.md`

## 背景

Agent 对话界面已有智能滚动状态机和 `↓ 新消息` 按钮。现有按钮表达的是：用户离开底部阅读时，Agent 又产生了用户尚未看到的新内容。

这次新增的入口表达不同语义：用户在 Agent 已停止输出后，自己向上滚动查看历史，此时没有未读新内容，但用户需要一个一键回到底部的轻量入口。

## 目标

- 当 Agent 没有输出、用户不在底部、且没有未读新内容时，在输入框上方居中显示一个下箭头按钮。
- 点击下箭头后平滑滚动到底部，并恢复现有贴底状态。
- 保持现有 `↓ 新消息` 逻辑不变：只要用户离底期间确实产生了未读内容，即使 Agent 后续停止，也继续显示 `↓ 新消息`。
- 两个入口互斥，任何时候不得同时显示 `↓ 新消息` 和居中下箭头。

## 非目标

- 不重写 `useStickToBottom` 的滚动状态机。
- 不改变 Agent 正在输出时的自动跟随、未读标记和新消息按钮行为。
- 不增加未读计数、提示文案、动画或新的视觉体系。
- 不移动现有输入框、timeline 或会话布局。

## 状态规则

复用现有 `useStickToBottom` 返回的 `isPinned` 与 `hasUnread`，在 Agent 页面层计算两个互斥状态：

```ts
const showNewMessage = !stick.isPinned && stick.hasUnread
const showIdleJumpArrow = !stick.isPinned && !stick.hasUnread && !chat.sending
```

含义：

- `showNewMessage`：用户离底，并且有用户没有看见的新内容。
- `showIdleJumpArrow`：用户离底，但没有未读新内容，且当前 Agent 不在输出。

`showNewMessage` 拥有更高语义优先级。只要 `hasUnread` 为 true，界面继续显示 `↓ 新消息`，不因为 `chat.sending` 变成 false 而切换成居中下箭头。

## UI 设计

新增按钮放在 `AgentComposer` 内，与现有 `↓ 新消息` 一样作为输入框的绝对定位兄弟元素，避免改动 timeline 容器结构。

- 现有 `↓ 新消息` 继续位于输入框右上方。
- 新增下箭头位于输入框上方居中。
- 使用 shadcn `Button` 和 lucide `ChevronDown` 图标。
- 使用现有 token 和组件变体，不写自定义颜色、hex/rgb/hsl、内联样式或额外 CSS。
- 按钮只显示图标，不增加界面解释文案；`aria-label` 使用 `滚动到底部`。

建议组件接口：

```ts
type AgentComposerProps = {
  showJumpToBottom?: boolean
  showIdleJumpToBottom?: boolean
  onJumpToBottom?: () => void
}
```

渲染约束：

- `showJumpToBottom` 为 true 时，只渲染 `↓ 新消息`。
- `showJumpToBottom` 为 false 且 `showIdleJumpToBottom` 为 true 时，渲染居中下箭头。
- 两个按钮共用 `onJumpToBottom`，点击后调用 `stick.scrollToBottom({ behavior: "smooth" })`。

## 行为矩阵

| 场景 | `isPinned` | `hasUnread` | `chat.sending` | 显示 |
| --- | --- | --- | --- | --- |
| 贴底查看最新 | true | false | 任意 | 不显示 |
| 用户上滚，Agent 空闲，未产生新内容 | false | false | false | 居中下箭头 |
| 用户上滚，Agent 正在输出但未标记未读 | false | false | true | 不显示 |
| 用户上滚期间产生新内容 | false | true | true | `↓ 新消息` |
| 用户上滚期间产生新内容，之后 Agent 停止 | false | true | false | `↓ 新消息` |
| 用户点击任一回底入口 | false | 任意 | 任意 | 平滑滚到底，入口消失 |

## 测试

更新 `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`：

- `showIdleJumpToBottom` 为 true 时渲染 `aria-label="滚动到底部"` 的图标按钮。
- `showJumpToBottom` 和 `showIdleJumpToBottom` 同时为 true 时，只渲染 `↓ 新消息`，不渲染居中下箭头。
- 点击居中下箭头调用 `onJumpToBottom`。

更新 Agent 页面层测试或现有 mock：

- 当 `isPinned=false`、`hasUnread=false`、`chat.sending=false` 时传入 `showIdleJumpToBottom=true`。
- 当 `hasUnread=true` 时传入 `showJumpToBottom=true` 且 `showIdleJumpToBottom=false`。
- 当 `chat.sending=true` 且 `hasUnread=false` 时不传入居中下箭头。

## 风险与边界

- 按钮位于输入框上方，需避免遮挡 slash menu、pending message queue 和现有 `↓ 新消息`。居中按钮只在 `↓ 新消息` 不显示时出现，因此不会与右上角新消息按钮重叠。
- `hasUnread` 的含义必须继续保持“用户离底期间有新内容”，不要在本次改动里重定义它。
- 新按钮是用户主动离底后的导航入口，不参与 Agent 输出中的自动滚动决策。

