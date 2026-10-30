import { ArrowUpRight, Radio, Timer } from "lucide-react"
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
    <section className="gc-sessions" aria-label="正在进行">
      <div className="gc-section-heading">
        <h2>正在进行</h2>
        <span className="gc-meta">{sessions.length} 场</span>
      </div>
      {sessions.length === 0 ? (
        <p className="gc-empty">
          <Radio aria-hidden="true" />
          暂无进行中的游戏
        </p>
      ) : (
        <div className="gc-session-grid">
          {sessions.map((session) => (
            <button
              key={`${session.game}:${session.roomCode}`}
              type="button"
              className="gc-session"
              data-active={session.needsAction}
              onClick={() => onOpen(session)}
            >
              <span className="gc-session-top">
                <span className="gc-session-status">
                  <i aria-hidden="true" />
                  {session.needsAction ? "轮到你的 AI" : "进行中"}
                </span>
                {session.needsAction && session.deadlineMs !== null && (
                  <span className="gc-session-timer">
                    <Timer aria-hidden="true" />
                    {formatGameCountdown(session.deadlineMs)}
                  </span>
                )}
              </span>
              <span className="gc-session-bottom">
                <span>
                  <strong>{session.gameName}</strong>
                  <span className="gc-meta">
                    #{session.roomCode}
                    {session.seatNo !== null && ` · 座位 ${session.seatNo + 1}`}
                  </span>
                </span>
                <span className="gc-session-open">
                  继续观看
                  <ArrowUpRight aria-hidden="true" />
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
