import type { PokerPotContributions, PokerTableView } from "@synapse/shared/game-contracts"
import { feeTable } from "./roll-fee-fixtures"

export const potContributions: PokerPotContributions = {
  handId: feeTable.handId!, status: "pending", total: 300,
  players: [
    { key: "lin", seatNo: 0, displayName: "林舟", isMe: true, folded: false, amount: 150 },
    { key: "man", seatNo: 1, displayName: "小满", isMe: false, folded: false, amount: 100 },
    { key: "chen", seatNo: 4, displayName: "老陈", isMe: false, folded: true, amount: 50 },
    { key: "waiting", seatNo: 2, displayName: "未投入玩家", isMe: false, folded: true, amount: 0 },
  ],
}
export const potTable: PokerTableView = { ...feeTable, pot: 300, potContributions }
