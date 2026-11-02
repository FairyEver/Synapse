import { useEffect, useRef, useState } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { Button, Modal } from "@heroui/react"
import { ClipboardList } from "lucide-react"
import { usePokerReady, type PokerReadyControls } from "../hooks/usePokerReady"
import { SettlementDetails } from "./SettlementDetails"
import "../styles/settlement.css"
type Props = { table: PokerTableView; perspective: "owner" | "public"; identityKey?: string; onRefresh: () => void | Promise<void>; onOpen?: () => void; compact?: boolean; ready?: PokerReadyControls; blocked?: boolean }
export function SettlementPanel(props: Props) {
  const key = `${props.identityKey}:${props.table.roomCode}:${props.perspective}`
  return props.ready ? <ScopedSettlementPanel key={key} {...props} ready={props.ready} /> : <LocalSettlementPanel key={key} {...props} />
}
function LocalSettlementPanel(props: Props) {
  const ready = usePokerReady(props.table, props.perspective, props.identityKey, props.onRefresh)
  return <ScopedSettlementPanel {...props} ready={ready} />
}
function ScopedSettlementPanel({ table, onOpen, compact, ready, blocked = false }: Props & { ready: PokerReadyControls }) {
  const settlement = table.settlement
  const [dismissed, setDismissed] = useState<string | null>(null)
  const currentSettlement = settlement?.handId === table.handId ? settlement : null
  const open = !blocked && !!currentSettlement && dismissed !== currentSettlement.handId
  const openCallback = useRef(onOpen); openCallback.current = onOpen
  useEffect(() => { if (open) openCallback.current?.() }, [open])
  if (!currentSettlement) return null
  const close = () => setDismissed(currentSettlement.handId)
  return <>
    <Button variant="tertiary" isDisabled={blocked} isIconOnly={compact} aria-label="本局结算" onPress={() => setDismissed(null)}><ClipboardList aria-hidden="true" />{!compact && "本局结算"}</Button>
    <Modal.Backdrop isOpen={open} onOpenChange={value => { if (!value) close() }} className="font-sans text-foreground scheme-light" isDismissable>
      <Modal.Container size="lg" placement="center" scroll="inside"><Modal.Dialog className="poker-result-dialog sm:max-w-3xl">
        <Modal.CloseTrigger aria-label="关闭结算，返回牌桌" />
        <Modal.Header><p className="pr-8 text-xs text-muted">第 {currentSettlement.handNo} 手 · {currentSettlement.rules.variant === "short32" ? "32 张短牌" : "标准德州扑克"} · 盲注 {currentSettlement.rules.smallBlind} / {currentSettlement.rules.bigBlind}</p><Modal.Heading>本局结算</Modal.Heading></Modal.Header>
        <Modal.Body className="min-h-0 text-foreground"><SettlementDetails key={currentSettlement.handId} settlement={currentSettlement} mode={table.mode} />
          {ready.error && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-danger">{ready.error}</p><Button variant="secondary" onPress={() => { void ready.refresh() }}>刷新牌桌</Button></div>}
        </Modal.Body>
        <Modal.Footer className="poker-result-footer flex-wrap">
          <Button variant="secondary" onPress={close}>返回牌桌</Button>
          {ready.canTakeover && <Button isPending={ready.busy} isDisabled={ready.busy} onPress={() => { void ready.takeover() }}>本人接管</Button>}
          {ready.canReady && <Button isPending={ready.busy} isDisabled={ready.prepared || ready.busy} onPress={async () => { if (await ready.ready() && table.isRoomOwner) close() }}>{ready.prepared ? "已准备" : "准备下一手"}</Button>}
        </Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
  </>
}
