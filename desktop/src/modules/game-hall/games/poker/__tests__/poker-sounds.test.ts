import { describe, expect, it } from "vitest"
import { pokerSoundCues } from "../lib/poker-sounds"
import { soundTable, wager } from "./sound-fixture"

describe("德扑声音反馈", () => {
  it("小额按一元一筹码，大额合并面额并限制次数，轮询不重播", () => {
    expect(pokerSoundCues(soundTable, { ...soundTable }, "owner")).toEqual([])
    for (const [amount, count] of [[1, 1], [2, 2], [5, 5], [10, 10], [12, 12], [100, 10], [1_000_000, 10]]) {
      const cues = pokerSoundCues(soundTable, wager(amount), "owner")
      expect(cues, `金额 ${amount}`).toHaveLength(count)
      expect(cues.every(c => c.sound === "coin1" || c.sound === "coin2")).toBe(true)
      expect(cues.every(c => c.volume === 0.5)).toBe(true)
    }
    expect(pokerSoundCues({ ...soundTable, bigBlind: 20 }, { ...wager(5), bigBlind: 20 }, "owner")).toHaveLength(5)
    const large = pokerSoundCues(soundTable, wager(1_000_000), "owner")
    expect(Math.max(...large.map(c => c.delay))).toBeLessThan(700)
    expect(pokerSoundCues(wager(16), { ...wager(16) }, "owner")).toEqual([])
  })

  it("金额越大碰撞节奏稍快，最快间隔有上限", () => {
    const interval = (amount: number) => {
      const cues = pokerSoundCues(soundTable, wager(amount), "owner")
      return cues[1].delay - cues[0].delay
    }
    expect(interval(5)).toBeGreaterThan(interval(10))
    expect(interval(10)).toBeGreaterThan(interval(100))
    expect(interval(100)).toBeGreaterThan(interval(1000))
    expect(interval(1000)).toBe(55)
    expect(interval(1_000_000)).toBe(55)
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

  it("翻三张牌清晰响三次，转牌河牌各一次，重复快照不多响", () => {
    const flop = { ...soundTable, street: "flop", board: ["As", "Kh", "7c"] }
    const turn = { ...flop, street: "turn", board: [...flop.board, "8d"] }
    const river = { ...turn, street: "river", board: [...turn.board, "9s"] }
    const cards = pokerSoundCues(soundTable, flop, "owner").filter(c => c.sound === "card")
    expect(cards).toHaveLength(3)
    expect(cards[1].delay - cards[0].delay).toBe(120)
    expect(cards[2].delay - cards[1].delay).toBe(120)
    expect(pokerSoundCues(flop, turn, "owner").filter(c => c.sound === "card")).toHaveLength(1)
    expect(pokerSoundCues(turn, river, "owner").filter(c => c.sound === "card")).toHaveLength(1)
    expect(pokerSoundCues(river, { ...river }, "owner")).toEqual([])
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
    expect(pokerSoundCues(soundTable, next, "owner").filter(c => c.sound.startsWith("coin"))).toHaveLength(7)
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
