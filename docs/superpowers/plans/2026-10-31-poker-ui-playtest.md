# 德州扑克真实实战与界面修复记录 · 2026-10-31

在当前仓库 `/Users/liyang/Documents/code/github/Synapse` 的 `main` 分支修改，起点提交 `35fcf028fdb87036852a609c23f7d90e65431ca0`。直接操作用户已运行的 Electron dev 窗口，真实创建陪练房、添加程序机器人、入座和提交游戏动作；未替换网络响应、注入假牌局或用静态场景充当实战。通过现有登录账号连接游戏服务；未直接查询数据库，未核定其底层数据库环境。

## 实战记录

新建房间 `862069`（实际房名 `UI`），标准 52 张、盲注 1/2、初始练习筹码 1,000、六个座位。最初两名机器人，后续补到五名机器人。AI 指当前 Codex 通过 Synapse MCP 接管本人座位，不是应用后台托管的模型。没有另一个真实账号或独立外部模型作为对手；对手均为程序机器人。

| 手数 | 真实操作与验证 | 本人净变化 |
| --- | --- | --- |
| 1 | 桌面本人入座、过牌、下注 2；桌面申请交接后 MCP 核对版本并认领 AI 控制；转牌与河牌由 AI 过牌，完成摊牌 | -4 |
| 2 | AI 通过 MCP 补齐小盲，翻牌一对四下注 4，对手弃牌；服务端返回获胜结算 | +4 |
| 3 | AI 申请手后暂离后合法弃牌；等待其他参与者完成，确认实际 sitting_out | 0 |
| 4 | 本人接管，回座；在新界面选择半池，加注到 5；翻牌、转牌、河牌过牌，手后暂离 | -5 |
| 5 | 五名机器人加本人满六人桌；测试全下确认与 Escape 取消，未提交全下；跟注 1 进入翻牌后弃牌，完成主池及边池结算，手后暂离 | -2 |

服务端 `hand_history(mode=practice, limit=5)` 已确认五手结果，最终练习筹码 **993**，`table_state` 确认为 `status=paused`、本人 `sitting_out`、控制方 `human`、版本 3。大厅账户初始和实战期间为 1,000,000 点，陪练不占用大厅点数。测试房保留，停止自动开局；没有部署、推送、数据库迁移或直接数据库写入。

首手 ID `3aeda512-b542-4fec-985c-afc92987a409`；末手 ID `37c09ca3-5c85-4ae2-a070-1370c95fd070`。创建及行动使用现有 UUID、控制版本和未知结果重试机制，没有绕过真人接管或 AI 入座授权。

## 截图证据

图片均为实际桌面窗口截图，本地可访问，尚无在线分享链接。较早图片记录修复前或中间状态，以 13–22 号为最终主要证据。

