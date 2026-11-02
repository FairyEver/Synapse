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
| 显式隔离 PG 卡牌专项 | 8/8，通过；没有 skip |
| server `vitest run src/game --maxWorkers=2`，显式 PG | 最终 GAME_ROLL_STATS_SQL_TEST=1：646/646，无 skip |
| Dashboard `vitest run src/game-center/games/poker` | 372/372，通过 |
| shared typecheck | exit 0 |
| shared 完整 build/test | build exit 0；343 passed，1 failed（下述已有基线问题） |
| server tsc、Dashboard tsc、check:ui | 均 exit 0 |

真实 PG 专项覆盖：并发同 UUID 只生成一帧/一回执/一笔分录；实际分录写后故障全部回滚；存入→盗取→退款→最终释放资金守恒；原身份超时离开再入座不继承旧份额；并发 overview 只能看到释放前或后的完整快照；负额与身份篡改拒绝；流水和根帧不可变；正额 pending 阻止补助；90 天热冷归档保持私有投影、完整根帧和永久回执。

共享包已有失败：`shared/src/package-entrypoint.test.ts` 的通知来源固定列表遗漏已有 `game-poker`；实施基线同样如此，未修改通知模块以掩盖失败。

## 固定种子功能模拟与平衡边界

规则 `cards-v1`、资金 `chips-v2`；目录摘要 `1ea700d2ef4ca989ed87eb9c98c46bad87d07ffca64ff3c3b5e74ba9d556d57c`。种子 3、17、73、20261103，标准 52/短牌 32 两种牌库，生成类与十种状态共 240 个二卡组合，另有补给换牌、赦免 Roll、暂存盗取退款、防护反窥、全下改牌链路。每步校验真实资金、扑克牌和能力牌实例区域守恒、计时上限。生成每次 1/2 个新实例；这些短组合没有耗空共享池，空池行为由池/目录专项另验。

这是功能与不变量验证。未进行胜率、长期经济、筹码集中度或 PVP 实战平衡评估，不能据此宣称已经平衡；调整目录数值需要新规则版本和回归。

## 浏览器、系统契约与最终检查

- 最终服务端 `GAME_ROLL_STATS_SQL_TEST=1 vitest run src/game --maxWorkers=2`：646/646，exit0，无 skip。Dashboard 扑克 Node/jsdom 372/372；新入口相关 UI 25/25；54 项服务端 HTTP/来源/指南回归通过；卡牌机器人正额跟注另有服务层 RED→GREEN 和真实PG回归。
- `test:browser .../card-mode.browser.tsx`：45/45，exit0。覆盖1280×800、390×667、390×844、320×568、568×320、667×320的实际展开持牌、玩家目标、同名状态目标、能力候选、扑克牌候选、暂存筛选、结算；正文单一滚动、标题留白、标准按钮/关闭按钮、键盘 Escape 和焦点返回。850px 两侧复用同一画布，受控减少动态效果分支可操作。
- 根 `pnpm dev:server` 使用专用 `poker_card_browser_20261103_e2e` 库和19785/19786端口，独立Compose project。默认19700/19701已有服务，未执行会匹配全部服务的停止入口；测试结束仅停止本次PTY进程组与专用Compose资源，默认端口继续监听。临时 PostgreSQL 集群在最终复核后已用 pg_ctl 正常停止，19785/19786/19854/5432均无本次监听；数据和审计保留。
- 用 browser-skill/bsk 的Agent Window登录本次专用账号，实际创建 cards+Roll 点数房867846，真人对手由本次隔离夹具入座并准备。首局双方各3张；本人实际使用移花接木后持卡3→2、底牌交换；超级Roll实付2点数、钻石12→9、三选一完成；暂存显示2、原对手待分2。弃牌结算997+1003，直接查库核对能力牌持有/状态/待选清空、暂存最终释放和2000筹码守恒。双方显式准备、房主从牌桌再次开始，第二局又各3张且使用历史0；随后正常关闭并结算，双方总点数2000000守恒。浏览器会话已停止。
- 实页发现网页invoke建房来源遗漏，新增HTTP回归先RED后GREEN：仅既有创建操作传递经过认证的Cookie真人来源及版本，两条创建入口均拒绝Bearer及无版本请求，其他invoke调用不扩大权限。编译/构建与最终646项游戏回归覆盖修复。
- 卡牌陪练的机器人正额跟注缺报价版本问题已由服务层失败测试确认，并改为锁内携带服务器报价；真实PG验证机器人仍零持牌、正额跟注成功、取消不产生大厅收益。
- 系统 Skill/参考更新；`generate-game-reference.mjs`生成恰30个MCP工具，新增卡牌MCP为0，游戏Web为30（私有用牌/选牌2项）。桌面 `roll-skill-contract`/`human-control`12/12、`check:hard-constraints`、服务端/Dashboard类型、UI边界及最终Dashboard生产构建均exit0。桌面旧测试示例500已更正为当前1000，并明确拒绝500；未更改实际档位契约。

