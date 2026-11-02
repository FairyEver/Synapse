import { useEffect, useRef, useState } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { gameApi } from "../../../lib/api"
import { cardIntentStore } from "../lib/card-intent-store"
import { rollIntentStore } from "../lib/roll-intent-store"
export type PokerIntent = Parameters<ReturnType<typeof gameApi>["poker"]["action"]["act"]>[0]
// Keep an unresolved command stable across room navigation and perspective changes.
// The caller scopes this key to the authenticated account, never a seat number.
const unresolved = new Map<string, PokerIntent>()
export function useHumanControls(table: PokerTableView, onRefresh: () => void | Promise<void>, identityKey?: string) {
  const key = identityKey ? `${identityKey}:${table.roomCode}` : null
  const restored = key ? unresolved.get(key) : undefined
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [to, setTo] = useState(String(table.minRaiseTo ?? 0))
  const [uncertain, setUncertain] = useState(!!restored)
  const pending = useRef(false), intent = useRef<PokerIntent | null>(restored ?? null), mounted = useRef(true)
  const context = useRef(key)
  context.current = key
  const mine = table.seats.find(s => s.seatNo === table.mySeatNo)
  const controller = table.controller ?? mine?.controller
  const version = table.controlVersion ?? mine?.controlVersion
  const handoff = table.handoffPending ?? mine?.handoffPending
  const seq = table.actionSeq ?? table.recentActions.at(-1)?.seq ?? 0
  const point = `${table.handId}:${seq}:${version}`
  useEffect(() => {
    setTo(String(table.minRaiseTo ?? 0))
    const command = intent.current
    if (command && (command.handId !== table.handId || command.expectedActionSeq !== seq || (version != null && command.controlVersion !== version))) {
      intent.current = null
      if (key) unresolved.delete(key)
      setUncertain(false)
      setError(null)
    }
  }, [point, table.handId, table.minRaiseTo, seq, version, key])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const execute = async (work: () => Promise<unknown>, after?: () => Promise<void>) => {
    if (pending.current) return false
    pending.current = true
    setBusy(true)
    setError(null)
    const submitted = intent.current
    const submittedKey = key
    let applied = false
    try {
      await work()
      applied = true
      if (key && unresolved.get(key) === submitted) unresolved.delete(key)
      if (mounted.current && context.current === submittedKey) {
        if (intent.current === submitted) intent.current = null
        setUncertain(false)
        await after?.()
        await onRefresh()
      }
    } catch (cause) {
      if (mounted.current && context.current === submittedKey) {
        setError(applied ? "操作已完成，刷新失败，请重新读取牌桌" : cause instanceof Error ? cause.message : "操作失败")
        setUncertain(!applied && !!intent.current)
      }
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
    return applied && mounted.current && context.current === submittedKey
  }
  const act = (action: PokerIntent["action"]) => {
    const scope = { identityKey: identityKey ?? "", roomCode: table.roomCode }
    if (table.cards?.pending || table.roll?.pending || cardIntentStore.getSnapshot(scope).intent || rollIntentStore.getSnapshot(scope).intent) return
    if (!table.handId || !table.street || !["preflop", "flop", "turn", "river"].includes(table.street) || version == null || intent.current || pending.current) return
    const submitted: PokerIntent = {
      roomCode: table.roomCode,
      handId: table.handId,
      street: table.street as PokerIntent["street"],
      actionId: crypto.randomUUID(),
      expectedActionSeq: seq,
      controlVersion: version,
      action,
      ...(table.paymentVersion ? { expectedPaymentVersion: table.paymentVersion } : {}),
      ...(["bet", "raise"].includes(action) ? { to: Number(to) } : {}),
    }
    intent.current = submitted
    if (key) unresolved.set(key, submitted)
    void execute(() => gameApi().poker.action.act(submitted))
  }
  const retry = () => {
    const submitted = intent.current
    if (submitted) void execute(() => gameApi().poker.action.act(submitted))
  }
  const control = (action: "takeover" | "request_ai" | "cancel_ai") => {
    return version != null ? execute(() => gameApi().poker.control.set({roomCode: table.roomCode, controlVersion: version, action})) : Promise.resolve(false)
  }
  const join = () => execute(() => gameApi().poker.seat.join({roomCode: table.roomCode}))
  const sit = () => execute(() => gameApi().poker.seat.sit({roomCode: table.roomCode, controlVersion: version, sittingOut: mine?.status !== "sitting_out", reason: "user"}))
  const leave = () => execute(() => gameApi().poker.seat.leave({roomCode: table.roomCode, controlVersion: version}))
  return {busy, error, to, setTo, uncertain, mine, controller, version, handoff, act, retry, control, join, sit, leave}
}
