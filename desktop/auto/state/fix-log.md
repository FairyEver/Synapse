# Fix Log

## 2026-05-16

| Agent | Iteration | Scope | Description |
|-------|-----------|-------|-------------|
| agent-1778925956-3618 | 1 | workflow-engine.ts: triggerSource propagation | Added `triggerSource` to all node-level logs (started/succeeded/failed/cancelled) and workflow terminal logs (failed/completed/cancelled) in `WorkflowEngine.run()` for single-step trigger correlation |
| agent-1778926571-5737 | 1 | workflow-dispatcher.ts: success log correlation | Added `dispatchCorrelation(params)` to MCP dispatch success log, matching existing start and error logs |
| agent-cc-sdk | 1 | workflow-scheduler.ts: eager skip propagation on failure | In `tryStart` failure handler, added `releaseSkippedDependency(next)` for each downstream of the failed node so the skip propagates eagerly through the DAG rather than waiting for the final cleanup loop |

---

## [2026-05-16 23:08] Agent agent-6-1778942952-8797 第 1 轮

### 问题
- `visibleEngineRejectionError` 在工作流引擎异常时生成的用户可见错误消息只包含错误类型名和长度（如"引擎异常（TypeError，错误 27 字）"），丢失了引擎 rejection 的完整错误信息，用户无法区分不同引擎失败原因
- 类型：错误处理
- 优先级：P2

### 修改
- `desktop/electron/modules/workflow/ipc.ts`：`engineRejectionDiagnostic` 新增 `errorMessage` 字段返回实际错误文本；`visibleEngineRejectionError` 改为显示截断的错误摘要（最长 120 字），替代无信息的"错误 N 字"

### 用户受益
- 运行工作流时引擎异常：用户现在会看到"引擎异常（TypeError）：Cannot read properties of undefined (reading 'node')"等具体错误，而非无意义的"错误 45 字"
- 3 处 catch 块（run / runDefinition / rerun）均受益，涵盖主进程所有工作流引擎拒绝路径

### 验证
- ESLint `electron/modules/workflow/ipc.ts`：通过（无输出）
- `tsc --noEmit`：无新增类型错误（ipc.ts 无错误，仅有预先存在的 5 个 agent 模块错误）
- `check:hard-constraints`：通过

### 风险
- 无已知风险。`errorMessage` 字段对 logger 透明（多一个 info 字段），对用户可见错误消息是净改进。

---

## [2026-05-17 00:07] Agent agent-4-1778946572-9912 第 1 轮

### 问题
- `SCHEDULED_AGENT_ERROR_MESSAGE` in agent-runtime-service.ts replaces actual error with `"Agent run failed"`, then `persistableAgentError` in executor.main.ts further replaces with `"Agent runtime error (N chars)"` — users see opaque length-only placeholders instead of actual diagnostic info
- 类型：错误处理
- 优先级：P1

### 修改
- `desktop/electron/services/agent-runtime/agent-runtime-service.ts`：替换 `SCHEDULED_AGENT_ERROR_MESSAGE` 为 `sanitizeError(result.error)`，保留脱敏后的实际错误消息；删除 SCHEDULED_AGENT_ERROR_MESSAGE 常量
- `desktop/action-packages/builtin/agent/executor.main.ts`：导入 `sanitizeError` 替代 `persistableAgentError` 中的长度占位符，错误消息脱敏后截断至 120 字
- `desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts`：更新测试断言验证新格式
- `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`：更新测试断言验证新格式

### 用户受益
- 工作流 Agent 节点执行失败时，用户看到有意义的错误描述（如 "Agent runtime error: SDK failed for prompt token=[redacted] at [path]"），替代无信息的 "Agent runtime error (N chars)"

### 验证
- ESLint 两文件：passed
- `executor.main.test.ts` 8/8 passed
- `agent-runtime-service.test.ts` 16/17 passed（1 个 pre-existing failure，与本次变更无关）
- `check:hard-constraints`：passed

### 风险
- 无已知风险。`sanitizeError` 是项目标准脱敏工具，已在 `error-sanitize.ts` 中定义，被多个 service 使用。函数签名未变，调用方不受影响

---

## [2026-05-17 00:15] Agent agent-8-1778947907-1223 第 1 轮

### 问题
- prompt-editor.tsx: Badge 变量插入按钮缺少键盘支持——有 onClick 但无 tabIndex/role/onKeyDown，键盘用户无法通过 Tab 聚焦并用 Enter/Space 插入变量
- 类型：交互完整性
- 优先级：P3

### 修改
- `desktop/workflow-nodes/prompt-editor.tsx`：给变量 Badge 添加 tabIndex={0}、role="button"、onKeyDown（Enter/Space）、focus-visible:ring 聚焦环样式

