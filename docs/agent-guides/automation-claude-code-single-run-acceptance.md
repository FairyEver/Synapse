# Claude Code 自动化单次模式验收

日期：2026-11-05。修改仓库：`/Users/liyang/Documents/code/github/Synapse`，分支 `main`。未发布、推送或部署；没有修改真实自动化配置，也没有给任何人发送消息。

## 行为

- 「单次模式」默认不勾选，旧配置缺少 `singleRun` 仍按交互式执行，本轮回复后保留 CLI 与终端。
- 勾选后由统一 launcher 增加原生 `--print`，CLI 自然退出后复用 TerminalService 清理本次会话、分屏及空标签；不监听 Stop 强制结束。
- 调度频率、首条 `UserPromptSubmit` 即结束自动化的语义、60 秒启动确认、默认供应商/模型/权限不变。完成或失败不回写已结束的启动记录；终端不存在时打开入口仍使用既有不可用提示。
- 进程退出不等于业务成功，原生单次模式也可能在 CLI 后台任务仍存在时退出。本次没有增加后台任务监管、失败终端保留或继续输入功能。

设计：[单次模式设计](../superpowers/specs/2026-11-05-automation-claude-code-single-run-design.md)。

## 自动验证

- 主进程专项：Action 配置/默认值/透传 8 项、launcher/真实 TerminalService 21 项、系统 Skill 契约 22 项，合计 51 项通过。
- Renderer 配置与结果视图 4 项通过，包括旧配置不勾选、勾选和取消、配置保留及无供应商覆盖项。
- 标准 desktop `typecheck`、`check:hard-constraints`、`check:ipc-codegen` 通过；`git diff --check` 通过。
- 独立只读审阅未发现重要生产问题；按审阅意见，真实测试检查每次 `saveState`，防止清理后才检查而漏掉运行中短暂持久化凭据。

专项日志：`/tmp/synapse-single-run-final-main.log`、`/tmp/synapse-single-run-final-renderer.log`、`/tmp/synapse-single-run-typecheck.log`、`/tmp/synapse-single-run-constraints.log`、`/tmp/synapse-single-run-ipc.log`。

## 真实 CLI 链路

执行：`pnpm --filter @synapse/desktop exec vitest run --config tests/manual/automation-claude-code-single-run.config.mts`，2 项通过。仅显式运行此配置才调用模型，普通测试不会读取本机凭据或发起真实请求。

链路使用生产 Action → launcher → TerminalService → 真实 node-pty → 内置 Claude Code 2.1.278。测试 provider 使用本机已有 Claude Code 配置，网络请求真实；配置服务和项目查询使用临时夹具，未经过运行中的 Synapse 应用、真实调度器或保存用户任务。仅允许回复测试标记、禁用工具/全局定制/MCP，不执行业务操作。

- `singleRun=false`：收到真实首条提交回执，CLI 回复 `FIRST_DONE` 后无进程退出事件，会话仍为 `running`，标签仍存在。断言通过后显式 `stopSession` 清理测试进程；记录中的退出码 129 来自这次测试收尾，不是自动关闭。
- `singleRun=true`：第一个 Stop Hook 要求继续；CLI 回复 `SECOND_DONE`，随后自然以退出码 0 结束，终端会话和标签自动清理，无强制终止。临时 settings 被清理，所有持久化快照均未包含 provider 环境值。
- 真实测试进程均已结束。临时启动凭据文件已清理；只保留隔离配置、受限终端文本和测试结果。
- 最终结果：`/private/var/folders/hw/zmxbg73s4r5g7x_39ymh_xbm0000gn/T/synapse-single-run-live-KILtAe/results.json`；日志：`/tmp/synapse-single-run-live.log`。

早期验收夹具有两处问题，均已修正后重跑：空存储缺少必需数组；macOS `/var` 与 `/private/var` 路径不一致导致初始信任确认。另一次交互模式保留断言已通过，但测试在 Hook 刚结束时立即输入 `/exit` 未完成收尾，现改为断言后显式停止测试会话，不影响产品退出判断。

## 全量测试边界

执行 `pnpm --filter @synapse/desktop run test`，首跑 1113 个文件、11417 项测试：11408 通过、7 失败、2 跳过。日志：`/tmp/synapse-single-run-suite.log`。不得据此称全量全绿。

- 系统 Skill `keeps system Synapse Skill domain guidance aligned with MCP tools` 仍断言只有 `builtin.agent`，已同步到两个执行器及单次模式字段，22 项专项复测通过。
- 搜索 `reaches every tool through a chinese query built from its own name segments` 首跑超出 120 秒；独立复跑 37.7 秒通过。日志：`/tmp/synapse-single-run-router-recheck.log`。
- `mobile-workspace-files-service.test.ts` 首跑失败 5 项：`reads multiple baselines beside unrelated loose objects within independent budgets`（读取预算不足），以及 `reports a real index type change and staged/unstaged tracked binary content with honest statistics`、`matches a native clean checkout and one-line edit when autocrlf is only global`、`respects XDG then home then local precedence without conflating bare and empty booleans`、`invalidates prior content after standard global configuration creation, deletion, and replacement`（超时）。未改动这些移动端测试或实现；独立复测整份文件 80 项全部通过，用时约 146 秒。日志：`/tmp/synapse-single-run-mobile-recheck.log`。

文档与日志目前仅有本机路径，尚无在线分享链接。未验收正式安装包、Windows/Linux 实机、运行中应用的点击与真实定时触发；本次没有改动打包资源或发布流程。
