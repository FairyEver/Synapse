# 卡牌模式实施验收记录

实施仓库：`/Users/liyang/Documents/code/github/Synapse`；实施分支：`main`；基线：`dc7c1764862bf74a2ea37b993e3b03b01e1d0c10`。未创建分支或 worktree，未推送、部署或启用生产开关。默认 `GAME_POKER_CARD_MODE_ENABLED=false`。

## 已验证的实现

- 60 种、90 份共享能力牌；真人每局初始 3 张，阶段补牌；机器人不领牌，AI 接入卡牌房被拒绝；结算清理运行态。
- 注册式生命周期、原子根动作、延后效果、选择与超时、私有情报、不可变回执和审计。
- chips-v2 区分名义、豁免和实付；通用暂存记录原支付和原入座份额，支持盗取、退款、保护和最终释放。旧 NULL 版本继续原规则。
- 本人卡牌面板、持久化未知请求恢复、真实代价预览、公开状态与用牌历史、暂存明细和有序筹码动画。
- 60 张独立 GPT 封面及完整提示词/哈希/实际尺寸清单。工具未提供精确模型名和 seed；原图保留为 1122×1402，界面按 4:5 展示，07/17 用 GPT 编辑修正花色。未使用占位图。

## 数据库迁移与恢复

专用本机 PostgreSQL 16.15，127.0.0.1:19854；新建库 `poker_card_20261103_e2e`、`poker_card_restore_20261103_e2e`。所有数据库操作仅在本次新建的测试集群内进行，没有业务库兜底。

先在首库应用当前迁移之前的全部迁移，写入旧 NULL 版本房间与 7 筹码 pending 样本，执行 `pg_dump -Fc`，再 `pg_restore --exit-on-error` 到恢复库。恢复后仍为 `7|pending`。最终迁移在恢复库成功应用，测试后旧记录仍为 `7|pending`。

迁移文件：`server/prisma/migrations/20261103000000_game_card_mode_and_reserve/migration.sql`。首次真实测试发现锁返回 void 和份额对象带入行动状态两个问题，均已 RED→GREEN 修复；新增数据库原资金身份不可变约束后，从迁移前备份恢复的库重跑迁移与全部专项。初轮失败库保留为诊断样本，不用于最终验收。测试集群与不可变审计保留在忽略目录，不做跨任务 truncate 或清理。

备份、数据库日志和逐次测试证据位于：`/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-03-poker-card-mode/database/`，仅本地文件，尚无在线链接。此备份仅是专用测试库的恢复演练，不能作为生产备份。

## 验证结果

| 命令/范围 | 结果 |
| --- | --- |
| `node dashboard/scripts/check-poker-card-assets.mjs` | exit 0，60/60；目录、PNG、尺寸、SHA、唯一性与溯源有效 |
| `pnpm --filter @synapse/dashboard build` | exit 0；产物 60 张 PNG 与清单 SHA 逐一相符；已有 chunk 大小提示仍存在 |
| Dashboard 卡牌面板专项 | 15/15，通过 |
| 固定种子组合 + 暂存 + runner 单元 | 30/30，通过 |
| 未配置 `test:poker-cards:e2e` | exit 1，在任何迁移/连接前拒绝，符合预期 |
| 显式隔离 PG 卡牌专项 | 7/7，通过；没有 skip |
| server `vitest run src/game --maxWorkers=2`，显式 PG | 641 passed，1 skipped；该可选 SQL 统计项另以 GAME_ROLL_STATS_SQL_TEST=1 执行，1/1 通过 |
| Dashboard `vitest run src/game-center/games/poker` | 372/372，通过 |
| shared typecheck | exit 0 |
| shared 完整 build/test | build exit 0；343 passed，1 failed（下述已有基线问题） |
| server tsc、Dashboard tsc、check:ui | 均 exit 0 |

真实 PG 专项覆盖：并发同 UUID 只生成一帧/一回执/一笔分录；实际分录写后故障全部回滚；存入→盗取→退款→最终释放资金守恒；原身份超时离开再入座不继承旧份额；并发 overview 只能看到释放前或后的完整快照；负额与身份篡改拒绝；流水和根帧不可变；正额 pending 阻止补助；90 天热冷归档保持私有投影、完整根帧和永久回执。

共享包已有失败：`shared/src/package-entrypoint.test.ts` 的通知来源固定列表遗漏已有 `game-poker`；实施基线同样如此，未修改通知模块以掩盖失败。

## 固定种子功能模拟与平衡边界

规则 `cards-v1`、资金 `chips-v2`；目录摘要 `1ea700d2ef4ca989ed87eb9c98c46bad87d07ffca64ff3c3b5e74ba9d556d57c`。种子 3、17、73、20261103，标准 52/短牌 32 两种牌库，生成类与十种状态共 240 个二卡组合，另有补给换牌、赦免 Roll、暂存盗取退款、防护反窥、全下改牌链路。每步校验真实资金、扑克牌和能力牌实例区域守恒、计时上限。生成每次 1/2 个新实例；这些短组合没有耗空共享池，空池行为由池/目录专项另验。

这是功能与不变量验证。未进行胜率、长期经济、筹码集中度或 PVP 实战平衡评估，不能据此宣称已经平衡；调整目录数值需要新规则版本和回归。

## 待完成验收

真实浏览器展开/键盘/多尺寸、隔离页面、规则与系统 Skill 导出同步及最终独立审查正在执行；本节完成前不宣称整版验收。

## 回滚前提

生产尚未执行迁移。部署前应使用业务环境自己的备份和恢复演练；先保持创建开关关闭。已有 cards-v1/chips-v2 房间不可降级到旧代码继续写入，也不能删除暂存/帧/回执表来回滚；应等待相关局结束或使用兼容版本，保留原规则实现、资金审计和归档读取。
