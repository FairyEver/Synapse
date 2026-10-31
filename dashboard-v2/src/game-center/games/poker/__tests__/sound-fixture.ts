import type { PokerTableView } from "@synapse/shared/game-contracts"

export const soundTable: PokerTableView = {
  roomCode: "1234", name: null, status: "running", buyIn: 1000, maxSeats: 2,
  handId: "h1", handNo: 1, street: "preflop", board: [], pot: 3,
  dealerSeat: 0, actionOnSeat: 1, deadlineMs: 600000, cursor: "1:0",
  mySeatNo: 0, controller: "human", actionSeq: 0, bigBlind: 2,
  seats: [
    { seatNo: 0, displayName: "本人", stack: 999, streetBet: 1, status: "active", isMe: true, aiState: "online" },
    { seatNo: 1, displayName: "对手", stack: 998, streetBet: 2, status: "active", isMe: false, aiState: "online" },
  ],
  recentActions: [], deckRemaining: 48,
}

export function wager(amount: number): PokerTableView {
  return { ...soundTable, actionSeq: 1, recentActions: [
    { seq: 1, seatNo: 1, street: "preflop", action: "raise", amount, potAfter: 3 + amount, isAuto: false },
  ] }
}
