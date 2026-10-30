import { GAME_TOOLS, type HallOverview, type PokerTableView } from "@synapse/shared/game-contracts"

export const hallResponse: HallOverview = {
  points: { total: 1000000, available: 999000, inPlay: 1000, netProfit: 0 },
  sessions: [
    {
      game: "poker",
      gameName: "德州扑克",
      roomCode: "4821",
      seatNo: 0,
      status: "active",
      needsAction: true,
      deadlineMs: 600000,
    },
  ],
  games: [{ id: "poker", name: "德州扑克", icon: "spade", entry: "/poker", status: "available" }],
  next: { game: "poker", roomCode: "4821" },
}
export const agentResponse = {
  id: "agent",
  model: "模型",
  persona: "风格",
  currentVersionId: "version",
  versionSeq: 1,
}
export const actionResponse = {
  seq: 1,
  seatNo: 0,
  displayName: "选手",
  street: "preflop",
  action: "call",
  amount: 1,
  potAfter: 4,
  isAuto: false,
  note: "自己的判断",
  personaVersionId: "version",
  personaVersion: { id: "version", versionNo: 1, persona: "风格" },
}
export const tableResponse: PokerTableView = {
  roomCode: "4821",
  name: "牌桌",
  status: "running",
  buyIn: 1000,
  maxSeats: 6,
  handId: "hand",
  handNo: 1,
  street: "preflop",
  board: [],
  pot: 4,
  dealerSeat: 0,
  actionOnSeat: 1,
  deadlineMs: 600000,
  cursor: "1:1",
  mySeatNo: 0,
  seats: [
    {
      seatNo: 0,
      displayName: "选手",
      stack: 998,
      status: "active",
      isMe: true,
      streetBet: 2,
      aiState: "online",
      hole: ["As", "Kh"],
    },
  ],
  recentActions: [actionResponse],
  persona: "风格",
  hole: ["As", "Kh"],
  toCall: 0,
  legalActions: [],
  minRaiseTo: 4,
  maxRaiseTo: 1000,
  deckRemaining: 48,
}
const room = {
  roomCode: "4821",
  name: null,
  ownerUserId: "user",
  maxSeats: 6,
  buyIn: 1000,
  status: "waiting",
  smallBlind: 1,
  bigBlind: 2,
  players: 1,
}
const { persona, hole, toCall, legalActions, minRaiseTo, maxRaiseTo, ...publicTable } =
  tableResponse
const { note, personaVersionId, personaVersion, ...publicAction } = actionResponse
const stats = { hands: 1, netProfit: -2, vpip: 1, pfr: 0, aggression: 0, winRate: 0 }
const summary = {
  handId: "hand",
  roomCode: "4821",
  handNo: 1,
  seatNo: 0,
  delta: -2,
  result: "lost",
  hole: ["As", "Kh"],
  board: ["2s", "3h", "4d", "5c", "7s"],
  createdAt: "2026-10-30T00:00:00.000Z",
}

export const gameResponseFixtures: Record<string, unknown> = {
  "app.game.hall.overview": hallResponse,
  "app.game.hall.guide": {
    points: { initial: 1000000, grant: 10000, grantIntervalHours: 24 },
    overview: "先读overview",
    games: hallResponse.games,
  },
  "app.game.hall.account": {
    ...hallResponse.points,
    recent: [
      {
        gameKind: "poker",
        roomCode: "4821",
        buyIn: 1000,
        returned: null,
        status: "active",
        lastActiveAt: "2026-10-30T00:00:00.000Z",
      },
    ],
  },
  "app.game.poker.guide": {
    rules: {
      game: "无限注德州扑克",
      seats: "2–10",
      blinds: [1, 2],
      buyIn: [500, 1000, 2000, 5000],
      actionWindowSeconds: 600,
      heartbeatSeconds: 60,
      timeout: "超时离场",
      headsUp: "按钮兼小盲",
      privacy: "本人私密",
    },
    tools: GAME_TOOLS.filter((tool) => tool.id.startsWith("app.game.poker.")),
    loop: "overview后wait",
    persona: "现读风格",
    errors: { POKER_NOT_YOUR_TURN: "重新wait" },
  },
  "app.game.poker.lobby.list": { items: [room], nextOffset: null },
  "app.game.poker.bot.add": { botId: "bot", seatNo: 1 },
  "app.game.poker.bot.remove": { pending: false },
  "app.game.poker.room.create": { roomCode: "4821" },
  "app.game.poker.room.get": {
    ...publicTable,
    mySeatNo: null,
    seats: tableResponse.seats.map(({ hole, ...seat }) => seat),
    recentActions: [publicAction],
  },
  "app.game.poker.seat.join": { roomCode: "4821", seatNo: 0 },
  "app.game.poker.seat.leave": { pending: false },
  "app.game.poker.seat.sit": { sittingOut: true, pending: false, status: "sitting_out" },
  "app.game.poker.seat.nudge": { notificationId: "notification" },
  "app.game.poker.table.wait": { status: "waiting", cursor: "1:1" },
  "app.game.poker.table.state": tableResponse,
  "app.game.poker.action.act": { ok: true, handId: "hand", actionSeq: 1, cursor: "1:1" },
  "app.game.poker.agent.list": [agentResponse],
  "app.game.poker.agent.upsert": {
    ...agentResponse,
    userId: "user",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
  },
  "app.game.poker.agent.versions": [
    {
      id: "version",
      agentId: "agent",
      versionNo: 1,
      persona: "风格",
      contentHash: "hash",
      createdAt: "2026-10-30T00:00:00.000Z",
      firstUsedAt: null,
      handCount: 0,
    },
  ],
  "app.game.poker.hand.history": { items: [summary], nextOffset: null },
  "app.game.poker.hand.detail": {
    handId: "hand",
    handNo: 1,
    roomCode: "4821",
    board: summary.board,
    street: "settled",
    result: { payouts: { 1: 4 }, pots: [] },
    seats: [
      {
        seatNo: 0,
        displayName: "选手",
        startingStack: 1000,
        endingStack: 998,
        folded: true,
        hole: summary.hole,
      },
    ],
    actions: [
      { ...actionResponse, elapsedMs: 10, personaVersion: { versionNo: 1, persona: "风格" } },
    ],
  },
  "app.game.poker.stats.get": {
    ...stats,
    comparison: [{ ...stats, seatNo: 0, displayName: "选手", isMe: true }],
  },
  "app.game.poker.room.close": { pending: true },
}
