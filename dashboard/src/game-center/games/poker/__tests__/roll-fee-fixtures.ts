import type { PokerRollLedger, PokerTableView } from "@synapse/shared/game-contracts"
import { rollTable } from "./roll-visibility-fixtures"

export const feeLedger: PokerRollLedger = {
  handId: rollTable.handId!, status: "pending",
  players: [
    { key: "lin", seatNo: 0, displayName: "林舟", isMe: true, folded: false },
    { key: "man", seatNo: 1, displayName: "小满", isMe: false, folded: false },
    { key: "chuan", seatNo: 2, displayName: "阿川", isMe: false, folded: false },
    { key: "momo", seatNo: 3, displayName: "Momo", isMe: false, folded: false },
    { key: "chen", seatNo: 4, displayName: "老陈", isMe: false, folded: true },
  ],
  entries: [
    { id: "r1", payerKey: "lin", kind: "normal", street: "preflop", fee: 40, compensations: [{ key: "man", amount: 10 }, { key: "chuan", amount: 10 }, { key: "momo", amount: 10 }, { key: "chen", amount: 10 }] },
    { id: "r2", payerKey: "man", kind: "super", street: "preflop", fee: 120, compensations: [{ key: "lin", amount: 30 }, { key: "chuan", amount: 30 }, { key: "momo", amount: 30 }, { key: "chen", amount: 30 }] },
    { id: "r3", payerKey: "chuan", kind: "normal", street: "flop", fee: 63, compensations: [{ key: "lin", amount: 21 }, { key: "man", amount: 21 }, { key: "momo", amount: 21 }] },
    { id: "r4", payerKey: "lin", kind: "super", street: "flop", fee: 180, compensations: [{ key: "man", amount: 60 }, { key: "chuan", amount: 60 }, { key: "momo", amount: 60 }] },
  ],
}
export const feeTable: PokerTableView = { ...rollTable, rollLedger: feeLedger }
