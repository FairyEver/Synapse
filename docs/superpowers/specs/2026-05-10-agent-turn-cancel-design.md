# Agent Turn Cancel（分级停止）设计

## 概述

为正在执行的 Agent 任务提供"停止"能力。用户可以中断当前正在运行的 Agent 回合（turn），无需等待其完成。设计采用**分级停止**策略：第一次点击发送 Graceful Cancel，5 秒后仍未停止则 UI 按钮升级为 Hard Kill。

## 目标

1. 用户可以在 Agent 回答过程中随时点击停止
2. 分级停止：优雅取消 → 超时后强制终止
3. 停止后保留已收到的部分输出，写入 timeline 和 history
4. 各 Agent 后端（Claude Code / Codex / Hermes）通过 adapter 接口适配不同取消机制
5. 作用范围为当前 turn 级别，queue 中排队的 turn 不受影响

## 非目标

- 不支持 Bridge 侧（企业微信/飞书等外部平台）的停止操作（后续扩展）
- 不支持取消 queue 中排队的 turn（仅取消当前正在执行的 turn）
- 不在本次做 scheduled task 的取消（`sendScheduled` 已有 `abortSignal`，独立路径）
- 不做 UI 上的"重试"功能（停止后用户手动重新发送）

---

## 设计详情

### 1. Adapter 层：cancelTurn 接口

#### AgentLiveSession 扩展

```typescript
// types.ts
export interface AgentLiveSession {
  // ... 现有方法 ...

  /**
   * 尝试优雅取消当前正在执行的 turn。
   * 返回 true 表示已发送 cancel 信号（不代表 turn 已结束）。
   * 默认实现：不支持 graceful cancel，直接返回 false。
   */
  cancelCurrentTurn?(): Promise<boolean>
}
```

#### 各 adapter 的 cancelTurn 实现

| Adapter | cancelCurrentTurn 行为 | 说明 |
|---------|----------------------|------|
| **ClaudeCodeLiveSession** | 暂不实现（返回 `false`）| Claude Code CLI 的 cancel 协议待验证。Graceful 阶段直接跳过，走 `close()` |
| **CodexAppServerLiveSession** | 发送 `turn/cancel` JSON-RPC | 如果 Codex app-server 支持该 RPC；否则返回 `false` |
| **Hermes** | N/A（one-shot 模式） | 只有 hard kill 路径 |
| **Codex exec** | N/A（one-shot 模式） | 只有 hard kill 路径 |

#### One-shot 模式的取消

对于 `execute()` 调用的 one-shot 模式，取消通过 `AbortSignal` 实现。

`AgentExecutionContext` 当前**没有** `abortSignal` 字段，需要新增：

```typescript
// types.ts
export interface AgentExecutionContext {
  // ... 现有字段 ...
  readonly abortSignal?: AbortSignal  // 新增
}
```

各 adapter 的 `execute()` 实现需要将 `context.abortSignal` 传入 `ControlledProcessRunner.run()` 的 `ControlledProcessRunRequest.abortSignal`。

```typescript
// message-router.ts — processExecTurn 中
const ac = new AbortController()
state.turnAbortController = ac

const execution = await adapter.execute(message, {
  ...context,
  abortSignal: ac.signal,
})
```

#### Live session 模式的取消

对于 `processLiveTurn` 路径，取消机制与 exec 不同：

- `processLiveTurn` 内部是一个 `while (liveSession.alive()) { nextEvent() }` 阻塞循环
- 调用 `liveSession.close()` 会导致 `alive()` 返回 false，`nextEvent()` 返回 null，循环自然退出
- 这是 hard kill 的实际机制
- Graceful cancel 通过 `liveSession.cancelCurrentTurn()` 信号通知 Agent，但**不关闭 session**，等 Agent 自己发出 `result` 或 `error` 事件退出循环

因此 live session 的 cancel 不依赖 `AbortController`，而是直接操作 `liveSession` 对象。`turnAbortController` 仅用于 exec 路径。但为了统一标记 cancel 状态，`cancelTurn` 仍会设置 `state.cancelState`。

