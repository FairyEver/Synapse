import { GameQueryFeedback } from "../../../components/GameQueryFeedback"
import { useState } from "react"
import type { GameFunding } from "@synapse/shared/game-contracts"
import { ModeFilter } from "./ModeFilter"
import { Button } from "@heroui/react"
import { Skeleton } from "@heroui/react"
import { useGameQuery } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"
import { Card } from "./Card"
import { PersonaBadge } from "./PersonaBadge"
import { recordStreets } from "../lib/record-streets"
import { actionLabel, amount } from "../lib/view"
export function HandRecord() {
  const [mode, setMode] = useState<GameFunding>("points")
  const [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<{
      roomCode: string
      handNo: number
    } | null>(null)
  const history = useGameQuery(
    () => gameApi().poker.hand.history({ offset, limit: 50, mode }),
    `poker:history:${mode}:${offset}`,
  )
  const detail = useGameQuery(
    () => gameApi().poker.hand.detail(selected!),
    `poker:detail:${selected?.roomCode}:${selected?.handNo}`,
    0,
    !!selected,
  )
  const streets = detail.data ? recordStreets(detail.data.board, detail.data.actions) : []
  const mixedControl = detail.data?.seats.some(seat =>
    detail.data!.actions.some(a => a.seatNo === seat.seatNo && a.actionSource === "human") &&
    detail.data!.actions.some(a => a.seatNo === seat.seatNo && a.actionSource === "mcp"),
  )
  return (
    <div className="grid grid-cols-1 lg:min-h-full lg:grid-cols-3">
      <div className="space-y-3 border-b border-separator p-4 lg:border-r lg:border-b-0">
        <h2 className="font-medium">牌局记录</h2>
        <ModeFilter value={mode} label="记录类型" onChange={(value) => { setMode(value); setOffset(0); setSelected(null) }} />
        <GameQueryFeedback query={history} />
        {!history.data ? (
          !history.error && <Skeleton className="h-32 w-full" />
        ) : history.data.items.length === 0 ? (
          <p className="text-sm text-muted">暂无牌局记录</p>
        ) : (
          history.data.items.map((hand) => (
            <Button
              key={hand.handId}
              type="button"
              variant="ghost" className="h-auto w-full justify-between gap-3 whitespace-normal py-3 text-left"
              onPress={() => setSelected({ roomCode: hand.roomCode, handNo: hand.handNo })}
            >
              <span>
                #{hand.roomCode} · 第 {hand.handNo} 手
                <span className="mt-1 block text-xs text-muted">
                  {new Date(hand.createdAt).toLocaleString()}
                  {hand.rules && ` · ${hand.rules.variant === "short32" ? "短牌 32 张" : "标准 52 张"} · ${hand.rules.smallBlind}/${hand.rules.bigBlind}`}
                </span>
              </span>
              <span className="tabular-nums">
                {hand.delta > 0 ? "+" : ""}
                {amount(hand.delta)}
              </span>
            </Button>
          ))
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            isDisabled={!offset}
            onPress={() => setOffset(Math.max(0, offset - 50))}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            isDisabled={history.data?.nextOffset == null}
            onPress={() => setOffset(history.data?.nextOffset ?? offset)}
          >
            下一页
          </Button>
        </div>
      </div>
      <div className="space-y-6 p-6 lg:col-span-2">
        <GameQueryFeedback query={detail} />
        {!selected ? (
          <p className="text-sm text-muted">选择一手牌查看记录</p>
        ) : !detail.data ? (
          !detail.error && <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <h3 className="font-medium">
              #{detail.data.roomCode} · 第 {detail.data.handNo} 手{detail.data.mode === "practice" && " · 陪练"}
            </h3>
            {detail.data.rules && <p className="text-sm text-muted">{detail.data.rules.variant === "short32" ? "短牌 32 张" : "标准 52 张"} · 盲注 {detail.data.rules.smallBlind}/{detail.data.rules.bigBlind}</p>}
            {mixedControl && <p className="text-sm text-muted">人机混合牌局</p>}
            <div className="flex gap-1" data-card-size="sm">
              {detail.data.board.map((card, i) => (
                <Card key={i} card={card} />
              ))}
            </div>
            <div className="flex flex-wrap gap-5">
              {detail.data.seats.map((s) => (
                <div key={s.seatNo} className="space-y-2">
                  <p className="text-sm">
                    {s.displayName}{s.participantKind === "bot" && " · 机器人"}
                    {s.endingStack !== null && (
                      <span className="ml-2 text-muted tabular-nums">
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
                      <span className="text-muted">底池 {amount(action.potAfter)}</span>
                      {Object.hasOwn(action, "personaVersion") && (
                        <PersonaBadge version={action.personaVersion} />
                      )}
                      {action.actionSource === "rules_bot" && <span>机器人</span>}
                      {action.actionSource === "human" && <span>真人操作</span>}
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
