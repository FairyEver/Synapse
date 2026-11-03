import type { PokerCardPendingView, PokerCardHandView, PokerCardPlayInput, PokerResolutionFrameView, PokerTableView } from "@synapse/shared/game-contracts"
import { amount } from "./view"

export function validCardSelections(card: PokerCardHandView, values: Record<string, string | number>): boolean {
  return Object.keys(values).length === card.choices.length && card.choices.every(choice => choice.options.some(option => option.value === String(values[choice.key])))
}
export function cardPlayInput(table: PokerTableView, card: PokerCardHandView, selections: Record<string, string | number>): PokerCardPlayInput {
  if (!table.handId || !["preflop", "flop", "turn", "river"].includes(table.street ?? "") || table.controlVersion == null || !validCardSelections(card, selections)) throw new Error("请选择有效目标")
  return { roomCode: table.roomCode, handId: table.handId, street: table.street as PokerCardPlayInput["street"], expectedActionSeq: table.actionSeq ?? 0, controlVersion: table.controlVersion, actionId: crypto.randomUUID(), instanceId: card.instanceId, selections: { ...selections }, expectedPaymentVersion: card.payment.version }
}
const reasons: Record<string, string> = {
  POKER_NOT_YOUR_TURN: "等待你的回合", POKER_ACTION_EXPIRED: "本回合已超时", POKER_CARD_CHOICE_REQUIRED: "请先完成待选",
  POKER_CARD_INSUFFICIENT_STACK: "筹码不足，须保留至少 1 筹码", POKER_CARD_INVALID_SELECTION: "暂无合法目标",
  POKER_CARD_COUNTER_ACTIVE: "反制咒已生效",
  POKER_CARD_RIVER_UNAVAILABLE: "河牌阶段无法使用", POKER_CARD_DECK_EMPTY: "扑克牌堆已空", POKER_CARD_POOL_EMPTY: "能力牌池已空",
  POKER_CARD_NO_RESERVE_SHARES: "其他玩家没有可偷取的暂存", POKER_CARD_NO_RECENT_DEPOSIT: "你最近一笔暂存没有可取回的筹码",
  POKER_CARD_NO_ABILITY_TARGET: "没有持有能力牌的对手", POKER_CARD_NO_MATERIAL: "你没有另一张能力牌",
  POKER_CARD_NO_STATUS: "没有可选的持续效果", POKER_CARD_NO_HIDDEN_HOLE: "对手没有可选的暗牌",
}
export const cardUnavailableReason = (reason?: string) => reason ? reasons[reason] ?? "当前条件不满足" : null

export function cardPlayBaseline(table: PokerTableView, card: Pick<PokerCardHandView, "instanceId" | "cardId"> | null, target?: string) {
  return {
    handId: table.handId, seq: table.actionSeq ?? 0, seatNo: table.mySeatNo,
    instanceId: card?.instanceId, cardId: card?.cardId, target,
    deadline: table.deadlineMs,
    hand: new Set(table.cards?.ownHand?.map(item => item.instanceId)),
    intel: new Set(table.cards?.privateResults?.map(item => item.id)),
    statuses: new Set(table.cards?.statuses.map(item => item.id)),
    hole: table.hole,
  }
}

export function cardChoiceBaseline(table: PokerTableView, pending: PokerCardPendingView) {
  const used = table.cards?.used.filter(item => item.cardId === pending.sourceCardId && item.seatNo === table.mySeatNo && item.status === "choice_required").at(-1)
  if (!used) return null
  return { ...cardPlayBaseline(table, null), cardId: used.cardId, seq: used.seq - 1 }
}

export function cardPlayFeedback(table: PokerTableView, before: ReturnType<typeof cardPlayBaseline> | null, frames: readonly PokerResolutionFrameView[]) {
  const cards = table.cards
  if (!before || !cards || table.handId !== before.handId || table.mySeatNo !== before.seatNo || !cards.ownHand || cards.ownHand.some(item => item.instanceId === before.instanceId)) return null
  const use = cards.used.find(item => item.seq === before.seq + 1 && item.seatNo === before.seatNo && item.cardId === before.cardId)
  if (!use || use.status === "choice_required") return null
  const events = frames.find(frame => frame.handId === before.handId && frame.seq === use.seq)?.events ?? []
  const results = cards.privateResults?.filter(item => item.cardId === use.cardId && item.label !== "候选" && !before.intel.has(item.id)) ?? []
  const drawn = cards.ownHand.filter(item => !before.hand.has(item.instanceId)).length
  const changedHole = table.hole?.length === 2 && table.hole.some((value, index) => value !== before.hole?.[index]) ? table.hole : undefined
  const guess = events.find(event => event.type === "poker.guessed")
  const gained = events.filter(event => event.type === "chips.stolen" || event.type === "chips.refunded").reduce((total, event) => total + (event.amount ?? 0), 0)
  const spark = events.some(event => event.type === "poker.sparked")
  const revealed = events.flatMap(event => event.type === "poker.revealed" && event.cards?.length
    ? [{ seatNo: event.targetSeatNo, cards: event.cards }] : [])
  const notes = [
    guess?.matched !== undefined ? `猜${guess.matched ? "中" : "错"}了 · 底牌为${guess.color === "red" ? "红色" : "黑色"}` : null,
    drawn > 0 ? `抽到 ${drawn} 张卡牌` : null,
    gained > 0 ? `获得 ${amount(gained)} 筹码` : null,
    cards.statuses.some(item => item.cardId === use.cardId && !before.statuses.has(item.id)) ? "状态已生效" : null,
    events.some(event => event.type === "ability.statusRemoved") ? "已移除状态" : null,
    before.deadline != null && table.deadlineMs != null && table.deadlineMs > before.deadline ? "行动时间已延长" : null,
    spark ? "星光已释放" : null,
    revealed.length > 0 ? "底牌已公开" : null,
  ].filter(Boolean)
  return { spark, revealed, target: before.target, title: `${use.name} · ${use.status === "blocked" ? "被防护抵挡" : notes.join(" · ") || "已使用"}`, results, changedHole }
}
