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
  it("大量小筹码限制DOM，并保留未绘制的同面额数量和总值", () => {
    const layout = layoutChipPile([{value:1,count:30000}])
    expect(layout.chips.length).toBeLessThanOrEqual(120)
    expect(layout.chips.length + layout.overflow.reduce((n,c)=>n+c.count,0)).toBe(30000)
    expect(layout.overflow.every(c=>c.value===1)).toBe(true)
  })
})
