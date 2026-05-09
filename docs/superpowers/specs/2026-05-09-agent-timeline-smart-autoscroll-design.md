# Agent 时间线智能滚动设计

- 日期：2026-05-09
- 范围：`desktop/src/modules/agent/`
- 状态：设计已通过用户确认，待落地

## 1. 背景与问题

`@/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent/index.tsx:87-102` 当前的滚动行为是无条件跟随：每当 `chat.timeline.length` / 最后一条消息 ID / 时间戳 / `chat.sending` 改变，都会调用一次 `bottom.scrollIntoView({ block: "end" })`。

由此带来的体验问题：用户向上滚动阅读历史消息时，只要 Agent 又输出了新内容（流式输出尤其频繁），视图就会被强制甩到底部，把用户正在读的位置打断。

## 2. 目标

- 用户向上滚动阅读时，新消息到来不再强制滚到底。
- 不打扰阅读，但要让用户**知道**有新消息，并提供一键回底。
- 切换会话、用户自己刚发出消息、首次进入会话这些场景下，仍然以"看最新"为预期。
- 兼容流式输出场景：在用户已贴底时，自动跟随；在用户上滚阅读时，**不**跟随。

## 3. 非目标

- 不引入"未读消息计数"。胶囊不显示数字。
- 不基于鼠标 hover 或"距上次滚动 N 秒"做判定（已评估为误判率高）。
- 不实现跨会话的"未读"持久化记忆。

## 4. 总体方案

引入一个 stick-to-bottom 状态机 `isPinnedToBottom`，用容器距离底部的像素阈值判定，并在三个特殊场景下强制 pin 回底。

```
                 ┌─────────────────────────────┐
                 │  pinned = true（贴底）      │
                 │  - 新消息：自动滚到底       │
                 │  - 不显示胶囊               │
                 └──────────────┬──────────────┘
                                │ 用户向上滚动，距底 ≥ 80px
                                ▼
                 ┌─────────────────────────────┐
                 │  pinned = false（已离底）   │
                 │  - 新消息：不自动滚         │
                 │  - 来过新消息后显示胶囊     │
                 └──────────────┬──────────────┘
                                │ ① 用户手动滚回底（< 80px）
                                │ ② 用户点击胶囊
                                │ ③ 切换会话 / 用户自己发送消息
                                ▼
                          回到 pinned = true
```

## 5. 详细设计

### 5.1 新组件 / 新 Hook

**新增 Hook：`useStickToBottom`**

位置：`desktop/src/modules/agent/hooks/use-stick-to-bottom.ts`

职责：封装"贴底状态 + 自动滚动 + 未读旗标"。对外 API：

```ts
type UseStickToBottomReturn = {
  /** 挂到 ScrollArea viewport 上 */
  viewportRef: RefObject<HTMLDivElement | null>
  /** 是否当前贴底 */
  isPinned: boolean
  /** 离底期间是否累计到了至少一条新消息 */
  hasUnread: boolean
  /** 平滑回底；调用方在用户点击胶囊时调用 */
  scrollToBottom: (options?: { behavior?: ScrollBehavior }) => void
  /** 强制 pin（切会话 / 用户自己发消息时调用），会立即贴底并清除未读 */
  forcePin: () => void
}

function useStickToBottom(deps: {
  /** 触发"可能要跟随/可能要标记未读"的依赖。一般传 timeline.length 和最后一条消息的 id+timestamp。 */
  contentSignal: unknown[]
  /** 距底阈值（px）。默认 80。 */
  threshold?: number
}): UseStickToBottomReturn
```

实现要点：

1. 内部维护 `isPinnedRef` 与 `isPinned` state。`Ref` 用于在 scroll 回调里读最新值，state 用于驱动渲染。
2. 在 `viewportRef.current` 上监听 `scroll`，每次根据 `scrollHeight - scrollTop - clientHeight < threshold` 计算 `nextPinned`。
3. 区分"程序滚动"和"用户滚动"：
   - `scrollToBottom` 与 `forcePin` 在执行 `scrollTo` / `scrollIntoView` 之前，把一个 `programmaticScrollLockRef` 置为当前帧的目标 `scrollTop`，并在下一帧（或 50ms 内）清除。
   - `scroll` 监听里如果检测到 `programmaticScrollLockRef` 仍命中，跳过对 `isPinned` 的更新（仅更新视觉位置，不打断状态机）。
