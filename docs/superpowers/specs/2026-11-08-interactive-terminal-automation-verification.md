# 交互式终端自动化验证记录

2026-11-08，仓库 `/Users/liyang/Documents/code/github/Synapse`，修改分支 `main`，起点 `214509501`。用户要求自动化等效于在 Synapse 手动创建终端后输入命令，保留自动关闭、日志、退出码、超时和取消。

## 实现与结果

- 普通与自动化共用 TerminalService、交互式 Shell argv/启动配置、项目分组/目录、环境、PTY 和输入通道。删除独立 `-c` 路径及合成启动展示头；显示真实提示符和输入回显。
- zsh/Bash 原生 prompt hook 给出父 Shell 的命令完成与退出码。随机会话 token、实际 PTY PID、递增序号共同约束回执；解析器在缓冲、运行日志和订阅前消费私有帧。嵌套 Shell 不能让父任务提前结束。exit/exec 使用真实 PTY exit。
- 真正输入前等待 Shell 和实测网格。优先该分组的完整桌面网格，其次最近完整桌面网格；晚到的测量也会实际 resize 后再执行。没有测量最多等60秒后失败。手机已接管时沿用其实际尺寸，不被自动化覆盖。缓存不是对未来未知窗口尺寸的预测。
- 先保存真实合并转录与命令退出码，再处理 Shell 生命周期。autoClose=false 保留可继续操作的 Shell，并占运行名额；命令明确退出 Shell 时保留结束画面。后续普通退出仍按普通终端规则清理。日志保留开头64 KiB并显式标记截断，使用现有脱敏。
- 取消/超时先 Ctrl+C；2秒后受控查询仍属该根 PID/TTY 的作业并停止，必要时终止 exec 替换的根；4秒仍未确认则保留证据并报告停止未确认。查询失败、截断、异常输出或根身份丢失不能视为确认。其他终端不受影响，重启不重放命令。
- 正常完成/关闭遵循手动 Shell 的后台语义；返回 prompt 不等于所有后台作业结束，刻意 detached/disowned 或忽略挂断的程序可能继续运行。取消清理不认领已逃离本 PTY 的守护进程。

当前可靠回执仅支持 zsh/Bash。其他 Shell 在输入用户命令前明确失败；没有将 Windows、fish、PowerShell 或任意第三方 prompt 主题宣称为已验收。用户程序本身不设白名单；需要输入的程序可以通过普通终端继续交互。故意覆盖 hook、关闭 prompt 或以同一用户权限伪造回执不属于协议防护目标。

## 真实手动与自动对照

使用实际 node-pty、`/bin/zsh`、macOS `/bin/bash`（含旧 Readline）及现有 Shell integration。启动配置是临时 HOME/ZDOTDIR 中受控的 alias/function/env；不改用户真实配置。对照包含普通 `createSession` 手动输入和完整 `createAutomationTerminalRunner` 的同命令执行，而非只比较 mock 字符串。

| 范围 | 核验 |
| --- | --- |
| 启动配置与功能 | 相同 alias/function/env、交互标志、TTY、cwd，非零命令退出码7；两边实际 stty 为35×140 |
| 截图对应的 ls | 同一条 `ls`，原生 alias、彩色目录与多列程序输出一致；ZLE 对键入/粘贴的输入重绘序列不当作程序输出强求字节相等 |
| 多行 | 同一多行函数定义、变量、alias、管道、重定向，中途 sleep 后最后退出码9；不能在中途 prompt 误完成 |
| 交互程序 | 同一条 read 命令收到相同用户输入；输入前任务未完成，最终输出与退出码6一致 |
| 保留终端 | 完整 runner 结束后继续输入，原 Shell function/状态仍可用 |
| Shell 生命周期 | exit12、exec true、嵌套交互 zsh，以及取消忽略INT/TERM的exec根 |
| 尺寸 | 缺尺寸不输入；其他终端晚到采样能唤醒；手机接管保持52×18；原生 resize 失败不能确认就绪 |
| 输出与收尾 | Node/Python、项目目录、非零码、默认自动关闭、先保存再删除、快速200行输出；10次重开×5种网格保留首尾；取消/超时停止真实子进程，另一个终端仍running |

