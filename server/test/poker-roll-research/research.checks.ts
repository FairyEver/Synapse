import { describe, expect, it } from "vitest"
import { repeatedTargetProbability, summarize, rng } from "./math"
import { createGame, observation, roll, bet, finish, assertState, quote, pinned, type PriceModel } from "./simulator"

const price: PriceModel = { scale: 0.1, curve: "linear", growth: 0.5, coefficients: { normal: [1, 0, 0], super: [3, 0, 0] }, history: { normal: 0, super: 0 } }
describe("Roll研究的精确抽样与误差", () => {
  it("对未知对手积分，不能把重复抽样当成独立均值", () => {
    expect(repeatedTargetProbability(52, 6, 3, 3, 0)).toBeCloseTo(0.16860057397959186, 12)
    expect(repeatedTargetProbability(52, 6, 3, 0, 3)).toBeCloseTo(0.4282792126599715, 12)
    expect(repeatedTargetProbability(32, 6, 3, 0, 3)).toBeCloseTo(0.6030886871974249, 12)
  })
  it("按配对差值计算区间，保留负收益和精确常量", () => {
    expect(summarize([-2, 0, 2]).mean).toBe(0)
    expect(summarize([5, 5, 5]).halfWidth).toBe(0)
  })
})
describe("研究模拟器的原始资本与信息边界", () => {
  it("个人观测不暴露牌堆或他人暗牌", () => {
    const g = createGame({ variant: "standard52", players: 6, depth: 100, seed: 1 })
    const o = observation(g)
    expect(o.hole).toHaveLength(2)
    expect("deck" in o).toBe(false)
    expect(o.seats.every(s => !("hole" in s))).toBe(true)
  })
  it("Roll扣款不抵跟注，补偿冻结并由原始资本约束", () => {
    const g = createGame({ variant: "standard52", players: 4, depth: 100, seed: 13 })
    const who = g.hand.actionOnSeat!, before = observation(g), capital = g.original.reduce((a,b)=>a+b,0)
    roll(g, "normal", 0, 9, rng(9))
    const after = observation(g)
    expect(after.stack).toBe(before.stack - 9)
    expect(after.legal.toCall).toBe(before.legal.toCall)
    expect(g.credits[who]).toBe(0)
    expect(g.credits.reduce((a,b)=>a+b,0)).toBe(9)
    expect(g.hand.seats.reduce((s,p)=>s+p.stack+p.total,0)+9).toBe(capital)
    expect(g.hand.seats[who].startingStack).toBe(g.original[who] - 9)
    assertState(g)
  })
  it("超级候选不含旧牌，选后回收保持牌量和序号", () => {
    const g = createGame({ variant: "short32", players: 10, depth: 100, seed: 17 })
    const old = observation(g).hole[0], deck = g.hand.deck.length, who = g.hand.actionOnSeat!
    const result = roll(g, "super", 0, 5, rng(23), candidates => {
      expect(candidates).toHaveLength(3)
      expect(candidates).not.toContain(old)
      return 1
    })
    expect(g.hand.deck).toHaveLength(deck)
    expect(g.hand.deck).toContain(old)
    expect(g.hand.seats[who].hole[0]).toBe(result.candidates[1])
    expect(g.counts[who]).toBe(1)
    assertState(g)
  })
  it("支付后至少留一筹码，失败没有账本副作用", () => {
    const g = createGame({ variant: "standard52", players: 2, depth: 10, seed: 3 })
    const before = JSON.stringify(g)
    expect(() => roll(g, "normal", 0, observation(g).stack, rng(5))).toThrow()
    expect(JSON.stringify(g)).toBe(before)
  })
  it("全下仍分到补偿，只有结算后可用，最终总额不变", () => {
    const g = createGame({ variant: "short32", players: 10, depth: 10, seed: 27 })
    roll(g, "super", 1, 5, rng(29), () => 0)
    while (g.hand.street !== "settled") bet(g, { action: "allin" })
    const result = finish(g)
    expect(result.ending.reduce((a,b)=>a+b,0)).toBe(200)
    expect(result.received.reduce((a,b)=>a+b,0)).toBe(5)
    expect(result.net.reduce((a,b)=>a+b,0)).toBe(0)
  })
  it("相同公开条件报价不读取底牌，次数共享但可切回低档", () => {
    const g = createGame({ variant: "standard52", players: 6, depth: 100, seed: 31 })
    const o = observation(g)
    const a = quote(o, "normal", price)
    expect(quote({...o,hole:["As","Ah"]}, "normal", price)).toBe(a)
    const superFirst = quote(o,"super",price)
    const ordinarySecond = quote({...o,count:1},"normal",price)
    expect(ordinarySecond).toBeGreaterThanOrEqual(a)
    expect(superFirst).toBeGreaterThan(a)
  })
})

