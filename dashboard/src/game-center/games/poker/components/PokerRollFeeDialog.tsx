import { useEffect, useMemo, useState } from "react"
import { Accordion, Button, Modal } from "@heroui/react"
import type { PokerRollLedger, PokerTableView } from "@synapse/shared/game-contracts"
import { selectRollLedgerEntries, summarizeRollLedger, type RollLedgerAmount, type RollLedgerFilter } from "../lib/roll-ledger"
import { amount, streetLabel } from "../lib/view"

const statusLabels = { pending: "待结算", released: "已结算", cancelled: "已取消" }
function Composition({ direction, rows, total, status, filter, onSelect }: {
  direction: RollLedgerFilter["direction"]; rows: RollLedgerAmount[]; total: number; status: string
  filter: RollLedgerFilter | null; onSelect: (filter: RollLedgerFilter) => void
}) {
  const source = direction === "source", title = source ? "费用来源" : "费用去向"
  return <section aria-label={title} className="min-w-0 space-y-3">
    <div className="flex items-baseline justify-between gap-3"><h3 className="font-medium">{title}</h3><span className="text-xs text-muted tabular-nums">合计 {amount(total)}</span></div>
    <div className="space-y-1">{rows.map(row => <Button key={row.key} size="sm" fullWidth variant={filter?.direction === direction && filter.key === row.key ? "secondary" : "ghost"} className="h-auto min-w-0 justify-start whitespace-normal text-left" aria-label={`查看${row.displayName}的${source ? "支付" : "补偿"}流水`} aria-pressed={filter?.direction === direction && filter.key === row.key} onPress={() => onSelect({ direction, key: row.key })}>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2"><span className="min-w-0 wrap-anywhere">{row.displayName}</span>{row.isMe && <span className="text-xs text-muted">你</span>}{row.folded && <span className="text-xs text-muted">已弃牌</span>}</span>
        <span className="text-xs text-muted">{row.count} {source ? "次 Roll" : `笔补偿 · ${status}`}</span>
      </span>
      <span className="flex min-w-0 max-w-1/2 flex-col items-end text-right tabular-nums"><span className="max-w-full wrap-anywhere">{amount(row.amount)}</span><span className="text-xs font-normal text-muted">{(row.amount / total * 100).toFixed(1)}%</span></span>
    </Button>)}</div>
    <p className="text-xs text-muted">{source ? "从支付玩家的桌上资金中扣除" : "扣费时确定归属，之后弃牌仍保留补偿"}</p>
  </section>
}