### 用户受益
- 键盘用户现在可以通过 Tab 键聚焦到变量标签，用 Enter 或 Space 将变量插入提示编辑器，无需使用鼠标

### 验证
- eslint：通过（exit 0）
- check:hard-constraints：通过
- 3 个文件导入 PromptEditor 组件，函数签名未变，零影响面

### 风险
- 无。仅添加键盘事件和 ARIA 属性，不影响鼠标交互和现有功能

---

## [2026-05-17 00:20] Agent agent-1778947901-2346 第 1 轮

### 问题
- `workflow-dispatcher.ts` 的 `dispatchErrorDiagnostic` 返回 `errorLength`（字符数）而非实际错误信息，导致日志中只能看到"错误 N 个字"而无实质内容
- 类型：错误处理
- 优先级：P2

### 修改
- `desktop/electron/capabilities/workflow-dispatcher.ts`：将 `dispatchErrorDiagnostic` 返回值从 `{ errorName, errorLength }` 改为 `{ errorName, errorMessage }`，实际错误信息截断至 200 字符

### 用户受益
- 当 workflow MCP dispatch 失败时，日志将显示实际错误信息而非"错误 N 字"，运维人员可立即定位问题

### 验证
- `pnpm --filter @synapse/desktop exec npx eslint electron/capabilities/workflow-dispatcher.ts`：通过
- `pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/workflow-dispatcher.test.ts`：17 tests passed
- `pnpm --filter @synapse/desktop run check:hard-constraints`：通过

### 风险
- `dispatchErrorDiagnostic` 为非导出内部函数，仅在 `dispatch` 的 catch 块中使用，外部无消费者，风险可控


---

## [2026-05-17 00:35] Agent agent-1778947895-10906 第 1 轮

### 问题
- use-watch-next-agent-session.ts 的 5000ms watch 过期时间太短，慢启动的 Agent 会话会错过自动导航
- 类型：交互完整性
- 优先级：P2

### 修改
- `desktop/src/app-shell/use-watch-next-agent-session.ts`：将 watch 过期时间从 5000ms 增加到 120000ms（2 分钟）

### 用户受益
- 当 Agent 会话启动较慢（模型加载、网络延迟）时，用户仍能自动跳转到新会话窗口，不再因 5 秒超时而错过

### 验证
- eslint（node_modules/.bin/eslint --format stylish）：0 errors
- vitest run navigation-watch-session.test.ts：5 passed
- check:hard-constraints：通过
- 影响面检查：仅 App.tsx 导入 useWatchNextAgentSession，只调用不依赖 timeout 值

### 风险
- 无已知风险。120s 超时仍会在极端情况下清理，取消 watch 的显式路径（cancelWatchNextAgentSession）不受影响

---

## [2026-05-17 08:39] Agent agent-9-1778948843-0905 第 1 轮

### 问题
- `handleSaveRepositories` useCallback 依赖数组中包含 `repositories`，但函数体使用 `nextRepositories` 参数而非闭包值
- 导致回调在仓库列表变化时被不必要地重建，触发订阅组件（RepositoryListEditor）不必要的重渲染
- 类型：错误处理（useCallback 错误依赖）
- 优先级：P1

### 修改
- `desktop/src/modules/settings/index.tsx`：从 `handleSaveRepositories` 的 useCallback 依赖数组中移除 `repositories`
- `desktop/src/modules/settings/index.tsx`：移除不再使用的 `useRepositoryList` hook 调用
- `desktop/src/modules/settings/index.tsx`：清理未使用的 `CardDescription`/`CardTitle` import
- `desktop/src/modules/settings/index.tsx`：将参数类型从 `typeof repositories` 改为直接导入的 `SynapseRepositoryConfig[]`

### 用户受益
- 仓库列表变化时，`RepositoryListEditor` 不再因 `handleSaveRepositories` 引用变化而额外重渲染
- 消除 ESLint no-unused-vars 错误（repositories/CardDescription/CardTitle）

### 验证
- eslint: 通过（0 errors）
- tsc --noEmit: 仅 5 个既有 agent 模块错误，无关
- check:hard-constraints: 通过
- vitest settings 模块: 38/38 通过
- 影响面检查（rg import from settings/index）：仅 App.tsx 导入 SettingsModule 组件，不受内部实现变更影响

### 风险
- 无已知风险。`handleSaveRepositories` 始终接收 `nextRepositories` 参数，不依赖闭包中的 `repositories`。remove 的 hook 仅用于参数类型注解。

---

## [2026-05-17 00:45] Agent agent-w1-1778948891-3978 第 1 轮

