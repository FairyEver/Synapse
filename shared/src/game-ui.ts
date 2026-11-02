import { GAME_TOOLS } from "./game.js"
import type {
  PokerRuleOptions,
  PokerRollResult,
  PokerRollStartInput,
  PokerRollChooseInput,
  GameFunding,
  HallOverview,
  GamePage,
  PokerRoomView,
  PokerTableView,
  PokerAgentView,
  PokerVersionView,
  PokerSummaryView,
  PokerDetailView,
  PokerStats,
  PokerVariant,
  PokerBlindPreset,
  PokerControlView,
  PokerTableEventsView,
} from "./game.js"
type Room = { roomCode: string }
export interface GameBridge {
  hall: {
    overview: () => Promise<HallOverview>
    guide: () => Promise<unknown>
    account: (input?: { claimGrant?: boolean }) => Promise<HallOverview["points"]>
  }
  poker: {
    guide: () => Promise<unknown>
    lobby: {
      list: (input?: { offset?: number; limit?: number; mode?: GameFunding | "all" }) => Promise<GamePage<PokerRoomView>>
    }
    room: {
      start: (input: Room & { handId: string | null; controlVersion?: number }) => Promise<{ handId: string; started: boolean }>
      close: (input: Room) => Promise<{ pending?: boolean; closed?: boolean }>
      create: (input: {
        maxSeats: number
        buyIn: number
        name?: string
        creationId?: string
        variant?: PokerVariant
        blindPreset?: PokerBlindPreset
        ruleOptions?: PokerRuleOptions
        mode?: GameFunding
      }) => Promise<{ roomCode: string }>
      get: (input: Room) => Promise<PokerTableView>
    }
    bot: {
      add: (input: Room & { creationId: string }) => Promise<{ botId: string; seatNo: number }>
      remove: (input: Room & { botId: string }) => Promise<{ pending: boolean }>
    }
    seat: {
      ready: (input: Room & { handId: string | null; controlVersion: number }) => Promise<{ handId: string | null; started: boolean }>
      join: (input: Room & { agentId?: string; modelName?: string; controlVersion?: number }) => Promise<{ roomCode: string; seatNo: number }>
      leave: (input: Room & { controlVersion?: number }) => Promise<{ pending: boolean }>
      sit: (input: Room & { sittingOut: boolean; controlVersion?: number; reason?: "user" | "context_maintenance" }) => Promise<{ sittingOut: boolean; pending: boolean; status: string }>
      nudge: (input: Room & { seatNo: number }) => Promise<{ notificationId: string }>
    }
    control: {
      set: (input: Room & { controlVersion: number; action: "takeover" | "request_ai" | "cancel_ai" }) => Promise<PokerControlView>
    }
    roll: {
      start: (input: PokerRollStartInput) => Promise<PokerRollResult>
      choose: (input: PokerRollChooseInput) => Promise<PokerRollResult>
    }
    action: {
      act: (input: Room & {
        handId: string
        street: "preflop" | "flop" | "turn" | "river"
        actionId: string
        action: "fold" | "check" | "call" | "bet" | "raise" | "allin"
        to?: number
        controlVersion?: number
        expectedActionSeq?: number
      }) => Promise<{ ok: true; handId: string; actionSeq: number; cursor: string }>
    }
    table: {
      events: (input: Room & { cursor?: string; limit?: number; perspective?: "owner" | "public" }) => Promise<PokerTableEventsView>
      state: (input: Room & { perspective?: "owner" | "public" }) => Promise<PokerTableView>
    }
    agent: {
      list: () => Promise<PokerAgentView[]>
      upsert: (input: {
        id?: string
        creationId?: string
        model?: string
        persona?: string
      }) => Promise<PokerAgentView>
      versions: (input: { agentId: string }) => Promise<PokerVersionView[]>
    }
    hand: {
      history: (input?: { offset?: number; limit?: number; mode?: GameFunding }) => Promise<GamePage<PokerSummaryView>>
      detail: (input: Room & { handNo: number }) => Promise<PokerDetailView>
    }
    stats: { get: (input?: { roomCode?: string; mode?: GameFunding }) => Promise<PokerStats> }
  }
}
export function unwrapGameResult<T>(value: unknown): T {
  const r = value as { ok: boolean; data?: T; code?: string; error?: string }
  if (!r.ok)
    throw Object.assign(new Error(r.error ?? "游戏请求失败。"), { code: r.code, details: r.data })
  return r.data as T
}