function LedgerBody({ ledger, handNo, unit }: { ledger: PokerRollLedger; handNo: number; unit: string }) {
  const [filter, setFilter] = useState<RollLedgerFilter | null>(null)
  const summary = useMemo(() => summarizeRollLedger(ledger), [ledger])
  const validFilter = filter && (filter.direction === "source" ? summary.sources : summary.destinations).some(row => row.key === filter.key) ? filter : null
  useEffect(() => { if (filter && !validFilter) setFilter(null) }, [filter, validFilter])
  const entries = selectRollLedgerEntries(ledger, validFilter)
  const players = new Map(ledger.players.map(player => [player.key, player]))
  const receiving = validFilter?.direction === "destination"
  const selectedName = validFilter ? players.get(validFilter.key)?.displayName : null
  const selectedTotal = entries.reduce((total, row) => total + row.amount, 0)
  const status = statusLabels[ledger.status]
  const toggleFilter = (next: RollLedgerFilter) => setFilter(current => current?.key === next.key && current.direction === next.direction ? null : next)
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-separator pb-5">
      <div><p className="text-sm text-muted">累计 Roll 费用</p><p className="text-3xl font-semibold tabular-nums wrap-anywhere">{amount(summary.total)} <span className="text-sm font-normal text-muted">{unit}</span></p></div>
      <div className="space-y-1 text-right text-sm"><p>{ledger.status === "pending" ? "全部待结算" : status}</p>{ledger.status === "pending" && <p className="text-xs text-muted">本手结束到账</p>}</div>
    </div>
    {ledger.entries.length === 0 ? <p className="py-4 text-sm text-muted">本手暂无 Roll 费用</p> : <>
      <div className="grid min-w-0 grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8">
        <Composition direction="source" rows={summary.sources} total={summary.total} status={status} filter={validFilter} onSelect={toggleFilter} />
        <Composition direction="destination" rows={summary.destinations} total={summary.total} status={status} filter={validFilter} onSelect={toggleFilter} />
      </div>
      <section aria-label="逐笔流水" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">逐笔流水</h3>{validFilter ? <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="min-w-0 text-xs text-muted wrap-anywhere" aria-live="polite">{selectedName} · {receiving ? "补偿收入" : "Roll 支出"}</span><Button size="sm" variant="tertiary" onPress={() => setFilter(null)}>查看全部</Button></div> : <span className="text-xs text-muted">展开查看分配</span>}</div>
        <Accordion key={`${validFilter?.direction}:${validFilter?.key}`} allowsMultipleExpanded defaultExpandedKeys={validFilter ? entries.map(row => row.entry.id) : []}>
          {entries.map(({ entry, index, amount: value }) => <Accordion.Item key={entry.id} id={entry.id} data-roll-entry={entry.id}>
            <Accordion.Heading><Accordion.Trigger><span className="flex min-w-0 flex-1 items-center gap-3">
              <span className="shrink-0 text-xs text-muted tabular-nums">{String(index).padStart(2, "0")}</span>
              <span className="flex min-w-0 flex-1 flex-col items-start text-left sm:flex-row sm:items-center sm:gap-4"><span className="min-w-0 flex-1 wrap-anywhere">{players.get(entry.payerKey)!.displayName}</span><span className="text-xs font-normal text-muted">{entry.kind === "normal" ? "普通 Roll" : "超级 Roll"} · {streetLabel[entry.street]}</span></span>
              <span className="max-w-1/3 text-right tabular-nums wrap-anywhere"><span className="sr-only">{receiving ? "收到" : "支付"}</span>{amount(value)}</span>
            </span><Accordion.Indicator /></Accordion.Trigger></Accordion.Heading>
            <Accordion.Panel><Accordion.Body><div className="space-y-3">
              <p className="text-xs text-muted">支付 {amount(entry.fee)} {unit} · 分给 {entry.compensations.filter(share => share.amount > 0).length} 位玩家 · {status}</p>
              <dl className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">{entry.compensations.filter(share => share.amount > 0).map(share => <div key={share.key} data-roll-allocation={share.key} className="flex min-w-0 justify-between gap-3"><dt className="min-w-0 wrap-anywhere">{players.get(share.key)!.displayName}{players.get(share.key)!.isMe && <span className="text-xs text-muted">（你）</span>}</dt><dd className="max-w-1/2 text-right tabular-nums wrap-anywhere">+{amount(share.amount)}</dd></div>)}</dl>
            </div></Accordion.Body></Accordion.Panel>
          </Accordion.Item>)}
        </Accordion>
        <div className="flex flex-wrap justify-between gap-3 text-sm tabular-nums"><span className="text-muted">{entries.length} 笔{receiving ? "补偿" : " Roll"}</span><span className="wrap-anywhere">{receiving ? "收到" : "支付"}合计 {amount(selectedTotal)} {unit}</span></div>
      </section>
    </>}
    <span className="sr-only">第 {handNo} 手费用明细</span>
  </div>
}

export function PokerRollFeeDialog({ table, onClose }: { table: PokerTableView; onClose: () => void }) {
  const ledger = table.rollLedger?.handId === table.handId ? table.rollLedger : undefined
  const unit = table.mode === "practice" ? "筹码" : "点数"
  return <Modal.Backdrop isOpen onOpenChange={open => { if (!open) onClose() }} className="font-sans text-foreground scheme-light">
    <Modal.Container size="lg" placement="center" scroll="inside" className="sm:w-full"><Modal.Dialog className="max-w-[800px]" aria-label="Roll 费用明细">
      <Modal.CloseTrigger aria-label="关闭费用明细" />
      <Modal.Header><Modal.Heading className="pr-8">Roll 费用明细</Modal.Heading><p className="text-sm text-muted">第 {table.handNo} 手 · 本手累计 · {unit}</p></Modal.Header>
      <Modal.Body className="text-foreground">{ledger ? <LedgerBody key={ledger.handId} ledger={ledger} handNo={table.handNo} unit={unit} /> : <p className="py-4 text-sm text-muted">费用明细暂不可用</p>}</Modal.Body>
      <Modal.Footer className="flex-wrap"><p className="min-w-0 flex-1 text-xs text-muted">{ledger?.status === "cancelled" ? "本手已取消，练习补偿不再发放。" : "费用全额分给其他合资格玩家，不进入底池。"}</p><Button variant="tertiary" onPress={onClose}>关闭</Button></Modal.Footer>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>
}
