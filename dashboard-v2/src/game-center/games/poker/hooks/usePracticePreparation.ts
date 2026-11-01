import { useEffect, useRef, useState } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { useAccount } from "@/game-center/runtime/account"
import { gameApi } from "../../../lib/api"

// A lost bot response must retain its creation ID across leaving/re-entering preparation.
const unresolvedBots = new Map<string, string>()
export const currentRoomSeats = (table: PokerTableView) => table.seats.filter(seat => !seat.isHistorical && seat.status !== "left")

export function usePracticePreparation(roomCode: string, onRefresh: () => void | Promise<void>) {
  const { state } = useAccount()
  const userId = state.status === "authenticated" ? state.profile.user.id : null
  const key = `${userId}:${roomCode}`
  const context = useRef({ key, pending: false })
  if (context.current.key !== key) context.current = { key, pending: false }
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const [progress, setProgress] = useState<{ key: string; count: number } | null>(null)

  const prepare = async (target: number, participation: "human" | "ai") => {
    const submitted = context.current
    if (!userId || submitted.pending) return false
    submitted.pending = true
    setBusyKey(key); setFailure(null)
    const current = () => mounted.current && context.current === submitted
    const api = gameApi().poker
    let prepared = false
    const read = async () => {
      const table = await api.table.state({ roomCode, perspective: "public" })
      if (current()) setProgress({ key, count: currentRoomSeats(table).filter(seat => seat.participantKind === "bot").length })
      return table
    }
    try {
      let table = await read()
      if (!current()) return false
      if (table.mode !== "practice" || table.ownerUserId !== userId || table.status === "closed") throw new Error("房间状态已变化，请返回房间列表")
      const pendingId = unresolvedBots.get(key)
      if (pendingId) {
        await api.bot.add({ roomCode, creationId: pendingId })
        if (unresolvedBots.get(key) === pendingId) unresolvedBots.delete(key)
        if (!current()) return false
        table = await read()
      }
      if (!current()) return false
      if (table.mySeatNo !== null || table.handoffPending) { prepared = true; await onRefresh(); return true }
      const seats = currentRoomSeats(table)
      const humans = seats.filter(seat => seat.participantKind !== "bot").length
      if (!Number.isInteger(target) || target < 1 || target > table.maxSeats - humans - 1) throw new Error("座位不足，请调整机器人数量")
      let count = seats.length - humans
      while (count < target) {
        if (!current()) return false
        if (table.handId || table.status === "closed") throw new Error("牌局已开始或房间已关闭，请返回牌桌")
        const id = crypto.randomUUID()
        unresolvedBots.set(key, id)
        await api.bot.add({ roomCode, creationId: id })
        if (unresolvedBots.get(key) === id) unresolvedBots.delete(key)
        if (!current()) return false
        table = await read()
        if (!current()) return false
        count = Math.max(count + 1, currentRoomSeats(table).filter(seat => seat.participantKind === "bot").length)
      }
      if (!current()) return false
      if (table.handId || table.status === "closed") throw new Error("牌局状态已变化，请返回牌桌")
      if (currentRoomSeats(table).filter(seat => seat.participantKind === "bot").length < target) throw new Error("成员状态已变化，请刷新后重试")
      if (participation === "human") await api.seat.join({ roomCode })
      else {
        if (table.controlVersion == null) throw new Error("请刷新牌桌后接入 AI")
        await api.control.set({ roomCode, controlVersion: table.controlVersion, action: "request_ai" })
      }
      prepared = true
      if (current()) await onRefresh()
      return current()
    } catch (cause) {
      if (current()) {
        setFailure({ key, message: prepared ? "准备已完成，刷新失败，请重新读取牌桌" : cause instanceof Error ? cause.message : "准备失败，请重试" })
        // Refresh confirmed partial additions, but never replace the unresolved creation ID.
        if (!prepared) try { await onRefresh() } catch { if (current()) setFailure({ key, message: "准备结果尚未确认，刷新失败，请重试" }) }
      }
      return false
    } finally {
      submitted.pending = false
      if (current()) setBusyKey(null)
    }
  }
  return { prepare, busy: busyKey === key, error: failure?.key === key ? failure.message : null, added: progress?.key === key ? progress.count : null }
}
