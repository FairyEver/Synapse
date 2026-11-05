# 自动化 Claude Code 执行器验收记录

日期：2026-11-05。实现位于 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`；未推送、未发布或部署。

## 行为与定位

- `builtin.claude-code` 与 `builtin.agent` 并列；仅配置 `projectId` 和 `prompt`。
- 复用统一内置 CLI launcher，按触发时的默认供应商、模型和权限启动，提示词以 `--` 后的独立 argv 传入。
- 后台创建，不发送导航请求；匹配首条 `UserPromptSubmit` 回执后自动化结束，CLI 继续运行。确认预算 60 秒，失败、超时、取消均不自动重发。
- 运行前通过 DataRepository 的可选 `pendingOutputs` 保存终端关联；结束时移入结果。启动恢复及收信恢复再次修正诊断时也保留 Claude Code 关联。
- 配置提示词复用当前共享变量输入组件，支持插入触发变量；历史结果按运行保存的执行器类型渲染；主动打开前校验 session/project，不可用时不创建替代终端。
- 清理 Worker、变更监听、仓库队列复验共同保留两种受支持类型。公开 Automation/MCP 数量仍为 14，Automation Action 为 2。

设计：[`2026-11-05-automation-claude-code-executor-design.md`](../superpowers/specs/2026-11-05-automation-claude-code-executor-design.md)。

## 自动验证

- 受影响专项：自动化调度与恢复、收信触发、执行器发现、launcher/IPC、真实临时 Hook、终端服务与标签、Renderer 注册、表单、运行记录及导航；39 个测试文件、430 项测试通过。
- 新回归覆盖：多行中文与连字符 argv、独立回执匹配、通知 Hook 合并、凭据/摘要不进入额外持久化记录、取消/超时不重发、终端早退、回执已写入但未轮询时退出、创建返回前提交并退出、恢复诊断再次分类后关联不丢失。
- 标准 `pnpm --filter @synapse/desktop run typecheck` 通过；`check:hard-constraints`、`check:ipc-codegen` 通过；本任务暂存差异使用 `git diff --cached --check` 检查。
- 独立只读审阅检查了生命周期、持久化、白名单、argv、Hook 组合和准确导航；实施后补充的退出与二次恢复回归也已运行通过。

本次使用临时本机数据和受控进程夹具，没有调用真实模型、发送邮件、修改用户自动化配置或查询业务数据库。

## 尚未验证与外部阻塞

- 未启动应用或浏览器，尚未完成真实 CLI 的首条提示词、信任/登录阻塞、焦点保持及 Windows Hook 实机验收；本机 `--help` / `--version` 只证明内置 Claude Code 2.1.278 的参数支持。
- `pnpm --filter @synapse/desktop run check:packaged-asar` 已执行，但默认扫描被既有 `desktop/release/review-v1.0.80-acceptance/user-data-before/SingletonCookie` 失效链接阻断（ENOENT）。没有删除或改动该旧验收目录，也没有新建正式候选安装包，不能据此声称本次正式包验收通过。
- 后续真实验收应使用包含本次改动的候选包：在项目中触发任务，确认当前应用/终端焦点不变、记录在提交后完成、能主动进入准确会话继续交互，并覆盖确认超时和会话失效。

本地验证日志位于 `.superpowers/sdd/2026-11-05-automation-claude-code-executor/`（Git 忽略）。本文仅有仓库文件，尚无在线分享链接。

## 18:53 启动失败修复

- 只读核对 `/Users/liyang/Library/Application Support/Synapse/logs/synapse-20261105-184419898.log`：2026-11-05 18:53:05.417 启动运行，18:53:05.428 报 `TerminalLaunchValidationError`。目标为 `builtin.mail-internal-received` → `builtin.claude-code`，尚未进入 PTY 创建。
- 根因为回执的 `SYNAPSE_CLAUDE_PROMPT_*` 变量被放入用户环境 override，触发现有 `SYNAPSE_` 保留前缀保护。先前替换 TerminalService 的 launcher 测试漏掉了这一真实校验边界。
- 新增真实 TerminalService + 受控 PTY + 实际临时 Hook 的链路测试，先复现 `Protected Terminal environment key`，再通过主进程专用 `internalEnvironment` 层修复。不放宽用户环境校验，不新增公开 IPC/MCP 参数，不保存内部回执键和值。
- 修复后的 launcher 和 TerminalService 专项共 98 项测试通过；扩展到环境保护、公开 dispatcher、手动 IPC、标签和自动化执行器的 8 文件、162 项回归通过，完整 typecheck、硬约束和 IPC 生成检查通过。
- 并行测试曾因 launcher 与 IPC 各自的临时目录回收互相影响而失败；两组测试改为各自独立临时根目录后通过，未修改生产回收逻辑。
- 未重跑用户的收信自动化、未发送测试站内信、未自动重启应用；真实执行仍需加载修复后的主进程代码再验证。
