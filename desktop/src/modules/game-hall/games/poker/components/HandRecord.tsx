import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useGameQuery } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"
import { Card } from "./Card"
import { PersonaBadge } from "./PersonaBadge"
import { recordStreets } from "../lib/record-streets"
import { actionLabel, amount } from "../lib/view"
export function HandRecord() {
  const [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<{ roomCode: string; handNo: number } | null>(null)
  const history = useGameQuery(
    () => gameApi().poker.hand.history({ offset, limit: 50 }),
    `poker:history:${offset}`,
  )
  const detail = useGameQuery(
    () => gameApi().poker.hand.detail(selected!),
    `poker:detail:${selected?.roomCode}:${selected?.handNo}`,
    0,
    !!selected,
  )
  const streets = detail.data ? recordStreets(detail.data.board, detail.data.actions) : []
  return (
    <div className="grid min-h-full grid-cols-1 lg:grid-cols-3">
      <div className="space-y-3 border-r p-4">
        <h2 className="font-medium">牌局记录</h2>
        {!history.data ? (
          <Skeleton className="h-32 w-full" />
        ) : history.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无牌局记录</p>
        ) : (
          history.data.items.map((hand) => (
            <button
              key={hand.handId}
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-md p-3 text-left hover:bg-muted"
              onClick={() => setSelected({ roomCode: hand.roomCode, handNo: hand.handNo })}
            >
              <span>
                #{hand.roomCode} · 第 {hand.handNo} 手
                <span className="mt-1 block text-xs text-muted-foreground">
                  {new Date(hand.createdAt).toLocaleString()}
                </span>
              </span>
              <span className="tabular-nums">
                {hand.delta > 0 ? "+" : ""}
                {amount(hand.delta)}
              </span>
            </button>
          ))
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            disabled={history.data?.nextOffset == null}
            onClick={() => setOffset(history.data?.nextOffset ?? offset)}
          >
            下一页
          </Button>
        </div>
      </div>
      <div className="space-y-6 p-6 lg:col-span-2">
        {!selected ? (
          <p className="text-sm text-muted-foreground">选择一手牌查看记录</p>
        ) : !detail.data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <h3 className="font-medium">
              #{detail.data.roomCode} · 第 {detail.data.handNo} 手
            </h3>
            <div className="flex gap-1" data-card-size="sm">
              {detail.data.board.map((card, i) => (
                <Card key={i} card={card} />
              ))}
            </div>
            <div className="flex flex-wrap gap-5">
              {detail.data.seats.map((s) => (
                <div key={s.seatNo} className="space-y-2">
                  <p className="text-sm">
                    {s.displayName}
                    {s.endingStack !== null && (
                      <span className="ml-2 text-muted-foreground tabular-nums">
                        {s.endingStack > s.startingStack ? "赢 " : "净盈亏 "}
                        {s.endingStack > s.startingStack ? "+" : ""}
                        {amount(s.endingStack - s.startingStack)}
                      </span>
                    )}
                  </p>
                  <div className="flex gap-1" data-card-size="xs">
                    {s.hole?.map((card, i) => (
                      <Card key={i} card={card} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {streets.map((street) => (
              <section key={street.street} className="space-y-3">
                <h4 className="text-sm font-medium">{street.label}</h4>
                {street.board.length > 0 && (
                  <div className="flex gap-1" data-card-size="xs">
                    {street.board.map((card, i) => (
                      <Card key={i} card={card} />
                    ))}
                  </div>
                )}{" "}
                <ol className="space-y-4">
                  {street.actions.map((action) => (
                    <li
                      key={action.seq}
                      className="flex flex-wrap items-start gap-3 border-b pb-3 text-sm"
                    >
                      <span>
                        {detail.data!.seats.find((s) => s.seatNo === action.seatNo)?.displayName}
                      </span>
                      <span>
                        {actionLabel[action.action] ?? action.action}{" "}
                        {action.amount ? amount(action.amount) : ""}
                      </span>
                      <span className="text-muted-foreground">底池 {amount(action.potAfter)}</span>
                      {Object.hasOwn(action, "personaVersion") && (
                        <PersonaBadge version={action.personaVersion} />
                      )}
                      <span>{action.note}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
