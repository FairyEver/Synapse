import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Button, Label, Modal, Radio, RadioGroup } from "@heroui/react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import type { usePokerCards } from "../hooks/usePokerCards"
import { abilityArt, cardPlayInput, cardUnavailableReason, validCardSelections } from "../lib/card-view"
import { amount, remaining, streetLabel } from "../lib/view"
import { Card } from "./Card"
import { PokerCardStatuses } from "./PokerCardStatuses"
import { PokerCardSelection } from "./PokerCardSelection"
import "../styles/cards.css"

export function PokerCardsDialog({ table, open, onOpenChange, controls, disabled, epoch }: { table: PokerTableView; open: boolean; onOpenChange: (open: boolean) => void; controls: ReturnType<typeof usePokerCards>; disabled: boolean; epoch: string }) {
  const [selected, setSelected] = useState(""), [selections, setSelections] = useState<Record<string, string | number>>({}), [candidate, setCandidate] = useState("")
  const cards = table.cards, pending = cards?.pending, hand = cards?.ownHand ?? [], card = hand.find(item => item.instanceId === selected), definition = card && cards?.definitions?.[card.cardId]
  const unit = table.mode === "practice" ? "筹码" : "点数", blocked = disabled || controls.blocked || controls.storageError || !controls.canControl
  const prior = useRef(false), origin = useRef<HTMLElement | null>(null)
  if (open && !prior.current) origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  useLayoutEffect(() => { if (!open && prior.current && origin.current?.isConnected) origin.current.focus(); prior.current = open }, [open])
  useEffect(() => { setSelected(""); setSelections({}); setCandidate("") }, [epoch, pending?.choiceId])
  const select = (value: string) => { setSelected(value); setSelections({}) }
  const confirm = () => { if (card && !blocked && card.available && validCardSelections(card, selections)) void controls.play(cardPlayInput(table, card, selections)) }
  return <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange} className="font-sans text-foreground scheme-light"><Modal.Container size="lg"><Modal.Dialog>
    <Modal.CloseTrigger aria-label="关闭卡牌" />
    <Modal.Header><Modal.Heading className="pr-8">{pending ? "选择卡牌" : "卡牌"}</Modal.Heading></Modal.Header>
    <Modal.Body className="space-y-4">
      <section aria-label="卡牌面板公共牌" className="space-y-2"><div className="flex flex-wrap justify-between gap-2 text-sm"><span>{streetLabel[table.street ?? ""]}</span>{table.deadlineMs != null && <span className="tabular-nums">剩余 {remaining(table.deadlineMs)}</span>}</div><div data-card-size="sm" className="flex justify-center gap-2">{Array.from({ length: 5 }, (_, index) => <Card key={index} card={table.board[index]} />)}</div></section>
      {pending ? <RadioGroup name="card-candidate" variant="secondary" value={candidate} onChange={setCandidate} isDisabled={blocked}>
        <Label>选择一张</Label><div className={pending.kind === "ability" ? "poker-ability-list" : "grid grid-cols-3 gap-3"}>{pending.candidates.map((value, index) => {
          const info = pending.candidateCards?.[index], art = info && abilityArt(info.artId)
          return <Radio key={`${pending.choiceId}:${index}`} value={String(index)} aria-label={`候选 ${index + 1}${info ? `，${info.name}` : ""}`}><Radio.Content className="flex min-w-0 flex-col gap-2"><span className="flex gap-2"><Radio.Control><Radio.Indicator /></Radio.Control>候选 {index + 1}</span>{pending.kind === "poker" ? <div data-card-size="md"><Card card={value} /></div> : <>{art && <img className="poker-ability-art" src={art} alt="" />}<strong className="wrap-anywhere">{info?.name}</strong><p className="text-sm wrap-anywhere">{info?.description}</p></>}</Radio.Content></Radio>
        })}</div>
      </RadioGroup> : <>
        {!hand.length ? <p className="text-sm text-muted">暂无卡牌</p> : <RadioGroup name="held-card" aria-label="持有卡牌" variant="secondary" value={selected} onChange={select} isDisabled={controls.blocked}>
          <div className="poker-ability-list">{hand.map(item => { const info = cards?.definitions?.[item.cardId], art = info && abilityArt(info.artId); return <Radio key={item.instanceId} value={item.instanceId} aria-label={info?.name}><Radio.Content className="flex min-w-0 flex-col gap-2"><span className="flex gap-2"><Radio.Control><Radio.Indicator /></Radio.Control><strong className="wrap-anywhere">{info?.name ?? "卡牌"}</strong></span>{art && <img className="poker-ability-art" src={art} alt="" />}<p className="text-sm wrap-anywhere">{info?.description}</p>{!item.available && <p className="text-xs text-muted">{cardUnavailableReason(item.reason)}</p>}</Radio.Content></Radio> })}</div>
        </RadioGroup>}
        {card && definition && <section className="space-y-4" aria-label="施放卡牌"><h3 className="font-semibold wrap-anywhere">{definition.name}</h3><p className="text-sm tabular-nums">{card.payment.nominalAmount ? `代价 ${amount(card.payment.nominalAmount)} ${unit} · 豁免 ${amount(card.payment.waivedAmount)} · 实付 ${amount(card.payment.paidAmount)} ${unit}` : "无需筹码"}</p><PokerCardSelection choices={card.choices} values={selections} onChange={setSelections} disabled={blocked || !card.available} /></section>}
      </>}
      {cards && <PokerCardStatuses cards={cards} seats={table.seats} />}
      {!!cards?.privateResults?.length && <section aria-label="本人情报" className="space-y-2"><h3 className="text-sm font-medium">本人情报</h3>{cards.privateResults.map(result => <p key={result.id} className="text-sm wrap-anywhere">{result.label}：{result.values.map(value => result.label === "能力牌" ? cards.definitions?.[value]?.name ?? value : value).join("、")}{!result.valid && "（已失效）"}</p>)}</section>}
      {controls.error && <p role="alert" className="text-sm text-danger">{controls.error}</p>}
      {controls.uncertain && <p role="status" className="text-sm">结果待核对，保留原请求。</p>}
    </Modal.Body>
    <Modal.Footer className="flex-wrap"><Button variant="tertiary" onPress={() => onOpenChange(false)}>关闭卡牌</Button>{controls.storageError || controls.uncertain ? <Button isPending={controls.busy} isDisabled={controls.busy} onPress={() => void controls.retry()}>{controls.storageError ? "重试恢复记录" : "核对原用牌请求"}</Button> : pending ? <Button isPending={controls.busy} isDisabled={blocked || candidate === ""} onPress={() => void controls.choose(Number(candidate))}>选择这张牌</Button> : <Button isPending={controls.busy} isDisabled={blocked || !card?.available || !validCardSelections(card, selections)} onPress={confirm}>使用卡牌</Button>}</Modal.Footer>
  </Modal.Dialog></Modal.Container></Modal.Backdrop>
}
