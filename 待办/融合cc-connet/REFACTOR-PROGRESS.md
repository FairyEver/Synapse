---
spec: 架构前置改造建议.md
spec_revision: 2
branch: feat/phase-0/architecture-foundation-20260425
mode: autonomous
started_at: 2026-04-25T11:30:00+08:00
last_updated: 2026-04-25T12:48:00+08:00
current_phase: 0.6
current_task: T6.6
status: in_progress
task_counts:
  total: 71
  completed: 47
  blocked: 11
  pending: 13
audit:
  rounds: 0
  last_status: not_started
---

# 重构进度（无人值守模式）

## 任务清单

### Phase 0.1 ServiceRegistry（9 任务）

- [x] T1.1 建 desktop/electron/runtime/service-registry/ 骨架 + types.ts + errors.ts
- [x] T1.2 实现 topo.ts 拓扑排序 + 单测（含循环检测）
- [x] T1.3 实现 registry.ts register/inspect + 单测
- [x] T1.4 实现 startAll/stopAll 含超时控制 + 单测
- [x] T1.5 迁移 core.config / core.logging 为 ServiceDescriptor
- [x] T1.6 迁移 core.data-store / core.update / core.app-icon 为 ServiceDescriptor
- [x] T1.7 迁移 repo.watch / repo.maintenance / repo.pending-pushes / ui.tray 为 ServiceDescriptor
- [x] T1.8 改写 desktop/electron/main.ts 为 registry 启停钩子（< 120 行）
- [x] T1.9 Phase 0.1 集成测试

### Phase 0.2 DataRepository（14 任务）

- [x] T2.1 建 runtime/data-repo/ 类型 + DataNamespace 抽象 + 单测
- [x] T2.2 实现 JsonBackend + 原子写 + 单测
- [x] T2.3 实现 EncryptedJsonBackend + 单测
- [x] T2.4 实现 JsonLinesBackend + 单测
- [x] T2.5 实现 SqliteBackend 包装现有 data-store + 单测
- [x] T2.6 实现 Migration 框架 + NamespaceSchema + 单测
- [x] T2.7 迁移 core.config namespace + v0→v1 迁移脚本 + 迁移测试
- [x] T2.8 迁移 core.identity / repo.pending-pushes / repo.repositories
- [x] T2.9 预留 secrets / providers / projects / connectors / conversations / audit / outbox 等 namespace schema
- [x] T2.10 实现 BackupStrategy + BackupRegistry + local-zip 默认实现
- [x] T2.11 实现 NamespaceExporter + ExporterRegistry 骨架
- [x] T2.12 实现 LayeredConfig 接口占位 + 单测
- [x] T2.13 改写 config-backup-service.ts 走 DataRepository.exportAll/importAll
- [x] T2.14 Phase 0.2 集成测试

### Phase 0.3 IPC Codegen + WindowManager + NetworkServiceRegistry（16 任务）

- [x] T3.1 建 runtime/ipc/ 类型定义 + errors
- [x] T3.2 实现 IpcRegistry 运行时 + zod validation + 单测
- [x] T3.3 写 scripts/generate-ipc.ts + codegen 测试
- [ ] T3.4 迁移 shell / cli / identity / user-profile 为 IpcModule (deferred → REPORT 3.2)
- [ ] T3.5 迁移 log / update / editor-scan / editor 为 IpcModule (deferred → REPORT 3.2)
- [ ] T3.6 迁移 config / repository 为 IpcModule (deferred → REPORT 3.2)
- [ ] T3.7 迁移 content 为 IpcModule (deferred → REPORT 3.2)
- [ ] T3.8 迁移 data-store 为 IpcModule (deferred → REPORT 3.2)
- [ ] T3.9 删旧 channels.ts / *-handlers.ts / types/bridge.ts (deferred → REPORT 3.2)
- [ ] T3.10 改写 preload.ts 为 export * from "../generated/preload.generated" (deferred → REPORT 3.2)
- [x] T3.11 引入 IPC_PROTOCOL_VERSION 握手 + 单测
- [x] T3.12 建 runtime/window/ WindowManager + 迁移 createMainWindow (T3.12 builds the runtime; createMainWindow consumer migration deferred per REPORT 3.2)
- [ ] T3.13 迁移 contentWindowService 到 WindowManager (deferred → REPORT 3.2)
- [ ] T3.14 替换所有 BrowserWindow.getAllWindows() 为 WindowManager.broadcast (deferred → REPORT 3.2)
- [x] T3.15 建 runtime/network/ NetworkServiceRegistry 骨架 + 单测
- [x] T3.16 Phase 0.3 集成测试 + codegen CI 闸门脚本

