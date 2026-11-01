import { Button } from "@heroui/react"
import type { PracticeBotControls } from "../hooks/usePracticeBots"

export function PracticeBotAddButton({ controls, onAdded }: { controls: PracticeBotControls; onAdded?: () => void }) {
  if (!controls.canManage) return null
  return <Button type="button" isDisabled={controls.busy || controls.full} onPress={async () => { if (await controls.add()) onAdded?.() }}>{controls.retrying ? "重试添加机器人" : controls.full ? "座位已满" : "添加机器人"}</Button>
}

export function PracticeBots({ controls }: { controls: PracticeBotControls }) {
  if (!controls.canManage) return null
  return (
    <section className="space-y-4 font-sans text-foreground" aria-label="陪练机器人管理"><h3 className="font-medium">陪练机器人 · {controls.bots.length}</h3><div className="flex flex-col items-stretch gap-3">
      <span className="text-sm text-muted">练习筹码 · 不影响大厅点数</span>
      <PracticeBotAddButton controls={controls} />
      {controls.bots.map((bot) => <div key={bot.botId} className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 break-words text-sm">{bot.displayName}</span><Button type="button" variant="danger-soft" aria-label={`移除 ${bot.displayName}`} isDisabled={controls.busy || bot.leavePending} onPress={() => bot.botId && void controls.remove(bot.botId)}>{bot.leavePending ? "本手后移除" : "移除"}</Button></div>)}
    </div></section>
  )
}
