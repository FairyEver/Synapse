/** Fixed physical denominations, shared by the public projection and the table artwork. */
export const POKER_CHIP_VALUES = [500,200,100,25,10,5,1] as const
export type PokerChipValue = typeof POKER_CHIP_VALUES[number]
export type PokerChipCount = { value: PokerChipValue; count: number }
export type PokerChipContribution = { id: string; seq: number; seatNo: number; amount: number; fund: "pot" | "roll" }
export type PokerChipState = { pot: PokerChipCount[]; roll: PokerChipCount[]; recent: PokerChipContribution[] }
export type PositionedPokerChip = { id: string; value: PokerChipValue; stack: number; level: number; x: number; y: number; rotation: number; depth: number }
export function chipBreakdown(amount: number): PokerChipCount[] {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid poker chip amount")
  const result: PokerChipCount[] = []
  for (const value of POKER_CHIP_VALUES) {
    const count = Math.floor(amount/value)
    if (count) result.push({value,count})
    amount %= value
  }
  return result
}
export function addChipPayment(counts: readonly PokerChipCount[], amount: number): PokerChipCount[] {
  const next = new Map(counts.map(c=>[c.value,c.count]))
  for (const chip of chipBreakdown(amount)) next.set(chip.value,(next.get(chip.value)??0)+chip.count)
  return POKER_CHIP_VALUES.filter(v=>next.get(v)).map(value=>({value,count:next.get(value)!}))
}
export function chipValue(counts: readonly PokerChipCount[]): number { return counts.reduce((sum,c)=>sum+c.value*c.count,0) }
export function subtractChipCounts(counts: readonly PokerChipCount[], removed: readonly PokerChipCount[]): PokerChipCount[] {
  const next = new Map(counts.map(c=>[c.value,c.count]))
  for (const chip of removed) next.set(chip.value,Math.max(0,(next.get(chip.value)??0)-chip.count))
  return POKER_CHIP_VALUES.filter(v=>next.get(v)).map(value=>({value,count:next.get(value)!}))
}
function noise(seed: number): number {
  let hash = Math.imul(seed+1,0x45d9f3b)
  hash = Math.imul(hash^(hash>>>16),0x45d9f3b)
  return ((hash^(hash>>>16))>>>0)/4294967296
}
/** Keep all denominations/counts in the model; bound expensive SVGs with an exact overflow legend. */
export function layoutChipPile(counts: readonly PokerChipCount[], seed = 0): { chips: PositionedPokerChip[]; overflow: PokerChipCount[] } {
  const stacks: PokerChipValue[][] = [], spare: PokerChipValue[] = [], overflow: PokerChipCount[] = []
  let budget = 120
  for (const value of POKER_CHIP_VALUES) {
    const count = counts.find(c=>c.value===value)?.count ?? 0
    let visible = Math.min(count,budget); budget -= visible
    if (count>visible) overflow.push({value,count:count-visible})
    while (visible>=4) {
      const height = Math.min(8+stacks.length%3,visible)
      stacks.push(Array<PokerChipValue>(height).fill(value)); visible-=height
    }
    for (let i=0;i<visible;i++) spare.push(value)
  }
  for (const value of spare) {
    const candidates = stacks.map((chips,index)=>({chips,index})).filter(s=>s.chips.length<8+s.index%3 && (s.chips.includes(value)||s.chips.length<5))
    candidates.sort((a,b)=>((a.chips.includes(value)?-4:0)+a.chips.length*.45)-((b.chips.includes(value)?-4:0)+b.chips.length*.45))
    if (candidates[0]) candidates[0].chips.push(value)
    else stacks.push([value])
  }
  const spread = Math.min(1,1.8/Math.sqrt(Math.max(1,stacks.length)))
  const chips = stacks.flatMap((values,stack)=> {
    const angle = stack*2.399963+.24, radius = stack ? .94*Math.sqrt(stack)*spread : 0
    const x = Math.cos(angle)*radius, y = Math.sin(angle)*radius*.35
    return values.sort((a,b)=>b-a).map((value,level)=> {
      const key = seed*991+stack*131+level*17
      return {id:`${stack}:${level}:${value}`,value,stack,level,x:x+(noise(key)-.5)*.07,y:y+level*.105+(noise(key+3)-.5)*.03,rotation:(noise(key+7)-.5)*24,depth:Math.round((8-y)*1000)+level}
    })
  })
  return {chips,overflow}
}
