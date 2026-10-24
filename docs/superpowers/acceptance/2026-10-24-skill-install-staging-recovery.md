# Skill 暂存回收验收（2026-10-24）

## 结论与历史证据边界

正常安装的 rename 与普通错误的 catch 都存在，真实缺口是进程中断不执行清理，以及没有后续回收。旧逻辑在 skills 根直接写 SKILL.md，使中断副本被当作 Skill 加载。两份旧目录都带 synapse-skill 身份和旧指纹，其中一份附件不完整；日志已轮转，不能确定历史具体退出事件。

## 已验证

- 测试先红后绿：在进行中的安装不暴露顶层 SKILL.md；真实生产 installer 经 esbuild 打包，在附件填充阶段及 transaction.json 只写一半时强杀子进程。进程活着不清理，退出后移入模拟废纸篓，正式安装和暂存文件字节保留；再次回收无重复动作。
- 以 PID 命名容器覆盖标记未创建/写入中断窗口；保留同文件系统原子替换、.env 并发验证和 backup 恢复策略。
- 10 个专项文件 108 项通过，涵盖写入 helper、回收、安全安装、prepared/clone source、身份读取、.env materializer、Skill 索引和 overrides，以及真实 native SDK 初始化。
- 追加 native SDK 实测：payload/SKILL.md 在未启用过滤时也不会成为命令；直接放在新旧暂存入口的重复声明过滤前 4 份，过滤后仅正式 1 份，普通 Skill 保留。无真实模型请求。
- 后台 descriptor 的真实文件移动集成测试通过，使用真实 PermissionGuard/AuditSink，只替换 OS 废纸篓端口；启动阶段明确为 background。
- 主进程与测试 TypeScript 检查、check:hard-constraints 通过。独立审查两项 P2（标记写入中断、测试读取私有审计字段）均修正并重验，无剩余确认的 P1/P2。

## 本机真实 SY

正在运行的开发 SY 热重载后，2026-10-24 21:48:10 的 registry.editor-install-recovery 日志报告成功回收两份指定旧目录。直接复查：两者已离开 ~/.claude/skills，存在于系统废纸篓；正式 synapse-skill/SKILL.md 和身份仍存在。生产 AuditSink 留有 recover-install-staging 的 allowed 事件。其它任务同时更新系统 Skill 包，故不声称正式包跨整个任务逐字节不变；本回收服务只移动暂存目录。

本机证据在 work/agent-context-audit/staging-recovery-real-desktop.json；详细日志 staging-recovery-focused-final.log、staging-recovery-native-startup-final.log（native 通过，启动检查曾受并行导入变化影响）、staging-recovery-startup-final.log（最终通过）、staging-recovery-electron-types-final.log、staging-recovery-test-types-verified.log、staging-recovery-hard-constraints-final.log。

## 全量验证的限制与失败明细

实际运行 pnpm --filter @synapse/desktop run test --maxWorkers=4：1108 个文件，11273 项通过、23 项失败、3 项跳过。该轮运行时正在补“写标记中断”的 RED 回归，因此其中 1 项属于已修正的新缺口，最终专项已通过。其余失败涉及打包夹具未补 OpenUI 资源、bootstrap 清单断言、Agent 上下文显示断言和生命周期异步时序；没有将全量写为通过。

尝试以 Git HEAD 源码作只读 Vite transform 对照，但另一并行任务正在移除私有存储模块，旧快照引用当时已删除的模块，导致导入失败，因此该对照不作为有效基线证明。后续在当前工作区重新运行了本次专项、后台启动测试和主进程/测试类型检查。并行任务的业务变更未纳入本次提交；未为获得绿色而放宽或删除以下断言。

首次全量失败逐项保留：

- tests/unit/packaged-asar.test.ts > packaged asar verification > rejects a Windows package whose executable is missing
- tests/unit/packaged-asar.test.ts > packaged asar verification > verifies a Windows-style resources directory with unpacked files
- tests/unit/packaged-asar.test.ts > packaged asar verification > rejects a macOS bundle with valid resources but no candidate executable
- tests/unit/packaged-asar.test.ts > packaged asar verification > accepts unpacked usage analysis workers with model price directory dependencies
- electron/bootstrap/__tests__/descriptors.test.ts > bootstrap descriptors (T1.5) > coreDatabaseDescriptor is degraded, depends on config, event bus, automation, and action runtime, has stop
- electron/bootstrap/__tests__/registry.test.ts > buildServiceRegistry (T1.8) > registers all bootstrap services with correct dependsOn graph
- electron/services/__tests__/editor-install-staging-recovery.test.ts > editor install staging recovery > recovers a real installation killed during marker-write, without changing the installed Skill
- src/modules/agent/__tests__/agent-conversation-workspace.test.tsx > AgentConversationWorkspace > shows the shared context indicator in embedded mode
- src/modules/agent/__tests__/agent-conversation-workspace.test.tsx > AgentConversationWorkspace > shows the shared context indicator in window mode
- electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts > AgentRuntimeService > routes concurrent permission responses to their own SDK sessions
- electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — per-conversation state isolation > two conversations get independent state objects
- electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — per-conversation state isolation > state is keyed by conversationId, not composite key
- electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — per-conversation state isolation > deleting one conversation state does not affect another
- electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — SDK session factory > uses the injected SDK session factory
- electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — idle session reclaim > closes liveSession after 10 minutes of inactivity
- electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — idle session reclaim > does NOT close liveSession if activity is recent
- electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts > AgentRuntimeService — idle session reclaim > does NOT close liveSession if session is busy
- electron/services/agent-runtime/__tests__/conversation-router.test.ts > ConversationRouter > returns streamed SDK text as side session partial text when the relay times out
- electron/services/agent-runtime/__tests__/conversation-router.test.ts > ConversationRouter > uses a one-hour default permission wait before auto-denying
- electron/services/agent-runtime/__tests__/conversation-router.test.ts > ConversationRouter > prepares new side live session messages while preserving relay history
- electron/services/agent-runtime/__tests__/conversation-router.test.ts > ConversationRouter > persists a terminal error when a side session relay times out
- electron/services/agent-runtime/__tests__/conversation-router.test.ts > ConversationRouter > closes the SDK session when a side session times out
- electron/services/agent-runtime/__tests__/conversation-router.test.ts > ConversationRouter > does not create an SDK session for a queued turn that already aborted

## 清理边界与回滚

新容器只有 PID 明确不存在才回收；旧无标记副本至少 24 小时、可验证 SY 身份且正式安装存在才回收，空旧容器也等待 24 小时。活进程、PID 重用、权限不明、未知内容、符号链接和恢复 backup 保留；移入废纸篓而非永久删除，失败下次启动重试。旧兼容目录不携带 PID，年龄/身份为保守兼容判断，不能证明其历史退出原因。原生废纸篓实际验收在 macOS 完成，其他平台依赖 Electron 同一接口。

回滚本次提交恢复旧安装行为；已回收材料可从废纸篓恢复，不自动移回可加载位置。没有新增依赖、修改 Claude Code 全局配置或发布应用。
