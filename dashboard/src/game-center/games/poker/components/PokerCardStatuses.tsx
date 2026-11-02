import { Accordion } from "@heroui/react"
import type { PokerCardView, PokerSeatView } from "@synapse/shared/game-contracts"
export function PokerCardStatuses({ cards, seats = [] }: { cards: PokerCardView; seats?: PokerSeatView[] }) {
  const owner = (seatNo?: number) => seatNo === undefined ? "全场" : seats.find(s => s.seatNo === seatNo)?.displayName ?? `座位 ${seatNo + 1}`
  const result = { completed: "已完成", blocked: "被阻挡", choice_required: "待选择" }
  return <Accordion allowsMultipleExpanded defaultExpandedKeys={["effects", "used"]}>
    <Accordion.Item id="effects"><Accordion.Heading><Accordion.Trigger>生效状态 {cards.statuses.length}<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading><Accordion.Panel><Accordion.Body><ul className="space-y-3 text-sm">{cards.statuses.map(status => <li key={status.id} data-status-id={status.id} className="space-y-1"><p className="wrap-anywhere"><strong>{status.title}</strong> · {owner(status.seatNo)}</p><p className="text-xs text-muted">{status.remaining === undefined ? "持续生效" : `剩余 ${status.remaining} 次`}{status.expiresStreet && " · 本轮结束消失"}{status.dispellable && " · 可驱散"}</p></li>)}</ul>{!cards.statuses.length && <p className="text-sm text-muted">暂无生效状态</p>}</Accordion.Body></Accordion.Panel></Accordion.Item>
    <Accordion.Item id="used"><Accordion.Heading><Accordion.Trigger>已使用 {cards.used.length}<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading><Accordion.Panel><Accordion.Body><ol className="space-y-2 text-sm">{cards.used.map(card => <li key={card.id} className="flex flex-wrap justify-between gap-2"><span className="wrap-anywhere">{owner(card.seatNo)} · {card.name}</span><span className="text-muted">{result[card.status]}</span></li>)}</ol></Accordion.Body></Accordion.Panel></Accordion.Item>
  </Accordion>
}
