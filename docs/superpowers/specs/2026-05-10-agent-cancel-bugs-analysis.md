# Agent 取消功能 — 消息列表混乱问题深度分析

## 复现步骤与截图对照

| 步骤 | 操作 | 截图 | 观察到的问题 |
|------|------|------|-------------|
| 1 | 新建会话 → 发"今天星期几" → 立即点停止 | 截图1 | 用户消息下方出现 ✕ 已收到 cancelled 2.6s + ✕ 失败 cancelled 2.6s |
| 2 | 再发"你好" | 截图2 | 之前的两行 cancelled phase rows 依然存在；多出一个空的 error Alert（⚠️框无文字）；底部出现"Agent 处理中 1.0s" |
| 3 | "你好"收到回复后 | 截图3 | cancelled 行仍在；新增 ✓ 已收到 7.2s；思考过程 + 回复正常出现 |
| 4 | 再发"今天星期几" | 截图4 | 最顶部两行 cancelled phase rows (2.6s) 依然存在；✓ 已收到 7.2s 也还在；底部又出现"Agent 处理中 1.0s" |
| 5 | 发长消息 → 立即停止（成功） | 截图5 | 累积了旧的 4 行 phase rows + 新的 cancelled 1.7s 两行 |
| 6 | 重复发同样的长消息 | 截图6 | 所有历史 phase rows（6 行）全部还在 + 空 error Alert 再次出现 + "Agent 处理中 1.1s" |

---

## 根因分析

### Bug 1: Phase rows 跨 turn 累积，不清理

**现象**: 每次 cancel 产生的 `✕ 已收到 cancelled` 和 `✕ 失败 cancelled` phase rows 在后续 turn 中依然可见，且不断累积。

**根因**: Phase items (`kind: "phase"`) 是 **renderer-only** 数据（不持久化到后端）。它们通过 `reducePhaseEvent()` append 到 `timeline` 数组中。关键问题在 `loadTimeline()`:

```typescript
// use-chat-connection.ts:129-144
updateTimeline((current) => {
  const phaseItems = current.filter((item) => item.kind === "phase")
  if (phaseItems.length === 0) return [...result.entries]
  // ...
  out.splice(lastUserIdx + 1, 0, ...phaseItems)
  return out
})
```

**当 `conversationUpdated` 事件触发 `loadTimeline` 时，它从当前 timeline 中提取 ALL phase items（包括旧 turn 的已完成/已取消的 phase rows），然后将它们全部拼接到新的 DB 快照之后。** 没有任何逻辑过滤掉属于旧 turn 的、状态已终结（done/failed）的 phase rows。

每次新消息触发 `conversationUpdated` → `loadTimeline`，旧的 cancelled phase rows 都会被重新插入到最新用户消息的后面。

**修复方向**: `loadTimeline` 在保留 phase items 时，应该只保留 **当前 turn** 仍在 `in-progress` 状态的 phase rows，丢弃所有 status 为 `done` 或 `failed` 的旧 rows。或者更彻底：只保留与当前活跃 runId 相关的 in-progress phase items。

### Bug 2: 空 error Alert 框（⚠️图标 + 无文字）

**现象**: 截图2、6中出现空的 error Alert 框，只有红色⚠️图标，右边没有文字。

**根因**: 在 `index.tsx:284-288`:

```typescript
{chat.error ? (
  <Alert variant="destructive">
    <AlertDescription>{chat.error}</AlertDescription>
  </Alert>
) : null}
```

结合 `sendMessage` 中 `finally` 块和 cancel 流程的竞态：

1. `sendMessage` 调用 `dispatch({ type: "SET_ERROR", error: null })` 清空 error
2. `bridge.agent.send()` 可能抛出错误（被 cancel 中断时），触发 `dispatch({ type: "SET_ERROR", error: message })`
3. 但如果 `message` 是一个空字符串（truthy check 通过但无内容），或者 error 被短暂设为非空然后被后续事件清除，就会出现空 Alert

另外，更可能的原因是 **timeline 中的 `error` kind item**。在 `agent-timeline-item.tsx:56-62`:

```typescript
case "error":
  return (
    <Alert variant="destructive">
      <AlertCircle data-icon="inline-start" />
      <AlertDescription>{item.message}</AlertDescription>
    </Alert>
  )
```

如果后端发出了一个 `error` event，其 `message` 为空字符串，`isEmptyTimelineItem` 会过滤掉（`item.message.trim().length === 0`），但如果 message 只包含空白字符（如单个空格），就会通过过滤但渲染为空框。

然而更直接的原因可能是：**cancel 后后端发出了一个 `error` event，其 message 字段为空或极短**。`appendAgentTimelineEvent` 中的 `isEmptyTimelineItem` 只检查 `trim().length === 0`，但如果 message 恰好是 `"cancelled"` 之类的文本后被 `loadTimeline` DB 快照覆盖时丢失了。

