# Cloud Code Agent 对话、流程运行与日志夜间巡检

你正在对 Synapse 的 Agent 对话功能做一次并行安全的小步巡检和修复。当前第一公民是 Cloud Code / Claude Code SDK，代码里的真实命名以 `@anthropic-ai/claude-agent-sdk`、`claude-agent-sdk`、`agent-runtime`、`conversation/session` 为准。旧的 Codex 支持和 Hermes Agent 对话支持已经废弃；不要恢复旧路径，不要新增兼容旧运行时的抽象。

本 Prompt 会被 N 个 Codex worker 在同一工作目录中并行循环执行。每个 worker 每轮都要快速关注三条线：

1. Agent 对话右侧消息内容区的展示问题和可用性细节。
2. Cloud Code SDK 替换后，流程运行、调度、自动化触发链路可利用的新能力或现有 bug。
3. 对话、流程、SDK 边界、用户操作追踪相关日志缺口。

最终每轮最多只实施 1 个真实问题，或补齐 1 组同一链路上的关键日志。其余发现只记录为候选，不要一轮改多处。

## 工作模式

本轮使用「三轨巡检 + 小步修复模式」。

- 先快速读三条线的入口，形成候选池。
- 每条线最多记录 1 个高置信候选。
- 最终只选择其中 1 个 P0/P1/P2/P3 问题实施。
- 如果没有高置信、低冲突候选，本轮只输出调查结果，不强行修改。

## 并行原则

- 外部已经有 N 个 worker 并行。单个 worker 不得再启动子 Agent。
- 每轮最多处理 1 个问题。可以在修复同一问题时顺手补必要日志，但不能变成第二个独立问题。
- 修改前必须声明写入范围，并按本文件的 claim/lock 协议加锁。
- 默认文件级 claim。大文件只有在不改 imports、exports、props、共享类型时，才允许符号级 claim。
- 如果目标文件已被其他 worker claim 或 lock，最多等待 2 分钟；仍不可用就换候选或结束本轮。
- 宁可本轮无修复，也不要抢同一处代码。
- 不做全文件格式化，不批量重排 imports，不顺手重构邻近代码。

## 禁止事项

- 不得启动 dev server、Electron app、浏览器、Chrome、Playwright、页面预览或任何运行态调试。
- 不得新增依赖。
- 不得新增大功能、新页面、新架构层、新运行时适配层。
- 不得恢复 Codex/Hermes 对话运行路径，不得把旧运行时重新变成可选 Agent。
- 不得新增 IPC channel，除非修复 P0/P1 且无已有边界可复用。
- 不得改变核心数据模型字段，除非有聚焦测试证明现有模型无法表达 SDK 必需状态。
- 不得使用 `git add .`、`git add -A`、`git commit -a`、`git reset --hard`、`git checkout --`、强推或覆盖其他 worker/用户变更。
- 不得修改无关文件。
- 不得把 prompt、message、token、secret、authorization、cookie、完整本地路径、超长 Markdown、完整源码或 SDK raw event 整包写进日志。

## 必读入口

先按候选方向阅读，不要一次性展开无关文件。

### A. Agent 对话右侧消息内容区

- `desktop/src/modules/agent/index.tsx`
- `desktop/src/modules/agent/components/agent-timeline.tsx`
- `desktop/src/modules/agent/components/agent-timeline-item.tsx`
- `desktop/src/modules/agent/components/agent-message-event.tsx`
- `desktop/src/modules/agent/components/agent-message-bubble.tsx`
- `desktop/src/modules/agent/components/agent-message-header.tsx`
- `desktop/src/modules/agent/components/agent-message-toolbar.tsx`
- `desktop/src/modules/agent/components/agent-thinking-event.tsx`
- `desktop/src/modules/agent/components/agent-tool-event.tsx`
- `desktop/src/modules/agent/components/agent-phase-row.tsx`
- `desktop/src/modules/agent/components/agent-permission-card.tsx`
- `desktop/src/modules/agent/hooks/use-agent-chat.ts`
- `desktop/src/modules/agent/hooks/use-chat-events.ts`
- `desktop/src/modules/agent/hooks/use-chat-reducer.ts`
- `desktop/src/modules/agent/hooks/use-stick-to-bottom.ts`
- `desktop/src/modules/agent/utils.ts`
- `desktop/src/modules/agent/utils/phase-reducer.ts`
- 对应 `desktop/src/modules/agent/**/__tests__/*`

### B. Cloud Code SDK、流程运行与后台触发

