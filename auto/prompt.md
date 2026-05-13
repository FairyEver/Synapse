你正在对 Synapse 中今天白天大改后新引入的 Claude/Cloud Code SDK 相关链路做一次并行安全的小步修复。这里的 SDK 以代码里的真实命名为准，重点包括 `@anthropic-ai/claude-agent-sdk`、`claude-agent-sdk` runtime、conversation/session 路由、Agent 对话 UI、任务调度、消息事件桥接和日志诊断。

本提示词会被 5 个 Agent 在同一工作目录中并行循环执行。每个 Agent 每轮只处理一个真实问题：要么修复 1 个可证明的缺陷，要么补齐 1 组同一链路上的关键日志缺口。不要做大重构，不要做新功能。

## 本轮总目标

让新 SDK 接入后的主链路更稳定、更可复盘：

- 用户在 Agent/对话 UI 里发送消息、查看流式输出、恢复会话、切换模型/模式时，不白屏、不静默失败、不显示错乱状态。
- SDK session、conversation、message、tool/result、usage、error、abort/timeout 等事件能被正确桥接到 Synapse 内部事件。
- 定时任务、automation ingress、side channel 等后台触发 Agent 的路径不会丢消息、重复执行、卡住或误报成功。
- 与 Claude Code SDK 相关的失败必须有足够日志，用户给出日志后能还原：谁触发、哪个会话、哪个任务、哪个 SDK 事件、失败发生在哪个边界。

## 并行原则

- 外部已经有 5 个 Agent 并行。单个 Agent 不得再启动子 Agent。
- 每轮最多修复 1 个缺陷，或补齐 1 组同一链路日志。
- 修改前先声明写入范围并加锁；没有 claim/lock 的文件不得编辑。
- 默认文件级写锁。只有不改 imports/exports/props/共享类型时，才可对大文件使用符号级锁。
- 如果目标文件已被其他 Agent claim 或 lock，换一个问题。
- 宁可本轮无修复，也不要抢同一处代码。

## 禁止事项

- 不得启动 dev server、Electron app、浏览器、Chrome、Playwright 或任何运行态调试页面。
- 不得新增依赖。
- 不得新增大功能、页面、视图、架构层或新的日志系统。
- 不得新增 IPC channel，除非修复 P0/P1 且无替代路径。
- 不得修改核心数据模型字段，除非有测试证明现有模型无法表达 SDK 必需状态。
- 不得使用 `git add .`、`git add -A`、`git commit -a`、`git reset --hard`、`git checkout --`、强推或覆盖其他 Agent/用户变更。
- 不得做全文件格式化、批量重排 imports、顺手重构相邻代码。
- 不得把 prompt、message、token、secret、authorization、cookie、完整路径、超长 Markdown/源码写进日志。

## 必读入口

先按候选方向阅读，不要一次性展开无关文件。

### SDK 与 Agent Runtime

- `desktop/package.json`
- `desktop/src/definitions/agent/claude-code/`
- `desktop/src/definitions/main-types.ts`
- `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
- `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`
- `desktop/electron/services/agent-runtime/session-manager.ts`
- `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- `desktop/electron/services/agent-runtime/types.ts`
- `desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts`
- `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`
- `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`

### 对话 UI 与消息展示

- `desktop/src/modules/agent/`
- `desktop/electron/modules/agent/`
- `desktop/electron/modules/ops/ipc.ts`
- 所有与 conversation、message、session、agent event、streaming output、tool/result rendering 相关的组件、hook、utils 和测试。

### 任务调度与后台触发

- `desktop/src/modules/task-scheduler/`
- `desktop/electron/modules/task-scheduler/`
- `desktop/electron/services/task-scheduler/`
- `desktop/electron/services/automation-ingress/automation-ingress-service.ts`
- `desktop/electron/services/side-channel/`

### 日志与诊断基础设施

- `createMainLogger`
- `createRendererLogger`
- `track`
- diagnostics / logStore / RendererHealthService
- EventBus / WindowBroadcaster
- preload 暴露的 `window.synapse.*` 边界

## 优先级

优先处理今天新 SDK 接入后最容易坏、最难复盘的地方：

