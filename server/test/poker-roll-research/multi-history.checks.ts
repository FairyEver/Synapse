import { expect, it } from "vitest"
import { multiHistoryPair } from "./multi-history"
import { observation, assertState, type PriceModel } from "./simulator"
import { seedOf } from "./math"

const model:PriceModel={scale:.1,curve:"linear",growth:1,coefficients:{normal:[1,.1,.01],super:[2,.15,.02]},history:{normal:0,super:0}}
it("多人先后Roll从初始资本合法重放，匹配后来者的公开资金且不抹掉弃牌历史",()=>{
  for(const variant of ["standard52","short32"] as const)for(const street of ["preflop","flop","turn"] as const){
    const pair=multiHistoryPair({variant,players:6,depth:100,seed:36,bigBlind:2},street,[["normal","super"],["super"],["normal"]],model,true)
    const a=observation(pair.control),b=observation(pair.matched)
    expect([b.seat,b.stack,b.pot,b.effectivePot,b.effectiveFuture,b.count]).toEqual([a.seat,a.stack,a.pot,a.effectivePot,a.effectiveFuture,a.count])
    expect(new Set(b.history.map(h=>h.seat)).size).toBe(3)
    expect(b.history).toHaveLength(4)
    expect(b.seats.some(s=>s.folded)).toBe(true)
    for(const game of [pair.control,pair.matched,pair.total])assertState(game)
  }
})
it("匹配实验在第一次费用试算不足时只能调整下一次入座资本，不能中途补款",()=>{
  const expensive:PriceModel={...model,coefficients:{normal:[0,2,0],super:[0,3,0]}}
  const pair=multiHistoryPair({variant:"short32",players:5,depth:25,seed:seedOf(20261101,"multi-history-final","short32",5,"turn",17),bigBlind:2},"turn",[["super","super"],["normal","normal"]],expensive,false)
  expect(observation(pair.matched).effectiveFuture).toBe(observation(pair.control).effectiveFuture)
  expect(pair.matched.history).toHaveLength(4)
  expect(pair.matched.original.some((v,i)=>v>pair.control.original[i])).toBe(true)
  assertState(pair.matched)
})
