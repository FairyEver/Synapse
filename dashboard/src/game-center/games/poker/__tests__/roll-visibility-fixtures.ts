import type { PokerTableView } from "@synapse/shared/game-contracts"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"
export const rollTable: PokerTableView = {
  ...tableResponse, mode: "practice", controller: "human", controlVersion: 2, mySeatNo: 0, actionOnSeat: 0,
  board: ["Ks", "Qh", "Jc"], hole: ["8h", "Ad"], street: "flop", status: "running", actionSeq: 3,
  legalActions: ["fold", "call", "raise", "allin"], minRaiseTo: 10, maxRaiseTo: 1000,
  roll: { enabled: true, count: 2, normal: { fee: 6, available: true }, super: { fee: 16, available: true }, pending: null },
  rollStats: {
    hand: { players: 2, count: 3, paid: 30 }, room: { players: 4, count: 9, paid: 96 },
    seats: [
      { seatNo: 0, key: "me", hand: { count: 2, paid: 22 }, room: { count: 5, paid: 60 } },
      { seatNo: 1, key: "other", hand: { count: 1, paid: 8 }, room: { count: 4, paid: 36 } },
    ],
  },
  seats: Array.from({ length: 10 }, (_, i) => ({ seatNo: i, isMe: i === 0, displayName: i === 0 ? "本人" : `玩家${i}`, stack: 1000,
    inCurrentHand: true, status: "active", controller: "human", participantKind: "human", controlVersion: 2, streetBet: i,
    aiState: "online", rollCount: i === 0 ? 2 : i === 1 ? 1 : 0, rollPaid: i === 0 ? 22 : i === 1 ? 8 : 0 })),
  maxSeats: 10,
}
