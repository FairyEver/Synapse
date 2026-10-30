import { ChevronRight, Layers } from "lucide-react"
import type { GameSessionView } from "@synapse/shared/game-contracts"
import { formatGameCountdown } from "../lib/format"
export function MySessions({
  sessions,
  onOpen,
}: {
  sessions: GameSessionView[]
  onOpen: (session: GameSessionView) => void
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-balance text-sm font-medium">我的牌桌</h2>
      {sessions.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">暂无进行中的游戏</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {sessions.map((session) => (
            <button
              key={`${session.game}:${session.roomCode}`}
              type="button"
              className="game-session-row group flex w-full items-center gap-4 px-4 py-4 text-left first:rounded-t-lg last:rounded-b-lg"
              onClick={() => onOpen(session)}
            >
              <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {session.gameName}
                  <span className="ml-2 font-normal text-muted-foreground">
                    #{session.roomCode}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  座位 {(session.seatNo ?? 0) + 1}
                </span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
                <span className={session.needsAction ? "font-medium" : "text-muted-foreground"}>
                  {session.needsAction ? "轮到你的 AI" : "进行中"}
                </span>
                {session.needsAction && session.deadlineMs !== null && (
                  <span className="min-w-10 text-right tabular-nums">
                    {formatGameCountdown(session.deadlineMs)}
                  </span>
                )}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
