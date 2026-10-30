import type {
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
} from "@synapse/shared/game-contracts"
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
      close: (input: Room) => Promise<{ pending?: boolean; closed?: boolean }>
      create: (input: {
        maxSeats: number
        buyIn: number
        name?: string
        creationId?: string
        variant?: PokerVariant
        blindPreset?: PokerBlindPreset
        mode?: GameFunding
      }) => Promise<{ roomCode: string }>
      get: (input: Room) => Promise<PokerTableView>
    }
    bot: {
      add: (input: Room & { creationId: string }) => Promise<{ botId: string; seatNo: number }>
      remove: (input: Room & { botId: string }) => Promise<{ pending: boolean }>
    }
    seat: {
      join: (input: Room & { agentId?: string; modelName?: string; controlVersion?: number }) => Promise<{ roomCode: string; seatNo: number }>
      leave: (input: Room & { controlVersion?: number }) => Promise<{ pending: boolean }>
      sit: (input: Room & { sittingOut: boolean; controlVersion?: number; reason?: "user" | "context_maintenance" }) => Promise<{ sittingOut: boolean; pending: boolean; status: string }>
      nudge: (input: Room & { seatNo: number }) => Promise<{ notificationId: string }>
    }
    control: {
      set: (input: Room & { controlVersion: number; action: "takeover" | "request_ai" | "cancel_ai" }) => Promise<PokerControlView>
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
