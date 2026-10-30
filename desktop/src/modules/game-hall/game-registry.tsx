import type { ComponentType } from "react"
import { PokerApp } from "./games/poker/PokerApp"
import { PokerPreview } from "./games/poker/components/PokerPreview"
export type GamePageProps = {
  roomCode: string | null
  onOpenRoom: (code: string | null) => void
  onBack: () => void
}
/** New games contribute an entry and renderer here; hall components do not change. */
export const GAME_RENDERERS: Record<
  string,
  { Page: ComponentType<GamePageProps>; Preview: ComponentType }
> = { "/poker": { Page: PokerApp, Preview: PokerPreview } }
