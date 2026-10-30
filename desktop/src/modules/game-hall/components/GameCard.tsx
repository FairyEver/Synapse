import type { ReactNode } from "react"
import type { GameDefinition } from "@synapse/shared/game-contracts"
import { Button } from "@/components/ui/button"
export function GameCard({
  game,
  onEnter,
  preview,
  available,
}: {
  game: GameDefinition
  onEnter: () => void
  preview?: ReactNode
  available: boolean
}) {
  return (
    <section className="flex items-center justify-between gap-6 rounded-lg border p-5">
      <div className="space-y-3">
        <h3 className="font-medium">{game.name}</h3>
        {preview}
      </div>
      <Button type="button" disabled={!available || game.status !== "available"} onClick={onEnter}>
        {game.status === "available" ? "进入" : "敬请期待"}
      </Button>
    </section>
  )
}
