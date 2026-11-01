import { useEffect, useId, useRef, useState } from "react"
import type { PokerRollChooseInput, PokerRollKind, PokerRollStartInput, PokerTableView } from "@synapse/shared/game-contracts"
import { gameApi } from "../../../lib/api"

type Intent = { operation: "start"; input: PokerRollStartInput } | { operation: "choose"; input: PokerRollChooseInput }
// Keep ambiguous writes for their original account/room, including across unmounts.
const unresolved = new Map<string, Intent>()
export function usePokerRoll(table: PokerTableView, perspective: "owner" | "public", onRefresh: () => void | Promise<void>, identityKey?: string) {
  const localIdentity = useId()
  const key = `${identityKey ?? localIdentity}:${table.roomCode}`
  const mine = table.seats.find(s => s.isMe && s.seatNo === table.mySeatNo && !s.isHistorical && s.inCurrentHand !== false)
  const version = table.controlVersion ?? mine?.controlVersion
  const controller = table.controller ?? mine?.controller
  const point = `${table.handId}:${table.street}:${table.actionSeq}:${version}:${controller}:${perspective}:${table.status}`
  const context = useRef({ key, point })
  if (context.current.key !== key || context.current.point !== point) context.current = { key, point }
  const mounted = useRef(true), sending = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [, render] = useState(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setBusy(false); setError(null); sending.current = false }, [key, point])
  const canControl = perspective === "owner" && !!mine && controller === "human" && version != null && table.status === "running" && table.actionOnSeat === table.mySeatNo
  const command = unresolved.get(key)
  const execute = async (intent: Intent, recovering = false) => {
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
      if (intent.operation === "start") await gameApi().poker.roll.start(intent.input)
      else await gameApi().poker.roll.choose(intent.input)
      applied = true
      if (unresolved.get(key) === intent) unresolved.delete(key)
      if (current()) { render(n => n + 1); await onRefresh() }
    } catch (cause) {
      // Domain rejections are transactional. Transport/invalid-response failures are ambiguous.
      const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : ""
      let readFailed = false
      if (!applied && code.startsWith("POKER_")) {
        if (unresolved.get(key) === intent) unresolved.delete(key)
        if (current()) {
          try { await onRefresh() } catch { readFailed = true }
        }
      }
      if (current()) { setError(applied ? "换牌已完成，刷新失败，请重新读取牌桌" : `${cause instanceof Error ? cause.message : "换牌结果未知，请核对"}${readFailed ? "；刷新失败，请重新读取牌桌" : ""}`); render(n => n + 1) }
    } finally {
      if (current()) { sending.current = false; setBusy(false) }
    }
  }
  const start = (kind: PokerRollKind, cardIndex: number, expectedFee: number) => {
    if (!canControl || !table.roll?.enabled || command || sending.current || table.roll?.pending || !table.handId || !["preflop","flop","turn"].includes(table.street ?? "") || !table.roll?.[kind]?.available || table.roll[kind]!.fee !== expectedFee || ![0,1].includes(cardIndex)) return
    const intent: Intent = {operation:"start",input:{roomCode:table.roomCode,handId:table.handId,street:table.street as PokerRollStartInput["street"],expectedActionSeq:table.actionSeq ?? 0,controlVersion:version!,actionId:crypto.randomUUID(),kind,cardIndex,expectedFee}}
    unresolved.set(key,intent)
    return execute(intent)
  }
  const choose = (candidateIndex: number) => {
    const pending = table.roll?.pending
    if (!canControl || command || sending.current || !pending || !table.handId || !Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= pending.candidates.length) return
    const intent:Intent={operation:"choose",input:{roomCode:table.roomCode,handId:table.handId,rollId:pending.rollId,candidateIndex,expectedActionSeq:table.actionSeq ?? 0,controlVersion:version!,actionId:crypto.randomUUID()}}
    unresolved.set(key,intent)
    return execute(intent)
  }
  return { busy, error, blocked:busy || !!command, uncertain:!!command && !busy, canControl, start, choose, retry:() => { const intent=unresolved.get(key); if(intent) return execute(intent,true) } }
}
