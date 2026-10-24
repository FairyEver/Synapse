# 移除 Synapse 私有存储保护验收记录

日期：2026-10-24（北京时间）。用户明确要求移除 Synapse 私有存储保护以避免兼容性问题。

## 交付范围

- 移除 SDK 私有目录 deny rules、强制 sandbox / managedSettings、设置核验及文件工具专用预检。
- 移除 SDK、终端、登录 shell、Git、脚本与工作流执行的 OS 沙箱包装，以及公共参数和权限层的私有路径专用拦截。
- HTML 渲染恢复一次性 Worker Thread；原有权限审计、资源限制和取消流程保留。
- Terminal capabilities 移除 privateStorageProtection 字段；公开工具与能力数量不变。
- 保留普通工具审批、Persona/子 Agent 策略、项目写入边界、PermissionGuard/AuditSink、邮箱登录身份检查、凭据原有加密和日志脱敏。用户自己的 SDK 沙箱配置不修改。

## 验证

- 红绿回归：项目服务不得再向 SDK 会话注入 privateStorageRoots；修改前精确失败，修改后通过。
- Agent 专项：3 文件、135 项通过。
- 进程执行、安全权限、终端、脚本、HTML、邮箱账号、Action Router 和 Agent 专项：44 文件、628 项通过（maxWorkers=4）。
- 完整 desktop typecheck、改动 TypeScript 文件 ESLint、check:hard-constraints、check:ipc-codegen、git diff --check 通过。
- 完整 desktop test 已执行：1095 文件通过、8 文件失败、2 文件跳过；11251 项通过、25 项失败、2 项跳过。失败清单见下节。未执行改动前的完整基线对照，不宣称这些失败全部已证明是既有问题，也不宣称全量通过。
- check:packaged-asar 已执行，但现有 electron44-security-candidate 安装包缺少 agent-openui-reference.md，检查失败。旧包内 JSON Repair、文本提取、HTML Worker、PTY smoke 通过仅说明该旧包对应结构，不能证明本次代码已装入候选包。
- 未启动桌面应用、真实 Agent 查询或浏览器；未打包、发布、部署或重启用户进程。Windows/Linux 未做实机验收。

## 全量测试失败清单

-  tests/unit/packaged-asar.test.ts > packaged asar verification > rejects a Windows package whose executable is missing
-  tests/unit/packaged-asar.test.ts > packaged asar verification > verifies a Windows-style resources directory with unpacked files
-  tests/unit/packaged-asar.test.ts > packaged asar verification > rejects a macOS bundle with valid resources but no candidate executable
-  tests/unit/packaged-asar.test.ts > packaged asar verification > accepts unpacked usage analysis workers with model price directory dependencies
-  electron/bootstrap/__tests__/descriptors.test.ts > bootstrap descriptors (T1.5) > coreDatabaseDescriptor is degraded, depends on config, event bus, automation, and action runtime, has stop
-  electron/bootstrap/__tests__/registry.test.ts > buildServiceRegistry (T1.8) > registers all bootstrap services with correct dependsOn graph
-  electron/services/__tests__/mobile-workspace-files-service.test.ts > mobile workspace Git uses real bounded readonly repositories > reads multiple baselines beside unrelated loose objects within independent budgets
-  electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts > AgentRuntimeService cancelTurn > hard-kills a live session that does not support graceful cancel
-  electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts > AgentRuntimeService cancelTurn > forceKillTurn closes live session after graceful pending
-  electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts > AgentRuntimeService cancelTurn > logs cancel and force-kill outcomes with SDK session correlation
-  electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — per-conversation state isolation > two conversations get independent state objects
-  electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — per-conversation state isolation > state is keyed by conversationId, not composite key
-  electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — per-conversation state isolation > deleting one conversation state does not affect another
-  electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — SDK session factory > uses the injected SDK session factory
-  electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — idle session reclaim > closes liveSession after 10 minutes of inactivity
-  electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — idle session reclaim > does NOT close liveSession if activity is recent
-  electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — idle session reclaim > does NOT close liveSession if session is busy
-  electron/services/agent-runtime/__tests__/conversation-router.test.ts > ConversationRouter > returns streamed SDK text as side session partial text when the relay times out
-  electron/services/agent-runtime/__tests__/conversation-router.test.ts > ConversationRouter > uses a one-hour default permission wait before auto-denying
-  electron/services/agent-runtime/__tests__/conversation-router.test.ts > ConversationRouter > prepares new side live session messages while preserving relay history
-  electron/services/agent-runtime/__tests__/conversation-router.test.ts > ConversationRouter > persists a terminal error when a side session relay times out
-  electron/services/agent-runtime/__tests__/conversation-router.test.ts > ConversationRouter > closes the SDK session when a side session times out
-  electron/services/agent-runtime/__tests__/conversation-router.test.ts > ConversationRouter > does not create an SDK session for a queued turn that already aborted
-  src/modules/agent/__tests__/agent-conversation-workspace.test.tsx > AgentConversationWorkspace > shows the shared context indicator in embedded mode
-  src/modules/agent/__tests__/agent-conversation-workspace.test.tsx > AgentConversationWorkspace > shows the shared context indicator in window mode

## 生效与回滚

这是源码修改，当前运行应用未替换。使用包含本次修改的版本后，重建 SDK/终端等执行进程才能去除旧进程继承的 OS 限制；不自动终止已有用户任务。需要回滚时可撤回本次独立提交并重新构建、重建执行进程。

移除后，当前系统用户有权限的本机文件不再受到 Synapse 额外路径隔离。此决定不取消业务接口的账号范围，也不授予任意读取或修改真实业务数据的授权。
