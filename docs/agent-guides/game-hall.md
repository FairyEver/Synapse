# 游戏大厅接入与验证

2026-11-02 金币额度更新：启用Roll的新手牌在引擎RollState保存coinPolicy={limit:12,normal:1,super:3}。各参赛者从本手全部成功start历史按档位计算余额；不增加可漂移的余额计数或数据库字段。normal/super扣1/3金币，筹码仍按roll-v1递增加价、费用独立补偿、支付后至少留1筹码。最多12次普通、4次超级或等额混合。跨街不恢复，下一手重新12；刷新、重启、接管、离桌/回座不补充。无购买、转让、兑换、金币盈亏或房间配置。

旧手缺coinPolicy沿旧规则完成，不从当前配置推断或追扣；旧响应隐藏金币信息，现有房间下一手启用。原牌/候选隐私、原倒计时、控制权、行动资格不变。金币快照损坏或透支显式拒绝，不默默补足。

RollQuote/PokerRollView增加可选coins={balance,limit}，RollOffer增加可选coinCost。table.state及wait本人报价共享引擎，待选wait额外含roll报价；请求参数不变，不增加工具/路由/迁移。公开视角不追加本人金币报价或候选。机器人继续依可用报价行动。

2026-11-02 人数上限：点数/陪练、标准/短牌统一为2–6人，默认6人；Web与MCP建房共用上限，真人、AI及机器人合计最多6位，陪练仍为真人保留位置。旧浏览器7–10人配置读取时收敛为6人；旧大房间不强退在座玩家，但达到6人后不再接纳新座位。本次不迁移数据库，不改变历史房间容量记录及已在座手牌。该规则取代历史规格中的2–10座描述。

2026-11-02 Roll信息补充：点击玩家区域打开信息面板查看该玩家本手/房间次数与支出，以及全桌本手/房间合计；牌桌不常驻这些数字。普通换牌与超级选牌面板都显示公共牌。table.state/room.get可选rollStats含hand/room的players/count/paid，以及seats中seatNo/key/hand/room；房间累计从建房起包含本手，刷新/重进/换座不重置，账号归属不按座位号或同名合并。只投影当前/历史回显座位对应账号的公开统计，成功start计一次、choose不重复；不含私牌或新增账号ID，不改变资金、控制和倒计时。

游戏 UI 分层以 [game-ui.md](../agents/game-ui.md) 为准：系统负责大厅、房间等待/管理、记录、档案及按需面板、表单与确认，游戏负责局内画面、HUD、直接玩法操作及即时反馈。Dashboard 使用标准 HeroUI 浅色系统层；下文深色建房、管理浮层继承游戏主题等视觉描述是历史记录，不是当前要求。Dashboard 已将牌桌功能入口、日志/AI 判断、机器人/座位管理、金额表单及全下确认分为系统层，牌桌/HUD/直接出牌仍用游戏视觉；操作协议及业务约束继续有效。

2026-10-31：游戏 UI 已迁移至 Web；本机 MCP/Skill 和后台能力保留。Web 与本机必须使用同一 Synapse 账号才能操作同一座位。Web 会话复用 Console 登录，Cookie 游戏请求必须绑定预期 userId，写请求同源；退出或刷新页面不自动离桌或交接。

创建房间时，Web预填当前 Synapse 昵称加「的房间」，默认名称或空名称由服务端在建房时补上实际 roomCode，格式为「李杨的房间 #123456」；自定义名称保持不变，48 字限制须为房间号预留空间。每次打开表单重新取当前昵称，不沿用上次房间名称。房间类型、牌组、盲注、座位数及带入/初始筹码在选择时按 userId 保存在当前浏览器 localStorage，取消或重启后仍恢复，账号间隔离；首次使用沿用 points/standard52/1/2/6座/1000。配置读取失败提示重试，写入失败提示重新选择；选项记忆只影响Web默认值，不让 MCP 隐式继承配置。默认命名复用 room.create 的可选 name，不新增 IPC、能力或数据库迁移；先上线服务端再更新Web。