import { rollOpportunities, chooseBet, chooseRoll, chooseCandidate, continueGame, makeSnapshot, type PolicyFit } from "./policies"
import { fitNonnegative, fitModels } from "./calibration"

describe("完整续局与可见信息策略", () => {
  it("零Roll续局与直接调用固定引擎逐步一致", () => {
    const g = createGame({variant:"standard52",players:6,depth:50,seed:99})
    const control = structuredClone(g.hand)
    let h = control
    while(h.street!=="settled") {
      const legal = pinned.hand.legalActions(h,h.actionOnSeat)
      h=pinned.hand.act(h,h.actionOnSeat,{action:legal.actions.includes("check")?"check":"call"})
    }
    while(g.hand.street!=="settled") {
      const o=observation(g);bet(g,{action:o.legal.actions.includes("check")?"check":"call"})
    }
    expect(finish(g).ending).toEqual(h.seats.map((s:{stack:number})=>s.stack))
  })
  it("相同个人观测与策略随机数，不因后台暗牌/牌堆变化改变决策", () => {
    const g=createGame({variant:"standard52",players:6,depth:100,seed:111})
    const o=observation(g), other=g.hand.seats.find(s=>s.seatNo!==o.seat)!
    const card=other.hole[0];other.hole[0]=g.hand.deck[0];g.hand.deck[0]=card
    const changed=observation(g)
    expect(changed).toEqual(o)
    expect(chooseBet(o,"loose",rng(8))).toEqual(chooseBet(changed,"loose",rng(8)))
    expect(rollOpportunities(o)).toEqual(rollOpportunities(changed))
  })
  it("超级只能在已抽三张中选择，不能挑整副牌的理想结果", () => {
    const g=createGame({variant:"standard52",players:2,depth:100,seed:77})
    const o={...observation(g),hole:["Ks","7d"]}
    const selected=chooseCandidate(o,1,["2c","3d","4s"])
    expect(selected).toBeGreaterThanOrEqual(0)
    expect(selected).toBeLessThan(3)
    const opportunities=rollOpportunities(o)
    expect(opportunities.normal.index).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(opportunities.super.gain)).toBe(true)
  })
  it("合法轨迹可获得三阶段快照，并完成带连续Roll的续局", () => {
    for(const stage of ["preflop","flop","turn"] as const) {
      const g=makeSnapshot({variant:"short32",players:10,depth:100,seed:124},stage)
      expect(g.hand.street).toBe(stage)
      const result=continueGame(g,{model:price,profiles:["conservative","tight","loose","adaptive"],fit:undefined,rollMode:"none"})
      expect(result.net.reduce((a,b)=>a+b,0)).toBe(0)
    }
  })
  it("非负拟合使用负样本，不把坏结果删除后抬高估值", () => {
    const beta=fitNonnegative([[1],[1],[1]],[-10,1,3])
    expect(beta[0]).toBe(0)
  })
})

it("浅筹码单挑不能被暖场加注耗尽而伪造转牌行动点", () => {
  const g=makeSnapshot({variant:"standard52",players:2,depth:10,shape:"short",seed:1228496757,bigBlind:2},"turn")
  expect(g.hand.street).toBe("turn")
  expect(g.hand.seats.filter(s=>!s.allIn&&!s.folded).length).toBe(2)
})

import { coupleFuture } from "./simulator"
import { runRow } from "./study"
it("配对牌序保持共同牌的相对顺序，换走的牌不能再发到公共牌", () => {
  const a=createGame({variant:"standard52",players:6,depth:100,seed:444}),b=structuredClone(a)
  const taken=roll(b,"normal",0,1,rng(33)).candidates[0]
  coupleFuture(a,88);coupleFuture(b,88)
  const common=new Set(a.hand.deck.filter(c=>b.hand.deck.includes(c)))
  expect(a.hand.deck.filter(c=>common.has(c))).toEqual(b.hand.deck.filter(c=>common.has(c)))
  expect(b.hand.deck).not.toContain(taken)
  assertState(a);assertState(b)
})
it("同一研究种子可重放，零Roll的自主分支差值精确为零", () => {
  const job={phase:"unit",variant:"standard52" as const,players:3,street:"flop" as const,start:0,size:1,model:price,continuation:"none" as const}
  const a=runRow(job,3),b=runRow(job,3)
  expect(a).toEqual(b)
  expect(a.voluntary).toBe(0)
})

