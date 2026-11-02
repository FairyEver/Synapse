import { describe, expect, it } from "vitest"
import { chipBreakdown, addChipPayment, chipValue, layoutChipPile } from "./game-poker-chips"

describe("逐笔筹码与展示布局", () => {
  it("501拆成500和1，五笔100不合并成500", () => {
    expect(chipBreakdown(501)).toEqual([{value:500,count:1},{value:1,count:1}])
    let counts = [] as ReturnType<typeof chipBreakdown>
    for (let i=0;i<5;i++) counts = addChipPayment(counts,100)
    expect(counts).toEqual([{value:100,count:5}])
    expect(chipValue(counts)).toBe(500)
  })
  it("200和500保留面额，零余额没有筹码，无效金额拒绝", () => {
    expect(chipBreakdown(701)).toEqual([{value:500,count:1},{value:200,count:1},{value:1,count:1}])
    expect(chipBreakdown(0)).toEqual([])
    for (const value of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) expect(()=>chipBreakdown(value)).toThrow()
  })
  it("两枚10和三枚5混摞，同色连续，固定错位可复现", () => {
    const counts = [{value:10 as const,count:2},{value:5 as const,count:3}]
    const layout = layoutChipPile(counts,7)
    expect(layout.chips.map(c=>c.value)).toEqual([10,10,5,5,5])
    expect(new Set(layout.chips.map(c=>c.stack)).size).toBe(1)
    expect(new Set(layout.chips.map(c=>c.rotation)).size).toBeGreaterThan(1)
    expect(layoutChipPile(counts,7)).toEqual(layout)
  })
  it("截图中的64817完整绘制，超过旧120枚限制仍不换成1k", () => {
    const layout = layoutChipPile(chipBreakdown(64817))
    expect(layout.chips).toHaveLength(135)
    expect(layout.chips.reduce((sum,c)=>sum+c.value,0)).toBe(64817)
    expect(layout.chips.some(c=>Number(c.value)===1000)).toBe(false)
  })
  it("恰好200枚保留原面额，不提前整理", () => {
    const layout = layoutChipPile([{value:1,count:200}])
    expect(layout.chips).toHaveLength(200)
    expect(layout.chips.every(c=>c.value===1)).toBe(true)
  })
  it("超过200枚先合并小筹码，金额不变且不改原始库存", () => {
    const counts = [{value:1 as const,count:30000}]
    const layout = layoutChipPile(counts)
    expect(layout.chips).toHaveLength(60)
    expect(layout.chips.every(c=>c.value===500)).toBe(true)
    expect(layout.chips.reduce((sum,c)=>sum+c.value,0)).toBe(30000)
    expect(counts).toEqual([{value:1,count:30000}])
  })
  it.each([
    [100000,200,0], [100001,200,1], [150000,200,100], [200000,200,200], [300000,300,300],
  ])("金额%d只引入达到目标所需的最少1k，无法压到200时仍完整绘制", (amount,count,thousands) => {
    const layout = layoutChipPile(chipBreakdown(amount))
    expect(layout.chips).toHaveLength(count)
    expect(layout.chips.filter(c=>Number(c.value)===1000)).toHaveLength(thousands)
    expect(layout.chips.reduce((sum,c)=>sum+c.value,0)).toBe(amount)
  })
  it("多种面额和合并边界始终精确表达金额，布局可复现", () => {
    for (const amount of [0,1,201,999,1000,64817,99999,100199,150817,199999,200001,300817]) {
      const counts = chipBreakdown(amount)
      const layout = layoutChipPile(counts,3)
      expect(layout.chips.reduce((sum,c)=>sum+c.value,0)).toBe(amount)
      expect(layoutChipPile([...counts].reverse(),3)).toEqual(layout)
    }
  })
})
