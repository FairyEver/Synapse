# 游戏大厅接入与验证

用户带自己的Agent通过Synapse MCP打牌；桌面只能观看、管理房间与私密选手配置。系统不托管模型、不代替真人出牌，也没有座位令牌；正式产品支持程序机器人陪练房。

陪练流程：room_create(mode=practice)→房主bot_add(roomCode,creationId=UUID)→真人AI正常overview/join/wait/act。bot_remove按botId，本手参与者手后移除；计分房/非房主拒绝。新机器人新UUID，同次重试复用，移除后旧标识不复活。机器人不是账号，无大厅账户/会话；规则策略只接本人及公开信息，持久调度、房锁和引擎裁决。仅机器人或真人全暂离不发新手，机器人不续无人房寿命。

陪练GameSession funding=practice，buyIn/inPlay/returned仅0/null，练习筹码不进账户盈亏或流水；默认历史/统计points，明确mode=practice查练习，归档及版本手数保持隔离。上线须先执行20261030130000_game_poker_practice和20261030131000_game_poker_practice_summary迁移，再API与桌面；已有练习数据后不能回到无资金类型隔离的旧退款逻辑。

接入先通过search发现`app_game_poker_guide`，然后`app_game_hall_overview`；已有座位先检查status：sitting_out仅在用户明确要求继续时seat_sit(false)后wait，仅查看或重连不自动回座；其他已有座位直接wait，无座位才lobby_list/seat_join。暂离时wait只返回waiting，不能等回座错误。GameSession与overview保留实际sitting_out状态，当前手中申请暂离仍为active直到本手结束；seat_sit的sittingOut为请求确认，pending/status表示实际生效情况，pending时立刻停止调用仍可能600秒超时离桌。每次your_turn提交UUID标识的合法act，丢响应时保留同一UUID重试。wait先按cursor补发本次入座未读结算（含已离桌或归档），再返回table_closed；空cursor直接接当前牌况，数字越界拒绝。完整协议、参数与恢复路径以系统Skill包`desktop/app-capabilities/synapse-skill/skill-package/game-hall/`为准。

点数与跨游戏进行中属于大厅；扑克service更新会话索引，不能让大厅读取扑克表。所有敏感字段在服务端白名单投影，Renderer旁观投影只作额外防护。

客户端拒绝畸形成功响应并返回GAME_INVALID_RESPONSE，读请求可重试恢复；写请求结果视为未知，先overview或读取已保存对象核对，act重试复用原actionId，创建重试复用原creationId，不能因响应损坏另发新动作。校验只执行既有契约，保留未来附加字段，不代替服务端权限或出牌校验。

后台超时、空闲维护和归档按稳定键集轮转，每轮固定资格截止时间，每批最多100项；失败项也推进，尾部有界回绕重试，避免连续失败前缀挡住健康项。重启从头扫描，实际处理仍使用本次调用时钟，600秒与90天校验不放宽。

连续暂离30分钟且房间没有进行中的手牌时自动离桌退款；重复暂离或查询心跳不延长该期限，真正回座再暂离才重新计时。手中申请暂离从本手结束生效时起算。服务停止会结束长轮询并返回暂时不可用，不能据此判断房间已解散；恢复后仍通过overview接回。

本地验证：

```bash
pnpm --filter @synapse/server test
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test --maxWorkers=4
```

真实数据库测试另设GAME_E2E_DATABASE_URL，必须指向本机专用、名称以_e2e结尾的Postgres；普通test不默认连接业务库。测试前仅对该专用库部署迁移并生成Prisma。游戏专项可执行`pnpm --filter @synapse/server exec vitest run src/game --maxWorkers=1`。

真实客户端验收辅助：先构建server API，再用esbuild构建`desktop/tests/manual/game-hall-eval-mcp.ts`到临时产物，运行`server/test/game-hall-ai-eval.cjs`。该脚本仅接受其明确限定的任务测试库，不使用生产账号、不发送真实推送。它运行真实Claude Code与Codex CLI、只暴露game能力，经同一服务与MCP router验证50手与停进程120秒后的新会话overview恢复。运行结果必须以输出的report.json为证，脚本存在不等于验收通过。

发布顺序是服务端新增表迁移及API在先、桌面客户端在后。本功能开发本身不授权发版、部署或业务库迁移；无远程动作时明确标记未部署。回滚客户端不会删除游戏数据；有业务数据后不得直接删除新增表，先保存账户、会话与不可变记录。

归档按UTC基准满90天后执行，不受数据库会话时区影响：数据库函数先验证不可变完整副本，随后清理热表；记录查询和统计统一覆盖热数据与归档。提示词版本与成功行动幂等凭据永久保存。发布时必须七份游戏迁移一并按顺序应用（原五份及两份陪练迁移），不能只上线API。

本次入座的事件边界由游戏在房间锁内保存，按牌局顺序隔离热记录和归档，不能依赖请求时钟排序。GameSession.startCursor仅为服务端内部游戏定义数据，大厅不解释、不返回；客户端重连仍只需当前账号+roomCode，不要增加任何座位凭证或新参数。旧在座会话迁移回填边界，无法回填的旧关闭会话维持原时间兼容。

行动日志的displayName固定为该手参与者快照，不能用当前座位姓名替代；服务端在交叉入座产生已回滚死锁时有限重试，不放宽余额与唯一座位约束。

创建结果丢失时，可用同一creationId恢复房间或同一新选手草稿，不按名称/内容合并。新建另一个实体换UUID；已有选手取得id后仅按id更新，不再传creationId。该字段只用于创建去重，不影响座位重连。新桌面创建会使用该字段，旧客户端不传仍可用，部署顺序必须先服务端后桌面。
