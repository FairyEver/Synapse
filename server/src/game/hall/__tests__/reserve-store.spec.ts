import { describe, expect, it } from "vitest"
import { GameReserveService } from "../game-reserve.service"
import { HallService } from "../hall.service"
import { createHallStore } from "./hall-store"
import type { GameReserveWriteBatch } from "@synapse/shared/game-contracts"

const batch = (): GameReserveWriteBatch => ({
  scope: { funding: "points", gameKind: "other", gameRoomId: "room", settlementId: "hand" }, expectedRevision: 0, revision: 1,
  lots: [{ id: "lot", sourceId: "source", sourceType: "test", sourceSeq: 1, payerAdmissionId: "payer", payerUserId: "p", payerSeatNo: 0, originalAmount: 10, remainingAmount: 10 }],
  claims: [{ id: "claim", lotId: "lot", admissionId: "old", userId: "u", seatNo: 1, originalAmount: 10, remainingAmount: 10, status: "pending" }],
  movements: [{ id: "movement", lotId: "lot", rootActionId: "root", eventIndex: 0, kind: "deposit", amount: 10, actorAdmissionId: "payer" }],
})
describe("通用暂存持久化", () => {
  it("store_deduplicates_batch：相同批次只写一次，篡改原意图拒绝", async () => {
    const db = createHallStore(0), service = new GameReserveService(), input = batch()
    await db.transaction(tx => service.apply(tx, input))
    await db.transaction(tx => service.apply(tx, input))
    expect(db.reserveLots).toHaveLength(1); expect(db.reserveMovements).toHaveLength(1)
    expect(await db.transaction(tx => service.pending(tx, "u"))).toBe(10)
    const changed = structuredClone(input); changed.movements[0].amount = 11
    await expect(db.transaction(tx => service.apply(tx, changed))).rejects.toThrow()
    expect(db.reserveMovements[0].amount).toBe(10)
  })
  it("finalize_no_double_pending：固化、释放与重试都不重复计算资产", async () => {
    const db = createHallStore(0), service = new GameReserveService(), hall = new HallService(db.prisma), now = new Date(0)
    await db.transaction(tx => service.apply(tx, batch()))
    expect((await hall.overview("u", now)).points).toMatchObject({ total: 10, pending: 10, netProfit: 10 })
    await expect(hall.grant("u", now)).rejects.toThrow()
    const first = await db.transaction(async tx => { const records = await service.finalize(tx, "hand"); await hall.freezeTransfers(tx, records, now); return records })
    expect(first).toMatchObject([{ userId: "u", admissionId: "old", amount: 10 }])
    expect((await hall.overview("u", now)).points).toMatchObject({ total: 10, pending: 10 })
    await db.transaction(async tx => { const retry = await service.finalize(tx, "hand"); expect(retry).toEqual(first); await hall.freezeTransfers(tx, retry, now); await hall.releaseTransfers(tx, "hand", [], now) })
    expect((await hall.overview("u", now)).points).toMatchObject({ total: 10, pending: 0, available: 10 })
    expect(db.reserveClaims[0]).toMatchObject({ remainingAmount: 0, status: "finalized" })
  })
  it("failed_movement_rolls_back_wallet：失败不保留钱包或半笔份额", async () => {
    const db = createHallStore(100), service = new GameReserveService()
    db.failures.reserveMovement = true
    await expect(db.transaction(async tx => {
      await tx.gameAccount.update({ where: { userId: "u" }, data: { points: { increment: -10 } } })
      await service.apply(tx, batch())
    })).rejects.toThrow("injected reserve write failure")
    expect(db.account.points).toBe(100)
    expect(db.reserveLots).toEqual([]); expect(db.reserveClaims).toEqual([]); expect(db.reserveMovements).toEqual([])
  })
  it("新 revision 的转移必须解释份额变更，已确权的旧资金意图不变", async () => {
    const db = createHallStore(0), service = new GameReserveService(), hall = new HallService(db.prisma)
    await db.transaction(tx => service.apply(tx, batch()))
    const changed = batch(); changed.expectedRevision = 1; changed.revision = 2
    changed.lots[0].remainingAmount = 6; changed.claims[0].remainingAmount = 6
    changed.movements = [{ id: "take", lotId: "lot", claimId: "claim", rootActionId: "take", eventIndex: 1, kind: "steal", amount: 4, toAdmissionId: "thief", actorAdmissionId: "thief" }]
    await db.transaction(tx => service.apply(tx, changed))
    expect(await db.transaction(tx => service.pending(tx, "u"))).toBe(6)
    const corrupt = structuredClone(changed); corrupt.expectedRevision = 2; corrupt.revision = 3; corrupt.claims[0].remainingAmount = 1; corrupt.lots[0].remainingAmount = 1; corrupt.movements = []
    await expect(db.transaction(tx => service.apply(tx, corrupt))).rejects.toThrow()
    const record = { sourceId: "legacy", gameKind: "other", gameRoomId: "room", settlementId: "old-hand", userId: "u", admissionId: "old", amount: 7, funding: "points" as const }
    await db.transaction(tx => hall.freezeTransfers(tx, [record], new Date(0)))
    await expect(db.transaction(tx => hall.freezeTransfers(tx, [{ ...record, amount: 1 }], new Date(0)))).rejects.toThrow()
    expect(db.transfers[0].amount).toBe(7)
  })
})
