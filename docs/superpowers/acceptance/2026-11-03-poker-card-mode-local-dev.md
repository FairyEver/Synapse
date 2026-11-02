# 卡牌模式本地 dev 启用与复测

日期：2026-11-03（Asia/Shanghai）。用户明确要求打开卡牌模式，并在其已通过 `pnpm dev` 启动的环境测试。

仓库 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`。测试入口为现有 `http://localhost:19700`，经 Dashboard 代理访问 `19701` API；实际数据库为 `localhost:5433/synapse`，没有改用先前的隔离 `_e2e` 库。

## 启用与迁移状态

- 在被 Git 忽略的本机配置 `server/.env.local` 添加带中文说明的 `GAME_POKER_CARD_MODE_ENABLED=true`。生产默认值和示例仍为 false。
- 通过用户现有 cmux 终端里的 mprocs 重启 Server 项，保留同一个 `pnpm dev` 管理器，Desktop 和 Document 未随之重启。API 等待 21858ms 后 `/readyz` 成功，数据库、PDF renderer、对象存储检查正常。
- 本地开发启动流程已完成 108 项迁移。卡牌迁移 `20261103000000_game_card_mode_and_reserve` 的数据库 checksum 与仓库 SQL 一致；四张新表、五个新字段和四类资金不可变触发器已核对。再次执行 `prisma migrate deploy` 返回无待执行项。
- 实际已运行的服务返回 `cards.available=true`，同时保留 `aiPlay=false`、`botReceivesCards=false`、`botUsesCards=false`。已打开的页面需要刷新以重新读取 guide。

## 真实流程结果

使用本次新建的两个独立本地测试账号，以正常 Web 登录取得各自会话，在内存中隔离 Cookie。除准备这两个账号外，建房、准备、开始、用牌、下注、Roll、管理机器人、结算和关闭均调用实际运行服务的 HTTP 接口；没有修改引擎状态、牌序或持牌来构造结果。

| 检查 | 结果 |
| --- | --- |
| 两名独立 Web 登录与会话身份 | 通过，未使用浏览器中用户的会话 |
| 当前 dev 卡牌开放及规则版本 | available=true，cards-v1/chips-v2 |
| 缺版本、跨来源、Bearer/AI 创建 | 均被实际拦截 |
| 网页建房同路径、创建 UUID 幂等、准备和开始 | 点数房851232；双方初始各3张，六个实例唯一 |
| 当前持牌正式封面 | 实际6张PNG由 dev 服务返回，签名及SHA均匹配清单 |
| 超级 Roll 与卡牌共存 | 三候选、钻石扣3、实付2进入暂存；重复请求不重复收费；待选阻止下注，候选仅本人可见 |
| 实际随机能力牌使用 | 使用01“换牌术”；原UUID回执一致、卡实例消耗、公开使用记录一次；跨账号复用请求被拒绝 |
| 卡牌房 AI 接管 | 被实际拒绝 |
| 本手结算 | 持牌/状态/候选清空，暂存完成释放 |
| 同房第二手 | 双方重新各3张、使用历史0；翻牌后各4张 |
| 点数房关闭与守恒 | 正常关闭；两账号合计2000000点，无占用和待分 |
| 陪练机器人 | 房18562，真人3张、两个机器人0张，观察到自动Roll；取消关闭不兑换点数 |
| 陪练普通行动补充 | 房795363，两个机器人实际跟注，实付分别为2和3；仍零能力牌、没有用牌动作，关闭后真实钱包不变 |

主流程12项及机器人普通行动补充1项全部通过。测试没有发现需要修改产品代码的问题。

## 测试资源收尾与证据

首轮辅助脚本误写身份头，在游戏操作前被409拒绝；改为读取共享契约常量。下一轮辅助脚本误用不带 `/console/` 的素材地址，收到404；按实际 Vite base 修正后正式封面检查通过。该轮留下的点数房12505已通过正常弃牌结算、关闭回收。以上失败不计入通过结果，未通过放宽产品校验解决。

最终查库确认，本次四个房间12505、851232、18562、795363均为closed；两个测试账号均已disabled；测试游戏会话全部closed，测试登录均已撤销。测试账号总钱包点数仍为2000000。保留账本、回执与历史，不执行跨任务truncate或删除审计。

本轮使用真实 HTTP、真实服务进程及本地数据库验证。BrowserSkill 的无痕访问未被浏览器授权，独立登录的浏览器页面验收未执行；没有用其他浏览器后端绕过该权限。先前45项浏览器专项属于总体验收，不能当作本轮新页面操作的证据。本轮实际出牌只覆盖随机抽到的01，其他卡牌及组合的专项证据见[总体验收](/Users/liyang/Documents/code/github/Synapse/docs/superpowers/acceptance/2026-11-03-poker-card-mode.md)。

以下均为本地文件，尚无在线链接，目录为 `/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-03-poker-card-mode/dev-enablement/`：

- `live-dev-check.cjs`、`live-dev.log`、`results.json`：12项实际HTTP流程与断言。
- `live-bot-check.cjs`、`live-bot.log`、`bot-ordinary-result.json`：机器人实付普通行动补充。
- `cleanup-verified.json`：最终房间、登录、占用和资金状态。
- `live-dev-attempt-1.log`、`live-dev-attempt-2.log`：未通过的辅助脚本尝试。
- `config-change.json`：本地开关原状态和新状态，不包含其他环境配置。

## 本地配置回退

如需停止创建新卡牌房，将本地键设为false，并通过同一个mprocs管理器重启Server。仅回退开关，不降级正在进行的新规则牌局，不删除资金/回执/帧表；已有新规则房间继续由兼容实现完成。本轮未操作生产配置或部署。
