import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { Button, Popover, popoverVariants } from "@heroui/react"
import { useFocusVisible } from "react-aria"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { pokerLogGroups, pokerLogItemLabel } from "../lib/log-items"
import { PokerHistoryDialog } from "./PokerHistoryDialog"
import { PokerLogDetails, PokerLogGlyph } from "./PokerLogDetails"
import "../styles/log-rail.css"

const popover = popoverVariants()
type Anchor = { id: string; button: HTMLButtonElement }
type Props = { table: PokerTableView; historyOpen: boolean; onHistoryOpenChange: (open: boolean) => void }

export function PokerLogRail(props: Props) {
  return <HandLogRail key={props.table.handId ?? "idle"} {...props} />
}

function HandLogRail({ table, historyOpen, onHistoryOpenChange }: Props) {
  const { complete, groups } = useMemo(() => pokerLogGroups(table), [table])
  const items = useMemo(() => groups.flatMap(group => group.items).reverse(), [groups])
  const entriesRef = useRef<HTMLOListElement>(null)
  const [initialItemId, setInitialItemId] = useState<string>()
  const rail = useRef<HTMLElement>(null)
  const [boundary, setBoundary] = useState<HTMLDivElement | null>(null)
  const [hovered, setHovered] = useState<Anchor | null>(null)
  const [focused, setFocused] = useState<Anchor | null>(null)
  const [pinned, setPinned] = useState<Anchor | null>(null)
  const clearHover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tipId = useId()
  const { isFocusVisible } = useFocusVisible()
  const active = pinned ?? hovered ?? (isFocusVisible ? focused : null)
  const button = active?.button ?? null
  const anchorRef = useMemo(() => ({ current: button }), [button])
  const current = historyOpen ? undefined : items.find(item => item.id === active?.id)

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

  function changeHistory(open: boolean) {
    if (open) {
      setInitialItemId(pinned?.id)
      dismiss()
    }
    onHistoryOpenChange(open)
  }

  function jump(toStart: boolean) {
    dismiss()
    const list = entriesRef.current
    if (list) list.scrollTop = toStart ? list.scrollHeight : 0
  }

  return <>
    <aside ref={rail} className="poker-log-rail text-foreground" aria-label="本手公开日志">
      <PokerHistoryDialog open={historyOpen} onOpenChange={changeHistory} groups={groups} complete={complete}
        initialItemId={initialItemId} handNo={table.handNo} practice={table.mode === "practice"} />
      {items.length > 0 && <Button type="button" variant="ghost" size="sm" className="poker-log-command text-muted"
        aria-label="跳到最新记录" onPress={() => jump(false)}>
        最新
      </Button>}
      <ol ref={entriesRef} className="poker-log-entries" aria-label="从最新到最早">
        {items.map(item => {
          const entry = "action" in item ? item.action : null
          const selected = current?.id === item.id
          return <li key={item.id}>
            <Button type="button" isIconOnly size="sm" variant="ghost"
              className="poker-log-entry" data-log-seq={entry?.seq}
              aria-label={pokerLogItemLabel(item)}
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
                <PokerLogGlyph item={item} />
              </span>
            </Button>
          </li>
        })}
      </ol>
      {items.length > 0 && <Button type="button" variant="ghost" size="sm" className="poker-log-command text-muted"
        aria-label={complete ? "跳到开局记录" : "跳到最早记录"} onPress={() => jump(true)}>
        {complete ? "开局" : "最早"}
      </Button>}
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
        <PokerLogDetails item={current} practice={table.mode === "practice"} />
      </div>
    </Popover.Content>}
  </>
}