### 2. RuntimeSessionState 扩展

```typescript
export interface RuntimeSessionState {
  // ... 现有字段 ...

  /** 当前 turn 的 AbortController。cancel 时调用 abort()。 */
  turnAbortController?: AbortController

  /** 当前 turn 的取消状态 */
  cancelState?: {
    /** graceful cancel 已发送的时间 */
    requestedAt: number
    /** hard kill 升级定时器 */
    escalationTimer?: ReturnType<typeof setTimeout>
  }
}
```

### 3. MessageRouter 变更

#### processQueue 中的 AbortController 注入

```typescript
private async processQueue(state: RuntimeSessionState): Promise<void> {
  state.busy = true
  try {
    while (state.queue.length > 0) {
      const turn = state.queue.shift()
      if (!turn) continue

      // 每个 turn 创建独立的 AbortController
      const ac = new AbortController()
      state.turnAbortController = ac

      try {
        const result = await this.processTurn(state, turn.message, turn.conversationId, ac.signal)
        turn.resolve(result)
      } catch (error) {
        if (ac.signal.aborted) {
          // turn 被用户取消
          turn.resolve(this.buildCancelledResult(turn.message, turn.conversationId, state))
        } else {
          const messageText = error instanceof Error ? error.message : String(error)
          turn.resolve(this.finishWithError(turn.message, turn.conversationId, messageText))
        }
      } finally {
        state.turnAbortController = undefined
        this.clearCancelState(state)
      }
    }
  } finally {
    state.busy = false
  }
}
```

#### processTurn 中的 abortSignal 传播

- **Live session 路径** (`processLiveTurn`): `abortSignal` 用于监听取消，触发时调用 `liveSession.cancelCurrentTurn()` 或 `liveSession.close()`
- **Exec 路径** (`processExecTurn`): `abortSignal` 直接传入 `AgentExecutionContext`，传到 `ControlledProcessRunner.run()`

#### buildCancelledResult

```typescript
private buildCancelledResult(
  message: AgentMessage,
  conversationId: string,
): AgentRuntimeTurnResult {
  const cancelEvent: AgentEvent = {
    type: "result",
    content: "",
    done: true,
    metadata: { cancelled: true },  // 需要扩展 AgentResultMetadata
  }
  this.emitEvent(message, conversationId, cancelEvent)

  return {
    conversationId,
    events: [cancelEvent],
    resultText: "",
    error: "cancelled",
  }
}
```

注意：`AgentResultMetadata` 需要扩展：

```typescript
// types.ts
export interface AgentResultMetadata {
  readonly model?: string
  readonly effort?: string
  readonly contextRemainingPercent?: number
  readonly workDir?: string
  readonly cancelled?: boolean  // 新增
}
```

### 4. AgentRuntimeService 新增 cancelTurn

```typescript
// agent-runtime-service.ts

async cancelTurn(conversationId: string): Promise<CancelTurnResult> {
  const state = this.states.get(conversationId)
  if (!state || !state.busy) {
    return { status: "no-active-turn" }
  }

  // 幂等：如果已经在 cancel 中，直接返回当前状态
  if (state.cancelState) {
    return { status: state.cancelState.escalationTimer ? "graceful-pending" : "hard-killed" }
  }

  state.cancelState = { requestedAt: Date.now() }
  const liveSession = state.liveSession

  // ── Live session 路径 ──
  if (liveSession) {
    let gracefulSent = false
    if (liveSession.cancelCurrentTurn) {
      try {
        gracefulSent = await liveSession.cancelCurrentTurn()
      } catch {
        gracefulSent = false
      }
    }

    if (!gracefulSent) {
      // adapter 不支持 graceful cancel → 直接 hard kill
      await liveSession.close()       // close() → SIGTERM → alive()=false → loop exits
      state.liveSession = undefined
      return { status: "hard-killed" }
    }

    // graceful cancel 已发送，设 5s 升级定时器
    state.cancelState.escalationTimer = setTimeout(() => {
      this.emitCancelEscalation(conversationId)
    }, 5000)
    return { status: "graceful-pending" }
  }

  // ── Exec (one-shot) 路径 ──
  if (state.turnAbortController) {
    state.turnAbortController.abort("user-cancel")  // → SIGTERM via ControlledProcessRunner
    return { status: "hard-killed" }
  }

  return { status: "no-active-turn" }
}

async forceKillTurn(conversationId: string): Promise<CancelTurnResult> {
  const state = this.states.get(conversationId)
  if (!state || !state.busy) {
    return { status: "no-active-turn" }
  }

  this.clearCancelState(state)

  // 两个路径都尝试：exec 的 abort + live session 的 close
  state.turnAbortController?.abort("force-kill")
  if (state.liveSession) {
    await state.liveSession.close()
    state.liveSession = undefined
  }

  return { status: "hard-killed" }
}
```

