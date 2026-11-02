import type { ComponentType } from "react"
import { Button, Card, Skeleton } from "@heroui/react"
import type { HallOverview, GameSessionView } from "@synapse/shared/game-contracts"
import { GameCard } from "./GameCard"
import { MySessions } from "./MySessions"
import { formatGameAmount } from "../lib/format"

export function HallHome({ overview, onEnter, onSession, previews, onGrant, icons = {}, artwork = {} }: {
  overview: HallOverview | null
  onEnter: (entry: string) => void
  onSession: (s: GameSessionView) => void
  previews: Record<string, ComponentType>
  onGrant: () => void
  icons?: Record<string, ComponentType<{ className?: string }> | undefined>
  artwork?: Record<string, ComponentType | undefined>
}) {
  if (!overview) return <div className="space-y-6 p-6"><Skeleton className="h-24 w-full" /><Skeleton className="h-80 w-full" /></div>
  const points = overview.points
  const metrics = [["总点数", points.total], ["可用", points.available], ["游戏中", points.inPlay], ["待结算", points.pending ?? 0], ["累计盈亏", points.netProfit]] as const
  return <div className="space-y-8 p-6 lg:p-8">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold">游戏中心</h1>
      {points.available === 0 && (points.pending ?? 0) === 0 && overview.sessions.length === 0 && <Button onPress={onGrant}>领取每日补助</Button>}
    </header>
    <section aria-label="我的点数" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map(([label, value]) => <Card key={label} className="min-w-0">
        <Card.Header><Card.Description>{label}</Card.Description></Card.Header>
        <Card.Content><p className="break-all text-3xl font-semibold tabular-nums">{formatGameAmount(value)}</p></Card.Content>
      </Card>)}
    </section>
    <section aria-label="游戏" className="grid gap-6 lg:grid-cols-2">
      {overview.games.map(game => {
        const Preview = previews[game.entry], Artwork = artwork[game.entry]
        return <GameCard key={game.id} game={game} available={!!Preview} onEnter={() => onEnter(game.entry)} icon={icons[game.entry]}
          artwork={Artwork ? <Artwork /> : null} preview={Preview ? <Preview /> : null} />
      })}
    </section>
    <MySessions sessions={overview.sessions} onOpen={onSession} />
  </div>
}