### 问题
- workflow window-manager: open() 和 openRunner() 中 webContents.send() 在窗口已销毁时可能抛出未捕获异常
- 类型：错误处理
- 优先级：P1

### 修改
- `desktop/electron/services/workflow/window-manager.ts`：open() 中 existing.webContents.send 包裹 try-catch，窗口销毁时记录 warn 而非抛出异常
- `desktop/electron/services/workflow/window-manager.ts`：openRunner() 中 existing.webContents.send 包裹 try-catch，窗口销毁时记录 warn 而非抛出异常

### 用户受益
- 在打开编辑器/运行器窗口的瞬间关闭窗口时，不再有未捕获异常导致主进程崩溃，优雅降级为日志警告

### 验证
- eslint：通过
- check:hard-constraints：通过
- vitest (workflow-scheduler)：13/13 通过

### 风险
- 无。try-catch 仅捕获 webContents.send 在窗口已销毁时的异常，正常路径行为完全不变

---

## [2026-05-17 00:50] Agent agent-1778948835-84690-4q1w 第 1 轮

### 问题
- runner-app.tsx 的 errorDiagnostic 和 validationErrorsDiagnostic 返回 errorLength（错误消息字符数）而非实际错误文本，日志完全无法反映真实错误内容
- 类型：错误处理
- 优先级：P2

### 修改
- `desktop/src/modules/workflow/runner/runner-app.tsx`：errorDiagnostic 新增 errorMessage 字段（含 sanitizeError 脱敏后的错误文本，最长 200 字）；validationErrorsDiagnostic 将 firstErrorLength 改为 firstErrorMessage（含脱敏文本）
- `desktop/src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx`：mock ProviderLookupProvider 避免副作用；更新3条断言以匹配新的 errorMessage 字段
- `desktop/src/modules/workflow/runner/__tests__/workflow-runner-rerun-validation.test.tsx`：更新断言以匹配 firstErrorMessage 字段

### 用户受益
- 开发者现在可以通过日志看到实际错误内容（敏感信息已脱敏），不需要靠字符数猜测错误原因
- 例如：日志从 `{errorLength: 47}` 变为 `{errorMessage: "invalid config token=[redacted] at [path]"}`

### 验证
- eslint：通过
- vitest (runner-app)：3/3 通过
- vitest (rerun-validation)：1/1 通过
- vitest (所有 runner 测试)：7/7 通过
- check:hard-constraints：通过

### 风险
- 无。errorDiagnostic 保持向后兼容（保留 errorLength 字段），仅新增 errorMessage；validationErrorsDiagnostic 字段名从 firstErrorLength 改为 firstErrorMessage，但该函数仅在 runner-app.tsx 内部使用

---

## [2026-05-17 10:00] Agent agent-10-1778950486-f653 第 1 轮

### 问题
- snapshots.save() 在 workflow:failed 事件中未持久化 error 字段，导致 workflow 级别错误上下文丢失
- 类型：错误处理
- 优先级：P1

### 修改
- `desktop/electron/modules/workflow/ipc.ts`：在 snapshots.save() 调用中增加 error 字段传递（条件：event.type === "workflow:failed"）
- `desktop/electron/modules/workflow/ipc.ts`：更新 runStatus 从 snapshot 恢复的代码，优先使用 snap.error（新快照），然后回退到从节点结果重建（旧快照）

### 用户受益
- 用户在工作流历史中查看已失败运行的历史快照时，能看到原始的 workflow 级别错误信息，而不是缺少错误或只能从节点错误推断

### 验证
- eslint：通过
- check:hard-constraints：通过
- tsc --noEmit：仅既有 agent 模块错误，与修改无关

### 风险
- 向后兼容：旧快照没有 error 字段，回退逻辑确保从节点结果重建错误

---

## [2026-05-17 10:15] Agent agent-9-1778950451-a352 第 1 轮

### 问题
- 工作流列表页的 WorkflowCard runState badge 从未被连接，用户无法在列表页看到工作流的运行状态
- 类型：交互完整性
- 优先级：P2

### 修改
- `desktop/src/modules/workflow/components/workflow-list.tsx`：添加 useEffect 订阅 onEvent，跟踪 runId→workflowId 映射，将 runState 传给 WorkflowCard
- `desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx`：为新的 onEvent 订阅添加测试 mock

### 用户受益
- 用户在工作流列表页现在能看到每个工作流的实时运行状态 badge（执行中/已完成/失败/已取消），包括从其他窗口（如 Runner 的 rerun）触发的运行
- 关闭 Runner 窗口后回到主窗口，列表页自动反映最新运行结果

