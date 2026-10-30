import type { GameSessionView } from "@synapse/shared/game-contracts"
export function MySessions({
  sessions,
  onOpen,
}: {
  sessions: GameSessionView[]
  onOpen: (session: GameSessionView) => void
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-medium">我的牌桌</h2>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无进行中的游戏</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {sessions.map((s) => (
            <button
              key={`${s.game}:${s.roomCode}`}
              type="button"
              className="flex w-full items-center justify-between gap-4 p-3 text-left hover:bg-muted"
              onClick={() => onOpen(s)}
            >
              <span>
                {s.gameName} · #{s.roomCode} · 座位 {(s.seatNo ?? 0) + 1}
              </span>
              <span className="text-sm text-muted-foreground">
                {s.needsAction ? "轮到你的 AI" : "进行中"}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
