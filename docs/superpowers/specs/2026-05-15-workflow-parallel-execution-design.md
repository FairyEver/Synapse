# Workflow 并行执行引擎设计

> 日期：2026-05-15
> 状态：待实现

## 背景

当前 `WorkflowEngine` 使用 Kahn 拓扑排序生成扁平执行序列，按顺序逐个 `await` 每个节点。如果多个节点之间互不依赖（例如 A 和 B 都是 C 的上游），它们仍然串行执行，浪费时间。

**目标**：节点的所有上游完成后立即启动，实现 DAG 的最大并行。

## 决策记录

| 问题 | 决定 |
|---|---|
| 错误策略 | **等全部完成再判断** — 某节点失败后不取消正在运行的节点，但不再启动新节点 |
| 并行范围 | **最大并行** — 节点上游全部完成即启动，不按层等待 |
| 架构风格 | **职责分离** — 新增 `ReactiveScheduler` 调度器，Engine 负责业务逻辑，Scheduler 负责执行编排 |

## 架构

### 职责分离

| 层 | 职责 | 文件 |
|---|---|---|
| `WorkflowEngine` | 协调器 — run 生命周期、事件 emit、结果收集、变量解析、abort 处理 | `workflow-engine.ts`（改造） |
| `ReactiveScheduler` | 调度器 — pending 计数、动态启动、错误策略、并发控制 | `workflow-scheduler.ts`（新增） |

Scheduler 对节点类型完全透明 — 它只看到 `NodeTask.execute()` 闭包和 DAG 拓扑。新节点类型注册到 `nodeTypeRegistry` 即可，Scheduler 无需变动。

### 接口定义

```typescript
// workflow-scheduler.ts

interface NodeExecOutcome {
  nodeId: string
  status: "success" | "failed"
  output?: string
  outputs?: Record<string, unknown>
  activeBranch?: string
  error?: string
  durationMs?: number
}

interface NodeTask {
  nodeId: string
  execute: () => Promise<NodeExecOutcome>
}

interface SchedulerOptions {
  /** 层内最大并发数，0 或 undefined = 无限制 */
  maxConcurrency?: number
}

interface SchedulerCallbacks {
  onNodeReady: (nodeId: string) => void
  onNodeDone: (outcome: NodeExecOutcome) => void
  resolveActivatedDownstream: (nodeId: string, outcome: NodeExecOutcome) => string[]
}

class ReactiveScheduler {
  constructor(options?: SchedulerOptions)

  async execute(
    nodes: string[],
    edges: Array<{ from: string; to: string }>,
    taskFactory: (nodeId: string) => NodeTask,
    callbacks: SchedulerCallbacks,
    abortSignal: AbortSignal,
  ): Promise<Map<string, NodeExecOutcome>>
}
```

## Scheduler 内部算法

### 状态

```typescript
pending: Map<string, number>           // nodeId → 未完成上游数
running: Map<string, Promise<void>>    // nodeId → 正在执行的 Promise
completed: Set<string>                 // 已成功完成的节点
failed: boolean                        // 是否有节点失败
results: Map<string, NodeExecOutcome>  // 所有结果
waitQueue: string[]                    // 并发上限时的排队区
```

### 执行流程

```
execute(nodes, edges, taskFactory, callbacks, abortSignal):

  1. 初始化 pending
     对每个 node: pending[node] = 该 node 的入边数量（仅计 nodes 集合内的边）

  2. 定义 tryStart(nodeId):
     if failed || aborted → return
     if maxConcurrency && running.size >= maxConcurrency:
       waitQueue.push(nodeId)
       return
     task = taskFactory(nodeId)
     callbacks.onNodeReady(nodeId)
     promise = task.execute().then(outcome => {
       callbacks.onNodeDone(outcome)
       results.set(nodeId, outcome)
       running.delete(nodeId)

       if outcome.status === "failed":
         failed = true
         drainWaitQueue()     // 排队节点全部标记 skipped
         return

       completed.add(nodeId)
       downstream = callbacks.resolveActivatedDownstream(nodeId, outcome)
       for next in downstream:
         pending[next]--
         if pending[next] === 0:
           tryStart(next)

       // 如果有排队节点且并发有余量，取出执行
       while waitQueue.length > 0 && running.size < maxConcurrency:
         tryStart(waitQueue.shift())
     })
     running.set(nodeId, promise)

  3. 启动所有根节点
     for node where pending[node] === 0:
       tryStart(node)

  4. 等待全部完成
     while running.size > 0:
       await Promise.race([...running.values()])

  5. 标记未执行的节点为 skipped
     for node not in results:
       results.set(node, { nodeId: node, status: "skipped" })

  6. return results
```

### 并发安全

JS 单线程保证了关键的安全性：

