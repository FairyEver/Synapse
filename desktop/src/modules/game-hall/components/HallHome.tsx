import type { ComponentType } from "react"
import { Coins, Gamepad2 } from "lucide-react"
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
  artwork = {},
}: {
  overview: HallOverview | null
  onEnter: (entry: string) => void
  onSession: (s: GameSessionView) => void
  previews: Record<string, ComponentType>
  onGrant: () => void
  icons?: Record<string, ComponentType<{ className?: string }> | undefined>
  artwork?: Record<string, ComponentType | undefined>
}) {
  if (!overview)
    return (
      <div className="game-center gc-page">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="mt-6 h-80 w-full" />
      </div>
    )
  const points = overview.points
  return (
    <main className="game-center gc-page">
      <header className="gc-masthead">
        <div className="gc-heading">
          <Gamepad2 aria-hidden="true" />
          <h1>游戏中心</h1>
        </div>
        <span className="gc-meta">
          {overview.games.filter((game) => game.status === "available").length} 款游戏 ·{" "}
          {overview.sessions.length} 场进行中
        </span>
      </header>
      <div className="gc-home-layout">
        <section className="gc-library" aria-label="游戏">
          {overview.games.map((game) => {
            const Preview = previews[game.entry],
              Artwork = artwork[game.entry]
            return (
              <GameCard
                key={game.id}
                game={game}
                available={!!Preview}
                onEnter={() => onEnter(game.entry)}
                icon={icons[game.entry]}
                artwork={Artwork ? <Artwork /> : null}
                preview={Preview ? <Preview /> : null}
              />
            )
          })}
        </section>
        <section className="gc-wallet" aria-label="我的点数">
          <div className="gc-section-heading">
            <h2>我的点数</h2>
            <Coins aria-hidden="true" />
          </div>
          <dl className="gc-wallet-total">
            <dt>总点数</dt>
            <dd>{formatGameAmount(points.total)}</dd>
          </dl>
          <dl className="gc-wallet-details">
            <div>
              <dt>可用</dt>
              <dd>{formatGameAmount(points.available)}</dd>
            </div>
            <div>
              <dt>游戏中</dt>
              <dd>{formatGameAmount(points.inPlay)}</dd>
            </div>
            <div>
              <dt>累计盈亏</dt>
              <dd data-positive={points.netProfit > 0}>
                {points.netProfit > 0 ? "+" : ""}
                {formatGameAmount(points.netProfit)}
              </dd>
            </div>
          </dl>
          {points.available === 0 && overview.sessions.length === 0 && (
            <Button type="button" onClick={onGrant}>
              领取每日补助
            </Button>
          )}
        </section>
      </div>
      <MySessions sessions={overview.sessions} onOpen={onSession} />
    </main>
  )
}
