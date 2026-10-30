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
  points: { total: number; available: number; inPlay: number; netProfit: number }
  sessions: GameSessionView[]
  games: GameDefinition[]
  next: { game: string; roomCode: string | null } | null
}
export type PokerVariant = "standard52" | "short32"
export type PokerController = "human" | "ai" | null
export type PokerPauseReason = "user" | "context_maintenance" | null
export type PokerBlindPreset = "1/2" | "2/4" | "5/10" | "10/20"
export interface PokerRules {
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
    delta: number
    payout: number
    endingStack: number
    handName?: string
  }[]
  pots: {
    amount: number
    eligible: number[]
    winners: number[]
    shares: Record<string, number>
    refund: boolean
  }[]
  mixedControl: boolean
}
export interface PokerTableEvent {
  kind: "action" | "settlement"
  handId: string
  handNo: number
  seq: number
  action?: PokerActionView
  settlement?: PokerSettlementView
}
export interface PokerTableEventsView {
  events: PokerTableEvent[]
  cursor: string
  hasMore: boolean
}
export interface PokerSeatView {
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
export interface PokerTableView {
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
    "列出房间。Pagination: offset-based. Continue with nextOffset until null.",
    { ...page, mode },
    [],
    false,
  ],
  [
    "poker.room.create",
    "创建2–10人桌；默认standard52和1/2，short32使用7到A的32张牌；可传creationId(UUID)，同次创建重试复用，新开一桌更换。",
    {
      variant: { type: "string", enum: ["standard52", "short32"] },
      blindPreset: { type: "string", enum: ["1/2", "2/4", "5/10", "10/20"] },
      creationId: { type: "string", format: "uuid", maxLength: 36 },
      maxSeats: integer(2, 10),
      buyIn: { type: "integer", enum: [500, 1000, 2000, 5000] },
      name: str(48),
      mode,
    },
    ["maxSeats", "buyIn"],
    true,
  ],
  ["poker.room.get", "只读旁观快照，不返回底牌、私密提示词或note。", room, ["roomCode"], false],
  ["poker.bot.add", "仅陪练房房主添加一个程序机器人，不调用模型、不影响大厅点数；同次重试复用creationId。", { ...room, creationId: { type: "string", format: "uuid", maxLength: 36 } }, ["roomCode", "creationId"], true],
  ["poker.bot.remove", "仅陪练房房主移除本房机器人；本手参与者手后移除，不能控制其动作或真人座位。", { ...room, botId: str() }, ["roomCode", "botId"], true],
  [
    "poker.seat.join",
    "按当前账号+roomCode入座，无令牌。有控制历史且已离桌时，先table.state确认桌面已授权AI重新入座，再携匹配controlVersion；未授权不得自动入座扣点。modelName仅自述。",
    { ...room, agentId: str(), modelName: str(24), controlVersion },
    ["roomCode"],
    true,
  ],
  ["poker.seat.leave", "点数房离桌退剩余筹码，陪练房不兑换点数；参与中的手结束后离场，接管后须提交当前controlVersion。", { ...room, controlVersion }, ["roomCode"], true],
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
    "循环调用，单次最多阻塞25秒；非轮次仅waiting/cursor。行动窗口另为600秒。每轮重新读取persona；凭cursor先补本次入座结算（含离桌及归档），再返回table_closed；control_released时立即退出，不自动重新认领。",
    { ...room, cursor: str(64), timeoutMs: integer(0, 25000) },
    ["roomCode"],
    false,
  ],
  [
    "poker.table.state",
    "本人快照；刷新AI心跳，不得读取对手未摊牌底牌。",
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