#### CancelTurnResult 类型

```typescript
export type CancelTurnResult = {
  readonly status: "no-active-turn" | "graceful-pending" | "hard-killed"
}
```

### 5. IPC 层

#### 新增 IPC channels

```typescript
// ipc-messages.ts 中新增

const cancelTurnRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
})

const cancelTurnResultSchema = z.object({
  status: z.enum(["no-active-turn", "graceful-pending", "hard-killed"]),
})

// 在 messageMethods 中新增：
cancelTurn: {
  kind: "invoke",
  channel: "synapse:agent:cancel-turn",
  request: cancelTurnRequestSchema,
  response: cancelTurnResultSchema,
  handler: async (ctx, request) => {
    const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
    return agent.cancelTurn(request.conversationId)
  },
},
forceKillTurn: {
  kind: "invoke",
  channel: "synapse:agent:force-kill-turn",
  request: cancelTurnRequestSchema,
  response: cancelTurnResultSchema,
  handler: async (ctx, request) => {
    const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
    return agent.forceKillTurn(request.conversationId)
  },
},
```

#### 新增 Domain Event

为通知 UI "可以升级为强制停止"，复用现有 `phase.update` 事件机制：

```typescript
// 新增 phase value
export type SynapseAgentPhaseValue =
  | "submitted" | "received" | "runtime_starting" | "runtime_ready"
  | "request_submitted" | "awaiting_first_token" | "streaming"
  | "completed" | "failed"
  | "cancel_pending"    // 新增：graceful cancel 已发送
  | "cancelled"         // 新增：turn 已取消
```

### 6. Renderer 侧

#### Preload API

```typescript
// bridge types 中新增
interface SynapseAgentBridge {
  // ... 现有方法 ...
  cancelTurn(params: { projectId: string; conversationId: string }): Promise<CancelTurnResult>
  forceKillTurn(params: { projectId: string; conversationId: string }): Promise<CancelTurnResult>
}
```

#### useChatReducer 变更

```typescript
// 新增状态
type CancelPhase = "none" | "graceful-pending" | "force-available"

// ChatState 新增：
cancelPhase: Map<string, CancelPhase>  // key = conversationId
```

新增 action types：
- `CANCEL_TURN_REQUESTED` — 用户点击停止，进入 `graceful-pending`
- `CANCEL_ESCALATION_AVAILABLE` — 5s 后 phase.update 通知可升级
- `CANCEL_COMPLETED` — turn 实际结束，重置为 `none`

#### useChatConnection 新增方法