- 节点 A 的 `.then` 回调写入 `nodeOutputs[A]` → 调用 `tryStart(C)` → C 的 `taskFactory` 构建 task → C 的 `execute()` 读 `nodeOutputs`。这是在同一个 microtask 链中完成的，无竞态。
- `pending`、`running`、`failed` 的读写同理，都发生在回调中，不会被打断。

### Promise.race 等待循环

不是忙轮询。每次 `race` 精确等到下一个节点完成，该节点的 `.then` 回调在同一 microtask 中触发 `tryStart`，新 Promise 加入 `running`。下一轮 `race` 自然包含新启动的任务。

## Engine 侧改造

### run() 结构变化

```
run()
  ├─ 前置：abort 检查、reachability 剪枝（不变）
  ├─ 构建 taskFactory（从 for 循环体提取）
  ├─ 构建 callbacks（事件 emit + edge 激活）
  ├─ scheduler.execute(...)   ← 替换 for 循环
  └─ 后置：结果收集、end 节点检查（不变）
```

### taskFactory

将当前 `run()` 循环体 L137-L220 的逻辑封装为闭包。每个闭包负责：

1. 从 `nodeTypeRegistry` 获取 manifest 和 executor
2. 解析 config（`configSchema.parse`）
3. 变量解析（`resolveVariables`）— 读取共享 `nodeOutputs`
4. Prompt 插值（`interpolatePrompt`）
5. 调用 `executor.execute()`
6. 返回 `NodeExecOutcome`

### callbacks

```typescript
const callbacks: SchedulerCallbacks = {
  onNodeReady: (nodeId) => {
    emit({ type: "node:started", runId, nodeId, startedAt: Date.now() })
  },
  onNodeDone: (outcome) => {
    if (outcome.status === "success") {
      nodeOutputs[outcome.nodeId] = outcome.output
      emit({ type: "node:completed", runId, nodeId: outcome.nodeId, output: outcome.output })
    } else {
      emit({ type: "node:failed", runId, nodeId: outcome.nodeId, error: outcome.error })
    }
  },
  resolveActivatedDownstream: (nodeId, outcome) => {
    const activated: string[] = []
    for (const edge of def.edges.filter(e => e.from === nodeId)) {
      if (!outcome.activeBranch || edge.branch === outcome.activeBranch) {
        activated.push(edge.to)
        emit({ type: "edge:activated", runId, from: edge.from, to: edge.to })
      }
    }
    return activated
  },
}
```

## Switch 节点兼容

Switch 是关键特例 — 只激活一个分支。兼容通过 `resolveActivatedDownstream` 实现：

- Switch 节点完成时 `outcome.activeBranch` 有值
- `resolveActivatedDownstream` 只返回匹配分支的 edge.to
- 未激活分支的下游节点 pending 永远不会到 0，最终标记 skipped
- **Scheduler 无需知道 Switch 的存在**

### pending 初始化

pending 计数基于 Engine 传入的 edges（已排除不可达的孤立子图）。Switch 运行时的分支选择由 `resolveActivatedDownstream` 动态处理，不影响初始 pending。

## 错误处理

### 失败传播

1. 节点 B 执行失败 → `failed = true`
2. 不取消正在运行的其他节点（它们跑完自然返回）
3. 不再启动新节点（`tryStart` 入口检查 `failed` 标志）
4. 排队中的节点全部标记 skipped
5. 所有 running 清空后返回 → `overallFailed = true`

### Abort/Cancel

1. `abortSignal` 触发后 → `tryStart` 不再启动新节点
2. 已在运行的节点由各自的 executor 响应 abort（现有行为不变）
3. 所有 running 清空后返回 `cancelled` 状态

### 异常

节点 executor 抛异常时，`taskFactory` 闭包内 catch 并转为 `{ status: "failed", error: ... }`，与当前引擎的异常处理一致。

## 向后兼容

- 纯线性 workflow（A→B→C）：每层只有 1 个节点，行为等同串行
- `maxConcurrency = 1`：完全退化为串行，可作为降级开关
- 事件类型和 `WorkflowRunResult` 结构不变
- `NodeRunResult` 类型不变
- 现有测试用例应全部通过

## 测试矩阵

| 场景 | 验证点 |
|---|---|
| 线性链 A→B→C | 串行执行，行为与旧引擎一致 |
| 并行根 A,B→C | A、B 同时启动，C 等两者完成后启动 |
| 菱形 A→B, A→C, B→D, C→D | B、C 并行，D 等两者 |
| 不对称 A→C, A→D, B→C | A 完成后 D 立即启动，不等 B |
| 一个失败 A✓, B✗→C | C skipped，A 结果保留 |
| Switch 分支 | 仅激活分支下游执行，其余 skipped |
| 取消 | 不启新节点，running 跑完后返回 cancelled |
| maxConcurrency=1 | 退化为串行 |
| 孤立节点 | 不可达节点 skipped |
| 空 workflow | 立即返回 completed |
