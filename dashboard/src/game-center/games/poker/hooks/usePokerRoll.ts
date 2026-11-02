import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { PokerRollKind, PokerRollStartInput, PokerTableView } from "@synapse/shared/game-contracts"
import { gameApi } from "../../../lib/api"
import { rollIntentStore, type RollIntent } from "../lib/roll-intent-store"
import { cardIntentStore } from "../lib/card-intent-store"

export function usePokerRoll(table: PokerTableView, perspective: "owner" | "public", onRefresh: () => void | Promise<void>, identityKey?: string) {
  const scope = {identityKey:identityKey ?? "",roomCode:table.roomCode}
  const key = JSON.stringify([scope.identityKey,scope.roomCode])
  const subscribe=useCallback((listener:()=>void)=>rollIntentStore.subscribe(scope,listener),[identityKey,table.roomCode])
  const getSnapshot=useCallback(()=>rollIntentStore.getSnapshot(scope),[identityKey,table.roomCode])
  const snapshot=useSyncExternalStore(subscribe,getSnapshot)
  const mine = table.seats.find(s => s.isMe && s.seatNo === table.mySeatNo && !s.isHistorical && s.inCurrentHand !== false)
  const version = table.controlVersion ?? mine?.controlVersion
  const controller = table.controller ?? mine?.controller
  const point = `${table.handId}:${table.street}:${table.actionSeq}:${version}:${controller}:${perspective}:${table.status}`
  const context = useRef({ key, point })
  if (context.current.key !== key || context.current.point !== point) context.current = { key, point }
  const mounted = useRef(true), sending = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [lastStart, setLastStart] = useState<{ key: string; input: PokerRollStartInput; actionSeq: number; count: number } | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setBusy(false); setError(null); sending.current = false }, [key, point])
  useEffect(() => { setLastStart(null) }, [key, table.handId, table.street, version, perspective, controller, table.status, table.actionOnSeat])
  const canControl = !!identityKey && perspective === "owner" && !!mine && controller === "human" && version != null && table.status === "running" && table.actionOnSeat === table.mySeatNo
  const command = snapshot.intent
  const execute = async (intent: RollIntent, recovering = false) => {
    if (sending.current) return
    const submittedContext = context.current
    const current = () => mounted.current && context.current === submittedContext
    sending.current = true; setBusy(true); setError(null)
    let applied = false
    try {
      if (recovering) {
        await gameApi().poker.table.state({roomCode:intent.input.roomCode})
        if (!current()) return
      }
      if (intent.operation === "start") {
        const result = await gameApi().poker.roll.start(intent.input)
        if (current() && !recovering) setLastStart({key,input:intent.input,actionSeq:result.actionSeq,count:(table.roll?.count ?? 0)+1})
      }
      else await gameApi().poker.roll.choose(intent.input)
      applied = true
      rollIntentStore.clear(scope,intent)
      if (current()) await onRefresh()
    } catch (cause) {
      // Domain rejections are transactional. Transport/invalid-response failures are ambiguous.
      const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : ""
      let readFailed = false
      if (!applied && code.startsWith("POKER_")) {
        rollIntentStore.clear(scope,intent)
        if (current()) {
          try { await onRefresh() } catch { readFailed = true }
        }
      }
      if (current()) { setError(applied ? "换牌已完成，刷新失败，请重新读取牌桌" : `${cause instanceof Error ? cause.message : "换牌结果未知，请核对"}${readFailed ? "；刷新失败，请重新读取牌桌" : ""}`) }
    } finally {
      if (current()) { sending.current = false; setBusy(false) }
    }
  }
  const start = (kind: PokerRollKind, cardIndex: number, expectedFee: number) => {
    if (table.cards?.pending || cardIntentStore.getSnapshot(scope).intent) return
    if (!canControl || !table.roll?.enabled || snapshot.error || command || sending.current || (table.roll?.pending && table.roll.pending.cardIndex !== cardIndex) || !table.handId || !["preflop","flop","turn"].includes(table.street ?? "") || !table.roll?.[kind]?.available || table.roll[kind]!.fee !== expectedFee || ![0,1].includes(cardIndex)) return
    const intent: RollIntent = {operation:"start",input:{roomCode:table.roomCode,handId:table.handId,street:table.street as PokerRollStartInput["street"],expectedActionSeq:table.actionSeq ?? 0,controlVersion:version!,actionId:crypto.randomUUID(),kind,cardIndex,expectedFee}}
    if (table.roll[kind]?.payment) intent.input.expectedPaymentVersion = table.roll[kind]!.payment!.version
    try { rollIntentStore.save(scope,intent) }
    catch(cause) { setError(cause instanceof Error ? cause.message : "换牌恢复记录保存失败"); return }
    return execute(intent)
  }
  const choose = (candidateIndex: number) => {
    if (table.cards?.pending || cardIntentStore.getSnapshot(scope).intent) return
    const pending = table.roll?.pending
    if (!canControl || snapshot.error || command || sending.current || !pending || !table.handId || !Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= pending.candidates.length) return
    const intent:RollIntent={operation:"choose",input:{roomCode:table.roomCode,handId:table.handId,rollId:pending.rollId,candidateIndex,expectedActionSeq:table.actionSeq ?? 0,controlVersion:version!,actionId:crypto.randomUUID()}}
    try { rollIntentStore.save(scope,intent) }
    catch(cause) { setError(cause instanceof Error ? cause.message : "换牌恢复记录保存失败"); return }
    return execute(intent)
  }
  const continuation = canControl && lastStart?.key === key && lastStart.input.handId === table.handId && lastStart.input.street === table.street && lastStart.input.controlVersion === version && lastStart.actionSeq === table.actionSeq && lastStart.count === table.roll?.count ? lastStart.input : null
  return { busy, error:snapshot.error ?? error, storageError:!!snapshot.error, blocked:busy || !!command, uncertain:!!command && !busy, canControl, continuation, start, choose, retry:() => {
    const restored=rollIntentStore.reload(scope)
    if(restored.error) {setError(restored.error);return}
    setError(null)
    if(restored.intent) return execute(restored.intent,true)
  } }
}
