import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { Button, Popover, popoverVariants } from "@heroui/react"
import type { PokerHandLogEffect, PokerHandLogEntry, PokerTableView } from "@synapse/shared/game-contracts"
import { Spade } from "lucide-react"
import { cardArtwork } from "../lib/card-artwork"
import { bettingStreets, matchLog } from "../lib/match-information"
import { amount, streetLabel } from "../lib/view"
import { Card } from "./Card"
import { logActionIcon, logEntryLabel, logRollStatus } from "./MatchLog"
import { PokerAbilityDetails } from "./PokerAbilityDetails"
import "../styles/log-rail.css"

const popover = popoverVariants()
type Anchor = { id: string; button: HTMLButtonElement }
type RailItem = { id: string; action: PokerHandLogEntry } | { id: string; street: string; cards: string[] }

function railItems(table: PokerTableView): RailItem[] {
  const entries = matchLog(table).entries
  const boardCount = [0, 0, 3, 4, 5]
  // The public board grows in fixed street order, even when an all-in runs out multiple streets at once.
  return bettingStreets.flatMap((street, index) => {
    const items: RailItem[] = []
    if (index > 0 && table.handId && table.board.length >= boardCount[index + 1])
      items.push({ id: street, street, cards: table.board.slice(boardCount[index], boardCount[index + 1]) })
    for (const action of entries) if (action.street === street) items.push({ id: `action:${action.seq}`, action })
    return items
  }).reverse()
}

export function PokerLogRail({ table }: { table: PokerTableView }) {
  return <HandLogRail key={table.handId ?? "idle"} table={table} />
}

function HandLogRail({ table }: { table: PokerTableView }) {
  const items = useMemo(() => railItems(table), [table])
  const rail = useRef<HTMLElement>(null)
  const [boundary, setBoundary] = useState<HTMLDivElement | null>(null)
  const [hovered, setHovered] = useState<Anchor | null>(null)
  const [focused, setFocused] = useState<Anchor | null>(null)
  const [pinned, setPinned] = useState<Anchor | null>(null)
  const clearHover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tipId = useId()
  const active = pinned ?? hovered ?? focused
  const button = active?.button ?? null
  const anchorRef = useMemo(() => ({ current: button }), [button])
  const current = items.find(item => item.id === active?.id)

  const keepHover = useCallback(() => {
    clearTimeout(clearHover.current)
  }, [])

  function leaveHover() {
    keepHover()
    clearHover.current = setTimeout(() => setHovered(null), 160)
  }

  const dismiss = useCallback(() => {
    keepHover()
    setHovered(null)
    setFocused(null)
    setPinned(null)
  }, [keepHover])

  useEffect(() => keepHover, [keepHover])
  useEffect(() => {
    if (!current) return
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || (event.target instanceof Element && event.target.closest('dialog[open], [role="dialog"], [role="alertdialog"]'))) return
      event.preventDefault()
      event.stopPropagation()
      if (pinned?.button.isConnected) pinned.button.focus({ preventScroll: true })
      dismiss()
    }
    document.addEventListener("keydown", escape, true)
    return () => document.removeEventListener("keydown", escape, true)
  }, [!!current, dismiss, pinned])

  return <>
    <aside ref={rail} className="poker-log-rail text-foreground" aria-label="本手公开日志">
      <ol className="poker-log-entries">
        {items.map(item => {
          const entry = "action" in item ? item.action : null
          const selected = current?.id === item.id
          const label = "action" in item ? `${item.action.displayName}，${logEntryLabel(item.action)}` : streetLabel[item.street]
          return <li key={item.id}>
            <Button type="button" isIconOnly size="sm" variant="ghost"
              className="poker-log-entry" data-log-seq={entry?.seq}
              aria-label={label}
              aria-expanded={selected} aria-pressed={pinned?.id === item.id} aria-describedby={selected ? tipId : undefined}
              onPointerEnter={event => {
                if (pinned || event.pointerType !== "mouse") return
                keepHover()
                setHovered({ id: item.id, button: event.currentTarget })
              }}
              onPointerLeave={event => { if (!pinned && event.pointerType === "mouse") leaveHover() }}
              onFocus={event => {
                const target = event.currentTarget
                if (!pinned && target instanceof HTMLButtonElement) setFocused({ id: item.id, button: target })
              }}
              onBlur={() => setFocused(value => value?.id === item.id ? null : value)}
              onPress={event => {
                const target = event.target
                if (!(target instanceof HTMLButtonElement)) return
                dismiss()
                if (pinned?.id !== item.id) setPinned({ id: item.id, button: target })
              }}>
              <span className="poker-log-entry-visual">
                {entry?.card
                  ? <img className="poker-log-card-art" src={cardArtwork(entry.card.artId ?? entry.card.id)} alt="" loading="lazy" draggable={false} />
                  : <LogIcon entry={entry} />}
              </span>
            </Button>
          </li>
        })}
      </ol>
    </aside>
    {/* Use the board for collision bounds and the viewport for popover coordinates. */}
    <div ref={setBoundary} className="poker-log-tip-boundary" aria-hidden="true" />
    {current && boundary && <Popover.Content
      key={current.id} isOpen isNonModal shouldSkipAnimation onOpenChange={open => { if (!open) dismiss() }}
      triggerRef={anchorRef} placement="left" shouldFlip={false} offset={8} containerPadding={8}
      boundaryElement={boundary}
      shouldCloseOnInteractOutside={target => !rail.current?.contains(target)}
      className={`${popover.base()} poker-log-tip font-sans text-foreground scheme-light`}
      onPointerEnter={keepHover} onPointerLeave={leaveHover}>
      <div role="tooltip" id={tipId} className="poker-log-tip-content">
        {"action" in current ? <ActionDetails entry={current.action} practice={table.mode === "practice"} /> :
          <div className="poker-log-summary">
            <LogIcon />
            <div className="space-y-1"><strong>{streetLabel[current.street]}</strong><LogCards cards={current.cards} /></div>
          </div>}
      </div>
    </Popover.Content>}
  </>
}

