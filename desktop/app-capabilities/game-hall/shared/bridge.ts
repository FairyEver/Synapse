import type {
  HallOverview,
  GamePage,
  PokerRoomView,
  PokerTableView,
  PokerAgentView,
  PokerVersionView,
  PokerSummaryView,
  PokerDetailView,
  PokerStats,
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
      list: (input?: { offset?: number; limit?: number }) => Promise<GamePage<PokerRoomView>>
    }
    room: {
      close: (input: Room) => Promise<{ pending?: boolean; closed?: boolean }>
      create: (input: {
        maxSeats: number
        buyIn: number
        name?: string
        creationId?: string
      }) => Promise<{ roomCode: string }>
      get: (input: Room) => Promise<PokerTableView>
    }
    seat: {
      leave: (input: Room) => Promise<{ pending: boolean }>
      sit: (input: Room & { sittingOut: boolean }) => Promise<unknown>
      nudge: (input: Room & { seatNo: number }) => Promise<{ notificationId: string }>
    }
    table: {
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
      history: (input?: { offset?: number; limit?: number }) => Promise<GamePage<PokerSummaryView>>
      detail: (input: Room & { handNo: number }) => Promise<PokerDetailView>
    }
    stats: { get: (input?: { roomCode?: string }) => Promise<PokerStats> }
  }
}
export function unwrapGameResult<T>(value: unknown): T {
  const r = value as { ok: boolean; data?: T; code?: string; error?: string }
  if (!r.ok)
    throw Object.assign(new Error(r.error ?? "游戏请求失败。"), { code: r.code, details: r.data })
  return r.data as T
}