1. P0：崩溃、白屏、主进程未捕获异常、SDK session 卡死、消息完全丢失、任务重复执行或无法停止。
2. P1：对话 UI 展示错乱、流式消息顺序错误、resume/fresh 会话路由错误、SDK error/result/tool 事件被误映射、后台任务误报成功。
3. P2：关键日志不足，无法把一次用户操作或定时任务触发关联到 SDK session/message/run/task。
4. P3：局部 loading/error/empty/disabled 状态不完整，但必须和 SDK/Agent/调度链路直接相关。

## 结构化审查方法

每个候选都必须先写出证据链：

```text
用户操作或后台触发
→ renderer/preload/main/SDK/调度中的代码链
→ 错误结果或日志复盘缺口
```

每一环引用具体 `文件:行号`。如果需要运行 app 才能确认，放弃该候选。

重点查：

- SDK event 是否完整桥接：assistant/user/result/error/system/tool/use/permission/usage/unknown future event。
- `sdkSessionId` 是否在 fresh/resume、streaming update、result、error、conversation persistence 中一致。
- Abort、timeout、close、dispose、duplicate send、concurrent send 是否会留下悬挂 session 或错误状态。
- 对话 UI 是否能稳定展示 partial text、final result、tool/result/error、空输出和异常退出。
- 消息排序、去重、合并、done 状态、last message、conversation route 是否有边界错误。
- Task Scheduler 手动/定时/错过运行/重复运行/禁用任务路径是否正确记录 run result。
- Automation ingress 和 side channel 调 Agent 时，messageId/sessionKey/reply target/agent event 是否能关联。
- IPC handler 是否记录失败 channel、耗时、输入摘要、错误 stack。
- Renderer 操作是否有 `track` 或 data-track 能还原最近用户动作。
- diagnostics 导出是否包含 Agent runtime、scheduler、recent actions、renderer health、SDK session 相关日志。

## 日志补齐要求

改到 Claude/Cloud Code SDK、Agent runtime、对话 UI、任务调度、automation ingress 或 side channel 时，必须同时检查日志。

新增日志应至少回答其中一个问题：

- 谁触发了这次动作：用户点击、IPC、定时任务、automation ingress、side channel？
- 处理的是哪个对象：conversationId、messageId、sessionId、sdkSessionId、taskId、runId、agentType、providerId？
- 哪个边界失败：renderer、preload、IPC、main service、SDK query、event bridge、scheduler execution？
- 失败类型是什么：abort、timeout、SDK error、validation error、permission denied、unknown event、persistence failure？
- 这条日志能否和最近用户操作、窗口、仓库、任务、会话、消息关联？

优先复用：

1. `createMainLogger`
2. `createRendererLogger`
3. `track({ component, name, action, value })`
4. `data-track="stable-semantic-name"`
5. diagnostics / logStore / RendererHealthService
6. 既有 EventBus、notification、promise 日志机制

脱敏规则：

- prompt/message/content：只记录长度、角色、消息类型、最多 120 字符摘要。
- token/secret/apiKey/cookie/authorization/password/credential：一律 `[redacted]` 或只记录是否存在。
- 文件路径：只记录 basename、长度或 `[path redacted]`。
- URL：保留 protocol/host/path 摘要，去掉 query。
- SDK raw event：不要整包落日志；记录 type、subtype、session_id、usage 摘要、错误摘要和已知字段 keys。

禁止添加“进入函数”式噪声日志。每条新增日志都要服务复盘。

## 写锁协议

运行开始生成 Agent ID：

```text
agentId = AUTO_AGENT_ID 环境变量；否则 "agent-" + 当前时间戳 + "-" + 4 位随机后缀
```

共享状态：

- `auto/state/fix-log.md`
- `auto/state/coverage-map.json`
- `auto/state/focus.md`
- `auto/state/parallel/claims.jsonl`
- `auto/state/parallel/locks/`
- `auto/state/parallel/agent-notes/`

编辑前：

1. 读取最近 fix-log、coverage-map、focus、claims、locks。
2. 选择一个未被占用的 work item。
3. 获得 `claims.lock`，向 `claims.jsonl` 追加 planned claim。
4. 获得目标文件 lock。
5. 重新读取目标文件，确认未被其他 Agent 改动。

claim 格式：

```json
{"agentId":"...","iteration":N,"status":"planned","scope":"file|symbol|state|git","path":"...","symbol":"...","reason":"...","startedAt":"YYYY-MM-DD HH:mm:ss +0800","expiresAt":"YYYY-MM-DD HH:mm:ss +0800"}
```

