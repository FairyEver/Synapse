import { z } from "zod"

const integer = { type: "integer", minimum: 0, maximum: 2147483647 } as const
const text = { type: "string", minLength: 1, maxLength: 200 } as const
const common = {
  roomCode: { type: "string", pattern: "^[0-9]{4,6}$" }, handId: text,
  street: { type: "string", enum: ["preflop", "flop", "turn", "river"] }, expectedActionSeq: integer, controlVersion: integer,
  actionId: { type: "string", format: "uuid", maxLength: 36 }, expectedPaymentVersion: text,
}
const playProperties = { ...common, instanceId: text, selections: { type: "object", maxProperties: 8, additionalProperties: { anyOf: [text, integer] } } }
const chooseProperties = { ...common, choiceId: text, candidateIndex: { type: "integer", minimum: 0, maximum: 2 } }
export const POKER_CARD_PLAY_SCHEMA = { type: "object", properties: playProperties, required: Object.keys(playProperties), additionalProperties: false }
export const POKER_CARD_CHOOSE_SCHEMA = { type: "object", properties: chooseProperties, required: Object.keys(chooseProperties), additionalProperties: false }
const amount = z.number().int().nonnegative()
export const pokerPaymentSchema = z.object({ nominalAmount: amount, waivedAmount: amount, paidAmount: amount, version: z.string().min(1) }).strict().refine(v => v.nominalAmount === v.waivedAmount + v.paidAmount)
const definition = z.object({ id: z.string(), name: z.string(), description: z.string(), artId: z.string(), cost: amount }).strict()
export const pokerCardStatusSchema = z.object({ id: z.string(), cardId: z.string(), title: z.string(), polarity: z.enum(["positive", "negative", "neutral"]), seatNo: amount.optional(), remaining: amount.optional(), expiresAt: amount.optional(), expiresStreet: z.string().optional(), dispellable: z.boolean() }).strict()
export const pokerCardViewSchema = z.object({
  enabled: z.boolean(), version: z.literal("cards-v1"),
  definitions: z.record(z.string(), definition).optional(),
  ownHand: z.array(z.object({ instanceId: z.string(), cardId: z.string(), available: z.boolean(), reason: z.string().optional(), payment: pokerPaymentSchema,
    choices: z.array(z.object({ key: z.string(), label: z.string(), kind: z.enum(["hole", "player", "ability", "status", "color"]), options: z.array(z.object({ value: z.string(), label: z.string() }).strict()) }).strict()),
  }).strict()).max(1024).optional(),
  pending: z.object({ choiceId: z.string(), kind: z.enum(["poker", "ability"]), origin: z.enum(["roll", "card"]), paymentVersion: z.string(), sourceCardId: z.string().optional(), cardIndex: z.number().int().min(0).max(1).optional(), candidates: z.array(z.string()).min(1).max(3), candidateCards: z.array(definition).max(3).optional() }).strict().nullable().optional(),
  used: z.array(z.object({ id: z.string(), cardId: z.string(), name: z.string(), seatNo: amount, seq: amount, status: z.enum(["completed", "blocked", "choice_required"]) }).strict()),
  statuses: z.array(pokerCardStatusSchema),
  privateResults: z.array(z.object({ id: z.string(), cardId: z.string(), label: z.string(), values: z.array(z.string()), valid: z.boolean() }).strict()).optional(),
}).strict()
export const pokerCardResultSchema = z.object({ ok: z.literal(true), handId: z.string(), actionSeq: amount, cursor: z.string(), status: z.enum(["completed", "choice_required", "blocked"]) }).strict()
export const pokerResolutionFrameSchema = z.object({ id: z.string(), handId: z.string(), seq: amount, events: z.array(z.object({ index: amount, type: z.string(), actorSeatNo: amount.optional(), targetSeatNo: amount.optional(), cardId: z.string().optional(), amount: amount.optional(), nominalAmount: amount.optional(), waivedAmount: amount.optional(), status: z.string().optional(), cards: z.array(z.string()).optional(), color: z.enum(["red", "black"]).optional(), matched: z.boolean().optional(), count: amount.optional() }).strict()).max(1024) }).strict()
export const pokerReserveViewSchema = z.object({
  handId: z.string(), status: z.enum(["pending", "released", "cancelled"]), total: amount, complete: z.boolean(),
  players: z.array(z.object({ key: z.string(), seatNo: amount, displayName: z.string(), isMe: z.boolean(), pending: amount }).strict()).max(10),
  lots: z.array(z.object({ id: z.string(), payerKey: z.string(), sourceType: z.string(), originalAmount: amount, remainingAmount: amount, shares: z.array(z.object({ key: z.string(), originalAmount: amount, remainingAmount: amount }).strict()) }).strict()).max(1000),
  movements: z.array(z.object({ id: z.string(), seq: amount, kind: z.enum(["deposit", "steal", "refund", "finalize"]), amount, lotId: z.string(), actorKey: z.string().optional(), recipientKey: z.string().optional(), beneficiaryKey: z.string().optional() }).strict()).max(1000),
}).strict()