真实场景19项通过。自动化超时测试内部将计时加速为6秒；公开配置仍要求至少1分钟。运行状态持久化采用隔离的内存仓库边界，实际程序与 PTY 均真实执行；没有冒充生产 Webhook/现有自动化端到端验收。

## 回归与复现

以下命令从仓库 `desktop` 目录执行，没有启动应用、服务、浏览器或打包：

```sh
pnpm exec vitest run --maxWorkers=2 app-capabilities/terminal/main/__tests__ electron/services/automation electron/action-runtime/__tests__ electron/bootstrap/__tests__/descriptors.test.ts electron/bootstrap/__tests__/registry.test.ts electron/capabilities/__tests__/automation-dispatcher.test.ts
pnpm exec vitest run --maxWorkers=2 app-capabilities/terminal/renderer/__tests__ src/modules/automation action-packages/builtin/terminal src/lib/__tests__/open-terminal-session.test.ts src/action-runtime/__tests__/action-registry.test.tsx
SYNAPSE_TERMINAL_REAL_PTY=1 pnpm exec vitest run --maxWorkers=2 app-capabilities/terminal/main/__tests__/interactive-parity.test.ts electron/services/automation/__tests__/terminal-executor-real-pty.test.ts
pnpm exec tsc -p tsconfig.electron.json --noEmit
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec tsc -p tsconfig.test.json --noEmit
node scripts/checks/check-hard-constraints.mjs
node scripts/checks/check-ui-tracking-coverage.mjs
```

主进程723项、Renderer506项、另外真实PTY19项通过，共1,248项，不重复加总补跑的专项。主进程普通组跳过19项 opt-in 场景，均由真实组另行执行。三类 TypeScript、hard constraints、UI tracking和diff检查通过。

本次14个实现/测试TypeScript文件 ESLint通过。修改了组装处5行的 `electron/bootstrap/descriptors.ts` 仍报告已有的42行未使用 `dialog` 导入；对 `git show 214509501:desktop/electron/bootstrap/descriptors.ts` 原文件执行相同 ESLint 已复现相同错误，未清理无关代码，也未宣称该文件全量lint通过。测试隔离环境还会打印既有 Electron app.getPath mock及jsdom canvas提示，实际测试无失败。

可重复的测试保存在仓库中；本轮本机输出位于 `/tmp/synapse-interactive-main-regression-final.log`、`/tmp/synapse-interactive-renderer-regression.log`、`/tmp/synapse-interactive-native-verified.log` 及同前缀的types/lint检查日志，临时日志不作为永久存储。

## 开发中发现与排除

- 私有帧解析最初把每个ANSI转义序列拆成独立任务，真实彩色zsh提示符使仿真队列溢出；合并相邻正常输出后回归通过。
- Bash 3.2的keymap名是vi-insert，误用vi-insertion会导致多行能力探测失败；原生quoted-insert实测通过。
- 测试夹具曾在spawn时挂5秒清理计时，误杀6秒超时场景；已改为测试结束清理阶段才强制兜底，等待真实子进程退出后再删临时目录。
- 独立复核指出创建后晚到的尺寸缓存未被采用，已加真实回归修复。手机所有权测试先复现被覆盖52×18→140×35，再修复通过。
- 原生kill抛错时现在立即释放等待器，不产生悬空的超时拒绝。失败的尺寸调整不更新就绪信号。

## 交付与回退边界

改动和相关设计/Skill指南/发现描述/能力清单/发布说明在main本地提交，不push、不发布；未修改已有自动化配置、PR机器人、数据库结构或用户运行数据。已安装客户端没有通过本任务构建或安装，不能宣称其真实窗口已使用此实现。后续正常构建安装后仍应做真实窗口/用户主题和操作系统验收。

