# 自动化终端执行器：实现与验证记录

> 历史测试记录：下列结果仅证明对应的旧实现。非交互启动、合成展示头、只读保留等行为已由同日[交互式终端设计](2026-11-08-interactive-terminal-automation-design.md)替代；当前验收见[新验证记录](2026-11-08-interactive-terminal-automation-verification.md)。

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

## 后续：可选项目选择（2026-11-08）

终端执行器新增可选 `projectId`，配置界面列出 Synapse 已配置项目，并提供“不指定项目”以清空选择。选中时直接复用项目终端分组的当前启动设置，目录优先于自动化 cwd，效果与该分组普通点加号一致；未选保持原来的默认非项目分组和自动化目录规则。项目无可用目录时沿用手动加号的分组/全局目录兜底，所选项目分组不存在则在创建前失败并提示重新选择，不另找分组执行。启动关联、最终结果和打开终端入口均携带项目 ID。

本轮验证（不与上文历史测试重复加总）：

- 主进程相关回归：651 通过；5 个 opt-in 真实 PTY 测试跳过后单独执行。
- Renderer/配置/结果与导航回归：214 通过。下拉菜单在 jsdom 中实际展开、选中项目并清空，验证字段写入与结果导航；未启动应用，未做真实窗口的视觉验收。
- 真实 PTY：5 通过，新增 Node 在选中项目目录启动、归属正确项目分组、运行记录绑定项目 ID 的场景；原 Node/Python、文件输入、超时/取消与其他终端隔离仍通过。
- 项目服务及表单最终专项：24 通过，包含目录变更后的当前路径、继承分组 Shell、未选兼容、已删除项目不创建终端、清空选项及按运行保存的项目 ID 打开终端。
- 主进程、Renderer、测试三类 TypeScript 检查通过；改动范围 ESLint、hard constraints、UI tracking coverage、diff 检查通过。

未改动现有自动化配置，仍未打包、安装或发布。没有新增 capability、IPC、MCP 动作或数据库迁移。旧配置没有 projectId 时继续原行为；回退旧版前先清空新增项目字段或禁用该自动化，避免旧版严格配置校验将其判为待修复。

## 后续：启动信息与结束画面适配（2026-11-08）

截图问题已用失败测试复现：保留画面没有启动目录/命令；80×24 结束快照被当成运行中 PTY 发起 resize，导致无法适配窗口。修复后，新自动化将实际目录与脱敏命令展示头写入终端缓冲/快照，放在程序输出之前，转义控制字符，不修改用户命令、不发送给 PTY，也不混入程序输出回调和自动化 stdout 日志。已结束/失败/丢失快照按窗口尺寸本地排版，首次打开从头浏览；不修改归档网格，不调用 PTY resize 或重新启动。旧会话未记录的启动信息不能倒补，既有历史保留额度仍有效。

验证结果：

- 主进程回归 626 项、Renderer/自动化界面回归 497 项通过；主进程组跳过的 6 项原生场景另外真实执行全部通过，合计 1,129 项互不重复的测试通过。
- 真实 Node 快速输出 200 行：10 次重新恢复归档快照、每次 5 组尺寸（120×45、40×60、100×30、20×8、200×70），共 50 次真实 xterm 内核重排，目录/命令、首行及末行均保留，能滚回顶部。归档仍为原 80×24，任务保持 ended。恢复使用实际快照和 @xterm/headless；不是用 mock 字符串替代真实缓冲。
- UI 测试覆盖结束、失败、丢失三类状态首次适配和后续 ResizeObserver、只读输入限制，以及运行中转结束；完整终端 Renderer 回归还覆盖运行中 resize 屏障、手机尺寸所有权、隐藏/重新附着等行为。
- 真实 Node/Python、项目路径、自动关闭、非零退出保留、超时、取消及无关终端隔离全部通过。目录/命令脱敏、终端控制符转义、展示头不混入程序 stdout 有专项测试。
- 主进程、Renderer、测试三类 TypeScript 检查通过；新 helper 与主进程范围 ESLint、hard constraints、UI tracking coverage、diff 检查通过。Renderer 文件 ESLint 仍报告既有未使用类型导入 `SynapseTerminalOutputChunk`；对 HEAD 原文件执行同一检查复现相同错误，未把此问题算作本次修复通过，也未顺手清理无关导入。

测试工具环境有既有 Electron app 路径 mock 和 jsdom canvas 未实现提示，无相关测试失败。本次没有启动应用、打包、安装或做真实窗口像素验收；已安装客户端仍需后续正常构建安装才会使用修复。未变更生产自动化配置，未推送或发布。
