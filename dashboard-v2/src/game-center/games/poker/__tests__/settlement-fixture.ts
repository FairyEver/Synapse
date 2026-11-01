import type { PokerTableView } from "@synapse/shared/game-contracts"
export const table: PokerTableView = {
  roomCode: "1234", name: null, status: "paused", handId: "h1", handNo: 1, street: "settled", board: ["Ac", "Ks", "Kd", "7h", "2c"], pot: 0, buyIn: 2000, maxSeats: 4,
  mySeatNo: 0, controller: "human", controlVersion: 3, awaitingReady: true, dealerSeat: 0, actionOnSeat: null, deadlineMs: null, cursor: "1:5", recentActions: [], deckRemaining: 43,
  seats: [0, 1].map(seatNo => ({ seatNo, isMe: seatNo === 0, displayName: seatNo ? "对手" : "本人", stack: 2000, status: "waiting", streetBet: 0, aiState: "online", nextHandEligible: true, readyForNextHand: false })),
  settlement: { handId: "h1", handNo: 1, rules: { variant: "standard52", smallBlind: 5, bigBlind: 10 }, board: ["Ac", "Ks", "Kd", "7h", "2c"], mixedControl: false,
    seats: [
      { seatNo: 0, displayName: "本人", isMe: true, participantKind: "human", folded: false, hole: ["Ah", "Ad"], handName: "葫芦", bestFive: ["Ah", "Ad", "Ac", "Ks", "Kd"], delta: 600, payout: 1200, endingStack: 2600 },
      { seatNo: 1, displayName: "长姓名".repeat(40), isMe: false, participantKind: "human", folded: true, delta: -600, payout: 0, endingStack: 1400 },
    ], pots: [{ amount: 1200, eligible: [0], winners: [0], shares: { 0: 1200 }, refund: false, reason: "其他玩家均已弃牌，无需摊牌。" }],
  },
}
