import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Prisma } from "@prisma/client"
import type { RoomContext } from "../poker.service"
import { projectRollStats } from "../poker-roll-stats"

// Explicitly opted-in, disposable single-user PostgreSQL. No URL, network, or existing DB.
const sqlTest = process.env.GAME_ROLL_STATS_SQL_TEST === "1" ? describe : describe.skip
sqlTest("Roll真实SQL临时离线数据库", () => {
  let directory: string
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "synapse-roll-stats-e2e-"))
    const result = spawnSync("initdb", ["-D", directory, "-A", "trust", "--no-locale", "-E", "UTF8"], { encoding: "utf8", timeout: 20000 })
    if (result.status !== 0) throw new Error(`临时数据库初始化失败：${result.stderr}`)
  })
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })
  const literal = (value: unknown) => value == null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`
  async function query(handId: string | null, seats = [{ seatNo: 0, userId: "a" }, { seatNo: 1, userId: "b" }]) {
    let statement!: Prisma.Sql
    const zero = { players: 0, count: 0, paid: 0 }
    const tx = { $queryRaw: vi.fn((sql: Prisma.Sql) => { statement = sql; return Promise.resolve([{ hand: zero, room: zero, players: [] }]) }) }
    await projectRollStats({ room: { id: "room" }, tx } as unknown as RoomContext, handId, seats)
    return statement.strings.map((part, i) => part + (i < statement.values.length ? literal(statement.values[i]) : "")).join("").replaceAll("\n", " ")
  }
  it("真实执行热/冷去重、同账号重进、同座位不同账号、超级完成与座位限定", async () => {
    const cold = [
      { id: "r0", roomId: "room", handId: "h0", userId: "b", admissionId: "old-b", data: { fee: 4 }, createdAt: "2026-01-01T00:00:00Z" },
      { id: "r2", roomId: "room", handId: "h1", userId: "a", admissionId: "old-a", data: { fee: 10 }, createdAt: "2026-01-02T00:00:00Z" },
      { id: "r3", roomId: "room", handId: "h0", userId: "a", admissionId: "first-a", data: { fee: 3 }, createdAt: "2026-01-01T00:00:00Z" },
    ]
    const archive = { seats: cold.map(r => ({ userId: r.userId, admissionId: r.admissionId, displayName: "同名" })), rolls: cold }
    const current = await query("h2"), empty = await query(null), second = await query("h2", [{ seatNo: 5, userId: "user-051" }])
    const verify = (sql: string, assertion: string) => `DO $$ DECLARE actual record; BEGIN SELECT * INTO actual FROM (${sql}) result; ${assertion} END $$;`
    const commands = [
      'CREATE TABLE "GamePokerRoll" ("id" text PRIMARY KEY, "roomId" text, "handId" text, "userId" text, "admissionId" text, "data" jsonb, "createdAt" timestamp);',
      'CREATE TABLE "GamePokerHandSeat" ("handId" text, "userId" text, "admissionId" text, "displayName" text);',
      'CREATE TABLE "GamePokerHandArchive" ("roomId" text, "data" jsonb);',
      `INSERT INTO "GamePokerRoll" VALUES ('r1','room','h2','a','new-a','{"fee":6,"selectedIndex":null}','2026-11-02'), ('r2','room','h1','a','old-a','{"fee":10}','2026-01-02'), ('other','other-room','h2','x','admission-x','{"fee":99}','2026-11-02');`,
      `INSERT INTO "GamePokerHandSeat" VALUES ('h2','a','new-a','新昵称'), ('h1','a','old-a','同名');`,
      `INSERT INTO "GamePokerHandArchive" VALUES ('room',${literal(JSON.stringify(archive))}::jsonb);`,
      verify(current, `IF actual.room <> '{"players":2,"count":4,"paid":23}'::jsonb OR actual.hand <> '{"players":1,"count":1,"paid":6}'::jsonb THEN RAISE EXCEPTION '合计错误 %', row_to_json(actual); END IF; IF actual.players->0->>'userId' <> 'a' OR (actual.players->0->>'paid')::int <> 19 THEN RAISE EXCEPTION '身份汇总错误 %',actual.players; END IF;`),
      `UPDATE "GamePokerRoll" SET "data"='{"fee":6,"selectedIndex":1}' WHERE "id"='r1';`,
      verify(current, `IF (actual.room->>'count')::int <> 4 OR (actual.room->>'paid')::int <> 23 THEN RAISE EXCEPTION 'choose重复计数'; END IF;`),
      verify(empty, `IF actual.hand <> '{"players":0,"count":0,"paid":0}'::jsonb THEN RAISE EXCEPTION '无当前手错误'; END IF;`),
      `INSERT INTO "GamePokerRoll" SELECT 'page-'||n,'room','h2','user-'||lpad(n::text,3,'0'),'admission-'||n,'{"fee":1}'::jsonb,'2026-11-02' FROM generate_series(1,51) n;`,
      verify(second, `IF actual.room <> '{"players":53,"count":55,"paid":74}'::jsonb OR jsonb_array_length(actual.players) <> 1 OR actual.players->0->>'userId' <> 'user-051' THEN RAISE EXCEPTION '座位过滤裁掉合计 %',row_to_json(actual); END IF; RAISE NOTICE 'ROLL_STATS_SQL_VERIFIED';`),
    ].join("\n")
    const result = spawnSync("postgres", ["--single", "-D", directory, "-c", "log_min_messages=notice", "postgres"], { input: commands, encoding: "utf8", timeout: 20000 })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).not.toMatch(/ERROR|FATAL/)
    expect(result.stderr).toContain("ROLL_STATS_SQL_VERIFIED")
  })
})