export const POKER_PRIVATE_UI_OPERATIONS = [
  {
    id: "app.game.poker.control.set",
    name: "",
    description: "本人接管、请求或取消AI托管",
    mutates: true,
    inputSchema: {
      type: "object",
      properties: {
        roomCode: { type: "string", pattern: "^[0-9]{4,6}$" },
        controlVersion: { type: "integer", minimum: 0, maximum: 2147483647 },
        action: { type: "string", enum: ["takeover", "request_ai", "cancel_ai"] },
      },
      required: ["roomCode", "controlVersion", "action"],
      additionalProperties: false,
    },
  },
  {
    id: "app.game.poker.room.close",
    name: "",
    description: "房主解散房间；仅房主与机器人参与的陪练房立即解散，其他进行中房间本手结束后解散",
    mutates: true,
    inputSchema: {
      type: "object",
      properties: { roomCode: { type: "string", pattern: "^[0-9]{4,6}$" } },
      required: ["roomCode"],
      additionalProperties: false,
    },
  },
]
export const POKER_UI_OPERATIONS = [
  ...GAME_TOOLS.filter(
    (t) =>
      t.id.startsWith("app.game.poker.") &&
      ![
        "app.game.poker.table.wait",
        "app.game.poker.control.claim",
        "app.game.poker.checkpoint.get",
        "app.game.poker.checkpoint.save",
      ].includes(t.id),
  ),
  ...POKER_PRIVATE_UI_OPERATIONS,
]

// Human UI actions never carry agent-only decision notes or persona selection.
export const POKER_HUMAN_ACTION_SCHEMA = (() => {
  const action = GAME_TOOLS.find(t => t.id === "app.game.poker.action.act")!
  const { note: _note, personaSource: _personaSource, ...properties } = action.inputSchema.properties
  return { ...action.inputSchema, properties }
})()

export interface GameUiRoute {
  method: "GET" | "POST"
  path: (params: Record<string, unknown>) => string
  bareResponse: boolean
}


const roomPath = (params: Record<string, unknown>) => `/game/poker/rooms/${encodeURIComponent(String(params.roomCode))}`
export const pokerUiRoutes = {
  "app.game.poker.room.start": { method: "POST", bareResponse: true, path: params => `${roomPath(params)}/start` },
  "app.game.poker.roll.start": { method: "POST", bareResponse: true, path: params => `${roomPath(params)}/roll/start` },
  "app.game.poker.roll.choose": { method: "POST", bareResponse: true, path: params => `${roomPath(params)}/roll/choose` },
  "app.game.poker.seat.ready": {
    method: "POST", bareResponse: true, path: params => `${roomPath(params)}/ready`,
  },
  "app.game.poker.seat.join": {
    method: "POST",
    bareResponse: true,
    path: (params) => `${roomPath(params)}/join`,
  },
  "app.game.poker.action.act": {
    method: "POST",
    bareResponse: true,
    path: (params) => `${roomPath(params)}/actions`,
  },
  "app.game.poker.seat.sit": {
    method: "POST",
    bareResponse: true,
    path: (params) => `${roomPath(params)}/sit`,
  },
  "app.game.poker.seat.leave": {
    method: "POST",
    bareResponse: true,
    path: (params) => `${roomPath(params)}/leave`,
  },
  "app.game.poker.control.set": {
    method: "POST",
    bareResponse: true,
    path: (params) => `${roomPath(params)}/control`,
  },
  "app.game.poker.table.events": {
    method: "GET",
    bareResponse: true,
    path: (params) => {
      const query = new URLSearchParams()
      if (typeof params.cursor === "string") query.set("cursor", params.cursor)
      if (typeof params.limit === "number") query.set("limit", String(params.limit))
      query.set("perspective", params.perspective === "owner" ? "owner" : "public")
      return `${roomPath(params)}/events${query.size ? `?${query}` : ""}`
    },
  },
  "app.game.poker.table.state": {
    method: "GET",
    bareResponse: true,
    path: (params) =>
      `/game/poker/rooms/${encodeURIComponent(String(params.roomCode))}/state?perspective=${params.perspective === "public" ? "public" : "owner"}`,
  },
  "app.game.poker.room.close": {
    method: "POST",
    bareResponse: true,
    path: (params) => `/game/poker/rooms/${encodeURIComponent(String(params.roomCode))}/close`,
  },
} satisfies Record<string, GameUiRoute>

export const GAME_UI_ROUTES: Readonly<Record<string, GameUiRoute>> = pokerUiRoutes
export const GAME_UI_OPERATIONS = [...GAME_TOOLS.filter(t => t.id.startsWith("app.game.hall.")), ...POKER_UI_OPERATIONS]
export const GAME_WEB_INVOKE_OPERATIONS = GAME_UI_OPERATIONS.filter(t => !GAME_UI_ROUTES[t.id]).map(t => t.id)
export const GAME_WEB_IDENTITY_HEADER = "x-synapse-game-user-id"
export { GAME_RESPONSE_SCHEMAS } from "./game-response-schemas.js"
