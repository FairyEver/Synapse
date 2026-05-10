# Agent 对话「阶段可见」反馈 — 设计

- **状态**:Draft
- **作者**:liyang(via Cascade brainstorming session)
- **日期**:2026-05-10
- **目标模块**:`desktop/src/modules/agent/`、`desktop/electron/runtime/ipc/`、`desktop/electron/services/agent/`
- **关联现有 spec**:
  - `2026-04-28-agent-timeline-event-model-design.md`(timeline 事件模型基础)
  - `2025-05-08-agent-timeline-elegant-redesign.md`(视觉基线)
  - `2026-05-09-agent-timeline-smart-autoscroll-design.md`(滚动行为)

## 1. 问题陈述

用户从在 `desktop/src/modules/agent/components/agent-composer.tsx` 按下回车,到看到 Agent 的第一个 token,中间存在一段无信号的「空窗期」:

- 无法判断消息是否真的发出 / 主进程是否收到
- 无法判断 Agent runtime 是否正在启动 / 模型是否正在响应
- 长时间无 token 时,无法判断是 Agent 在思考、在跑工具、还是已经卡死

当前实现:
- `desktop/src/modules/agent/hooks/use-chat-connection.ts:372-409` `sendMessage()` 在乐观渲染 user 消息后,直接 `await bridge.agent.send(...)`,期间无任何阶段事件
- `desktop/src/modules/agent/components/agent-run-status.tsx:1-13` 视觉反馈仅是一个 `<Spinner />` + 「正在处理」label
- 真实的 token / 工具调用流通过 `bridge.agent.onEvent`(`use-chat-events.ts:40-148`)异步追加,但 spinner 与该流之间的真空期没有任何细粒度信号

## 2. 目标 / 非目标

### 目标

- 用户从按下回车开始,任何时刻都能看到 Agent 当前所处的生命周期阶段
- 阶段信息作为永久 timeline 条目保留(便于事后回看耗时分布,辅助调试)
- 活跃阶段实时显示已用时,无需用户刷新或操作
- 卡顿/失败时清晰归因到具体阶段,带 errorMessage

### 非目标(明确出本 spec)

- 不实现取消/停止按钮(下一个 spec)
- 不引入超时阈值的「卡住警告」或自动中止(用户选择「冷静档」)
- 不引入跨进程心跳推送(耗时由渲染层本地计时)
- 不重写工具调用的 timeline 表达(仅做视觉对齐)
- 不做 E2E 视觉回归

## 3. 阶段定义

完整覆盖 8 个生命周期阶段 + 1 个失败终态(共 9 种 phase 值):

| Phase | T 标号 | 来源 | 默认状态行为 |
|---|---|---|---|
| `submitted` | T1 | IPC handler emit(基于 `clientSubmittedAt` 输入) | 始终以 `done` emit,展示渲染层→IPC 的耗时 |
| `received` | T2 | IPC handler entry | `done`(瞬时) |
| `runtime_starting` | T3 | Agent runtime spawn 入口 | `in-progress` → `done`(when CLI ready) |
| `runtime_ready` | T4 | CLI ready hook | 用作 `runtime_starting` 的关闭信号,不单独占行 |
| `request_submitted` | T5 | runtime 提交 prompt 后 | `in-progress` → `done`(when first request acked) |
| `awaiting_first_token` | T6 | request 已上送,等首 token | `in-progress` → `done`(when first token arrives) |
| `streaming` | T7 | first token | `in-progress` → `done`(when stream end) |
| `completed` | T9-OK | runtime 收尾 | 用作 `streaming` 的关闭信号,不单独占行 |
| `failed` | T9-ERR | 任意 runtime 错误路径 / IPC 兜底 | 终态行,带 `errorMessage` |

T8(工具调用)沿用既有 `kind: "toolCall"` / `"toolResult"` timeline item,不进入 phase 事件。

## 4. 设计原则

1. **关键状态由后端权威生成**:`runId`、所有阶段的 `startedAt` / `completedAt`、状态转换均由主进程或 Agent runtime emit,渲染层不创造关键状态
2. **渲染层只提供观测输入数据**:`clientSubmittedAt` 作为 `bridge.agent.send` 的输入字段,后端裁决并 clamp 后用于 `submitted` phase 的 startedAt
3. **不引入跨进程心跳**:活跃 phase 的耗时由渲染层 `setInterval(1000)` 自驱;后端不为「显示活着」推送任何事件
4. **reducer 自愈优于事件严格契约**:漏发 close 事件时,渲染层 reducer 自动闭合前序 in-progress phase,避免 UI 卡死
5. **遵守项目硬约束(AGENTS.md Phase 0)**:事件经 `EventBus + WindowBroadcaster`,不裸用 `webContents.send`;渲染层只用 `window.synapse.agent.onEvent`