function LogIcon({ entry }: { entry?: PokerHandLogEntry | null }) {
  const Icon = entry ? logActionIcon(entry) : Spade
  return <Icon aria-hidden="true" className="poker-log-action-icon" />
}

function LogCards({ cards }: { cards: string[] }) {
  return <div className="flex flex-wrap gap-1" data-card-size="xs">
    {cards.map((card, index) => <Card key={index} card={card} />)}
  </div>
}

function ActionDetails({ entry, practice }: { entry: PokerHandLogEntry; practice: boolean }) {
  const units = entry.card || practice ? "筹码" : "点数"
  const cost = entry.amount ? `${amount(entry.amount)} ${units}` : ""
  const cardStatus = entry.card?.status === "blocked" ? "被阻挡" : entry.card?.status === "choice_required" ? "待选择" : "已完成"
  return <>
    <div className="poker-log-summary">
      <LogIcon entry={entry} />
      <div className="min-w-0 space-y-1 wrap-anywhere">
        <strong>{logEntryLabel(entry)}</strong>
        <p className="text-muted">{entry.displayName} · {streetLabel[entry.street]}</p>
        {entry.card ? <p>{cardStatus}{cost && ` · 实付 ${cost}入主池`}</p> :
          entry.roll ? <p>{logRollStatus[entry.roll.status]}{cost && ` · ${cost}`}</p> : cost && <p>{cost}</p>}
        {!!entry.waivedAmount && <p>名义 {amount(entry.nominalAmount ?? entry.amount)} · 豁免 {amount(entry.waivedAmount)} {units}</p>}
        {entry.isAuto && <p className="text-muted">自动行动</p>}
        {!!entry.effects?.length && <ul className="poker-log-effects">{entry.effects.map((effect, index) =>
          <li key={index}><EffectDetail effect={effect} /></li>)}</ul>}
      </div>
    </div>
    {entry.card && <PokerAbilityDetails name={entry.card.name} artId={entry.card.artId ?? entry.card.id} description={entry.card.description} showTitle={false} />}
  </>
}

function EffectDetail({ effect }: { effect: PokerHandLogEffect }) {
  const source = effect.sourceCardName ? `${effect.sourceCardName} · ` : ""
  if (effect.kind === "revealed") return <>
    <p>{source}{effect.target.displayName}公开底牌</p>
    <LogCards cards={effect.cards} />
  </>
  return <p>{source}{effectLabel(effect)}</p>
}

function effectLabel(effect: Exclude<PokerHandLogEffect, { kind: "revealed" }>) {
  const target = "target" in effect ? effect.target?.displayName : undefined
  switch (effect.kind) {
    case "guessed": return `${effect.target.displayName}的目标底牌为${effect.color === "red" ? "红色" : "黑色"} · ${effect.matched ? "猜中" : "猜错"}`
    case "protected": return target ? `${target}触发防护` : "触发防护"
    case "blocked": return target ? `对${target}的效果被阻挡` : "效果被阻挡"
    case "installed": return target ? `持续效果对${target}生效` : "全场持续效果生效"
    case "removed": return `移除${target ? `${target}的` : ""}${effect.removedCardName ?? "持续效果"}`
    case "sparked": return "触发火花"
    case "stolen": return `${target ? `从${target}` : ""}取得 ${amount(effect.amount)} 筹码`
    case "refunded": return `取回 ${amount(effect.amount)} 筹码`
    case "distributed": return `分配 ${amount(effect.amount)} 暂存筹码`
    case "discarded": return `清理 ${amount(effect.amount)} 筹码`
    case "replaced": return `${effect.target.displayName}换了 ${effect.count} 张底牌`
    case "exchanged": return `与${effect.target.displayName}交换 ${effect.count} 张底牌`
    case "reordered": return `${effect.target.displayName}调换了两张底牌的位置`
    case "shuffled": return `${effect.targets.map(player => player.displayName).join("、")}的底牌重新分配`
    case "clock": return effect.milliseconds ? `行动时间延长 ${Math.ceil(effect.milliseconds / 1000)} 秒` : "行动时间已达上限"
  }
}