import { historyPair } from "./history"
it("历史条件比较从不同初始资本合法重放，当前公开资金精确匹配", () => {
  const p=historyPair({variant:"standard52",players:6,depth:100,seed:555},"flop",["normal","super"],price,false)
  const a=observation(p.control),b=observation(p.matched)
  expect(b.seat).toBe(a.seat)
  expect(b.stack).toBe(a.stack)
  expect(b.effectivePot).toBe(a.effectivePot)
  expect(b.effectiveFuture).toBe(a.effectiveFuture)
  expect(b.hole).toEqual(a.hole)
  expect(b.history.length).toBeGreaterThan(a.history.length)
  assertState(p.control);assertState(p.matched);assertState(p.total)
})
it("基础估值为零时最低收费仍参加次数递增，不能恒定一筹码刷牌", () => {
  const g=createGame({variant:"standard52",players:6,depth:100,seed:9}),o=observation(g)
  const zero:PriceModel={...price,scale:1,coefficients:{normal:[0,0,0],super:[0,0,0]}}
  expect(quote(o,"normal",zero)).toBe(1)
  expect(quote({...o,count:10},"normal",zero)).toBeGreaterThan(quote(o,"normal",zero))
  expect(quote({...o,count:10},"super",zero)).toBeGreaterThan(quote({...o,count:10},"normal",zero))
})

import { visibleRank } from "./policies"
it("策略的快速可见牌特征与固定判型器一致，判胜仍使用固定引擎", () => {
  for(const variant of ["standard52","short32"] as const){
    const random=rng(123)
    for(let i=0;i<600;i++){
      const cards=pinned.cards.shuffle(pinned.cards.orderedDeck(variant),(n:number)=>Math.floor(random()*n)).slice(0,5+i%3)
      expect(visibleRank(cards,variant)).toEqual(pinned.ranks.evaluate(cards,variant))
    }
  }
})
it("判型缓存必须与原比较函数一致，不能改变边池或短牌赢家", () => {
  const original=pinned.ranks.compareHands
  const random=rng(941),cases:Array<[string[],string[],string,number]>=[]
  for(const variant of ["standard52","short32"])for(let i=0;i<100;i++){
    const deck=pinned.cards.shuffle(pinned.cards.orderedDeck(variant),(n:number)=>Math.floor(random()*n))
    const a=deck.slice(0,7),b=deck.slice(7,14);cases.push([a,b,variant,original(a,b,variant)])
  }
  pinned.enableRankCache()
  for(const [a,b,v,result] of cases)expect(pinned.ranks.compareHands(a,b,v)).toBe(result)
})

import { estimateHistory } from "./history"
it("历史影响区间跨零时不得凭点估计增加收费", () => {
  const rows=Array.from({length:16},(_,i)=>({id:String(i),group:"standard52:6:flop",pattern:"normal",kind:"normal" as const,control:10,matched:10+(i%2?10:-9),total:10,conditional:i%2?10:-9,overall:0,exactMatched:true,x:[1,10,100],h:1,baseValue:10}))
  const result=estimateHistory(rows)
  expect(result.coefficients.normal.normal).toBe(0)
  expect(result.details["normal:normal"].estimate).not.toBe(0)
})

import { appendBatches, bootstrapMean } from "./math"
import { spawnSync } from "node:child_process"
import path from "node:path"
it("自适应追加超过调用参数上限的样本仍保持完整次序", () => {
  const rows=appendBatches([0],[Array.from({length:150000},(_,i)=>i+1),[150001]])
  expect(rows).toHaveLength(150002)
  expect(rows.at(-1)).toBe(150001)
})
it("整手bootstrap可复跑，负的常量不能被检验成正收益", () => {
  expect(bootstrapMean([-5,-5,-5],2)).toEqual({lower:-5,upper:-5,repetitions:400})
})
it("非法CLI参数立即拒绝，不能悄悄开始空样本或完整研究", () => {
  const result=spawnSync(process.execPath,[path.resolve("test/poker-roll-research/run.cjs"),"pilot","--samples","0","--out",path.resolve("../.superpowers/sdd/2026-11-01-poker-roll-research/invalid-cli")],{encoding:"utf8",timeout:10000})
  expect(result.status).toBe(1)
  expect(result.stderr).toContain("samples")
})

