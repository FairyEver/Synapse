import type { ComponentType, ReactNode } from "react"
import { Button, Card } from "@heroui/react"
import { ArrowUpRight, Gamepad2 } from "lucide-react"
import type { GameDefinition } from "@synapse/shared/game-contracts"

export function GameCard({ game, onEnter, preview, available, artwork, icon: Icon = Gamepad2 }: {
  game: GameDefinition
  onEnter: () => void
  preview?: ReactNode
  available: boolean
  artwork?: ReactNode
  icon?: ComponentType<{ className?: string }>
}) {
  const enabled = available && game.status === "available"
  return <Card aria-label={game.name}>
    <Card.Header className="flex-row items-center gap-3"><Icon className="size-5 text-muted" /><Card.Title>{game.name}</Card.Title></Card.Header>
    {artwork && <Card.Content><div className="poker-artwork flex justify-center" aria-hidden="true">{artwork}</div></Card.Content>}
    {preview && <Card.Content>{preview}</Card.Content>}
    <Card.Footer><Button isDisabled={!enabled} onPress={onEnter}>{enabled ? "进入游戏" : "敬请期待"} · {game.name}<ArrowUpRight className="size-4" /></Button></Card.Footer>
  </Card>
}
