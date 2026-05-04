# 内测前全栈稳定性审计 — 设计文档

## 背景

Synapse 即将开始团队内部小范围使用。通过对渲染进程、IPC 通信层、主进程三个维度的全栈审计，发现了一批可能导致白屏、崩溃、数据丢失或功能中断的稳定性问题。本文档定义修复范围、方案和优先级。

## 修复范围

分两批：第一批为内测前必须修复（P0 全部 + 高影响 P1），第二批为内测后跟进。

---

## 第一批：内测前必须修复

### F1. 添加 ErrorBoundary 体系

**问题**：整个渲染进程没有任何 ErrorBoundary。React render 阶段的任何未捕获异常会卸载整棵组件树，用户看到白屏且只能重启。独立内容详情窗口同样没有保护。

**修复方案**：

- `main.tsx` Provider 树外层添加全局 ErrorBoundary，提供"重新加载"按钮
- 每个 tab 模块（Agent、DataStore、EditorScan、Settings、Rules、Skills、Prompts、Content）外层各加模块级 ErrorBoundary，隔离模块崩溃不影响其他 tab
- `ContentDetailWindowPage` 添加独立窗口级 ErrorBoundary
- ErrorBoundary 组件复用 shadcn Card + Button，展示错误摘要和重试操作

**涉及文件**：
- `src/main.tsx`
- `src/app-shell/` 中 tab 路由处
- `src/modules/content/components/content-detail-window-page.tsx`
- 新建 `src/components/error-boundary.tsx`

### F2. 修复 requireSynapseBridge 同步抛出

**问题**：`DataStoreModule`、`LogExportPanel`、`EditorDirectoriesPanel`、`use-agent-chat` 等多处在 useEffect 中直接调用 `requireSynapseBridge()`。bridge 不可用时同步抛出，不被 Promise `.catch()` 捕获，无 ErrorBoundary 时直接白屏。

**修复方案**：

- 所有 useEffect 内的 `requireSynapseBridge()` 调用改为 `getSynapseBridge()` + null check + early return
- 或包裹在 try/catch 中，catch 中设置组件错误状态
- 有了 F1 的 ErrorBoundary 后，即使遗漏也不会白屏，但仍应在源头防御

**涉及文件**：
- `src/modules/data-store/index.tsx:343`
- `src/modules/agent/hooks/use-agent-chat.ts:511`
- `src/modules/settings/components/log-export-panel.tsx:73`
- `src/modules/settings/components/editor-directories-panel.tsx:72`
- `src/modules/agent/index.tsx:138`（openReference）

### F3. Git 操作添加超时

**问题**：`repository-maintenance-service` 的 `pullWithRebase` 和 `pushRepository` 没有超时。`repository-store` 的 `runGitProbe`（被 18+ 处调用）直接 spawn git 无超时。git 进程挂起会阻塞整个调用链。

**修复方案**：

- `runMaintenanceGitCommand` 添加 `timeoutMs` 参数，默认 60s，与 `content-submission-service` 对齐
- `runGitProbe` 添加 15s 超时（本地操作不需要太长）
- maintenance service 的 `pullWithRebase` 在 catch 中调用 `abortRebaseIfNeeded`，与 `content-submission-service` 的实现对齐
- push retry 路径中的 `pullWithRebase` 同样加超时

**涉及文件**：
- `electron/services/repository-maintenance-service.ts`（pullWithRebase、pushRepository、retry 路径）
- `electron/services/repository-store.ts`（runGitProbe）

### F4. sync/push 共享互斥锁

**问题**：`repositoryGitService.syncRepository()` 使用 `activeOperations` Map，`contentSubmissionService.flushPendingPushes()` 使用 `pendingPushChains` Map。两个锁完全独立，可以同时操作同一个 `.git/index`，导致 `index.lock` 冲突。

**修复方案**：

- 提取一个 per-repository 的共享互斥锁（如 `RepositoryLockManager`），sync 和 push 都通过它获取锁
- 锁粒度为 repository UUID，不同仓库可并行
- 现有的 `activeOperations` 和 `pendingPushChains` 改为在共享锁内部执行
- 锁获取应有超时（如 30s），避免死锁

**涉及文件**：
- 新建 `electron/services/repository-lock-manager.ts`
- `electron/services/repository-git-service.ts`（runExclusive 改用共享锁）
- `electron/services/content-submission-service.ts`（runPushExclusive 改用共享锁）

