# Roll 真实数据库与浏览器验收

验收于 2026-11-01 至 2026-11-02 在 `/Users/liyang/Documents/code/github/Synapse` 的 `main` 完成。用户授权真实数据库、浏览器和真人／用户 AI／陪练机器人验收，明确不部署、不 push。本记录续接 [离线实现记录](2026-11-01-poker-roll-implementation.md)，不把此前未执行的项目补写成当时已执行。

## 环境与数据隔离

- PostgreSQL 16，本机 `localhost:5433`；新建 `synapse_poker_roll_20261101_e2e` 用于本地 API／页面，`synapse_poker_roll_tx_20261101_e2e` 用于事务测试。后者不启动后台调度，避免模拟时间被真实时钟维护干扰。
- 只在以上专用库应用完整 103 份迁移，包括 `20261101090000_game_roll_frozen_transfers`。真实业务库 `synapse` 和生产均未迁移、未写入。连接通过已有 loopback／`_e2e` 守卫校验。
- 本地 API 按根 `pnpm dev:server` 启动，使用 `GAME_E2E_DATABASE_URL` 覆盖业务连接；已有 `http://localhost:19703/game/` 网页服务复用。仅使用新建 `@example.test` 合成账号，不使用生产账号或真实推送设备；`APNS_USE_SANDBOX` 未修改。
- 浏览器优先使用 `browser-skill`，真实 Chrome 154；两次验收会话意外结束后，改用独立 IAB 浏览器完成剩余页面验证。未借用用户标签或更改浏览器安全／自动化设置。早期 capture 随会话结束而不可导出，不声称已保留完整浏览器网络 trace；实际截图、API 结果和数据库审计已保留。

## 实际结果

|参与者／场景|实际操作与结果|
|---|---|
|真人，标准牌点数房 `93077`|页面首次 Roll 默认关闭；开启后入座，普通 Roll 费用 1、超级费用 4；确认指定槽后随机替换，超级关闭／重开、硬刷新后原候选 `5s/9h/3h` 保留，选择 `9h` 不重复扣费。合计费用 5，对手冻结补偿 5；后续自然超时按规则撤出，费用不退，正常派彩后释放。|
|用户 AI，标准牌点数房 `996415`|浏览器明确允许接入；真实 Codex CLI 经当前源码的 MCP router → dispatcher → GameHallService → 本地鉴权 API → PostgreSQL 执行。普通 3、超级 16 并完成选择，再以超级 23 留待真人接管，合计 42。真人接管后原候选 `9d/Ks/5s` 不变，选择 `Ks`；旧控制版本写入被拒为 `POKER_CONTROL_RELEASED`，实际 wait 返回 `control_released`。|
|正常出牌与结算|真人接管后继续跟注／过牌至摊牌；跨阶段本人次数保持 3，河牌两档均不可用。对手测试驱动器另付普通 Roll 3，本人在信息面板看到可用筹码与冻结补偿 3 分列。最终本人 Roll 支出 42／收入 3，普通底池收回 4、普通投入 2，总净变化 −37；没有把“赢得底池”当作 Roll 必赚。|
|陪练机器人，短牌练习房 `947770`|通过实际 API 与持久定时调度完成 9 手。测试玩家只按合法动作 check/call；没有直接调用机器人 Roll、指定机器人手牌或强行触发。机器人自主使用超级和普通两档，观察到超级待选但用户投影无候选。结算后解散，练习前后大厅点数对象完全一致。|
|用户 AI，短牌陪练房 `61041`|页面选择短牌、Roll 和“外部 AI”，配置 1 个机器人并授权 AI 入座。真实 Codex CLI 完成无座位授权入座、普通 Roll 1、超级 Roll 4 及候选选择，再正常过牌。机器人同手自行 Roll 支出 12；本手结算中用户支出 5、补偿 12、普通投入 2，净增加 5 **练习筹码**，不兑换点数。|

两个真实模型会话均实际调用工具：点数案例 15 次 MCP 调用（4 次 start/choose），陪练案例 23 次 MCP 调用（3 次 start/choose）。不是脚本代替模型选牌。模型被限定使用 game 能力和当前本人可见信息，测试账号凭据未放入模型提示或 CLI 配置。点数案例明确暂停待真人接管；陪练案例按测试上限停止，未把有限会话描述为长期 50 手 AI 自主循环或盈利验证。

初次真实 AI 尝试返回 401、未 claim 或扣费。验收适配器改为启动时通过本地登录接口取得新测试访问令牌，同时消除 MCP 子进程环境传递及短时令牌到期的影响。该失败尝试单独保留，不混入成功证据。

## 数据库与回归证据