截图均为本地文件，尚无在线链接：

- `/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-03-poker-card-mode/browser/live-initial-three.png`
- `/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-03-poker-card-mode/browser/live-roll-pending.png`
- `/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-03-poker-card-mode/browser/live-reserve-two.png`
- `/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-03-poker-card-mode/browser/live-settlement.png`
- `/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-03-poker-card-mode/browser/live-second-three.png`
- 几何与展开筛选截图：`/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-03-poker-card-mode/browser/` 内按尺寸和面板命名的PNG，包含顶部与滚动后。
- bsk导出：`/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-03-poker-card-mode/browser/live-browser-trace.json`。该捕获存在8MiB留存上限、写入积压和被丢弃请求/console，不能作为完整网络/性能追踪；以界面截图、实际DOM、服务器回归和直接数据库不变量断言为主要证据。初轮选择器/HMR/扩展覆盖层失败已记录，未计作成功；没有修改浏览器扩展设置。

## 独立最终审查与修复

18项任务完成后，由一位全新上下文的 gpt-6-astra 只读审查整个 dc7c17648..6c79e918a 范围，提供设计、计划、逐字 Review Focus 及全部实施判断。未发现确定的 Critical；两项 Important 均经实施者确认后在同一次修复中完成，无二次审查。

1. 驱散目标原来只显示卡名。同名跨玩家状态、全场状态和多个实体标记的真实投影回归先失败；现显示所属座位/本人/全场、剩余次数、当前实体槽位及必要的同名序号，选项不包含暗牌面。投影8/8及六种屏幕的实际选择/原UUID提交通过。
2. 59号“星光一闪”原来只有服务端事件。真实 Table 浏览器回归先失败，现消费实时公开根帧，展示一次短星形反馈；重复帧不重播、重连基线不补播、切换身份/手牌清理，减少动态效果保留静态结果。宽屏和320px截图已目视复核；最终浏览器45/45、Dashboard372/372、服务端646/646、PG8/8，类型、UI边界、硬约束和生产构建均通过。

保留一个 Minor：卡牌入口暂未显示本人持牌数量，打开面板后可查看；未在本次重要问题修复中额外扩展。长期PVP平衡、生产演练、原有从未入座旁观者政策和无生产入口的内部离座命令，均由实施者逐项判断，见下方全部判断记录。

最终证据为本地文件，尚无在线链接：`.superpowers/sdd/2026-11-03-poker-card-mode/` 内 `final-game-retry.log`、`final-dashboard.log`、`final-browser-green.log`、`final-pg.log`、`final-*-type.log`、`final-ui-check.log`、`final-hard-constraints.log`、`final-dashboard-build.log`；根目录绝对路径同本文开头。新增截图为 `browser/*-status-top.png`、`browser/spark-1280.png` 和 `browser/spark-reduced-320.png`。

