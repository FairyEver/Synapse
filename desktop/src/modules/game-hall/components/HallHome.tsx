import type { ComponentType } from "react"
import type { HallOverview, GameSessionView } from "@synapse/shared/game-contracts"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { GameCard } from "./GameCard"
import { MySessions } from "./MySessions"
import { formatGameAmount } from "../lib/format"
import "../styles/hall.css"
export function HallHome({
  overview,
  onEnter,
  onSession,
  previews,
  onGrant,
  icons = {},
}: {
  overview: HallOverview | null
  onEnter: (entry: string) => void
  onSession: (s: GameSessionView) => void
  previews: Record<string, ComponentType>
  onGrant: () => void
  icons?: Record<string, ComponentType<{ className?: string }> | undefined>
}) {
  if (!overview)
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  const points = overview.points
  return (
    <div className="mx-auto max-w-5xl space-y-7 p-6 sm:p-8">
      <section className="grid gap-6 border-b pb-7 sm:grid-cols-2 lg:grid-cols-5">
        <dl className="lg:col-span-2">
          <dt className="text-sm text-muted-foreground">总点数</dt>
          <dd className="mt-2 text-3xl font-medium tabular-nums tracking-tight">
            {formatGameAmount(points.total)}
          </dd>
        </dl>
        <dl className="grid grid-cols-3 items-end gap-4 lg:col-span-3">
          {[
            ["可用", points.available],
            ["占用", points.inPlay],
            ["累计盈亏", points.netProfit],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="whitespace-nowrap text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-2 text-lg font-medium tabular-nums">
                {formatGameAmount(Number(value))}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      {points.available === 0 && overview.sessions.length === 0 && (
        <Button type="button" onClick={onGrant}>
          领取每日补助
        </Button>
      )}
      <MySessions sessions={overview.sessions} onOpen={onSession} />
      <section className="space-y-3">
        <h2 className="text-balance text-sm font-medium">游戏</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {overview.games.map((game) => {
            const Preview = previews[game.entry]
            return (
              <GameCard
                key={game.id}
                game={game}
                available={!!Preview}
                onEnter={() => onEnter(game.entry)}
                icon={icons[game.entry]}
                preview={Preview ? <Preview /> : null}
              />
            )
          })}
        </div>
      </section>
    </div>
  )
}