| 关键状态 | 截图 |
| --- | --- |
| 原空桌、浅色业务操作条 | [修复前空桌](/Users/liyang/.codex/visualizations/2026/10/30/01a18f1d-8939-74f2-afdd-04cd6bf00062/poker-ui-playtest/01-before-empty.jpg) |
| 原本人行动区、真人和 AI 交接 | [修复前真人行动](/Users/liyang/.codex/visualizations/2026/10/30/01a18f1d-8939-74f2-afdd-04cd6bf00062/poker-ui-playtest/03-before-human-turn.jpg) / [AI 交接](/Users/liyang/.codex/visualizations/2026/10/30/01a18f1d-8939-74f2-afdd-04cd6bf00062/poker-ui-playtest/04-before-ai-handoff.jpg) |
| 六人满桌、跟注与加注操作 | [最终行动区](/Users/liyang/.codex/visualizations/2026/10/30/01a18f1d-8939-74f2-afdd-04cd6bf00062/poker-ui-playtest/13-final-action-dock.jpg) |
| 全下确认替换下注编辑区，不新增一行推动牌桌 | [最终全下确认](/Users/liyang/.codex/visualizations/2026/10/30/01a18f1d-8939-74f2-afdd-04cd6bf00062/poker-ui-playtest/14-final-allin-confirm.jpg) |
| 小窗口与六人翻牌 | [880×631 逻辑像素窗口](/Users/liyang/.codex/visualizations/2026/10/30/01a18f1d-8939-74f2-afdd-04cd6bf00062/poker-ui-playtest/15-final-narrow-turn.jpg) / [六人翻牌](/Users/liyang/.codex/visualizations/2026/10/30/01a18f1d-8939-74f2-afdd-04cd6bf00062/poker-ui-playtest/16-final-full-table-flop.jpg) |
| 弃牌与日志机器人管理 | [弃牌状态](/Users/liyang/.codex/visualizations/2026/10/30/01a18f1d-8939-74f2-afdd-04cd6bf00062/poker-ui-playtest/17-final-folded.jpg) / [窄窗管理与可见关闭按钮](/Users/liyang/.codex/visualizations/2026/10/30/01a18f1d-8939-74f2-afdd-04cd6bf00062/poker-ui-playtest/18-final-bot-management.jpg) |
| 主池、边池、本人净变化及弃牌原因 | [最终结算与日志](/Users/liyang/.codex/visualizations/2026/10/30/01a18f1d-8939-74f2-afdd-04cd6bf00062/poker-ui-playtest/20-final-results.jpg) |
| 收起日志与返回房间恢复宿主 | [最终牌桌](/Users/liyang/.codex/visualizations/2026/10/30/01a18f1d-8939-74f2-afdd-04cd6bf00062/poker-ui-playtest/21-final-table.jpg) / [返回房间](/Users/liyang/.codex/visualizations/2026/10/30/01a18f1d-8939-74f2-afdd-04cd6bf00062/poker-ui-playtest/22-final-lobby-return.jpg) |

## 空间与视角

| Before | After |
| --- | --- |
| 座位按绝对座号摆放，本人第三个入座出现在左上方 | [lib/view.ts](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/lib/view.ts) 的 `seatPosition` 接受本人原点；[components/Seat.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/components/Seat.tsx) 与 [components/ChipMotion.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/components/ChipMotion.tsx) 使用同一坐标，本人固定下方 |
| 手牌接近公共牌说明；上方座位状态接近底池 label | [styles/table-tokens.css](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/styles/table-tokens.css) 本人位置 94%、对面位置 10%；本人手牌放大，座位名称改为 22px、筹码 28px，本人标为“你” |
| 行动区绝对定位，随内容高度重新测量并改变画布区域 | [components/Table.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/components/Table.tsx) 改为正常 flex 布局；操作区保留布局空间，移除控制条高度观察器，继续保持 1440×900 contain 画布 |
| 日志默认展开挤压牌桌 | [components/Table.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/components/Table.tsx) 默认关闭；需要时展开侧栏，小窗口仍用抽屉 |
| 结算大面板盖住公共牌 | [components/Settlement.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/components/Settlement.tsx) 改成画布上方胜负与本人净变化条，长赢家姓名截断并可查看完整 title；完整结果保留在日志 |

## 游戏操作与反馈

| Before | After |
| --- | --- |
| 白色业务操作条与普通按钮，同游戏画面脱节 | [components/PokerButton.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/components/PokerButton.tsx) 与 [styles/table-tokens.css](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/styles/table-tokens.css) 提供模块专属按钮、固定游戏调色板、金色过牌/跟注、分层的弃牌和下注/加注；保留点击跟踪 |
| 下注只有金额和长滑杆，主按钮不显示下注结果 | [components/HumanControls.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/components/HumanControls.tsx) 显示“加注到／下注到”金额；[lib/action-view.ts](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/lib/action-view.ts) 支持最小、半池、一池，按跟注后底池计算且受服务端 min/max 限制 |
| 全下和其他动作同样突出，可直接投入全部筹码 | 所有可能耗尽筹码的下注、加注、跟注和显式全下，统一先进入确认，确认后通过原 hook 提交原合法动作；未知结果仍复用原 actionId |
| 展开全下确认新加一行，使画布缩小 | 确认控件替换既有下注编辑区，保持区域高度；取消按钮获得焦点，Escape 取消后恢复全下入口焦点 |
| “本人操作”无法区分本人轮次和等对手 | [lib/action-view.ts](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/lib/action-view.ts) 分别显示轮到你、等待具体玩家、AI 操作、等待接入、等待下一手、弃牌及暂离；旁观本人轮次提示切回玩家视角 |
| 申请暂离即出现“牌局已暂停” | [components/Table.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/components/Table.tsx) 只在实际 paused 时显示暂停说明；[components/HumanControls.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/components/HumanControls.tsx) 等待生效时显示“本手后暂离” |
| AI 接入只有按钮，用户不清楚接下来如何连接 | 等待交接时保留复制、取消入口，并给出“复制接入指令，发给你的 AI”的必要下一步 |
| 已弃牌者的结算明细仍优先显示牌型，像参与了摊牌 | [components/Settlement.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/components/Settlement.tsx) 优先显示“已弃牌”，保留服务端授权牌面和净变化 |

