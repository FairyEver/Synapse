# 机器人陪练房实施与验证记录

2026-10-30，仓库 `/Users/liyang/Documents/code/github/Synapse`，全程 `main`，实现基准 `6d61d8227`，工作区起始干净。设计由用户明确确认；在当前会话原地实施，不新建分支/worktree、不 push、不部署。

## 已实现

- 房间创建时固定 points/practice，旧房默认 points。practice 整桌练习筹码；真人仍通过外部 AI/MCP 入座出牌，桌面只读。
- 大厅新增通用 funding。practice GameSession 的 buyIn/inPlay/returned 仅0/null，数据库强制约束、资金类型不可变；练习入座不创建/扣款点数账户，结算/离场不兑点。补助、点数流水只看 points，会话仍支持 overview 重连和跨游戏进行中。
- 房主可增删程序机器人，机器人不是 User/GameAccount/GameSession。稳定创建标识和永久 GamePokerBot 创建记录阻止丢响应重复、删除后重试复活；至少保留一位真人容量，手中增删下一手/手后生效，输光不补。
- 纯策略只接受本人底牌及公开信息；内部动作复用原引擎、房间锁和幂等写入，来源 rules_bot 与 timeout 分离。持久 botActionAt、1秒调度、每批100房/每房一步、稳定轮转；真人600秒规则不变。
- 只有机器人或真人全部暂离不开新手，机器人活动不续无人房寿命。nudge 机器人由服务端拒绝，无实际通知发送。
- 正式/练习的历史、统计、版本手数、归档分别读取；摘要保存 mode，旧归档缺字段默认 points。牌桌、记录标识机器人，不放宽暗牌、persona、note 或观战投影。
- 22项游戏MCP索引/20项窄IPC，共365 capability/361 MCP索引，公开仍 search/invoke。机器人管理可由桌面调用，仍无真人 act/seat_join/table_wait bridge；补齐中文机器人/陪练/添加检索词、能力门禁与生成的API参考。
- 桌面建房模式、房间列表、进行中标识、房主机器人管理与失败重试、机器人行动状态、练习历史和战绩筛选；统一App顶栏及固定牌桌配色保持。

## 先失败再修复的证据

- Hall practice 零带入被原服务拒绝：`/tmp/practice-funding-red.log`；实现后 hall+资金3文件10项通过，`/tmp/practice-funding-green.log`。
- 机器人生命周期、策略/调度缺失：`/tmp/practice-lifecycle-red.log`、`/tmp/practice-bot-red.log`；首批分别9项、5项通过，`/tmp/practice-lifecycle-green.log`、`/tmp/practice-bot-green.log`。
- 默认历史/列表混入练习、索引仍20项：`/tmp/practice-read-red.log`；修改后3项通过，`/tmp/practice-read-green.log`。既有10001手累计统计因 Room join 被过滤的回归保留原断言修复，原记录和练习热冷共10项通过，`/tmp/practice-read-final.log`。
- 桌面新IPC/响应契约、管理界面缺失：`/tmp/practice-protocol-red.log`、`/tmp/practice-ui-red.log`；最终游戏桌面23文件130项通过，`/tmp/practice-desktop-game-final.log`。
- 独立只读审核发现 HallService 通用并发关闭退化：原修改先读会话后等账户锁，两个事务可重复退款。实库同步屏障精确复现总额多退1234，`/tmp/practice-concurrent-refund-red.log`；锁内重新读取关闭状态后4项通过，`/tmp/practice-concurrent-refund-green.log`。
- 按审核补足手中 leave/close/timeout 与点数房退款并发、真人/机器人输光移除、第101个机器人坏房轮转：3文件16项通过，`/tmp/practice-review-coverage.log`。这些新增覆盖首次即绿，属于补充风险路径证据，不冒称全部经历红绿。
- 桌面首次全量4项失败，均为新增注册表面尚未同步：全局363/359应增至365/361、bot/add缺中文检索词。未删除或放宽门禁；按准确增量更新断言，补生产词表和真实用户检索语料，24项门禁通过，`/tmp/practice-router-green.log`；首次全量日志保留在`/tmp/practice-desktop-full.log`。

