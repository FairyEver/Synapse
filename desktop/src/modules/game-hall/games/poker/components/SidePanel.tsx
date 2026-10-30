import { ListOrdered, LockKeyhole } from "lucide-react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { PersonaBadge } from "./PersonaBadge"
import { actionLabel, amount, streetLabel } from "../lib/view"
export function SidePanel({
  table,
  perspective,
  id,
}: {
  id?: string
  table: PokerTableView
  perspective: "owner" | "public"
}) {
  const myNote =
    perspective === "owner" ? [...table.recentActions].reverse().find((a) => a.note)?.note : null
  return (
    <aside id={id} className="poker-side-panel" aria-label="日志和AI判断">
      <section className="poker-log">
        <h3>
          <ListOrdered aria-hidden="true" />
          日志
        </h3>
        {table.recentActions.length === 0 ? (
          <p className="poker-panel-empty">暂无行动</p>
        ) : (
          <ol className="poker-action-list">
            {table.recentActions.map((action) => {
              const displayName = action.displayName ?? `座位 ${action.seatNo + 1}`
              return (
                <li key={action.seq}>
                  <span className="poker-action-seq">{String(action.seq).padStart(2, "0")}</span>
                  <span className="poker-action-player">
                    <span title={displayName}>{displayName}</span>
                    <small>
                      {streetLabel[action.street] ?? action.street}
                      {action.isAuto && " · 自动"}
                    </small>
                    {perspective === "owner" && action.personaVersion && (
                      <PersonaBadge version={action.personaVersion} />
                    )}
                  </span>
                  <span className="poker-action-decision">
                    {actionLabel[action.action] ?? action.action}
                    {action.amount > 0 && <strong>{amount(action.amount)}</strong>}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </section>
      {perspective === "owner" && table.mySeatNo !== null && (
        <section className="poker-judgment">
          <h3>
            <LockKeyhole aria-hidden="true" />
            AI 的判断
            <span className="poker-private-label">仅你可见</span>
          </h3>
          <p className="poker-judgment-text">{myNote ?? "暂无判断"}</p>
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
