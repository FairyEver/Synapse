import { z } from "zod"
import { GAME_TOOLS, type PokerRollChooseInput, type PokerRollStartInput } from "@synapse/shared/game-contracts"

export type RollIntent = { operation: "start"; input: PokerRollStartInput } | { operation: "choose"; input: PokerRollChooseInput }
export type RollIntentScope = { identityKey: string; roomCode: string }
type Snapshot = { intent: RollIntent | null; error: string | null }
const EMPTY: Snapshot = { intent: null, error: null }
const snapshots = new Map<string, Snapshot>()
const listeners = new Map<string, Set<() => void>>()
const scopeKey = (scope: RollIntentScope) => `synapse.game.poker-roll-intent.v1:${JSON.stringify([scope.identityKey,scope.roomCode])}`
const envelopeSchema = z.strictObject({ version:z.literal(1), identityKey:z.string().min(1), roomCode:z.string().min(1), intent:z.strictObject({operation:z.enum(["start","choose"]),input:z.unknown()}) })
const schemas = Object.fromEntries((["start","choose"] as const).map(operation => [operation,z.fromJSONSchema(GAME_TOOLS.find(tool=>tool.id===`app.game.poker.roll.${operation}`)!.inputSchema as Parameters<typeof z.fromJSONSchema>[0])]))
const equal = (a: RollIntent | null, b: RollIntent) => !!a && JSON.stringify(a) === JSON.stringify(b)
function validate(raw: unknown, scope: RollIntentScope): RollIntent {
  const envelope=envelopeSchema.parse(raw)
  if(envelope.identityKey!==scope.identityKey || envelope.roomCode!==scope.roomCode) throw new Error("Roll scope mismatch")
  const input=schemas[envelope.intent.operation].parse(envelope.intent.input) as unknown as PokerRollStartInput | PokerRollChooseInput
  if(input.roomCode!==scope.roomCode) throw new Error("Roll room mismatch")
  return {operation:envelope.intent.operation,input} as RollIntent
}
function read(scope: RollIntentScope): Snapshot {
  try {
    const raw=sessionStorage.getItem(scopeKey(scope))
    if(raw===null) return EMPTY
    try { return {intent:validate(JSON.parse(raw),scope),error:null} }
    catch { return {intent:null,error:"换牌恢复记录无效，请先核对牌桌；未发送新换牌请求"} }
  } catch { return {intent:null,error:"无法读取换牌恢复记录，请允许会话存储后重试"} }
}
function publish(scope: RollIntentScope, snapshot: Snapshot) {
  const key=scopeKey(scope)
  snapshots.set(key,snapshot)
  for(const listener of listeners.get(key)??[]) listener()
}
// sessionStorage survives hard reloads in this tab. It does not promise closed-tab retention.
export const rollIntentStore = {
  getSnapshot(scope: RollIntentScope): Snapshot {
    const key=scopeKey(scope)
    if(!snapshots.has(key)) snapshots.set(key,read(scope))
    return snapshots.get(key)!
  },
  subscribe(scope: RollIntentScope, listener: () => void) {
    const key=scopeKey(scope), scoped=listeners.get(key)??new Set<()=>void>()
    scoped.add(listener);listeners.set(key,scoped)
    return ()=>{scoped.delete(listener);if(!scoped.size)listeners.delete(key)}
  },
  reload(scope: RollIntentScope) { const snapshot=read(scope);publish(scope,snapshot);return snapshot },
  save(scope: RollIntentScope, intent: RollIntent) {
    const previous=this.getSnapshot(scope)
    if(previous.error || previous.intent && !equal(previous.intent,intent)) throw new Error("已有换牌恢复记录待核对，未发送新请求")
    const envelope={version:1,identityKey:scope.identityKey,roomCode:scope.roomCode,intent}
    validate(envelope,scope)
    try {
      const serialized=JSON.stringify(envelope),key=scopeKey(scope)
      sessionStorage.setItem(key,serialized)
      if(sessionStorage.getItem(key)!==serialized) throw new Error("Roll intent write not retained")
    } catch {
      const error="无法保存换牌恢复记录，未发送请求；请允许会话存储后重试"
      publish(scope,{intent:null,error})
      throw new Error(error)
    }
    publish(scope,{intent,error:null})
  },
  clear(scope: RollIntentScope, expected: RollIntent) {
    if(!equal(this.getSnapshot(scope).intent,expected)) return
    try {
      sessionStorage.removeItem(scopeKey(scope))
      if(sessionStorage.getItem(scopeKey(scope))!==null) throw new Error("Roll intent removal not retained")
      publish(scope,EMPTY)
    } catch {
      publish(scope,{intent:expected,error:"换牌结果已确认，但恢复记录清理失败，请重试核对原请求"})
    }
  },
}