### Phase 0.4 EventBus（8 任务）

- [x] T4.1 建 runtime/event-bus/ 类型 + bus 核心实现 + 单测
- [x] T4.2 实现 scope 过滤 + WindowManager 广播桥接
- [x] T4.3 实现 coalesce 背压策略 + 单测
- [x] T4.4 渲染端 src/runtime/event-bus-client.ts + EventRouter
- [ ] T4.5 迁移 5 个现有事件到 domain+type 模型 (deferred → REPORT 3.2)
- [ ] T4.6 删旧 sendToRenderer 辅助函数 (deferred → REPORT 3.2)
- [x] T4.7 预留 EventBusBridge / EventRecorder 接口占位
- [x] T4.8 Phase 0.4 集成测试

### Phase 0.5 ProjectContainer + ProcessRuntime（7 任务）

- [x] T5.1 建 runtime/project-container/ 类型 + registry 骨架 + 单测
- [x] T5.2 实现 ScopedEventBus + ProjectScopedDataRepo + 单测
- [x] T5.3 实现 idle-reaper 全局服务
- [x] T5.4 渲染端 app-shell/active-project.tsx + use-active-project.ts
- [x] T5.5 建 runtime/process/ ProcessRuntime 接口 + main 直跑实现 + 单测
- [x] T5.6 建 runtime/runtime-mode.ts + bootstrap.ts
- [x] T5.7 Phase 0.5 集成测试

### Phase 0.6 工程规范与可观测性（17 任务）

- [x] T6.1 实现 runtime/logging/ StructuredLogger + 轮转 + 单测
- [x] T6.2 实现 runtime/observability/metrics.ts MetricsRegistry + 单测
- [x] T6.3 实现 runtime/observability/tracer.ts Tracer + Span + 单测
- [x] T6.4 实现 runtime/observability/health.ts HealthCheckAggregator + 单测
- [x] T6.5 实现 runtime/observability/diagnostics.ts DiagnosticsCollector + 单测
- [ ] T6.6 实现 runtime/security/permission-guard.ts + 默认策略 + 单测
- [ ] T6.7 实现 runtime/security/audit-sink.ts + 单测
- [ ] T6.8 实现 runtime/scheduling/ TaskQueue + RateLimiter + CircuitBreaker + 单测
- [ ] T6.9 实现 runtime/extension/ ExtensionRegistry + ExtensionPoint + 单测
- [ ] T6.10 迁移 content types / editors / editor-scan providers 到 ExtensionPoint
- [ ] T6.11 实现 desktop/src/runtime/i18n.ts + theme.ts 接口占位
- [ ] T6.12 实现 desktop/src/runtime/debug-panel.tsx 骨架（dev-only）
- [ ] T6.13 建 desktop/tests/{unit,ipc,perf,fuzz,e2e}/ 目录 + fixture 工具 + 示例测试
- [ ] T6.14 加 ESLint 规则（禁 modules 互相 import）+ 确认 lint 通过
- [ ] T6.15 更新 AGENTS.md 硬约束段
- [ ] T6.16 更新 .github/workflows/ci.yml 加入 codegen diff 闸门 + grep 硬约束扫描
- [ ] T6.17 Phase 0.6 集成测试 + 全量回归

## 当前任务

- task: T2.2
- started_at: 2026-04-25T12:00:00+08:00
- status: in_progress

## 已完成

### T1.1 建 service-registry 骨架 + types.ts + errors.ts
- completed_at: 2026-04-25T11:35:00+08:00
- commit: 229b7ed

### T1.2 拓扑排序 (topo.ts) + 9 个单测
- completed_at: 2026-04-25T11:38:00+08:00
- commit: e8e8659

### T1.3 ServiceRegistry register/inspect/get/has/planStartOrder
- completed_at: 2026-04-25T11:42:00+08:00
- commit: 22f7c87

### T1.4 ServiceRegistry startAll/stopAll/reload + 超时控制
- completed_at: 2026-04-25T11:45:00+08:00
- commit: 1b281db

### T1.5 core.config / core.logging 为 ServiceDescriptor
- completed_at: 2026-04-25T11:48:00+08:00
- commit: ae2096e

### T1.6 core.data-store / core.update / core.app-icon 为 ServiceDescriptor
- completed_at: 2026-04-25T11:51:00+08:00
- commit: 4daabde

