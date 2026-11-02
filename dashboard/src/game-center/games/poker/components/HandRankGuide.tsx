import type { PokerVariant } from "@synapse/shared/game-contracts"

export function HandRankGuide({ variant = "standard52" }: { variant?: PokerVariant }) {
  const shortDeck = variant === "short32"
  const ranks = ["皇家同花顺", "同花顺", "四条", ...(shortDeck ? ["同花", "葫芦"] : ["葫芦", "同花"]), "顺子", "三条", "两对", "一对", "高牌"]
  return <div className="space-y-3 text-sm">
    <p className="font-medium">{shortDeck ? "短牌 32 张" : "标准 52 张"} · 从大到小</p>
    <ol className="space-y-2" aria-label="牌型从大到小">
      {ranks.map((rank, index) => <li key={rank} className="flex items-baseline gap-3"><span className="w-5 shrink-0 text-right tabular-nums text-muted" aria-hidden="true">{index + 1}</span><span>{rank}</span></li>)}
    </ol>
    <p className="text-muted">比较最好的五张牌；同牌型逐项比点数，花色不分大小。{shortDeck ? "短牌 A、7、8、9、10 可组成最小顺子。" : "A、2、3、4、5 可组成最小顺子。"}</p>
  </div>
}