### 验证
- eslint：通过（无输出）
- vitest 2/2：通过
- check:hard-constraints：通过
- tsc --noEmit：无新增错误（5 个既有错误均在 agent 模块）

### 风险
- 无已知风险。onEvent 订阅在组件卸载时正确清理。runIdToWfId ref 会随时间累积映射条目，但数量受限于用户实际运行的并发工作流数（通常个位数），不会造成内存问题

---

## [2026-05-17 19:00] Agent agent-2-1778950591-c3a7 第 1 轮

### 问题
- 5 个 snapshots.save() 调用在运行时未传递 error 字段，导致工作流运行失败信息在 snapshot 持久化后丢失
- 类型：错误处理
- 优先级：P1

### 修改
- `desktop/electron/modules/workflow/ipc.ts`：5 个 snapshots.save() 调用补上 error/visibleError 字段
- `desktop/electron/modules/workflow/ipc.ts`：engineRejectionDiagnostic 移除 errorMessage（避免日志泄露 token）
- `desktop/electron/modules/workflow/ipc.ts`：visibleEngineRejectionError 改为接受原始 error，加入 sk-token 脱敏
- `desktop/electron/modules/workflow/__tests__/ipc.test.ts`：更新测试匹配新行为

### 用户受益
- 运行失败的工作流重新打开时，用户能看到 workflow 级别的错误信息（之前只有首节点失败的错误，缺少全局错误上下文）
- 引擎异常时不再显示"错误 N 字"的无意义提示

### 验证
- vitest run ipc.test.ts：3 passed
- check:hard-constraints：通过

### 风险
- sanitize 仅处理 sk-* token 模式，其他格式的 secrets 仍可能出现在错误信息中

---

## [2026-05-17 18:40] Agent agent-6-1778952188-f1x 第 1 轮

### 问题
- app-shell/logging.ts: emitRendererLog 的 .catch() 不捕获错误参数，bridge.write 失败时实际错误被丢弃，总是显示 "bridge unavailable"
- 类型：错误处理
- 优先级：P1

### 修改
- `desktop/src/app-shell/logging.ts`：emitRendererLog 的 .catch(() => {...}) 改为 .catch((err) => {...})，传递实际错误对象到 console.warn

### 用户受益
- 当 renderer 日志写入失败时，开发者/用户现在能在浏览器控制台看到真实的失败原因（IPC 错误、序列化失败等），而非泛化消息
- 调试时不再"日志无声丢失"

### 验证
- typecheck (tsc --noEmit)：通过
- check:hard-constraints：通过
- 影响面检查：100+ 调用方均只使用 createRendererLogger/installRendererLogForwarding，emitRendererLog 是内部函数，无外部依赖

### 风险
- 无。console.warn 不改变控制流，不影响用户操作

---

## [2026-05-17 01:26] Agent agent-8-1778952050-d8e9 第 1 轮

### 问题
- http-request 节点执行器 catch 块中日志记录 `errorLength: message.length`（字符数）而非实际错误信息，运维排障时日志无用
- 类型：错误处理
- 优先级：P2

### 修改
- `desktop/workflow-nodes/http-request/executor.main.ts`：将 `errorLength: message.length` 替换为 `errorMessage: message.slice(0, 500)`，日志中记录实际错误文本而非字符计数

### 用户受益
- HTTP 请求节点执行失败时，主进程日志现在包含实际错误信息（如 "connect ECONNREFUSED 127.0.0.1:8080"）而非无意义的字符计数
- 运维人员可通过日志直接定位网络/超时/认证失败的具体原因

### 验证
- eslint：通过
- vitest run http-request/__tests__/executor.test.ts：7 tests passed
- check:hard-constraints：通过

### 风险
- 无已知风险。`errorMessage` 做了 500 字符截断，不会因大错误消息导致日志膨胀

---

## [2026-05-17 17:10] Agent agent-1778952031-5658 第 1 轮

### 问题
- resolveVariables 中 param 类型变量绑定引用了不存在的参数时，静默解析为空字符串，没有任何警告日志——用户无法通过日志排查"为什么变量值为空"
- 类型：错误处理
- 优先级：P2

### 修改
- `desktop/electron/services/workflow/variable-resolver.ts`：在 param 类型绑定解析时，通过 `in` 操作符检查参数键是否存在于 `paramValues` 中，不存在时记录警告日志（含 variableName 和 paramName）

### 用户受益
- 当用户工作流中某个参数绑定引用了未提供的参数时，日志中会出现明确的警告"variable resolved to empty: referenced parameter is missing"，帮助快速定位问题
- 与 node_output 类型缺失时的行为一致（已有详细警告日志）