import { candidateWeights } from "./policies"
it("本人刚放回的已知牌按真实剩余池加权，不能当作可能在对手手里", () => {
  const g=createGame({variant:"standard52",players:6,depth:100,seed:1234}),who=g.hand.actionOnSeat!,old=observation(g).hole[0]
  roll(g,"super",0,2,rng(9),()=>0)
  const o=observation(g),weights=candidateWeights(o)
  expect(o.privateHistory).toHaveLength(1)
  expect(weights.find(w=>w.card===old)!.weight).toBeCloseTo(1/40,12)
  expect(weights.reduce((s,w)=>s+w.weight,0)).toBeCloseTo(1,12)
  const other=observation(g,(who+1)%6)
  expect(other.privateHistory).toHaveLength(0)
})

import { visibleStrength } from "./policies"
it("有确定回收牌时，超级期望包含全部三张组合及坏结果", () => {
  const g=createGame({variant:"standard52",players:6,depth:100,seed:782}),random=rng(44)
  roll(g,"super",0,2,random,()=>0)
  const o=observation(g),weights=candidateWeights(o),R=weights.filter(w=>w.known).length,U=weights.length-R,D=40
  const combinations=(n:number,k:number)=>k===0?1:k===1?n:k===2?n*(n-1)/2:n*(n-1)*(n-2)/6
  const before=visibleStrength(o.hole,o.board,o.variant)**5,expected:number[]=[]
  for(let slot=0;slot<2;slot++){
    const scores=weights.map(w=>{const h=[...o.hole];h[slot]=w.card;return visibleStrength(h,o.board,o.variant)**5})
    let total=0,mass=0
    for(let a=0;a<weights.length-2;a++)for(let b=a+1;b<weights.length-1;b++)for(let c=b+1;c<weights.length;c++){
      const known=Number(weights[a].known)+Number(weights[b].known)+Number(weights[c].known)
      const p=combinations(D-R,3-known)/(combinations(D,3)*combinations(U,3-known))
      total+=p*Math.max(scores[a],scores[b],scores[c]);mass+=p
    }
    expect(mass).toBeCloseTo(1,10);expected.push(total-before)
  }
  expect(rollOpportunities(o).super.gain).toBeCloseTo(Math.max(...expected),10)
})

import { fixedSample } from "./calibration"
it("正式检验只取预先固定样本，不能被自适应追加的高收益组改权", () => {
  const rows=[{id:"final:A:0",group:"A",voluntary:1},{id:"final:A:1",group:"A",voluntary:3},{id:"final:B:0",group:"B",voluntary:-1},{id:"final:B:1",group:"B",voluntary:1},...Array.from({length:200},(_,i)=>({id:`final:A:${i+2}`,group:"A",voluntary:100}))]
  const fixed=fixedSample(rows,2)
  expect(fixed).toHaveLength(4)
  expect(summarize(fixed.map(r=>r.voluntary)).mean).toBe(1)
})
it("顺序策略起档相对实验起点，不能被既有次数的奇偶偷偷切换", () => {
  const g=createGame({variant:"standard52",players:6,depth:100,seed:91}),o={...observation(g),hole:["2s","7d"],count:3}
  expect(chooseRoll(o,"adaptive",price,undefined,"normal-super",3)?.kind).toBe("normal")
  expect(chooseRoll(o,"adaptive",price,undefined,"super-normal",3)?.kind).toBe("super")
})
it("多人合法暖场覆盖已全下对手，不伪造单挑转牌行动点", () => {
  const g=makeSnapshot({variant:"short32",players:6,depth:50,shape:"allin",seed:912},"turn")
  const o=observation(g)
  expect(o.seats.some(s=>s.allIn&&s.seatNo!==o.seat)).toBe(true)
  assertState(g)
})

