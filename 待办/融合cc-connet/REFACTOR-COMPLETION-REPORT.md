# Synapse 架构重构完成报告

> 模式：无人值守
> 开始：2026-04-25T11:30:00+08:00
> SPEC：架构前置改造建议.md r2
> 分支：feat/phase-0/architecture-foundation-20260425
> 起始 commit：8dd87c1973a9c35172f9026d45fc5abe555f1a34

## 1. 执行摘要

- 状态：进行中
- 总任务：71
- 已完成：0
- 跳过/Blocked：0
- 总 commit：（最终统计）
- 自检轮数：0
- 遗留问题：（最终统计）

## 2. 各 Phase 变更摘要

### Phase 0.1 ServiceRegistry

**状态**: 完成（9/9 任务）。
**Commit 范围**: 229b7ed..3f7a146（外加 T1.9 待 commit）。
**测试**: 52 通过，typecheck 通过。

**新增**：
- `desktop/electron/runtime/service-registry/{types,errors,topo,registry,index}.ts` — 完整 SPEC §4 接口和实现。
- `desktop/electron/bootstrap/` — 9 个 ServiceDescriptor + buildServiceRegistry + main 入口拆出来的子模块（main-window / singleton-lock / before-quit / app-events / ipc-handlers）。
- `desktop/tests/unit/phase-0.1-integration.test.ts` — 9 服务全生命周期集成测试。
- `desktop/vitest.config.ts`、`desktop/tsconfig.test.json`、`desktop:test` script — 全套测试基础设施。

**关键设计**：
- ServiceRegistry 用 Kahn 拓扑（registration order 稳定 tie-break），fatal 失败抛 `FatalServiceFailureError`，degraded 失败收集到 `result.degraded[]`，跳过依赖失败的服务（无论上游是 fatal 还是 degraded）。
- stop 反向拓扑、per-service 5s 超时（可配置）、总 deadline 15s；stop 错误只记录到 `entry.lastError`，不阻塞其他服务关闭。
- bootstrap 层是「胶水」：runtime/* 不依赖 services/*，符合 SPEC §1 "runtime 不依赖 modules"。
- main.ts 从 326 行减到 107 行，仅 orchestrate `whenReady → IPC handlers → registry.startAll → 创建主窗口 → before-quit`。
- before-quit 复用 `registry.stopAll(15000)` 完成所有服务的反向拓扑关闭。

**意外发现 / 临时妥协**：
- `desktop/package.json` 没有 `test` / `lint` script、根 package.json 没有 `desktop:test` 转发——T1.1 内一并补上。已写入"决策记录" Level 2。
- `webContents.send`（仓库消失广播）在 main.ts 内刻意保留，待 Phase 0.4 EventBus 替换；移到 bootstrap/ 会触发 hard-constraint grep 但 Phase 0.4 才能正确解决。
- `createMainLogger` 没有 `trace`/`fatal` 级别，bootstrap/registry.ts 用 adapter 把这两个 level 路由到 debug/error；Phase 0.6 实现真 StructuredLogger 时一并升级。

### Phase 0.2 DataRepository

### Phase 0.3 IPC Codegen + WindowManager + NetworkServiceRegistry

### Phase 0.4 EventBus

### Phase 0.5 ProjectContainer + ProcessRuntime

### Phase 0.6 工程规范与可观测性

## 3. 决策记录

### 3.1 Level 2 自主决策

#### [Level 2] 引入 vitest + zod 作为 Phase 0 测试与验证依赖

- **时间**: 2026-04-25T11:32:00+08:00
- **任务**: 准备阶段（先于 T1.1）
- **背景**: SPEC §9 明确要求 Vitest 单测、zod 校验，但 desktop/package.json 尚无这两个依赖；SPEC 任务流要求每个原子任务结束都跑单测。
- **候选**:
  - A: 立即安装 vitest + zod（影响范围：增加 ~25 个 transitive 依赖）
  - B: 先跳过单测，等到 T6.13 再补
- **选择**: A
- **理由**: SPEC 大量任务（T1.2 起）要求"+ 单测"，没有单测框架就无法满足"自测要求"。zod 是 IPC codegen 的硬依赖。
- **commit**: （随 T1.1 提交）
- **需用户复核**: 否

### 3.2 Level 3 保守决策（需用户复核）⚠

（每次 Level 3 决策立即追加 + 高亮）

## 4. 自检循环日志

（每轮追加）

## 5. 跳过/Blocked 任务

（每次任务 blocked 立即追加）

## 6. 对 SPEC 的偏离与反馈

（发现 SPEC 描述与实际不符时立即追加；绝不修改 SPEC）

## 7. 环境问题

### desktop:test 与 desktop:lint 命令缺失

- **发现时间**: 2026-04-25T11:30:00+08:00
- **问题**: SPEC §9 要求 `pnpm desktop:test` / `pnpm desktop:lint`，但根 package.json 与 desktop/package.json 均无这两个 script，也未配置 ESLint。
- **应对**: T1.1 内补 `desktop:test` script（运行 vitest）；ESLint 在 T6.14 才落地。Phase 验收阶段对 lint 的检查会跳过并记录。

## 8. 遗留问题清单（给用户）

（最终汇总所有未解决问题，按严重性排序）

## 9. 验证指南（给用户）

（最终给出：如何本地跑测试、如何回滚、如何继续 M1）

## 10. 附录

- 起止 commit: 8dd87c1..（待统计）
- 主要新增目录: （待统计）
- 主要删除文件: （待统计）