**最可能的根因**: Cancel 后后端的 `buildCancelledResult` 可能 emit 了一个空 message 的 error event，或者 cancel 中断导致流式传输半途中断，产生了一个 content 为空的 `text` event 然后被转换为空 message item。考虑到 `isEmptyTimelineItem` 已有过滤，更大的可能是 **DB 持久化的 history 中已经写入了一条空的 error 记录**，在 `loadTimeline` 从后端获取 entries 时被直接返回（不经过 `isEmptyTimelineItem` 过滤，因为那个函数只在 `appendAgentTimelineEvent` 路径使用）。

**修复方向**: 
1. `loadTimeline` 返回的 entries 也应该过滤掉空 message 的 error items
2. `AgentTimelineItem` 渲染 error kind 时应检查 `item.message` 是否为空，为空则不渲染
3. 后端 cancel 路径应确保不写入空 error 记录

### Bug 3: 旧 turn 的 phase rows 出现在新 turn 的用户消息下方

**现象**: 截图4中，用户发了新的"今天星期几"，下面紧接着就是旧 turn 的 `✕ 已收到 cancelled 2.6s` + `✕ 失败 cancelled 2.6s`，以及更早 turn 的 `✓ 已收到 7.2s`。

**根因**: 与 Bug 1 相同。`loadTimeline` 在合并时把 **所有** 旧 phase items 塞到最后一个 user message 之后：

```typescript
out.splice(lastUserIdx + 1, 0, ...phaseItems)
```

这意味着不论 phase items 属于哪个 turn/runId，都会被移到最新用户消息后面。这导致：
- 旧 turn 的 cancelled rows 跟在新 turn 的用户消息后面
- 多个 turn 的 phase rows 混在一起，时间线完全混乱

### Bug 4: `cancelPhase` 状态在 cancel 完成后未重置

**现象**: 截图5 显示 cancel 成功后显示正确。但注意 `cancelPhase` 的 reset 逻辑：

```typescript
// use-chat-events.ts:94-104
if (payload.phase === "cancelled" || ...) {
  if (payload.phase === "cancelled") {
    dispatch({ type: "SET_CANCEL_PHASE", cancelPhase: "cancelled" })
  }
  if (payload.phase === "completed" || payload.phase === "failed") {
    dispatch({ type: "CANCEL_RESET" })
  }
  // ...
}
```

当 phase 为 `"cancelled"` 时，`cancelPhase` 被设为 `"cancelled"`，但 **没有对应的 `CANCEL_RESET`**！只有 `"completed"` 或 `"failed"` 才会触发 reset。这意味着一旦 cancel 成功，`cancelPhase` 永远停留在 `"cancelled"` 状态，除非新的 turn 通过 `completed` 或 `failed` 重置它。

这对 UI 的影响：`AgentComposer` 中 `sending || cancelPhase === "cancel_pending"` 决定显示停止按钮还是发送按钮。`cancelPhase === "cancelled"` 既不匹配 `"cancel_pending"`，也不等于 `"idle"`，所以在条件判断时行为取决于 `sending` 的值。如果 `sending` 在 cancel 后已经变为 false（因为 `REMOVE_SENDING_CONVERSATION` 被触发），则 UI 恢复到发送按钮。但 `cancelPhase` 状态本身是脏的。

### Bug 5: `sending` 状态与 phase 事件的竞态

**现象**: 截图2 和截图4 中底部都出现了 "Agent 处理中" phase row（`in-progress`），说明新的 `send` 触发了新 turn 的 phase events。但同时旧的 cancelled rows 也还在。

**根因**: `sendMessage` 中：

```typescript
if (conversationId) {
  dispatch({ type: "ADD_SENDING_CONVERSATION", conversationId })
}
// ...
await bridge.agent.send(...)
// finally:
if (conversationId) {
  dispatch({ type: "REMOVE_SENDING_CONVERSATION", conversationId })
}
```

而 `use-chat-events.ts` 中 phase events 也会触发 `REMOVE_SENDING_CONVERSATION`：

```typescript
if (payload.conversationId) {
  dispatch({ type: "REMOVE_SENDING_CONVERSATION", conversationId: payload.conversationId })
}
```

这两个路径同时操作 `sendingConversationIds`，可能导致 `sending` 状态在 turn 实际还在运行时就被错误清除（`bridge.agent.send` 的 Promise resolve ≠ turn 完成）。

实际上，`bridge.agent.send` 是 **fire-and-forget** 式的——它只是把消息入队，Promise resolve 只表示消息已被 runtime 接收，不代表 turn 完成。所以 `sendMessage` 的 `finally` 块会在消息入队后立即 `REMOVE_SENDING_CONVERSATION`，而此时 turn 可能还在执行。这就是为什么需要依赖 phase events 来管理 sending 状态。

**但问题是两个路径都在移除**，导致：
- `sendMessage.finally` 过早移除 → sending 变 false
- Phase event 的 terminal 状态再次移除（已经是 false 了，无影响）

