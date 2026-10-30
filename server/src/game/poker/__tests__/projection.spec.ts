import { describe, expect, it } from "vitest"
import { canSeeHole, projectSettlement, type PokerViewPolicy } from "../poker-projection"
const policy = (input: Partial<PokerViewPolicy> = {}): PokerViewPolicy => ({ audience: "desktop", perspective: "public", everJoined: false, mode: "points", ...input })
describe("旁观与决策可见性", () => {
  it("从未入座桌面旁观全明，决策永不接收教学明牌", () => {
    expect(canSeeHole("viewer", "other", "human", true, false, false, policy())).toBe(true)
    expect(canSeeHole("viewer", "other", "human", false, false, false, policy({ audience: "decision" }))).toBe(false)
  })
  it("曾入座账号离桌后点数房仍遮牌，练习房只给机器人明牌", () => {
    expect(canSeeHole("viewer", "other", "human", false, false, false, policy({ everJoined: true }))).toBe(false)
    expect(canSeeHole("viewer", "bot", "bot", true, false, false, policy({ everJoined: true, mode: "practice" }))).toBe(true)
    expect(canSeeHole("viewer", "other", "human", false, false, false, policy({ everJoined: true, mode: "practice" }))).toBe(false)
  })
  it("玩家只看本人或自己参与手的未弃牌摊牌，教学不进入owner", () => {
    const p = policy({ perspective: "owner" })
    expect(canSeeHole("viewer", "viewer", "human", true, false, true, p)).toBe(true)
    expect(canSeeHole("viewer", "other", "human", false, false, true, p)).toBe(false)
    expect(canSeeHole("viewer", "other", "human", false, true, true, p)).toBe(true)
    expect(canSeeHole("viewer", "other", "human", true, true, true, p)).toBe(false)
    expect(canSeeHole("viewer", "other", "human", false, true, false, p)).toBe(false)
  })
})
function fixture() {
  const hand: any = { id: "h", handNo: 1, status: "settled", board: ["Ks", "Kd", "As", "8s", "9s"], showdownSeats: [0, 1], rules: { variant: "short32", smallBlind: 5, bigBlind: 10 }, result: { payouts: { 0: 200 }, pots: [{ amount: 200, eligible: [0, 1], winners: [0], shares: { 0: 200 }, refund: false }], deltas: { 0: 100, 1: -100 } } }
  const seats: any[] = [{ seatNo: 0, userId: "me", participantKind: "human", displayName: "甲", startingStack: 100, endingStack: 200, folded: false, holeCards: ["Ts", "Js"] }, { seatNo: 1, userId: "other", participantKind: "human", displayName: "乙", startingStack: 100, endingStack: 0, folded: false, holeCards: ["Kh", "Ac"] }]
  const actions: any[] = [{ userId: "me", seatNo: 0, actionSource: "human", note: "机密" }, { userId: "me", seatNo: 0, actionSource: "mcp", personaVersionId: "secret" }]
  return { hand, seats, actions }
}
describe("结算白名单投影", () => {
  it("结果保留规则、净盈亏、主边池及来源混打标识，摊牌显示规则中文牌型", () => {
    const f = fixture(), v = projectSettlement(f.hand, f.seats, f.actions, "me", policy({ perspective: "owner", everJoined: true }))!
    expect(v.rules.variant).toBe("short32")
    expect(v.seats[0]).toMatchObject({ handName: "同花", delta: 100, payout: 200, isMe: true })
    expect(v.seats[1].handName).toBe("葫芦")
    expect(v.pots[0]).toMatchObject({ winners: [0], shares: { 0: 200 } })
    expect(v.mixedControl).toBe(true)
    expect(JSON.stringify(v)).not.toContain("userId")
    expect(JSON.stringify(v)).not.toContain("机密")
    expect(JSON.stringify(v)).not.toContain("secret")
  })
  it("弃牌暗牌的牌型也不泄露，离桌身份按参与者快照而非座位编号", () => {
    const f = fixture(); f.seats[1].folded = true
    const v = projectSettlement(f.hand, f.seats, f.actions, "new-at-same-seat", policy({ perspective: "owner", everJoined: true }))!
    expect(v.seats.every((s) => !s.isMe && s.hole === undefined && s.handName === undefined)).toBe(true)
  })
  it("旧归档缺规则和分池winner数据可投影，未结算不伪造结果", () => {
    const f = fixture(); delete f.hand.rules; delete f.hand.result.deltas; delete f.hand.result.pots[0].winners; delete f.hand.result.pots[0].shares
    const v = projectSettlement(f.hand, f.seats, [], "me", policy({ perspective: "owner" }))!
    expect(v.rules).toEqual({ variant: "standard52", smallBlind: 1, bigBlind: 2 })
    expect(v.seats[0].delta).toBe(100)
    expect(projectSettlement({ ...f.hand, status: "running" }, f.seats, [], "me", policy())).toBeNull()
  })
})

it("不同选手分别真人和MCP不标混打，必须同一身份同一座位的来源切换", () => {
  const f = fixture()
  f.actions[1].userId = "other"; f.actions[1].seatNo = 1
  expect(projectSettlement(f.hand, f.seats, f.actions, "me", policy())!.mixedControl).toBe(false)
  f.actions[1].userId = "me"
  expect(projectSettlement(f.hand, f.seats, f.actions, "me", policy())!.mixedControl).toBe(false)
  f.actions[1].seatNo = 0
  expect(projectSettlement(f.hand, f.seats, f.actions, "me", policy())!.mixedControl).toBe(true)
  f.actions[1].actionSource = null; f.actions[1].isAuto = true
  expect(projectSettlement(f.hand, f.seats, f.actions, "me", policy())!.mixedControl).toBe(false)
  f.actions[1].isAuto = false
  expect(projectSettlement(f.hand, f.seats, f.actions, "me", policy())!.mixedControl).toBe(true)
})
