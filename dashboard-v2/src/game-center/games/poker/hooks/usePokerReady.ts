import { useEffect, useRef, useState } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { gameApi } from "../../../lib/api"
import { readinessView } from "../lib/settlement-view"
export function usePokerReady(table: PokerTableView, perspective: "owner" | "public", identityKey: string | undefined, onRefresh: () => void | Promise<void>) {
  const progress = readinessView(table), { mine } = progress
  const version = table.controlVersion ?? mine?.controlVersion
  const controller = table.controller ?? mine?.controller
  const scope = `${identityKey}:${table.roomCode}:${table.handId}:${version}:${perspective}`
  const current = useRef(scope), pending = useRef<string | null>(null), mounted = useRef(true)
  current.current = scope
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const seatScope = `${identityKey}:${table.roomCode}:${table.handId}:${table.mySeatNo}:${perspective}`
  const previous = useRef({ seatScope, controller, version })
  const [reclaimed, setReclaimed] = useState(false)
  const prepared = !!mine?.readyForNextHand
  useEffect(() => {
    const before = previous.current
    if (before.seatScope !== seatScope || !table.awaitingReady || prepared) setReclaimed(false)
    else if (before.controller === "ai" && controller === "human" && before.version !== version) setReclaimed(true)
    previous.current = { seatScope, controller, version }
  }, [seatScope, controller, version, table.awaitingReady, prepared])
  useEffect(() => { setBusy(false); setError(null) }, [scope])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const canReady = table.status !== "closed" && !!table.awaitingReady && !!mine && controller === "human" && perspective === "owner" && version != null
  const canTakeover = table.status !== "closed" && !!table.awaitingReady && table.mySeatNo != null && controller === "ai" && version != null
  async function submit(kind: "ready" | "takeover") {
    if ((kind === "ready" ? !canReady || prepared : !canTakeover) || pending.current === scope || !table.handId || version == null) return false
    const handId = table.handId, commandScope = scope
    pending.current = commandScope; setBusy(true); setError(null)
    let applied = false
    try {
      if (kind === "ready") await gameApi().poker.seat.ready({ roomCode: table.roomCode, handId, controlVersion: version })
      else await gameApi().poker.control.set({ roomCode: table.roomCode, controlVersion: version, action: "takeover" })
      applied = true
      if (mounted.current && current.current === commandScope) await onRefresh()
    } catch (cause) {
      if (mounted.current && current.current === commandScope)
        setError(applied ? `${kind === "ready" ? "准备已提交" : "接管已完成"}，刷新失败，请重新读取牌桌` : `${cause instanceof Error ? cause.message : "操作失败"}，请刷新牌桌核对后重试`)
    } finally {
      if (pending.current === commandScope) pending.current = null
      if (mounted.current && current.current === commandScope) setBusy(false)
    }
    return applied && mounted.current && current.current === commandScope
  }
  async function refresh() {
    const commandScope = scope
    try { await onRefresh() }
    catch (cause) { if (mounted.current && current.current === commandScope) setError(cause instanceof Error ? cause.message : "刷新牌桌失败") }
  }
  return { busy, error, prepared, eligible: !!mine, canReady, canTakeover, controller, summary: progress.summary, notice: reclaimed && canReady && !prepared ? "已接管，请重新准备" : null, ready: () => submit("ready"), takeover: () => submit("takeover"), refresh }
}
export type PokerReadyControls = ReturnType<typeof usePokerReady>
