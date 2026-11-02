import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { gameTestDatabaseUrl } from "./test-database"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("房间带入档位约束迁移", () => {
  const db = new Client({ connectionString: url })
  beforeAll(async () => {
    await db.connect()
    // A session-local table shadows the business table; no existing rooms are touched.
    await db.query(`CREATE TEMP TABLE "GamePokerRoom" (
      "maxSeats" INTEGER NOT NULL, "buyIn" INTEGER NOT NULL,
      CONSTRAINT "GamePokerRoom_rules" CHECK ("maxSeats" BETWEEN 2 AND 10 AND "buyIn" IN (500,1000,2000,5000))
    )`)
    await db.query('INSERT INTO "GamePokerRoom" VALUES (10,500),(10,2000)')
    const file = join(__dirname, "../../../../prisma/migrations/20261102100000_game_poker_buy_in_presets/migration.sql")
    await db.query(readFileSync(file, "utf8"))
  })
  afterAll(() => db.end())

  it.each([1000, 5000, 10000, 50000])("数据库允许当前建房档位 %s", async buyIn => {
    for (const seats of [2, 6]) {
      await expect(db.query('INSERT INTO "GamePokerRoom" VALUES ($1,$2)', [seats, buyIn])).resolves.toMatchObject({ rowCount: 1 })
    }
  })
  it("保留旧500/2000档位和10座房，不改写存量值", async () => {
    const result = await db.query('SELECT "maxSeats", "buyIn" FROM "GamePokerRoom" WHERE "buyIn" IN (500,2000) ORDER BY "buyIn"')
    expect(result.rows).toEqual([{ maxSeats: 10, buyIn: 500 }, { maxSeats: 10, buyIn: 2000 }])
  })
  it.each([[2, 0], [2, 1001], [2, 50001], [1, 1000], [11, 1000]])("继续拒绝无效座位%s或金额%s", async (seats, buyIn) => {
    await expect(db.query('INSERT INTO "GamePokerRoom" VALUES ($1,$2)', [seats, buyIn])).rejects.toMatchObject({ code: "23514", constraint: "GamePokerRoom_rules" })
  })
})
