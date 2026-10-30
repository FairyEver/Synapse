# 游戏大厅第三轮审核与修复

2026-10-30，仓库 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`，本轮起点 `47d0489d2`。审核范围为 `20fcd49c9...HEAD` 的完整功能，本轮重点是长期运行、取消、写后刷新、终局结果恢复及短筹码边界。事实来源仍为用户桌面“德州扑克”目录的产品设计文档、实施计划、提示词，以及对话中确认的冲突处理与界面例外。

## Standards

- **P2：认证刷新挂起会绕过游戏请求超时和取消。** 原 30 秒定时器只触发 AbortController；真实 AccountService 在 401 后等待未接收该 signal 的共享认证刷新，游戏调用仍不结束，界面可能永久忙碌。游戏服务现对 fetchAuthenticated 与 JSON 读取使用可取消等待，监听在完成、异常、取消时释放。用真实 AccountService、内存凭据与合成 fetch 先建立登录，再让 401 后刷新挂起，复现超时、取消、销毁、退出账号不能结束；修复后均及时结束。随后放行刷新并等待底层调用结束，确认不会重发旧写入。共享账号模块没有修改，也不取消其他消费者共用的认证刷新。
- **P2：读取忙碌时吞掉保存后的刷新。** 原 useGameQuery 的 busy 分支立即返回，保存后调用 refresh 可能被正在读取的旧列表吞掉，随后旧结果留下永久过期列表。现在显式刷新至多合并一批尾随读取，调用者等待该批次完成；轮询繁忙时仍跳过，避免排队增长。卸载/账号变化时结束并清理未执行批次，旧读取不覆盖新身份。

Standards 2 类，主要风险为请求不能结束导致操作长期不可用。两项分别新增 5 个网络边界用例与 4 个查询生命周期用例，均先复现失败，再验证修复。

## Spec

- **P2：离桌、输光或关桌后漏掉最终结算，归档后也无法补读。** 产品 §7.3 要求每手结果；原 wait 在读取结算之前判断座位不存在/房间已关，且只查询热表。现在已离场时仍按 cursor 先返回本次入座的未读 hand_result，再返回 table_closed；热表和归档一致，按账号、房间与 session.startedAt 隔离，避免重入后读旧入座账。空 cursor 仍直接恢复当前牌况，超时 lastAutoAction 优先规则保持；同一 cursor 重试可重放同一结算，调用者按 handNo 去重并推进返回 cursor。
- **P2：数字越界游标导致服务端查询异常。** 格式匹配不能阻止超出数据库 int32 的 handNo/seq，末端哨兵加一还会溢出。现在先校验两段整数范围 0..2147483647，返回 POKER_ILLEGAL_ACTION；结算之后用严格大于原 handNo 查询，不执行哨兵加一。15 个 wait 回归覆盖这些边界、最终结果、真实归档/读取竞争、重新入座隔离，以及真实数据库 200 手积压后逐手消费且最终不重复。
- **P2：短大盲已被匹配仍要求多余行动，且允许无人应答的加注。** 单挑大盲只剩 1、小盲已投 1 时，原 currentBet=2 仍要求小盲多跟 1，甚至可能超时离场。现在只有一个有筹码者时按未弃牌对手的实际本街投入计算欠注，已匹配就直接发完公共牌结算；无人能应答时不提供加注/超额全下，仍允许不足额全下跟注，多人仍可行动时保留完整盲注及最小加注。引擎保持纯函数，未引入时钟、网络或数据库。新增 6 项引擎测试（3 项先失败，另 3 项保护原行为及随机小筹码），其中 1..5 筹码的 1,000 手随机行动全部终止、非负整数且守恒；原 1,000 手常规随机回归也保持。

Spec 3 类，主要风险为终局结算丢失及无需行动的座位被错误等待。两位审查者独立复核本轮查询、取消清理、引擎规则与文档，未发现确定新回归。没有为“完善”新增人类出牌入口、模型托管、seatToken 或对手控制权限。

## 验证

本轮新增 30 个回归测试（桌面 9、服务端 21）。游戏桌面专项 16 文件、60 项通过；真实数据库游戏专项 16 文件、101 项通过。命令沿用仓库 Vitest 与独立 `_e2e` 数据库，不使用业务账号。

- 服务端带真实数据库全量：`GAME_E2E_DATABASE_URL=postgresql://game_review@127.0.0.1:55439/synapse_game_review3_e2e pnpm --filter @synapse/server test --maxWorkers=1`，182 文件、2,199 项全部通过，无跳过；日志 `/tmp/game-review3-server-full.log`。
- desktop 完整 typecheck、`check:hard-constraints`、Renderer 构建通过；日志 `/tmp/game-review3-desktop-types.log`、`/tmp/game-review3-hard.log`、`/tmp/game-review3-renderer-build.log`。server 生产 API 构建通过，日志 `/tmp/game-review3-server-build.log`。
- 额外 server 全项目 typecheck 未通过，唯一错误仍为既有 `server/src/notifications/notification.service.spec.ts:274` TS2493，日志 `/tmp/game-review3-server-types.log`；本轮未修改无关通知测试，不能写成全项目类型检查通过。
- 首次 desktop 全量：11,576 通过、1 失败、2 项既有 native 跳过。失败是既有 `mobile-workspace-files-service.test.ts` 的独立 Git 基线预算用例，返回 cancelled，游戏相关测试没有失败。该用例保持原预算、断言与源码，独立复跑通过；日志 `/tmp/game-review3-desktop-full.log`、`/tmp/game-review3-unrelated-workspace-retry.log`。随后重跑完整套件，结果如下。
- 最终 desktop 全量：`pnpm --filter @synapse/desktop run test --maxWorkers=2`，1,135 文件、11,577 项通过，2 项既有 native 测试跳过；日志 `/tmp/game-review3-desktop-full-final.log`。先前失败的移动工作区文件测试在此次完整复验 80/80 通过，未修改其源码、预算或断言。
- `git diff --check` 通过。本轮只在 main 本地提交，无 push。

## 交付边界

- 独占数据库 `postgresql://game_review@127.0.0.1:55439/synapse_game_review3_e2e` 从空库部署既有 95 份迁移；日志 `/tmp/game-review3-migrations.log`。本轮没有新迁移，不连接或写入业务库，不部署、发布或 push。
- 临时 PostgreSQL 集群 `/tmp/synapse-game-review-pg.CQIvek/`；本轮数据库验证结束后已停止，保留数据和日志。本轮没有启动应用或浏览器，真实 Claude Code + Codex 50 手及手机验收未重跑，不能将此前成功结果称为本轮执行。
- 已同步 shared 工具描述、系统 Skill、协议、Agent 指南、模块边界、能力清单及 `RELEASE_NOTES_PENDING.md`。仍为 20 个游戏 MCP 索引、18 个游戏 IPC，数量与权限边界不变。
- 回退本轮应用提交不删除点数、归档、行动或幂等凭据。记录和日志只有本地路径，尚无在线分享链接。