Dashboard牌桌采用浅灰背景、白色抽象对局区与蓝色行动强调，宽窄屏统一底部操作，等待时保留高度；不常驻右栏。850px切换紧凑顶栏和房间/会话单列呈现。日志/AI判断按需展开；成员有顶部独立入口，桌面Popover、窄屏Drawer，集中显示实际成员、机器人增删、满员和本手后移除。连续增删保持面板打开，普通轮次变化不关闭；更多菜单保留单次座位操作。下注/加注底栏常驻最小、半池、一池及自定义；档位只选金额，带金额的主按钮明确提交，全下仍需确认，未知结果复用原actionId重试。自定义以真实按钮为锚点向上就近展开，仅保留金额输入、范围、追加额、滑块和全下；不重复牌面、摘要或提交按钮。底栏固定预留工具栏空间，短窗口面板可滚动，关闭保留本轮选择并返回触发焦点，不挤压三场景contain画布。已暂离、AI控制、旁观及等待接入提供状态旁的直接恢复/复制/取消操作；手中暂离/离桌持续提示本手后生效。系统表面保持HeroUI默认浅色，不继承游戏材质。

座位响应新增可选isHistorical/inCurrentHand，区分历史回显、当前占位和本手参与；历史座位不计容量，新座位未参与本手不显示已拿牌。机器人列表必须具有有效botId；待离桌的当前座位仍占位。旧响应缺字段不推断参与。窄屏记录选择后切换详情，返回恢复滚动和焦点；大厅默认预览明确标为点数记录。

Web德州扑克音效由本地打包的 Kenney Casino Audio CC0 素材提供，来源与原始许可在扑克模块 `assets/audio/`。按权威快照 handId/actionSeq 增量反馈发牌、公共牌、下注、弃牌、过牌、收池、派彩与本人真人行动；下注及普通派彩金额不超过 12 时按一元一筹码响，5 元五次、10 元十次，超过 12 时按对数平滑增加到最多 16 下；13 元十三次、32 元十四次、100 元十六次，不因金额增大而减少碰撞次数。下注（含盲注）将碰撞集中在最多 180ms 内，首声立即播放、略微错开后形成一簇，连同尾音约 0.44 秒；首个碰撞保留清晰起音，其余增益随数量按平方根衰减，避免叠加变响，不逐个数拍。普通派彩保留原节奏、最快间隔 55ms。本人在玩家视角实际赢池且净盈利时，用皮袋落下与两种金属金币碰撞组合替代普通派彩；按本人本手净赢金额分档增加至 2–6 段，间隔 190–110ms、音量固定，含等待与尾音最长约两秒；分池合并一次，退款、净亏及旁观不触发落袋。专属素材来自 Kenney RPG Audio（CC0），许可与来源保存在同一素材目录。每张新公共牌响一次，相邻间隔 120ms，翻三张响三次，转牌河牌各一次。首次载入、过期快照、超过三秒间隔、身份/视角/控制变更、后台恢复及重新开声只建立基线，不补播历史；静音、失焦、隐藏、跨手与卸载取消旧声源，不影响规则、资金或倒计时。首个真实交互解锁播放，资源或播放失败只记录日志，不阻塞游戏。开关仅保存在当前牌桌组件内，不新增设置存储。MCP schema、IPC 与系统 Skill 操作协议不变。

Web筹码与轮次反馈以权威table快照为单一时序，按handId/actionSeq去重；events游标流继续用于日志。可选chipState仅desktop展示响应提供，MCP decision不返回；服务端从完整本手动作与实际盲注按逐笔付款累计普通/Roll面额计数，recent最多32笔公开资金动作。501为500+1，五笔100不累计换500；choose不重复收费。玩家前方显示剩余筹码，同色连续分组、稳定错落堆叠，大量筹码保留真实数量标记。普通下注直接飞入底池，Roll费用飞入另一堆，金额逐位滚动。结算按实际pots.shares派发普通赢池和返还，再按rollReceived派发补偿；展示余额落地后增加，所有筹码和金额动画完成才打开原有HeroUI结算。首次载入已结算、超过三秒断流、后台恢复及换手/身份/视角/控制版本/布局只建立基线，不补播历史或保留旧回调。画布维持三场景contain等比缩放，减少动态效果即时完成展示。赢家反馈、资金规则、控制、倒计时与显式逐手准备保持不变；动画不参与服务端裁决，不新增MCP/IPC或输入参数。

