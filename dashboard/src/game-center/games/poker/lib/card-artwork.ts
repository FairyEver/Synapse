import manifest from "../assets/ability-cards/v1/manifest.json"

const files = import.meta.glob<string>("../assets/ability-cards/v1/*.png", { eager: true, query: "?url", import: "default" })
const artworks = new Map(manifest.cards.filter(card => card.reviewed && card.assetVersion === "v1").map(card => [card.cardId, files[`../assets/ability-cards/v1/${card.file}`]]))

/** URLs are bundled locally; image bytes load only when a visible card requests them. */
export function cardArtwork(cardId: string): string {
  const url = artworks.get(cardId)
  if (!url) throw new Error(`缺少正式卡牌封面：${cardId}`)
  return url
}
