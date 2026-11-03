/** Shared wire contracts: no game-specific logic in the hall. */
export type GameFunding = "points" | "practice"
export interface GameDefinition {
  id: string
  name: string
  icon: string
  entry: string
  status: string
}
export interface GameSessionView {
  funding?: GameFunding
  game: string
  gameName: string
  roomCode: string | null
  seatNo: number | null
  status: string
  needsAction: boolean
  deadlineMs: number | null
}
export interface HallOverview {
  points: { total: number; available: number; inPlay: number; pending?: number; netProfit: number }
  sessions: GameSessionView[]
  games: GameDefinition[]
  next: { game: string; roomCode: string | null } | null
}
export type PokerVariant = "standard52" | "short32"
export const POKER_BUY_IN_PRESETS: readonly number[] = [1000, 5000, 10000, 50000]
export const POKER_MAX_SEATS = 6
export const POKER_DEFAULT_ROLL_COINS = 12
export const POKER_MAX_ROLL_COINS = 2147483647
export type PokerController = "human" | "ai" | null
export type PokerPauseReason = "user" | "context_maintenance" | null
export * from "./game-poker-chips.js"
export * from "./game-poker-cards.js"
export * from "./game-reserve.js"
import type { PokerCardRulesVersion, PokerCardView, PokerResolutionFrameView, PokerPaymentView } from "./game-poker-cards.js"
import type { PokerReserveView } from "./game-reserve.js"
import type { PokerChipState } from "./game-poker-chips.js"
export type PokerBlindPreset = "1/2" | "2/4" | "5/10" | "10/20"
export interface PokerRuleOptions { roll?: boolean; rollCoins?: number; cards?: boolean }
export type PokerRollKind = "normal" | "super"
export interface PokerRollOffer { payment?: PokerPaymentView; fee: number; available: boolean; reason?: string; coinCost?: number }
export interface PokerRollQuote { enabled: boolean; pricingVersion?: string; count: number; coins?: { balance: number; limit: number }; normal: PokerRollOffer; super: PokerRollOffer }
export interface PokerRollPending { rollId: string; cardIndex: number; candidates: string[] }
export interface PokerRollView { enabled: boolean; pricingVersion?: string; count?: number; coins?: { balance: number; limit: number }; normal?: PokerRollOffer; super?: PokerRollOffer; pending?: PokerRollPending | null; pendingSeatNo?: number | null }
export interface PokerRollPublicView { kind: PokerRollKind; phase: "start" | "choose"; fee: number; count: number; seatNo: number; displayName: string; source: "human" | "mcp" | "rules_bot" | "timeout"; compensations: Record<string, number> }
export interface PokerRollAmounts { count: number; paid: number }
export interface PokerRollTotals extends PokerRollAmounts { players: number }
export interface PokerRollStats {
  hand: PokerRollTotals
  room: PokerRollTotals
  seats: { seatNo: number; key: string; hand: PokerRollAmounts; room: PokerRollAmounts }[]
}
export interface PokerRollLedgerPlayer { key: string; seatNo: number; displayName: string; isMe: boolean; folded: boolean }
export interface PokerRollLedgerEntry {
  id: string
  payerKey: string
  kind: PokerRollKind
  street: "preflop" | "flop" | "turn"
  fee: number
  compensations: { key: string; amount: number }[]
}
export interface PokerRollLedger {
  handId: string
  status: "pending" | "released" | "cancelled"
  players: PokerRollLedgerPlayer[]
  entries: PokerRollLedgerEntry[]
}
export interface PokerRollPrivateView { rollId: string; kind: PokerRollKind; cardIndex: number; oldCard: string; candidates: string[]; selectedIndex: number | null; fee: number; street: "preflop" | "flop" | "turn"; count: number }
export interface PokerRollChoiceRequiredView extends PokerRollPending { roll?: PokerRollView; status: "roll_choice_required"; handId: string; handNo: number; controlVersion: number; actionSeq: number; deadlineMs: number | null; cursor: string }
export interface PokerRollResult { ok: true; handId: string; rollId: string; actionSeq: number; cursor: string; status: "completed" | "choice_required" }
export interface PokerRollStartInput { expectedPaymentVersion?: string; roomCode: string; handId: string; street: "preflop" | "flop" | "turn"; expectedActionSeq: number; controlVersion: number; actionId: string; kind: PokerRollKind; cardIndex: number; expectedFee: number }
export interface PokerRollChooseInput { roomCode: string; handId: string; rollId: string; candidateIndex: number; expectedActionSeq: number; controlVersion: number; actionId: string }
export interface PokerRules {
  cardRulesVersion?: PokerCardRulesVersion
  chipRulesVersion?: "chips-v2"
  ruleOptions?: PokerRuleOptions
  rollPricingVersion?: string
  variant: PokerVariant
  smallBlind: number
  bigBlind: number
}
export interface PokerControlView {
  controller: PokerController
  controlVersion: number
  handoffPending: boolean
}
export interface PokerResumeCheckpoint {
  roomCode: string
  cursor: string
  controlVersion: number
  sessionStyle: string
  continueIntent: boolean
  pauseReason: "context_maintenance"
  savedAt: string
}
export interface PokerSettlementView {
  handId: string
  handNo: number
  board: string[]
  rules: PokerRules
  seats: {
    seatNo: number
    displayName: string
    participantKind: "human" | "bot"
    isMe: boolean
    folded: boolean
    hole?: string[]
    rollPaid?: number
    rollReceived?: number
    reservePaid?: number
    reserveReceived?: number
    reserveStolen?: number
    reserveRefunded?: number
    pokerDelta?: number
    delta: number
    payout: number
    endingStack: number
    handName?: string
    bestFive?: string[]
  }[]
  pots: {
    amount: number
    eligible: number[]
    winners: number[]
    shares: Record<string, number>
    refund: boolean
    reason?: string
  }[]
  mixedControl: boolean
}
export interface PokerTableEvent {
  kind: "action" | "settlement" | "roll"
  handId: string
  handNo: number
  seq: number
  roll?: PokerRollPublicView
  action?: PokerActionView
  settlement?: PokerSettlementView
}
export interface PokerTableEventsView {
  frames?: PokerResolutionFrameView[]
  events: PokerTableEvent[]
  cursor: string
  hasMore: boolean
}
export interface PokerSeatView {
  publicHole?: { index: number; card: string }[]
  rollCount?: number
  rollPaid?: number
  pendingCompensation?: number
  nextHandEligible?: boolean
  readyForNextHand?: boolean
  /** Previous-hand participant retained for results, not an occupied room seat. */
  isHistorical?: boolean
  /** Matched to this hand by both account identity and seat number. */
  inCurrentHand?: boolean
  controller?: PokerController
  controlVersion?: number
  handoffPending?: boolean
  participantKind?: "human" | "bot"
  botId?: string
  leavePending?: boolean
  seatNo: number
  displayName: string
  stack: number
  status: string
  isMe: boolean
  streetBet: number
  aiState: string
  hole?: string[]
}
export interface PokerActionView {
  nominalAmount?: number
  waivedAmount?: number
  actionSource?: "mcp" | "human" | "timeout" | "rules_bot"
  seq: number
  seatNo: number
  displayName?: string
  street: string
  action: string
  amount: number
  potAfter: number
  isAuto: boolean
  note?: string | null
  personaVersionId?: string | null
  personaVersion?: { versionNo: number; persona: string } | null
}
/** Actual ordinary contributions for the current hand, including blinds and refunded bets. */
export interface PokerPotContributions {
  handId: string
  status: "pending" | "settled" | "cancelled"
  total: number
  players: { key: string; seatNo: number; displayName: string; isMe: boolean; folded: boolean; amount: number }[]
}
export interface PokerHandLogEntry {
  nominalAmount?: number
  waivedAmount?: number
  seq: number
  seatNo: number
  displayName: string
  street: "preflop" | "flop" | "turn" | "river"
  action: "small_blind" | "big_blind" | "fold" | "check" | "call" | "bet" | "raise" | "allin" | "roll" | "card"
  amount: number
  isAuto: boolean
  actionSource?: "mcp" | "human" | "timeout" | "rules_bot"
  roll?: { kind: PokerRollKind; count: number; status: "pending" | "completed" | "replaced" | "cancelled" }
  card?: { id: string; name: string; artId?: string; description?: string; status: "completed" | "blocked" | "choice_required" }
}
export interface PokerHandLog { handId: string; complete: boolean; entries: PokerHandLogEntry[] }
export interface PokerTableView {
  cards?: PokerCardView
  reserve?: PokerReserveView
  paymentVersion?: string
  betWaiverCap?: number
  /** Public ordered current-hand actions. Missing/incomplete logs must not supply totals. */
  handLog?: PokerHandLog
  potContributions?: PokerPotContributions
  /** Desktop-only public artwork inventory; values retain each individual payment's denominations. */
  chipState?: PokerChipState
  rollStats?: PokerRollStats
  rollLedger?: PokerRollLedger
  rules?: PokerRules
  ruleOptions?: PokerRuleOptions
  rollPricingVersion?: string
  roll?: PokerRollView
  isRoomOwner?: boolean
  canStart?: boolean
  awaitingReady?: boolean
  requiresJoinApproval?: boolean
  variant?: PokerVariant
  smallBlind?: number
  bigBlind?: number
  actionSeq?: number
  controller?: PokerController
  controlVersion?: number
  handoffPending?: boolean
  pauseReason?: PokerPauseReason
  nextHandAt?: string | null
  settlement?: PokerSettlementView | null
  mode?: GameFunding
  ownerUserId?: string
  roomCode: string
  name: string | null
  status: string
  buyIn: number
  maxSeats: number
  handId: string | null
  handNo: number
  street: string | null
  board: string[]
  pot: number
  dealerSeat: number
  actionOnSeat: number | null
  deadlineMs: number | null
  cursor: string
  mySeatNo: number | null
  seats: PokerSeatView[]
  recentActions: PokerActionView[]
  persona?: string
  hole?: string[]
  toCall?: number
  legalActions?: string[]
  minRaiseTo?: number
  maxRaiseTo?: number
  deckRemaining: number
}
export interface PokerRoomView {
  myControl?: PokerControlView & { seatNo: number | null }
  rules?: PokerRules
  mode?: GameFunding
  roomCode: string
  name: string | null
  ownerUserId: string
  maxSeats: number
  buyIn: number
  status: string
  smallBlind: number
  bigBlind: number
  players: number
}
export interface PokerAgentView {
  id: string
  model: string
  persona: string
  currentVersionId: string | null
  versionSeq: number
}
export interface PokerVersionView {
  id: string
  versionNo: number
  persona: string
  createdAt: string
  firstUsedAt: string | null
  handCount: number
}
export interface PokerSummaryView {
  rules?: PokerRules
  mode?: GameFunding
  handId: string
  roomCode: string
  handNo: number
  seatNo: number
  delta: number
  result: string
  hole: string[]
  board: string[]
  createdAt: string
}
export interface PokerDetailView {
  cards?: PokerCardView
  reserve?: PokerReserveView
  frames?: PokerResolutionFrameView[]
  rollHistory?: PokerRollPublicView[]
  privateRolls?: PokerRollPrivateView[]
  rules?: PokerRules
  mode?: GameFunding
  handId: string
  handNo: number
  roomCode: string
  board: string[]
  street: string
  result: unknown
  seats: {
    participantKind?: "human" | "bot"
    seatNo: number
    displayName: string
    startingStack: number
    endingStack: number | null
    folded: boolean
    hole?: string[]
  }[]
  actions: PokerActionView[]
}
export interface GamePage<T> {
  items: T[]
  nextOffset: number | null
}
export interface PokerStats {
  comparison?: (Omit<PokerStats, "comparison"> & {
    seatNo: number
    displayName: string
    isMe: boolean
  })[]
  hands: number
  netProfit: number
  vpip: number
  pfr: number
  aggression: number
  winRate: number
}

