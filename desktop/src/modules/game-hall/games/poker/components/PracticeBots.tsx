import { PokerButton } from "./PokerButton"
import type { PracticeBotControls } from "../hooks/usePracticeBots"

export function PracticeBotAddButton({ controls }: { controls: PracticeBotControls }) {
  if (!controls.canManage) return null
  return <PokerButton type="button" tone="primary" disabled={controls.busy || controls.full} onClick={() => void controls.add()}>{controls.retrying ? "重试添加机器人" : controls.full ? "座位已满" : "添加机器人"}</PokerButton>
}

export function PracticeBots({ controls }: { controls: PracticeBotControls }) {
  if (!controls.canManage) return null
  return (
    <section className="poker-bot-manager" aria-label="陪练机器人管理"><h3>陪练机器人 · {controls.bots.length}</h3><div className="poker-bot-actions">
      <span className="poker-bot-caption">练习筹码 · 不影响大厅点数</span>
      <PracticeBotAddButton controls={controls} />
      {controls.bots.map((bot) => <PokerButton key={bot.botId} type="button" disabled={controls.busy || bot.leavePending} onClick={() => bot.botId && void controls.remove(bot.botId)}>{bot.displayName} · {bot.leavePending ? "本手后移除" : "移除"}</PokerButton>)}
    </div></section>
  )
}
