# 游戏大厅验收记录

工作目录 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`，起点 `20fcd49c9`。事实来源为用户桌面“德州扑克”目录的产品设计文档、实施计划、提示词；原型仅参考布局。未 push、未部署，未连接或迁移业务数据库。

## 已确认的执行口径

- 成功 actionId 按同账号、同房间先返回永久幂等凭据，再校验新动作的轮次。
- 超时无欠注记自动 check，有欠注记 fold；两者立即撤出本手、离桌退款，不再争夺底池。
- GameAccount.points 是可用余额，GameSession 保存占用，大厅总额为两者之和，不查询游戏内部表。
- MCP 公开仍只有 search / invoke；新增 20 项 game 索引工具（大厅 3、扑克 17）。
- 90 天后受控归档：验证完整不可变副本后清理热表；提示词版本、成功行动幂等凭据永久保留。
- 暂离仅限当前账号本人；对手只有提醒入口，不新增控制对手座位的权限。

## 自动化验证

- 服务端完整测试：`pnpm --filter @synapse/server test`，168 文件、2,125 测试通过；6 个数据库测试文件的 31 项默认跳过，已由专用 Postgres 游戏套件覆盖。日志 `/tmp/synapse-game-server-delivery-last.log`。
- desktop 完整测试：`pnpm --filter @synapse/desktop run test --maxWorkers=2`，1,125 文件、11,537 测试通过，2 项既有 native 测试跳过。日志 `/tmp/synapse-game-desktop-delivery-full.log`。
- desktop 完整 typecheck 通过，包括新能力包的测试类型；日志 `/tmp/synapse-game-desktop-delivery-types.log`。
- 真实 Postgres 游戏专项：8 文件、58 测试通过（含纯引擎与大厅测试），日志 `/tmp/synapse-game-game-delivery-last.log`。覆盖并发扣款/入座、边池/整数分配、单挑、不足额全下、10 手测试客户端、超时/手动竞争、私密投影、版本、幂等、重启、维护、公私视角、归档及清理后重试。
- 架构硬约束和 IPC codegen 检查通过，日志 `/tmp/synapse-game-hard-delivery.log`、`/tmp/synapse-game-ipc-delivery.log`。
- Renderer、Electron（含单文件 preload）和服务端 API 构建通过；日志 `/tmp/synapse-game-renderer-build.log`、`/tmp/synapse-game-electron-build.log`、`/tmp/synapse-game-server-build-last.log`。
- 默认 `check:packaged-asar` 未通过：旧 release 目录的 `review-v1.0.80-acceptance/user-data-before/SingletonCookie` 断链导致扫描 ENOENT，未删除或修改旧产物。另构建本次专用候选 `/tmp/synapse-game-package-e3KI5i/mac-arm64/Synapse.app`，对它运行同一验证脚本通过，含实际 Electron 44.9.3 运行时、原生代码指纹、PTY、PDF/DOCX 与 HTML worker smoke；日志 `/tmp/synapse-game-candidate-asar.log`。
- 额外在候选包内以实际 Electron 加载 GameHallService、游戏路由及共享 CommonJS 契约，通过：20 工具、18 UI 操作、2 个游戏 HTTP 路由。日志 `/tmp/synapse-game-candidate-game-runtime.log`。该候选未签名、未公证、未发布。

曾遇到既有全量用例的 socket/5 秒进程超时：未改动相关测试或超时设置，分别隔离复跑及降低 desktop 并发后重跑完整套件。失败日志仍保留在 `/tmp/synapse-game-server-final-full.log`、`/tmp/synapse-game-desktop-final-full.log`。

## 两个真实 AI

2026-10-30 09:00:18–09:23:05（Asia/Shanghai），真实 Claude Code 与 Codex CLI 通过 game-only 的 MCP search/invoke 适配器，调用生产同一 dispatcher / GameHallService / GameApiService / PokerService，连接本机隔离 Postgres。适配器只提供游戏工具，不提供终端、文件或脚本代打能力；每个动作由客户端 AI 决策提交。

同桌完成 50 手；数据库核对两座位各参与 50 手，330 条手动动作、0 条自动动作；点数总额保持 2,000,000。停止 Claude 进程 120 秒后启动全新会话，首个游戏操作为 `app.game.hall.overview`，恢复原座位 ID，没有重新入座。完整原始报告位于同目录 `2026-10-30-game-hall-ai-report.json`。

先前尝试因 Codex 工具审批和验收脚本将主动停止的退出码 143 误判失败而终止，不能计为通过。最终报告 `failures=[]`。只对隔离测试子进程配置 game-only 工具许可，没有修改用户全局 Codex 配置。

## 视觉与边界

browser-skill 实际渲染生产 HallHome / Table / Card 组件（合成数据，无业务账号）：大厅深浅色切换可见；牌桌、毡面、卡牌和右侧日志的计算色值及背景图保持一致。旁观视角把本人底牌翻回牌背，隐藏判断、提示词和版本；组件回归另外确认旁观进度环隐藏。没有出牌按钮或滑杆，提醒入口由组件与服务器限流测试覆盖。卡牌 DOM 在大厅、牌桌、记录中复用。

截图在 `/tmp/synapse-game-hall-light.png`、`/tmp/synapse-game-hall-dark.png`、`/tmp/synapse-game-table-final-light.png`。独立 fixture 为 `desktop/tests/manual/game-hall-visual.html`。本次启动根开发命令时检测到已有 Electron 实例，新 Electron 未启动，未关闭或操作既有实例。因此完整 Electron 实例的关窗重开、手机实机接收推送未作实机验收；服务重启恢复及通知事务/限流另有自动化覆盖。

## 迁移与回滚边界

三份新增迁移只在任务自建的 `127.0.0.1:55439` 临时 Postgres 验证，数据库为 `synapse_game_e2e`、`synapse_game_final_e2e`、`synapse_game_delivery_e2e`；最后一个从空库按当前迁移重放。没有业务数据库写入，没有发布行为。

发布需先部署服务端迁移/API，再发布桌面。客户端回退保留账户、会话与归档；一旦有业务数据，不得通过删除新增表回滚，先备份并保存不可变历史及幂等凭据。

最终源码还覆盖超长记录、完整累计统计、完整选手/版本列表、UTC 倒计时和账号切换草稿隔离。所有功能代码已停止修改；临时服务与数据库在验证结束后停止，测试数据及日志保留供复查。
