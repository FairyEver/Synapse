import { Button, Modal } from "@heroui/react"
import { BookOpen } from "lucide-react"
import type { PokerVariant } from "@synapse/shared/game-contracts"
import { HandRankGuide } from "./HandRankGuide"

export function HandRankDialog({ variant, open, onOpenChange, compact }: {
  variant?: PokerVariant
  open: boolean
  onOpenChange: (open: boolean) => void
  compact: boolean
}) {
  return <Modal isOpen={open} onOpenChange={onOpenChange}>
    <Button type="button" variant="tertiary" isIconOnly={compact} aria-label="牌型大小"><BookOpen aria-hidden="true" />{!compact && "牌型大小"}</Button>
    <Modal.Backdrop className="font-sans text-foreground scheme-light">
      <Modal.Container size="md" placement="center" scroll="inside"><Modal.Dialog>
        <Modal.CloseTrigger aria-label="关闭牌型大小" />
        <Modal.Header><Modal.Heading className="pr-8">牌型大小</Modal.Heading></Modal.Header>
        <Modal.Body><HandRankGuide variant={variant} /></Modal.Body>
        <Modal.Footer><Button slot="close" variant="secondary">返回牌桌</Button></Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
  </Modal>
}
