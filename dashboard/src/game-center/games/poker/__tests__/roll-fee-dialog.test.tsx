/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { PokerRollFeeDialog } from "../components/PokerRollFeeDialog"
import { feeLedger, feeTable } from "./roll-fee-fixtures"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => document.body.replaceChildren())
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!
async function mount(table = feeTable) {
  const host = document.createElement("div"), root = createRoot(host)
  document.body.append(host)
  const render = (value = table) => act(async () => root.render(<PokerRollFeeDialog table={value} onClose={() => {}} />))
  await render()
  return { root, render }
}
describe("Roll费用弹窗", () => {
  it("展示真实来源去向与4笔流水；点击收入玩家按个人收款筛选并展开分配", async () => {
    const { root } = await mount()
    expect(document.querySelector('[aria-label="费用来源"]')?.textContent).toContain("220")
    expect(document.querySelector('[aria-label="费用去向"]')?.textContent).toContain("121")
    expect(document.querySelector('[aria-label="费用去向"]')?.textContent).toContain("已弃牌")
    expect(document.querySelectorAll('[data-roll-entry]')).toHaveLength(4)
    await act(async () => button("查看Momo的补偿流水").click())
    expect(document.querySelector('[aria-label="逐笔流水"]')?.textContent).toContain("收到合计 121")
    expect(document.querySelectorAll('[data-roll-allocation="momo"]')).toHaveLength(4)
    await act(async () => button("查看全部").click())
    expect(document.querySelector('[aria-label="逐笔流水"]')?.textContent).toContain("支付合计 403")
    await act(async () => root.unmount())
  })
  it("缺失明细显示暂不可用，已知空明细显示暂无费用", async () => {
    const { root, render } = await mount({ ...feeTable, rollLedger: undefined })
    expect(document.body.textContent).toContain("费用明细暂不可用")
    expect(document.querySelector('[aria-label="费用来源"]')).toBeNull()
    await render({ ...feeTable, rollLedger: { ...feeLedger, entries: [] } })
    expect(document.body.textContent).toContain("本手暂无 Roll 费用")
    await act(async () => root.unmount())
  })
  it("收入筛选随实时快照更新；消失的身份清除筛选，结算/取消不伪装到账", async () => {
    const { root, render } = await mount()
    await act(async () => button("查看老陈的补偿流水").click())
    expect(document.querySelector('[aria-label="逐笔流水"]')?.textContent).toContain("收到合计 40")
    await render({ ...feeTable, rollLedger: { ...feeLedger, entries: feeLedger.entries.map(entry => entry.id === "r1" ? { ...entry, fee: 80, compensations: entry.compensations.map(share => ({ ...share, amount: share.amount * 2 })) } : entry) } })
    expect(document.querySelector('[aria-label="逐笔流水"]')?.textContent).toContain("收到合计 50")
    await render({ ...feeTable, rollLedger: { ...feeLedger, status: "released" } })
    expect(document.body.textContent).toContain("已结算")
    expect(document.body.textContent).not.toContain("待结算")
    await render({ ...feeTable, rollLedger: { ...feeLedger, status: "cancelled", entries: [feeLedger.entries[3]] } })
    expect(document.body.textContent).toContain("已取消")
    expect(document.querySelector('[aria-label="逐笔流水"]')?.textContent).toContain("支付合计 180")
    expect(document.body.textContent).not.toContain("本手结束到账")
    await act(async () => root.unmount())
  })
  it("不展示与当前手不匹配的迟到明细，且使用点数房的资金单位", async () => {
    const { root, render } = await mount({ ...feeTable, mode: "points" })
    expect(document.querySelector('[aria-label="逐笔流水"]')?.textContent).toContain("支付合计 403 点数")
    await render({ ...feeTable, handId: "new-hand" })
    expect(document.body.textContent).toContain("费用明细暂不可用")
    expect(document.querySelector('[aria-label="费用来源"]')).toBeNull()
    await act(async () => root.unmount())
  })
})