```typescript
const cancelTurn = useCallback(async () => {
  const conversationId = selectedConversationIdRef.current
  if (!conversationId) return

  const bridge = requireSynapseBridge()
  dispatch({ type: "CANCEL_TURN_REQUESTED", conversationId })

  const result = await bridge.agent.cancelTurn({
    projectId: getDefaultProjectId(),
    conversationId,
  })

  if (result.status === "hard-killed") {
    dispatch({ type: "CANCEL_COMPLETED", conversationId })
  }
  // graceful-pending: 等待 phase.update 事件
}, [dispatch, getDefaultProjectId, selectedConversationIdRef])

const forceKillTurn = useCallback(async () => {
  const conversationId = selectedConversationIdRef.current
  if (!conversationId) return

  const bridge = requireSynapseBridge()
  await bridge.agent.forceKillTurn({
    projectId: getDefaultProjectId(),
    conversationId,
  })
  dispatch({ type: "CANCEL_COMPLETED", conversationId })
}, [dispatch, getDefaultProjectId, selectedConversationIdRef])
```

#### UI 行为

Agent 输入框区域的按钮状态机：

```
[正常状态]
  输入框 + 发送按钮

[Agent 执行中] (sendingConversationIds.has(id))
  输入框 disabled + 停止按钮 (■ 方块图标)
  点击 → cancelTurn()

[Graceful 等待中] (cancelPhase === "graceful-pending")
  输入框 disabled + 停止按钮 (spinner + "停止中...")
  不可再次点击，等待 5s 或 turn 结束

[可强制停止] (cancelPhase === "force-available")
  输入框 disabled + 强制停止按钮 (红色 ■ + "强制停止")
  点击 → forceKillTurn()

[Turn 结束] (sendingConversationIds 移除 + cancelPhase → "none")
  回到正常状态
```

---

## 各 Agent 后端的完整行为矩阵

| 后端 | 执行模式 | Graceful Cancel | Hard Kill | 进程存活 |
|------|---------|-----------------|-----------|---------|
| Claude Code | live session | 暂不支持（直接 hard kill） | `processSession.close()` → SIGTERM | ❌ 需重启 |
| Codex exec | one-shot | N/A | `abortSignal.abort()` → SIGTERM | N/A |
| Codex app-server | live session | `turn/cancel` RPC（如支持） | `processSession.close()` → SIGTERM | 取决于 cancel 是否成功 |
| Hermes | one-shot | N/A | `abortSignal.abort()` → SIGTERM | N/A |

**注意**：Claude Code 的 graceful cancel 在 Phase 1 中不实现。所有不支持 graceful cancel 的 adapter，用户点击"停止"后直接执行 hard kill，UI 不会进入"强制停止"状态。只有当 adapter 的 `cancelCurrentTurn()` 返回 `true` 时，才会出现 5 秒等待和强制停止升级按钮。

---

## 信号流时序图

### Case 1a: Live session 不支持 graceful cancel（Claude Code）

```
User         Renderer          IPC           AgentRuntimeService       LiveSession
 │              │                │                   │                      │
 │ click stop   │                │                   │                      │
 │─────────────>│                │                   │                      │
 │              │ cancelTurn()   │                   │                      │
 │              │───────────────>│                   │                      │
 │              │                │ cancelTurn(convId) │                      │
 │              │                │──────────────────>│                      │
 │              │                │                   │ cancelCurrentTurn?()  │
 │              │                │                   │ → false / undefined   │
 │              │                │                   │                      │
 │              │                │                   │ liveSession.close()   │
 │              │                │                   │─────────────────────>│ SIGTERM
 │              │                │                   │ state.liveSession=nil │
 │              │                │                   │                      │
 │              │                │                   │ processLiveTurn loop  │
 │              │                │                   │ alive()→false, exits  │
 │              │                │                   │                      │
 │              │                │ { hard-killed }   │                      │
 │              │<───────────────│<──────────────────│                      │
 │              │                │                   │                      │
 │              │ emit "cancelled" result event      │                      │
 │              │<──────────────────────────────────-│                      │
 │ UI reset     │                │                   │                      │
 │<─────────────│                │                   │                      │
```

### Case 1b: Exec mode（Hermes / Codex exec）

