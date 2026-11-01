import { randomUUID } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { gameTestDatabaseUrl } from "../../poker/__tests__/test-database"

// Opt-in dedicated local database only. No SQL executes when the existing guard is absent.
const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("Roll归档删除的PostgreSQL精确副本保护", () => {
  const db = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } } })
  afterAll(() => db.$disconnect())

  it.each(["exact", "candidate_order", "extra_candidate", "extra_field"])("归档副本%s按完整JSONB相等校验", async (mutation) => {
    const rollback = new Error("rollback isolated audit fixture")
    try {
      await db.$transaction(async (tx) => {
        const handId = randomUUID(), rollId = randomUUID(), userId = randomUUID(), roomId = randomUUID(), old = new Date(Date.now() - 91 * 86400000)
        await tx.gamePokerHand.create({ data: {
          id: handId, roomId, handNo: 1, dealerSeat: 0, board: [], street: "settled",
          status: "settled", engineState: {}, endedAt: old,
        } })
        await tx.gamePokerRoll.create({ data: {
          id: rollId, roomId, handId, userId, admissionId: randomUUID(), seatNo: 0,
          startSeq: 1, chooseSeq: 2, completedAt: old,
          data: { id: rollId, kind: "super", candidates: ["As", "Kh", "Qd"], selectedIndex: 1 },
        } })
        // PostgreSQL builds the full row copy; only the indicated audit-data corruption differs.
        await tx.$executeRaw`
          INSERT INTO "GamePokerHandArchive"("id","roomId","handNo","participantIds","data","endedAt")
          SELECT h."id",h."roomId",h."handNo",ARRAY[r."userId"],
            jsonb_build_object('hand',to_jsonb(h)-'engineState','rolls',jsonb_build_array(
              CASE ${mutation}
                WHEN 'candidate_order' THEN jsonb_set(to_jsonb(r),'{data,candidates}','["Kh","As","Qd"]'::jsonb)
                WHEN 'extra_candidate' THEN jsonb_set(to_jsonb(r),'{data,candidates}','["As","Kh","Qd","Js"]'::jsonb)
                WHEN 'extra_field' THEN to_jsonb(r)||'{"extra":"untrusted"}'::jsonb
                ELSE to_jsonb(r)
              END)),h."endedAt"
          FROM "GamePokerHand" h JOIN "GamePokerRoll" r ON r."handId"=h."id"
          WHERE h."id"=${handId} AND r."id"=${rollId}`
        await tx.$queryRaw`SELECT set_config('synapse.game.archive_hand',${handId},true)`
        await tx.$executeRawUnsafe("SAVEPOINT audit_delete")
        let failure: unknown
        try {
          await tx.$executeRaw`DELETE FROM "GamePokerRoll" WHERE "id"=${rollId}`
        } catch (error) {
          failure = error
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT audit_delete")
        }
        if (mutation === "exact") {
          expect(failure).toBeUndefined()
          expect(await tx.gamePokerRoll.count({ where: { id: rollId } })).toBe(0)
        } else {
          expect(String(failure)).toContain("Roll records can only be removed by validated archival")
          expect(await tx.gamePokerRoll.count({ where: { id: rollId } })).toBe(1)
        }
        // Always roll back the fixture, including immutable cold records.
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
  })
})
