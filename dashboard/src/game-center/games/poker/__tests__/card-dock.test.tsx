/** @vitest-environment jsdom */
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { PokerCardDockFlow } from "../components/PokerCardDockFlow"
import { cardTable } from "./card-stage-fixture"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.assign(HTMLDialogElement.prototype, {
  showModal(this: HTMLDialogElement) { this.open = true },
  close(this: HTMLDialogElement) { this.open = false },
})

const roots: Root[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.replaceChildren()
})

function snapshot(): PokerTableView {
  const table = structuredClone(cardTable)
  const cards = table.cards!
  cards.version = "cards-v2"
  cards.definitions!["01"].play = { cancelUntil: "target-confirm", result: "holes" }
  cards.ownHand![0].choices = cards.ownHand![0].choices.slice(0, 1)
  return table
}
const dialog = () => document.querySelector("dialog[open]")
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text)!
async function click(target: HTMLElement | null) {
  expect(target).not.toBeNull()
  await act(async () => target!.click())
}
async function escape() {
  const event = new Event("cancel", { cancelable: true })
  await act(async () => dialog()?.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true)
}
async function mount(table: PokerTableView) {
  const host = document.createElement("div"), root = createRoot(host)
  roots.push(root); document.body.append(host)
  const controls = { blocked: false, storageError: false, canControl: true, busy: false, uncertain: false, error: null, play: vi.fn(async () => {}), choose: vi.fn(async () => {}), retry: vi.fn() }
  const dropArea = createRef<HTMLDivElement>()
  const render = (state = table, canControl = true, intelOpen = false) => act(async () => root.render(<>
    <div ref={dropArea} />
    <PokerCardDockFlow table={state} controls={{ ...controls, canControl }} disabled={false} dropArea={dropArea} onActivate={vi.fn()} onRefresh={vi.fn()} intelOpen={intelOpen} />
    <button type="button">一池</button>
  </>))
  await render()
  return { render, controls, dropArea }
}

it("等待时预览价格；选择目标前可以放弃，重新报价保留目标", async () => {
  const before = snapshot(), { controls, render } = await mount(before)
  const card = document.querySelector<HTMLButtonElement>(".poker-hand-dock-card")!
  await render(before, false)
  expect(card.getAttribute("aria-disabled")).toBe("true")
  expect(card.getAttribute("aria-label")).toContain("2 筹码")
  await click(card)
  expect(dialog()).toBeNull()
  await render()
  await click(card)
  expect(dialog()?.textContent).toContain("选择要替换的底牌")
  await escape()
  expect(dialog()).toBeNull()
  expect(controls.play).not.toHaveBeenCalled()
  await click(card)
  await click(dialog()!.querySelector('button[data-choice="hole"][value="1"]'))
  const updated = structuredClone(before)
  updated.actionSeq!++
  updated.cards!.ownHand![0].payment = { nominalAmount: 6, waivedAmount: 0, paidAmount: 6, version: "new-quote" }
  await render(updated)
  expect(dialog()!.querySelector('button[data-choice="hole"][value="1"]')?.getAttribute("aria-pressed")).toBe("true")
  expect(dialog()?.textContent).toContain("报价已更新")
  await click(button("采用 6 筹码报价"))
  expect(controls.play).not.toHaveBeenCalled()
  await click(button("支付 6 筹码并确认"))
  expect(controls.play).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ selections: { hole: "1" }, expectedPaymentVersion: "new-quote", expectedActionSeq: 4 }))
})

it("手牌上方空间不足时缩小预览牌面，浮层底部避开手牌", async () => {
  await mount(snapshot())
  const card = document.querySelector<HTMLButtonElement>(".poker-hand-dock-card")!
  const dock = card.closest<HTMLElement>(".poker-hand-dock")!
  let top = 140
  card.getBoundingClientRect = () => new DOMRect(100, top, 54, 72)
  dock.getBoundingClientRect = () => new DOMRect(0, top, 360, 72)
  await act(async () => card.dispatchEvent(Object.assign(new MouseEvent("pointerover", { bubbles: true }), { pointerType: "mouse" })))
  const preview = document.querySelector<HTMLElement>('[role="tooltip"]')!
  expect(preview.textContent).toContain("实付 2 筹码")
  expect(preview.dataset.compact).toBe("true")
  expect(window.innerHeight - parseFloat(preview.style.bottom)).toBeLessThan(top)
  expect(parseFloat(preview.style.maxHeight)).toBeLessThan(top)

  top = 400
  await act(async () => window.dispatchEvent(new Event("resize")))
  expect(preview.dataset.compact).toBe("false")
  expect(window.innerHeight - parseFloat(preview.style.bottom)).toBeLessThan(top)
})

