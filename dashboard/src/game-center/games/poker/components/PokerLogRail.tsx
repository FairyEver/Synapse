import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { Button, Popover, popoverVariants } from "@heroui/react"
import type { PokerHandLogEntry, PokerTableView } from "@synapse/shared/game-contracts"
import { List, type LucideIcon } from "lucide-react"
import { cardArtwork } from "../lib/card-artwork"
import { matchLog } from "../lib/match-information"
import { amount, streetLabel } from "../lib/view"
import { logActionIcon, logEntryLabel, logRollStatus } from "./MatchLog"
import "../styles/log-rail.css"

const popover = popoverVariants()
type Anchor = { seq: number; button: HTMLButtonElement }

export function PokerLogRail({ table }: { table: PokerTableView }) {
  return <HandLogRail key={table.handId ?? "idle"} table={table} />
}

function HandLogRail({ table }: { table: PokerTableView }) {
  const entries = matchLog(table).entries
  const rail = useRef<HTMLElement>(null)
  const [boundary, setBoundary] = useState<HTMLDivElement | null>(null)
  const [hovered, setHovered] = useState<Anchor | null>(null)
  const [focused, setFocused] = useState<Anchor | null>(null)
  const [pinned, setPinned] = useState<Anchor | null>(null)
  const clearHover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tipId = useId()
  const active = hovered ?? focused ?? pinned
  const button = active?.button ?? null
  const anchorRef = useMemo(() => ({ current: button }), [button])
  const current = entries.find(entry => entry.seq === active?.seq)

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
      if (event.key !== "Escape" || (event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"]'))) return
      event.preventDefault()
      event.stopPropagation()
      dismiss()
    }
    document.addEventListener("keydown", escape, true)
    return () => document.removeEventListener("keydown", escape, true)
  }, [!!current, dismiss])

  return <>
    <aside ref={rail} className="poker-log-rail bg-background text-foreground" aria-label="本手公开日志">
      <List aria-hidden="true" className="mx-auto size-4 shrink-0 text-muted" />
      <ol className="poker-log-entries">
        {[...entries].reverse().map(entry => {
          const selected = current?.seq === entry.seq
          const Icon = logActionIcon(entry)
          return <li key={entry.seq}>
            <Button type="button" isIconOnly size="sm" variant={selected ? "secondary" : "tertiary"}
              className="poker-log-entry" data-log-seq={entry.seq} data-card-art={!!entry.card}
              aria-label={`${entry.displayName}，${logEntryLabel(entry)}`}
              aria-expanded={selected} aria-describedby={selected ? tipId : undefined}
              onPointerEnter={event => {
                if (event.pointerType !== "mouse") return
                keepHover()
                setHovered({ seq: entry.seq, button: event.currentTarget })
              }}
              onPointerLeave={event => { if (event.pointerType === "mouse") leaveHover() }}
              onFocus={event => {
                const target = event.currentTarget
                if (target instanceof HTMLButtonElement) setFocused({ seq: entry.seq, button: target })
              }}
              onBlur={() => setFocused(value => value?.seq === entry.seq ? null : value)}
              onPress={event => {
                const target = event.target
                if (!(target instanceof HTMLButtonElement)) return
                if (event.pointerType !== "keyboard") setFocused(null)
                setPinned(value => value?.seq === entry.seq ? null : { seq: entry.seq, button: target })
              }}>
              <LogVisual entry={entry} Icon={Icon} />
            </Button>
          </li>
        })}
      </ol>
    </aside>
    <div ref={setBoundary} className="poker-log-tip-boundary">
      {current && boundary && <Popover.Content
        key={current.seq} isOpen isNonModal shouldSkipAnimation onOpenChange={open => { if (!open) dismiss() }}
        triggerRef={anchorRef} placement="left" shouldFlip={false} offset={8} containerPadding={8}
        boundaryElement={boundary} UNSTABLE_portalContainer={boundary}
        shouldCloseOnInteractOutside={target => !rail.current?.contains(target)}
        className={`${popover.base()} poker-log-tip font-sans text-foreground scheme-light`}
        onPointerEnter={keepHover} onPointerLeave={leaveHover}>
        <div role="tooltip" id={tipId} className="poker-log-tip-content">
          <LogVisual entry={current} Icon={logActionIcon(current)} />
          <LogDetails entry={current} practice={table.mode === "practice"} />
        </div>
      </Popover.Content>}
    </div>
  </>
}

function LogVisual({ entry, Icon }: { entry: PokerHandLogEntry; Icon: LucideIcon }) {
  return entry.card
    ? <img className="poker-log-card-art" src={cardArtwork(entry.card.artId?.split("/").at(-1) ?? entry.card.id)} alt="" loading="lazy" draggable={false} />
    : <Icon aria-hidden="true" className="poker-log-action-icon" />
}

function LogDetails({ entry, practice }: { entry: PokerHandLogEntry; practice: boolean }) {
  const units = entry.card || practice ? "筹码" : "点数"
  const cost = entry.amount ? `${amount(entry.amount)} ${units}` : ""
  const cardStatus = entry.card?.status === "blocked" ? "被阻挡" : entry.card?.status === "choice_required" ? "待选择" : "已完成"
  return <div className="min-w-0 space-y-1 wrap-anywhere">
    <strong>{logEntryLabel(entry)}</strong>
    <p className="text-muted">{entry.displayName} · {streetLabel[entry.street]}</p>
    {entry.card ? <>
      {entry.card.description && <p>{entry.card.description}</p>}
      <p>{cardStatus}{cost && ` · 实付 ${cost}入主池`}</p>
    </> : entry.roll ? <p>{logRollStatus[entry.roll.status]}{cost && ` · ${cost}`}</p> : <>
      {cost && <p>{cost}</p>}
      {entry.isAuto && <p className="text-muted">自动行动</p>}
    </>}
  </div>
}
