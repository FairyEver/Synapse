import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react"
import { Button, Popover, popoverVariants } from "@heroui/react"
import { X } from "lucide-react"

// The trigger lives outside this component. Apply HeroUI's exported recipe without
// a DialogTrigger root, which would require its own pressable child.
const styles = popoverVariants()

/** The table owns positioning; system content keeps the default HeroUI theme. */
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
  return <Popover.Content isNonModal isOpen={open} onOpenChange={onOpenChange} className={`${styles.base()} poker-system-popover font-sans text-foreground scheme-light`} triggerRef={trigger} UNSTABLE_portalContainer={container ?? undefined}
      boundaryElement={container ?? undefined} placement={`${side} end`} containerPadding={8} shouldSkipAnimation
      shouldCloseOnInteractOutside={target => {
        if (target.closest('[role="alertdialog"]')) return false
        if (trigger.current?.contains(target)) return false
        interactedOutside.current = true
        return true
      }}>
      <Popover.Dialog id={id} aria-label={title} className={styles.dialog()}>
        <div className="mb-4 flex items-center justify-between gap-3"><Popover.Heading className={styles.heading()}>{title}</Popover.Heading><Button isIconOnly size="sm" variant="tertiary" aria-label={title === "加注" || title === "下注" ? `收起${title}设置` : "关闭更多操作"} onPress={() => onOpenChange(false)}><X aria-hidden="true" /></Button></div>
        {children}
      </Popover.Dialog>
    </Popover.Content>
}
