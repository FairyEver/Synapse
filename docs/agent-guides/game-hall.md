# 游戏大厅接入与验证

用户可桌面亲自打牌，也可请求自己的Agent通过Synapse MCP托管；同账号同房只有一个座位，共用筹码和当前手。系统不托管模型，没有座位令牌；程序机器人仅限陪练房。真人接管优先，AI收到control_released必须退出，不自动重新认领。

陪练流程：room_create(mode=practice)→房主bot_add(roomCode,creationId=UUID)→真人AI正常overview/join/wait/act。bot_remove按botId，本手参与者手后移除；计分房/非房主拒绝。新机器人新UUID，同次重试复用，移除后旧标识不复活。机器人不是账号，无大厅账户/会话；规则策略只接本人及公开信息，持久调度、房锁和引擎裁决。仅机器人或真人全暂离不发新手，机器人不续无人房寿命。

陪练GameSession funding=practice，buyIn/inPlay/returned仅0/null，练习筹码不进账户盈亏或流水；默认历史/统计points，明确mode=practice查练习，归档及版本手数保持隔离。上线须先执行20261030130000_game_poker_practice和20261030131000_game_poker_practice_summary迁移，再API与桌面；已有练习数据后不能回到无资金类型隔离的旧退款逻辑。

接入先通过search发现`app_game_poker_guide`，然后`app_game_hall_overview`；已有座位先检查status：sitting_out仅在用户明确要求继续或完整核对有效上下文维护检查点后seat_sit(false)再wait，仅查看或重连不自动回座；其他已有座位先table_state确认AI控制权再wait，无座位先table_state/room_get核对控制历史及桌面入座授权，再决定lobby_list/seat_join。暂离时wait只返回waiting，不能等回座错误。GameSession与overview保留实际sitting_out状态，当前手中申请暂离仍为active直到本手结束；seat_sit的sittingOut为请求确认，pending/status表示实际生效情况，pending时立刻停止调用仍可能600秒超时离桌。每次your_turn提交UUID标识的合法act，丢响应时保留同一UUID重试。wait先按cursor补发本次入座未读结算（含已离桌或归档），再返回table_closed；空cursor直接接当前牌况，数字越界拒绝。完整协议、参数与恢复路径以系统Skill包`desktop/app-capabilities/synapse-skill/skill-package/game-hall/`为准。

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


## 真人控制、规则与事件

共享PokerRules为{variant:standard52|short32,smallBlind,bigBlind}；Room/Summary/Detail通过rules返回快照，Table另带variant/smallBlind/bigBlind。short32仅7到A、同花大于葫芦、A789T最小顺子；盲注预设1/2、2/4、5/10、10/20，默认标准52张和1/2，建房后固定。结算含rules/seats/pots/mixedControl，未跟注返还标记refund。结算后服务端持久等待5秒，前端不擅自开手。

控制权和版本由服务端决定；桌面control.set(takeover|request_ai|cancel_ai)必须带controlVersion，AI只对用户已申请的handoff调用control.claim。接管即时提升epoch、旧AI动作和seat.sit/leave写权失效，已提交动作不回滚，截止时间不重置。act带controlVersion/expectedActionSeq，省略版本只兼容初始epoch0；响应未知保持actionId确认原动作。human动作不绑定persona/note，程序机器人仍rules_bot。

UI REST使用/game/poker/rooms/:code下POST join/actions/sit/leave/control与GET state/events，账号网络层加/api。UI请求沿{operation,params}封装，返回bare DTO；MCP经/game/invoke返回信封，仅可信Agent来源能提交MCP act。不要接受客户端source/controller。Renderer窄bridge有join/act/control.set/events，没有wait/control.claim/checkpoint。game26项公共能力，24项IPC；room.close/control.set两个私有UI操作不进capability/MCP。

table.events可传perspective=owner|public，MCP默认owner且固定decision投影；UI默认public，玩家日志必须随牌桌传owner，不能混入教学明牌。返回{events,cursor,hasMore}，limit最大100，按(handNo,seq,kind)去重并推进返回cursor；结算seq=2147483647，重连直接呈现最新状态，不重放旧动画。扑克房间获准隐藏业务顶栏/底栏，1440×900画布contain等比缩放、日志可折叠/窄屏抽屉；大厅维持统一壳。

服务端永久参与证据包含closed会话：桌面从未入座账号可教学全牌；参与点数房不能看他人暗牌，参与陪练房最多看程序机器人教学明牌；玩家按本人及合法摊牌，教学不扩大历史读取。MCP/机器人策略始终决策投影；UI公开投影剥离persona、版本、note、合法动作等，但保留服务端已授权hole和mySeatNo，客户端不能自行授予教学权限。

## 上下文维护

每10手或15分钟检查，压力提前，无可靠用量仍周期维护；先seat.sit(reason=context_maintenance)，完成本手并确认实际sitting_out、无未确认act，再checkpoint.save。检查点服务端本人私有保存roomCode/cursor/controlVersion/sessionStyle/continueIntent/pauseReason/savedAt，get/save均返回{checkpoint}（get可null），不落项目文件。

宿主确实支持原生压缩且确认成功才继续；不可用/失败/不明时安全退出提示手动，不用shell伪执行/compact。恢复重读Skill、房规、overview、checkpoint、state；同epoch、AI控制、continueIntent、context_maintenance及真实暂离均有效才回座。不撤销用户暂停/接管/离桌，清退后不自动扣点入座，不增加后台常驻AI运行器。

本次变更仅生成迁移，业务库迁移、部署、真实客户端验收均需单独授权执行。发布先新增迁移再API再桌面；已发生控制切换或短牌数据后，不得回滚到忽略控制epoch/规则快照的旧API。


永久扑克控制历史独立于座位保存，离桌/清退不能抹去旧AI写入失效边界。无座位时table.requiresJoinApproval=false明确表示没有历史，可按用户原入座授权首次join；true表示有历史，此时table.controller=null，controlVersion取历史版本，handoffPending表示joinPending。不能按版本0判断历史；缺少标记先核实。UI可在无座位通过control.set(request_ai/cancel_ai)授权/撤销AI重新入座；MCP seat.join有历史时必须该授权有效且携匹配controlVersion。未授权不自动入座、不重扣点，控制记录不存在的首次旧MCP入座才兼容省略版本；control.claim仅用于有座位交接。本次仅扩展既有join输入和私有control.set语义，26项game能力、24项IPC与全局计数不变。