## 5. 架构

### 5.1 数据契约

新增领域事件类型(纳入 `SynapseAgentDomainEvent` 联合):

```ts
type AgentPhaseUpdateEvent = {
  type: "agent.phase.update"
  payload: {
    runId: string
    projectId: string
    sessionKey: string
    conversationId: string
    phase:
      | "submitted" | "received"
      | "runtime_starting" | "runtime_ready"
      | "request_submitted" | "awaiting_first_token" | "streaming"
      | "completed" | "failed"
    status: "in-progress" | "done" | "failed"
    startedAt: string         // ISO 8601
    completedAt?: string      // ISO 8601;status 为 done/failed 时存在
    detail?: {
      errorMessage?: string
    }
  }
  timestamp: string
}
```

`bridge.agent.send` schema 增加可选输入字段:

```ts
{
  projectId: string
  sessionKey: string
  content: string
  clientSubmittedAt?: string   // ISO 8601;渲染层观测的发送 wall-clock
}
```

### 5.2 Timeline item 扩展

`@/Users/liyang/Documents/code/github/Synapse/desktop/src/types/agent.ts:131-138` 联合追加 `SynapseAgentPhaseTimelineItem`:

```ts
export type SynapseAgentTimelineKind =
  | "message" | "thinking" | "toolCall" | "toolResult"
  | "permissionRequest" | "error" | "result"
  | "phase"

export interface SynapseAgentPhaseTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "phase"
  readonly runId: string
  readonly phase: AgentPhase
  readonly status: "in-progress" | "done" | "failed"
  readonly startedAt: string
  readonly completedAt?: string
  readonly errorMessage?: string
}
```

### 5.3 三层职责

| 层 | 责任 | 文件位置(预计) |
|---|---|---|
| **Renderer** | 在 `sendMessage` 时生成 `clientSubmittedAt` 并随 `bridge.agent.send` 上送;订阅 `agent.phase.update` 并 reduce 进 timeline;给活跃 phase 项跑 1s 计时器 | `desktop/src/modules/agent/hooks/use-chat-connection.ts`、`use-chat-events.ts`、新增 `utils/phase-reducer.ts` 与 `hooks/use-active-phase-ticker.ts` |
| **Main IPC** | `agent.send` handler 入口生成 `runId`,emit `submitted(done)` + `received(in-progress)`;handler 出口 / 异常路径兜底 emit `failed` | `desktop/electron/runtime/ipc/agent.*.ts`(经 EventBus + WindowBroadcaster) |
| **Agent runtime** | 在 spawn / CLI ready / 提交 prompt / 首 token / 收尾这些边界点 emit 对应 phase 事件 | `desktop/electron/services/agent/*` |

### 5.4 端到端时序(成功路径)

```
[Renderer] click send
   │ 1. capture clientSubmittedAt = new Date().toISOString()
   │ 2. dispatch UPDATE_TIMELINE: append user msg
   │ 3. bridge.agent.send({ ..., clientSubmittedAt })
   │
   ▼
[Main IPC handler]
   │ runId = nanoid()
   │ t_recv = Date.now()
   │ emit phase[runId, submitted, done,
   │            startedAt=clamp(clientSubmittedAt, t_recv),
   │            completedAt=t_recv]
   │ emit phase[runId, received, in-progress, startedAt=t_recv]
   │ → forward to runtime with runId
   │
   ▼
[Agent runtime]
   │ emit phase[runId, runtime_starting, in-progress]
   │ ... CLI ready ...
   │ emit phase[runId, runtime_ready, done]   // closes runtime_starting
   │ ... prompt submitted ...
   │ emit phase[runId, request_submitted, in-progress]
   │ ... first request acked ...
   │ emit phase[runId, awaiting_first_token, in-progress]   // implicit close of request_submitted via reducer
   │ ... first token ...
   │ emit phase[runId, streaming, in-progress]   // implicit close of awaiting_first_token
   │ ... existing token / toolCall events flow as today ...
   │ emit phase[runId, completed, done]   // closes streaming
```

### 5.5 reducer 自愈规则

按事件类型分支处理。`runtime_ready` 与 `completed` 是**别名 phase**,本身不直接占 timeline 行,而是作为前序 phase 的关闭信号。