这意味着在 `send` 发出到 turn 真正结束之间，`sending` 会短暂闪回 false，导致 UI 短暂显示发送按钮而非停止按钮。

### Bug 6: Cancel 后 `CANCEL_RESET` 缺失导致连锁问题

**根因**: 回到 Bug 4 的分析。当用户 cancel 一个 turn 后：

1. `cancelTurn` → `dispatch({ type: "CANCEL_REQUESTED" })` → cancelPhase = "cancel_pending"
2. 后端 hard-kill → cancelTurn 返回 `{ status: "hard-killed" }` → `dispatch({ type: "SET_CANCEL_PHASE", cancelPhase: "cancelled" })`
3. Phase event `"cancelled"` 到达 → 又设置 `cancelPhase = "cancelled"`（重复）
4. **但没有任何地方将 cancelPhase reset 回 "idle"**

当用户发送下一条消息时，`cancelPhase` 仍然是 `"cancelled"`。这不会阻止发送（发送按钮由 `sending` 和 `canSend` 控制），但状态是脏的。

---

## 问题总结

| # | 问题 | 严重程度 | 根因 |
|---|------|---------|------|
| 1 | Phase rows 跨 turn 累积不清理 | **严重** | `loadTimeline` 保留所有 phase items（包括旧 turn 的终结态），每次 reload 都重新插入 |
| 2 | 空 error Alert 框 | **严重** | 后端 cancel 写入了空 message 的 error/result 记录到 history，`loadTimeline` 不过滤；或 timeline error item 渲染时未检查空 message |
| 3 | Phase rows 位置错乱 | **严重** | `loadTimeline` 将所有旧 phase items splice 到最新 user message 后面，不分 turn/runId |
| 4 | cancelPhase 未重置 | **中等** | `"cancelled"` 分支没有对应的 `CANCEL_RESET`，状态残留 |
| 5 | sending 状态竞态 | **中等** | `sendMessage.finally` 和 phase event 都移除 sendingConversationIds，且 `send()` Promise resolve ≠ turn 完成 |
| 6 | 多次 cancel 后状态累积 | **严重** | 上述 Bug 1-5 的组合效应 |

---

## 修复方案

### 修复 1: loadTimeline 只保留当前 turn 的 in-progress phase items

```typescript
updateTimeline((current) => {
  // Only preserve in-progress phase items (active turn, not finished)
  const activePhaseItems = current.filter(
    (item) => item.kind === "phase" && item.status === "in-progress"
  )
  if (activePhaseItems.length === 0) return [...result.entries]
  // ... rest of the splice logic
})
```

### 修复 2: AgentTimelineItem 过滤空 error

```typescript
case "error":
  if (!item.message || item.message.trim().length === 0) return null
  return (
    <Alert variant="destructive">
      <AlertCircle data-icon="inline-start" />
      <AlertDescription>{item.message}</AlertDescription>
    </Alert>
  )
```

### 修复 3: cancelled phase 后执行 CANCEL_RESET

```typescript
if (payload.phase === "cancelled") {
  dispatch({ type: "SET_CANCEL_PHASE", cancelPhase: "cancelled" })
  // Schedule reset after a brief display period, or reset immediately
  // since the cancelled state is transient
  setTimeout(() => dispatch({ type: "CANCEL_RESET" }), 1000)
}
```

或者更简单：在 `sendMessage` 开始时重置：
```typescript
dispatch({ type: "CANCEL_RESET" })
```

### 修复 4: sendMessage 不应在 finally 中 REMOVE_SENDING_CONVERSATION

`bridge.agent.send()` 是异步入队操作，其 resolve 不代表 turn 完成。应该完全依赖 phase events 来管理 sending 状态。移除 `sendMessage` 中的 `ADD/REMOVE_SENDING_CONVERSATION`，改为在 phase event `"received"`(in-progress) 时 ADD，在 terminal phase 时 REMOVE。

或者保留 ADD（乐观标记），但移除 finally 中的 REMOVE，让 phase event 终态来清理。

### 修复 5: loadTimeline 过滤空 entries

```typescript
const filteredEntries = result.entries.filter((entry) => {
  if (entry.kind === "error" && (!entry.message || entry.message.trim().length === 0)) return false
  if (entry.kind === "message" && entry.content.trim().length === 0) return false
  return true
})
```

---

## 优先级建议

1. **P0**: Bug 1 + Bug 3 — phase rows 累积 + 位置错乱（修改 `loadTimeline` 的 phase merge 逻辑）
2. **P0**: Bug 2 — 空 error Alert（修改渲染层 + loadTimeline 过滤）
3. **P1**: Bug 4 — cancelPhase 残留（cancelled 后加 reset）
4. **P1**: Bug 5 — sending 状态竞态（移除 sendMessage 的 finally REMOVE）
