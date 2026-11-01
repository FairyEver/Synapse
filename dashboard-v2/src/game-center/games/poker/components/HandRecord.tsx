import { GameQueryFeedback } from "../../../components/GameQueryFeedback"
import { useLayoutEffect, useRef, useState } from "react"
import type { GameFunding } from "@synapse/shared/game-contracts"
import { ModeFilter } from "./ModeFilter"
import { ArrowLeft } from "lucide-react"
import { Button } from "@heroui/react"
import { Skeleton } from "@heroui/react"
import { useGameQuery } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"
import { Card } from "./Card"
import { PersonaBadge } from "./PersonaBadge"
import "../../../styles/responsive-lists.css"
import { rollAmounts, rollEventLabel } from "../lib/roll-view"
import { recordStreets } from "../lib/record-streets"
import { actionLabel, amount } from "../lib/view"
export function HandRecord() {
  const [mode, setMode] = useState<GameFunding>("points")
  const [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<{
      roomCode: string
      handNo: number
    } | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const listScroll = useRef(0)
  const selectedButton = useRef<HTMLButtonElement | null>(null)
  const hadSelection = useRef(false)
  useLayoutEffect(() => {
    const scroller = container.current?.closest<HTMLElement>(".game-center") ?? container.current?.parentElement
    if (scroller && window.innerWidth < 1024) {
      if (selected) scroller.scrollTop = 0
      else if (hadSelection.current) {
        scroller.scrollTop = listScroll.current
        selectedButton.current?.focus({ preventScroll: true })
      }
    }
    hadSelection.current = !!selected
  }, [selected])
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
    <div ref={container} data-detail={!!selected} className="poker-records grid grid-cols-1 lg:min-h-full lg:grid-cols-3">
      <div className="poker-record-list space-y-3 border-b border-separator p-4 lg:border-r lg:border-b-0">
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
              aria-pressed={selected?.roomCode === hand.roomCode && selected.handNo === hand.handNo}
              variant={selected?.roomCode === hand.roomCode && selected.handNo === hand.handNo ? "secondary" : "ghost"} className="h-auto w-full justify-between gap-3 whitespace-normal py-3 text-left"
              onPress={event => {
                const scroller = container.current?.closest<HTMLElement>(".game-center") ?? container.current?.parentElement
                listScroll.current = scroller?.scrollTop ?? 0
                selectedButton.current = event.target as HTMLButtonElement
                setSelected({ roomCode: hand.roomCode, handNo: hand.handNo })
              }}
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
      <div className="poker-record-detail space-y-6 p-4 lg:col-span-2 lg:p-6">
        {selected && <Button variant="tertiary" className="lg:hidden" onPress={() => setSelected(null)}><ArrowLeft aria-hidden="true" />返回记录列表</Button>}
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
                        总净变化{" "}
                        {s.endingStack > s.startingStack ? "+" : ""}
                        {amount(s.endingStack - s.startingStack)}
                      </span>
                    )}
                  </p>
                  {detail.data!.rules?.ruleOptions?.roll && <p className="text-xs text-muted">Roll 支出 {amount(rollAmounts(detail.data!.rollHistory,s.seatNo).paid)} · 补偿 {amount(rollAmounts(detail.data!.rollHistory,s.seatNo).received)}</p>}
                  <div className="flex gap-1" data-card-size="xs">
                    {s.hole?.map((card, i) => (
                      <Card key={i} card={card} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {!!detail.data.rollHistory?.length && <section className="space-y-3"><h4 className="text-sm font-medium">Roll 记录</h4><ol className="space-y-2 text-sm">{detail.data.rollHistory.map((event,index)=><li key={index}>{rollEventLabel(event)}</li>)}</ol></section>}
            {!!detail.data.privateRolls?.length && <section className="space-y-3"><h4 className="text-sm font-medium">本人的换牌</h4>{detail.data.privateRolls.map(record=><div key={record.rollId} className="space-y-2 text-sm"><p>第 {record.count} 次 · 替换第 {record.cardIndex+1} 张 · 支出 {amount(record.fee)}</p><div className="flex flex-wrap gap-3" data-card-size="xs"><span><Card card={record.oldCard}/><span className="text-xs text-muted">原牌</span></span>{record.candidates.map((card,index)=><span key={index}><Card card={card}/><span className="text-xs text-muted">{index===record.selectedIndex?"已选":"候选"}</span></span>)}</div></div>)}</section>}
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