### F5. RepositoryManager 初始化失败处理

**问题**：`manager.initialize()` 失败后只 log，`isReady` 永远为 false，但子组件仍然渲染。整个应用看起来正常但仓库功能全部不可用，无错误提示。

**修复方案**：

- `RepositoryManagerProvider` 增加 `initError` 状态
- 初始化失败时展示错误状态 + 重试按钮，不渲染 children
- 重试按钮调用 `manager.initialize()` 重新初始化

**涉及文件**：
- `src/app-shell/repository.tsx`

### F6. 退出时 flush 并行化 + 独立超时

**问题**：`before-quit` 中多个仓库的 `flushPendingPushes` 顺序执行共享 15s 超时。一个仓库的 push 卡住，剩余仓库的 pending push 全部丢失。

**修复方案**：

- 改为 `Promise.allSettled` 并行执行所有仓库的 flush
- 每个仓库的 flush 独立包裹 `Promise.race` 超时（如 5s）
- 全局超时保留作为兜底

**涉及文件**：
- `electron/bootstrap/before-quit.ts`

### F7. IdentityGate error 状态添加重试

**问题**：身份加载失败时只显示错误文本，无任何操作按钮。IdentityGate 包裹整个 App，用户被永久卡住。

**修复方案**：

- error 状态添加"重试"按钮，点击后重新调用身份加载
- 按钮使用 shadcn Button，与 `needs-recovery` 状态的 UI 风格一致

**涉及文件**：
- `src/app-shell/components/identity-gate.tsx`

### F8. ContentDetailDialog 保存流程修复

**问题**：`handleSave` 先关闭弹窗再异步保存。保存失败时编辑内容已不可恢复。

**修复方案**：

- 保存期间保持弹窗打开，显示 saving 状态，禁用关闭和提交按钮
- 保存成功后再关闭弹窗
- 保存失败时保持弹窗打开，显示错误提示，用户可重试或修改后重试

**涉及文件**：
- `src/modules/content/components/content-detail-dialog.tsx`

### F9. backgroundPush 失败自动重试

**问题**：push 失败后不自动重试。如果用户不再编辑内容，pending pushes 永远不会被推送。

**修复方案**：

- push 失败后启动指数退避重试（如 5s → 15s → 45s，最多 3 次）
- 重试期间 UI 显示重试状态
- 所有重试失败后停止，等待用户手动触发或下次编辑触发

**涉及文件**：
- `electron/modules/content/ipc.ts`（scheduleBackgroundPush）

---

## 第二批：内测后跟进

### P1 级别

| 编号 | 问题 | 文件 |
|------|------|------|
| S1 | 新 IpcModule 系统缺少 sender 验证 | `electron/runtime/ipc/electron-adapter.ts` |
| S2 | rawSQL 系统表保护正则可绕过 | `electron/data-store/service.ts` |
| S3 | ScheduledTasksPanel loading 状态卡死 | `src/modules/settings/components/scheduled-tasks-panel.tsx` |
| S4 | scheduler runScheduled 无 try/catch | `electron/services/scheduler/scheduler-service.ts` |
| S5 | content-install 备份路径固定后缀 | `electron/services/content-install-service.ts` |
| S6 | data-store handlers 缺少 Zod 请求验证 | `electron/data-store/ipc-handlers.ts` |
| S7 | content 模块大量 z.any() 绕过验证 | `electron/modules/content/ipc.ts` |

### P2 级别

| 编号 | 问题 |
|------|------|
| S8 | IPC 调用无全局超时机制 |
| S9 | EventBus coalesce 可能丢失中间状态 |
| S10 | 多窗口间 content 数据不同步 |
| S11 | fire-and-forget 模式吞掉错误（log.write、shell.showItemInFolder） |
| S12 | HTTP server CORS 设为 `*` |
| S13 | fs.watch 错误静默吞掉 |
| S14 | 更新检查间隔 60s 过短 |
| S15 | Map 对象 IPC 序列化风险 |
| S16 | void async 未处理 rejection |
| S17 | Agent onEvent 监听器因 sessions 依赖频繁重注册 |
| S18 | ActiveRepositorySwitchProvider 验证失败无恢复 UI |
| S19 | 并发 content 操作导致 pending push 计数闪烁 |

---

## 不做的事

- 不重构 IPC 架构（只修补当前问题）
- 不引入新的状态管理方案
- 不改变现有的 Git 操作流程设计
- 不做 UI 视觉改版
