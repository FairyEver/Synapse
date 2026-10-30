import { useRef } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { useAccount } from "@/app-shell/account"
import { PokerButton } from "./PokerButton"
import { useGameMutation } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"

export function PracticeBots({ table, onRefresh }: { table: PokerTableView; onRefresh: () => void | Promise<void> }) {
  const { state } = useAccount(), mutation = useGameMutation()
  const userId = state.status === "authenticated" ? state.profile.user.id : null
  const intent = useRef<{ key: string; id: string | null }>({ key: "", id: null })
  const key = `${userId}:${table.roomCode}`
  if (intent.current.key !== key) intent.current = { key, id: null }
  if (table.mode !== "practice" || table.ownerUserId !== userId || table.status === "closed") return null
  const bots = table.seats.filter((s) => s.participantKind === "bot")
  const humans = table.seats.length - bots.length
  const full = table.seats.length >= table.maxSeats - (humans ? 0 : 1)
  const add = async () => {
    const submitted = intent.current
    submitted.id ??= crypto.randomUUID()
    const result = await mutation.run(() => gameApi().poker.bot.add({ roomCode: table.roomCode, creationId: submitted.id! }))
    if (result && intent.current === submitted) { submitted.id = null; await onRefresh() }
  }
  const remove = async (botId: string) => {
    const submitted = intent.current
    const result = await mutation.run(() => gameApi().poker.bot.remove({ roomCode: table.roomCode, botId }))
    if (result && intent.current === submitted) {
      submitted.id = null
      await onRefresh()
    }
  }
  return (
    <details className="poker-bot-manager" aria-label="陪练机器人管理"><summary>陪练机器人 · {bots.length}</summary><div className="poker-bot-actions">
      <span className="poker-bot-caption">练习筹码 · 不影响大厅点数</span>
      <PokerButton type="button" disabled={mutation.busy || full} onClick={() => void add()}>{intent.current.id && !mutation.busy ? "重试添加机器人" : "添加机器人"}</PokerButton>
      {bots.map((bot) => <PokerButton key={bot.botId} type="button" disabled={mutation.busy || bot.leavePending} onClick={() => bot.botId && void remove(bot.botId)}>{bot.displayName} · {bot.leavePending ? "本手后移除" : "移除"}</PokerButton>)}
    </div></details>
  )
}