```
User         Renderer          IPC           AgentRuntimeService       ControlledProcess
 │              │                │                   │                      │
 │ click stop   │                │                   │                      │
 │─────────────>│                │                   │                      │
 │              │ cancelTurn()   │                   │                      │
 │              │───────────────>│                   │                      │
 │              │                │ cancelTurn(convId) │                      │
 │              │                │──────────────────>│                      │
 │              │                │                   │ turnAbortController   │
 │              │                │                   │   .abort()            │
 │              │                │                   │─────────────────────>│ SIGTERM
 │              │                │                   │                      │
 │              │                │                   │ execute() rejects     │
 │              │                │                   │ processQueue catches  │
 │              │                │                   │                      │
 │              │                │ { hard-killed }   │                      │
 │              │<───────────────│<──────────────────│                      │
 │              │                │                   │                      │
 │ UI reset     │                │                   │                      │
 │<─────────────│                │                   │                      │
```

### Case 2: Adapter 支持 graceful cancel（Codex app-server）

```
User         Renderer          IPC           AgentRuntimeService       Adapter
 │              │                │                   │                    │
 │ click stop   │                │                   │                    │
 │─────────────>│                │                   │                    │
 │              │ cancelTurn()   │                   │                    │
 │              │───────────────>│                   │                    │
 │              │                │ cancelTurn(convId) │                    │
 │              │                │──────────────────>│                    │
 │              │                │                   │ cancelCurrentTurn() │
 │              │                │                   │───────────────────>│ turn/cancel RPC
 │              │                │                   │ → true             │
 │              │                │                   │                    │
 │              │                │ { graceful-pending }                   │
 │              │<───────────────│<──────────────────│                    │
 │              │                │                   │                    │
 │ UI: "停止中" │                │               [5s timer starts]       │
 │<─────────────│                │                   │                    │
 │              │                │                   │                    │
 ╔══════════════╗                                    │                    │
 ║ Path A:      ║                                    │                    │
 ║ Agent stops  ║                                    │                    │
 ║ within 5s    ║                                    │                    │
 ╚══════════════╝                                    │                    │
 │              │                │                   │ turn completes     │
 │              │ emit "cancelled" phase event       │<───────────────────│
 │              │<──────────────────────────────────-│                    │
 │ UI reset     │                │                   │                    │
 │<─────────────│                │                   │                    │
 │              │                │                   │                    │
 ╔══════════════╗                                    │                    │
 ║ Path B:      ║                                    │                    │
 ║ 5s timeout   ║                                    │                    │
 ╚══════════════╝                                    │                    │
 │              │                │              [timer fires]             │
 │              │ emit "cancel_pending" escalation   │                    │
 │              │<──────────────────────────────────-│                    │
 │ UI: "强制停止"│               │                   │                    │
 │<─────────────│                │                   │                    │
 │              │                │                   │                    │
 │ click force  │                │                   │                    │
 │─────────────>│                │                   │                    │
 │              │ forceKillTurn()│                   │                    │
 │              │───────────────>│                   │                    │
 │              │                │ forceKill(convId)  │                    │
 │              │                │──────────────────>│                    │
 │              │                │                   │ close() → SIGTERM  │
 │              │                │                   │───────────────────>│
 │              │                │ { hard-killed }   │                    │
 │              │<───────────────│<──────────────────│                    │
 │ UI reset     │                │                   │                    │
 │<─────────────│                │                   │                    │
```

---

## History 记录格式

取消后写入 conversation history 的内容：

1. **用户消息**：已经在 turn 开始时写入（`appendHistory(conversation.id, "user", message.content)`）
2. **部分输出**：已 emit 的 text/thinking/toolUse/toolResult events 的累积文本，作为 `assistant` 角色追加
3. **取消标记**：追加一条 `result` event，`metadata.cancelled = true`

```typescript
// 取消时的 history 写入
await repository.appendHistory(conversationId, "assistant", partialText + "\n\n[已停止]")
```

---

## 文件变更清单

### Main process（Electron）

