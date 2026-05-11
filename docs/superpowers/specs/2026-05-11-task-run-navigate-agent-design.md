# 手动运行定时任务后自动跳转 Agent Session 设计

**日期**：2026-05-11  
**状态**：已批准  
**背景**：用户点击任务卡片上的"运行"按钮后，UI 显示"任务已触发"成功提示，但任务实际产生的 Agent session 无法被自动看到。用户需要手动切换到 Agent 页并在会话列表中找到新建的 session，体验割裂。

---

## 问题根因

`task-scheduler/index.tsx` 的 `onRun` 回调是 fire-and-forget：

```ts
onRun={(task) => {
  runTask(task.id).catch(...)   // 不等结果
  notify({ message: "任务已触发", tone: "success" })  // 立即弹出
}}
```

- `runTask` IPC 要等整个 agent 执行完才返回 `conversationId`（可能几十分钟）
- 触发后没有任何导航逻辑
- `shouldAutoFollowConversation` 只处理 `platform === 'feishu'`，`scheduled` 平台不在范围内
- 新建 session 不会被自动选中，旧 session 可能从列表被顶出导致 UI 选中错误的会话

---

## 解决方案：导航意图事件（Approach B）

在 `navigation.ts` 新增一个"等待下一个新 session 后跳转"的意图事件，由 task-scheduler 在手动触发时发出，agent module 负责监听并执行跳转。两个模块通过 CustomEvent 解耦。

### 数据流

```
[task-scheduler] onRun
  ├─ task.action.type === 'builtin.agent' ?
  │    └─ YES → requestWatchNextAgentSession({ projectId })  ← 新增
  ├─ runTask(task.id).catch(...)                             ← 不变
  └─ notify("任务已触发")                                    ← 不变

[app-shell/navigation.ts]
  └─ 转发 CustomEvent（与 requestOpenAgentSession 同模式）

[agent module: use-chat-events.ts]
  └─ subscribeWatchNextAgentSession 监听
       → 收到后存储 pendingWatch = { projectId, expiresAt: now + 5000 }
       → setTimeout 5s 自动清除
       → 每次 conversationUpdated 到达时检查：
           if event.projectId === pendingWatch.projectId
           && Date.now() < pendingWatch.expiresAt
             → requestOpenAgentSession({ projectId, conversationId })
             → 清除 pendingWatch
```

### 为什么用时间窗口而非 `historyCount === 1`

`sessionPolicy: 'resume'` 时会复用已有 session，`historyCount > 1`，用 `historyCount` 会漏掉这种情况。时间窗口（5s）更稳健，手动点击后 5s 内到来的第一个该 projectId 的 `conversationUpdated` 就是刚触发的这条。

---

## 修改范围

### 1. `src/app-shell/navigation.ts`（+8 行）

新增常量、`requestWatchNextAgentSession`、`subscribeWatchNextAgentSession`，与已有的 `requestOpenAgentSession` / `subscribeOpenAgentSession` 完全对称。

```ts
const WATCH_NEXT_AGENT_SESSION_EVENT = "synapse:watch-next-agent-session"

type WatchNextAgentSessionPayload = { projectId: string }

function requestWatchNextAgentSession(payload: WatchNextAgentSessionPayload): void {
  window.dispatchEvent(new CustomEvent(WATCH_NEXT_AGENT_SESSION_EVENT, { detail: payload }))
}

function subscribeWatchNextAgentSession(
  listener: (payload: WatchNextAgentSessionPayload) => void,
): () => void {
  const handle = (e: Event) => listener((e as CustomEvent<WatchNextAgentSessionPayload>).detail)
  window.addEventListener(WATCH_NEXT_AGENT_SESSION_EVENT, handle)
  return () => window.removeEventListener(WATCH_NEXT_AGENT_SESSION_EVENT, handle)
}
```

### 2. `src/modules/task-scheduler/index.tsx`（~+5 行）

在 `onRun` 回调里，触发 `runTask` 之前先检查 action 类型并发出意图：

```ts
onRun={(task) => {
  if (task.action.type === "builtin.agent") {
    const projectId = (task.action.config as { projectId?: string }).projectId
    if (projectId) requestWatchNextAgentSession({ projectId })
  }
  runTask(task.id).catch((err) => {
    logger.error("Failed to run task.", { error: err, taskId: task.id })
  })
  notify({ message: "任务已触发", tone: "success" })
}}
```

### 3. `src/modules/agent/hooks/use-chat-events.ts`（~+25 行）

在 `useChatEvents` 的 `useEffect` 外新增一个独立的 `useEffect`，订阅意图事件并维护 `pendingWatchRef`：

```ts
// pendingWatch ref，存储 { projectId, expiresAt } 或 null
const pendingWatchRef = useRef<{ projectId: string; expiresAt: number } | null>(null)

useEffect(() => {
  return subscribeWatchNextAgentSession(({ projectId }) => {
    pendingWatchRef.current = { projectId, expiresAt: Date.now() + 5000 }
    const timer = setTimeout(() => { pendingWatchRef.current = null }, 5000)
    return () => clearTimeout(timer)  // 注意：cleanup 在 unsubscribe 里处理
  })
}, [])
```

在已有的 `conversationUpdated` 处理分支里（`domainEvent.type === "conversationUpdated"`）增加检查：

```ts
// 在 refreshConversationSnapshot 调用之后
const watch = pendingWatchRef.current
if (
  watch
  && domainEvent.payload.projectId === watch.projectId
  && Date.now() < watch.expiresAt
) {
  pendingWatchRef.current = null
  requestOpenAgentSession({
    projectId: domainEvent.payload.projectId,
    conversationId: domainEvent.payload.conversationId,
  })
}
```

---

## Edge Cases

| 场景 | 处理 |
|------|------|
| task 不是 `builtin.agent` 类型 | 不触发意图，行为不变 |
| 5s 内 agent 未创建 session（执行错误等） | pendingWatch 自动超时清除 |
| 同一 projectId 同时有另一个 session 更新 | 5s 窗口很短，几乎不会发生竞争；发生时跳转到第一个到来的 session，可接受 |
| 用户已在 agent tab 且已选中该 session | `requestOpenAgentSession` 触发重选，harmless |
| `sessionPolicy: 'resume'` 复用旧 session | 时间窗口机制正确处理（不依赖 historyCount） |

---

## 不在范围内

- 新 session 初始 `active: false` 的状态问题（独立 bug，不在本次修复范围）
- 非 agent 类型任务（HTTP、脚本）的执行结果可见性