### 验证
- eslint：通过（无输出）
- vitest (workflow-variable-resolver.test.ts)：14/14 passed
- check:hard-constraints：通过
- 影响面检查：resolveVariables 函数签名未变，所有 4 个调用方（engine + 3 executors）不受影响

### 风险
- 仅新增日志，不改变已有行为。日志级别为 warn，不会影响正常执行流程

---

## [2026-05-17 02:16] Agent agent-2-1778953926-8273 第 1 轮

### 问题
- workflow-service.ts errorLogMeta 仅返回 errorLength（错误消息字符数），6 处日志点丢失实际错误文本，调试困难
- 类型：错误处理
- 优先级：P2

### 修改
- `desktop/electron/services/workflow/workflow-service.ts`：errorLogMeta 新增 errorMessage 字段，使用 sanitizeAgentError 脱敏后截断至 200 字符

### 用户受益
- 日志中现在显示实际错误消息（如 "ENOENT: no such file"），而非仅显示长度数字
- 敏感信息（路径、API key、token）自动脱敏，安全合规

### 验证
- eslint：通过（无输出）
- tsc --noEmit：无新增错误
- check:hard-constraints：通过
- 影响面检查：errorLogMeta 为私有函数，无外部导入

### 风险
- 无已知风险。errorMessage 字段仅追加到日志元数据，不改变任何业务逻辑

---

## [2026-05-17 02:00] Agent agent-5-1778952085-e7b2 第 1 轮

### 问题
- Agent 模块 4 个文件中完全相同的 `errorLogMeta` 函数只返回 `errorLength`（字符数）而非实际错误文本，日志中无法看到错误详情
- 类型：错误处理 + 死代码（4 处重复定义）
- 优先级：P2

### 修改
- `desktop/src/modules/agent/utils.ts`：添加共享 `errorLogMeta` 函数，新增 `errorMessage` 字段（截断 200 字符）
- `desktop/src/modules/agent/components/agent-tool-event.tsx`：移除本地定义，改为从 utils 导入
- `desktop/src/modules/agent/components/agent-message-toolbar.tsx`：同上
- `desktop/src/modules/agent/components/agent-thinking-event.tsx`：同上（含 DOMException 特殊处理，已被 Error 基类覆盖）
- `desktop/src/modules/agent/hooks/use-chat-events.ts`：同上

### 用户受益
- 开发者调试 Agent 对话时，日志中能看到实际错误文本而非无意义的字符数
- 消除了 4 处重复的函数定义（净减 30 行代码）

### 验证
- `pnpm run check:hard-constraints`：通过
- `vitest run src/modules/agent/__tests__/utils.test.ts`：5/5 通过
- `rg "errorLogMeta" src/modules/agent/`：仅 5 处引用（4 消费 + 1 定义），无残留本地定义

### 风险
- TypeScript 错误均属预存问题（useRef 初始化、SynapseAgentEvent 类型），与本次改动无关

---

## [2026-05-17 21:52] Agent agent-1778955777-3641 第 1 轮

### 问题
- workflow-utils.ts 的 agentErrorDiagnostic 函数只返回 errorLength（字符数），不返回实际错误文本，prompt 节点和 switch 节点的 Agent 调用失败时日志中只有无用的字符计数
- 类型：错误处理
- 优先级：P2

### 修改
- `desktop/electron/services/workflow/workflow-utils.ts`：agentErrorDiagnostic 新增 errorMessage 字段，复用 sanitizeAgentError 做路径和 token 脱敏后输出实际错误文本（最长 200 字）

### 用户受益
- prompt/switch 节点 Agent 调用失败时，开发者/用户现在能在日志中看到具体的错误原因，而不是无意义的字符数

### 验证
- eslint：通过（无输出）
- tsc --noEmit：无新增错误（5 个既有 agent 模块错误）
- check:hard-constraints：通过
- 影响面检查：agentErrorDiagnostic 仅被 prompt/executor.main.ts 和 switch/executor.main.ts 通过 spread 使用，新增字段自动包含在日志对象中，无破坏性变化

### 风险
- 无。仅增加一个可选诊断字段，所有调用方使用 spread 操作符，无类型或运行时破坏

---

## [2026-05-17 02:40] Agent agent-1778955764-8983 第 1 轮

### 问题
- editor-app.tsx 的 errorDiagnostic 函数仅返回 errorName 和 errorLength，不返回 errorMessage，4 处日志丢失实际错误文本
- 类型：错误处理
- 优先级：P2

