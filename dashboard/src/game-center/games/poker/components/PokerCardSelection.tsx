import type { ComponentType } from "react"
import { Check, Shield, UserRound } from "lucide-react"
import type { PokerCardChoiceSpec, PokerCardDefinitionView, PokerCardPendingView, PokerTableView } from "@synapse/shared/game-contracts"
import { cardCandidateRequest, cardChoiceRequests, changeCardSelection, type CardSelectionRequest, type CardSelectionUI, type CardSelectionValues } from "../lib/card-selection"
import { playingCardLabel } from "../lib/view"
import { Card } from "./Card"
import { PokerAbilityCard } from "./PokerAbilityCard"

type RendererProps = { request: CardSelectionRequest; table: PokerTableView; value?: string | number; onSelect: (value: string) => void; disabled: boolean; definition?: PokerCardDefinitionView }
const Tick = () => <span className="selection-tick" aria-hidden="true"><Check /></span>
function choiceProps({ request, value, onSelect, disabled }: RendererProps, option: CardSelectionRequest["options"][number]) {
  return { type: "button" as const, "data-choice": request.key, value: option.value, "aria-pressed": String(value ?? "") === option.value, disabled, onClick: () => onSelect(option.value) }
}
function OwnHole(props: RendererProps) {
  return <div className="hole-options">{props.request.options.map(option => <button {...choiceProps(props, option)} key={option.value} className="hole-choice" aria-label={option.label}>
    <Card card={props.table.hole?.[Number(option.value)]} /><small>{option.label}</small>{String(props.value) === option.value && <Tick />}
  </button>)}</div>
}
function Players(props: RendererProps) {
  return <div className="target-options">{props.request.options.map(option => {
    const seat = props.table.seats.find(seat => String(seat.seatNo) === option.value)
    return <button {...choiceProps(props, option)} className="target-choice" key={option.value} aria-label={seat && seat.displayName !== option.label ? `${seat.displayName} · ${option.label}` : option.label}>
      <span className="avatar" aria-hidden="true">{seat?.displayName.slice(0, 1) ?? <UserRound />}</span><span>{seat?.displayName ?? option.label}{seat && seat.displayName !== option.label && <small>{option.label}</small>}</span>{String(props.value) === option.value && <Tick />}
    </button>
  })}</div>
}
function OpponentHole(props: RendererProps) {
  const groups = new Map<string, CardSelectionRequest["options"]>()
  for (const option of props.request.options) {
    const seat = option.value.split(":")[0]
    groups.set(seat, [...(groups.get(seat) ?? []), option])
  }
  return <div className="opponent-hands">{[...groups].map(([seatNo, options]) => <div className="opponent-group" key={seatNo}>
    <p className="opponent-name">{props.table.seats.find(seat => String(seat.seatNo) === seatNo)?.displayName ?? `座位${Number(seatNo) + 1}`}</p>
    <div className="opponent-slots">{options.map(option => <button {...choiceProps(props, option)} className="hidden-hole" aria-label={option.label} key={option.value}>
      <Card faceUp={false} /><small>底牌 {Number(option.value.split(":")[1]) + 1}</small>{String(props.value) === option.value && <Tick />}
    </button>)}</div>
  </div>)}</div>
}
function Colors(props: RendererProps) {
  return <div className="color-options">{props.request.options.map(option => <button {...choiceProps(props, option)} className="color-choice" data-value={option.value} key={option.value}>
    <b aria-hidden="true">{option.value === "red" ? "♥ ♦" : option.value === "black" ? "♠ ♣" : ""}</b>{option.label}{String(props.value) === option.value && <Tick />}
  </button>)}</div>
}
function Materials(props: RendererProps) {
  const cards = props.table.cards, purpose = props.definition?.consumeSelected === true ? "将被消耗" : props.definition?.consumeSelected === false ? "原牌保留" : "已选择"
  return <div className="ability-options">{props.request.options.map(option => {
    const held = cards?.ownHand?.find(card => card.instanceId === option.value), info = held && cards?.definitions?.[held.cardId]
    const duplicates = props.request.options.filter(item => item.label === option.label), ordinal = duplicates.length > 1 ? `第 ${duplicates.findIndex(item => item.value === option.value) + 1} 张` : "能力牌"
    const picked = String(props.value) === option.value
    return <div className="card-slot" data-picked={picked} key={option.value}>
      <PokerAbilityCard {...choiceProps(props, option)} definition={info} caption={info ? ordinal : option.label} aria-label={`${option.label}${duplicates.length > 1 ? ` · ${ordinal}` : ""}`} />
      {picked && <Tick />}
      <span className="material-outcome">{picked ? purpose : ordinal}</span>
    </div>
  })}</div>
}
function Statuses(props: RendererProps) {
  return <div className="effect-options">{props.request.options.map(option => <button {...choiceProps(props, option)} className="effect-choice" key={option.value}>
    <Shield aria-hidden="true" /><span>{option.label}</span>{String(props.value) === option.value && <Tick />}
  </button>)}</div>
}
function PokerCandidates(props: RendererProps) {
  return <div className="candidate-stage poker-candidates"><div className="hand-row">{props.request.options.map((option, index) => <div className="card-slot" key={option.value}>
    <button {...choiceProps(props, option)} className="poker-candidate" aria-label={`${option.label}，${playingCardLabel(props.request.pending?.candidates[index])}`}>
      <Card card={props.request.pending?.candidates[index]} />{String(props.value) === option.value && <Tick />}
    </button>
  </div>)}</div></div>
}
function AbilityCandidates(props: RendererProps) {
  return <div className="candidate-stage"><div className="hand-row">{props.request.options.map((option, index) => {
    const info = props.request.pending?.candidateCards?.[index]
    return <div className="card-slot" key={option.value}>
      <PokerAbilityCard {...choiceProps(props, option)} definition={info} caption={option.label} aria-label={`${option.label}${info ? `，${info.name}` : ""}`} />
      {String(props.value) === option.value && <Tick />}
    </div>
  })}</div></div>
}
/** Eight reusable renderers; card IDs never choose a workflow. */
const selectors: Record<CardSelectionUI, ComponentType<RendererProps>> = {
  "own-hole": OwnHole, player: Players, "opponent-hole": OpponentHole, color: Colors,
  "ability-material": Materials, status: Statuses, "poker-candidate": PokerCandidates, "ability-candidate": AbilityCandidates,
}
export function PokerCardSelection({ choices, values, onChange, disabled, table, definition, hideLegend = false }: { choices: PokerCardChoiceSpec[]; values: CardSelectionValues; onChange: (values: CardSelectionValues) => void; disabled: boolean; table: PokerTableView; definition?: PokerCardDefinitionView; hideLegend?: boolean }) {
  return <div className="selection-fields">{cardChoiceRequests(choices).map(request => {
    const Renderer = selectors[request.ui], dependent = request.ui === "color" && choices.some(choice => choice.key === "targetHole") && values.targetHole === undefined
    const label = request.ui === "ability-material" && definition?.consumeSelected !== undefined ? definition.consumeSelected ? "消耗另一张能力牌" : "复制另一张能力牌" : request.label
    return <fieldset className="choice-field" data-selector={request.ui} key={request.key} disabled={disabled || dependent}>
      <legend className={hideLegend ? "sr-only" : undefined}>{label}</legend>{!request.options.length ? <p className="choice-empty">暂无合法目标</p> : <Renderer request={request} table={table} value={values[request.key]} disabled={disabled || dependent} definition={definition} onSelect={value => onChange(changeCardSelection(choices, values, request.key, value))} />}
    </fieldset>
  })}</div>
}
export function PokerCardCandidates({ pending, table, value, onChange, disabled, compact = false }: { pending: PokerCardPendingView; table: PokerTableView; value: string; onChange: (value: string) => void; disabled: boolean; compact?: boolean }) {
  const request = cardCandidateRequest(pending), Renderer = selectors[request.ui]
  return <section className="candidate-view" data-selector={request.ui} data-compact={compact} aria-label="选择一张"><Renderer request={request} table={table} value={value} disabled={disabled} onSelect={onChange} /></section>
}