需要回退时先停止仍在执行的终端自动化，保存未知结果证据，再回退对应客户端代码；保留运行记录，不重放命令。autoClose=false 现在保留活Shell，回退前按需正常关闭这些终端，不能按旧只读快照假设处理。

## 后续：隐藏问题专项（2026-11-08，起点0c3c5bb9e）

用户试用基本正常后要求继续主动测隐藏问题。本轮仍在同一仓库main原地修改，不启动/重启应用、服务或浏览器，不修改已有自动化配置，不打包、推送或发布。

发现并以先失败后通过的测试修复四类问题：

1. macOS Bash启动配置为数组PROMPT_COMMAND时，没有父Shell回执，自动化卡在准备阶段。旧Bash只执行首项，原集成却按新版数组逐项追加。现在按版本选择对应原生语义，保留用户首项hook及退出码。版本依据：[GNU Bash5.1发布说明](https://lists.gnu.org/archive/html/info-gnu/2020-12/msg00003.html)；本轮实际验证macOS自带Bash，未安装或假称实测新版Bash。
2. zsh命令引号中含真实ESC和粘贴结束序列时，bracketed paste被提前结束，导致命令变化/错误。改用原生quoted-insert传递这些字节，od核验真实字节为`61 1b 5b 32 30 31 7e 62`；Bash同场景也通过，未使用eval/source包装。
3. 64KiB边界切在中文/表情UTF-8中间时，toString会补乱码替换字符，还可能让编码后长度超过原额度。复用受控进程输出的StringDecoder方式，只保留完整字符，不把后续输出拼到被截断处；保存记录与返回日志一致。
4. Shell已创建但就绪等待失败时，异常路径原来先关闭再存日志。现在先保存已有输出及未知命令退出码；保存失败则保留终端并明确报错。除单测验证顺序外，真实PTY验证在等待布局时取消：命令没有输入，成功保存后才观察到结束事件；模拟保存失败时Shell仍running且有保存错误。

新增11项真实PTY边界测试，包含同一终端连续执行、12,000字符命令、here-doc、中文/表情/制表符、管道pipefail与不存在命令的退出码、特殊ESC、zsh/Bash的vi编辑模式、旧Bash提示符配置、五任务并行且结果/终端互不串扰、原始TTY模式下取消前台和后台作业并继续使用Shell，以及上述两种就绪取消收尾。原始TTY测试保留用户stty raw设置；最初误要求CRLF是断言问题，已改为核验原生LF。BSD od的双空格也只在断言中做空白归一化，没有将它计为产品故障。

本轮独立验证（不与前轮1,248项重复累计）：

- 主进程相关回归726通过；真实PTY单独执行30项全部通过，共756项，未重复累计前后补跑。
- Electron与测试TypeScript检查、6个改动TypeScript文件ESLint、hard constraints及diff检查通过；没有改Renderer，未将前轮Renderer结果冒充本轮执行。
- 复现主进程回归沿用上方命令。原生完整复现：

```sh
SYNAPSE_TERMINAL_REAL_PTY=1 pnpm exec vitest run --maxWorkers=2 app-capabilities/terminal/main/__tests__/interactive-edge-cases.test.ts app-capabilities/terminal/main/__tests__/interactive-parity.test.ts electron/services/automation/__tests__/terminal-executor-real-pty.test.ts
```

本轮临时日志：`/tmp/synapse-terminal-edge-first.log`（修复前）、`/tmp/synapse-terminal-startup-durability-red.log`（异常保存顺序失败）、`/tmp/synapse-terminal-hidden-native-final.log`、`/tmp/synapse-terminal-hidden-regression.log`及同前缀types/lint/constraints日志。永久复现证据是本次提交中的测试与源码。未跑全仓所有模块或已安装客户端真实窗口；仍保留上述Shell/平台/后台进程边界。回退点为本轮起点0c3c5bb9e，回退不重放运行。