| 文件 | 变更 |
|------|------|
| `desktop/electron/services/agent-runtime/types.ts` | `AgentLiveSession` 新增 `cancelCurrentTurn?()` 可选方法；新增 `CancelTurnResult` 类型；`AgentExecutionContext` 新增 `abortSignal?: AbortSignal`；`AgentResultMetadata` 新增 `cancelled?: boolean` |
| `desktop/electron/services/agent-runtime/session-lifecycle.ts` | `RuntimeSessionState` 新增 `turnAbortController` 和 `cancelState` 字段 |
| `desktop/electron/services/agent-runtime/agent-runtime-service.ts` | 新增 `cancelTurn()` 和 `forceKillTurn()` 方法 |
| `desktop/electron/services/agent-runtime/message-router.ts` | `processQueue` 注入 `AbortController`；`processTurn` / `processLiveTurn` / `processExecTurn` 传播 `abortSignal`；新增 `buildCancelledResult()` |
| `desktop/electron/services/agent-runtime/adapters/codex-app-server-session.ts` | 实现 `cancelCurrentTurn()`（如果 Codex 支持 `turn/cancel`） |
| `desktop/electron/modules/agent/ipc-messages.ts` | 新增 `cancelTurn` 和 `forceKillTurn` IPC method descriptors |

### Renderer

| 文件 | 变更 |
|------|------|
| `desktop/src/types/agent.ts` | `SynapseAgentPhaseValue` 新增 `cancel_pending` / `cancelled` |
| `desktop/src/types/bridge.ts` | agent bridge 接口新增 `cancelTurn()` / `forceKillTurn()` |
| `desktop/src/modules/agent/hooks/use-chat-reducer.ts` | 新增 `cancelPhase` 状态和相关 actions |
| `desktop/src/modules/agent/hooks/use-chat-connection.ts` | 新增 `cancelTurn()` 和 `forceKillTurn()` 方法 |
| `desktop/src/modules/agent/hooks/use-chat-events.ts` | 处理 `cancel_pending` / `cancelled` phase events |
| `desktop/src/modules/agent/index.tsx` | 发送区域按钮增加停止/强制停止状态切换 |

### Preload

| 文件 | 变更 |
|------|------|
| `desktop/electron/preload.ts` | 注册 `cancelTurn` / `forceKillTurn` IPC invoke |

---

## 边界条件

1. **用户在 Agent 未开始输出时点击停止**：`state.busy = true` 但可能还在 adapter 启动中。`abort()` 仍然生效，adapter 的 `startSession()` / `execute()` 应该检查 `abortSignal`。
2. **用户快速连续点击停止**：`cancelTurn()` 幂等，第二次调用发现 `cancelState` 已存在则直接返回当前状态。
3. **Agent 在 graceful 期间自然结束**：`escalationTimer` 在 `finally` 中清理，UI 正常 reset。
4. **进程意外退出**：`ControlledProcessSession` 的 `alive()` 检测到进程退出，turn 自然结束。
5. **Permission pending 状态下停止**：如果 Agent 正在等待权限批准（`state.pending` 存在），取消应该同时清除 pending permission 并调用 `pending.resolve()` 释放 `awaitPendingPermission` 中的 Promise。`processLiveTurn` 循环继续执行，然后被 `close()` 中断。
6. **Queue 中有排队 turn**：cancel 只影响当前 turn。当前 turn 结束后 `processQueue` 继续处理下一个。

---

## 测试要点

1. **Unit: cancelTurn 对无 active turn 返回 `no-active-turn`**
2. **Unit: cancelTurn 对不支持 graceful 的 adapter 直接 hard kill**
3. **Unit: cancelTurn 对支持 graceful 的 adapter 返回 `graceful-pending`**
4. **Unit: 5s 后 forceKillTurn 终止进程**
5. **Unit: cancel 后 queue 中的下一个 turn 正常执行**
6. **Unit: cancel 后 history 包含部分输出 + 取消标记**
7. **Unit: 幂等性 — 连续调用 cancelTurn 不崩溃**
8. **Integration: 从 IPC 调用到进程终止的完整链路**
9. **Integration: UI 状态机转换（sending → cancel-pending → force-available → normal）**