import { normalQuantile, stratifiedBootstrap } from "./math"
it("诊断置信界按计划的多次观察校正，标准分位数数值正确", () => {
  expect(normalQuantile(.975)).toBeCloseTo(1.9599639845,5)
  expect(normalQuantile(.9975)).toBeCloseTo(2.8070337683,5)
})
it("分层bootstrap保持固定总体的分组权重，不被深筹码组支配", () => {
  const rows=[...Array.from({length:4},()=>({group:"A",voluntary:10,chosen:true,chosenKind:"normal"})),...Array.from({length:4},()=>({group:"B",voluntary:-2,chosen:true,chosenKind:"normal"}))]
  const s=stratifiedBootstrap(rows,8,40)
  expect(s.all.lower).toBe(4)
  expect(s.all.upper).toBe(4)
})

import { valueRow, FRACTIONS } from "./valuation"
it("收支平衡实验只扫描本次费用，后续规则模型保持不变并保留负结果", () => {
  const model=structuredClone(price),before=JSON.stringify(model)
  const row=valueRow({variant:"standard52",players:3,street:"flop",index:1,model,fit:undefined})
  expect(JSON.stringify(model)).toBe(before)
  expect(row.normal).toHaveLength(FRACTIONS.length)
  expect(row.fees[0]).toBe(0)
  expect(row.fees.at(-1)!).toBeGreaterThan(row.fees[1])
  expect(row.normal.every(Number.isFinite)).toBe(true)
  expect(row.super.every(Number.isFinite)).toBe(true)
})

import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { createHash } from "node:crypto"
import integrity from "./seal.cjs"
it("真实CLI可重放并验证数据，费用扫描源码指纹不符必须拒绝", () => {
  const directory=path.resolve(`../.superpowers/sdd/2026-11-01-poker-roll-research/roundtrip-${process.pid}`)
  const cli=(file:string,args:string[])=>spawnSync(process.execPath,[path.resolve(`test/poker-roll-research/${file}`),...args],{encoding:"utf8",timeout:30000})
  const run=cli("run.cjs",["pilot","--samples","1","--workers","1","--out",directory])
  expect(run.status,run.stderr).toBe(0)
  const verify=cli("verify.cjs",[directory]);expect(verify.status,verify.stderr).toBe(0)
  const row=JSON.parse(gunzipSync(readFileSync(path.join(directory,"train.jsonl.gz"))).toString().trim().split("\n")[0]);delete row.ordinal
  const replay=cli("replay.cjs",["--out",directory,"--id",row.id]);expect(replay.status,replay.stderr).toBe(0);expect(JSON.parse(replay.stdout)).toEqual(row)
  const fitted=readFileSync(path.join(directory,"fitted.json")),model=JSON.stringify(JSON.parse(fitted.toString()).price)
  writeFileSync(path.join(directory,"recommended-model.json"),model)
  const traced=cli("replay.cjs",["--out",directory,"--id",row.id,"--trace",path.join(directory,"trace.jsonl")])
  expect(traced.status,traced.stderr).toBe(0);expect(JSON.parse(traced.stdout)).toEqual(row)
  const ledger=readFileSync(path.join(directory,"trace.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line))
  expect(ledger.length).toBeGreaterThan(3)
  expect(ledger.every(r=>r.available+r.committed+r.frozen===r.initialCapital)).toBe(true)
  expect(ledger.some(r=>r.street==="settled"&&!r.released)).toBe(true)
  expect(ledger.some(r=>r.released)).toBe(true)
  const hash=(b:Buffer|string)=>createHash("sha256").update(b).digest("hex")
  writeFileSync(path.join(directory,"valuation-manifest.json"),JSON.stringify({source:{"valuation.ts":"wrong"},modelSha256:hash(model),fitSha256:hash(fitted)}))
  integrity.seal(directory)
  const rejected=cli("verify.cjs",[directory]);expect(rejected.status).toBe(1);expect(rejected.stderr).toContain("Valuation source fingerprint mismatch")
  writeFileSync(path.join(directory,"valuation-manifest.json"),JSON.stringify({source:{"valuation.ts":hash(readFileSync(path.resolve("test/poker-roll-research/valuation.ts")))},modelSha256:hash(model),fitSha256:hash(fitted)}))
  writeFileSync(path.join(directory,"multi-history-manifest.json"),JSON.stringify({source:{"multi-history.ts":"wrong"},modelSha256:hash(model),fitSha256:hash(fitted)}))
  integrity.seal(directory)
  const multiRejected=cli("verify.cjs",[directory]);expect(multiRejected.status).toBe(1);expect(multiRejected.stderr).toContain("Multi-history source fingerprint mismatch")
},40000)