游戏中心位于独立 `/game/` Web 页面，Console 侧栏不再提供游戏入口；桌面不提供游戏 UI 或入口。namespace `game`，当前 29 项 MCP，历史 `synapse://app/game-hall` 与房间深链改为受控打开浏览器。

Web创建扑克房间使用独立深色游戏弹窗：房间类型、牌组、盲注和带入直接点选，座位数在 2–6 人之间步进调节；提交期间禁用草稿修改，关闭后恢复入口焦点。仅改变Web呈现，创建参数、默认值及 creationId 重试语义不变，MCP schema 与系统 Skill 无需变更。

陪练房主在首局尚无真人入座时进入系统准备页，先选择机器人总数（为自己保留座位）及本人/外部AI方式，一次配好阵容后再本人入座或申请外部AI接入，避免逐个加人时提前开局。部分成功不回滚；丢响应复用原机器人creationId，重试只补缺少的数量。离开、切换账号或房间停止后续写入；外部AI仍需用户自己的Agent连接，不内置模型托管。首局已有真人或已开手沿用原牌桌；资金、权限、控制版本、出牌幂等及每手准备屏障不变，本次不新增MCP或IPC能力。

用户可Web亲自打牌，也可请求自己的Agent通过Synapse MCP托管；同账号同房只有一个座位，共用筹码和当前手。系统不托管模型，没有座位令牌；程序机器人仅限陪练房。真人接管优先，AI收到control_released必须退出，不自动重新认领。

Web房间列表合并点数房和陪练房，房名旁标明类型，不再切换筛选。lobby.list(mode=all)按统一顺序分页返回两类房间；省略mode仍默认points，可显式practice只查陪练。all仅为列表查询条件，不是房间类型，历史和统计仍按points/practice隔离。此查询扩展先上线服务端API再更新Web，无数据库迁移。

点数入座前显示带入额及本人可用点数，首局等待明确人数并支持复制邀请链接。列表与牌桌共用 AI 接入面板；初次明确授权后复制，后续复制不再请求授权，剪贴板失败保留已确认状态；取消、接管和异步上下文仍遵循当前控制版本。关闭面板后列表通过可选 myControl（controller/controlVersion/handoffPending/seatNo）继续展示本人待接入或 AI 控制状态；只批量查询本页房间与当前 userId，不返回其他用户历史。该响应扩展先上线服务端再上线 Web，无迁移、无新增 MCP/IPC；缺字段仍可进入房间读取实际状态，不能推定授权。

房主从大厅解散陪练房时，若现有座位及未结算当前手均只有房主账号与程序机器人，立即关闭；真人或AI控制均适用。当前手标记cancelled并保留过程，不产生结算摘要或战绩，已有已完成结果仍可补发；会话关闭、行动提示与机器人/续局调度一并清空，不兑换点数。有其他账号（含暂离、候场或本手已离座的参与者）时仍按本手结束后解散。此操作仅Web私有room.close，不新增MCP工具。

陪练流程：room_create(mode=practice)→房主bot_add(roomCode,creationId=UUID)→真人AI正常overview/join/wait/act。bot_remove按botId，本手参与者手后移除；计分房/非房主拒绝。新机器人新UUID，同次重试复用，移除后旧标识不复活。机器人不是账号，无大厅账户/会话；规则策略只接本人及公开信息，持久调度、房锁和引擎裁决。仅机器人或真人全暂离不发新手，机器人不续无人房寿命。