最终复跑曾因测试集群重启漏带临时端口而连接失败，已停止该专用集群并用显式127.0.0.1:19854/专用socket重启，成功重跑646项且零skip。原失败保存在 `final-game.log`，不是最终通过结果；最终旧迁移样本仍为7|pending。新增浏览器状态测试初轮误点HeroUI隐藏input而超时，改为真实可见卡面/目标标签点击后45项全部通过；未通过修改产品控件绕过点击验证。

## 回滚前提

生产尚未执行迁移。部署前应使用业务环境自己的备份和恢复演练；先保持创建开关关闭。已有 cards-v1/chips-v2 房间不可降级到旧代码继续写入，也不能删除暂存/帧/回执表来回滚；应等待相关局结束或使用兼容版本，保留原规则实现、资金审计和归档读取。

## 实施判断与代价记录

后续本地启用：用户要求在其现有 `pnpm dev` 环境开放并复测后，已设置本机 `server/.env.local` 的卡牌开关为true，通过原mprocs仅重启Server；`localhost:5433/synapse` 已完成108项迁移。真实dev主流程12项及机器人普通行动补充1项通过，测试账号和房间已收尾。浏览器独立登录验收受无痕权限限制，本轮使用真实HTTP与查库证据。详情见[本地dev启用与复测](/Users/liyang/Documents/code/github/Synapse/docs/superpowers/acceptance/2026-11-03-poker-card-mode-local-dev.md)。上文“默认关闭”和“仅隔离库”等描述保留对应实施阶段的历史范围，当前本地状态以该后续记录为准；生产默认仍关闭。

以下按发生顺序保留执行时的全部判断；上文事实和结果为最新验收状态，早期范围判断不替代最终验证。

1. Ruling: Work on current main without worktree — explicit repository and approved-plan scope overrides skill isolation default — cost if wrong: less isolation; only task files are staged.

2. Ruling: Self-test authorization includes dedicated loopback _e2e database and isolated browser fixtures needed by the approved plan; no production migration/deployment or unrelated running app changes — fulfills latest user instruction without repeated questions — cost if wrong: local test resource usage.

3. Ruling: Normalize Task Tn headings to Task n so the installed task-start parser can extract briefs; task IDs and requirements unchanged — cost if wrong: documentation-only.

4. Ruling: shared full suite has baseline package-entrypoint.test.ts failure: expected notification source list omits game-poker, which already exists at execution base dc7c17648; leave unrelated notification code unchanged and report by name — cost if wrong: shared full-suite status remains one known baseline failure.

5. Ruling: extend Roll required-fields regression to exclude the newly optional expectedPaymentVersion, preserving all old required inputs — approved backward-compatible contract — cost if wrong: optional quote binding could be enforced too weakly, covered by v2 service tests later.

6. Ruling: generalize existing validated shuffle to generic T so ability instances reuse identical entropy validation — avoids a second shuffle implementation — cost if wrong: changed inferred types for callers, checked by server typecheck and existing engine tests.

7. Ruling: derived operations finish depth-first before the next root step; integration test exposed the earlier breadth-first queue violating the settlement barrier — cost if wrong: effect ordering changes within new runtime only; prior runtime regressions retained.

8. Ruling: applyReserveOperation additionally receives injected ResolutionContext (IDs/actionSeq) before order; plan omitted this required pure-input port — no global entropy or clock introduced; all call sites typed.

9. Ruling: use chips/operations.ts for registered payment/reserve adapters and catalog/definition.ts for data constructors; avoids putting chip policy in card IDs or Roll. Richest target locks from pre-cast shares before its own optional tax deposit, matching recent-deposit pre-cast boundary; no target switch after protection.

10. Ruling: WriteBatch additionally declares resulting revision because one root can contain several reserve operations; expectedRevision alone cannot persist the pure-state revision. Lot rows carry the aggregate revision under a scoped transaction advisory lock. Query all audit rows through bounded 1000-row keyset pages, with no new gameplay limit on Roll deposits.