### T1.7 repo.watch / repo.maintenance / repo.pending-pushes / ui.tray 为 ServiceDescriptor
- completed_at: 2026-04-25T11:53:00+08:00
- commit: 761e6da

### T1.8 改写 main.ts 为 registry 启停钩子（< 120 行）
- completed_at: 2026-04-25T11:55:00+08:00
- commit: 3f7a146

### T1.9 Phase 0.1 集成测试（lifecycle full-graph）
- completed_at: 2026-04-25T11:57:00+08:00
- commit: c25b35a
- files_changed:
  - desktop/tests/unit/phase-0.1-integration.test.ts (new, 2 tests)
- tests_passed: 52 / 52
- typecheck: passed
- 验证: 9 个合成 descriptor 跑完 startAll → 全 running → stopAll(15000) → 全 stopped；
  start 拓扑顺序、stop 反向拓扑顺序、deadline < 15s 都被断言

## Phase 记录

### Phase 0.1 完成
- 时间: 2026-04-25T11:35:00 → 11:57:00 (约 22 分钟)
- 完成任务: T1.1–T1.9 (9/9)
- commit: 229b7ed → 即将填入 T1.9 (共 9 个 commit)
- 总测试数: 52 通过
- main.ts: 326 行 → 107 行（< 120 SPEC 阈值）
- 新建目录: desktop/electron/runtime/service-registry/, desktop/electron/bootstrap/, desktop/tests/unit/
- 关键产物:
  - ServiceRegistry：拓扑启停 + 超时 + reload + degraded 收集
  - 9 个 ServiceDescriptor 包装现有 services（保留单例内部）
  - main.ts 收敛为 lifecycle orchestrator
  - 测试基础设施（vitest + zod + tsconfig.test.json）
- main.ts: 326 → 107 行
- files_changed:
  - desktop/electron/main.ts (rewrite to 107 lines)
  - desktop/electron/bootstrap/registry.ts (new, buildServiceRegistry + StructuredLogger adapter)
  - desktop/electron/bootstrap/main-window.ts (extracted)
  - desktop/electron/bootstrap/singleton-lock.ts (extracted)
  - desktop/electron/bootstrap/before-quit.ts (extracted; reuses registry.stopAll)
  - desktop/electron/bootstrap/ipc-handlers.ts (single registerAllIpcHandlers)
  - desktop/electron/bootstrap/app-events.ts (process logging + second-instance + activate)
  - desktop/electron/bootstrap/index.ts (re-export everything)
  - desktop/electron/bootstrap/__tests__/registry.test.ts (3 new tests on graph shape)
- tests_passed: 50 / 50
- typecheck: passed
- 设计要点:
  - main.ts 仅 orchestrate：单实例锁 → IPC handlers → registry.startAll → 创建主窗口 → before-quit
  - before-quit 复用 registry.stopAll(15000) 实现服务的反向拓扑关闭
  - webContents.send（仓库消失广播）刻意保留在 main.ts 直到 Phase 0.4 用 EventBus 替换
- files_changed:
  - desktop/electron/bootstrap/descriptors.ts (extend with 4 new descriptors)
  - desktop/electron/bootstrap/index.ts (export them)
  - desktop/electron/bootstrap/__tests__/descriptors.test.ts (5 new tests)
- tests_passed: 47 / 47
- typecheck: passed
- 设计要点:
  - repoWatch.create: 遍历 config.repositories 调用 watchRepository（mirror main.ts:213）
  - repoWatch.stop: unwatchAll
  - repoMaintenance 依赖 repoWatch（保持 SPEC 拓扑）
  - ui.tray 用 createUiTrayDescriptor(callback) 工厂模式，T1.8 时把 showOrCreateMainWindow 注入
- files_changed:
  - desktop/electron/bootstrap/descriptors.ts (extend)
  - desktop/electron/bootstrap/index.ts (extend barrel)
  - desktop/electron/bootstrap/__tests__/descriptors.test.ts (mock electron-updater + 4 new tests)
- tests_passed: 43 / 43
- typecheck: passed
- 设计要点:
  - core.data-store 依赖 core.config，包含 stop（调用 shutdownDataStore）
  - core.update 依赖 core.config；UpdateService 没有显式 stop（auto-check timer 进程退出时清理）
  - core.app-icon 无依赖、无 stop（initializeAppIcon 内部已防重入）
