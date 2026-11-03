import type { PokerCardView } from "@synapse/shared/game-contracts"
import { Card } from "./Card"
import { PokerAbilityCard } from "./PokerAbilityCard"

const labels: Record<string, string> = { next: "下一张公共牌", stage: "下一阶段公共牌", top: "牌堆顶", one: "一张底牌", two: "两张底牌", suit: "底牌花色", rank: "底牌点数", 候选: "候选记录", 能力牌: "能力牌情报", 抽卡结果: "抽卡结果" }
const suits: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" }
export function PokerCardIntel({ cards }: { cards: PokerCardView }) {
  return <section className="intel-list" aria-label="本人情报">{cards.privateResults?.length ? cards.privateResults.map(result => <article className="intel-result" key={result.id} data-valid={result.valid}>
    <header><h3>{labels[result.label] ?? result.label}</h3>{!result.valid && <span>已失效</span>}</header>
    <div className="intel-values">{result.values.map((value, index) => result.label === "能力牌" && cards.definitions?.[value]
      ? <div className="private-ability" key={index}><PokerAbilityCard definition={cards.definitions[value]} interactive={false} /></div>
      : /^[2-9TJQKA][shdc]$/.test(value)
        ? <Card key={index} card={value} />
        : <span className="private-symbol" key={index}>{result.label === "suit" ? suits[value] ?? value : value}</span>)}</div>
  </article>) : <p className="choice-empty">暂无本人情报</p>}</section>
}
