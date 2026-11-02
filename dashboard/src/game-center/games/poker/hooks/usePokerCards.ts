import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { PokerCardChooseInput, PokerCardPlayInput, PokerTableView } from "@synapse/shared/game-contracts"
import { gameApi } from "../../../lib/api"
import { cardIntentStore, type CardIntent } from "../lib/card-intent-store"
import { rollIntentStore } from "../lib/roll-intent-store"
import { validCardSelections } from "../lib/card-view"

export function usePokerCards(table: PokerTableView, perspective: "owner" | "public", onRefresh: () => void | Promise<void>, identityKey = "", externalBlocked = false) {
  const scope = { identityKey, roomCode: table.roomCode }, key = JSON.stringify([identityKey, table.roomCode])
  const subscribe = useCallback((listener: () => void) => cardIntentStore.subscribe(scope, listener), [key])
  const getSnapshot = useCallback(() => cardIntentStore.getSnapshot(scope), [key])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const mine = table.seats.find(seat => seat.isMe && seat.seatNo === table.mySeatNo && !seat.isHistorical && seat.inCurrentHand !== false)
  const version = table.controlVersion ?? mine?.controlVersion, controller = table.controller ?? mine?.controller
  const point = `${table.handId}:${table.street}:${table.actionSeq}:${version}:${controller}:${perspective}:${table.status}`
  const context = useRef({ key, point })
  if (context.current.key !== key || context.current.point !== point) context.current = { key, point }
  const mounted = useRef(true), sending = useRef<symbol | null>(null)
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<string | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setBusy(false); setFailure(null); sending.current = null }, [key, point])
  const canControl = !!identityKey && perspective === "owner" && !!mine && controller === "human" && version != null && table.status === "running" && table.actionOnSeat === table.mySeatNo
  const mayWrite = () => canControl && !externalBlocked && !sending.current && !cardIntentStore.getSnapshot(scope).intent && !cardIntentStore.getSnapshot(scope).error && !rollIntentStore.getSnapshot(scope).intent
  const execute = async (intent: CardIntent, recovering = false) => {
    if (sending.current) return
    const submitted = context.current, ticket = Symbol(), current = () => mounted.current && context.current === submitted && sending.current === ticket
    sending.current = ticket; setBusy(true); setFailure(null)
    let applied = false
    try {
      if (recovering) { await gameApi().poker.table.state({ roomCode: intent.input.roomCode }); if (!current()) return }
      if (intent.operation === "play") await gameApi().poker.card.play(intent.input)
      else await gameApi().poker.card.choose(intent.input)
      applied = true; cardIntentStore.clear(scope, intent)
      if (current()) await onRefresh()
    } catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : ""
      let refreshFailed = false
      if (!applied && code.startsWith("POKER_")) {
        cardIntentStore.clear(scope, intent)
        if (current()) try { await onRefresh() } catch { refreshFailed = true }
      }
      if (current()) setFailure(applied ? "用牌已完成，刷新失败，请重新读取牌桌" : `${cause instanceof Error ? cause.message : "卡牌结果未知，请核对"}${refreshFailed ? "；刷新失败，请重新读取牌桌" : ""}`)
    } finally { if (current()) { sending.current = null; setBusy(false) } }
  }
  const saveAndExecute = (intent: CardIntent) => {
    try { cardIntentStore.save(scope, intent) }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : "卡牌恢复记录保存失败"); return }
    return execute(intent)
  }
  const play = (input: PokerCardPlayInput) => {
    const card = table.cards?.ownHand?.find(item => item.instanceId === input.instanceId)
    if (!mayWrite() || !table.cards?.enabled || table.cards.pending || table.roll?.pending || !card?.available || !validCardSelections(card, input.selections)
      || input.roomCode !== table.roomCode || input.handId !== table.handId || input.street !== table.street || input.expectedActionSeq !== table.actionSeq || input.controlVersion !== version || input.expectedPaymentVersion !== card.payment.version) return
    return saveAndExecute({ operation: "play", input })
  }
  const choose = (candidateIndex: number) => {
    const pending = table.cards?.pending
    if (!mayWrite() || !pending || pending.origin !== "card" || !table.handId || !Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= pending.candidates.length) return
    const input: PokerCardChooseInput = { roomCode: table.roomCode, handId: table.handId, street: table.street as PokerCardChooseInput["street"], expectedActionSeq: table.actionSeq ?? 0, controlVersion: version!, actionId: crypto.randomUUID(), expectedPaymentVersion: pending.paymentVersion, choiceId: pending.choiceId, candidateIndex }
    return saveAndExecute({ operation: "choose", input })
  }
  return { busy, error: snapshot.error ?? failure, storageError: !!snapshot.error, blocked: busy || !!snapshot.intent, uncertain: !!snapshot.intent && !busy, canControl, play, choose,
    retry: () => { const restored = cardIntentStore.reload(scope); if (restored.error) { setFailure(restored.error); return }; setFailure(null); if (restored.intent) return execute(restored.intent, true) },
  }
}
