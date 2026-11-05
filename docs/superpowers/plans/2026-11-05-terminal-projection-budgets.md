# 终端后台渲染与输出队列预算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Implement in the current workspace; user explicitly requested implementation and a local commit after validation.

**Goal:** 完成已确认方案第 3、4 项，限制后台渲染实例、输出分发与解析/投影积压，并提供内容无关的本机资源监测。

**Architecture:** Renderer 按 LRU 保留最多 2 个标签且合计最多 8 个 pane；被移除的投影释放资源，重新访问从核心快照恢复。核心输出解析按字节和任务数量实施高低水位背压，硬超限明确降级而不伪造画面；投影超限重附着核心快照。按窗口可见会话过滤并合批输出 IPC。监测只保存计数、字节、高水位、解析延迟与主进程定时器延迟，不保存内容或新增 MCP 数据侧通道。

**Tech Stack:** React、TypeScript、现有 xterm/node-pty、DataRepository 和 Vitest，无新增依赖。

**Spec:** 当前对话已确认方案第 3、4 项；`docs/adr/0070-own-terminal-emulation-in-core-with-bounded-validated-checkpoints.md`、`docs/superpowers/specs/2026-07-22-terminal-mcp-control-design.md` 及 `docs/agents/module-boundaries.md` Terminal 约束。

## Global Constraints

- 当前 main 分支/目录，不建 worktree；保留其他任务的改动与提交，最后只提交本任务文件/共享文档对应 hunks，不 push 或部署。
- 保留 32 个 PTY、原始输出 10 MiB/16,384 块/全局 256 MiB 的现有保护；不增加自动关闭或空闲超时。
- 核心仍按完整、有序 ANSI 流维护权威画面和 resize barrier。原始保留额度触顶继续滚动读取；解析追不上时短时暂停读取，低水位恢复，不能因存储满而暂停。
- 原生读取暂停不可用或数据仍突破解析硬预算时，仅派生画面明确降级；raw 输出继续保留/报告 gap，不能静默冒充完整画面。
- Renderer 超限只丢弃派生队列，从可靠快照恢复，不更改 PTY、尺寸归属或手机协议。
- 不扩大 MCP diagnostics 可见范围；Terminal 49 个 MCP 工具、权限与 capability 数量不变。私有 IPC 改动同步生成类型、注册说明和系统 Skill。
- 不启动应用/浏览器/真实用户终端；性能与回归使用隔离可控工作负载。

## Review Focus

- 标签切换、分屏数量变化、删除、重新访问和主进程快照 attach 尚未完成时的卸载不能留下 GPU、监听器、定时器或迟到写入。
- 输出在快照前后、resize barrier 前后到达和队列溢出重附着时，不能丢掉快照后的增量或重复重放快照前字节。
- ANSI/UTF-8 分块、暂停/恢复、停止与解析失败期间，核心必须有序且所有等待者有界收尾。
- IPC 窗口销毁、隐藏、重复报告及待发批次跨 resize 时，不能泄露到未订阅窗口或跨快照水位错误合并。
- 指标读取不扫描/复制完整画面，不收集内容，不绕过权限，不让监测本身制造输出风暴。

## Task 1: Renderer LRU 与投影预算

**Files:** `desktop/config.ts`、Terminal renderer cache/queue helpers、`renderer/index.tsx`、`renderer/terminal-workspace-view.tsx` 及对应测试。

**Interfaces:** LRU helper 接收最近标签、当前标签和现有布局，返回当前及最近标签集合；投影队列按 UTF-8 字节/块数统计，超限返回拒绝并触发一次快照恢复。保留现有短距离切换复用行为。

- [x] 写失败回归：访问 32 标签的实例上限、8 pane 总预算、逐出后快照恢复、投影队列溢出与卸载清理。
- [x] 实现缓存和预算，保留焦点、尺寸屏障和手机锁；补齐未清理的帧任务。
- [x] 跑 Renderer 专项并记录 32 标签工作负载的实例/队列峰值比较。

## Task 2: 核心解析预算、输出分发与监测

**Files:** Terminal main emulator/output queue、service、IPC、共享 schema/类型和生成桥接；对应 main/shared 测试。

**Interfaces:** 核心串行队列暴露 pending/peak bytes/tasks、背压状态与延迟，支持取消收尾和显式超限；`PtyLike` 使用现有 node-pty pause/resume。内部诊断聚合队列、待持久化字节及定时器延迟；输出按当前窗口可见会话分批，保持每个 chunk 的独立序号。

- [x] 写失败回归：高低水位、硬上限、解析/resize 顺序、dispose 中等待、原生背压失败、诊断内容边界与 IPC 定向/合批。
- [x] 实现预算和监测，保留 raw 与 MCP 授权契约；超限不发送不可靠画面。
- [x] 跑 main/shared/Skill/mobile gateway、Renderer、类型和硬约束；生成性能对比和验证记录，更新指南/发布说明。
- [x] 独立只读审查，修复重要发现；检查 diff/暂存区并本地提交。

## Execution ledger

- 用户明确要求继续实施第 3、4 项并验证后本地提交，不重复方案审批。
- 原始输出保留额度与解析队列预算分别处理；短时读取背压只用于解析积压，不用于存储保留额度。
- 大量未提交自动化相关文件属于其他任务，不改动或混入提交。

- 最终验证：833 项回归通过，四套 TypeScript、架构硬约束、IPC 生成同步和 diff 检查通过。独立审查发现的订阅/迟到 attach 竞态均已修复并锁定回归；性能与限制见同目录 `2026-11-05-terminal-projection-budgets-validation.md`。计划、实现和验证记录随本次独立本地提交保存。
