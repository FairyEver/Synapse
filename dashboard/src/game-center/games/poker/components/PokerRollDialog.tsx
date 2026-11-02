import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Button, Description, Label, Modal, Radio, RadioGroup } from "@heroui/react"
import type { PokerRollKind, PokerTableView } from "@synapse/shared/game-contracts"
import type { usePokerRoll } from "../hooks/usePokerRoll"
import { Card } from "./Card"
import { amount } from "../lib/view"

const suits: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" }
const cardLabel = (card?: string) => {
  if (!card) return "未发牌"
  return `${card[0] === "T" ? "10" : card[0]}${suits[card[1]] ?? ""}`
}

export function PokerRollDialog({table,open,onOpenChange,controls,disabled,epoch,onTakeover}: {
  table:PokerTableView;open:boolean;onOpenChange:(open:boolean)=>void
  controls:ReturnType<typeof usePokerRoll>;disabled:boolean;epoch:string;onTakeover:()=>void
}) {
  const [kind,setKind]=useState<PokerRollKind>("normal"),[card,setCard]=useState(""),[candidate,setCandidate]=useState("")
  const pending=table.roll?.pending,offer=table.roll?.[kind]
  const hole=table.hole??[]
  const prior=useRef(false),origin=useRef<HTMLElement|null>(null)
  if(open&&!prior.current) origin.current=document.activeElement instanceof HTMLElement?document.activeElement:null
  useLayoutEffect(()=>{if(!open&&prior.current&&origin.current?.isConnected) origin.current.focus();prior.current=open},[open])
  useEffect(()=>{setKind(table.roll?.normal?.available?"normal":"super");setCard("");setCandidate("")},[epoch,table.roll?.normal?.available,table.roll?.super?.available,table.roll?.normal?.fee,table.roll?.super?.fee,pending?.rollId])
  const blocked=disabled||controls.blocked||controls.storageError||!controls.canControl
  return <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange} className="font-sans text-foreground scheme-light">
    <Modal.Container size="md"><Modal.Dialog>
      <Modal.CloseTrigger aria-label="关闭换牌" />
      <Modal.Header>
        <Modal.Heading className="pr-8 wrap-anywhere">{pending?"选择新牌":"Roll 换牌"}</Modal.Heading>
        <p className="pr-8 text-sm leading-5 text-muted tabular-nums">{pending?`换掉第 ${pending.cardIndex+1} 张 · 已支付`:`本手第 ${(table.roll?.count??0)+1} 次`}</p>
      </Modal.Header>
      <Modal.Body><div className="space-y-5">
        {pending ? <>
          {!controls.canControl && <p role="status" className="text-sm">AI 控制中。本人接管后可选择。</p>}
          <section aria-label="当前手牌" className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">当前手牌</h3>
            <div className="grid grid-cols-2 gap-3">
              {hole.map((value,index)=>{
                const replacing=index===pending.cardIndex
                return <div key={index} className={`flex min-w-0 flex-col items-center gap-2 rounded-xl border p-3 ${replacing?"border-accent bg-accent-soft":"border-transparent bg-surface-secondary"}`}>
                  <span className="text-xs text-muted">第 {index+1} 张</span>
                  <div data-card-size="md"><Card card={value}/></div>
                  <span className={`text-sm font-medium ${replacing?"text-accent-soft-foreground":"text-muted"}`}>{replacing?"换掉":"保留"}</span>
                </div>
              })}
            </div>
          </section>
          <RadioGroup variant="secondary" value={candidate} onChange={setCandidate} isDisabled={blocked}>
            <Label>选择新牌</Label>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {pending.candidates.map((value,index)=><Radio key={index} value={String(index)} aria-label={`选择候选 ${index+1}，${cardLabel(value)}`}>
                <Radio.Content className="group flex w-full flex-col items-center gap-2 rounded-xl border border-transparent bg-surface-secondary p-2 transition-colors data-[hovered=true]:bg-surface-tertiary data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft sm:p-3">
                  <span className="flex w-full items-center justify-between gap-1 text-xs text-muted">
                    候选 {index+1}
                    <Radio.Control><Radio.Indicator/></Radio.Control>
                  </span>
                  <div data-card-size="md"><Card card={value}/></div>
                </Radio.Content>
              </Radio>)}
            </div>
          </RadioGroup>
          <p className="text-xs text-muted">选择后继续本手。关闭不会撤销换牌。</p>
        </> : <>
          <RadioGroup variant="secondary" value={card} onChange={setCard} isDisabled={blocked}>
            <Label>选择换掉的牌</Label>
            <div className="grid grid-cols-2 gap-3">
              {hole.map((value,index)=><Radio key={index} value={String(index)} aria-label={`${card===String(index)?"换掉":"保留"}第 ${index+1} 张，${cardLabel(value)}`}>
                <Radio.Content className="group flex w-full flex-col items-center gap-2 rounded-xl border border-transparent bg-surface-secondary p-3 transition-colors data-[hovered=true]:bg-surface-tertiary data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft">
                  <span className="flex w-full items-center justify-between gap-1 text-xs text-muted">
                    第 {index+1} 张
                    <Radio.Control><Radio.Indicator/></Radio.Control>
                  </span>
                  <div data-card-size="md"><Card card={value}/></div>
                  <span className={`text-sm font-medium ${card===String(index)?"text-accent-soft-foreground":"text-muted"}`}>{card===String(index)?"换掉":"保留"}</span>
                </Radio.Content>
              </Radio>)}
            </div>
          </RadioGroup>
          <RadioGroup variant="secondary" value={kind} onChange={value=>setKind(value as PokerRollKind)} isDisabled={blocked}>
            <Label>换牌方式</Label>
            <div className="grid grid-cols-2 gap-3">
              {(["normal","super"] as const).map(value=><Radio key={value} value={value} isDisabled={!table.roll?.[value]?.available}>
                <Radio.Content className="group flex h-full w-full flex-col gap-3 rounded-xl border border-transparent bg-surface-secondary p-3 transition-colors data-[hovered=true]:bg-surface-tertiary data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft">
                  <span className="flex w-full items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium text-foreground">{value==="normal"?"普通":"超级"}</span>
                      <Description>{value==="normal"?"随机一张":"三选一"}</Description>
                    </span>
                    <Radio.Control><Radio.Indicator/></Radio.Control>
                  </span>
                  <span className="flex items-baseline gap-1 tabular-nums">
                    <span className="text-lg font-semibold text-foreground">{amount(table.roll?.[value]?.fee??0)}</span>
                    <span className="text-xs text-muted">费用</span>
                    {!table.roll?.[value]?.available&&<span className="ml-auto text-xs text-muted">不可用</span>}
                  </span>
                </Radio.Content>
              </Radio>)}
            </div>
          </RadioGroup>
          <p className="text-xs text-muted">费用不占下注，结算后补偿。</p>
        </>}
        {controls.error&&<p role="alert" className="text-sm text-danger">{controls.error}</p>}
        {controls.uncertain&&<p role="status" className="text-sm">结果待核对，保留原请求。</p>}
      </div></Modal.Body>
      <Modal.Footer className="flex-wrap">
        <Button variant="tertiary" onPress={()=>onOpenChange(false)}>{pending?"稍后选择":"取消"}</Button>
        {controls.storageError?<Button isPending={controls.busy} isDisabled={controls.busy} onPress={()=>void controls.retry()}>重试恢复记录</Button>:controls.uncertain?<Button isPending={controls.busy} isDisabled={controls.busy} onPress={()=>void controls.retry()}>核对原换牌请求</Button>:pending&&!controls.canControl?<Button isPending={controls.busy} isDisabled={disabled||controls.blocked} onPress={onTakeover}>本人接管</Button>:pending?<Button isPending={controls.busy} isDisabled={blocked||candidate===""} onPress={()=>void controls.choose(Number(candidate))}>选择这张牌</Button>:<Button isPending={controls.busy} isDisabled={blocked||card===""||!offer?.available} onPress={()=>{if(offer) void controls.start(kind,Number(card),offer.fee)}}>支付 {amount(offer?.fee??0)} 换牌</Button>}
      </Modal.Footer>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>
}