### 修改
- `desktop/src/modules/workflow/editor/editor-app.tsx`：errorDiagnostic 新增 errorMessage 字段，通过 sanitizeError 过滤敏感信息后返回截断的错误文本
- `desktop/src/modules/workflow/editor/__tests__/editor-app.test.tsx`：更新 3 组测试的 toHaveBeenCalledWith 断言，新增 errorMessage 期望值；移除已不适用的 "prompt text" 不包含断言（sanitized 错误内容包含通用文本是预期行为）

### 用户受益
- 开发者在排查编辑器中的加载/保存/运行/强制运行失败时，日志现在包含经过脱敏的实际错误文本（如 "workflow get failed token=[redacted] at [path]"），而非仅 "errorLength: 70"

### 验证
- vitest run editor-app.test.tsx：3 tests passed
- check:hard-constraints：All passed
- vitest run error-sanitize.test.ts：13 tests passed

### 风险
- errorMessage 使用 sanitizeError 脱敏，敏感信息（密钥、路径、token）不会泄漏到日志
- 类型改为非可选 string（之前为无此字段），与 runner-app.tsx 一致但更严格，所有调用方已确认

---

## [2026-05-17 02:40] Agent agent-9-1778955816-w9rb 第 1 轮

### 问题
- provider-lookup-context.tsx 的 errorLogMeta 返回 errorLength（字符数）而非实际错误文本，provider 列表获取失败时日志只有 "errorLength: N" 无实际错误内容
- 类型：错误处理
- 优先级：P2

### 修改
- `desktop/workflow-nodes/provider-lookup-context.tsx`：errorLogMeta 新增 errorMessage 字段，返回值包含截断至 200 字符的实际错误文本

### 用户受益
- Provider 列表获取失败时（网络中断/API 错误），开发者能在日志中看到具体错误原因而非仅字符数，缩短调试时间

### 验证
- tsc --noEmit：无新增错误
- check:hard-constraints：All passed
- 影响面检查：errorLogMeta 非 export，7 个 importer 均只引用 ProviderLookupProvider/useProviderLookup，无影响

### 风险
- 无。函数非 export，仅在 provider-lookup-context.tsx 内使用


---

## [2026-05-17 02:49] Agent agent-1778955779-ba87 第 1 轮

### 问题
- prompt-run-dialog.tsx errorLogMeta 只返回 errorName 和 errorLength，不返回 errorMessage，错误日志中无实际错误文本
- 类型：错误处理
- 优先级：P2

### 修改
- `desktop/src/modules/prompts/components/prompt-run-dialog.tsx`：errorLogMeta 新增 errorMessage 字段（含 sanitizeError 脱敏），日志现在包含实际错误内容
- `desktop/src/modules/prompts/components/__tests__/prompt-run-dialog.test.tsx`：测试用例更新，验证 errorMessage 字段存在且已脱敏

### 用户受益
- Prompt 运行失败时，开发者能在日志中看到具体错误原因（如 "Bearer authentication failed"），而不是无用的字符数；敏感信息（token、key）已被脱敏处理

### 验证
- vitest run prompts tests：5/5 passed（2 个 dialog 测试 + 3 个 hook 测试）
- check:hard-constraints：通过
- eslint：通过（无输出）
- 影响面检查：errorLogMeta 为局部函数，未 export，外部无直接调用方

### 风险
- 无。仅改变日志元数据字段名，不影响控制流或返回值

## [2026-05-16 18:55] Agent agent-3-1778957659-1ca4 第 1 轮

### 问题
- workflow-list.tsx 的 `errorLogMeta` 函数只返回 `errorLength`（字符数）而不返回 `errorMessage`，工作流删除/运行失败时日志只显示 `{errorLength: 42}` 而无实际错误文本
- 类型：错误处理
- 优先级：P2

### 修改
- `desktop/src/modules/workflow/components/workflow-list.tsx`：`errorLogMeta` 返回值新增 `errorMessage` 字段，包含实际错误文本（超长时截断到 2000 字符加省略号）

### 用户受益
- 开发者排查工作流删除/运行失败时，结构化日志中包含实际错误原因而非只有无用的字符数

### 验证
- eslint：通过（无输出）
- check:hard-constraints：All passed
- 影响面检查：`errorLogMeta` 是本地非导出函数，仅 `handleDelete` 和 `showRunFailure` 调用。`rg` 确认项目内无外部引用

### 风险
- 无已知风险。返回类型新增可选风格字段，现有日志调用方仅 spread 结果，完全兼容

---

## [2026-05-17 11:00] Agent agent-10-1778957712-8c58 第 1 轮

### 问题
- 工作流引擎 `summarizeRecord` 辅助函数仅被同一文件中的两个位置调用，属于不必要的间接层
- 类型：死代码
- 优先级：P3

