import { useRef, type ReactNode } from "react"
import { Dialog as DialogPrimitive, RadioGroup as RadioPrimitive } from "radix-ui"
import { ArrowRight, Check, Coins, Minus, Plus, Spade, Users, X } from "lucide-react"
import type { GameFunding, PokerBlindPreset, PokerVariant } from "@synapse/shared/game-contracts"
import { Dialog, DialogTitle } from "@/components/ui/dialog"
import { RadioGroup } from "@/components/ui/radio-group"
import { track } from "@/lib/ui-tracking"
import "../styles/create-room.css"

export interface PokerRoomDraft {
  name: string
  mode: GameFunding
  variant: PokerVariant
  blindPreset: PokerBlindPreset
  maxSeats: number
  buyIn: number
}

function Choice({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadioPrimitive.Item className="poker-create-choice" value={value}>
      <span>{children}</span>
      <Check className="poker-create-check" aria-hidden="true" />
    </RadioPrimitive.Item>
  )
}

export function CreateRoomDialog({
  open, onOpenChange, value, onChange, onCreate, busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: PokerRoomDraft
  onChange: (value: PokerRoomDraft) => void
  onCreate: () => void
  busy: boolean
}) {
  const returnFocus = useRef<HTMLElement | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const update = (patch: Partial<PokerRoomDraft>) => onChange({ ...value, ...patch })
  const changeSeats = (delta: number) => {
    const maxSeats = Math.max(2, Math.min(10, value.maxSeats + delta))
    track({ component: "button", name: "poker-room-seats", action: "click", value: String(maxSeats) })
    update({ maxSeats })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-track="poker-create-room">
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="poker-create-overlay" />
        <DialogPrimitive.Content
          className="poker-create-dialog"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
            if (!busy) {
              event.preventDefault()
              nameInput.current?.focus()
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (returnFocus.current?.isConnected) returnFocus.current.focus()
          }}
        >
          <header className="poker-create-header">
            <div className="poker-create-heading">
              <Spade aria-hidden="true" />
              <DialogTitle className="poker-create-title">创建房间</DialogTitle>
            </div>
            <DialogPrimitive.Close className="poker-create-icon-button" data-slot="dialog-close" aria-label="关闭">
              <X aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>
          <form className="poker-create-form" aria-busy={busy} onSubmit={(event) => {
            event.preventDefault()
            if (!busy) {
              track({ component: "button", name: "poker-create-room", action: "click" })
              onCreate()
            }
          }}>
            <div className="poker-create-body">
              <fieldset className="poker-create-fields" disabled={busy}>
                <div className="poker-create-field">
                  <label htmlFor="poker-room-name">房间名称</label>
                  <input ref={nameInput} id="poker-room-name" className="poker-create-input" value={value.name}
                    maxLength={48} onChange={(event) => update({ name: event.target.value })}
                    onBlur={() => track({ component: "input", name: "poker-room-name", action: "change" })} />
                </div>
                <div className="poker-create-field">
                  <span id="poker-room-mode-label">房间类型</span>
                  <RadioGroup id="poker-room-mode" orientation="horizontal" aria-labelledby="poker-room-mode-label"
                    aria-describedby={`poker-room-mode-hint-${value.mode}`} className="poker-create-choices poker-create-choices-two"
                    disabled={busy} value={value.mode} onValueChange={(mode) => update({ mode: mode as GameFunding })}>
                    <Choice value="points"><Coins aria-hidden="true" />点数房</Choice>
                    <Choice value="practice"><Spade aria-hidden="true" />陪练房</Choice>
                  </RadioGroup>
                  <div className="poker-create-hints">
                    <p id="poker-room-mode-hint-points" className="poker-create-hint" aria-hidden={value.mode !== "points"}>使用大厅点数</p>
                    <p id="poker-room-mode-hint-practice" className="poker-create-hint" aria-hidden={value.mode !== "practice"}>不影响大厅点数</p>
                  </div>
                </div>
                <div className="poker-create-field">
                  <span id="poker-variant-label">牌局规则</span>
                  <RadioGroup id="poker-variant" orientation="horizontal" aria-labelledby="poker-variant-label"
                    aria-describedby={`poker-variant-hint-${value.variant}`} className="poker-create-choices poker-create-choices-two"
                    disabled={busy} value={value.variant} onValueChange={(variant) => update({ variant: variant as PokerVariant })}>
                    <Choice value="standard52">标准 52 张</Choice>
                    <Choice value="short32">短牌 32 张<small>7 至 A</small></Choice>
                  </RadioGroup>
                  <div className="poker-create-hints">
                    <p id="poker-variant-hint-standard52" className="poker-create-hint" aria-hidden={value.variant !== "standard52"}>完整 52 张牌，葫芦大于同花</p>
                    <p id="poker-variant-hint-short32" className="poker-create-hint" aria-hidden={value.variant !== "short32"}>同花大于葫芦，A789T 是最小顺子</p>
                  </div>
                </div>
                <div className="poker-create-settings">
                  <div className="poker-create-field">
                    <span id="poker-blinds-label">盲注</span>
                    <RadioGroup id="poker-blinds" orientation="horizontal" aria-labelledby="poker-blinds-label" className="poker-create-choices poker-create-choices-four"
                      disabled={busy} value={value.blindPreset} onValueChange={(blindPreset) => update({ blindPreset: blindPreset as PokerBlindPreset })}>
                      {["1/2", "2/4", "5/10", "10/20"].map((blind) => <Choice key={blind} value={blind}>{blind}</Choice>)}
                    </RadioGroup>
                  </div>
                  <div className="poker-create-field" role="group" aria-labelledby="poker-seats-label">
                    <span id="poker-seats-label">座位数</span>
                    <div className="poker-create-stepper">
                      <button type="button" className="poker-create-icon-button" aria-label="减少座位" disabled={value.maxSeats <= 2} onClick={() => changeSeats(-1)}><Minus aria-hidden="true" /></button>
                      <output id="poker-seats" aria-live="polite"><Users aria-hidden="true" /><b>{value.maxSeats}</b><small>人</small></output>
                      <button type="button" className="poker-create-icon-button" aria-label="增加座位" disabled={value.maxSeats >= 10} onClick={() => changeSeats(1)}><Plus aria-hidden="true" /></button>
                    </div>
                  </div>
                </div>
                <div className="poker-create-field">
                  <span id="poker-buyin-label">{value.mode === "practice" ? "初始筹码" : "带入点数"}</span>
                  <RadioGroup id="poker-buyin" orientation="horizontal" aria-labelledby="poker-buyin-label" className="poker-create-choices poker-create-choices-four"
                    disabled={busy} value={String(value.buyIn)} onValueChange={(buyIn) => update({ buyIn: Number(buyIn) })}>
                    {[500, 1000, 2000, 5000].map((amount) => <Choice key={amount} value={String(amount)}>{amount.toLocaleString()}</Choice>)}
                  </RadioGroup>
                </div>
              </fieldset>
            </div>
            <footer className="poker-create-footer">
              <DialogPrimitive.Close className="poker-create-cancel" type="button">取消</DialogPrimitive.Close>
              <button className="poker-create-submit" type="submit" disabled={busy}>
                {busy ? "创建中…" : "创建房间"}<ArrowRight aria-hidden="true" />
              </button>
            </footer>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  )
}
