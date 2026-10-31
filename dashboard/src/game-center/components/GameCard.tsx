import type { ComponentType, ReactNode } from "react"
import { ArrowUpRight, Gamepad2 } from "lucide-react"
import type { GameDefinition } from "@synapse/shared/game-contracts"
export function GameCard({
  game,
  onEnter,
  preview,
  available,
  artwork,
  icon: Icon = Gamepad2,
}: {
  game: GameDefinition
  onEnter: () => void
  preview?: ReactNode
  available: boolean
  artwork?: ReactNode
  icon?: ComponentType<{ className?: string }>
}) {
  const enabled = available && game.status === "available"
  return (
    <article className="gc-game" aria-label={game.name}>
      <button type="button" className="gc-game-enter" disabled={!enabled} onClick={onEnter}>
        <span className="gc-game-copy">
          <Icon className="gc-game-icon" aria-hidden="true" />
          <span className="gc-game-title">{game.name}</span>
          <span className="gc-game-cta">
            {enabled ? "进入游戏" : "敬请期待"}
            <ArrowUpRight aria-hidden="true" />
          </span>
        </span>
        <span className="gc-game-art" aria-hidden="true">
          {artwork ?? <Icon className="gc-art-symbol" />}
        </span>
      </button>
      {preview && <div className="gc-game-recent">{preview}</div>}
    </article>
  )
}
