import { describe, expect, it } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { pokerSoundCues } from "../lib/poker-sounds"
import { soundTable, wager } from "./sound-fixture"

function winningTable(profit: number, payout = profit + 10): PokerTableView {
  return { ...soundTable, street: "settled", settlement: {
    handId: "h1", handNo: 1, board: [], rules: { variant: "standard52", smallBlind: 1, bigBlind: 2 }, mixedControl: false,
    seats: [{ seatNo: 0, displayName: "本人", participantKind: "human", isMe: true, folded: false, delta: profit, payout, endingStack: 1000 + profit }],
    pots: [{ amount: payout, eligible: [0, 1], winners: [0], shares: { 0: payout }, refund: false }],
  } }
}

describe("德扑声音反馈", () => {
  it("小额按一元一筹码，大额平滑增加次数并限制上限，轮询不重播", () => {
    expect(pokerSoundCues(soundTable, { ...soundTable }, "owner")).toEqual([])
    for (const [amount, count] of [[1, 1], [2, 2], [5, 5], [10, 10], [12, 12], [13, 13], [32, 14], [50, 15], [100, 16], [1_000_000, 16]]) {
      const cues = pokerSoundCues(soundTable, wager(amount), "owner")
      expect(cues, `金额 ${amount}`).toHaveLength(count)
      expect(cues.every(c => c.sound === "coin1" || c.sound === "coin2")).toBe(true)
      expect(cues.every(c => c.volume > 0 && c.volume <= 0.5)).toBe(true)
    }
    expect(pokerSoundCues({ ...soundTable, bigBlind: 20 }, { ...wager(5), bigBlind: 20 }, "owner")).toHaveLength(5)
    const large = pokerSoundCues(soundTable, wager(1_000_000), "owner")
    expect(Math.max(...large.map(c => c.delay))).toBeLessThan(900)
    expect(pokerSoundCues(wager(16), { ...wager(16) }, "owner")).toEqual([])
  })

  it("金额增加不会导致碰撞次数减少，且大额不会无限延长", () => {
    let previousCount = 0
    for (const amount of [1, 5, 10, 12, 13, 20, 25, 32, 50, 60, 61, 100, 120, 121, 500, 1000, 1_000_000]) {
      const cues = pokerSoundCues(soundTable, wager(amount), "owner")
      expect(cues.length, `金额 ${amount}`).toBeGreaterThanOrEqual(previousCount)
      expect(cues.length).toBeLessThanOrEqual(16)
      expect(cues.at(-1)!.delay).toBeLessThan(1100)
      previousCount = cues.length
    }
  })

  it("下注集中成短促一簇，多个碰撞略微错开并控制叠加音量", () => {
    for (const amount of [1, 2, 5, 10, 13, 32, 100, 1000, 1_000_000]) {
      const cues = pokerSoundCues(soundTable, wager(amount), "owner")
      expect(cues[0].delay).toBe(0)
      expect(cues[0].volume).toBe(0.5)
      expect(cues.at(-1)!.delay).toBeLessThanOrEqual(180)
      expect(cues.reduce((sum, cue) => sum + cue.volume, 0) * 0.35).toBeLessThan(1)
      for (let i = 1; i < cues.length; i++) expect(cues[i].delay).toBeGreaterThan(cues[i - 1].delay)
    }
    const cues = pokerSoundCues(soundTable, wager(100), "owner")
    const gaps = cues.slice(1).map((cue, i) => cue.delay - cues[i].delay)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(20)
    expect(new Set(gaps).size).toBeGreaterThan(1)
    expect(cues.at(-1)!.delay).toBeLessThan(200)
  })

  it("新手发牌和盲注有声，翻牌和过牌弃牌有不同反馈", () => {
    const next = { ...soundTable, handId: "h2", handNo: 2 }
    expect(pokerSoundCues(soundTable, next, "owner").some(c => c.sound === "deal")).toBe(true)
    expect(pokerSoundCues(soundTable, { ...next, seats: next.seats.map(s => ({ ...s, status: "allin" })) }, "owner").filter(c => c.sound === "deal")).toHaveLength(4)
    expect(pokerSoundCues(soundTable, next, "owner").filter(c => c.sound === "coin1" || c.sound === "coin2").every(c => c.delay <= 180)).toBe(true)
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
    expect(pokerSoundCues(soundTable, next, "owner").filter(c => c.sound.startsWith("coin"))).toHaveLength(14)
    expect(pokerSoundCues(soundTable, next, "owner").filter(c => c.sound.startsWith("coin")).at(-1)!.delay).toBeGreaterThan(1000)
    expect(pokerSoundCues(next, { ...next }, "owner")).toEqual([])
    const refund = { ...next, settlement: { ...settlement, pots: settlement.pots.map(p => ({ ...p, refund: true })) } }
    expect(pokerSoundCues(soundTable, refund, "owner").some(c => c.sound.startsWith("coin"))).toBe(false)
  })

  it("本人赢池且净盈利时先落袋后金币碰撞，赢得越多越丰富且有上限", () => {
    const small = pokerSoundCues(soundTable, winningTable(5), "owner")
    const medium = pokerSoundCues(soundTable, winningTable(100), "owner")
    const large = pokerSoundCues(soundTable, winningTable(1_000_000), "owner")
    const winCoins = (cues: typeof small) => cues.filter(c => c.sound === "winCoin1" || c.sound === "winCoin2")
    expect(small.filter(c => c.sound === "pocket")).toHaveLength(1)
    expect(winCoins(small)).toHaveLength(2)
    expect(winCoins(medium)).toHaveLength(4)
    expect(winCoins(large)).toHaveLength(6)
    expect(winCoins(small)[0].delay).toBeGreaterThan(small.find(c => c.sound === "pocket")!.delay)
    expect(winCoins(large)[1].delay - winCoins(large)[0].delay).toBeLessThan(winCoins(small)[1].delay - winCoins(small)[0].delay)
    expect(large.every(c => c.volume <= 0.5)).toBe(true)
    expect(Math.max(...large.map(c => c.delay))).toBeLessThan(1300)
    expect(small.some(c => c.sound === "coin1" || c.sound === "coin2")).toBe(false)
    expect(pokerSoundCues(winningTable(5), { ...winningTable(5) }, "owner")).toEqual([])
  })

  it("落袋丰富程度按本人净赢计算，分池合并一次，退款和净亏不冒充中奖", () => {
    const pocketCues = (table: PokerTableView, perspective: "owner" | "public" = "owner") =>
      pokerSoundCues(soundTable, table, perspective).filter(c => c.sound === "pocket" || c.sound === "winCoin1" || c.sound === "winCoin2")
    expect(pocketCues(winningTable(5, 1_000_000))).toEqual(pocketCues(winningTable(5)))
    for (const profit of [0, -5]) expect(pocketCues(winningTable(profit, 20))).toEqual([])
    expect(pocketCues(winningTable(100), "public")).toEqual([])
    const refund = winningTable(5)
    refund.settlement!.pots[0].refund = true
    expect(pocketCues(refund)).toEqual([])
    const other = winningTable(5)
    other.settlement!.seats[0].isMe = false
    expect(pocketCues(other)).toEqual([])
    const split = winningTable(5)
    split.settlement!.pots = [
      { amount: 10, eligible: [0, 1], winners: [0, 1], shares: { 0: 5, 1: 5 }, refund: false },
      { amount: 10, eligible: [0], winners: [0], shares: { 0: 10 }, refund: false },
    ]
    expect(pocketCues(split)).toEqual(pocketCues(winningTable(5)))
  })

  it("过旧或跨房间快照不补播，跨多手只建立新基线", () => {
    expect(pokerSoundCues(wager(8), soundTable, "owner")).toEqual([])
    expect(pokerSoundCues(soundTable, { ...wager(8), roomCode: "5678" }, "owner")).toEqual([])
    expect(pokerSoundCues(soundTable, { ...wager(8), handId: "h9", handNo: 9 }, "owner")).toEqual([])
    expect(pokerSoundCues(soundTable, { ...wager(8), status: "closed" }, "owner")).toEqual([])
  })
})
