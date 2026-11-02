import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
describe("卡牌与暂存迁移", () => {
  it("仅追加可空房规和新账本，不改写旧冻结资产；设置有限迁移超时", () => {
    const sql = readFileSync(resolve("prisma/migrations/20261103000000_game_card_mode_and_reserve/migration.sql"), "utf8")
    expect(sql).toMatch(/lock_timeout\s*=\s*'5s'/)
    expect(sql).toMatch(/statement_timeout\s*=\s*'30s'/)
    for (const table of ["GameReserveLot", "GameReserveClaim", "GameReserveMovement", "GamePokerResolution"]) expect(sql).toContain(`CREATE TABLE "${table}"`)
    for (const column of ["cardRulesVersion", "chipRulesVersion", "actionStartedAt"]) expect(sql).toContain(`ADD COLUMN "${column}"`)
    const topLevel = sql.replace(/\$\$[\s\S]*?\$\$/g, "$$")
    expect(topLevel).not.toMatch(/UPDATE\s+"(?:GamePendingTransfer|GamePokerRoom|GamePokerHand)"/i)
    expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN)/i)
    expect(sql).toContain('"remainingAmount" <= "originalAmount"')
    expect(sql).toContain('"handId", "seq"')
    expect(sql).toContain('"settlementId", "rootActionId", "eventIndex"')
  })
})
