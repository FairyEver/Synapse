import { PokerArtwork } from "./games/poker/components/PokerArtwork"
import { Spade } from "lucide-react"
import type { ComponentType } from "react"
import { PokerApp } from "./games/poker/PokerApp"
import { PokerPreview } from "./games/poker/components/PokerPreview"
export type GamePageProps = {
  roomCode: string | null
  onOpenRoom: (code: string | null) => void
  onBack: () => void
  tab?: "rooms" | "records" | "agents"
  onTabChange?: (tab: "rooms" | "records" | "agents") => void
}
/** New games contribute an entry and renderer here; hall components do not change. */
export const GAME_RENDERERS: Record<
  string,
  {
    Page: ComponentType<GamePageProps>
    Preview: ComponentType
    Artwork?: ComponentType
    Icon?: ComponentType<{ className?: string }>
  }
> = { "/poker": { Page: PokerApp, Preview: PokerPreview, Artwork: PokerArtwork, Icon: Spade } }
