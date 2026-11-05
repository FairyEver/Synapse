# 终端后台投影与输出预算验证记录

日期：2026-11-05。修改目录：`/Users/liyang/Documents/code/github/Synapse`，分支：`main`。本次完成已确认方案第 3、4 项；第 1、2 项基线为 `012b9beab20de33eadc0baf766db604d99ff7f44`。没有启动应用、浏览器、真实终端或开发服务器，没有推送或部署。

## 行为与预算

- Renderer 按最近访问缓存最多 2 个标签、合计最多 8 个分屏；始终保留当前标签。逐出释放 xterm/WebGL、订阅、ResizeObserver 和待执行帧，重新访问从核心快照恢复，不结束 PTY。
- 每个分屏待绘制队列最多 512 KiB / 256 块，尺寸屏障最多 64 个。超限合并成一次重附着；旧 attach、异步写入、隐藏和卸载使用 generation 隔离。绘制异常停止队列并显式报错。
- 核心解析队列含在途写入和 resize，最多 1 MiB / 256 任务；512 KiB 或 128 任务触发原生暂停，降到 128 KiB 且 32 任务以下恢复。异常/硬溢出取消并收尾等待者，画面明确降级，不伪造完整 ANSI 状态。raw 输出继续遵守独立的保留/gap 规则，不自动重启或关闭。
- 可见订阅先于快照 attach；仅向订阅该会话的窗口发送输出，每批最多 64 KiB / 64 块、16ms 定时冲刷，resize 前先冲刷。超大单块发送无正文重附着信号，保持每块独立序号。
- 内部诊断聚合 raw、解析与持久化积压、解析耗时及主进程定时器延迟；5 秒一个采样器，最后会话删除后停止。压力日志至少间隔 30 秒，只记录指标。公开 MCP diagnostics 不新增跨会话计数，Terminal 保持 49 个工具。

这些是指定队列/投影的预算，不是整个应用、GPU、操作系统 PTY 缓冲或子进程 RSS 的总内存上限。核心快照、xterm 画面、raw 保留各有独立预算。

## 回归与检查

实际命令均在 `desktop/` 执行：

```sh
pnpm exec vitest run app-capabilities/terminal/main app-capabilities/terminal/shared app-capabilities/terminal/renderer
pnpm exec vitest run electron/services/__tests__/mobile-gateway-service.test.ts electron/services/__tests__/mobile-gateway-permissions.test.ts app-capabilities/synapse-skill/main/__tests__/service.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec tsc -p tsconfig.electron.json --noEmit
pnpm exec tsc -p tsconfig.preload.json --noEmit
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm run check:hard-constraints
pnpm run check:ipc-codegen
```

最终结果：43 个测试文件、833 项测试全部通过；四套 TypeScript 检查、架构硬约束、IPC 生成同步和 `git diff --check` 均通过。

覆盖 32 个标签逐出/恢复、8 分屏预算、UTF-8/空块对象额度、attach 期间溢出、超大 IPC、可见性恢复订阅顺序、迟到 attach 不揭开新画面、绘制失败、输出与 resize 顺序、解析高低水位、硬溢出、解析异常、dispose 待写取消、原生背压失败时 raw 继续、窗口订阅/销毁、最后会话关闭后采样停止、MCP/移动端和 Skill 兼容。

新增资源回归曾验证旧行为会失败：后台实例不受限、投影积压无上限、解析无背压/硬预算和 dispose 等待不结束；移除最终 generation 检查也会使迟到 attach 回归失败。独立只读审查发现并修复订阅握手及 attach 完成后的 generation 检查，无剩余阻断发现。

## 性能对比

在仓库根执行，基线用 `git show` 在内存加载，不切换分支或复制仓库：

```sh
node --expose-gc desktop/scripts/checks/terminal-projection-benchmark.mjs --baseline-ref 012b9beab20de33eadc0baf766db604d99ff7f44
node --expose-gc desktop/scripts/checks/terminal-projection-benchmark.mjs
```

环境：macOS arm64、Node v22.22.3。真实 headless xterm 先预热 256 块，再输入 4,096 个 1 KiB 块；可控生产者遵循 pause/resume。没有 Electron、真实 PTY、SQL 存储或应用进程；基线/修改后交替串行运行 3 轮。时间取中位数，资源峰值每轮一致，最终画面均包含末块且 watermark 为 4,096。

| 指标 | 基线 | 修改后 |
| --- | ---: | ---: |
| 解析 pending 峰值字节 | 4 MiB | 128 KiB |
| 解析 pending 峰值任务 | 4,096 | 128 |
| 原生背压次数 | 0 | 32 |
| 4 MiB 解析 wall time 中位数 | 5,815.35ms | 5,891.18ms |
| 4 MiB 解析 CPU time 中位数 | 502.79ms | 647.39ms |
| 4,000 块的输出发送批次 | 4,000 | 32 |
| 上述工作负载向隐藏窗口发送次数 | 4,000 | 0 |
| 访问 32 个单分屏标签后的缓存标签数 | 32 | 2 |

解析积压降低 96.875%，该输出分发工作负载的发送批次降低 99.2%。wall time 增加约 1.3%，CPU time 增加约 28.8%（约 145ms / 4 MiB）；本次目标是限制资源峰值，不能宣称解析吞吐或 CPU 全面改善。wall 样本为基线 `[5676.69, 5835.65, 5815.35]`、修改后 `[5891.18, 5891.90, 5762.53]`；CPU 样本为基线 `[460.27, 511.92, 502.79]`、修改后 `[647.39, 657.54, 565.99]`，单位均为 ms。

输出分发对比使用经基线源码核对的旧逐块广播逻辑和新的实际 relay，两个会话各 2,000 块、一个可见窗口和一个隐藏窗口。它衡量批次/接收范围，不等价于 Electron IPC 延迟或 FPS。缓存对比是策略计数，DOM 回归用 xterm/WebGL 替身核对真实 React 挂载、dispose 和重附着，不能解释为 GPU 显存减少了同样比例。

初始未预热测量和 CPU profile 也保留在本地运行目录，仅用于诊断；生产者提交结束时，基线尚未解析而新实现已解析大半，因此该时点 heap 数字不可直接比较，最终基准不输出这种误导性内存比较。本次未做真实 GPU/RSS、Windows/Linux 原生 pause/resume 或数十小时持续运行测试，不能据此证明完全不存在内存泄漏。shell/自动化任务自身 CPU、内存与忘记关闭仍受实际工作负载影响，既有 32 会话上限不变。

完整本地日志、三轮 JSON 和 CPU profile 位于 `/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-05-terminal-projection-budgets/`，没有在线链接。必要回滚点为本次独立本地提交；可单独撤回本提交，保留此前第 1、2 项和其他自动化任务的提交。
