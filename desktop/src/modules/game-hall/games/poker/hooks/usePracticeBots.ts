import { useRef } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { useAccount } from "@/app-shell/account"
import { useGameMutation } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"

export function usePracticeBots(table: PokerTableView | null, onRefresh: () => void | Promise<void>) {
  const { state } = useAccount(), mutation = useGameMutation()
  const userId = state.status === "authenticated" ? state.profile.user.id : null
  const intent = useRef<{ key: string; id: string | null }>({ key: "", id: null })
  const key = `${userId}:${table?.roomCode}`
  if (intent.current.key !== key) intent.current = { key, id: null }
  const canManage = !!table && table.mode === "practice" && table.ownerUserId === userId && table.status !== "closed"
  const bots = table?.seats.filter((s) => s.participantKind === "bot") ?? []
  const humans = (table?.seats.length ?? 0) - bots.length
  const full = !!table && table.seats.length >= table.maxSeats - (humans ? 0 : 1)
  const add = async () => {
    if (!table || !canManage || full || mutation.busy) return
    const submitted = intent.current
    submitted.id ??= crypto.randomUUID()
    const result = await mutation.run(() => gameApi().poker.bot.add({ roomCode: table.roomCode, creationId: submitted.id! }))
    if (result && intent.current === submitted) { submitted.id = null; await onRefresh() }
  }
  const remove = async (botId: string) => {
    if (!table || !canManage || mutation.busy) return
    const submitted = intent.current
    const result = await mutation.run(() => gameApi().poker.bot.remove({ roomCode: table.roomCode, botId }))
    if (result && intent.current === submitted) {
      submitted.id = null
      await onRefresh()
    }
  }
  return { canManage, bots, full, busy: mutation.busy, add, remove, retrying: !!intent.current.id && !mutation.busy }
}

export type PracticeBotControls = ReturnType<typeof usePracticeBots>
