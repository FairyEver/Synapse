import type { PokerCardView, PokerSeatView } from "@synapse/shared/game-contracts"
export function PokerCardStageStatuses({ cards, seats = [] }: { cards: PokerCardView; seats?: PokerSeatView[] }) {
  const owner = (seatNo?: number) => seatNo === undefined ? "全场" : seats.find(s => s.seatNo === seatNo)?.displayName ?? `座位 ${seatNo + 1}`
  const result = { completed: "已完成", blocked: "被阻挡", choice_required: "待选择" }
  return <div className="stage-statuses">
    <section aria-label="生效状态"><h3>生效状态</h3><ul>{cards.statuses.map(status => <li key={status.id} data-status-id={status.id}><strong>{status.title}</strong><span>{owner(status.seatNo)}</span><small>{status.remaining === undefined ? "持续生效" : `剩余 ${status.remaining} 次`}{status.expiresStreet && " · 本轮结束消失"}{status.dispellable && " · 可驱散"}</small></li>)}</ul>{!cards.statuses.length && <p className="choice-empty">暂无生效状态</p>}</section>
    <section aria-label="已使用卡牌"><h3>已使用</h3><ol>{cards.used.map(card => <li key={card.id}><strong>{card.name}</strong><span>{owner(card.seatNo)} · {result[card.status]}</span></li>)}</ol>{!cards.used.length && <p className="choice-empty">暂无使用记录</p>}</section>
  </div>
}