锁目录用原子 mkdir 创建：

- `auto/state/parallel/locks/file__<path-hash>.lock/`
- `auto/state/parallel/locks/symbol__<path-hash>__<symbol-hash>.lock/`
- `auto/state/parallel/locks/claims.lock/`
- `auto/state/parallel/locks/state.lock/`
- `auto/state/parallel/locks/git.lock/`

锁默认 90 分钟过期。不确定是否 stale 就避开。

## 缺陷卡片

最终只选 1 个问题，实施前输出：

```text
### 缺陷 N：<一句话定性>
- 类型：<SDK缺陷 / 对话UI缺陷 / 调度缺陷 / 消息事件缺陷 / 日志缺口 / 回归>
- 优先级：<P0/P1/P2/P3>
- 并行范围：<计划 claim 的文件或符号>
- 触发路径：<用户操作或后台触发 → 代码链 → 错误结果或复盘缺口>
- 代码证据：
  - `文件路径:行号`：<说明>
  - `文件路径:行号`：<说明>
- 非边缘性论证：<为什么正常使用会遇到>
- 根因：<精确定位到行为或假设>
- 候选方案：
  - 方案 A：<做法>；利：...；弊：...
  - 方案 B：<做法>；利：...；弊：...
- 选定方案：<A/B>，理由：<侵入性、复杂度、并行安全性>
- 产品行为：<修复后用户看到什么，日志能复盘什么>
- Breaking Change：<无 / 有 + 兼容策略>
```

## 实施规则

- 先写聚焦测试，并确认修复前应失败；无法跑红灯时说明原因。
- 再实现最小修复。
- 改动限制在已 claim 范围内。
- 不新增依赖，不扩散 `any`，不做无关重构。
- UI 改动遵守 `AGENTS.md`、`.claude/rules/design.md`、`.claude/rules/ui-rules.md`：不写自定义颜色、内联样式、卡片套卡片、废话文案。
- Renderer 只能通过 `window.synapse.*` 使用 Electron 能力。
- 主进程敏感操作必须经过现有 PermissionGuard / AuditSink。
- 修改后重新阅读改动文件，确认没有误碰未 claim 范围、没有吞错、没有空 catch、没有 console.log 日志。

## 验证

允许：

- `rg`、`sed`、`git diff`、`git status`
- 与本轮修改直接相关的测试
- 目标文件 lint/typecheck
- `pnpm --filter @synapse/desktop run check:hard-constraints`

禁止：

- dev server
- Electron app
- 浏览器预览
- Playwright
- 全量长耗时测试，除非没有更小验证方式

完成前至少尝试：

1. 聚焦测试。
2. 目标文件 lint 或 typecheck。
3. `pnpm --filter @synapse/desktop run check:hard-constraints`。

如果失败来自既有问题，记录证据，不要修无关问题。

## State 收尾

先写：

`auto/state/parallel/agent-notes/<agentId>-iteration-N.md`

再获得 `state.lock`，追加更新：

- `auto/state/fix-log.md`
- `auto/state/coverage-map.json`

fix-log 追加格式：

```text
---

## [YYYY-MM-DD HH:mm] 第 N 次迭代

### Agent
- <agentId>

### 发现的问题
- <问题简述，含触发路径要点>

### 修复内容
- [文件路径:行号] 修改说明

### 日志补充
- <新增了哪些 SDK/对话/调度/消息事件日志；无则说明原因>

### 并行范围
- <claim / lock 范围>

### 验证结果
- <命令>：<结果>

### 本次进展
<一句话总结>
```

coverage-map：

- 修改文件：`lastReviewedIteration = N`，`issuesFound += 1`，`issuesFixed += 1`，`healthScore = active`，`lastUpdated = 当前时间`。
- 深读但未修复的文件可标记为 `stable`。
- `totalIterations = N`。

提交可选。若提交，必须拿 `git.lock`，只 stage 本 Agent 修改文件，禁止 `git add .`。并行环境中默认可以跳过提交并说明原因。

## 最终输出

最终回复简洁包含：

- Agent ID。
- 本轮处理的问题或“无可安全修复问题”。
- 修改文件。
- SDK/对话/调度/消息事件日志补齐点。
- 验证命令与结果。
- 是否跳过提交及原因。
- 剩余风险或既有阻塞。

不要输出大段代码，不要泛泛建议，不要把未验证的事说成已完成。
