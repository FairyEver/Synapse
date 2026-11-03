import { Button, Modal } from "@heroui/react"
import { ListOrdered } from "lucide-react"
import type { PokerTableEvent, PokerTableView } from "@synapse/shared/game-contracts"
import { streetLabel } from "../lib/view"
import { MatchOverview } from "./MatchOverview"

type Props = {
  table: PokerTableView
  events?: readonly PokerTableEvent[]
  perspective: "owner" | "public"
  compact: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PokerMatchOverviewDialog({ table, events, perspective, compact, open, onOpenChange }: Props) {
  const settlement = table.settlement?.handId === table.handId ? table.settlement
    : events?.find(event => event.handId === table.handId && event.settlement)?.settlement
  const stage = table.status === "closed" ? "房间已解散" : streetLabel[table.street ?? ""] ?? "等待开局"
  return <Modal isOpen={open} onOpenChange={onOpenChange}>
    <Button type="button" variant="tertiary" isIconOnly={compact} aria-label="对局信息">
      <ListOrdered aria-hidden="true" />{!compact && "对局信息"}
    </Button>
    <Modal.Backdrop className="font-sans text-foreground scheme-light">
      <Modal.Container size="lg" placement="center" scroll="inside">
        <Modal.Dialog aria-label="总览">
          <Modal.CloseTrigger aria-label="关闭对局信息" />
          <Modal.Header><Modal.Heading className="pr-8">总览</Modal.Heading><p className="text-sm text-muted">第 {table.handNo} 手 · {stage}</p></Modal.Header>
          <Modal.Body><MatchOverview table={table} perspective={perspective} settlement={settlement ?? undefined} /></Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>
}