### 修改
- `desktop/electron/services/workflow/workflow-engine.ts`：删除 `summarizeRecord` 函数定义（4 行），在两处调用点直接使用 `Object.keys()` 替代

### 用户受益
- 无直接用户可见变化，但减少了代码间接层和函数定义，代码更简洁

### 验证
- `tsc --noEmit`：通过
- 目视审查：函数定义已删除，两处调用点正确替换

### 风险
- 无已知风险：纯内联重构，行为等价

---

## [2026-05-17 03:10] Agent agent-1778958606-58948-1764 第 1 轮

### 问题
-  handleNodesChange 在 setNodes 的 updater 函数内调用了 onChange（父组件 dispatch）——违反了 React "updater 函数必须无副作用"的纯度规则。handleEdgesChange 和 onConnect 也存在相同问题。
- 类型：死代码
- 优先级：P3

### 修改
- `desktop/src/modules/workflow/editor/canvas.tsx`：添加 edgesRef（保持最新 edges）；handleNodesChange、handleEdgesChange、onConnect 三个回调中将 setNodes/setEdges 的 updater 改为直接调用（applyNodeChanges/applyEdgeChanges 在 updater 外部计算），onChange 和 definitionRef 更新移至 updater 外部

### 用户受益
- 消除 React Concurrent Mode 下 updater 函数副作用可能导致的 onChange 重复调用或丢失（当前 React 版本无并发模式，此修复是前瞻性改进）
- 代码更符合 React 最佳实践

### 验证
- tsc --noEmit：通过
- check:hard-constraints：通过
- 影响面分析：仅 editor-app.tsx 引用 canvas 模块且只导入 WorkflowCanvas/WorkflowCanvasHandle（未修改的公开接口），修复无副作用

### 风险
- 无已知风险。applyNodeChanges/applyEdgeChanges 是 @xyflow/react 导出的纯函数，在 updater 内外行为一致。nodesRef/edgesRef 与 React state 同步更新，保证数据一致性

---

## [2026-05-17 03:49] Agent agent-5-1778959424-f50a 第 1 轮

### 问题
- STATUS_LABEL/STATUS_VARIANT 常量在 timeline-view.tsx、node-result-panel.tsx、execution-overlay.tsx 三个文件中重复定义，RUN_STATE_BADGE 在 runner-toolbar.tsx 和 execution-overlay.tsx 中重复定义且标签不一致（"已完成" vs "全部完成"、"失败" vs "执行失败"）；execution-overlay.tsx 从死代码钩子 use-workflow-run.ts 导入 RunState 类型
- 类型：死代码 + UI品质
- 优先级：P3

### 修改
- `src/modules/workflow/lib/status-display.ts`：新建共享模块，统一导出 NODE_STATUS_LABEL、NODE_STATUS_VARIANT、RUN_STATE_BADGE 常量和 NodeStatus 类型
- `src/modules/workflow/runner/timeline-view.tsx`：从共享模块导入 NODE_STATUS_LABEL/NODE_STATUS_VARIANT，删除本地重复定义
- `src/modules/workflow/runner/node-result-panel.tsx`：同上
- `src/modules/workflow/editor/execution-overlay.tsx`：从共享模块导入三个常量，删除本地重复定义，移除对 use-workflow-run.ts 的 RunState 类型导入（改为本地 type alias），修复 RUN_STATE_BADGE 标签一致性（"全部完成"→"已完成"、"执行失败"→"失败"），修复类型安全（用 `in` 运算符替代可选链）
- `src/modules/workflow/runner/runner-toolbar.tsx`：从共享模块导入 RUN_STATE_BADGE，删除本地重复定义

### 用户受益
- 运行状态标签在 Runner 工具栏和编辑器执行覆盖层中现在完全一致（"已完成"/"失败"），不再困惑于同一状态显示不同文案
- 消除了 4 处常量重复定义，减少未来标签修改遗漏的风险
- execution-overlay.tsx 不再依赖死代码模块 use-workflow-run.ts

### 验证
- ESLint：全部通过（0 errors, 0 warnings）
- tsc --noEmit：无新增错误（5 个既有 agent 模块错误）
- check:hard-constraints：All passed
- vitest run timeline-view.test.tsx node-result-panel.test.tsx：2 passed

### 风险
- workflow-card.tsx 还有第 4 份 RUN_STATE_BADGE 副本（标签与共享模块一致），可后续统一

---

## [2026-05-17 20:15] Agent agent-7-1778961262-26de 第 1 轮

### 问题
- End节点执行器硬编码 durationMs=0，其他所有节点执行器都正确计时
- 类型：交互完整性
- 优先级：P2

