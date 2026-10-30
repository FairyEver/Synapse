import type { PokerTableView } from "@synapse/shared/game-contracts"
import { PersonaBadge } from "./PersonaBadge"
import { actionLabel, amount } from "../lib/view"
export function SidePanel({
  table,
  perspective,
}: {
  table: PokerTableView
  perspective: "owner" | "public"
}) {
  const myNote =
    perspective === "owner" ? [...table.recentActions].reverse().find((a) => a.note)?.note : null
  return (
    <aside className="poker-side-panel">
      <h3>日志</h3>
      <ol className="poker-action-list">
        {table.recentActions.map((a) => (
          <li key={a.seq}>
            <span>
              {table.seats.find((s) => s.seatNo === a.seatNo)?.displayName ??
                `座位 ${a.seatNo + 1}`}
            </span>
            <span>
              {actionLabel[a.action] ?? a.action}
              {a.amount > 0 && ` ${amount(a.amount)}`}
              {a.isAuto && " · 自动"}
            </span>
            {perspective === "owner" && Object.hasOwn(a, "personaVersionId") && (
              <PersonaBadge version={a.personaVersion} />
            )}
          </li>
        ))}
      </ol>
      {perspective === "owner" && table.mySeatNo !== null && (
        <section className="poker-judgment">
          <h3>AI 的判断 · 仅你可见</h3>
          <p>{myNote ?? "暂无判断"}</p>
          {table.persona && (
            <details>
              <summary>当前风格提示词</summary>
              <p>{table.persona}</p>
            </details>
          )}
        </section>
      )}
    </aside>
  )
}
