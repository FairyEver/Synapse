import { useLayoutEffect, useRef } from "react"
import { Button, Form, Input, Label, Modal, Radio, RadioGroup, TextField } from "@heroui/react"
import { Minus, Plus } from "lucide-react"
import type { GameFunding, PokerBlindPreset, PokerVariant } from "@synapse/shared/game-contracts"
import { track } from "@/game-center/runtime/tracking"

export interface PokerRoomDraft {
  name: string
  mode: GameFunding
  variant: PokerVariant
  blindPreset: PokerBlindPreset
  maxSeats: number
  buyIn: number
}

export function CreateRoomDialog({ open, onOpenChange, value, onChange, onCreate, busy }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: PokerRoomDraft
  onChange: (value: PokerRoomDraft) => void
  onCreate: () => void
  busy: boolean
}) {
  const previouslyOpen = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  // The opener lives in the room list, outside this controlled overlay's trigger tree.
  if (open && !previouslyOpen.current) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  useLayoutEffect(() => {
    if (!open && previouslyOpen.current) {
      const target = returnFocus.current
      requestAnimationFrame(() => { if (!previouslyOpen.current && target?.isConnected) target.focus() })
    }
    previouslyOpen.current = open
  }, [open])
  const update = (patch: Partial<PokerRoomDraft>) => onChange({ ...value, ...patch })
  const changeSeats = (delta: number) => {
    const maxSeats = Math.max(2, Math.min(10, value.maxSeats + delta))
    track({ component: "button", name: "poker-room-seats", action: "click", value: String(maxSeats) })
    update({ maxSeats })
  }
  return <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog data-track="poker-create-room">
          <Modal.CloseTrigger data-slot="dialog-close" aria-label="关闭" />
          <Form className='flex min-h-0 flex-1 flex-col' aria-busy={busy} onSubmit={event => {
            event.preventDefault()
            if (!busy) {
              track({ component: "button", name: "poker-create-room", action: "click" })
              onCreate()
            }
          }}>
            <Modal.Header><Modal.Heading>创建房间</Modal.Heading></Modal.Header>
            <Modal.Body>
              <fieldset disabled={busy} className="space-y-5">
                <TextField isDisabled={busy}>
                  <Label htmlFor="poker-room-name">房间名称</Label>
                  <Input variant="secondary" autoFocus id="poker-room-name" value={value.name} maxLength={48}
                    onChange={event => update({ name: event.target.value })}
                    onBlur={() => track({ component: "input", name: "poker-room-name", action: "change" })} />
                </TextField>
                <RadioGroup variant="secondary" id="poker-room-mode" orientation="horizontal" value={value.mode} isDisabled={busy}
                  onChange={mode => update({ mode: mode as GameFunding })} aria-describedby={`poker-room-mode-hint-${value.mode}`}>
                  <Label>房间类型</Label>
                  <div className="flex flex-wrap gap-4">
                    <Radio value="points"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>点数房</Radio.Content></Radio>
                    <Radio value="practice"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>陪练房</Radio.Content></Radio>
                  </div>
                  <p id="poker-room-mode-hint-points" aria-hidden={value.mode !== "points"} className={value.mode !== "points" ? "hidden" : "text-sm text-muted"}>使用大厅点数</p>
                  <p id="poker-room-mode-hint-practice" aria-hidden={value.mode !== "practice"} className={value.mode !== "practice" ? "hidden" : "text-sm text-muted"}>不影响大厅点数</p>
                </RadioGroup>
                <RadioGroup variant="secondary" id="poker-variant" orientation="horizontal" value={value.variant} isDisabled={busy}
                  onChange={variant => update({ variant: variant as PokerVariant })} aria-describedby={`poker-variant-hint-${value.variant}`}>
                  <Label>牌局规则</Label>
                  <div className="flex flex-wrap gap-4">
                    <Radio value="standard52"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>标准 52 张</Radio.Content></Radio>
                    <Radio value="short32"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>短牌 32 张</Radio.Content></Radio>
                  </div>
                  <p id="poker-variant-hint-standard52" aria-hidden={value.variant !== "standard52"} className={value.variant !== "standard52" ? "hidden" : "text-sm text-muted"}>完整 52 张牌，葫芦大于同花</p>
                  <p id="poker-variant-hint-short32" aria-hidden={value.variant !== "short32"} className={value.variant !== "short32" ? "hidden" : "text-sm text-muted"}>同花大于葫芦，A789T 是最小顺子</p>
                </RadioGroup>
                <RadioGroup variant="secondary" id="poker-blinds" orientation="horizontal" value={value.blindPreset} isDisabled={busy}
                  onChange={blindPreset => update({ blindPreset: blindPreset as PokerBlindPreset })}>
                  <Label>盲注</Label>
                  <div className="flex flex-wrap gap-4">{["1/2", "2/4", "5/10", "10/20"].map(blind =>
                    <Radio key={blind} value={blind}><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>{blind}</Radio.Content></Radio>)}</div>
                </RadioGroup>
                <div role="group" aria-labelledby="poker-seats-label" className="space-y-2">
                  <Label id="poker-seats-label">座位数</Label>
                  <div className="flex items-center gap-4">
                    <Button isIconOnly variant="secondary" aria-label="减少座位" isDisabled={busy || value.maxSeats <= 2} onPress={() => changeSeats(-1)}><Minus /></Button>
                    <output id="poker-seats" aria-live="polite" className="tabular-nums">{value.maxSeats} 人</output>
                    <Button isIconOnly variant="secondary" aria-label="增加座位" isDisabled={busy || value.maxSeats >= 10} onPress={() => changeSeats(1)}><Plus /></Button>
                  </div>
                </div>
                <RadioGroup variant="secondary" id="poker-buyin" orientation="horizontal" value={String(value.buyIn)} isDisabled={busy}
                  onChange={buyIn => update({ buyIn: Number(buyIn) })}>
                  <Label>{value.mode === "practice" ? "初始筹码" : "带入点数"}</Label>
                  <div className="flex flex-wrap gap-4">{[500, 1000, 2000, 5000].map(amount =>
                    <Radio key={amount} value={String(amount)}><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>{amount.toLocaleString()}</Radio.Content></Radio>)}</div>
                </RadioGroup>
              </fieldset>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" slot="close">取消</Button>
              <Button type="submit" isDisabled={busy}>{busy ? "创建中…" : "创建房间"}</Button>
            </Modal.Footer>
          </Form>
        </Modal.Dialog>
      </Modal.Container>
  </Modal.Backdrop>
}