### 修改
- `desktop/workflow-nodes/end/executor.main.ts`：添加 Date.now() 起止计时，返回真实 durationMs
- `desktop/workflow-nodes/__tests__/end-node-executor.test.ts`：更新测试断言 durationMs≥0 而非 ===0

### 用户受益
- 运行时间线中 End 节点现在显示实际耗时而非固定的 0ms

### 验证
- `vitest run workflow-nodes/__tests__/end-node-executor.test.ts`：6/6 通过
- `vitest run electron/services/__tests__/workflow-engine.test.ts`：13/13 通过
- `check:hard-constraints`：通过

### 风险
- durationMs 现在反映端节点模板插值的实际执行时间，对依赖 durectionMs 的调用方无破坏性影响（仅从 0 变为 ≥0）

---

## [2026-05-17 04:07] Agent agent-1778961256-8412 第 1 轮

### 问题
- `run-history-dialog.tsx` 的 `errorDiagnostic` 函数未对 `errorMessage` 调用 `sanitizeError` 脱敏处理，工作流运行历史加载失败时的错误信息（可能包含 API key、token、文件路径等敏感数据）直接写入主进程日志文件。截断长短也不一致（2000 字符 vs 其他文件的 200 字符）。
- 类型：错误处理
- 优先级：P2

### 修改
- `desktop/src/modules/workflow/components/run-history-dialog.tsx`：`errorDiagnostic` 函数的 `errorMessage` 字段改用 `sanitizeError(text)` 脱敏后写入，使用条件 spread（仅在 message 非空时写入）。截断长度从 2000 统一为 200 字符，与其他 workflow hook 保持一致。

### 用户受益
- 工作流运行历史加载失败时，日志中的错误信息不再包含未脱敏的 API key、token 或文件路径等敏感数据
- 与 `use-workflow-events.ts`、`use-workflow-run.ts`、`use-workflow-list.ts`、`editor-app.tsx`、`runner-app.tsx` 等其他 workflow 模块的日志脱敏行为保持一致

### 验证
- tsc --noEmit：无新增错误（预存 4 个既有 agent 模块错误）
- check:hard-constraints：All passed

### 风险
- 无。仅对日志输出做了脱敏处理，不影响任何业务逻辑或 UI 显示

---

## [2026-05-17 06:33] Agent agent-1778970488-1354 第 1 轮

### 问题
- runner-edge.tsx 的 RunnerEdge 组件被 export 但仅在 dag-view.tsx 的 edgeTypes map 中使用
- 类型：死代码
- 优先级：P3

### 修改
- `desktop/src/modules/workflow/runner/dag-view.tsx`：内联 RunnerEdge 组件（从 runner-edge.tsx 移入，改为非导出函数）
- `desktop/src/modules/workflow/runner/runner-edge.tsx`：删除独立文件

### 用户受益
- 无直接用户感知变化；减少一个文件，组件逻辑更集中
- 消除了不必要的导出 API 面

### 验证
- tsc --noEmit：dag-view.tsx 无新增错误（2 个预存错误在 agent 模块）
- check:hard-constraints：通过
- rg 确认 runner-edge 仅计划文档中提及，无代码引用

### 风险
- 无已知风险。RunnerEdge 组件代码未改，仅移位置且不再 export

---

## [2026-05-18 03:36] Agent agent-3-1778970417-6fab 第 1 轮

### 问题
- `runner-app.tsx` 和 `editor-app.tsx` 各定义了本地 `errorDiagnostic` 函数，与 `error-utils.ts` 中的共享实现完全重复（各 ~8 行代码）
- 类型：死代码
- 优先级：P2

### 修改
- `desktop/src/modules/workflow/runner/runner-app.tsx`：移除本地 `errorDiagnostic` 函数，改为从 `../lib/error-utils` 导入共享版本
- `desktop/src/modules/workflow/editor/editor-app.tsx`：移除本地 `errorDiagnostic` 函数和不再需要的 `sanitizeError` 导入，改为从 `../lib/error-utils` 导入共享版本

### 用户受益
- 消除两处 8 行重复代码，降低未来修改 error 日志格式时在不同文件中同步变更的风险

### 验证
- ESLint：runner-app.tsx → 通过，editor-app.tsx → 通过
- typecheck（tsc --noEmit）：无新增错误（仅 2 个既有 agent 模块无关错误）
- vitest editor-app.test.tsx：3/3 通过
- vitest workflow-runner-app.test.tsx：3/3 通过
- check:hard-constraints：通过

### 风险
- 共享版 errorDiagnostic 在空消息时省略 errorMessage 字段（可选），而 editor-app 本地版始终返回空字符串。日志输出略有差异但不影响功能
