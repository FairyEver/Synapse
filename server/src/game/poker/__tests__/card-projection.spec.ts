import { describe, expect, it } from "vitest"
import { projectCardView, projectResolutionFrame, type CardViewPolicy } from "../poker-card-projection"
import { projectReserveView } from "../poker-reserve-projection"
import { makeCardHand, cardContext } from "./card-test-fixtures"
import { CARD_CATALOG_V1 } from "../engine/cards/catalog-v1"
import { applyCardPoolOperation } from "../engine/cards/pool"
import type { ResolutionFrame } from "../engine/cards/types"
import type { ReserveState } from "../engine/chips/types"
import { canSeeHole, publicHandResult } from "../poker-projection"

const policy = (extra: Partial<CardViewPolicy> = {}): CardViewPolicy => ({ audience: "desktop", perspective: "owner", handId: "test-hand", actionSeq: 1, nowMs: 0, self: { userId: "user-0", admissionId: "admission-0", seatNo: 0, controlVersion: 1 }, ...extra })
function fixture() {
  const h = makeCardHand({ definitions: CARD_CATALOG_V1 })
  h.cards = applyCardPoolOperation(h.cards!, { kind: "deal", stage: "initial", dealerSeat: 0 }, cardContext()).state
  h.cards.privateResults = [{ id: "secret0", ownerAdmissionId: "admission-0", cardId: "13", label: "one", values: ["As"], valid: true }, { id: "secret1", ownerAdmissionId: "admission-1", cardId: "14", label: "two", values: ["Kh", "Qd"], valid: true }]
  h.turnClock = { seatNo: 0, turnId: "t", startedAt: 0, deadlineAt: 600000, reductions: {} }
  return h
}
describe("卡牌隐私白名单", () => {
  it("材料用途来自实际配方且只随本人定义投影，旧定义仍兼容", () => {
    const h = fixture(), cards = h.cards!
    cards.hands["admission-0"] = ["24", "29", "01"].map((definitionId, i) => ({ id: `material-${i}`, definitionId }))
    const view = projectCardView(h, policy())!
    expect(view.definitions!["24"]).toHaveProperty("consumeSelected", true)
    expect(view.definitions!["29"]).toHaveProperty("consumeSelected", false)
    expect(view.definitions!["01"]).not.toHaveProperty("consumeSelected")
    expect(projectCardView(h, policy({ audience: "decision" }))).not.toHaveProperty("definitions")
  })
  it("驱散目标区分玩家、全场、剩余次数和当前实体槽位，不暴露暗牌", () => {
    const h = makeCardHand({ definitions: CARD_CATALOG_V1 }), cards = h.cards!
    const index = cards.pool.findIndex(c => c.definitionId === "45"), dispel = cards.pool.splice(index, 1)[0]
    cards.hands["admission-0"] = [dispel]
    cards.effects = [
      { id: "own-shield", kind: "info_guard", cardId: "43", ownerAdmissionId: "admission-0", ownerSeatNo: 0, targetSeatNo: 0, polarity: "positive", remaining: 1, installedSeq: 0, dispellable: true, data: {} },
      ...[1, 2, 1].map((remaining, i) => ({ id: `other-shield-${i}`, kind: "info_guard", cardId: "43", ownerAdmissionId: "admission-1", ownerSeatNo: 1, targetSeatNo: 1, polarity: "positive" as const, remaining, installedSeq: i, dispellable: true, data: {} })),
      { id: "field", kind: "reveal_field", cardId: "60", ownerAdmissionId: "admission-1", ownerSeatNo: 1, polarity: "neutral", remaining: null, installedSeq: 0, dispellable: true, data: {} },
    ]
    const marked = h.seats[1].hole[0]
    cards.publicMarkers = [{ id: "marker-a", cardId: "60", card: marked, ownerAdmissionId: "admission-1", dispellable: true }, { id: "marker-b", cardId: "60", card: h.seats[1].hole[1], ownerAdmissionId: "admission-1", dispellable: true }]
    const options = () => projectCardView(h, policy())!.ownHand![0].choices![0].options
    expect(options()).toEqual([
      { value: "own-shield", label: "座位1（本人） · 缄默护罩 · 剩余1次" },
      { value: "other-shield-0", label: "座位2 · 缄默护罩 · 剩余1次 · 第1个" },
      { value: "other-shield-1", label: "座位2 · 缄默护罩 · 剩余2次" },
      { value: "other-shield-2", label: "座位2 · 缄默护罩 · 剩余1次 · 第2个" },
      { value: "field", label: "全场 · 众目睽睽" },
      { value: "marker-a", label: "座位2 · 底牌1 · 众目睽睽" },
      { value: "marker-b", label: "座位2 · 底牌2 · 众目睽睽" },
    ])
    ;[h.seats[0].hole[1], h.seats[1].hole[0]] = [h.seats[1].hole[0], h.seats[0].hole[1]]
    expect(options()).toContainEqual({ value: "marker-a", label: "座位1（本人） · 底牌2 · 众目睽睽" })
    expect(options().some(o => o.label.includes(marked))).toBe(false)
  })
  it("本人探查能力牌附带可读定义，公开视角不含该卡池信息", () => {
    const h = fixture(), ownIds = h.cards!.hands["admission-0"].map(c => c.definitionId), observed = h.cards!.pool.find(c => !ownIds.includes(c.definitionId))!.definitionId
    h.cards!.privateResults.push({ id: "ability-peek", ownerAdmissionId: "admission-0", cardId: "20", label: "能力牌", values: [observed], valid: true })
    expect(projectCardView(h, policy())!.definitions![observed]).toMatchObject({ id: observed, name: CARD_CATALOG_V1.find(c => c.id === observed)!.name })
    expect(projectCardView(h, policy({ perspective: "public" }))).not.toHaveProperty("definitions")
  })
  it("卡牌房决策视角不能借本人身份读取暗牌，原始结算审计不返回客户端", () => {
    expect(canSeeHole("u", "u", "human", false, false, true, { audience: "decision", perspective: "owner", everJoined: true, mode: "points", cardMode: true })).toBe(false)
    expect(publicHandResult({ payouts: { 0: 10 }, cardAudit: { hole: ["As"], ownerAdmissionId: "secret" }, reserveAudit: { admissionId: "secret" }, deltas: { 0: 1 } })).toEqual({ payouts: { 0: 10 }, deltas: { 0: 1 } })
  })
  it("owner_public_mcp_matrix：仅核实的本人Web能读持牌、候选与私密记录", () => {
    const h = fixture()
    h.cards = applyCardPoolOperation(h.cards!, { kind: "reserve", admissionId: "admission-0", count: 3, choiceId: "private-choice", street: "preflop", paymentVersion: "q" }, cardContext()).state
    const owner = projectCardView(h, policy())!
    expect(owner.ownHand).toHaveLength(3); expect(owner.pending?.choiceId).toBe("private-choice")
    expect(owner.privateResults).toMatchObject([{ id: "secret0", values: ["As"] }])
    expect(owner.definitions![owner.ownHand![0].cardId]).toBeDefined()
    expect(owner.ownHand![0]).not.toHaveProperty("card")
    for (const p of [policy({ perspective: "public" }), policy({ audience: "decision" }), policy({ self: undefined }), policy({ self: { userId: "user-1", admissionId: "admission-0", seatNo: 0, controlVersion: 1 } }), policy({ self: { userId: "user-0", admissionId: "new-at-same-seat", seatNo: 0, controlVersion: 1 } })]) {
      const view = projectCardView(h, p)!
      expect(view).not.toHaveProperty("ownHand"); expect(view).not.toHaveProperty("pending"); expect(view).not.toHaveProperty("privateResults"); expect(view).not.toHaveProperty("definitions")
      expect(JSON.stringify(view)).not.toMatch(/As|Kh|private-choice|admission-/)
    }
  })
  it("discard_is_not_public_play：仅实际施放记录公开，预演不改状态或取随机", () => {
    const h = fixture(), actual = h.cards!.hands["admission-0"][0], discarded = h.cards!.hands["admission-0"][1]
    h.cards = applyCardPoolOperation(h.cards!, { kind: "consume", admissionId: "admission-0", instanceIds: [actual.id, discarded.id] }, cardContext()).state
    h.cards.used.push({ id: "play", cardId: actual.definitionId, instanceId: actual.id, seatNo: 0, seq: 1, status: "completed" })
    const before = structuredClone(h), view = projectCardView(h, policy({ perspective: "public" }))!
    expect(view.used.map(c => c.cardId)).toEqual([actual.definitionId]); expect(JSON.stringify(view)).not.toContain(discarded.id)
    projectCardView(h, policy()); expect(h).toEqual(before)
  })
  it("根帧仅投影已声明的公共事实，不泄漏私密卡面或内部数据", () => {
    const event = (id: string, type: string, audience: "public" | "owner" | "internal", data: Record<string, unknown>) => ({ id, index: Number(id), type, phase: "after" as const, audience, data, actorSeatNo: 0, ownerAdmissionId: "admission-0" })
    const frame: ResolutionFrame = { id: "h:1", handId: "h", seq: 1, rootActionId: "root-secret", events: [
      event("0", "poker.observed", "owner", { values: ["As"] }), event("1", "ability.consume", "internal", { instanceIds: ["discard-secret"] }),
      event("2", "chips.paid", "public", { amount: 0, nominalAmount: 20, waivedAmount: 20, userId: "account-secret", hole: ["Kh"] }),
      event("3", "poker.revealed", "public", { targetSeatNo: 1, cards: ["2s"], deck: ["Qd"] }), event("4", "unexpected", "public", { cards: ["Jc"] }),
    ] }
    const projected = projectResolutionFrame(frame)
    expect(projected.events.map(e => e.type)).toEqual(["chips.paid", "poker.revealed"])
    expect(projected.events[0]).toMatchObject({ amount: 0, nominalAmount: 20, waivedAmount: 20 })
    expect(JSON.stringify(projected)).not.toMatch(/As|Kh|Qd|Jc|root-secret|account-secret|discard-secret|admission/)
    expect(frame.events).toHaveLength(5)
  })
  it("内部阻挡只转成公开的防护反馈，隐藏原操作输入", () => {
    const frame: ResolutionFrame = { id: "guard", handId: "h", seq: 1, rootActionId: "secret-root", events: [{ id: "e", index: 0, type: "ability.resolve", phase: "after", audience: "internal", actorSeatNo: 0, cardId: "01", status: "blocked", data: { targetSeatNo: 1, steps: [{ input: { hole: "As", private: "secret" } }] } }] }
    expect(projectResolutionFrame(frame).events).toEqual([{ index: 0, type: "ability.blocked", actorSeatNo: 0, targetSeatNo: 1, cardId: "01", status: "blocked" }])
  })
  it("暂存详情截断不能把权威总额截断；缺失原入座来源不能显示零", () => {
    const h = fixture(), state: ReserveState = { revision: 1, finalized: false, lots: [], claims: [], movements: [] }
    for (let i = 0; i < 1001; i++) {
      state.lots.push({ id: `l${i}`, sourceId: `s${i}`, sourceType: "roll", sourceSeq: i, payerAdmissionId: "admission-0", payerUserId: "user-0", payerSeatNo: 0, originalAmount: 1, remainingAmount: 1 })
      state.claims.push({ id: `c${i}`, lotId: `l${i}`, admissionId: "admission-1", userId: "user-1", seatNo: 1, originalAmount: 1, remainingAmount: 1, status: "pending" })
      state.movements.push({ id: `m${i}`, rootActionId: `root${i}`, eventIndex: i, kind: "deposit", amount: 1, lotId: `l${i}`, actorAdmissionId: "admission-0" })
    }
    const input = { roomId: "room", handId: "test-hand", status: "running", userId: "user-0", state, participants: h.cards!.participants.map(p => ({ ...p, displayName: p.admissionId })) }
    const view = projectReserveView(input)!
    expect(view.total).toBe(1001); expect(view.complete).toBe(false); expect(view.lots).toHaveLength(1000)
    expect(view.players[1].pending).toBe(1001)
    expect(JSON.stringify(view)).not.toContain('"admissionId"'); expect(view.players[0].key).not.toBe("admission-0")
    expect(projectReserveView({ ...input, state: undefined })).toBeUndefined()
    state.claims[0].admissionId = "missing-original"
    expect(projectReserveView(input)).toBeUndefined()
  })
})
