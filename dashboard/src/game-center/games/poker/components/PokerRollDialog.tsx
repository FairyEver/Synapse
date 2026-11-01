import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Button, Label, Modal, Radio, RadioGroup } from "@heroui/react"
import type { PokerRollKind, PokerTableView } from "@synapse/shared/game-contracts"
import type { usePokerRoll } from "../hooks/usePokerRoll"
import { Card } from "./Card"
import { amount } from "../lib/view"

export function PokerRollDialog({table,open,onOpenChange,controls,disabled,epoch,onTakeover}: {
  table:PokerTableView;open:boolean;onOpenChange:(open:boolean)=>void
  controls:ReturnType<typeof usePokerRoll>;disabled:boolean;epoch:string;onTakeover:()=>void
}) {
  const [kind,setKind]=useState<PokerRollKind>("normal"),[card,setCard]=useState(""),[candidate,setCandidate]=useState("")
  const pending=table.roll?.pending,offer=table.roll?.[kind]
  const prior=useRef(false),origin=useRef<HTMLElement|null>(null)
  if(open&&!prior.current) origin.current=document.activeElement instanceof HTMLElement?document.activeElement:null
  useLayoutEffect(()=>{if(!open&&prior.current&&origin.current?.isConnected) origin.current.focus();prior.current=open},[open])
  useEffect(()=>{setKind("normal");setCard("");setCandidate("")},[epoch,table.roll?.normal?.fee,table.roll?.super?.fee,pending?.rollId])
  const blocked=disabled||controls.blocked||controls.storageError||!controls.canControl
  return <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange} className="font-sans text-foreground scheme-light">
    <Modal.Container size="sm"><Modal.Dialog>
      <Modal.CloseTrigger aria-label="关闭换牌" />
      <Modal.Header><Modal.Heading className="pr-8 wrap-anywhere">{pending?"选择替换牌":"Roll 换牌"}</Modal.Heading></Modal.Header>
      <Modal.Body><div className="space-y-5">
        {pending ? <>
          <p className="text-sm text-muted">替换第 {pending.cardIndex+1} 张手牌 · 费用已支付。关闭后仍须完成选择，倒计时继续。</p>
          {!controls.canControl && <p role="status" className="text-sm">AI 控制中，请先本人接管再选择。</p>}
          <RadioGroup variant="secondary" value={candidate} onChange={setCandidate} isDisabled={blocked} orientation="horizontal">
            <Label>保留一张</Label><div className="flex flex-wrap gap-4" data-card-size="sm">{pending.candidates.map((value,index)=><Radio key={index} value={String(index)} aria-label={`候选 ${index+1} ${value}`}><Radio.Content><Radio.Control><Radio.Indicator/></Radio.Control><Card card={value}/></Radio.Content></Radio>)}</div>
          </RadioGroup>
        </> : <>
          <p className="text-sm text-muted">本手已换 {table.roll?.count??0} 次 · 下一次第 {(table.roll?.count??0)+1} 次</p>
          <RadioGroup variant="secondary" value={kind} onChange={value=>setKind(value as PokerRollKind)} isDisabled={blocked}>
            <Label>换牌方式</Label>{(["normal","super"] as const).map(value=><Radio key={value} value={value} isDisabled={!table.roll?.[value]?.available}><Radio.Content><Radio.Control><Radio.Indicator/></Radio.Control>{value==="normal"?"普通 · 随机一张":"超级 · 三选一"} · {amount(table.roll?.[value]?.fee??0)}</Radio.Content>{!table.roll?.[value]?.available&&<span className="text-xs text-muted">当前不可用</span>}</Radio>)}
          </RadioGroup>
          <RadioGroup variant="secondary" value={card} onChange={setCard} isDisabled={blocked} orientation="horizontal">
            <Label>替换手牌</Label><div className="flex flex-wrap gap-4" data-card-size="sm">{(table.hole??[]).map((value,index)=><Radio key={index} value={String(index)} aria-label={`替换第 ${index+1} 张 ${value}`}><Radio.Content><Radio.Control><Radio.Indicator/></Radio.Control><Card card={value}/></Radio.Content></Radio>)}</div>
          </RadioGroup>
          <p className="text-sm text-muted">费用不计入下注；补偿在本手结算后到账。换牌不延长行动时间。</p>
        </>}
        {controls.error&&<p role="alert" className="text-sm text-danger">{controls.error}</p>}
        {controls.uncertain&&<p role="status" className="text-sm">结果待核对，保留原请求。</p>}
      </div></Modal.Body>
      <Modal.Footer className="flex-wrap">
        <Button variant="tertiary" onPress={()=>onOpenChange(false)}>{pending?"稍后选择":"取消"}</Button>
        {controls.storageError?<Button isDisabled={controls.busy} onPress={()=>void controls.retry()}>重试恢复记录</Button>:controls.uncertain?<Button isDisabled={controls.busy} onPress={()=>void controls.retry()}>核对原换牌请求</Button>:pending&&!controls.canControl?<Button isDisabled={disabled||controls.blocked} onPress={onTakeover}>本人接管</Button>:pending?<Button isDisabled={blocked||candidate===""} onPress={()=>void controls.choose(Number(candidate))}>确认选择</Button>:<Button isDisabled={blocked||card===""||!offer?.available} onPress={()=>void controls.start(kind,Number(card),offer!.fee)}>确认支付 {amount(offer?.fee??0)} 换牌</Button>}
      </Modal.Footer>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>
}