type Field = Record<string, unknown>
const str = (maxLength = 200): Field => ({ type: "string", maxLength })
const integer = (minimum: number, maximum: number): Field => ({ type: "integer", minimum, maximum })
const code: Field = { type: "string", pattern: "^[0-9]{4,6}$" }
const room = { roomCode: code }
const controlVersion = integer(0, 2147483647)
const mode: Field = { type: "string", enum: ["points", "practice"] }
const page = { offset: integer(0, 2147483647), limit: integer(1, 100) }
const definitions: [string, string, Record<string, Field>, string[], boolean][] = [
  [
    "hall.overview",
    "重连或不确定该做什么时先调这个；跨游戏点数、座位、行动截止时间。",
    {},
    [],
    false,
  ],
  ["hall.guide", "第一次接触游戏大厅先读；点数与游戏入口，不需要入座。", {}, [], false],
  [
    "hall.account",
    "查看总额、占用、可用、累计盈亏和近期流水；仅明确要求领补助时传claimGrant。",
    { claimGrant: { type: "boolean" } },
    [],
    true,
  ],
  ["poker.guide", "第一次接触这个游戏先读，不需要入座；规则、循环、参数与错误码。", {}, [], false],
  [
    "poker.lobby.list",
    "列出房间；mode默认points，practice仅陪练，all合并两类并统一分页；myControl仅返回本人当前控制和待接入状态，缺失时进入房间读取，不据此自动授权或入座。Pagination: offset-based. Continue with nextOffset until null.",
    { ...page, mode: { type: "string", enum: ["points", "practice", "all"] } },
    [],
    false,
  ],
  [
    "poker.room.create",
    "创建2–6人桌；省略或空白name使用当前昵称和房间号命名；默认standard52和1/2，short32使用7到A的32张牌；可传creationId(UUID)，同次创建重试复用，新开一桌更换。新房不开放独立换牌；卡牌房仅可通过真人网页创建。",
    {
      ruleOptions: { type: "object", properties: { cards: { type: "boolean" }, roll: { type: "boolean", const: false } }, additionalProperties: false },
      variant: { type: "string", enum: ["standard52", "short32"] },
      blindPreset: { type: "string", enum: ["1/2", "2/4", "5/10", "10/20"] },
      creationId: { type: "string", format: "uuid", maxLength: 36 },
      maxSeats: integer(2, POKER_MAX_SEATS),
      buyIn: { type: "integer", enum: POKER_BUY_IN_PRESETS },
      name: str(48),
      mode,
    },
    ["maxSeats", "buyIn"],
    true,
  ],
  ["poker.roll.start", "仅限已开启Roll的旧房间。按本人当前报价换牌，另付筹码；每手钻石额度沿用房间快照，normal固定扣1/super扣3，余额不足拒绝；超级待选可在原cardIndex付费重抽且不退款，共用次数、不续时，未知结果复用原actionId。", { ...room, handId: str(), street: { type: "string", enum: ["preflop", "flop", "turn"] }, expectedActionSeq: controlVersion, controlVersion, actionId: { type: "string", format: "uuid", maxLength: 36 }, kind: { type: "string", enum: ["normal", "super"] }, cardIndex: integer(0, 1), expectedFee: integer(1, 2147483647), expectedPaymentVersion: str(200) }, ["roomCode", "handId", "street", "expectedActionSeq", "controlVersion", "actionId", "kind", "cardIndex", "expectedFee"], true],
  ["poker.roll.choose", "仅限已开启Roll的旧房间。从本人待选超级换牌候选中选一张，不再扣筹码或钻石，零钻石仍可选择；候选仅本人可见，未知结果复用原actionId。", { ...room, handId: str(), rollId: str(), candidateIndex: integer(0, 2), expectedActionSeq: controlVersion, controlVersion, actionId: { type: "string", format: "uuid", maxLength: 36 } }, ["roomCode", "handId", "rollId", "candidateIndex", "expectedActionSeq", "controlVersion", "actionId"], true],
  ["poker.room.start", "仅房主手动开始：首局房主免准备，其他可参与座位须准备；后续房主也须准备且全员准备后才能开始。首局handId传null，后续传当前结算handId。入座、准备、回座、调度均不自动开局；已入座房主须携当前controlVersion并持有控制权。", { ...room, handId: { type: ["string", "null"], maxLength: 200 }, controlVersion }, ["roomCode", "handId"], true],
  ["poker.room.get", "只读旁观快照，不返回底牌、私密提示词或note；可选公开rollLedger按本手身份快照列出全部成功start及原补偿分配，status区分待结算、已释放和已取消，缺失不等于零。可选公开handLog按当前手seq合并实际盲注、下注、公开能力牌及旧版Roll支付，公开行动、牌名、效果与状态；choose不重复。原始动作最多1000条，complete=false或缺字段不能推算完整合计，不含私牌、候选、note或账号标识。可选公开potContributions包含本手全部普通累计投入（含实际盲注、弃牌投入、退款及边池，不含能力牌或Roll费用），按原参赛身份显示来源；status为pending/settled/cancelled，结算或取消不表示仍在池中，缺失不等于零。", room, ["roomCode"], false],
  ["poker.bot.add", "仅陪练房房主添加一个程序机器人，不调用模型、不影响大厅点数；同次重试复用creationId。", { ...room, creationId: { type: "string", format: "uuid", maxLength: 36 } }, ["roomCode", "creationId"], true],
  ["poker.bot.remove", "仅陪练房房主移除本房机器人；本手参与者手后移除，不能控制其动作或真人座位。", { ...room, botId: str() }, ["roomCode", "botId"], true],
  [
    "poker.seat.join",
    "按当前账号+roomCode入座，无令牌。有控制历史且已离桌时，先table.state确认Web 游戏中心已授权 AI 重新入座，再携匹配controlVersion；未授权不得自动入座扣点。modelName仅自述。",
    { ...room, agentId: str(), modelName: str(24), controlVersion },
    ["roomCode"],
    true,
  ],
  ["poker.seat.leave", "点数房离桌退剩余筹码，陪练房不兑换点数；参与中的手结束后离场，接管后须提交当前controlVersion。", { ...room, controlVersion }, ["roomCode"], true],
  ["poker.seat.ready", "首局房主免准备，其他可参与者及每手结算后房主均须显式准备；首局handId传null，后续携当前结算handId和controlVersion；全员准备后仍须房主room.start。陪练自动准备，AI必须调用本工具，真人由Web点击；查询、wait和回座不会准备，旧手请求不得用于新手。", { ...room, handId: { type: ["string", "null"], maxLength: 200 }, controlVersion }, ["roomCode", "handId", "controlVersion"], true],
  [
    "poker.seat.sit",
    "主动暂离或回座；当前手结束后生效。sittingOut确认请求，pending表示尚未生效，status是实际座位状态。",
    { ...room, sittingOut: { type: "boolean" }, controlVersion, reason: { type: "string", enum: ["user", "context_maintenance"] } },
    ["roomCode", "sittingOut"],
    true,
  ],
  [
    "poker.seat.nudge",
    "提醒等待一分钟的行动位，本机与手机推送；5分钟限一次。",
    { ...room, seatNo: integer(0, 9) },
    ["roomCode", "seatNo"],
    true,
  ],
  [
    "poker.table.wait",
    "循环调用，单次最多阻塞25秒。行动窗口另为600秒。每轮重新读取persona；roll_choice_required含本人候选及roll报价（可选coins余额/coinCost），钻石耗尽仍可免费选牌；ready_required时按handId/controlVersion显式seat_ready（首局handId为null），已准备只等待房主手动开始；凭cursor先补本次入座结算（含离桌及归档），再返回table_closed；control_released时立即退出，不自动重新认领。",
    { ...room, cursor: str(64), timeoutMs: integer(0, 25000) },
    ["roomCode"],
    false,
  ],
  [
    "poker.table.state",
    "本人快照；刷新AI心跳，不得读取对手未摊牌底牌。可选roll.coins为本手余额/上限，各档coinCost独立于筹码fee；旧手无字段不推断钻石额度。公开rollStats含本手与房间累计（包含本手）的players/count/paid，以及桌上每个seatNo对应账号的hand/room次数和支出；按账号归属、成功start计一次，choose不重复。可选rollLedger按本手身份快照列出全部成功start及原补偿分配，status区分待结算、已释放和已取消，缺失不等于零。可选公开handLog按当前手seq合并实际盲注、下注、公开能力牌及旧版Roll支付，公开行动、牌名、效果与状态；choose不重复。原始动作最多1000条，complete=false或缺字段不能推算完整合计，不含私牌、候选、note或账号标识。可选公开potContributions包含本手全部普通累计投入（含实际盲注、弃牌投入、退款及边池，不含能力牌或Roll费用），按原参赛身份显示来源；status为pending/settled/cancelled，结算或取消不表示仍在池中，缺失不等于零。",
    room,
    ["roomCode"],
    false,
  ],
  [
    "poker.action.act",
    "仅Agent提交合法动作。actionId UUID重试复用；旧handId/street拒绝。note限本人可读200字单行。",
    {
      ...room,
      controlVersion,
      expectedActionSeq: integer(0, 2147483647),
      expectedPaymentVersion: str(200),
      handId: str(),
      street: { type: "string", enum: ["preflop", "flop", "turn", "river"] },
      actionId: { type: "string", format: "uuid" },
      action: { type: "string", enum: ["fold", "check", "call", "bet", "raise", "allin"] },
      to: integer(0, 2147483647),
      personaSource: {
        type: "string",
        enum: ["game", "session"],
        description: "会话口述风格覆盖时传session；该行动不绑定游戏内版本。",
      },
      note: { type: "string", maxLength: 200, pattern: "^[^\\r\\n]*$" },
    },
    ["roomCode", "handId", "street", "actionId", "action"],
    true,
  ],
  [
    "poker.control.claim",
    "仅Agent认领用户已请求的AI托管；必须核对controlVersion，用户已接管时不得重新认领。",
    { ...room, controlVersion },
    ["roomCode", "controlVersion"],
    true,
  ],
  [
    "poker.checkpoint.get",
    "读取本人服务端私有上下文维护检查点；恢复前先读Skill和overview，不自动恢复用户暂停。",
    room,
    ["roomCode"],
    false,
  ],
  [
    "poker.checkpoint.save",
    "确认context_maintenance暂离实际生效且无未确认动作后，保存本人服务端私有恢复检查点；不写项目文件。",
    { ...room, controlVersion, cursor: str(64), sessionStyle: str(20000), continueIntent: { type: "boolean" } },
    ["roomCode", "controlVersion", "cursor", "continueIntent"],
    true,
  ],
  [
    "poker.table.events",
    "分页读取牌桌动作和结算；perspective默认owner，decision投影绝不返回教学明牌；结算seq为2147483647。Pagination: cursor-based. Continue with cursor while hasMore is true; changing roomCode starts a new cursor.",
    { ...room, cursor: str(64), limit: integer(1, 100), perspective: { type: "string", enum: ["owner", "public"] } },
    ["roomCode"],
    false,
  ],
  ["poker.agent.list", "本人选手与私密提示词。", {}, [], false],
  [
    "poker.agent.upsert",
    "新建/更新本人选手；新建可传creationId(UUID)复用同一草稿，获得id后只传id。相同内容不重复版本，口述风格未经明确要求不得写回。",
    {
      id: str(),
      creationId: { type: "string", format: "uuid", maxLength: 36 },
      model: str(24),
      persona: str(20000),
    },
    [],
    true,
  ],
  [
    "poker.agent.versions",
    "本人提示词版本历史、首次使用时间、使用手数。",
    { agentId: str() },
    ["agentId"],
    false,
  ],
  [
    "poker.hand.history",
    "本人最近手牌结果。Pagination: offset-based. Continue with nextOffset until null.",
    { ...page, mode },
    [],
    false,
  ],
  [
    "poker.hand.detail",
    "本人参与手牌的公开时间线与本人私密版本、note。",
    { ...room, handNo: integer(1, 2147483647) },
    ["roomCode", "handNo"],
    false,
  ],
  [
    "poker.stats.get",
    "本人战绩及风格指标；可按roomCode比较本人所在牌桌的公开指标，不以自述模型参与统计。",
    { roomCode: code, mode },
    [],
    false,
  ],
]
export const GAME_TOOLS = definitions.map(
  ([suffix, description, properties, required, mutates]) => ({
    id: `app.game.${suffix}`,
    name: `app_game_${suffix.replaceAll(".", "_")}`,
    description:
      description +
      " 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.",
    mutates,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
  }),
)
