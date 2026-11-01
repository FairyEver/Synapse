import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
const migration = () => readFileSync(join(__dirname, "../../../../prisma/migrations/20261101090000_game_roll_frozen_transfers/migration.sql"), "utf8")
describe("Roll迁移的身份和不可变审计约束", () => {
  it("只从现有座位精确回填入座ID，保留历史手牌nullable", () => {
    const sql = migration()
    expect(sql).toMatch(/SET "admissionId"=s\."id"/)
    expect(sql).toContain('g."userId"=s."userId"')
    expect(sql).toContain('g."gameRoomId"=s."roomId"')
    expect(sql).toContain('"GamePokerHandSeat" ADD COLUMN "admissionId" TEXT')
    expect(sql).not.toContain('UPDATE "GamePokerHandSeat"')
  })
  it("规则冻结包含选项和价格版本，完成Roll删除仅接受精确归档副本", () => {
    const sql = migration()
    expect(sql).toContain('NEW."ruleOptions",NEW."rollPricingVersion"')
    expect(sql).toContain('OLD."completedAt" IS NOT NULL')
    expect(sql).toContain('jsonb_array_elements(a."data"->\'rolls\')')
    expect(sql).toContain('archived_roll.value = to_jsonb(OLD)')
    expect(sql).not.toContain('a."data"->\'rolls\' @>')
    expect(sql.indexOf('IF v_stored IS DISTINCT FROM v_data')).toBeLessThan(sql.indexOf('DELETE FROM "GamePokerRoll"'))
    expect(sql).toContain("'rolls',COALESCE(")
    expect(sql).not.toContain('DELETE FROM "GamePokerActionReceipt"')
    expect(sql).toContain('a."rollId" IS NOT NULL AND r."requestHash" IS NULL')
  })
})