陪练GameSession funding=practice，buyIn/inPlay/returned仅0/null，练习筹码不进账户盈亏或流水；默认历史/统计points，明确mode=practice查练习，归档及版本手数保持隔离。上线须先执行20261030130000_game_poker_practice和20261030131000_game_poker_practice_summary迁移，再API与Web；已有练习数据后不能回到无资金类型隔离的旧退款逻辑。

接入先通过search发现`app_game_poker_guide`，然后`app_game_hall_overview`；已有座位先检查status：sitting_out仅在用户明确要求继续或完整核对有效上下文维护检查点后seat_sit(false)再wait，仅查看或重连不自动回座；其他已有座位先table_state确认AI控制权再wait，无座位先table_state/room_get核对控制历史及Web入座授权，再决定lobby_list/seat_join。暂离时wait只返回waiting，不能等回座错误。GameSession与overview保留实际sitting_out状态，当前手中申请暂离仍为active直到本手结束；seat_sit的sittingOut为请求确认，pending/status表示实际生效情况，pending时立刻停止调用仍可能600秒超时离桌。每次your_turn提交UUID标识的合法act，丢响应时保留同一UUID重试。wait先按cursor补发本次入座未读结算（含已离桌或归档），再返回table_closed；空cursor直接接当前牌况，数字越界拒绝。完整协议、参数与恢复路径以系统Skill包`desktop/app-capabilities/synapse-skill/skill-package/game-hall/`为准。

点数与跨游戏进行中属于大厅；扑克service更新会话索引，不能让大厅读取扑克表。所有敏感字段在服务端白名单投影，Web UI旁观投影只作额外防护。

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

发布顺序是服务端新增表迁移及API在先、Web客户端在后。本功能开发本身不授权发版、部署或业务库迁移；无远程动作时明确标记未部署。回滚客户端不会删除游戏数据；有业务数据后不得直接删除新增表，先保存账户、会话与不可变记录。

归档按UTC基准满90天后执行，不受数据库会话时区影响：数据库函数先验证不可变完整副本，随后清理热表；记录查询和统计统一覆盖热数据与归档。提示词版本与成功行动幂等凭据永久保存。发布时必须七份游戏迁移一并按顺序应用（原五份及两份陪练迁移），不能只上线API。

本次入座的事件边界由游戏在房间锁内保存，按牌局顺序隔离热记录和归档，不能依赖请求时钟排序。GameSession.startCursor仅为服务端内部游戏定义数据，大厅不解释、不返回；客户端重连仍只需当前账号+roomCode，不要增加任何座位凭证或新参数。旧在座会话迁移回填边界，无法回填的旧关闭会话维持原时间兼容。

行动日志的displayName固定为该手参与者快照，不能用当前座位姓名替代；服务端在交叉入座产生已回滚死锁时有限重试，不放宽余额与唯一座位约束。

创建结果丢失时，可用同一creationId恢复房间或同一新选手草稿，不按名称/内容合并。新建另一个实体换UUID；已有选手取得id后仅按id更新，不再传creationId。该字段只用于创建去重，不影响座位重连。新Web创建会使用该字段，旧客户端不传仍可用，部署顺序必须先服务端后Web。


## 真人控制、规则与事件

共享PokerRules为{variant:standard52|short32,smallBlind,bigBlind}；Room/Summary/Detail通过rules返回快照，Table另带variant/smallBlind/bigBlind。short32仅7到A、同花大于葫芦、A789T最小顺子；盲注预设1/2、2/4、5/10、10/20，默认标准52张和1/2，建房后固定。结算含rules/seats/pots/mixedControl，未跟注返还标记refund。结算后服务端持久等待5秒，前端不擅自开手。

控制权和版本由服务端决定；Webcontrol.set(takeover|request_ai|cancel_ai)必须带controlVersion，AI只对用户已申请的handoff调用control.claim。接管即时提升epoch、旧AI动作和seat.sit/leave写权失效，已提交动作不回滚，截止时间不重置。act带controlVersion/expectedActionSeq，省略版本只兼容初始epoch0；响应未知保持actionId确认原动作。human动作不绑定persona/note，程序机器人仍rules_bot。