11. Ruling: normalized new ownHand payload to instanceId/cardId plus definitions dictionary before private Web rollout, fulfilling the approved deduped catalog contract. New public frame payload contains only whitelisted public facts; private observations stay in the owner panel.

12. Ruling: retain the new resolution FK and permit deletion only after exact immutable cold-copy verification, like existing Roll archival; extend the still-unapplied migration with full root/card/reserve source. Movement rows remain append-only. Migration policy test checks top-level mutations, excluding the body of the existing controlled archival routine.

13. Ruling: add nullable nominalAmount/waivedAmount to actions and a checked money equation; old rows remain NULL and stats use legacy amount fallback. This is necessary to classify nominal all-in raises without treating waivers as real assets. No migration has run.

14. Ruling: extend ResolutionContext.source with mcp so ordinary no-card v2 AI actions retain their true source rather than masquerading as human. Card-mode policy still rejects mcp before receipts.

15. Ruling: new poker-resolution.ts adapter centralizes reserve/frame/Roll audit writes for every root; pulled the small mode policy file forward from T12 because T11 requires policy before private cached receipts. T12 still owns all admission/transport/config gates.

16. Ruling: retain canonical legacy roll.pending and card-origin cards.pending as mutually exclusive zones, never duplicate persisted candidates. Both are checked by the shared coordinator and physical invariant; projection resolves their different private UI paths.

17. Ruling: explicit Date is a controlled test/internal clock override; default external writes, funded timeout and bot jobs sample inside locks. API action/start/Roll adapters stop supplying a prematurely captured Date. Timeout elapsed uses deadline minus original turn start, excluding scanner downtime and avoiding Int overflow after long outages.

18. Ruling: preserve existing public invoke HTTP201 business-failure envelope; test checks ok=false instead of changing its contract. Stateful store now mirrors Prisma handoffPending=false default and actual room-code lookup. New private Web count30 verified from exports; game30/global364 capability/360 MCP unchanged.

19. Ruling: HumanControls AI entry suppression is pulled forward into T13 because hiding only the lobby leaves an actionable card-room AI surface. Pull forward one exhaustive MatchLog card icon mapping from T15 after tsc exposed the new union member; full card log presentation remains T15. Legacy assertions now include explicit cards=false without changing ordinary Roll behavior.

20. Ruling: ordinary betting and Roll must forward existing v2 payment versions to work in card rooms; this adjacent hook seam is completed with mutual pending/unknown-write guards. Attempted-empty draws now retain private feedback and privately observed ability IDs receive owner-only definitions; public payload remains unchanged.

21. Ruling: the table panel type already flows through PokerControlPanel, so no duplicate Table/usePokerRoom changes are needed in T14. Covers resolve through local asset glob; actual GPT images are still exclusively T16 and no placeholder asset was added. Expanded browser geometry/focus remains T18.

22. Ruling: preserve roll as existing internal canvas anchor only, while new chip wire data uses reserve and source-independent movements. Legacy frozen Roll ledger is read-only adapted to the generic reserve dialog. New v2 financial feed includes actual-direction facts from32 complete roots, at most4096 transfers, final allocation grouped per original recipient to stay bounded even after many Roll deposits. v2 motions execute sequentially and reconcile only real balances; no zero-amount motions.

23. Ruling: add publicHole index/card pairs rather than padding a full hole array, so one marked physical card follows its holder without revealing the other card. Add owner-only betWaiverCap and public nominal/waived log fields for truthful previews; public local view strips quotes/cap. Movement beneficiaryKey identifies the original claim whose share was stolen/refunded. Public protection facts carry only seat/card metadata; observations stay private.

24. Ruling: typecheck caught a marker test missing ownerAdmissionId; corrected the fixture. The existing fundedBetCapacity helper returns the additional waiver amount, not total assets; a service regression exposed an erroneous subtraction and now verifies20 for10BB atBB2. Legacy Table entry tests now validate the approved 暂存 label and unchanged403 original frozen total.