|验证|结果|
|---|---|
|真实 PostgreSQL 全 game 套件，单 worker|54 文件，**373 项通过，0 跳过**。|
|Roll 实际 PostgreSQL 专项|8 项通过：并发同 UUID、超时原候选与撤出、4 种归档精确副本、奇数补偿／旧入座迟到资金／释放重试、待选陪练解散作废及原回执。|
|V2 完整 Node/jsdom 套件|148 文件，**1,224 项通过**；它们与真实浏览器证据分开计数。|
|server／V2 类型与 UI 边界|类型检查均通过；V2 UI boundaries 通过；陪练结算单位专项 9 项通过。|
|真实数据库审计|4 个房间、12 手、36 次 Roll、36 笔转移；费用合计 192，补偿合计 192；无待释放转移。每手牌量、唯一性、原始资本检查通过，转移绑定原 hand seat／admission。机器人无点数账户或大厅会话，练习转移未进入点数账户。|
|真实点数|两个验收账号总额始终合计 2,000,000；最终 999,957 与 1,000,043，待结算均为 0。|

首轮全 game 测试与运行中的 API 共库，25 项失败；分库并配置本地 `APP_PUBLIC_URL` 后重跑，确认其中包含后台真实时钟干扰。独立库仍有 20 项旧夹具不符当前规则：缺少 `pending:0`、仍期待自动续局、重建手牌未带原房规。修正夹具并保留精确金额、规则不可变及显式 ready 断言后，剩余 2 项归档辅助代码把无时区 JSON 时间字符串当作 Date，改读归档表的类型化时间列。之后全套通过。没有放宽生产规则、修改超时预算、删除断言或跳过失败用例。

新增真实资金回归特别确认：3 筹码按庄家左侧分成 2／1；获得 2 的参与者超时弃牌退款、重新入座后，原补偿只进入本人账户，新入座 stack／inPlay 不增加；重复释放不再入账。单人陪练超级待选时立即解散，冻结记录标记作废／丢弃、候选审计保留、原 UUID 重试只确认旧回执，不创建点数账户或重抽。

## 页面验收与修复

- 实际展开检查覆盖桌面 1438×834、850×800 及移动 390×844：建房开关、费用确认、原槽位、三候选、关闭／重开、原生 Escape／Enter 焦点返回、本人接管、固定底栏主要动作和信息面板；截图均已实际查看。
- 真实页面发现陪练净变化误用“点数”，已将结算单位按 `table.mode` 显示为“筹码”；点数房仍为“点数”，旧缺字段仍按点数兼容。新增两种模式回归，先失败再通过；真实 IAB 页面已显示 `+5 筹码`。无 MCP、共享 schema、收费或 Skill 行为变化。
- 权威 Skill 已由两个真实 CLI 会话读取并使用；保留当前报价、次数、UUID、候选与控制边界。未进行任意玩家收益、长期模型策略、正式桌面发布包升级或生产环境验收。

## 本机制品与复跑

证据目录：`/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-01-poker-roll-real-acceptance/`，尚无在线链接。测试连接和合成账号配置保留为本机私有文件，不写入 Git 或发布文案。

- 数据库：`transaction-migrations.log`、`postgres-game-isolated.log`、`postgres-game-fixtures-green.log`、`postgres-game-delivery.log`、`roll-funds-postgres-final.log`、`database-audit.json`。
- AI：失败 `real-ai.ndjson`，成功 `real-ai-2.ndjson`／`real-ai-practice.ndjson`，汇总 `ai-clients-summary.json`；`bot-live.log`／`bot-live-report.json` 为真实定时机器人轨迹。原始模型日志仅为本地测试制品。
- 页面：`room-create-roll.png`、`normal-roll-desktop.png`、`super-restored-390.png`、`ai-pending-before-takeover.png`、`table-roll-850.png`、`frozen-compensation-850.png`、`short-practice-create-iab.png`、`practice-ai-settlement-correct-unit.png`。
- 回归：`practice-unit-red.log`／`practice-unit-green.log`、`v2-delivery.log`、`server-typecheck-final.log`、`v2-typecheck.log`。复跑须继续使用 loopback `_e2e` 专用库；不得省略环境变量而落回业务库。真实 CLI 辅助脚本绑定本次合成账号／房间，重跑新场景前先在新测试房间重新授权，不将已关闭房号直接当新局。

事务套件的实际执行方式如下，连接值由本机私有配置注入；已有 `test-database` 守卫负责拒绝非专用库：

```bash
# 在 server/，预先设置 GAME_E2E_DATABASE_URL 为上述事务专用库
APP_PUBLIC_URL=http://localhost:19703 node node_modules/vitest/vitest.mjs run src/game --maxWorkers=1
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
# 在 dashboard-v2/
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node scripts/check-ui-boundaries.mjs
```

验收结束已关闭陪练测试房、临时 IAB 页及本次启动的本地 API／V1 服务；核对 19700／19701 不再监听。此前已有的 V2 19703、PostgreSQL 和 PDF 容器保持运行。两份专用数据库、截图和日志保留，未删除测试证据。关闭房间后再次审计，仍为费用与补偿各 192、待释放 0、总点数 2,000,000。

最终在当前 `main` 只提交本次测试、两处结算单位修复及配套记录。不部署、不 push，不修改生产数据库、APNs 网关或游戏收费方案；游戏内容不进入发布说明。

本轮产品回滚点仅为 `SettlementDetails`／`SettlementPanel` 的资金单位传递；测试夹具和记录可独立保留。没有生产迁移或部署需要回退。