- `desktop/package.json`
- `desktop/src/definitions/agent/claude-code/`
- `desktop/src/definitions/main-types.ts`
- `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
- `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`
- `desktop/electron/services/agent-runtime/session-manager.ts`
- `desktop/electron/services/agent-runtime/session-lifecycle.ts`
- `desktop/electron/services/agent-runtime/conversation-router.ts`
- `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- `desktop/electron/services/agent-runtime/types.ts`
- `desktop/electron/services/workflow/`
- `desktop/src/modules/workflow/`
- `desktop/electron/services/task-scheduler/`
- `desktop/src/modules/task-scheduler/`
- `desktop/electron/services/automation-ingress/automation-ingress-service.ts`
- `desktop/electron/services/side-channel/`
- 对应 `desktop/electron/services/**/__tests__/*` 和 `desktop/src/modules/{workflow,task-scheduler}/**/__tests__/*`

### C. 日志、诊断与用户操作追踪

- `desktop/electron/runtime/logging/`
- `desktop/electron/runtime/observability/diagnostics.ts`
- `desktop/electron/services/diagnostics-service.ts`
- `desktop/electron/services/log-store.ts`
- `desktop/src/app-shell/logging`
- `desktop/src/app-shell/diagnostics/`
- `createMainLogger`
- `createRendererLogger`
- `track`
- `data-track`
- diagnostics / logStore / RendererHealthService
- EventBus / WindowBroadcaster
- preload 暴露的 `window.synapse.*` 边界

UI 或样式相关改动前还必须读：

- `.claude/rules/design.md`
- `.claude/rules/ui-rules.md`

## 三轨巡检清单

### 1. 对话消息内容区

重点找真实会影响用户读对话、判断状态、继续操作的问题：

- assistant/user 消息顺序、去重、合并、streaming partial/final 状态是否正确。
- 思考过程是否在合理时机显示、折叠、复制；空思考或异常思考是否造成噪声。
- tool call / tool result / permission request 是否有清楚状态；失败、拒绝、进行中是否默认展开合理。
- 长输出、代码块、Markdown、本地引用、工具输入输出是否撑破布局、泄露敏感内容或无法复制。
- 正在生成、停止、失败、恢复会话、无输出、空会话等状态是否可见但不啰嗦。
- hover toolbar、时间戳、复制、打开引用、滚动到底部是否在边界数据下稳定。
- 用户需要看的内容不应被折叠；调试性/中间态/长工具输出默认应可折叠。

可参考的产品行为基线：

- Claude Code / Cloud Code 类对话应突出最终回答，工具与中间事件保持可检查但不抢主线。
- Codex 类桌面对话里，思考/工具/命令/结果应有明确边界；失败和需要用户处理的状态比成功细节更显眼。
- 不要为“更像某个客户端”做主观改版；必须落到 Synapse 现有组件和具体 bug。

### 2. SDK 替换后的流程运行优化

重点找 Cloud Code SDK 第一公民后可以小步修正的真实问题：

- fresh/resume session 路由是否保持 `conversationId`、`sessionId`、`sdkSessionId` 一致。
- SDK event 是否完整桥接：assistant/user/result/error/system/tool_use/tool_result/permission/usage/unknown future event。
- Abort、timeout、cancel、close、dispose、duplicate send、concurrent send 是否留下悬挂 session 或错误状态。
- workflow / task-scheduler / automation ingress / side-channel 调 Agent 时，是否能关联 runId、taskId、messageId、conversationId、sessionId。
- 流程运行是否能利用 SDK 的 session、usage、permission、tool/result、error 事件改善状态展示或失败复盘。
- 后台触发是否会误报成功、重复执行、丢最终结果、丢错误原因、无法停止。
- 如果旧模式留下“选择 Agent/Provider/运行时”的 UI 或状态假设，确认它没有误导当前 SDK-first 工作方式。

不要做大功能。允许的小优化必须满足：

- 直接基于 SDK 已有事件或现有类型。
- 能在 1 到 3 个文件内完成。
- 有测试或静态证据证明行为更正确。
- 不恢复旧运行时，不新增全局架构。

### 3. 日志补齐

只补能帮助复盘问题的日志，禁止噪声日志。新增日志至少回答一个问题：

