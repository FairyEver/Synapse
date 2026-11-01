import { Button } from "@heroui/react"
import type { PracticeBotControls } from "../hooks/usePracticeBots"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { currentRoomSeats } from "../hooks/usePracticePreparation"

export function PracticeBotAddButton({ controls, onAdded }: { controls: PracticeBotControls; onAdded?: () => void }) {
  if (!controls.canManage) return null
  return <Button type="button" isDisabled={controls.busy || controls.full} onPress={async () => { if (await controls.add()) onAdded?.() }}>{controls.retrying ? "重试添加机器人" : controls.full ? "座位已满" : "添加机器人"}</Button>
}

export function PracticeBots({ controls, table }: { controls: PracticeBotControls; table?: PokerTableView }) {
  if (table) {
    const seats = currentRoomSeats(table)
    return <section className="space-y-4 font-sans text-foreground" aria-label="房间成员">
      <p className="text-sm text-muted">{seats.length} / {table.maxSeats} 人</p>
      {controls.canManage && <PracticeBotAddButton controls={controls} />}
      <ul className="divide-y divide-separator">{seats.map(seat => <li key={seat.seatNo} className="flex min-w-0 items-center justify-between gap-3 py-3">
        <div className="min-w-0 space-y-1"><p className="break-words text-sm">{seat.displayName}{seat.isMe && "（你）"}</p><p className="text-xs text-muted">{seat.participantKind === "bot" ? "机器人" : seat.controller === "ai" ? "外部 AI" : "真人"}{seat.leavePending ? seat.participantKind === "bot" ? " · 本手后移除" : " · 本手后离桌" : seat.status === "sitting_out" ? " · 已暂离" : seat.inCurrentHand === false && table.handId ? " · 下一手加入" : ""}</p></div>
        {controls.canManage && seat.participantKind === "bot" && seat.botId && <Button variant="danger-soft" aria-label={`移除 ${seat.displayName}`} isDisabled={controls.busy || seat.leavePending} onPress={() => void controls.remove(seat.botId!)}>{seat.leavePending ? "本手后移除" : "移除"}</Button>}
      </li>)}</ul>
    </section>
  }
  if (!controls.canManage) return null
  return (
    <section className="space-y-4 font-sans text-foreground" aria-label="陪练机器人管理"><h3 className="font-medium">陪练机器人 · {controls.bots.length}</h3><div className="flex flex-col items-stretch gap-3">
      <span className="text-sm text-muted">练习筹码 · 不影响大厅点数</span>
      <PracticeBotAddButton controls={controls} />
      {controls.bots.map((bot) => <div key={bot.botId} className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 break-words text-sm">{bot.displayName}</span><Button type="button" variant="danger-soft" aria-label={`移除 ${bot.displayName}`} isDisabled={controls.busy || bot.leavePending} onPress={() => bot.botId && void controls.remove(bot.botId)}>{bot.leavePending ? "本手后移除" : "移除"}</Button></div>)}
    </div></section>
  )
}
