export type Card = string
export function orderedDeck(): Card[] {
  return [..."23456789TJQKA"].flatMap((rank) => [..."shdc"].map((suit) => rank + suit))
}
/** Entropy comes from the caller (production: crypto.randomInt); no IO in the engine. */
export function shuffle(
  deck: readonly Card[],
  randomInt: (exclusiveMax: number) => number,
): Card[] {
  const result = [...deck]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error("无效洗牌熵")
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
