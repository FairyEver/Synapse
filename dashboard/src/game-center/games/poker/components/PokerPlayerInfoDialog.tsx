import { Button, Modal } from "@heroui/react"
import type { PokerSeatView, PokerTableView } from "@synapse/shared/game-contracts"
import { usesPokerHandDock } from "../lib/card-mode"
import { amount } from "../lib/view"

const statusLabels: Record<string, string> = { active: "对局中", folded: "已弃牌", allin: "已全下", sitting_out: "已暂离", waiting: "等待加入", left: "已离桌" }
export function PokerPlayerInfoDialog({ table, seat, onClose }: { table: PokerTableView; seat: PokerSeatView; onClose: () => void }) {
  const unit = table.mode === "practice" ? "筹码" : "点数"
  const cardsV2 = usesPokerHandDock(table)
  const stats = table.rollStats?.seats.find(entry => entry.seatNo === seat.seatNo)
  const pending = seat.inCurrentHand !== false && table.roll?.pendingSeatNo === seat.seatNo
  const status = pending ? "正在选牌" : table.status === "running" && seat.inCurrentHand !== false && table.actionOnSeat === seat.seatNo ? "行动中" : statusLabels[seat.status] ?? "等待中"
  return <Modal.Backdrop isOpen onOpenChange={open => { if (!open) onClose() }} className="font-sans text-foreground scheme-light">
    <Modal.Container size="md"><Modal.Dialog aria-label="玩家信息">
      <Modal.CloseTrigger aria-label="关闭玩家信息" />
      <Modal.Header><Modal.Heading className="pr-8">玩家信息</Modal.Heading></Modal.Header>
      <Modal.Body><div className="space-y-5">
        <p className="font-medium wrap-anywhere">{seat.isMe ? "你" : seat.displayName}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">座位</dt><dd className="text-right text-foreground tabular-nums">{seat.seatNo + 1}</dd>
          <dt className="text-muted">可用{unit}</dt><dd className="text-right text-foreground tabular-nums wrap-anywhere">{amount(seat.stack)}</dd>
          <dt className="text-muted">状态</dt><dd className="text-right text-foreground">{status}</dd>
        </dl>
        {!cardsV2 && <section aria-label="玩家换牌统计" className="space-y-3">
          <h3 className="text-sm font-medium">换牌统计</h3>
          {table.roll?.enabled ? <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {(["hand", "room"] as const).map(scope => <div key={scope} className="contents"><dt className="text-muted">{scope === "hand" ? "本手" : "房间累计"}</dt><dd className="flex min-w-0 flex-col gap-1 text-right text-foreground tabular-nums">{stats ? <><span className="wrap-anywhere">{amount(stats[scope].count)} 次</span><span className="wrap-anywhere">支出 {amount(stats[scope].paid)} <span className="whitespace-nowrap">{unit}</span></span></> : "暂不可用"}</dd></div>)}
          </dl> : <p className="text-sm text-muted">本房间未启用换牌</p>}
        </section>}
        {!cardsV2 && table.roll?.enabled && <section aria-label="全桌换牌统计" className="space-y-3">
          <h3 className="text-sm font-medium">全桌合计</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">{(["hand", "room"] as const).map(scope => <div key={scope} className="contents"><dt className="text-muted">{scope === "hand" ? "本手" : "房间累计"}</dt><dd className="flex min-w-0 flex-col gap-1 text-right text-foreground tabular-nums">{table.rollStats ? <><span className="wrap-anywhere">{amount(table.rollStats[scope].players)} 人 · {amount(table.rollStats[scope].count)} 次</span><span className="wrap-anywhere">支出 {amount(table.rollStats[scope].paid)} <span className="whitespace-nowrap">{unit}</span></span></> : "暂不可用"}</dd></div>)}</dl>
          <p className="text-xs text-muted">房间累计包含本手</p>
        </section>}
      </div></Modal.Body>
      <Modal.Footer><Button variant="tertiary" onPress={onClose}>关闭</Button></Modal.Footer>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>
}
