import { z } from "zod"
import { type PokerCardChooseInput, type PokerCardPlayInput } from "@synapse/shared/game-contracts"
import { POKER_CARD_PLAY_SCHEMA, POKER_CARD_CHOOSE_SCHEMA } from "@synapse/shared/game-ui"

export type CardIntent = { operation: "play"; input: PokerCardPlayInput } | { operation: "choose"; input: PokerCardChooseInput }
export type CardIntentScope = { identityKey: string; roomCode: string }
type Snapshot = { intent: CardIntent | null; error: string | null }
const EMPTY: Snapshot = { intent: null, error: null }
const snapshots = new Map<string, Snapshot>()
const listeners = new Map<string, Set<() => void>>()
const scopeKey = (scope: CardIntentScope) => `synapse.game.poker-card-intent.v1:${JSON.stringify([scope.identityKey,scope.roomCode])}`
const envelopeSchema = z.strictObject({ version:z.literal(1), identityKey:z.string().min(1), roomCode:z.string().min(1), intent:z.strictObject({operation:z.enum(["play","choose"]),input:z.unknown()}) })
const schemas = { play: z.fromJSONSchema(POKER_CARD_PLAY_SCHEMA as Parameters<typeof z.fromJSONSchema>[0]), choose: z.fromJSONSchema(POKER_CARD_CHOOSE_SCHEMA as Parameters<typeof z.fromJSONSchema>[0]) }
const equal = (a: CardIntent | null, b: CardIntent) => !!a && JSON.stringify(a) === JSON.stringify(b)
function validate(raw: unknown, scope: CardIntentScope): CardIntent {
  const envelope=envelopeSchema.parse(raw)
  if(envelope.identityKey!==scope.identityKey || envelope.roomCode!==scope.roomCode) throw new Error("Card scope mismatch")
  const input=schemas[envelope.intent.operation].parse(envelope.intent.input) as unknown as PokerCardPlayInput | PokerCardChooseInput
  if(input.roomCode!==scope.roomCode) throw new Error("Card room mismatch")
  return {operation:envelope.intent.operation,input} as CardIntent
}
function read(scope: CardIntentScope): Snapshot {
  try {
    const raw=sessionStorage.getItem(scopeKey(scope))
    if(raw===null) return EMPTY
    try { return {intent:validate(JSON.parse(raw),scope),error:null} }
    catch { return {intent:null,error:"卡牌恢复记录无效，请先核对牌桌；未发送新卡牌请求"} }
  } catch { return {intent:null,error:"无法读取卡牌恢复记录，请允许会话存储后重试"} }
}
function publish(scope: CardIntentScope, snapshot: Snapshot) {
  const key=scopeKey(scope)
  snapshots.set(key,snapshot)
  for(const listener of listeners.get(key)??[]) listener()
}
// sessionStorage survives hard reloads in this tab. It does not promise closed-tab retention.
export const cardIntentStore = {
  getSnapshot(scope: CardIntentScope): Snapshot {
    const key=scopeKey(scope)
    if(!snapshots.has(key)) snapshots.set(key,read(scope))
    return snapshots.get(key)!
  },
  subscribe(scope: CardIntentScope, listener: () => void) {
    const key=scopeKey(scope), scoped=listeners.get(key)??new Set<()=>void>()
    scoped.add(listener);listeners.set(key,scoped)
    return ()=>{scoped.delete(listener);if(!scoped.size)listeners.delete(key)}
  },
  reload(scope: CardIntentScope) { const snapshot=read(scope);publish(scope,snapshot);return snapshot },
  save(scope: CardIntentScope, intent: CardIntent) {
    const previous=this.getSnapshot(scope)
    if(previous.error || previous.intent && !equal(previous.intent,intent)) throw new Error("已有卡牌恢复记录待核对，未发送新请求")
    const envelope={version:1,identityKey:scope.identityKey,roomCode:scope.roomCode,intent}
    validate(envelope,scope)
    try {
      const serialized=JSON.stringify(envelope),key=scopeKey(scope)
      sessionStorage.setItem(key,serialized)
      if(sessionStorage.getItem(key)!==serialized) throw new Error("Card intent write not retained")
    } catch {
      const error="无法保存卡牌恢复记录，未发送请求；请允许会话存储后重试"
      publish(scope,{intent:null,error})
      throw new Error(error)
    }
    publish(scope,{intent,error:null})
  },
  clear(scope: CardIntentScope, expected: CardIntent) {
    if(!equal(this.getSnapshot(scope).intent,expected)) return
    try {
      sessionStorage.removeItem(scopeKey(scope))
      if(sessionStorage.getItem(scopeKey(scope))!==null) throw new Error("Card intent removal not retained")
      publish(scope,EMPTY)
    } catch {
      publish(scope,{intent:expected,error:"卡牌结果已确认，但恢复记录清理失败，请重试核对原请求"})
    }
  },
}