```
on (runId, P=runtime_ready, status=S):                  # 别名:关闭 runtime_starting
  find (runId, runtime_starting, in-progress)
  if found: mutate -> status=S, completedAt, errorMessage
  do NOT append a row for runtime_ready

on (runId, P=completed, status=S):                      # 别名:run 成功终结
  for each in-progress phase on same runId:
    mutate -> status=S (传播 done), completedAt
  do NOT append a row for completed
  # 注:本 phase 仅在成功路径 emit;失败路径走 phase=failed

on (runId, P=failed, status=failed, errorMessage):       # 失败终结
  for each in-progress phase on same runId:
    mutate -> status=failed, completedAt, errorMessage
  append phase=failed item (终态行,errorMessage 上行可见)

on (runId, P, status=in-progress) for normal P:
  for each other in-progress on same runId:
    mutate -> status=done, completedAt = event.timestamp     # 隐式关闭前序
  append new in-progress item

on (runId, P, status=done|failed) for normal P:
  find (runId, P, in-progress)
  if found: mutate -> status, completedAt, errorMessage
  else: append closed item + logger.warn("phase done without prior in-progress")

duplicate (runId, P, in-progress) when item already in-progress: no-op (idempotent)
cross-runId: no interaction
```

`failed` phase 始终以 `status=failed` emit,语义上是"run 的失败终态"。`failed` 与具体失败 phase(例如 `runtime_starting` status=failed)的关系:具体 phase 携带 errorMessage 反映**哪一步失败**,`failed` 终态行作为 run-level 的关闭锚点(也复述 errorMessage),`sending` 状态据此结束。

### 5.6 时钟偏差处理

主进程 IPC handler 收到 `clientSubmittedAt` 后:
- `delta = t_recv - clientSubmittedAt`
- `delta < 0`(渲染层超前):clamp 到 `t_recv`,日志 info
- `delta > 60_000ms`(渲染层落后过多):fallback 到 `t_recv`,日志 warn
- 否则采纳

确保 `submitted` phase 的耗时始终 ≥ 0 且语义合理。

### 5.7 持久化

`SynapseAgentPhaseTimelineItem` 通过既有 timeline 存储路径(`bridge.agent.getTimeline`)与其他 timeline 项同等持久化。历史会话重新打开后,所有 phase 行(成功 / 失败 / 耗时)都能复现。

## 6. 视觉规格

### 6.1 `agent-phase-row.tsx`(新增)

单行紧凑结构:

```
[icon]  [中文 phase 标签]  ····················· · [耗时]
```

- 字号:`text-xs`
- 色彩:`text-muted-foreground`(in-progress / done);`text-destructive`(failed)
- icon:
  - `in-progress`:小尺寸脉动点(`animate-pulse`)
  - `done`:Lucide `Check`,size=12
  - `failed`:Lucide `X`,size=12
- 耗时:
  - `in-progress`:实时更新的 `now - startedAt`,精度 0.1s
  - `done` / `failed`:`completedAt - startedAt`,精度 0.1s
  - 耗时为 0 时显示 `0.0s`,不省略
- failed 时第二行显示 `errorMessage`(同色,`text-xs`)
- 全行不带边框 / 阴影 / 卡片背景,贴近现有 timeline 极简风格

### 6.2 中文 copy 表

| Phase | in-progress | done | failed |
|---|---|---|---|
| `submitted` | (始终 done) | 已发送 | — |
| `received` | (通常瞬时) | 已收到 | — |
| `runtime_starting` | Agent 启动中 | Agent 已就绪 | 启动失败 |
| `runtime_ready` | 不单独占行 | (合并) | — |
| `request_submitted` | 已提交给模型 | 已提交 | 提交失败 |
| `awaiting_first_token` | 等待回复 | 模型已回应 | — |
| `streaming` | 正在回复 | 回复完成 | 回复中断 |
| `completed` | 不单独占行 | (合并) | — |
| `failed` | — | — | 失败 |

### 6.3 `agent-timeline.tsx` 改动

- map 时若 `item.kind === "phase"`,渲染 `<AgentPhaseRow />`,否则维持现有 `<AgentTimelineItem />`
- 删除 `{sending ? <AgentRunStatus label={...} /> : null}` 行(由活跃 phase 行自然替代)
- `AgentRunStatus` 组件保留(其它路径或未来仍可能用)

### 6.4 `sending` 状态语义

`useAgentChat` 暴露的 `sending` 改为派生:
```
sending = (sendingConversationIds 含当前 conversationId)
       || (timeline 中存在该 conversation 上 status="in-progress" 的 phase 项)
```

