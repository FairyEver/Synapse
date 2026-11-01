import { useEffect, useRef, useState } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { pokerConnectInstruction } from "../lib/connect-instruction"
import { gameApi } from "../../../lib/api"
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
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    const submitted = intent.current
    try {
      await work()
      if (key && unresolved.get(key) === submitted) unresolved.delete(key)
      if (mounted.current) {
        if (intent.current === submitted) intent.current = null
        setUncertain(false)
        await onRefresh()
        await after?.()
      }
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : "操作失败")
        setUncertain(!!intent.current)
      }
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const act = (action: PokerIntent["action"]) => {
    if (!table.handId || !table.street || !["preflop", "flop", "turn", "river"].includes(table.street) || version == null || intent.current || pending.current) return
    const submitted: PokerIntent = {
      roomCode: table.roomCode,
      handId: table.handId,
      street: table.street as PokerIntent["street"],
      actionId: crypto.randomUUID(),
      expectedActionSeq: seq,
      controlVersion: version,
      action,
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
    if (version != null) void execute(() => gameApi().poker.control.set({roomCode: table.roomCode, controlVersion: version, action}))
  }
  const join = () => void execute(() => gameApi().poker.seat.join({roomCode: table.roomCode}))
  const sit = () => void execute(() => gameApi().poker.seat.sit({roomCode: table.roomCode, controlVersion: version, sittingOut: mine?.status !== "sitting_out", reason: "user"}))
  const leave = () => void execute(() => gameApi().poker.seat.leave({roomCode: table.roomCode, controlVersion: version}))
  const ready = () => {
    if (table.awaitingReady && table.status !== "closed" && table.handId && mine?.nextHandEligible && !mine.readyForNextHand && controller === "human" && version != null)
      void execute(() => gameApi().poker.seat.ready({ roomCode: table.roomCode, handId: table.handId!, controlVersion: version }))
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pokerConnectInstruction(table.roomCode))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "复制失败")
    }
  }
  const requestAIJoin = () => {
    if (version != null) void execute(() => gameApi().poker.control.set({roomCode:table.roomCode, controlVersion:version, action:"request_ai"}), copy)
  }
  return {requestAIJoin, busy, error, to, setTo, uncertain, mine, controller, version, handoff, act, retry, control, join, sit, leave, ready, copy}
}
