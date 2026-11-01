import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react"
import { Button, Drawer } from "@heroui/react"
import { PokerControlPopover } from "./PokerControlPopover"

export function PokerMembersPanel({ open, onOpenChange, compact, trigger, container, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  compact: boolean
  trigger: RefObject<HTMLButtonElement | null>
  container: HTMLElement | null
  children: ReactNode
}) {
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    if (compact && wasOpen.current && !open && trigger.current?.isConnected) trigger.current.focus()
    wasOpen.current = open
  }, [open, compact, trigger])
  if (!compact) return <PokerControlPopover open={open} onOpenChange={onOpenChange} trigger={trigger} container={container} title="成员管理" side="bottom">{children}</PokerControlPopover>
  return <Drawer.Backdrop isOpen={open} onOpenChange={onOpenChange} UNSTABLE_portalContainer={container ?? undefined} className="font-sans text-foreground scheme-light">
    <Drawer.Content placement="bottom"><Drawer.Dialog>
      <Drawer.CloseTrigger aria-label="关闭成员管理" />
      <Drawer.Header><Drawer.Heading>成员管理</Drawer.Heading></Drawer.Header>
      <Drawer.Body>{children}</Drawer.Body>
      <Drawer.Footer><Button variant="secondary" onPress={() => onOpenChange(false)}>返回牌桌</Button></Drawer.Footer>
    </Drawer.Dialog></Drawer.Content>
  </Drawer.Backdrop>
}
