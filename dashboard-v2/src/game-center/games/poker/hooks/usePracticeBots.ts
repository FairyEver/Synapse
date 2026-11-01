import { useRef } from "react"
import { toast } from "@heroui/react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { useAccount } from "@/game-center/runtime/account"
import { useGameMutation } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"

export function usePracticeBots(table: PokerTableView | null, onRefresh: () => void | Promise<void>) {
  const { state } = useAccount(), mutation = useGameMutation()
  const userId = state.status === "authenticated" ? state.profile.user.id : null
  const intent = useRef<{ key: string; id: string | null }>({ key: "", id: null })
  const key = `${userId}:${table?.roomCode}`
  if (intent.current.key !== key) intent.current = { key, id: null }
  const canManage = !!table && table.mode === "practice" && table.ownerUserId === userId && table.status !== "closed"
  const currentSeats = table?.seats.filter(s => !s.isHistorical && s.status !== "left" && (s.participantKind !== "bot" || !!s.botId)) ?? []
  const bots = currentSeats.filter(s => s.participantKind === "bot")
  const humans = currentSeats.length - bots.length
  const full = !!table && currentSeats.length >= table.maxSeats - (humans ? 0 : 1)
  const add = async () => {
    if (!table || !canManage || full || mutation.busy) return false
    const submitted = intent.current
    submitted.id ??= crypto.randomUUID()
    const result = await mutation.run(() => gameApi().poker.bot.add({ roomCode: table.roomCode, creationId: submitted.id! }))
    if (result && intent.current === submitted) {
      submitted.id = null
      try { await onRefresh() } catch {
        if (intent.current === submitted) toast.danger("操作已完成，刷新失败，请重新读取牌桌")
      }
      return intent.current === submitted
    }
    return false
  }
  const remove = async (botId: string) => {
    if (!table || !canManage || mutation.busy) return
    const submitted = intent.current
    const result = await mutation.run(() => gameApi().poker.bot.remove({ roomCode: table.roomCode, botId }))
    if (result && intent.current === submitted) {
      submitted.id = null
      try { await onRefresh() } catch {
        if (intent.current === submitted) toast.danger("操作已完成，刷新失败，请重新读取牌桌")
      }
    }
  }
  return { canManage, bots, full, busy: mutation.busy, add, remove, retrying: !!intent.current.id && !mutation.busy }
}

export type PracticeBotControls = ReturnType<typeof usePracticeBots>