4. `contentSignal` 变化时：
   - 如果 `isPinnedRef.current === true` → 调 `scrollToBottom({ behavior: "auto" })`，并保持 `hasUnread = false`。
   - 否则 → 不滚动，置 `hasUnread = true`。
5. 当 `scroll` 事件让 `isPinned` 由 `false` 变 `true` 时（用户手动滚到底）→ 立即清 `hasUnread = false`。这就是"胶囊在用户自己滑到底时消失"的实现路径。
6. `forcePin()`：直接 `scrollTo(scrollHeight, "auto")`，置 `isPinned = true`、`hasUnread = false`。
7. 阈值用常量 `80`，定义在 hook 文件内：`const PINNED_THRESHOLD_PX = 80`。

### 5.2 `AgentTimeline` 改造

`@/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent/components/agent-timeline.tsx`

变化：
- 不再需要从父组件传入 `bottomRef`。
- ScrollArea 的 viewport 需要接 `viewportRef`。shadcn 的 `ScrollArea` 内部 viewport 是 `[data-slot="scroll-area-viewport"]`，需要 forward 一个 `viewportRef` prop（必要时给 `desktop/src/components/ui/scroll-area.tsx` 增加 `viewportRef` 透传）。
- 在 timeline 容器上叠一个 `relative` 包装，在右下角绝对定位"新消息"胶囊。胶囊本身只是个 `Button` 变体；显隐由父组件传入的 `showJumpToBottom` + `onJumpToBottom` 控制。

新 props：

```ts
type AgentTimelineProps = {
  // 既有 props 保留……
  viewportRef: RefObject<HTMLDivElement | null>
  showJumpToBottom: boolean
  onJumpToBottom: () => void
}
```

胶囊视觉与位置（遵循 `radix-nova` 默认 token、不引入自定义色）：

- 元素：`<Button variant="secondary" size="sm" className="rounded-full shadow-md">↓ 新消息</Button>`
- 容器：与 ScrollArea 同级、外面再包 `relative` 的盒子。胶囊用 `absolute bottom-4 right-4`（pr-4 区域内），属于 ScrollArea 容器的兄弟节点，**不在 ScrollArea 内部滚动**。
- 因为 `AgentComposer` 与 `AgentTimeline` 是兄弟节点，胶囊只在 timeline 容器内绝对定位，自然位于输入框上方，不会与输入框重叠。
- 不做时间型淡出动画。出现/消失走 `data-[state=open]:animate-in fade-in-0 zoom-in-95` 这类 shadcn 默认即可。
- 文案：`↓ 新消息`，无计数。
- a11y：`aria-label="跳到最新消息"`。

### 5.3 `AgentModule`（`desktop/src/modules/agent/index.tsx`）改造

- 删除当前的 `timelineBottomRef` 与 `useEffect` 自动滚动块（`@/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent/index.tsx:69, 87-102`）。
- 改为：

```ts
const stick = useStickToBottom({
  contentSignal: [
    chat.selectedSessionKey,
    chat.timeline.length,
    latestEntry?.id,
    latestEntry?.timestamp,
    chat.sending,
  ],
})
```

- 切会话 / 用户自己发送消息时调 `stick.forcePin()`：
  - 在 `submitDraft`（`@/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent/index.tsx:104-109`）成功 dispatch 后调用一次。
  - 在 `chat.selectedSessionKey` 变化的 effect 里调用一次。
- 把 `viewportRef`、`showJumpToBottom = !stick.isPinned && stick.hasUnread`、`onJumpToBottom = () => stick.scrollToBottom({ behavior: "smooth" })` 传给 `AgentTimeline`。

### 5.4 `ScrollArea` viewport ref 透传

`@/Users/liyang/Documents/code/github/Synapse/desktop/src/components/ui/scroll-area.tsx` 当前可能没暴露 viewport 的 ref。预期改动：给 `ScrollArea` 增加可选 `viewportRef?: React.Ref<HTMLDivElement>`，赋给内部 `ScrollAreaPrimitive.Viewport`。属于在 shadcn 组件上做最小补丁，不破坏既有调用点。