- 谁触发：用户点击、输入提交、IPC、workflow、scheduler、automation ingress、side channel？
- 处理对象：conversationId、messageId、sessionId、sdkSessionId、taskId、runId、workflowId、nodeId、agentType、providerId？
- 哪个边界：renderer、preload、IPC、main service、SDK query、event bridge、workflow engine、scheduler execution？
- 失败类型：abort、timeout、SDK error、validation error、permission denied、unknown event、persistence failure、render/copy/open-reference failure？
- 能否和最近用户操作、窗口、仓库、任务、流程、会话、消息关联？

优先复用：

1. `createMainLogger`
2. `createRendererLogger`
3. `track({ component, name, action, value })`
4. `data-track="stable-semantic-name"`
5. diagnostics / logStore / RendererHealthService
6. 既有 EventBus、notification、promise 日志机制

脱敏规则：

- prompt/message/content/thinking/tool body：默认只记录长度、角色、消息类型、事件类型；确需摘要时最多 120 字符，且必须先脱敏。
- token/secret/apiKey/cookie/authorization/password/credential：一律 `[redacted]` 或只记录是否存在。
- 文件路径：只记录 basename、扩展名、长度或 `[path redacted]`。
- URL：保留 protocol/host/path 摘要，去掉 query 和 fragment。
- SDK raw event：不要整包落日志；记录 type、subtype、session_id、usage 摘要、错误摘要和已知字段 keys。
- 错误：记录 `errorName`、`errorLength`、必要的 sanitized summary；不要把 raw backend error 原文直接展示给用户或写入 renderer 日志。

## 优先级

1. P0：崩溃、白屏、主进程未捕获异常、SDK session 卡死、消息完全丢失、流程/定时任务重复执行或无法停止。
2. P1：右侧消息展示错乱、流式消息顺序错误、resume/fresh 会话路由错误、SDK error/result/tool/permission 事件误映射、流程运行误报成功。
3. P2：关键日志不足，无法把一次用户操作或后台触发关联到 SDK session/message/run/task/workflow。
4. P3：局部 UI 可用性瑕疵或 loading/error/empty/disabled 状态不完整，但必须影响发送消息、查看结果、恢复会话、运行流程、判断错误中的一个真实动作。

## 候选选择方法

每轮先各用 5 到 10 分钟扫三条线。每个候选都必须先写出证据链：

```text
触发入口
→ renderer/preload/main/SDK/workflow/scheduler 中的代码链路
→ 当前错误结果、可用性问题或日志复盘缺口
→ 为什么正常使用会遇到
```

每一环尽量引用具体 `文件:行号`。如果需要运行 App、打开浏览器、依赖截图、依赖外部官方网页或靠猜测才能确认，放弃该候选。

最终选择规则：

- 优先选择 P0/P1。
- 同优先级下，优先选择能用聚焦测试证明的问题。
- 再同等，优先选择写入范围最小、和其他 worker 冲突最少的问题。
- 如果本轮只发现日志缺口，优先补 SDK / workflow / scheduler 边界日志，其次补 renderer 用户操作追踪。
- 如果发现 UI 问题但无法静态证明，不改代码，只记录候选和需要人工验证的点。

## 缺陷卡片

最终只选 1 个问题。实施前输出：

```text
### 缺陷：<一句话定性>
- 类型：<消息展示缺陷 / SDK事件缺陷 / 流程运行缺陷 / 调度缺陷 / 日志缺口 / UI可用性瑕疵 / 回归>
- 优先级：<P0/P1/P2/P3>
- 选择来源：<对话消息区 / SDK流程运行 / 日志补齐>
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
- 用户可见行为：<修复后用户看到什么>
- 复盘能力：<日志能多回答什么问题；如无日志改动，说明为什么不需要>
- Breaking Change：<无 / 有 + 兼容策略>
```

## Claim / Lock 协议

运行开始生成 worker ID：

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

1. 读取最近 `fix-log.md`、`coverage-map.json`、`focus.md`、`claims.jsonl` 和 `locks/`。
2. 选择一个未被占用的候选。
3. 用原子 `mkdir` 获得 `auto/state/parallel/locks/claims.lock/`。
4. 向 `claims.jsonl` 追加 planned claim。
5. 释放 `claims.lock`。
6. 用原子 `mkdir` 获得目标文件或符号 lock。
7. 重新读取目标文件，确认未被其他 worker 改动。

claim 格式：

```json
{"agentId":"...","iteration":N,"status":"planned","scope":"file|symbol|state|git","path":"...","symbol":"...","reason":"...","startedAt":"YYYY-MM-DD HH:mm:ss +0800","expiresAt":"YYYY-MM-DD HH:mm:ss +0800"}
```

锁目录命名：

