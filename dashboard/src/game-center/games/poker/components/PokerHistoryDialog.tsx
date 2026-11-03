import { useId, useLayoutEffect, useRef, useState } from "react"
import { Button, Modal } from "@heroui/react"
import { ArrowDownToLine, ArrowUpToLine, PinOff } from "lucide-react"
import { logEntryLabel } from "../lib/log-appearance"
import { pokerLogItemLabel, type PokerLogGroup } from "../lib/log-items"
import { PokerLogDetails, PokerLogGlyph } from "./PokerLogDetails"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: PokerLogGroup[]
  complete: boolean
  initialItemId?: string
  handNo: number
  practice: boolean
}

export function PokerHistoryDialog({ open, onOpenChange, groups, complete, initialItemId, handNo, practice }: Props) {
  return <Modal isOpen={open} onOpenChange={onOpenChange}>
    <Button type="button" variant="secondary" size="sm" className="poker-log-command" aria-label="查看全部" isDisabled={!groups.length}>
      全部
    </Button>
    <Modal.Backdrop className="font-sans text-foreground scheme-light">
      <Modal.Container size="lg" placement="center" scroll="inside">
        <Modal.Dialog aria-label="对局历史" className="poker-history-dialog max-w-3xl">
          <Modal.CloseTrigger aria-label="关闭对局历史" />
          <HistoryContent groups={groups} complete={complete} initialItemId={initialItemId} handNo={handNo} practice={practice} />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>
}

function HistoryContent({ groups, complete, initialItemId, handNo, practice }: Omit<Props, "open" | "onOpenChange">) {
  const items = groups.flatMap(group => group.items)
  const first = items[0]
  const last = items.at(-1)
  const [previewId, setPreviewId] = useState(initialItemId)
  const [pinnedId, setPinnedId] = useState<string>()
  const [jumpRequest, setJumpRequest] = useState<{ toEnd: boolean }>()
  const detailId = useId()
  const body = useRef<HTMLDivElement>(null)
  const initialEntry = useRef<HTMLButtonElement>(null)
  const current = items.find(item => item.id === (pinnedId ?? previewId)) ?? first

  useLayoutEffect(() => {
    const scroller = body.current
    const entry = initialEntry.current
    if (scroller && entry) {
      scroller.scrollTop += entry.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    }
  }, [])

  useLayoutEffect(() => {
    const scroller = body.current
    if (scroller && jumpRequest) {
      // The selected detail changes the available timeline height on narrow screens.
      scroller.scrollTop = jumpRequest.toEnd ? scroller.scrollHeight : 0
    }
  }, [jumpRequest])

  function jump(toEnd: boolean) {
    setPinnedId(undefined)
    setPreviewId((toEnd ? last : first)?.id)
    setJumpRequest({ toEnd })
  }

  function unpin() {
    setPinnedId(undefined)
    body.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus({ preventScroll: true })
  }

  return <>
    <Modal.Header className="poker-history-header">
      <div className="space-y-1 pr-8">
        <Modal.Heading className="text-lg">对局历史</Modal.Heading>
        <p className="text-sm text-muted tabular-nums">第 {handNo} 手{!complete && " · 仅显示可用记录"}</p>
      </div>
      <nav className="poker-history-navigation" aria-label="历史定位">
        <span className="text-xs text-muted">从{complete ? "开局" : "最早"}到最新</span>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onPress={() => jump(false)}>
            <ArrowUpToLine aria-hidden="true" />{complete ? "开局" : "最早"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onPress={() => jump(true)}>
            <ArrowDownToLine aria-hidden="true" />最新
          </Button>
        </div>
      </nav>
    </Modal.Header>
    <Modal.Body ref={body} className="poker-history-body text-foreground">
      <div>
        {groups.map(group => <section key={group.id} className="poker-history-round">
          <h3 className="text-sm font-semibold">{group.label}</h3>
          <ol className="poker-history-events" aria-label={group.label}>
            {group.items.map(item => <li key={item.id}>
              <Button ref={item.id === initialItemId ? initialEntry : undefined} type="button" variant="ghost"
                className="poker-history-event" aria-label={pokerLogItemLabel(item)}
                data-current={current?.id === item.id || undefined} aria-pressed={pinnedId === item.id}
                aria-describedby={current?.id === item.id ? detailId : undefined}
                onPointerEnter={event => {
                  if (!pinnedId && event.pointerType === "mouse" && window.matchMedia("(any-hover: hover)").matches) {
                    setPreviewId(item.id)
                  }
                }}
                onFocus={event => {
                  if (!pinnedId && event.currentTarget.matches(":focus-visible")) setPreviewId(item.id)
                }}
                onPress={() => {
                  setPreviewId(item.id)
                  setPinnedId(pinnedId === item.id ? undefined : item.id)
                }}>
                <span className="poker-history-glyph"><PokerLogGlyph item={item} /></span>
                <span className="poker-history-event-label">{"action" in item ? logEntryLabel(item.action) : "发牌"}</span>
              </Button>
            </li>)}
          </ol>
        </section>)}
      </div>
    </Modal.Body>
    <Modal.Footer className={current ? "poker-history-inspector" : "hidden"}>
      {current && <section className="min-w-0 w-full" aria-label="事件详情">
        <div className="poker-history-inspector-heading">
          <span className="text-xs font-medium text-muted">事件详情</span>
          {pinnedId && <Button type="button" size="sm" variant="ghost" onPress={unpin}>
            <PinOff aria-hidden="true" />取消固定
          </Button>}
        </div>
        <div id={detailId} className="poker-history-detail" key={current.id}>
          <PokerLogDetails item={current} practice={practice} />
        </div>
      </section>}
    </Modal.Footer>
  </>
}
