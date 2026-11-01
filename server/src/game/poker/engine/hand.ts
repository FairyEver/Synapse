import { orderedDeck, type Card } from "./deck"
import type { PokerVariant } from "./rules"
export interface HandRank {
  category: number
  kickers: number[]
}
const compare = (a: HandRank, b: HandRank): number =>
  Math.sign(
    a.category - b.category || a.kickers.reduce((r, k, i) => r || k - (b.kickers[i] ?? 0), 0),
  )
function five(cards: readonly Card[], variant: PokerVariant): HandRank {
  const values = cards.map((c) => "23456789TJQKA".indexOf(c[0]) + 2).sort((a, b) => b - a)
  const groups = [...new Set(values)]
    .map((v) => ({ value: v, count: values.filter((k) => k === v).length }))
    .sort((a, b) => b.count - a.count || b.value - a.value)
  const flush = cards.every((c) => c[1] === cards[0][1])
  const unique = [...new Set(values)]
  if (unique[0] === 14) unique.push(variant === "short32" ? 6 : 1)
  let straight = 0
  for (let i = 0; i <= unique.length - 5; i++)
    if (unique[i] - unique[i + 4] === 4) {
      straight = unique[i]
      break
    }
  if (flush && straight) return { category: straight === 14 ? 9 : 8, kickers: [straight] }
  if (groups[0].count === 4) return { category: 7, kickers: groups.map((g) => g.value) }
  if (groups[0].count === 3 && groups[1].count === 2)
    return { category: variant === "short32" ? 5 : 6, kickers: groups.map((g) => g.value) }
  if (flush) return { category: variant === "short32" ? 6 : 5, kickers: values }
  if (straight) return { category: 4, kickers: [straight] }
  const category =
    groups[0].count === 3 ? 3 : groups[0].count === 2 ? (groups[1].count === 2 ? 2 : 1) : 0
  return { category, kickers: groups.map((g) => g.value) }
}
function evaluateBest(cards: readonly Card[], variant: PokerVariant): { rank: HandRank; cards: Card[] } {
  if (
    cards.length < 5 ||
    cards.length > 7 ||
    new Set(cards).size !== cards.length ||
    cards.some((c) => !orderedDeck(variant).includes(c))
  )
    throw new Error("无效牌面")
  let best: HandRank = { category: -1, kickers: [] }
  let bestCards: Card[] = []
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++) {
            const selected = [cards[a], cards[b], cards[c], cards[d], cards[e]]
            const rank = five(selected, variant)
            if (compare(rank, best) > 0) { best = rank; bestCards = selected }
          }
  return { rank: best, cards: bestCards }
}
export function evaluate(cards: readonly Card[], variant: PokerVariant = "standard52"): HandRank { return evaluateBest(cards, variant).rank }
export function bestFive(cards: readonly Card[], variant: PokerVariant = "standard52"): Card[] {
  const selected = evaluateBest(cards, variant).cards
  const ranks = selected.map(card => card[0])
  return selected.sort((a, b) => ranks.filter(rank => rank === b[0]).length - ranks.filter(rank => rank === a[0]).length || "23456789TJQKA".indexOf(b[0]) - "23456789TJQKA".indexOf(a[0]))
}
export function compareHands(a: readonly Card[], b: readonly Card[], variant: PokerVariant = "standard52"): number {
  return compare(evaluate(a, variant), evaluate(b, variant))
}

export function handRankName(cards: readonly Card[], variant: PokerVariant = "standard52"): string {
  const names = ["高牌", "一对", "两对", "三条", "顺子", ...(variant === "short32" ? ["葫芦", "同花"] : ["同花", "葫芦"]), "四条", "同花顺", "皇家同花顺"]
  return names[evaluate(cards, variant).category]
}
