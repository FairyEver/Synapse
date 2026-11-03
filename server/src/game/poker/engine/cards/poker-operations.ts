import { z } from "zod"
import { shuffle } from "../deck"
import type { HandState } from "../hand-runner"
import { assertHandIntegrity } from "../roll"
import type { OperationRegistry } from "./registry"
import { invalidatePokerObservations, type CardPrivateResult } from "./pool"
import { CardRuleError, type OperationApi } from "./types"
export { invalidatePokerObservations } from "./pool"

const seatNo = z.number().int().min(0).max(9), slot = z.number().int().min(0).max(1)
const metadata = { singleTarget: z.boolean().optional(), hostile: z.boolean().optional() }
function activeSeat(h: HandState, no: number) {
  const seat = h.seats.find(s => s.seatNo === no && !s.folded)
  if (!seat || !h.cards?.participants.some(p => p.seatNo === no)) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
  return seat
}
function noPending(h: HandState) {
  if (h.cards?.pending || h.roll?.pending) throw new CardRuleError("POKER_CARD_CHOICE_REQUIRED")
}
function pick<T>(values: T[], api: OperationApi): T {
  const index = api.context.randomInt(values.length)
  if (!Number.isInteger(index) || index < 0 || index >= values.length) throw new CardRuleError("POKER_CARD_INVALID_ENTROPY")
  return values.splice(index, 1)[0]
}
export function publicHoleCards(h: HandState, no: number): string[] {
  const markers = h.cards?.publicMarkers ?? []
  return h.seats.find(s => s.seatNo === no)?.hole.filter(c => markers.some(m => m.card === c && (!m.expiresStreet || m.expiresStreet === h.street))) ?? []
}
function finishHoleChange(h: HandState, api: OperationApi, player: { seatNo: number; hole: string[] }, previous: readonly string[]) {
  const { seatNo, hole } = player
  for (const result of h.cards!.privateResults) {
    if (result.valid && result.targetSeatNo === seatNo && (result.values[0] !== hole[0] || result.values[1] !== hole[1])) result.valid = false
  }
  const cards = publicHoleCards(h, seatNo).filter(card => !previous.includes(card))
  if (cards.length) api.emit("poker.publicMoved", { targetSeatNo: seatNo, cards }, "public")
}
function observe(h: HandState, api: OperationApi, observer: number, label: string, values: string[], metadata: Pick<CardPrivateResult, "deckRevision" | "targetSeatNo"> = {}) {
  const owner = h.cards!.participants.find(p => p.seatNo === observer)
  if (!owner) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
  const record = { id: api.context.nextId(), ownerAdmissionId: owner.admissionId, cardId: api.operation.cardId ?? "", label, values, valid: true, ...metadata }
  h.cards!.privateResults.push(record)
  api.emit("poker.observed", { label, values }, "owner", undefined, owner.admissionId)
}
export function registerPokerCardOperations(registry: OperationRegistry<HandState>): void {
  registry.register({ id: "poker.replace", schema: z.object({ seatNo, cardIndex: slot.optional(), mode: z.enum(["draw", "candidates", "highest", "red", "black"]), candidateCount: z.union([z.literal(3), z.literal(5)]).optional(), paymentVersion: z.string().optional(), ...metadata }).strict(),
    apply(h, input, api) {
      noPending(h); const p = activeSeat(h, input.seatNo)
      if (input.cardIndex === undefined && input.candidateCount !== 5) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
      const cardIndex = input.cardIndex ?? pick([0, 1], api), old = p.hole[cardIndex]
      const amount = input.mode === "candidates" ? input.candidateCount ?? 3 : input.mode === "highest" ? 2 : 1
      if (input.candidateCount && h.deck.length < amount) throw new CardRuleError("POKER_CARD_DECK_EMPTY")
      const candidates: string[] = []
      for (let n = 0; n < amount && h.deck.length; n++) {
        if (input.mode === "red" || input.mode === "black") {
          const eligible = h.deck.filter(c => "hd".includes(c[1]) === (input.mode === "red"))
          if (!eligible.length) break
          const card = pick(eligible, api); h.deck.splice(h.deck.indexOf(card), 1); candidates.push(card)
        } else candidates.push(pick(h.deck, api))
      }
      if (!candidates.length) {
        if (input.mode === "red" || input.mode === "black") {
          observe(h, api, input.seatNo, "换牌结果", [`牌堆里没有${input.mode === "red" ? "红色" : "黑色"}牌，底牌未换`])
          return
        }
        throw new CardRuleError("POKER_CARD_DECK_EMPTY")
      }
      if (input.mode === "candidates") {
        const owner = h.cards!.participants.find(p => p.seatNo === input.seatNo)!
        h.cards!.pending = { id: api.context.nextId(), kind: "poker", origin: "card", ownerAdmissionId: owner.admissionId, ownerSeatNo: input.seatNo, handId: api.context.handId, street: h.street,
          sourceActionSeq: api.context.actionSeq, sourceCardId: api.operation.cardId, paymentVersion: input.paymentVersion ?? "", candidates, cardIndex }
        if (!input.candidateCount) observe(h, api, input.seatNo, "候选", [...candidates])
      } else {
        const best = input.mode === "highest" ? [...candidates].sort((a, b) => "23456789TJQKA".indexOf(b[0]) - "23456789TJQKA".indexOf(a[0]) || "shdc".indexOf(a[1]) - "shdc".indexOf(b[1]))[0] : candidates[0]
        p.hole[cardIndex] = best
        h.deck = shuffle([...h.deck, old, ...candidates.filter(c => c !== best)], api.context.randomInt)
        api.emit("poker.changed", { change: "replaced", targetSeatNo: p.seatNo, count: 1 }, "public")
        finishHoleChange(h, api, p, [old, p.hole[1 - cardIndex]])
      }
      invalidatePokerObservations(h); assertHandIntegrity(h)
    } })
  registry.register({ id: "poker.reset", schema: z.object({ seatNo, excludeOld: z.boolean().optional(), ...metadata }).strict(), apply(h, input, api) {
    noPending(h); const p = activeSeat(h, input.seatNo)
    const previous = p.hole
    if (input.excludeOld) {
      if (h.deck.length < 2) throw new CardRuleError("POKER_CARD_DECK_EMPTY")
      const replacements = [pick(h.deck, api), pick(h.deck, api)]
      h.deck = shuffle([...h.deck, ...p.hole], api.context.randomInt)
      p.hole = replacements
    } else {
      h.deck = shuffle([...h.deck, ...p.hole], api.context.randomInt)
      p.hole = [pick(h.deck, api), pick(h.deck, api)]
    }
    invalidatePokerObservations(h); assertHandIntegrity(h)
    api.emit("poker.changed", { change: "replaced", targetSeatNo: p.seatNo, count: 2 }, "public")
    finishHoleChange(h, api, p, previous)
  } })
  registry.register({ id: "poker.randomExchange", schema: z.object({ seatNo, cardIndex: slot }).strict(), apply(h, input, api) {
    noPending(h); activeSeat(h, input.seatNo)
    const candidates = h.seats.filter(s => s.seatNo !== input.seatNo && !s.folded)
    if (!candidates.length) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
    api.enqueue({ type: "poker.exchange", input: { ...input, targetSeatNo: pick(candidates, api).seatNo, hostile: true, singleTarget: true }, cardId: api.operation.cardId })
  } })
  registry.register({ id: "poker.exchange", schema: z.object({ seatNo, targetSeatNo: seatNo, cardIndex: slot.optional(), whole: z.boolean().optional(), ...metadata }).strict(), apply(h, input, api) {
    noPending(h); const p = activeSeat(h, input.seatNo), target = activeSeat(h, input.targetSeatNo)
    if (p === target) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
    const previous = [...p.hole], previousTarget = [...target.hole]
    if (input.whole) [p.hole, target.hole] = [target.hole, p.hole]
    else {
      if (input.cardIndex === undefined) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
      const index = pick([0, 1], api)
      ;[p.hole[input.cardIndex], target.hole[index]] = [target.hole[index], p.hole[input.cardIndex]]
    }
    assertHandIntegrity(h)
    api.emit("poker.changed", { change: "exchanged", targetSeatNo: target.seatNo, count: input.whole ? 2 : 1 }, "public")
    finishHoleChange(h, api, p, previous)
    finishHoleChange(h, api, target, previousTarget)
  } })
  registry.register({ id: "poker.shuffleHoles", schema: z.object({ excludedSeatNos: z.array(seatNo).optional() }).strict(), apply(h, input, api) {
    noPending(h); const players = h.seats.filter(s => !s.folded && !input.excludedSeatNos?.includes(s.seatNo))
    if (players.length < 2) { api.emit("ability.blocked", { reason: "insufficient_targets" }, "public"); return }
    const previous = new Map(players.map(player => [player.seatNo, player.hole]))
    const cards = shuffle(players.flatMap(p => p.hole), api.context.randomInt)
    for (const p of players) p.hole = cards.splice(0, 2)
    assertHandIntegrity(h)
    api.emit("poker.shuffled", { targetSeatNos: players.map(player => player.seatNo) }, "public")
    for (const player of players) finishHoleChange(h, api, player, previous.get(player.seatNo)!)
  } })
  registry.register({ id: "poker.peek", schema: z.object({ seatNo, observerSeatNo: seatNo.optional(), mode: z.enum(["next", "stage", "top", "one", "two", "suit", "rank"]), reflected: z.boolean().optional(), ...metadata }).strict(), apply(h, input, api) {
    const p = activeSeat(h, input.seatNo), observer = input.observerSeatNo ?? api.context.actorSeatNo!
    let values: string[], future = false
    if (["next", "stage", "top"].includes(input.mode)) {
      if (input.mode !== "top" && !["preflop", "flop", "turn"].includes(h.street)) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
      const count = input.mode === "stage" && h.street === "preflop" || input.mode === "top" ? 3 : 1
      values = h.deck.slice(input.mode === "top" ? 0 : 1, (input.mode === "top" ? 0 : 1) + count); future = true
    } else {
      values = input.mode === "two" ? [...p.hole] : [pick([...p.hole], api)]
      if (input.mode === "suit") values = values.map(c => c[1])
      if (input.mode === "rank") values = values.map(c => c[0])
    }
    const observation: Pick<CardPrivateResult, "deckRevision" | "targetSeatNo"> = {}
    if (future) observation.deckRevision = h.cards!.deckRevision
    if (h.cards!.version !== "cards-v1" && input.mode === "two" && api.operation.cardId === "14") observation.targetSeatNo = p.seatNo
    observe(h, api, observer, input.mode, values, observation)
  } })
  registry.register({ id: "poker.reveal", schema: z.object({ seatNo, cardIndex: slot.optional(), duration: z.enum(["hand", "street"]), parentEffectId: z.string().optional(), ...metadata }).strict(), apply(h, input, api) {
    const p = activeSeat(h, input.seatNo), card = p.hole[input.cardIndex ?? pick([0, 1], api)]
    ;(h.cards!.publicMarkers ??= []).push({ id: api.context.nextId(), card, cardId: api.operation.cardId ?? "", ownerAdmissionId: api.context.actorAdmissionId ?? "", dispellable: true,
      ...(input.duration === "street" ? { expiresStreet: h.street } : {}), ...(input.parentEffectId ? { parentEffectId: input.parentEffectId } : {}) })
    api.emit("poker.revealed", { targetSeatNo: p.seatNo, cards: [card] }, "public")
  } })
  registry.register({ id: "poker.guess", schema: z.object({ seatNo, cardIndex: slot, color: z.enum(["red", "black"]), ...metadata }).strict(), apply(h, input, api) {
    const p = activeSeat(h, input.seatNo), card = p.hole[input.cardIndex]
    if (p.seatNo === api.context.actorSeatNo || publicHoleCards(h, p.seatNo).includes(card)) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
    const color = "hd".includes(card[1]) ? "red" : "black", matched = input.color === color
    api.emit("poker.guessed", { targetSeatNo: p.seatNo, color, matched }, "public")
    if (matched) api.enqueue({ type: "ability.draw", input: { admissionId: api.context.actorAdmissionId!, count: 1, reason: "card" }, cardId: api.operation.cardId })
  } })
  registry.register({ id: "poker.choose", schema: z.object({ admissionId: z.string(), choiceId: z.string(), index: z.number().int().min(0) }).strict(), apply(h, input, api) {
    const pending = h.cards!.pending
    if (!pending || pending.kind !== "poker" || pending.origin !== "card" || pending.ownerAdmissionId !== input.admissionId || pending.id !== input.choiceId
      || pending.street !== h.street || pending.handId !== api.context.handId || input.index >= pending.candidates.length) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
    const p = activeSeat(h, pending.ownerSeatNo), old = p.hole[pending.cardIndex!]
    p.hole[pending.cardIndex!] = pending.candidates[input.index]
    h.deck = shuffle([...h.deck, old, ...pending.candidates.filter((_, i) => i !== input.index)], api.context.randomInt)
    h.cards!.pending = null
    invalidatePokerObservations(h); assertHandIntegrity(h)
    api.emit("poker.changed", { change: "replaced", targetSeatNo: p.seatNo, count: 1 }, "public")
    finishHoleChange(h, api, p, [old, p.hole[1 - pending.cardIndex!]])
  } })
  registry.register({ id: "poker.swapPositions", schema: z.object({ seatNo }).strict(), apply(h, input, api) {
    noPending(h); const p = activeSeat(h, input.seatNo); p.hole.reverse(); assertHandIntegrity(h)
    api.emit("poker.changed", { change: "reordered", targetSeatNo: p.seatNo, count: 2 }, "public")
    finishHoleChange(h, api, p, p.hole)
  } })
  registry.register({ id: "poker.spark", schema: z.object({}).strict(), apply(_h, _input, api) { api.emit("poker.sparked", {}, "public") } })
}