> 落地前要先确认 shadcn 当前文件的写法；如果当前文件已经支持 `ref` 转发到 viewport，就直接用，不再加 prop。

## 6. 行为矩阵

| 场景 | 用户当前位置 | 期望行为 |
| --- | --- | --- |
| 收到 Agent 流式增量 | 贴底 | 自动跟随到底 |
| 收到 Agent 流式增量 | 离底（向上阅读） | 不滚；显示胶囊（首次新消息时） |
| 用户点击胶囊 | 离底 | 平滑滚到底；胶囊消失；恢复贴底 |
| 用户手动拖回底部 | 离底 → 贴底 | 胶囊消失；恢复贴底；后续自动跟随 |
| 用户自己提交一条消息 | 任意 | 强制滚到底；胶囊消失 |
| 切换会话 / 切换项目 | 任意 | 强制滚到底；胶囊消失 |
| 首次加载会话 | 任意 | 直接出现在底部 |
| `sending` 状态切换（出现"正在处理"占位） | 贴底 | 自动跟随 |
| `sending` 状态切换 | 离底 | 不滚（不当作"新消息"标记，避免占位变化也触发胶囊） |

> 关于最后一行：`sending` 占位的出现/消失不应当作"未读"。`useStickToBottom` 在 `contentSignal` 变化时只有在"timeline 中真的多了一条用户尚未看到的消息"时才置 `hasUnread = true`。具体判定：
> - 记录上一次的 `latestEntry.id`。
> - 仅当 `latestEntry.id` 变化（即真的来了一条新条目）时才置 `hasUnread = true`。

## 7. 错误与边界处理

- **viewport 尚未挂载**：`scrollToBottom` / `forcePin` 在 `viewportRef.current` 为 `null` 时静默返回。
- **timeline 为空**：`hasUnread` 必须为 `false`，胶囊不显示。
- **快速反复滚动**：`scroll` 监听用 `requestAnimationFrame` 节流，避免高频 setState。
- **窗口/容器尺寸变化**：在 viewport 上监听 `ResizeObserver`，尺寸变化后重新计算一次贴底状态。
- **极短内容（不需要滚动）**：`scrollHeight <= clientHeight` 时永远视为贴底；胶囊永不显示。

## 8. 测试

新增 `desktop/src/modules/agent/hooks/__tests__/use-stick-to-bottom.test.tsx`：

- 初次挂载、内容很短 → `isPinned = true`、`hasUnread = false`。
- 模拟 viewport `scrollTop` 远离底部，触发 `scroll` → `isPinned = false`。
- `isPinned = false` 时 `contentSignal` 改变（来新消息）→ `hasUnread = true`，且未调用程序滚动。
- 用户手动滚回阈值内 → `isPinned = true`、`hasUnread = false`。
- 调 `scrollToBottom()` → 视为程序滚动；不会因这次 scroll 把 `isPinned` 误反弹（防自解钉）。
- 调 `forcePin()` → 立即 `isPinned = true`、`hasUnread = false`。
- 仅 `sending` 占位变化（latestEntry.id 不变）→ `hasUnread` 不被置真。

更新 `@/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`：

- 传入 `showJumpToBottom = true` → 渲染胶囊，`aria-label = "跳到最新消息"`。
- 传入 `showJumpToBottom = false` → 不渲染胶囊。
- 点击胶囊 → 调用 `onJumpToBottom`。

## 9. 不影响项

- 主进程、preload、IPC、`window.synapse.*` 全部不动。
- 其他业务模块（`rules` / `skills` / `settings` 等）不受影响。
- 不增加依赖。
- 视觉上不引入自定义色 / 自定义阴影系统，沿用 `radix-nova` 默认 token。

## 10. 风险与权衡

- shadcn `ScrollArea` 的 viewport ref 透传如果改起来比预期复杂，可以退化为：直接在 viewport 上用 `querySelector('[data-slot="scroll-area-viewport"]')`，但更建议正路加 `viewportRef`。
- 80px 阈值是经验值。如果用户反馈"我只是稍微往上拉一点就被认为是阅读"，可以下调到 40px；反之上调。阈值用常量集中管理便于调整。
- 流式输出极快时，用户可能在贴底状态下看到内容刷得很快——这是流式本身的预期，不属于本设计要解决的范围。
