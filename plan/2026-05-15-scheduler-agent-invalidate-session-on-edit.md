# 定时任务修改后作废 Agent 复用会话

> 日期：2026-05-15  状态：头脑风暴

## 1. 需求概述

当用户修改了一个 Agent 类型的定时任务后，即使会话策略设为 `resume`（复用上次），
下一次执行（无论自动触发/手动触发/补跑）都应该**强制新建会话**，不再复用上次的 conversationId。

原因：任务配置变了（供应商、模型、prompt、权限模式等），旧会话上下文已不匹配，复用会产生语义错乱或安全隐患。

## 2. 现有数据流

### 2.1 会话复用链路

```
ExecutionService.runTask(task)
  -> getLastSuccessOutputs(task.id)           // 从 run history 取最近成功 run 的 outputs
  -> action.execute({ config, context, previousOutputs })

AgentAction.execute(input)
  -> lastConversationId = previousOutputs?.conversationId
  -> runtime.sendScheduled({ sessionPolicy, lastConversationId, ... })

AgentRuntimeService.sendScheduled(input)
  -> if (sessionPolicy === "fresh" || !lastConversationId)
       sendNewSession()
     else
       sendToConversation(lastConversationId)   // 复用
```

### 2.2 更新入口

1. **Renderer UI** — TaskFormDialog -> IPC updateTask -> schedulerTaskUpdate(id, patch)
   - patch 包含完整 action（含 config），所有字段可改
2. **MCP/外部** — scheduler.task.update -> external-capabilities.ts
   - 当前禁止修改 action，只允许 name/description/cwd/schedule/missedRunPolicy

### 2.3 关键观察

- `previousOutputs` 来自 `getLastSuccessOutputs()`，取最近一次 status=success 的 run 的 `result.outputs`
- executor 将 `conversationId` 存入 outputs，下次再取出来
- **当前没有任何机制检测 task 修改后是否应该作废 previousOutputs**

## 3. 方案选型

### 方案 A：configVersion 计数器（推荐）

每次 task 被修改时递增 `configVersion`。执行时将 configVersion 写入 run outputs。
下次执行时比较 task.configVersion 与 previousOutputs.configVersion，不匹配则强制 fresh。

优势：
- 不依赖时间戳，无时钟漂移问题
- 任何字段修改都能捕获
- 语义清晰：版本不同 = 配置已变
- 对未来扩展友好（其他 action type 也可利用）

劣势：
- 需要给 ScheduledTaskEntry 加字段
- 需要透传 configVersion 到 executor

### 方案 B：用 updatedAt 与上次成功 run 的 startedAt 比较

优势：不需要新字段

劣势：
- updatedAt 在 markRunResult/markScheduled 中也会更新，非用户修改也会误触发
- 时间戳边界问题

### 方案 C：增加 lastEditedAt 专用时间戳

优势：不被系统操作污染

劣势：仍是时间戳比较，需严格区分用户修改和系统操作

### 方案 D：action.config 的 hash 比较

优势：精确到 config 内容级别

劣势：
- JSON 序列化稳定性问题
- 只关注 config，忽略 schedule/cwd 变更

## 4. 推荐方案 A 详细设计

### 4.1 核心改动

**Step 1: ScheduledTaskEntry 加字段**

在 `ScheduledTaskEntryV2` 中增加 `configVersion: number`（默认 0，向后兼容）。

**Step 2: TaskRepository.update() 自动递增**

每次 `update()` 调用时 `configVersion = existing.configVersion + 1`。
注意：`markRunResult()` 和 `markScheduled()` 不递增——这些是系统操作。

**Step 3: ExecutionService 透传 configVersion**

`getLastSuccessOutputs()` 已返回 `previousOutputs`。
在 `runTask()` 中同时将 `task.configVersion` 注入到 `context` 或直接传入 `execute()`。

**Step 4: AgentAction executor 比较版本**

```typescript
// executor.main.ts
const lastConfigVersion = typeof input.previousOutputs?.configVersion === "number"
  ? input.previousOutputs.configVersion
  : undefined

const configChanged = lastConfigVersion !== undefined
  && lastConfigVersion !== task.configVersion

const effectiveLastConversationId =
  (configChanged || input.config.sessionPolicy === "fresh")
    ? undefined
    : lastConversationId
```

**Step 5: executor 输出中写入 configVersion**

```typescript
return {
  status,
  outputs: {
    conversationId: result.conversationId,
    configVersion: task.configVersion,   // 新增
  },
}
```

### 4.2 透传方式

configVersion 需要从 task 到达 executor。两种路径：

1. **通过 ActionExecutionInput.context 扩展**：在 context 中加 `configVersion`
2. **通过 previousOutputs 间接传递**：在 ExecutionService 中注入 task.configVersion 到 previousOutputs

推荐路径 1，因为 configVersion 是 task 级别元数据，不是上次执行的"输出"。

```typescript
// execution-service.ts runTask()
const context = {
  taskId: task.id,
  runId: run.id,
  triggeredBy,
  cwd: resolveCwd(task, this.deps.defaultCwd),
  actor: { ... },
  abortSignal: controller.signal,
  configVersion: task.configVersion ?? 0,    // 新增
}
```

## 5. 边界情况分析

### 5.1 旧任务没有 configVersion 字段

