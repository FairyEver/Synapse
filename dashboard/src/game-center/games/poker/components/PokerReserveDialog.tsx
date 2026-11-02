import { useState } from "react"
import { Button, Label, ListBox, Modal, Select } from "@heroui/react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { projectReserveRows, reserveKindLabel, reserveSourceLabel, tableReserveView, type ReserveFilter } from "../lib/reserve-view"
import { amount } from "../lib/view"

export function PokerReserveDialog({ table, onClose }: { table: PokerTableView; onClose: () => void }) {
  const [filter, setFilter] = useState<ReserveFilter>(null), reserve = tableReserveView(table)
  const rows = reserve ? projectReserveRows(reserve, filter) : [], unit = table.mode === "practice" ? "筹码" : "点数"
  const totals = rows.reduce((acc, row) => ({ ...acc, [row.kind]: acc[row.kind] + row.amount }), { deposit: 0, steal: 0, refund: 0, finalize: 0 })
  return <Modal.Backdrop isOpen onOpenChange={open => { if (!open) onClose() }} className="font-sans text-foreground scheme-light"><Modal.Container size="lg"><Modal.Dialog>
    <Modal.CloseTrigger aria-label="关闭暂存明细" /><Modal.Header><Modal.Heading className="pr-8">暂存明细</Modal.Heading></Modal.Header>
    <Modal.Body className="space-y-5">{!reserve ? <p className="text-sm text-muted">暂存明细暂不可用</p> : <>
      <dl><dt className="text-sm text-muted">当前暂存</dt><dd className="text-3xl font-semibold tabular-nums">{amount(reserve.total)} <span className="text-sm font-normal text-muted">{unit}</span></dd></dl>
      {!reserve.complete && <p role="status" className="text-sm text-muted">明细不完整；总额为全部暂存，以下仅显示已取得的记录。</p>}
      <div className="grid gap-3 sm:grid-cols-3">{(["payerKey", "beneficiaryKey", "sourceType"] as const).map(key => <Select key={key} variant="secondary" value={filter?.[key] ?? "all"} onChange={value => setFilter(current => ({ ...current, [key]: value === "all" ? undefined : String(value) }))}>
        <Label>{key === "payerKey" ? "付款人" : key === "beneficiaryKey" ? "原待分玩家" : "来源"}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="all" textValue="全部">全部<ListBox.ItemIndicator /></ListBox.Item>{key === "sourceType" ? [...new Set(reserve.lots.map(l => l.sourceType))].map(source => <ListBox.Item key={source} id={source} textValue={reserveSourceLabel(source)}>{reserveSourceLabel(source)}<ListBox.ItemIndicator /></ListBox.Item>) : reserve.players.map(player => <ListBox.Item key={player.key} id={player.key} textValue={player.displayName}>{player.displayName}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
      </Select>)}</div>
      <dl className="grid grid-cols-2 gap-3 text-sm">{Object.entries(totals).map(([key, value]) => <div key={key}><dt className="text-muted">{reserveKindLabel[key as keyof typeof reserveKindLabel]}合计</dt><dd className="tabular-nums">{amount(value)}</dd></div>)}</dl>
      <ol className="divide-y divide-separator text-sm" aria-label="暂存流水">{rows.map(row => <li key={row.id} className="space-y-2 py-3"><div className="flex flex-wrap justify-between gap-2"><strong>{reserveKindLabel[row.kind]} {amount(row.amount)}</strong><span className="text-muted">{reserveSourceLabel(row.sourceType)}</span></div><p className="wrap-anywhere">付款：{row.payerName}{row.recipientName && ` · 收到：${row.recipientName}`}</p><p className="text-xs text-muted wrap-anywhere">原待分：{row.beneficiaryNames.join("、")}</p></li>)}</ol>
      {!rows.length && <p className="text-sm text-muted">暂无匹配流水</p>}
      <section className="space-y-2 text-sm" aria-label="待分归属"><h3 className="font-medium">待分归属</h3>{reserve.players.map(player => <div key={player.key} className="flex justify-between gap-3"><span className="wrap-anywhere">{player.displayName}{player.isMe && "（你）"}</span><span className="tabular-nums">{amount(player.pending)}</span></div>)}</section>
    </>}</Modal.Body><Modal.Footer><Button variant="tertiary" onPress={onClose}>关闭</Button></Modal.Footer>
  </Modal.Dialog></Modal.Container></Modal.Backdrop>
}
