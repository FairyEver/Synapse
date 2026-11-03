import legacy from "../assets/ability-cards/v1/manifest.json"
import current from "../assets/ability-cards/v2/manifest.json"

const files = import.meta.glob<string>("../assets/ability-cards/*/*.png", { eager: true, query: "?url", import: "default" })
const artworks = new Map<string, string>([legacy, current].flatMap(({ assetVersion, cards }) => cards
  .filter(card => card.reviewed && card.assetVersion === assetVersion)
  .map(card => [`${assetVersion}/${card.cardId}`, files[`../assets/ability-cards/${assetVersion}/${card.file}`]] as const)))

/** URLs are bundled locally; image bytes load only when a visible card requests them. */
export function cardArtwork(artId: string): string {
  const url = artworks.get(artId.includes("/") ? artId : `v1/${artId}`)
  if (!url) throw new Error(`缺少正式卡牌封面：${artId}`)
  return url
}