已有任务的 configVersion 为 undefined。处理：
- 读取时 `task.configVersion ?? 0`
- 上次成功 run 的 outputs 没有 configVersion 时视为 undefined
- **当 task.configVersion === 0 且 previousOutputs.configVersion === undefined 时，不强制 fresh**
- 这保证了升级后旧任务第一次执行不会无故丢失会话

### 5.2 用户修改后还没执行就又修改了

configVersion 递增多次，没问题。下次执行时 task.configVersion > previousOutputs.configVersion，强制 fresh。

### 5.3 用户打开编辑对话框但没改任何内容就保存了

UI 的 `buildTaskUpdateInput()` 会把所有表单字段打包发送，不区分是否真的改了。
这种情况 `TaskRepository.update()` 仍然会递增 configVersion。

**是否有问题？** 这是个权衡：
- 保守策略（推荐）：即使没改内容也递增。宁可多新建一次会话，不冒复用错误会话的风险。
- 精确策略：deep-equal 比较 old config vs new config。复杂度高，收益低。

结论：保守策略更安全，且用户体验影响极小（多建一次会话而已）。

### 5.4 非 Agent 类型任务修改

configVersion 照样递增，但非 Agent 类型的 executor 不关心这个字段，不影响。

### 5.5 sessionPolicy 本身就是 "fresh" 的任务

configVersion 即使变了也不影响——sessionPolicy=fresh 时本来就每次新建。无副作用。

### 5.6 任务正在运行时被修改

TaskRepository.update() 递增 configVersion。
当前运行的 run 使用的是旧 configVersion 的配置，run 完成后 outputs 中写入旧 configVersion。
**下次执行时** task.configVersion > outputs.configVersion，强制 fresh。符合预期。

### 5.7 MCP 路径修改 schedule/name 等非 action 字段

MCP 修改也经过 `schedulerTaskUpdate()` -> `TaskRepository.update()`，configVersion 也会递增。
这意味着仅改名/改计划也会作废会话。

**是否合理？** 偏保守但可接受。如果需要精确区分，可以在 update() 中判断 patch 是否包含 action：
- 如果只含 name/description/schedule/missedRunPolicy 且不含 action，configVersion 不递增
- 如果含 action，递增

推荐第一版用保守策略（总是递增），后续根据反馈再细化。

### 5.8 任务导入

从文件导入的任务通过 `schedulerTaskCreate()`，configVersion 从 0 开始。
没有上次执行记录，不会复用，无问题。

### 5.9 setTaskEnabled() 切换启停

`setTaskEnabled()` 调用 `TaskRepository.update()`（通过 `setEnabled()` -> `update()`）。
这也会递增 configVersion。

**是否合理？** 启用/停用不应该作废会话。需要特殊处理：

- 方案一：`setEnabled()` 使用独立方法而非调用 `update()`
- 方案二：`update()` 增加参数控制是否递增 configVersion
- 方案三（推荐）：在 `update()` 中检查 patch 是否只含 `enabled`，如果是则不递增

查看代码：`setEnabled()` 调用 `this.update(id, { enabled })`。
最简单的处理：**让 setEnabled 不再调用 update，改为独立实现**，避免递增 configVersion。

### 5.10 markScheduled() 和 markRunResult()

这两个方法不经过 `update()`，有独立实现。不会递增 configVersion。安全。

## 6. 实现步骤

### Step 1: ScheduledTaskEntry 加 configVersion

文件：`desktop/electron/services/task-scheduler/types.ts`

```typescript
export interface ScheduledTaskEntryV2 {
  // ... existing fields ...
  readonly configVersion: number
}
```

### Step 2: TaskRepository 递增逻辑

文件：`desktop/electron/services/task-scheduler/task-repository.ts`

- `create()`: 设置 `configVersion: 0`
- `update()`: `configVersion: existing.configVersion + 1`（但需要排除纯 enabled 变更）
- `setEnabled()`: 改为独立实现，不递增 configVersion

### Step 3: ActionRuntimeContext 扩展

文件：`desktop/electron/action-runtime/action-registry.ts`

```typescript
export type ActionRuntimeContext = {
  // ... existing fields ...
  readonly configVersion?: number
}
```

### Step 4: ExecutionService 透传

文件：`desktop/electron/services/task-scheduler/execution-service.ts`

在 `runTask()` 中构建 context 时加入 `configVersion: task.configVersion ?? 0`。

### Step 5: Agent executor 比较 + 输出

文件：`desktop/action-packages/builtin/agent/executor.main.ts`

- 读取 context.configVersion 和 previousOutputs.configVersion
- 不匹配时将 lastConversationId 置为 undefined
- outputs 中写入 configVersion

### Step 6: 测试

- 单元测试 TaskRepository: update 递增 configVersion, setEnabled 不递增
- 单元测试 ExecutionService: configVersion 正确透传
- 单元测试 agent executor: configVersion 不匹配时强制 fresh
- 单元测试 agent executor: configVersion 匹配时正常 resume
- 单元测试 agent executor: 旧数据无 configVersion 时不影响

## 7. 影响范围

| 文件 | 改动类型 |
|---|---|
| types.ts (task-scheduler) | 加字段 |
| task-repository.ts | create/update/setEnabled 逻辑 |
| action-registry.ts | context 类型扩展 |
| execution-service.ts | 透传 configVersion |
| executor.main.ts (agent) | 比较逻辑 + outputs |
| 测试文件 x5 | 新增/修改 |

不涉及 renderer 改动、不涉及 IPC 接口变更、不涉及数据库 migration（configVersion 是 DataNamespace JSON，向后兼容）。