25. Ruling: add SQL immutable original lot/claim identities after a real constraint regression exposed direct mutation acceptance; migration is still unshipped and final evidence comes from restoring pre-migration backup then applying revised SQL — cost if wrong: new table identity corrections require controlled audit migration, not direct UPDATE.

26. Ruling: legacy Roll/lock fixtures explicitly create NULL chip versions; historical odd-fee fixture uses its true2000 buy-in at creation. New default rooms stay chips-v2. Strict-v2 replay tests now resend identical parameters; stale altered parameters reject. Test scheduling uses fake Date sampled inside real locks; synthetic states preserve v2 participants/clock. Nudge now explicitly starts/sets public URL; concurrent room test starts after both joins as current lifecycle requires — cost if wrong: legacy expectations might not represent production, so separate new-v2/card PG scenarios remain authoritative.

27. Ruling: ordinary practice cancellation keeps NULL result while persisting its new root cancellation action; regression excludes hand_cancel only when checking that late queued bot/timeout performs no additional gameplay — cost if wrong: consumers may distinguish new audit rows, covered by state/summary assertions.

28. Task18 Ruling: default19700/19701 already host user-owned services; add optional Dashboard port/open overrides with unchanged defaults to run root pnpm dev:server on19786/19785 and separate browser_e2e database. Isolated hostname poker-card-e2e.localhost avoids user login cookies. Broad root quit matches existing services, so stop only the owned PTY process group and own Compose project — cost if wrong: extra local startup knobs, verified by actual root startup; no existing process is stopped.

29. Ruling: keep generic invoke's existing caller behavior except authenticated room creation, rather than globally promoting all Cookie invoke calls to human; strict card guard also covers that creation route — cost if wrong: future UI operations must explicitly choose transport, no widening of existing card writes.

30. Ruling: isolate Vite Browser cache and nondefault Dashboard port cache after simultaneous dev/test optimizers invalidated the live document; confirmed stable actual interaction after separation — cost if wrong: extra ignored dev caches, default entry remains unchanged.

31. Ruling: existing desktop human-control fixture still declared removed500 buy-in valid. Correct valid example to1000 and explicitly assert500rejected without changing schema — cost if wrong: historical room creation no longer represented by new-create tests; legacy persisted rooms retain separate coverage.

32. Final: Ruling: retain this task’s ignored evidence workspace rather than delete it — the acceptance record points to actual local screenshots, GPT source provenance, database backup and test logs; deleting it would invalidate reviewable evidence and conflict with the user’s no-destructive-cleanup boundary — cost if wrong: local disk usage until the owner explicitly cleans it.

33. Final: Ruling: finish on current main with task-only local commits, no branch-integration menu — user explicitly requires current checkout and no questions; there is no feature branch to merge and no push/deployment authorization — cost if wrong: publication remains a later explicit operation; the unrelated shared notification baseline test remains reported rather than silently repaired.

34. Final: Ruling: long-term PVP balance remains unjudged — functional seeded simulations establish invariants, not fair win rates or economic concentration; acceptance explicitly limits the claim — cost if wrong: live balance may need a new catalog version after playtesting.

35. Final: Ruling: production migration/deployment/recovery is outside this delivery — only task-owned loopback DB restore was executed and creation stays off by default — cost if wrong: rollout still needs real environment backup/recovery and version-gate validation.

36. Final: Ruling: retain pre-existing never-seated spectator poker-hole visibility — approved design preserves existing poker visibility while card owner data is separately fail-closed; decision/MCP card mode remains public — cost if wrong: broader spectator policy needs a separate product decision and regression.

37. Final: Ruling: do not invent a new production participant.leave caller — actual in-hand departures use leavePending and existing settlement; no current caller reaches the hypothetical nonactor pending-choice branch — cost if wrong: a future direct caller must add lifecycle coverage before exposure.

38. Final: Ruling: retain the shared notification baseline failure as a reported limitation — exact base already contains game-poker but the fixed expected list omits it; unrelated module repair is outside this change — cost if wrong: full shared suite remains one failure despite all changed game contracts passing.
