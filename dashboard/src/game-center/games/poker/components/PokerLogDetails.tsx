import type { PokerHandLogEffect, PokerHandLogEntry } from "@synapse/shared/game-contracts"
import { Spade } from "lucide-react"
import { cardArtwork } from "../lib/card-artwork"
import { logActionIcon, logEntryLabel, logRollStatus } from "../lib/log-appearance"
import type { PokerLogItem } from "../lib/log-items"
import { amount, streetLabel } from "../lib/view"
import { Card } from "./Card"
import { PokerAbilityDetails } from "./PokerAbilityDetails"

export function PokerLogGlyph({ item }: { item: PokerLogItem }) {
  const entry = "action" in item ? item.action : null
  return entry?.card
    ? <img className="poker-log-card-art" src={cardArtwork(entry.card.artId ?? entry.card.id)} alt="" loading="lazy" draggable={false} />
    : <LogIcon entry={entry} />
}

export function PokerLogDetails({ item, practice }: { item: PokerLogItem; practice: boolean }) {
  return "action" in item ? <ActionDetails entry={item.action} practice={practice} /> :
    <div className="poker-log-summary">
      <LogIcon />
      <div className="space-y-1"><strong>{streetLabel[item.street]}</strong><LogCards cards={item.cards} /></div>
    </div>
}

function LogIcon({ entry }: { entry?: PokerHandLogEntry | null }) {
  const Icon = entry ? logActionIcon(entry) : Spade
  return <Icon aria-hidden="true" className="poker-log-action-icon" />
}

function LogCards({ cards }: { cards: string[] }) {
  return <div className="flex flex-wrap gap-1" data-card-size="xs">
    {cards.map((card, index) => <Card key={index} card={card} />)}
  </div>
}

function ActionDetails({ entry, practice }: { entry: PokerHandLogEntry; practice: boolean }) {
  const units = entry.card || practice ? "筹码" : "点数"
  const cost = entry.amount ? `${amount(entry.amount)} ${units}` : ""
  const cardStatus = entry.card?.status === "blocked" ? "被阻挡" : entry.card?.status === "choice_required" ? "待选择" : "已完成"
  return <>
    <div className="poker-log-summary">
      <LogIcon entry={entry} />
      <div className="min-w-0 space-y-1 wrap-anywhere">
        <strong>{logEntryLabel(entry)}</strong>
        <p className="text-muted">{entry.displayName} · {streetLabel[entry.street]}</p>
        {entry.card ? <p>{cardStatus}{cost && ` · 实付 ${cost}入主池`}</p> :
          entry.roll ? <p>{logRollStatus[entry.roll.status]}{cost && ` · ${cost}`}</p> : cost && <p>{cost}</p>}
        {!!entry.waivedAmount && <p>名义 {amount(entry.nominalAmount ?? entry.amount)} · 豁免 {amount(entry.waivedAmount)} {units}</p>}
        {entry.isAuto && <p className="text-muted">自动行动</p>}
        {!!entry.effects?.length && <ul className="poker-log-effects">{entry.effects.map((effect, index) =>
          <li key={index}><EffectDetail effect={effect} /></li>)}</ul>}
      </div>
    </div>
    {entry.card && <PokerAbilityDetails name={entry.card.name} artId={entry.card.artId ?? entry.card.id} description={entry.card.description} showTitle={false} />}
  </>
}

function EffectDetail({ effect }: { effect: PokerHandLogEffect }) {
  const source = effect.sourceCardName ? `${effect.sourceCardName} · ` : ""
  if (effect.kind === "revealed") return <>
    <p>{source}{effect.target.displayName}公开底牌</p>
    <LogCards cards={effect.cards} />
  </>
  return <p>{source}{effectLabel(effect)}</p>
}

function effectLabel(effect: Exclude<PokerHandLogEffect, { kind: "revealed" }>) {
  const target = "target" in effect ? effect.target?.displayName : undefined
  switch (effect.kind) {
    case "guessed": return `${effect.target.displayName}的目标底牌为${effect.color === "red" ? "红色" : "黑色"} · ${effect.matched ? "猜中" : "猜错"}`
    case "protected": return target ? `${target}触发防护` : "触发防护"
    case "blocked": return target ? `对${target}的效果被阻挡` : "效果被阻挡"
    case "installed": return target ? `持续效果对${target}生效` : "全场持续效果生效"
    case "removed": return `移除${target ? `${target}的` : ""}${effect.removedCardName ?? "持续效果"}`
    case "sparked": return "触发火花"
    case "stolen": return `${target ? `从${target}` : ""}取得 ${amount(effect.amount)} 筹码`
    case "refunded": return `取回 ${amount(effect.amount)} 筹码`
    case "distributed": return `分配 ${amount(effect.amount)} 暂存筹码`
    case "discarded": return `清理 ${amount(effect.amount)} 筹码`
    case "replaced": return `${effect.target.displayName}换了 ${effect.count} 张底牌`
    case "exchanged": return `与${effect.target.displayName}交换 ${effect.count} 张底牌`
    case "reordered": return `${effect.target.displayName}调换了两张底牌的位置`
    case "shuffled": return `${effect.targets.map(player => player.displayName).join("、")}的底牌重新分配`
    case "clock": return effect.milliseconds ? `行动时间延长 ${Math.ceil(effect.milliseconds / 1000)} 秒` : "行动时间已达上限"
  }
}
