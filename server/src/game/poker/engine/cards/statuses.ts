import { z } from "zod"
import type { HandState } from "../hand-runner"
import type { ChipPaymentModifier } from "../chips/types"
import type { OperationRegistry } from "./registry"
import { CardRuleError, type EffectInstance, type LifecycleEvent, type OperationApi } from "./types"
import { applyDeadlineOperation } from "./deadlines"

export const STATUS_KINDS = ["waiver", "reserve_echo", "hole_guard", "info_guard", "theft_guard", "reflect", "counter", "surcharge", "wait_draw", "shrink", "slow_field", "refill_field", "tide_field", "double_draw", "reserve_seal", "reveal_field"] as const
const ordered = (h: HandState, kind: string, seatNo?: number) => h.cards!.effects.filter(e => e.kind === kind && (seatNo === undefined || e.ownerSeatNo === seatNo) && (e.remaining === null || e.remaining > 0))
  .sort((a, b) => a.installedSeq - b.installedSeq || a.id.localeCompare(b.id))
export function paymentModifiers(h: HandState, seatNo: number): ChipPaymentModifier[] {
  return h.cards ? ordered(h, "waiver", seatNo).map(e => ({ id: e.id, kind: "waiver", cap: Number(e.data.cap) })) : []
}
export function cardSurcharges(h: HandState, seatNo: number, ignore = false): { amount: number; effectIds: string[] } {
  const effects = ignore || !h.cards ? [] : ordered(h, "surcharge", seatNo)
  return { amount: effects.reduce((n, e) => n + Number(e.data.amount ?? 0), 0), effectIds: effects.map(e => e.id) }
}
export function consumeEffects(h: HandState, ids: readonly string[]): void {
  for (const effect of h.cards!.effects) if (ids.includes(effect.id) && effect.remaining !== null) effect.remaining--
  h.cards!.effects = h.cards!.effects.filter(e => e.remaining === null || e.remaining > 0)
}
function dispelTarget(h: HandState, id: string) {
  const effect = h.cards!.effects.find(e => e.id === id)
  if (effect) return { seatNo: effect.targetSeatNo, polarity: effect.polarity, effect }
  const marker = h.cards!.publicMarkers?.find(m => m.id === id)
  const holder = marker && h.seats.find(s => s.hole.includes(marker.card))
  if (marker && holder) return { seatNo: holder.seatNo, polarity: "negative" as const, marker }
  return undefined
}
function targetSeat(h: HandState, event: LifecycleEvent): number | undefined {
  if (event.type === "ability.dispel") return dispelTarget(h, String(event.data.effectId))?.seatNo
  if (typeof event.data.targetSeatNo === "number") return event.data.targetSeatNo
  if (typeof event.data.seatNo === "number") return event.data.seatNo
  return undefined
}
function observer(event: LifecycleEvent): number | null {
  return typeof event.data.observerSeatNo === "number" ? event.data.observerSeatNo : event.actorSeatNo
}
function draw(api: OperationApi, effect: EffectInstance) {
  api.enqueue({ type: "ability.draw", input: { admissionId: effect.ownerAdmissionId, count: 1, reason: "trigger" }, cardId: effect.cardId })
}
export function registerCardStatusOperations(registry: OperationRegistry<HandState>): void {
  registry.register({ id: "ability.install", schema: z.object({ kind: z.enum(STATUS_KINDS), targetSeatNo: z.number().int().min(0).max(9).optional(), polarity: z.enum(["positive", "negative", "neutral"]), remaining: z.number().int().positive().nullable().optional(), field: z.boolean().optional(), expiresStreet: z.boolean().optional(), data: z.record(z.string(), z.unknown()).optional(), sourceInstanceId: z.string().optional(), hostile: z.boolean().optional(), singleTarget: z.boolean().optional() }).strict(), apply(h, input, api) {
    const target = input.field ? undefined : input.targetSeatNo ?? api.context.actorSeatNo!
    const owner = h.cards!.participants.find(p => p.seatNo === (target ?? api.context.actorSeatNo))
    if (!owner) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
    if (input.field || input.kind === "shrink") h.cards!.effects = h.cards!.effects.filter(e => e.kind !== input.kind || !input.field && e.ownerSeatNo !== target)
    const effect: EffectInstance = { id: api.context.nextId(), kind: input.kind, cardId: api.operation.cardId ?? "", sourceInstanceId: input.sourceInstanceId, ownerAdmissionId: owner.admissionId, ownerSeatNo: owner.seatNo,
      ...(target !== undefined ? { targetSeatNo: target } : {}), polarity: input.polarity, remaining: input.remaining === undefined ? null : input.remaining, dispellable: true, installedSeq: api.context.actionSeq,
      ...(input.expiresStreet ? { expiresStreet: h.street } : {}), data: structuredClone(input.data ?? {}) }
    h.cards!.effects.push(effect)
    api.emit("ability.statusInstalled", { id: effect.id, kind: effect.kind, targetSeatNo: target }, "public")
  } })
  registry.register({ id: "ability.dispel", schema: z.object({ effectId: z.string(), cleanse: z.boolean().optional(), hostile: z.boolean().optional(), singleTarget: z.boolean().optional() }).strict(), apply(h, input, api) {
    const target = dispelTarget(h, input.effectId)
    if (!target || !(target.effect?.dispellable ?? target.marker?.dispellable) || input.cleanse && (target.seatNo !== api.context.actorSeatNo || target.polarity !== "negative")) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
    if (target.effect?.kind === "shrink" && h.turnClock?.reductions[target.effect.id]) h.turnClock = applyDeadlineOperation(h.turnClock, { kind: "restore", effectId: target.effect.id }, api.context.nowMs)
    h.cards!.effects = h.cards!.effects.filter(e => e.id !== input.effectId)
    h.cards!.publicMarkers = (h.cards!.publicMarkers ?? []).filter(m => m.id !== input.effectId && m.parentEffectId !== input.effectId)
    api.emit("ability.statusRemoved", { id: input.effectId }, "public")
  } })
  registry.register({ id: "ability.consumeEffects", schema: z.object({ ids: z.array(z.string()) }).strict(), apply(h, input) { consumeEffects(h, input.ids) } })
  registry.register({ id: "ability.clearStatuses", schema: z.object({}).strict(), apply(h) { h.cards!.effects = []; h.cards!.publicMarkers = []; h.turnClock = null } })
  registry.register({ id: "ability.streetEnded", schema: z.object({ street: z.string() }).strict(), apply(h, input) {
    h.cards!.effects = h.cards!.effects.filter(e => e.expiresStreet !== input.street)
    h.cards!.publicMarkers = (h.cards!.publicMarkers ?? []).filter(m => m.expiresStreet !== input.street)
  } })
  registry.register({ id: "ability.turnStarted", schema: z.object({ seatNo: z.number().int(), turnId: z.string() }).strict(), apply(h, input, api) {
    const shrink = ordered(h, "shrink", input.seatNo).filter(e => !e.data.appliedTurnId)
    for (const e of shrink) e.data.appliedTurnId = input.turnId
    h.cards!.effects = h.cards!.effects.filter(e => e.kind !== "wait_draw" || e.ownerSeatNo !== input.seatNo)
    h.turnClock = applyDeadlineOperation(null, { kind: "start", seatNo: input.seatNo, turnId: input.turnId, bonusMs: ordered(h, "slow_field").length ? 60000 : 0,
      reductions: shrink.map(e => ({ id: e.id, milliseconds: 300000 })) }, api.context.nowMs)
    api.emit("turn.started", { seatNo: input.seatNo, turnId: input.turnId }, "public")
  } })
  registry.register({ id: "ability.turnEnded", schema: z.object({ seatNo: z.number().int(), turnId: z.string() }).strict(), apply(h, input) {
    h.cards!.effects = h.cards!.effects.filter(e => e.kind !== "shrink" || e.ownerSeatNo !== input.seatNo || e.data.appliedTurnId !== input.turnId)
    if (h.turnClock?.turnId === input.turnId) h.turnClock = null
  } })
  registry.register({ id: "clock.change", schema: z.discriminatedUnion("kind", [z.object({ kind: z.literal("double") }).strict(), z.object({ kind: z.literal("extend"), milliseconds: z.number().int().nonnegative() }).strict()]), apply(h, input, api) {
    if (h.turnClock?.seatNo !== api.context.actorSeatNo) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
    h.turnClock = applyDeadlineOperation(h.turnClock, input, api.context.nowMs)
  } })
  registry.register({ id: "ability.played", schema: z.object({ admissionId: z.string(), seatNo: z.number().int() }).strict(), apply(_h, _input) {} })
  registry.registerHook({ kind: "counter", event: "*", phase: "before", priority: 0, apply(h, effect, event, api) {
    const target = targetSeat(h, event)
    const hostileDispel = event.type === "ability.dispel" && dispelTarget(h, String(event.data.effectId))?.polarity === "positive"
    if (event.actorSeatNo === effect.ownerSeatNo || target !== effect.ownerSeatNo || !(hostileDispel || event.data.hostile === true && event.data.singleTarget === true)) return false
    api.block(); return true
  } })
  registry.registerHook({ kind: "hole_guard", event: "*", phase: "before", priority: 10, apply(h, effect, event, api) {
    if (event.actorSeatNo === effect.ownerSeatNo || !h.seats.some(s => s.seatNo === effect.ownerSeatNo && !s.folded)) return false
    if (event.type === "poker.shuffleHoles") {
      const excluded = (event.data.excludedSeatNos as number[] | undefined) ?? []
      if (excluded.includes(effect.ownerSeatNo)) return false
      api.replaceInput({ ...event.data, excludedSeatNos: [...excluded, effect.ownerSeatNo] }); return true
    }
    if (!["poker.exchange", "poker.replace", "poker.reset"].includes(event.type) || targetSeat(h, event) !== effect.ownerSeatNo) return false
    api.block(); return true
  } })
  for (const kind of ["info_guard", "reflect"] as const) registry.registerHook({ kind, event: "*", phase: "before", priority: 10, apply(h, effect, event, api) {
    const privatePeek = event.type === "poker.peek" && ["one", "two", "suit", "rank"].includes(String(event.data.mode))
    const information = privatePeek || event.type === "poker.reveal" || event.type === "poker.guess"
    if (!information || targetSeat(h, event) !== effect.ownerSeatNo || observer(event) === effect.ownerSeatNo || kind === "reflect" && (!privatePeek || event.data.reflected)) return false
    api.block()
    if (kind === "reflect") api.enqueue({ type: "poker.peek", input: { seatNo: observer(event)!, observerSeatNo: effect.ownerSeatNo, mode: "one", reflected: true }, cardId: effect.cardId })
    return true
  } })
  registry.registerHook({ kind: "reserve_seal", event: "chips.steal", phase: "before", priority: 10, apply(_h, _effect, _event, api) { api.block(); return true } })
  registry.registerHook({ kind: "reserve_echo", event: "chips.deposited", phase: "after", priority: 50, apply(_h, effect, event, api) {
    if (event.data.admissionId !== effect.ownerAdmissionId || !(Number(event.data.amount) > 0)) return false
    draw(api, effect); return true
  } })
  registry.registerHook({ kind: "wait_draw", event: "ability.played", phase: "after", priority: 50, apply(_h, effect, event, api) {
    if (event.data.admissionId === effect.ownerAdmissionId) return false
    draw(api, effect); return true
  } })
  registry.registerHook({ kind: "double_draw", event: "ability.draw", phase: "before", priority: 30, apply(_h, effect, event, api) {
    if (event.data.admissionId !== effect.ownerAdmissionId || event.data.reason !== "card" || !(Number(event.data.count) > 0)) return false
    api.replaceInput({ ...event.data, count: Number(event.data.count) + 1 }); return true
  } })
  registry.registerHook({ kind: "tide_field", event: "ability.played", phase: "after", priority: 50, apply(h, effect, event, api) {
    if (effect.installedSeq === api.context.actionSeq) return false
    const admissionId = String(event.data.admissionId), used = ((h.cards!.tideUsed ??= {})[h.street] ??= [])
    if (used.includes(admissionId)) return false
    used.push(admissionId)
    api.enqueue({ type: "ability.draw", input: { admissionId, count: 1, reason: "trigger" }, cardId: effect.cardId }); return true
  } })
  registry.registerHook({ kind: "refill_field", event: "street.refill", phase: "before", priority: 30, apply(h, _effect, event, api) {
    if (h.cards!.dealtStages.includes(String(event.data.stage))) return false
    api.replaceInput({ ...event.data, extra: Number(event.data.extra ?? 0) + 1 }); return true
  } })
}
