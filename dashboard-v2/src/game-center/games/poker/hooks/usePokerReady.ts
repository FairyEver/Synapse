import { useEffect, useRef, useState } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { gameApi } from "../../../lib/api"
import { readinessView } from "../lib/settlement-view"
export function usePokerReady(table: PokerTableView, perspective: "owner" | "public", identityKey: string | undefined, onRefresh: () => void | Promise<void>) {
  const { mine } = readinessView(table)
  const version = table.controlVersion ?? mine?.controlVersion
  const controller = table.controller ?? mine?.controller
  const scope = `${identityKey}:${table.roomCode}:${table.handId}:${version}:${perspective}`
  const current = useRef(scope), pending = useRef<string | null>(null), mounted = useRef(true)
  current.current = scope
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  useEffect(() => { setBusy(false); setError(null) }, [scope])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const prepared = !!mine?.readyForNextHand
  const canReady = table.status !== "closed" && !!table.awaitingReady && !!mine && controller === "human" && perspective === "owner" && version != null
  async function ready() {
    if (!canReady || prepared || pending.current === scope || !table.handId || version == null) return
    const handId = table.handId, commandScope = scope
    pending.current = commandScope; setBusy(true); setError(null)
    let applied = false
    try {
      await gameApi().poker.seat.ready({ roomCode: table.roomCode, handId, controlVersion: version })
      applied = true
      if (mounted.current && current.current === commandScope) await onRefresh()
    } catch (cause) {
      if (mounted.current && current.current === commandScope)
        setError(applied ? "准备已提交，刷新失败，请重新读取牌桌" : `${cause instanceof Error ? cause.message : "准备失败"}，请刷新牌桌核对后重试`)
    } finally {
      if (pending.current === commandScope) pending.current = null
      if (mounted.current && current.current === commandScope) setBusy(false)
    }
  }
  async function refresh() {
    const commandScope = scope
    try { await onRefresh() }
    catch (cause) { if (mounted.current && current.current === commandScope) setError(cause instanceof Error ? cause.message : "刷新牌桌失败") }
  }
  return { busy, error, prepared, canReady, controller, ready, refresh }
}
