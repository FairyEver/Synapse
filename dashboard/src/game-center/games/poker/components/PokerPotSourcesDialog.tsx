import { Button, Modal } from "@heroui/react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { potSourcesView } from "../lib/pot-sources"
import { amount } from "../lib/view"

const statusLabels = { pending: "进行中", settled: "已结算", cancelled: "已取消" }
export function PokerPotSourcesDialog({ table, onClose }: { table: PokerTableView; onClose: () => void }) {
  const sources = potSourcesView(table)
  const unit = table.mode === "practice" ? "筹码" : "点数"
  return <Modal.Backdrop isOpen onOpenChange={open => { if (!open) onClose() }} className="font-sans text-foreground scheme-light">
    <Modal.Container size="lg" placement="center" scroll="inside" className="sm:w-full"><Modal.Dialog className="max-w-[800px]" aria-label="底池来源">
      <Modal.CloseTrigger aria-label="关闭底池来源" />
      <Modal.Header><Modal.Heading className="pr-8">底池来源</Modal.Heading><p className="text-sm text-muted">第 {table.handNo} 手 · {unit}</p></Modal.Header>
      <Modal.Body className="text-foreground">{sources ? <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-separator pb-5">
          <div><p className="text-sm text-muted">{sources.status === "pending" ? "当前底池" : "本手累计投入"}</p><p className="text-3xl font-semibold tabular-nums wrap-anywhere">{amount(sources.total)} <span className="text-sm font-normal text-muted">{unit}</span></p></div>
          <p className="text-sm text-muted">{statusLabels[sources.status]}</p>
        </div>
        {sources.players.length === 0 ? <p className="py-4 text-sm text-muted">本手暂无投入</p> : <section aria-label="来源分布" className="min-w-0 space-y-3">
          <h3 className="font-medium">来源分布</h3>
          <dl className="divide-y divide-separator">{sources.players.map(player => <div key={player.key} className="flex min-w-0 items-center justify-between gap-4 py-3">
            <dt className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2"><span className="min-w-0 wrap-anywhere">{player.displayName}</span>{player.isMe && <span className="text-xs text-muted">你</span>}{player.folded && <span className="text-xs text-muted">已弃牌</span>}</dt>
            <dd className="flex min-w-0 max-w-1/2 flex-col items-end text-right tabular-nums"><span className="max-w-full font-medium wrap-anywhere">{amount(player.amount)}</span><span className="text-xs text-muted">{player.percentage}%</span></dd>
          </div>)}</dl>
        </section>}
      </div> : <p className="py-4 text-sm text-muted">底池来源暂不可用</p>}</Modal.Body>
      <Modal.Footer className="flex-wrap"><p className="min-w-0 flex-1 text-xs text-muted">包含盲注与各轮下注，不含 Roll 费用。</p><Button variant="tertiary" onPress={onClose}>关闭</Button></Modal.Footer>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>
}