## 日志与辅助技术

| Before | After |
| --- | --- |
| 机器人添加、移除与日志关闭按钮挤在一起 | [components/PracticeBots.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/components/PracticeBots.tsx) 使用独立 disclosure 和游戏按钮；侧栏为关闭按钮预留顶部空间 |
| 窄窗侧栏继承 z-index:3，将关闭按钮压在下面 | [styles/table-tokens.css](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/styles/table-tokens.css) 在沉浸侧栏重置为 `z-index:auto`，实际窄窗已验证关闭按钮可见并可点击 |
| 结算后重进房间，事件建立基线时没有结果事件，日志缺少详细结算 | [components/SidePanel.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/games/poker/components/SidePanel.tsx) 合并当前 `table.settlement` 与事件结果，按 handId 去重并保留最近两手 |
| 普通按钮、表单和行动控件混在一起，焦点与命中尺寸不统一 | 专属控件至少 40px，明确 focus-visible 和 0.96 按压反馈，仅过渡具体属性，支持 reduced motion，下注保留原生 label 与键盘操作 |
| 状态中的倒计时可能造成逐秒播报 | 倒计时放在状态播报之外，保留可访问数字，使用 `role=timer`、`aria-live=off`；动态数字沿用 tabular-nums |

## 沉浸宿主与大厅

| Before | After |
| --- | --- |
| 内嵌房间仍显示白色应用顶栏与 Dock | [system-app-window-shell.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/apps/components/system-app-window-shell.tsx) 将 immersive 传给 header slot；内嵌宿主隐藏业务顶栏；[app-shell-layout.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/app-shell/components/app-shell-layout.tsx) 仅在沉浸标记存在时隐藏 Dock |
| 宿主隐藏顶栏时切换 DOM 结构，可能卸载子页面、丢失游戏导航 | [embedded-system-app-shell.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/apps/components/embedded-system-app-shell.tsx) 保持内容容器结构，条件渲染顶栏；已测试进入、返回、再进入 |
| 大厅始终写“轮到你的 AI”和“继续观看” | [MySessions.tsx](/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/game-hall/components/MySessions.tsx) 改为“轮到你”和“继续游戏”，兼容本人操作及 AI 控制 |

## 验证与范围

- 游戏模块及宿主架构测试：20 个文件、130 项通过。覆盖接管版本、未知动作重试、下注范围、预设计算、筹码耗尽确认、结算重连与去重、沉浸导航、公开投影和既有玩法。
- 完整 desktop typecheck 曾通过；最终 Renderer 与测试代码再次运行 `tsc -p tsconfig.json --noEmit`、`tsc -p tsconfig.test.json --noEmit` 通过。主进程与 preload 未修改。
- `check:hard-constraints` 通过；改动生产 TS/TSX 的 ESLint 通过，`git diff --check` 通过。
- 独立只读审查已完成，筹码耗尽绕过确认、倒计时可访问性、重连结算缺失三项发现均已解决并复查。
- 游戏能力仍为 26 项 MCP、24 项 IPC，未改变 schema、Skill 协议、权限、控制版本或后台模型边界。同步了游戏指南、模块边界、UI 规则与待发布说明。
- 未测试十人满座、真实另一个人类账号或独立外部模型对手、真实屏幕阅读器播报、生产包与发布。880×631 小窗口已实测操作区和日志；受既有固定画布 contain 规则影响，小窗口牌桌仍会缩小。
- 回滚为本次纯 Renderer 和配套文档提交的逆向改动；无需数据库回滚，不涉及资金或推送网关变更。测试产生的陪练历史保留，不删除用户原房间 `112307`。
