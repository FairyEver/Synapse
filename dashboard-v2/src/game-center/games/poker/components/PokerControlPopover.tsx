import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react"
import { Popover } from "@heroui/react"
import { X } from "lucide-react"
import { PokerButton } from "./PokerButton"

/** The game owns the anchor and portal so floating controls keep the table coordinate space. */
export function PokerControlPopover({ open, onOpenChange, trigger, container, title, id, side = "top", restoreFocus = true, onEscape, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: RefObject<HTMLButtonElement | null>
  container?: HTMLElement | null
  title: string
  id?: string
  side?: "top" | "bottom"
  restoreFocus?: boolean
  onEscape?: () => void
  children: ReactNode
}) {
  const interactedOutside = useRef(false)
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    if (open) interactedOutside.current = false
    else if (wasOpen.current && restoreFocus && !interactedOutside.current && trigger.current?.isConnected) trigger.current.focus()
    wasOpen.current = open
  }, [open, restoreFocus, trigger])
  useEffect(() => {
    if (!open || !onEscape) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopImmediatePropagation()
      onEscape()
    }
    document.addEventListener("keydown", escape, true)
    return () => document.removeEventListener("keydown", escape, true)
  }, [open, onEscape])
  return <Popover.Content isNonModal isOpen={open} onOpenChange={onOpenChange} className="poker-control-popover" triggerRef={trigger} UNSTABLE_portalContainer={container ?? undefined}
      boundaryElement={container ?? undefined} placement={`${side} end`} containerPadding={8} shouldSkipAnimation
      shouldCloseOnInteractOutside={target => {
        if (trigger.current?.contains(target)) return false
        interactedOutside.current = true
        return true
      }}>
      <Popover.Dialog id={id} aria-label={title}>
        <div className="poker-control-popover-heading"><span>{title}</span><PokerButton aria-label={title === "加注" || title === "下注" ? `收起${title}设置` : "关闭更多操作"} onClick={() => onOpenChange(false)}><X aria-hidden="true" /></PokerButton></div>
        {children}
      </Popover.Dialog>
    </Popover.Content>
}
