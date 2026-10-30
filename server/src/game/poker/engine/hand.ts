import type { Card } from "./deck"
export interface HandRank {
  category: number
  kickers: number[]
}
const compare = (a: HandRank, b: HandRank): number =>
  Math.sign(
    a.category - b.category || a.kickers.reduce((r, k, i) => r || k - (b.kickers[i] ?? 0), 0),
  )
function five(cards: readonly Card[]): HandRank {
  const values = cards.map((c) => "23456789TJQKA".indexOf(c[0]) + 2).sort((a, b) => b - a)
  const groups = [...new Set(values)]
    .map((v) => ({ value: v, count: values.filter((k) => k === v).length }))
    .sort((a, b) => b.count - a.count || b.value - a.value)
  const flush = cards.every((c) => c[1] === cards[0][1])
  const unique = [...new Set(values)]
  if (unique[0] === 14) unique.push(1)
  let straight = 0
  for (let i = 0; i <= unique.length - 5; i++)
    if (unique[i] - unique[i + 4] === 4) {
      straight = unique[i]
      break
    }
  if (flush && straight) return { category: straight === 14 ? 9 : 8, kickers: [straight] }
  if (groups[0].count === 4) return { category: 7, kickers: groups.map((g) => g.value) }
  if (groups[0].count === 3 && groups[1].count === 2)
    return { category: 6, kickers: groups.map((g) => g.value) }
  if (flush) return { category: 5, kickers: values }
  if (straight) return { category: 4, kickers: [straight] }
  const category =
    groups[0].count === 3 ? 3 : groups[0].count === 2 ? (groups[1].count === 2 ? 2 : 1) : 0
  return { category, kickers: groups.map((g) => g.value) }
}
export function evaluate(cards: readonly Card[]): HandRank {
  if (
    cards.length < 5 ||
    cards.length > 7 ||
    new Set(cards).size !== cards.length ||
    cards.some((c) => !/^([2-9TJQKA])[shdc]$/.test(c))
  )
    throw new Error("无效牌面")
  let best: HandRank = { category: -1, kickers: [] }
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++) {
            const rank = five([cards[a], cards[b], cards[c], cards[d], cards[e]])
            if (compare(rank, best) > 0) best = rank
          }
  return best
}
export function compareHands(a: readonly Card[], b: readonly Card[]): number {
  return compare(evaluate(a), evaluate(b))
}