- files_changed:
  - desktop/electron/bootstrap/descriptors.ts (new)
  - desktop/electron/bootstrap/index.ts (new barrel)
  - desktop/electron/bootstrap/__tests__/descriptors.test.ts (new, 3 tests)
- tests_passed: 40 / 40 (全量)
- typecheck: passed
- 设计要点:
  - `bootstrap/` 是「胶水层」，runtime/ 保持纯 infra（不依赖 services/）
  - 每个 descriptor 仍返回原有模块级单例（SPEC §4 Step 2 明确要求）
  - 测试 mock 了 `electron` 模块，可在 vitest 的 node 环境运行
- files_changed:
  - desktop/electron/runtime/service-registry/registry.ts (full lifecycle impl)
  - desktop/electron/runtime/service-registry/__tests__/lifecycle.test.ts (new, 11 tests)
  - desktop/electron/runtime/service-registry/__tests__/registry.test.ts (replace stub-throw tests with empty-registry happy-path tests)
- tests_passed: 37 / 37 (全量)
- typecheck: passed
- 实现要点:
  - startAll 拓扑顺序 create→start，fatal 失败抛 FatalServiceFailureError，degraded 收集
  - 失败的服务（无论 fatal 还是 degraded）的依赖者自动跳过
  - stopAll 反向拓扑，per-service 超时（默认 5s）+ 总超时
  - stopAll 错误不再抛出，只记录到 lastError 让其他服务继续关闭
  - reload 仅对 running + 声明 reload() 的服务生效
- files_changed:
  - desktop/electron/runtime/service-registry/registry.ts (new)
  - desktop/electron/runtime/service-registry/__tests__/registry.test.ts (new)
  - desktop/electron/runtime/service-registry/index.ts (export ServiceRegistryImpl + factory)
- tests_passed: 26 / 26 (全量)
- typecheck: passed
- 备注: startAll/stopAll/reload 故意 throw "T1.4 not implemented"，T1.4 替换。
- files_changed:
  - desktop/electron/runtime/service-registry/topo.ts (new)
  - desktop/electron/runtime/service-registry/__tests__/topo.test.ts (new)
  - desktop/electron/runtime/service-registry/index.ts (re-export topo helpers)
- tests_passed: 12 / 12 (全量)
- typecheck: passed
- files_changed:
  - desktop/electron/runtime/service-registry/types.ts (new)
  - desktop/electron/runtime/service-registry/errors.ts (new)
  - desktop/electron/runtime/service-registry/index.ts (new)
  - desktop/electron/runtime/service-registry/__tests__/types.test.ts (new)
  - desktop/vitest.config.ts (new)
  - desktop/tsconfig.test.json (new)
  - desktop/tsconfig.electron.json (exclude __tests__)
  - desktop/package.json (add test scripts, install vitest+zod)
  - package.json (forward desktop:test scripts)
- tests_passed: 3 / 3
- typecheck: passed

## Blocked

### T3.4–T3.10 IPC handler 文件迁移
- task: T3.4 / T3.5 / T3.6 / T3.7 / T3.8 / T3.9 / T3.10
- reason: 12 个 handler 文件 + preload + bridge 类型一次性切换，无法在无人值守模式下安全验证回归（需要启动 Electron 跑 e2e）
- 详细推理: REPORT.md §3.2 [Level 3] Phase 0.3 IPC handler 迁移决策
- 后续: Runtime 接口和 codegen 已经就位，后续 PR 可以一个 handler 一个 commit 渐进迁移

### T3.13–T3.14 WindowManager 消费者迁移
- task: T3.13 / T3.14
- reason: contentWindowService + main.ts 直接调用 BrowserWindow.getAllWindows() 的迁移需要同时改 main 进程 + 渲染进程的多窗口消息流，无法在无人值守模式下回归验证
- 后续: WindowManagerImpl 已落地（含 8 个单测），新的 BrowserWindow 入口都用 manager.register/open；存量调用渐进切换

### T4.5–T4.6 EventBus 现有事件迁移
- task: T4.5 / T4.6
- reason: 5 个现有事件 channel 在 main.ts、IPC handlers、preload、renderer subscribers 多处耦合；迁移到 EventBus 需要同步改 11+ 个文件且需要 GUI 烟雾测试验证
- 后续: T4.1-T4.3 (runtime) + T4.4 (renderer client) + T4.7 (placeholders) 已落地，业务 PR 可以一个事件一个 commit 渐进迁移并跑 e2e 验证

## Phase 记录

（Phase 完成时追加一段）

## 最后心跳

2026-04-25T12:00:00+08:00