it.each(["牌桌快照刷新", "卡牌已有键盘焦点"])("%s时，鼠标快速移到下注档位后关闭手牌预览", async scenario => {
  const table = snapshot()
  const { render } = await mount(table)
  const card = document.querySelector<HTMLButtonElement>(".poker-hand-dock-card")!
  const preset = button("一池")
  const tooltip = () => document.querySelector('[role="tooltip"]')
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  try {
    if (scenario === "卡牌已有键盘焦点") {
      await act(async () => {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
        card.focus()
      })
      expect(card.matches(":focus-visible")).toBe(true)
    }
    await act(async () => card.dispatchEvent(Object.assign(new MouseEvent("pointerover", { bubbles: true }), { pointerType: "mouse" })))
    expect(tooltip()?.textContent).toContain("拖到牌桌使用")
    await act(async () => card.dispatchEvent(Object.assign(new MouseEvent("pointerout", { bubbles: true, relatedTarget: preset }), { pointerType: "mouse" })))
    if (scenario === "牌桌快照刷新") await render(structuredClone(table))
    await act(async () => vi.advanceTimersByTime(200))
    expect(tooltip()).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

it("免费选择玩家只显示确定，单一目标仍需主动选择", async () => {
  const table = snapshot(), card = table.cards!.ownHand![0]
  card.payment = { nominalAmount: 2, waivedAmount: 2, paidAmount: 0, version: "waived" }
  card.choices = [{ key: "player", label: "目标玩家", kind: "player", options: [{ value: "1", label: "座位2" }] }]
  const { controls } = await mount(table)
  await click(document.querySelector(".poker-hand-dock-card"))
  expect(dialog()?.querySelector("h2")?.textContent).toBe("选择玩家")
  expect(dialog()?.textContent).not.toMatch(/无需筹码|实付|豁免|放弃使用/)
  expect(button("确定").disabled).toBe(true)
  expect(dialog()?.querySelectorAll('button[aria-label="放弃使用"]')).toHaveLength(1)
  await click(dialog()!.querySelector('button[data-choice="player"]'))
  await click(button("确定"))
  expect(controls.play).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ selections: { player: "1" }, expectedPaymentVersion: "waived" }))
})

it("刷新恢复五选一时强制完成，不接受 Escape，完成后居中显示新底牌", async () => {
  const pending = snapshot()
  const cards = pending.cards!
  cards.definitions!["07"] = { id: "07", name: "五选其一", artId: "v2/07", description: "随机锁定一张底牌。", cost: 12, play: { cancelUntil: "never", result: "holes", candidates: 5 } }
  cards.pending = { choiceId: "choice", kind: "poker", origin: "card", paymentVersion: "paid", sourceCardId: "07", cardIndex: 1, candidates: ["2c", "Qc", "8d", "Td", "7s"] }
  cards.used = [{ id: "played", cardId: "07", name: "五选其一", seatNo: 0, seq: pending.actionSeq!, status: "choice_required" }]
  const { controls, render } = await mount(pending)
  expect(dialog()?.querySelectorAll('[data-choice="candidate"]')).toHaveLength(5)
  expect(dialog()?.textContent).toContain("替换第 2 张底牌")
  expect(dialog()?.querySelector(".close-overlay")).toBeNull()
  await escape()
  expect(dialog()).not.toBeNull()
  expect(controls.choose).not.toHaveBeenCalled()
  await click(dialog()!.querySelector('button[data-choice="candidate"][value="2"]'))
  await click(button("确定"))
  expect(controls.choose).toHaveBeenCalledExactlyOnceWith(2)
  expect(controls.play).not.toHaveBeenCalled()
  const completed = structuredClone(pending)
  completed.cards!.pending = null; completed.cards!.used[0].status = "completed"
  delete completed.cards!.definitions!["07"]
  completed.hole = ["As", "8d"]; completed.actionSeq!++
  await render(completed)
  expect(dialog()?.textContent).toContain("换牌完成")
  expect(dialog()?.querySelector('.intel-values [data-card="8d"]')).not.toBeNull()
  await click(button("完成"))
  expect(dialog()).toBeNull()
})

