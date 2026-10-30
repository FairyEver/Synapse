import type { ComponentType } from "react"
import type { HallOverview, GameSessionView } from "@synapse/shared/game-contracts"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { GameCard } from "./GameCard"
import { MySessions } from "./MySessions"
export function HallHome({
  overview,
  onEnter,
  onSession,
  previews,
  onGrant,
}: {
  overview: HallOverview | null
  onEnter: (entry: string) => void
  onSession: (s: GameSessionView) => void
  previews: Record<string, ComponentType>
  onGrant: () => void
}) {
  if (!overview)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  const points = overview.points
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        {[
          ["总点数", points.total],
          ["可用", points.available],
          ["占用", points.inPlay],
          ["累计盈亏", points.netProfit],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-xl font-medium tabular-nums">
              {Number(value).toLocaleString("zh-CN")}
            </dd>
          </div>
        ))}
      </dl>
      {points.available === 0 && overview.sessions.length === 0 && (
        <Button type="button" onClick={onGrant}>
          领取每日补助
        </Button>
      )}
      <MySessions sessions={overview.sessions} onOpen={onSession} />
      <section className="space-y-3">
        <h2 className="font-medium">游戏</h2>
        {overview.games.map((game) => {
          const Preview = previews[game.entry]
          return (
            <GameCard
              key={game.id}
              game={game}
              available={!!Preview}
              onEnter={() => onEnter(game.entry)}
              preview={Preview ? <Preview /> : null}
            />
          )
        })}
      </section>
    </div>
  )
}
