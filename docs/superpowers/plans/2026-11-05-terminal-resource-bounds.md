# 终端资源上限与结构持久化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成用户确认方案的第 1、2 项，限制输出对象与已关闭会话的内存留存，消除结构操作中的全会话画面序列化。

**Architecture:** 原始输出使用固定块数的环形缓冲，保留现有序号和缺口语义；全局淘汰读取队首而非复制历史。结构存储与运行时增量分开，结构变更保存元数据及尚未保存的输出，不生成全部会话检查点。Agent 档案仅在所属终端存活期间常驻，历史保留在现有数据库。

**Tech Stack:** TypeScript、现有 xterm/headless、DataRepository、Vitest；不新增依赖。

**Spec:** 当前对话已确认的资源评估方案第 1、2 项；约束见 `docs/agents/module-boundaries.md` Terminal 章节和 `docs/superpowers/specs/2026-07-22-terminal-mcp-control-design.md`。

## Global Constraints

- 在当前 main 工作区开发，不创建分支或 worktree；最终只提交本任务的改动，不推送。
- 保留 32 个会话、单会话 10 MiB、全局 256 MiB 的现有上限；新增单会话 16,384 个输出块上限。
- 不改变自动关闭策略、正常与强制停止边界、权限审计、加密、观察水位及手机协议；不处理原方案第 3—5 项。
- 不删除真实 Agent 历史；从未启动 Agent 的占位档案不进入历史。仍存活的终端中退出过的 Agent 继续有 ended 投影。
- 输出块移除、结构删除、失败恢复必须保持既有持久删除意图；不增加 capability/tool。

## Review Focus

- 输出完全被淘汰、零字节块和超大单块后，序号、gap、hasMore 与累计丢失仍正确。
- 结构写入期间有新输出、会话退出或写入失败时，不清掉未提交的增量，不复活已删除会话。
- 无结构增量接口的旧测试/迁移存储继续可用；正式 DataRepository 存储不走全画面快照。
- Agent 注销后的迟到事件/待写入历史不能恢复活动档案；启动不全量读取历史档案。
- 结构保存保留其他会话的输出和检查点，删除只影响目标会话。

## Task 1: 输出缓存与资源注销

**Files:** `desktop/config.ts`、`desktop/app-capabilities/terminal/main/output-buffer.ts`、`service.ts`、`agent-notification-service.ts`、`data-repository-store.ts` 及对应 `__tests__/`。

**Interfaces:** `TerminalOutputBuffer` 增加 O(1) 队首时间读取；`createTerminalOutputBuffer` 可传测试用 `maxChunks`，默认 16,384。Agent 活动档案不再从数据库全量 hydrate。

- [x] 写并运行块数/滚动/空缓冲缺口、Agent 注销及历史冷存储回归，确认旧实现失败。
- [x] 实现环形缓冲与队首淘汰，移除空索引；注销清除活动档案，保留真实历史。
- [x] 跑专项测试，修复序号、保留额度和结束态兼容问题。

## Task 2: 结构与运行时持久化分离

**Files:** `main/store.ts`、`main/service.ts`、`main/data-repository-store.ts`、对应测试及 `desktop/tests/perf/terminal-resources.test.ts`。

**Interfaces:** `TerminalStore.saveStructuralState` 为可选的内部存储接口，接收结构元数据和运行时增量；现有 `saveState` 保留迁移/兼容路径。结构操作不捕获终端画面，运行时仍按原周期合并保存输出/检查点。

- [x] 先用结构操作/并发输出/存储失败回归及可重复性能工作负载记录失败与基线。
- [x] 实现结构存储路径，正确提交输出水位、保留待保存增量；结束清理不生成将被删除的检查点。
- [x] 跑专项、desktop typecheck、hard constraints，补性能对比与必要文档/Skill/发布说明。终端专项 528 项、主进程 typecheck 和 hard constraints 通过；全库未通过项如实记入验证记录。
- [ ] 检查 diff 与暂存区，仅本地提交本任务文件和共享文档中的本任务 hunks。

## Execution ledger

- 用户已明确授权按方案实施并验证后本地提交；不另做方案审批。
- 现有自动化/单次模式相关未提交改动属于其他任务，保留且不纳入本次提交。
- 不建立 worktree；按用户规则在当前目录和分支实施。验证采用隔离 PTY 替身，不启动应用或浏览器。
- 最终独立只读审查通过；异步探测复活档案问题先复现失败再修复。性能、回归、全库检查限制与回滚见同目录 `2026-11-05-terminal-resource-bounds-validation.md`。
