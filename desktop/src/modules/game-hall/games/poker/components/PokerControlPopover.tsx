import { useEffect, useRef, type ReactNode, type RefObject } from "react"
import { X } from "lucide-react"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { PokerButton } from "./PokerButton"

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
  const anchor = useRef({ getBoundingClientRect: () => trigger.current?.getBoundingClientRect() ?? new DOMRect() })
  const interactedOutside = useRef(false)
  useEffect(() => { if (open) interactedOutside.current = false }, [open])
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverAnchor virtualRef={anchor} />
    <PopoverContent id={id} className="poker-control-popover" portalContainer={container} side={side} align="end" collisionBoundary={container ?? undefined} collisionPadding={8} aria-label={title}
      onInteractOutside={event => {
        if (event.target instanceof Node && trigger.current?.contains(event.target)) event.preventDefault()
        else interactedOutside.current = true
      }}
      onEscapeKeyDown={onEscape ? event => { event.preventDefault(); onEscape() } : undefined}
      onCloseAutoFocus={event => { event.preventDefault(); if (restoreFocus && !interactedOutside.current && trigger.current?.isConnected) trigger.current.focus() }}>
      <div className="poker-control-popover-heading"><span>{title}</span><PokerButton aria-label={title === "加注" || title === "下注" ? `收起${title}设置` : "关闭更多操作"} onClick={() => onOpenChange(false)}><X aria-hidden="true" /></PokerButton></div>
      {children}
    </PopoverContent>
  </Popover>
}
