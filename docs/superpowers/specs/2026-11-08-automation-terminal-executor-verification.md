# 自动化终端执行器：实现与验证记录

日期：2026-11-08。仓库：`/Users/liyang/Documents/code/github/Synapse`，开发分支：`main`。

## 交付行为

- 新增 `builtin.terminal`，用户决定运行的命令和程序，无命令白名单；不经 AI 调度。命令按字面交给现有终端 Shell，沿用自动化工作目录。命令参数和文件重定向由用户配置，不自动插入 Webhook 正文或模板变量。
- `autoClose` 默认 true。以实际 PTY 退出判断完成；先通过现有运行仓库持久化合并输出、退出码和信号，再删除本次会话。保存失败保留终端并报告失败。
- 关闭自动关闭时保留只读已结束会话和可重新附着的画面，不保留空闲 Shell，不占 32 个运行名额。应用退出或重启仍按现有终端规则清理会话；长期证据在自动化运行历史。
- `timeoutMins` 默认 30，范围 1–1440；null 表示不限时。取消/超时先终止本次 Unix PTY 进程组，2 秒后必要时强制终止，4 秒仍未确认退出则保留终端并明确报告停止未确认。正常退出后也清理本组的普通后台子进程。刻意脱离本组的守护进程不在保证范围内。
- 关机时终端自动化最多等 4.5 秒收尾，UI 停止回执仍最多等 3 秒。服务软排序保证自动化先于终端停止；不因 Terminal 降级而禁用 Agent 执行器。强制结束应用或存储长期不可用仍可能中断收尾，沿用中断记录恢复，不重放命令。
- 日志为 PTY 合并输出，运行记录保存开头最多 64 KiB，超出显式标记截断；沿用敏感内容脱敏。没有声称分别保存 stdout/stderr 或无限日志。
- 现有 Agent、Claude Code 执行器及已退休 ID 保持既有行为；没有新增 MCP 动作、IPC、数据库迁移或应用版本。系统 Skill 说明、发现描述、注册清单与发布说明已同步。

## 验证证据

命令均在仓库 `desktop` 目录执行；没有运行应用构建、打包、开发服务或已安装 Synapse 的重启。

| 验证 | 实际结果 |
| --- | --- |
| 自动化、Action Runtime、终端、配置/结果界面及导航联合回归 | 67 文件 / 1,056 测试通过，含下述 4 项真实 PTY 场景 |
| 主进程分组回归，含 bootstrap descriptors/registry | 711 通过；4 个 opt-in 原生场景在该组跳过，另行真实执行 |
| Renderer 分组回归 | 15 文件 / 406 测试通过；与联合组有重叠，不重复加总 |
| `tsc -p tsconfig.electron.json --noEmit` | 通过 |
| `tsc -p tsconfig.json --noEmit` | 通过 |
| `tsc -p tsconfig.test.json --noEmit` | 通过 |
| 本次执行器、生命周期与导航文件的 ESLint | 通过 |
| `node scripts/checks/check-hard-constraints.mjs` | 通过 |
| `node scripts/checks/check-ui-tracking-coverage.mjs` | 通过 |
| `git diff --check` | 通过 |

联合回归复现命令：

```sh
SYNAPSE_TERMINAL_REAL_PTY=1 pnpm exec vitest run electron/services/automation electron/action-runtime/__tests__ src/modules/automation action-packages/builtin/terminal app-capabilities/terminal/main/__tests__ app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx src/lib/__tests__/open-terminal-session.test.ts src/action-runtime/__tests__/action-registry.test.tsx electron/capabilities/__tests__/automation-dispatcher.test.ts
```

真实场景单独复现：

```sh
SYNAPSE_TERMINAL_REAL_PTY=1 pnpm exec vitest run electron/services/automation/__tests__/terminal-executor-real-pty.test.ts
```

真实测试使用源码 TerminalService、node-pty 与新 runner，临时目录内执行 Node/Python，终端和运行持久化边界用隔离内存仓库；不操作用户生产数据。4 个场景为：

1. Node 输出 stdout/stderr、核对 cwd、退出码 0，确认先记录后删除会话。
2. Python 由用户命令重定向读取 6,000 字节文件，退出码 7，保留已结束终端并重新附着查看输出，确认无运行会话占额。
3. 取消忽略 SIGTERM 的 Python 及其子进程，核对子进程 PID 已消失；同时另一个终端保持 running。
4. 真实超时停止同类进程组，保留 timeout 状态并自动关闭本次终端，另一个终端不受影响。为缩短测试，直接 runner 的内部测试配置把一分钟计时加速为 6 秒；公开 schema 仍要求至少 1 分钟。

协议单测还覆盖快速退出、启动失败、非零/信号退出、重复终端事件隔离、保存失败不删除、停止未确认不删除、脱敏、截断、监听器回收、取消后的退出信息持久化、关机等待及 Windows shell argv。Windows 未进行真实 PTY 验证；应用实际退出与已安装客户端端到端界面未执行。

## 开发中排除的问题

快速输出曾因会话尚未发布而漏记，已改为 owner 回调直接接收；保留终端曾因仿真器被释放而无法重新查看，已保留结束画面并在删除时释放。交互式 Shell 集成不得覆盖执行命令的 argv。信号退出即使 PTY 报退出码 0 也标为失败。取消结果不再被通用取消异常覆盖。

审查发现关机等待 3 秒短于终端收尾，现已按上述边界修正并加入回归。开发中高并行联合执行曾出现加速计时早于 Python 就绪、取消未关闭的失败；调整测试计时并收敛取消收尾后，同一联合范围重新执行为 1,056 全通过。

原先尝试的可选 stdin 字段已撤回：canonical PTY 不是字节管道，本机长行测试会阻塞或丢输入。本次不交付此字段；文件输入应由用户的命令重定向处理。

## 状态与回退

改动在上述仓库分支本地提交；未 push、未打包、未发布、未安装，因此运行中的 Synapse 尚未切换。未修改 PR 机器人的仓库、自动化配置或生产状态。若后续版本需回退，先禁用终端自动化或改回已有执行器，再回退客户端；保留运行历史，不因回退重放结果未知的命令。