it("无目标能力牌只有拖入牌桌才会提交，鼠标单击和在外部放开均不使用", async () => {
  const table = snapshot()
  const card = table.cards!.ownHand![0]
  card.choices = []
  table.cards!.definitions!["01"].play = { cancelUntil: "never", result: "table" }
  const { controls, dropArea } = await mount(table)
  const trigger = document.querySelector<HTMLButtonElement>(".poker-hand-dock-card")!
  trigger.setPointerCapture = vi.fn()
  trigger.hasPointerCapture = vi.fn(() => false)
  dropArea.current!.getBoundingClientRect = () => new DOMRect(20, 30, 300, 300)
  const fire = async (type: string, x: number, y: number, pointerType = "mouse") => {
    const event = Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, detail: 1 }), { pointerId: 7, pointerType, isPrimary: true })
    await act(async () => { trigger.dispatchEvent(event) })
  }
  await fire("pointerdown", 100, 450); await fire("pointerup", 100, 450); await fire("click", 100, 450)
  await fire("pointerdown", 100, 450); await fire("pointermove", 400, 150); await fire("pointerup", 400, 150)
  expect(controls.play).not.toHaveBeenCalled()
  await fire("pointerdown", 100, 450); await fire("pointermove", 150, 150)
  expect(dropArea.current!.hasAttribute("data-card-drop")).toBe(true)
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  expect(dropArea.current!.hasAttribute("data-card-drop")).toBe(false)
  await fire("pointerup", 150, 150)
  expect(controls.play).not.toHaveBeenCalled()
  await fire("pointerdown", 100, 450); await fire("pointermove", 150, 150); await fire("pointerup", 150, 150); await fire("click", 150, 150)
  expect(controls.play).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instanceId: card.instanceId, selections: {} }))
  expect(dialog()).toBeNull()
  controls.play.mockClear()
  await fire("pointerdown", 100, 350, "touch"); await fire("pointermove", 220, 310, "touch"); await fire("pointercancel", 220, 310, "touch")
  expect(controls.play).not.toHaveBeenCalled()
  await fire("pointerdown", 100, 450, "touch"); await fire("pointermove", 105, 300, "touch"); await fire("pointerup", 105, 300, "touch")
  expect(controls.play).toHaveBeenCalledOnce()

  controls.play.mockClear()
  const tap = async () => {
    await fire("pointerdown", 100, 450, "touch"); await fire("pointerup", 100, 450, "touch"); await fire("click", 100, 450)
  }
  await tap()
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("再次点按或向上拖动使用")
  expect(controls.play).not.toHaveBeenCalled()
  await tap()
  expect(controls.play).toHaveBeenCalledOnce()
})

it("私查牌立即提交且只显示本次结果，已消耗卡牌的定义可以从快照移除", async () => {
  const before = snapshot(), cards = before.cards!
  cards.ownHand = [{ ...cards.ownHand![0], cardId: "11", choices: [] }]
  cards.definitions = { "11": { id: "11", name: "先知之眼", artId: "v1/11", cost: 0, description: "私下查看下一张公共牌。", play: { cancelUntil: "never", result: "intel" } } }
  cards.privateResults = [{ id: "old-intel", cardId: "11", label: "next", values: ["7h"], valid: true }]
  const { controls, render } = await mount(before)
  await click(document.querySelector(".poker-hand-dock-card"))
  expect(controls.play).toHaveBeenCalledOnce()
  expect(dialog()?.querySelector("[data-card='7h']")).toBeNull()
  expect(dialog()?.querySelector(".close-overlay")).toBeNull()
  const after = structuredClone(before)
  after.actionSeq!++
  after.cards!.ownHand = []
  after.cards!.definitions = {}
  after.cards!.used = [{ id: "used-11", cardId: "11", name: "先知之眼", seatNo: 0, seq: after.actionSeq!, status: "completed" }]
  after.cards!.privateResults!.push({ id: "new-intel", cardId: "11", label: "next", values: ["9d"], valid: true })
  await render(after)
  expect(dialog()?.querySelector("[data-card='9d']")).not.toBeNull()
  expect(dialog()?.querySelector("[data-card='7h']")).toBeNull()
  await escape()
  expect(dialog()).toBeNull()
  await render(after, true, true)
  expect(dialog()?.querySelector("[data-card='7h']")).not.toBeNull()
  expect(dialog()?.querySelector("[data-card='9d']")).not.toBeNull()
})
