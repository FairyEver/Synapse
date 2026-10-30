import type { ComponentType, ReactNode } from "react"
import { ArrowRight, Gamepad2 } from "lucide-react"
import type { GameDefinition } from "@synapse/shared/game-contracts"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardContent } from "@/components/ui/card"
export function GameCard({
  game,
  onEnter,
  preview,
  available,
  icon: Icon = Gamepad2,
}: {
  game: GameDefinition
  onEnter: () => void
  preview?: ReactNode
  available: boolean
  icon?: ComponentType<{ className?: string }>
}) {
  return (
    <Card className="gap-5">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <span className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true">
            <Icon className="size-6" />
          </span>
          <h3 className="truncate text-balance font-medium">{game.name}</h3>
        </span>
        <Button
          type="button"
          disabled={!available || game.status !== "available"}
          onClick={onEnter}
        >
          {game.status === "available" ? (
            <>
              进入
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </>
          ) : (
            "敬请期待"
          )}
        </Button>
      </CardHeader>
      {preview && <CardContent>{preview}</CardContent>}
    </Card>
  )
}