UI REST使用/game/poker/rooms/:code下POST join/actions/sit/leave/ready/control/roll/start/roll/choose与GET state/events，账号网络层加/api。UI请求沿{operation,params}封装，返回bare DTO；MCP经/game/invoke返回信封，仅可信Agent来源能提交MCP act。不要接受客户端source/controller。Web UI 通过 REST 调用 join/act/control.set/events，没有 wait/control.claim/checkpoint；桌面游戏 bridge 已移除。game 29 项公共能力；桌面游戏 IPC 为 0；room.close/control.set两个私有UI操作不进capability/MCP。

table.events可传perspective=owner|public，MCP默认owner且固定decision投影；UI默认public，玩家日志必须随牌桌传owner，不能混入教学明牌。返回{events,cursor,hasMore}，limit最大100，按(handNo,seq,kind)去重并推进返回cursor；结算seq=2147483647，重连直接呈现最新状态，不重放旧动画。扑克房间获准隐藏业务顶栏/底栏，三种内部场景按可用比例自动选择并 contain 等比缩放、日志可折叠/窄屏抽屉；大厅使用独立 Web 页面壳。

服务端永久参与证据包含closed会话：Web从未入座账号可教学全牌；参与点数房不能看他人暗牌，参与陪练房最多看程序机器人教学明牌；玩家按本人及合法摊牌，教学不扩大历史读取。MCP/机器人策略始终决策投影；UI公开投影剥离persona、版本、note、合法动作等，但保留服务端已授权hole和mySeatNo，客户端不能自行授予教学权限。

## 上下文维护

每10手或15分钟检查，压力提前，无可靠用量仍周期维护；先seat.sit(reason=context_maintenance)，完成本手并确认实际sitting_out、无未确认act，再checkpoint.save。检查点服务端本人私有保存roomCode/cursor/controlVersion/sessionStyle/continueIntent/pauseReason/savedAt，get/save均返回{checkpoint}（get可null），不落项目文件。

宿主确实支持原生压缩且确认成功才继续；不可用/失败/不明时安全退出提示手动，不用shell伪执行/compact。恢复重读Skill、房规、overview、checkpoint、state；同epoch、AI控制、continueIntent、context_maintenance及真实暂离均有效才回座。不撤销用户暂停/接管/离桌，清退后不自动扣点入座，不增加后台常驻AI运行器。

本次变更仅生成迁移，业务库迁移、部署、真实客户端验收均需单独授权执行。发布先新增迁移再API再Web；已发生控制切换或短牌数据后，不得回滚到忽略控制epoch/规则快照的旧API。


永久扑克控制历史独立于座位保存，离桌/清退不能抹去旧AI写入失效边界。无座位时table.requiresJoinApproval=false明确表示没有历史，可按用户原入座授权首次join；true表示有历史，此时table.controller=null，controlVersion取历史版本，handoffPending表示joinPending。不能按版本0判断历史；缺少标记先核实。UI可在无座位通过control.set(request_ai/cancel_ai)授权/撤销AI重新入座；MCP seat.join有历史时必须该授权有效且携匹配controlVersion。未授权不自动入座、不重扣点，控制记录不存在的首次旧MCP入座才兼容省略版本；control.claim仅用于有座位交接。本次仅扩展既有join输入和私有control.set语义，26 项 game 能力、0 项游戏 IPC与全局计数不变。

## 每手结算与准备（2026-11-01）

每手结束弹出HeroUI完整结算，允许关闭/重开，关闭不代准备。服务端结算投影新增仅根据已获准公开牌面计算的bestFive和分池reason，暗牌不泄露。取代旧五秒自动续局：所有当前可参赛者显式准备，陪练自动、真人按钮、AI调用app_game_poker_seat_ready(roomCode,handId,controlVersion)。wait的ready_required可用于空游标重连，已准备仍waiting；先处理未读hand_result与上下文维护。旧手、旧控制版本及他人座位不能授权下一手。复用座位status=ready，无新增数据库迁移；先更新API与MCP契约再上线Web。本次开发不部署。