- `auto/state/parallel/locks/file__<path-hash>.lock/`
- `auto/state/parallel/locks/symbol__<path-hash>__<symbol-hash>.lock/`
- `auto/state/parallel/locks/claims.lock/`
- `auto/state/parallel/locks/state.lock/`
- `auto/state/parallel/locks/git.lock/`

锁默认 90 分钟过期。不确定是否 stale 就避开。等待锁最多 2 分钟。

## 实施规则

- 优先先写聚焦测试，并确认修复前应失败；无法跑红灯时说明原因。
- 再实现最小修复。
- 改动限制在已 claim 范围内。
- 不新增依赖，不扩散 `any`，不做无关重构。
- UI 改动必须遵守 `AGENTS.md`、`.claude/rules/design.md`、`.claude/rules/ui-rules.md`：
  - 使用现有 shadcn/ui、Radix、Tailwind token。
  - 禁止内联 `style={{...}}`，动态计算或已有 Markdown 注入边界除外。
  - 禁止 hex/rgb/hsl 字面色和 Tailwind 任意色。
  - 禁止渐变、霓虹、装饰性 emoji、卡片套卡片、连续 Divider、废话文案。
  - 只保留标题、必要 label、空/错/加载状态必须信息。
- Renderer 只能通过 `window.synapse.*` 使用 Electron 能力。
- 主进程敏感操作必须经过现有 PermissionGuard / AuditSink。
- 修改后重新阅读改动文件，确认没有误碰未 claim 范围、没有空 catch、没有 `console.log` 当日志、没有 raw secret 泄露。

## 验证

允许：

- `rg`、`sed`、`git diff`、`git status`
- 与本轮修改直接相关的测试
- 目标文件 lint 或 typecheck
- `pnpm --filter @synapse/desktop run check:hard-constraints`

禁止：

- dev server
- Electron app
- 浏览器预览
- Playwright
- 全量长耗时测试，除非没有更小验证方式且本轮修改风险较高

完成前至少尝试：

1. 聚焦测试，例如：
   - `pnpm --filter @synapse/desktop exec vitest run <相关测试文件> -t "<测试名>"`
   - 或 `pnpm --filter @synapse/desktop exec vitest run <相关测试文件>`
2. 目标文件 lint，例如：
   - `pnpm --filter @synapse/desktop exec eslint <改动文件...>`
3. 硬约束检查：
   - `pnpm --filter @synapse/desktop run check:hard-constraints`

如果验证失败来自既有无关问题，记录具体命令、失败摘要和为什么无关，不要顺手修无关问题。

## 退出条件

- 三条线都找不到高置信候选时：只输出调查结果，不修改。
- 证据链不完整时：不实施。
- 目标文件被占用且等待 2 分钟仍不可用时：换候选；没有候选就结束本轮。
- 需要运行 App、浏览器、Playwright 或人工视觉判断才能确认时：记录候选，不实施。
- 修复会触及 4 个以上业务文件、改变核心模型、引入新 IPC、新运行时抽象或恢复旧运行时支持时：不实施，记录为需要人工设计的问题。
- 连续多批没有新发现时：下一轮建议改用收敛模式，只整理 `fix-log`、`coverage-map`、`focus` 和 worker 日志。

## State 收尾

如果本轮有调查、修复或放弃候选，都先写个人 note：

`auto/state/parallel/agent-notes/<agentId>-iteration-N.md`

如果修改了代码或确认了重要候选，再获得 `state.lock`，追加更新：

- `auto/state/fix-log.md`
- `auto/state/coverage-map.json`

更新共享状态时只写摘要和证据，不写完整 prompt、完整 message、secret、token、完整路径或超长日志。

## 最终输出格式

```text
## 本轮三轨扫描
- 对话消息区：<候选 / 未发现 / 放弃原因>
- SDK流程运行：<候选 / 未发现 / 放弃原因>
- 日志补齐：<候选 / 未发现 / 放弃原因>

## 本轮选择的问题
- 问题：<一句话>
- 类型：<...>
- 优先级：<P0/P1/P2/P3>
- 证据链：<触发入口 → 代码链路 → 错误结果或缺口>

## 修改
- 文件：<文件列表；无修改写“无”>
- 内容：<简述>

## 验证
- <命令>：<通过 / 失败 + 摘要>

## 状态更新
- note：<路径>
- fix-log / coverage-map：<已更新 / 未更新 + 原因>

## 风险
- <剩余风险；没有写“无已知风险”>

## 后续建议
- <最多 3 条，聚焦下一轮可执行候选>
```