后者保证即使 `bridge.agent.send` Promise 早 resolve(IPC ack 极快),仍以 phase 状态为准。

## 7. 错误处理

| 错误来源 | 处理 |
|---|---|
| `bridge.agent.send` 在 preload reject(IPC 通道断) | 渲染层在 catch 路径插入 `kind: "error"` timeline item,**不**冒充 phase 事件 |
| 后端某 phase 进入 `failed` | 该 phase 显示 ✗ + errorMessage;后端在最后必须 emit `phase[failed]` 终态行作为 run closer |
| Agent runtime child process 异常退出 | bootstrap 监听 `child.on('exit')` → emit `phase[failed, errorMessage="runtime 进程退出 (code N)"]` |
| 后端漏 emit closer | 不做时间阈值兜底(冷静档);依赖进程退出钩子;reducer 自愈也会在新事件到来时关闭前序 |
| 历史 timeline 含遗留 in-progress 项 | 渲染层载入时显示层修复为 failed("未正常关闭"),**不**写回存储 |
| 重复 / 乱序事件 | reducer 自愈规则覆盖 |
| 时钟偏差 | clamp / fallback,见 5.6 |

## 8. 测试策略

### 8.1 渲染层 reducer(单元,核心)

`desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts`:覆盖 5.5 的所有规则、跨 runId 隔离、历史载入修复、不存在项的 closed-insert + warn。

### 8.2 ticker hook

`desktop/src/modules/agent/hooks/__tests__/use-active-phase-ticker.test.ts`:fake timer 验证递增 / 暂停 / unmount 清理。

### 8.3 组件渲染

`desktop/src/modules/agent/components/__tests__/agent-phase-row.test.tsx`:三种 status 的视觉、errorMessage 显隐、耗时为 0 时的显示、`aria-live` 的可访问性。

`agent-timeline.test.tsx` 现有用例补:有 phase 项时 map 到 `AgentPhaseRow`、不再渲染遗留的 `AgentRunStatus`。

### 8.4 渲染层集成

`desktop/src/modules/agent/__tests__/phase-flow.integration.test.tsx`:mock bridge,注入完整事件序列;happy path、mid-stream failed、IPC reject、conversation 切换四种场景。

### 8.5 主进程 IPC handler

`desktop/electron/runtime/ipc/__tests__/agent-send.handler.test.ts`:runId 生成、`clientSubmittedAt` 的 clamp / fallback / 缺失兼容、runtime 抛错时的兜底 failed。

### 8.6 Agent runtime 进程退出钩子

`desktop/electron/services/agent/__tests__/runtime-exit.test.ts`:child process 异常退出时 emit failed phase。

### 8.7 硬约束

`pnpm --filter @synapse/desktop run check:hard-constraints` 必须仍通过。

### 8.8 不在测试范围

- 真实 wall-clock 秒级时序(易 flaky)
- Agent runtime 内部 emit 时机的端到端真实正确性(由 runtime 各自模块测试覆盖)
- 视觉回归

## 9. 渐进交付

为降低单次合并风险,实现可分两步:

1. **Step A**:类型扩展 + 主进程 IPC handler 的 `submitted` / `received` emit + 渲染层 reducer + `AgentPhaseRow` + ticker。**Agent runtime 暂不动**。此时用户已能看到 T1 / T2 两个阶段行,空窗期前半段已被消除。
2. **Step B**:Agent runtime 各边界点接入 phase emit。完成 T3-T9 全覆盖。

每一步都是独立可上线的 PR。

## 10. 风险与权衡

- **风险**:Agent runtime 各 CLI 适配器(Claude / Cursor / 自定义)的边界点可能不一致 → mitigation:phase emit 抽到一个 runtime 内的辅助层,每个适配器只需调用 `phaseEmitter.markRuntimeReady(runId)` 等语义化方法
- **风险**:phase 行会让简单对话视觉变长 → mitigation:phase 行字号小、色淡,且日常成功路径稳定后用户会自动忽略;若反馈过吵,后续可通过设置项控制粒度(超出本 spec)
- **取舍**:不做超时兜底意味着极端情况下 composer 可能锁死 → 接受,依赖进程退出钩子 + 用户关闭/切换 conversation 自救;下个 spec 加 cancel 后彻底解决

## 11. 后续 spec 接力点

- 取消/停止按钮(composer 内 send → stop 切换;cancel 时 emit `phase[failed, errorMessage="用户取消"]`)
- 卡顿警告(可选,基于 phase 阈值)
- phase 粒度的用户级配置开关