## 验证结果

- 服务端最终完整命令：`GAME_E2E_DATABASE_URL=postgresql://game_review@127.0.0.1:55439/synapse_practice_e2e pnpm --filter @synapse/server test --maxWorkers=1`，**197文件、2273项通过**。日志`/tmp/practice-server-full-final.log`。首次普通全量曾在未修改的 mail HTTP 两项返回501，保留`/tmp/practice-server-full.log`；最终完整重跑通过，不将初次失败隐藏为全绿。
- 实库规则机器人配合测试驱动真人行动连续完成50手；多实例同一调度只落一条动作，重建任务继续推进，点数总额及盈亏不变。这是程序集成验证，**不是本轮重新运行两个真实AI验收**。详见bot-action.spec.ts与`/tmp/practice-bot-green.log`，最终完整套件也覆盖。
- 服务端API生产构建通过：`/tmp/practice-server-build-final.log`。额外server全项目typecheck仅有原有通知测试`notification.service.spec.ts:274` TS2493，`/tmp/practice-server-types.log`；没有修改该测试。
- 桌面最终完整类型检查通过：`/tmp/practice-desktop-types-final.log`。完整命令`pnpm --filter @synapse/desktop run test --maxWorkers=2`，**1142文件、11647项通过，另2项既有native测试跳过**；日志`/tmp/practice-desktop-full-final.log`。客户端实现自该最终全量启动后未改变，仅更新交付文档。
- 本轮新增31项回归（server 24、desktop 7）；独立审核指出的并发退款及关键风险覆盖均已处理，完整服务端套件也包含补充用例。
- hard constraints通过，`/tmp/practice-hard-final.log`；IPC生成门禁通过，`/tmp/practice-ipc-check.log`。`git diff --check`通过。

## 迁移与运行边界

两份迁移：`server/prisma/migrations/20261030130000_game_poker_practice/migration.sql`（房间模式/调度、会话资金、参与者类型/来源、永久创建记录与约束）；`20261030131000_game_poker_practice_summary/migration.sql`（摘要资金分类）。仅在任务自建本机库`127.0.0.1:55439/synapse_practice_e2e`执行，从已有96份迁移到总98份均成功。日志`/tmp/practice-migrations-base.log`、`/tmp/practice-migrations.log`、`/tmp/practice-migrations-summary.log`。没有业务库迁移或真实账号写入。

任务Postgres数据目录`/tmp/synapse-game-review-pg.CQIvek/data`，启动时短暂使用默认5432后立即停止，随后明确仅监听127.0.0.1:55439；测试始终只连接55439专用库，没有连接5432业务服务。测试结束已用pg_ctl fast stop停止任务集群，并确认55439无监听，保留数据及日志。

上线须先迁移及服务端，再客户端。已有陪练数据后不能回滚到把所有座位当点数退款的旧API；需要停用时禁止新建/添加并合法收尾，保留mode/funding及记录。不提供删除表或清空资产的回滚。

## 审核裁量与未执行项

- Ruling：将资金类型保存进摘要而非仅依赖Room join，保留旧独立汇总的统计语义，也让冷记录自带分类；代价是多一份增量迁移，已实库验证。
- Ruling：未重新执行真实AI长局/桌面实际点击验收，当前任务不额外启动应用或外部模型进程；因此仍需部署后做这些真实链路验收，不能把程序50手等同真实AI验收。
- Ruling：版本计数仍可依赖现存Room的固定mode，生产没有删除Room的入口；若未来增加删房，必须同时保存分类并改该查询，否则旧版本使用计数可能缺失。
- 未改待解散房间仍展示“添加机器人”的状态提示；服务端已拒绝新添加，可能出现一次可解释错误，无资金或权限绕过。这是非阻挡的界面细节，后续可细化禁用状态。
- 未启动桌面/浏览器/开发服务器，未部署、发版、push或发送通知；新功能尚未上线。所有计划、报告及日志均为本地文件，暂无在线分享链接。