Dashboard 牌桌底部和结算 Footer 共用准备/接管执行器与进度，关闭结算后仍可直接准备，显示人数和等待对象；长名单摘要只列前两人及待准备总人数，完整名单见结算。AI 控制时可在结算内本人接管，保持弹窗打开，再明确点击准备。接回清除原准备时提示“已接管，请重新准备”；换手、换房、换账号或确认准备后清除提示。接管和准备请求未结束时两个表面同步禁用，暂离/历史座位不计入屏障，旁观不代准备。不改变 MCP schema、控制版本及资金规则。

## Roll 已实施协议（2026-11-01）

建房可显式ruleOptions.roll=true，缺省关闭；服务端roll-v1写入房间和每手快照，不接受客户端价格版本。normal指定一张旧底牌后随机一张，super先付费生成三候选，可选择或在原槽按新报价付费重抽；只本人可读候选/旧牌位置。两档共享本手次数和原deadline，河牌关闭，费用不计普通下注。机器人使用可见信息的有限策略，不称最优、不读暗牌。

外部AI：读table_state或your_turn的roll报价→按用户会话风格/预算决定→roll_start携当前手/street/actionSeq/controlVersion、新UUID、kind/cardIndex和确切expectedFee→choice_required时从当前候选roll_choose，或读table_state新报价后在原cardIndex付费再次roll_start→重读当前报价和合法动作→正常act。重抽成功回收旧候选，不退旧费用及补偿，次数累加且不续deadline；失败保留原候选。wait的roll_choice_required仍在control_released/未读终局之后，优先于your_turn。收到control_released立即停，不为选牌重新claim；响应丢失先读状态并用原UUID、operation和全部参数确认原回执，不能把未知结果当新一轮换UUID重抽或静默改价。有限试玩价格不保证盈利。

冻结补偿按扣费当时其他未弃牌原参与者（含全下者）确权，本手不能花。普通派彩后释放：仍在原入座的stack/session投影只入账一次，已离场points归原账号余额和盈亏，不归后来同seatNo或新session；practice离场/取消清零。Hall独立汇总通用pending，不读取扑克表；total=available+inPlay+pending，netProfit含pending，旧响应缺字段按0，pending未释放不能领取补助。结算delta保留总净变化，pokerDelta=delta+rollPaid-rollReceived，payout仍仅普通派彩；公开事件choose保留fee作审计但不再次收费。

Dashboard使用既有玩法入口打开HeroUI系统Modal，原手牌槽/两档报价/次数/确认和候选单选均按需显示；超级可关闭后重开，下注持续禁止。AI控制时先本人接管，原候选不变。账号/房间隔离未知写入，手/阶段/序号/控制变化清理未提交选择；表格公开视角移除私有候选与报价。结算/记录分别展示Roll支出、补偿与总净变化，不以获胜标签代替盈亏。

当前game29、全局372 capability/368 MCP，Web27项UI操作、游戏IPC0，无新增System App/Dock/Workflow/Automation/Deep Link。两个REST路径为 `/game/poker/rooms/:code/roll/start` 和 `/game/poker/rooms/:code/roll/choose`；服务端只信入口来源。权威Skill/API参考位置不变。部署必须先应用20261101090000_game_roll_frozen_transfers迁移；2026-11-01 开发阶段未执行迁移、真实DB或浏览器验收、部署。不得把既有系统UI浏览器验收记录当作本次Roll验收。

2026-11-02 后续授权验收已完成本机 `_e2e` 专用库迁移、真实 game PostgreSQL 套件、真人浏览器、真实 Codex MCP 与自主陪练机器人流程，详见 [Roll 真实验收记录](../superpowers/acceptance/2026-11-02-poker-roll-live-acceptance.md)。此结果不代表生产已迁移或部署；陪练结算净变化单位为筹码，点数房为点数，练习资产不兑换点数。
