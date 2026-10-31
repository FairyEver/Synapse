import { describe, expect, it } from "vitest"
import { pokerSoundCues } from "../lib/poker-sounds"
import { soundTable, wager } from "./sound-fixture"

describe("德扑声音反馈", () => {
  it("同一快照重复轮询无声音，金额增大增加碰撞次数但有上限", () => {
    expect(pokerSoundCues(soundTable, { ...soundTable }, "owner")).toEqual([])
    const small = pokerSoundCues(soundTable, wager(2), "owner")
    const medium = pokerSoundCues(soundTable, wager(16), "owner")
    const large = pokerSoundCues(soundTable, wager(1_000_000), "owner")
    expect(small).toHaveLength(1)
    expect(medium.length).toBeGreaterThan(small.length)
    expect(large.length).toBeGreaterThan(medium.length)
    expect(large).toHaveLength(6)
    expect(Math.max(...large.map(c => c.delay))).toBeLessThan(500)
    expect(Math.max(...large.map(c => c.volume))).toBeLessThanOrEqual(0.4)
    expect(pokerSoundCues(wager(16), { ...wager(16) }, "owner")).toEqual([])
  })

  it("新手发牌和盲注有声，翻牌和过牌弃牌有不同反馈", () => {
    const next = { ...soundTable, handId: "h2", handNo: 2 }
    expect(pokerSoundCues(soundTable, next, "owner").some(c => c.sound === "deal")).toBe(true)
    expect(pokerSoundCues(soundTable, { ...next, seats: next.seats.map(s => ({ ...s, status: "allin" })) }, "owner").filter(c => c.sound === "deal")).toHaveLength(4)
    const flop = { ...soundTable, street: "flop", board: ["As", "Kh", "7c"] }
    expect(pokerSoundCues(soundTable, flop, "owner").filter(c => c.sound === "card")).toHaveLength(3)
    const action = wager(0)
    for (const [kind, sound] of [["check", "tap"], ["fold", "fold"]] as const) {
      const table = { ...action, recentActions: action.recentActions.map(a => ({ ...a, action: kind })) }
      expect(pokerSoundCues(soundTable, table, "owner").some(c => c.sound === sound)).toBe(true)
    }
  })

  it("只在本人可操作的新轮次提示，不给旁观或 AI 提示", () => {
    const next = { ...soundTable, actionOnSeat: 0 }
    expect(pokerSoundCues(soundTable, next, "owner").some(c => c.sound === "turn")).toBe(true)
    expect(pokerSoundCues(soundTable, next, "public")).toEqual([])
    expect(pokerSoundCues(soundTable, { ...next, controller: "ai" }, "owner")).toEqual([])
  })

  it("结算按实际派彩响一次，重复快照与纯退款没有中奖声", () => {
    const settlement = {
      handId: "h1", handNo: 1, board: [], rules: { variant: "standard52" as const, smallBlind: 1, bigBlind: 2 },
      mixedControl: false, seats: [],
      pots: [{ amount: 32, eligible: [0, 1], winners: [0], shares: { 0: 32 }, refund: false }],
    }
    const next = { ...soundTable, street: "settled", settlement }
    expect(pokerSoundCues(soundTable, next, "owner").filter(c => c.sound.startsWith("coin"))).toHaveLength(5)
    expect(pokerSoundCues(next, { ...next }, "owner")).toEqual([])
    const refund = { ...next, settlement: { ...settlement, pots: settlement.pots.map(p => ({ ...p, refund: true })) } }
    expect(pokerSoundCues(soundTable, refund, "owner").some(c => c.sound.startsWith("coin"))).toBe(false)
  })

  it("过旧或跨房间快照不补播，跨多手只建立新基线", () => {
    expect(pokerSoundCues(wager(8), soundTable, "owner")).toEqual([])
    expect(pokerSoundCues(soundTable, { ...wager(8), roomCode: "5678" }, "owner")).toEqual([])
    expect(pokerSoundCues(soundTable, { ...wager(8), handId: "h9", handNo: 9 }, "owner")).toEqual([])
    expect(pokerSoundCues(soundTable, { ...wager(8), status: "closed" }, "owner")).toEqual([])
  })
})
