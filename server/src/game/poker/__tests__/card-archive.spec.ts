import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import type { Prisma } from "@prisma/client"
import { archiveData } from "../poker-archive.service"
import { projectResolutionFrame, pageResolutionFrames } from "../poker-card-projection"
import { makeCardHand } from "./card-test-fixtures"
import type { ResolutionFrame } from "../engine/cards/types"
import { rollStore } from "./roll-service-store"
import { PokerEventsService } from "../poker-events.service"

describe("卡牌完整归档与根帧", () => {
  it("真实事件服务按根动作分页，事实不会因limit=1丢失", async () => {
    const f = await rollStore(), hand = f.hands[0], now = new Date(), person = f.participants[0]
    f.room.chipRulesVersion = "chips-v2"; hand.actionSeq = 2; hand.startedAt = now
    for (const seq of [1, 2]) {
      const frame: ResolutionFrame = { id: `${hand.id}:${seq}`, handId: hand.id, seq, rootActionId: `root-${seq}`, events: Array.from({ length: 200 }, (_, index) => ({ id: `${seq}:${index}`, index, type: "chips.paid", phase: "after", audience: "public", actorSeatNo: 0, data: { amount: index } })) }
      f.actions.push({ handId: hand.id, roomId: f.room.id, seq, seatNo: person.seatNo, userId: person.userId, street: "preflop", action: "card_play", amount: 0, potAfter: 3, isAuto: false, actionSource: "human", createdAt: now })
      f.resolutions.push({ handId: hand.id, seq, data: frame })
    }
    const service = new PokerEventsService(f.poker), first = await service.events("u", f.room.code, "1:0", 1, "desktop", "owner")
    expect(first.events).toHaveLength(1); expect(first.frames![0].events).toHaveLength(200)
    expect(first.cursor).toBe("1:1"); expect(first.hasMore).toBe(true)
    expect((await service.events("u", f.room.code, first.cursor, 1, "desktop", "owner")).frames![0].seq).toBe(2)
  })
  it("whole_frame_pagination：单页一个根动作也不截断其200个事实", () => {
    const frames: ResolutionFrame[] = [1, 2].map(seq => ({ id: `h:${seq}`, handId: "h", seq, rootActionId: `r${seq}`, events: Array.from({ length: 200 }, (_, index) => ({ id: `${seq}:${index}`, index, type: "chips.paid", phase: "after", audience: "public", actorSeatNo: 0, data: { amount: index } })) }))
    const page = pageResolutionFrames(frames, 0, 1)
    expect(page.frames).toHaveLength(1); expect(page.frames[0].events).toHaveLength(200); expect(page.hasMore).toBe(true); expect(page.afterSeq).toBe(1)
    expect(pageResolutionFrames(frames, 1, 1).frames[0]).toEqual(projectResolutionFrame(frames[1]))
  })
  it("冷副本保留卡牌/暂存与根帧，旧归档按空数据兼容；迁移仅在受控归档后删热帧", () => {
    const state = makeCardHand(), frame: ResolutionFrame = { id: "h:1", handId: "h", seq: 1, rootActionId: "r", events: [] }
    const data = { hand: { id: "h" }, seats: [], actions: [], summaries: [], cards: state.cards, reserve: { revision: 0, finalized: true, lots: [], claims: [], movements: [] }, resolutions: [{ seq: 1, data: frame }] }
    const restored = archiveData(JSON.parse(JSON.stringify(data)) as Prisma.JsonValue)
    expect(restored.cards).toEqual(state.cards); expect(restored.reserve?.finalized).toBe(true); expect(restored.resolutions).toMatchObject([{ seq: 1, data: frame }])
    expect(archiveData({ hand: { id: "old" }, seats: [], actions: [], summaries: [] }).resolutions).toEqual([])
    const sql = readFileSync(resolve("prisma/migrations/20261103000000_game_card_mode_and_reserve/migration.sql"), "utf8")
    expect(sql).toContain("'resolutions'"); expect(sql).toContain("'cards'"); expect(sql).toContain("'reserve'")
    expect(sql.indexOf('DELETE FROM "GamePokerResolution"')).toBeGreaterThan(sql.indexOf("set_config('synapse.game.archive_hand',p_hand_id,true)"))
  })
})
