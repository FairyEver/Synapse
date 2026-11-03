import "@/styles/globals.css"
import "../../../styles/web.css"
import { useState } from "react"
import { Button } from "@heroui/react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import { PokerCardsDialog } from "../components/PokerCardsDialog"
import { PokerCardDockFlow } from "../components/PokerCardDockFlow"
import { PokerReserveDialog } from "../components/PokerReserveDialog"
import { SettlementPanel } from "../components/SettlementPanel"
import { Table } from "../components/Table"
import { rollTable } from "./roll-visibility-fixtures"
import { cardTable } from "./card-stage-fixture"
import { table as settled } from "./settlement-fixture"
import manifest from "../assets/ability-cards/v1/manifest.json"

vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { table: { state: vi.fn() }, card: { play: vi.fn(), choose: vi.fn() } } }) }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", connectivity: "online", profile: { user: { id: "card-browser" } } } }) }))
const noop = vi.fn(), controls = { blocked: false, storageError: null, canControl: true, busy: false, uncertain: false, error: null, play: noop, choose: noop, retry: noop }
const names = manifest.cards.slice(0, 18)
const cards: PokerTableView["cards"] = { enabled: true, version: "cards-v1", used: [], statuses: [], pending: null,
  definitions: Object.fromEntries(names.map(c => [c.cardId, { id: c.cardId, name: c.name, description: `${c.name}。选择合法目标后使用。` + "LongUnbrokenDescription".repeat(3), artId: `v1/${c.cardId}`, cost: 0 }])),
  ownHand: names.map(c => ({ instanceId: `held-${c.cardId}`, cardId: c.cardId, available: true, choices: [], payment: { nominalAmount: 0, waivedAmount: 0, paidAmount: 0, version: "q" } })), privateResults: [],
}
const table: PokerTableView = { ...rollTable, seats: rollTable.seats.slice(0, 6), maxSeats: 6, deadlineMs: 300000, ruleOptions: { cards: true, roll: true }, cardRulesVersion: "cards-v1", chipRulesVersion: "chips-v2", cards }
type Panel = "cards" | "target" | "guess" | "material" | "status" | "ability" | "poker" | "reserve" | "settlement"
const evidence = "/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-03-poker-card-stage-implementation/browser"
function Fixture({ panel, recovery }: { panel: Panel; recovery?: "uncertain" | "storage" }) {
  const [open, setOpen] = useState(false)
  const snapshot = structuredClone(table)
  if (panel === "target") snapshot.cards!.ownHand = [{ ...cards.ownHand![3], choices: [
    { key: "hole", label: "本人底牌", kind: "hole", options: [{ value: "0", label: "底牌1" }, { value: "1", label: "底牌2" }] },
    { key: "player", label: "目标玩家", kind: "player", options: Array.from({ length: 5 }, (_, i) => ({ value: String(i + 1), label: `玩家${i + 1}` + "LongUnbrokenPlayerName".repeat(5) })) },
  ] }]
  if (panel === "guess") snapshot.cards!.ownHand = [{ ...cards.ownHand![0], choices: [
    { key: "targetHole", label: "目标底牌", kind: "hole", options: [{ value: "1:0", label: "座位2 · 底牌1" }, { value: "1:1", label: "座位2 · 底牌2" }] },
    { key: "color", label: "猜颜色", kind: "color", options: [{ value: "red", label: "红色" }, { value: "black", label: "黑色" }] },
  ] }]
  if (panel === "material") {
    snapshot.cards!.definitions!["24"] = { id: "24", name: "弃旧图新", description: "额外消耗自己另一张能力牌，从共享池抽两张。", artId: "v1/24", cost: 0, consumeSelected: true }
    snapshot.cards!.ownHand = [{ ...cards.ownHand![0], instanceId: "material-source", cardId: "24", choices: [{ key: "ability", label: "另一张能力牌", kind: "ability", options: cards.ownHand!.slice(1).map(item => ({ value: item.instanceId, label: cards.definitions![item.cardId].name })) }] }, ...cards.ownHand!.slice(1)]
  }
  if (panel === "status") {
    snapshot.cards!.definitions!["45"] = { id: "45", name: "驱散术", description: "选择并移除一个公开、可驱散的持续效果。", artId: "v1/45", cost: 0 }
    snapshot.cards!.ownHand = [{ ...cards.ownHand![0], instanceId: "dispel", cardId: "45", choices: [{ key: "status", label: "持续效果", kind: "status", options: [
      { value: "shield-own", label: "座位1（本人） · 缄默护罩 · 剩余1次" },
      { value: "shield-other", label: "座位2 · 缄默护罩 · 剩余2次" },
      { value: "field", label: "全场 · 众目睽睽" },
      { value: "marker-a", label: "座位2 · 底牌1 · 众目睽睽" },
      { value: "marker-b", label: "座位2 · 底牌2 · 众目睽睽" },
    ] }] }]
  }
  if (panel === "ability" || panel === "poker") snapshot.cards!.pending = { choiceId: "choice", kind: panel, origin: "card", paymentVersion: "q", candidates: panel === "ability" ? ["01", "02", "03"] : ["As", "Kh", "Qc"], ...(panel === "ability" ? { candidateCards: ["01", "02", "03"].map(id => cards.definitions![id]) } : {}) }
  if (snapshot.cards!.pending) snapshot.cards!.privateResults = [
    { id: "observed-hole", cardId: "13", label: "one", values: ["2s"], valid: true },
    { id: "observed-suit", cardId: "19", label: "suit", values: ["h"], valid: true },
    { id: "observed-rank", cardId: "20", label: "rank", values: ["K"], valid: true },
  ]
  snapshot.reserve = { handId: snapshot.handId!, status: "pending", total: 60, complete: true,
    players: [0, 1].map(i => ({ key: `p${i}`, seatNo: i, displayName: "LongUnbrokenPlayerName".repeat(5), pending: i ? 60 : 0, isMe: !i })),
    lots: [{ id: "lot", payerKey: "p0", sourceType: "card", originalAmount: 120, remainingAmount: 60, shares: [{ key: "p1", originalAmount: 120, remainingAmount: 60 }] }],
    movements: Array.from({ length: 24 }, (_, i) => ({ id: `m${i}`, seq: i, lotId: "lot", kind: i ? "steal" as const : "deposit" as const, amount: i ? 2 : 120, recipientKey: "p0", actorKey: "p0", beneficiaryKey: "p1" })),
  }
  return <><Button onPress={() => setOpen(true)}>打开测试面板</Button>
    {open && panel === "reserve" && <PokerReserveDialog table={snapshot} onClose={() => setOpen(false)} />}
    {panel === "settlement" && <SettlementPanel table={settled} perspective="owner" onRefresh={noop} ready={{ canReady: true, canTakeover: false, prepared: false, busy: false, error: null, ready: noop, takeover: noop, refresh: noop }} />}
    {!["reserve", "settlement"].includes(panel) && <PokerCardsDialog table={snapshot} open={open} onOpenChange={setOpen} controls={recovery ? { ...controls, blocked: recovery === "uncertain", uncertain: recovery === "uncertain", storageError: recovery === "storage", error: "恢复失败：" + "长错误说明".repeat(16) } : controls} disabled={false} epoch="browser" />}
  </>
}
function fits(element: Element, label: string) {
  const r = element.getBoundingClientRect()
  expect(r.left, label).toBeGreaterThanOrEqual(-1); expect(r.top, label).toBeGreaterThanOrEqual(-1)
  expect(r.right, label).toBeLessThanOrEqual(innerWidth + 1); expect(r.bottom, label).toBeLessThanOrEqual(innerHeight + 1)
}
for (const [width, height] of [[1280, 800], [390, 667], [390, 844], [320, 568], [568, 320], [667, 320]]) {
  for (const panel of ["cards", "target", "guess", "material", "status", "ability", "poker", "reserve", "settlement"] as const) it(`${width}×${height} ${panel} 展开、固定顶底及滚动边界`, async () => {
    await page.viewport(width, height)
    const screen = await render(<Fixture panel={panel} />)
    try {
      if (panel !== "settlement") await page.getByRole("button", { name: "打开测试面板", exact: true }).click()
      await expect.element(page.getByRole("dialog")).toBeVisible()
      if (["target", "guess", "material", "status"].includes(panel)) {
        const source = panel === "target" ? "精准调包" : panel === "status" ? "驱散术" : panel === "material" ? "弃旧图新" : "换牌术"
        await page.getByRole("button", { name: source, exact: true }).click()
      }
      await new Promise(resolve => setTimeout(resolve, 800))
      const gameStage = !["reserve", "settlement"].includes(panel)
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      const body = dialog.querySelector<HTMLElement>(gameStage ? ".inspect-details, .view" : ".modal__body")!
      const footer = dialog.querySelector<HTMLElement>(gameStage ? ".stage-footer" : ".modal__footer")!
      const header = dialog.querySelector<HTMLElement>(gameStage ? ".stage-top" : ".modal__header")!
      fits(dialog, "dialog"); fits(header, "header"); fits(footer, "footer")
      expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1)
      expect(body.clientHeight).toBeGreaterThan(24)
      for (const button of footer.querySelectorAll("button")) { fits(button, "footer button"); expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(36) }
      const scrolls = [...dialog.querySelectorAll<HTMLElement>("*")].filter(el => /^(auto|scroll)$/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)
      expect(scrolls.every(el => gameStage ? el.classList.contains("inspect-details") : el === body)).toBe(true)
      if (gameStage) {
        expect(dialog.querySelector(".modal__dialog")).toBeNull()
        expect(dialog.contains(document.activeElement)).toBe(false)
        const card = dialog.querySelector<HTMLElement>(".inspect-card")
        const details = dialog.querySelector<HTMLElement>(".inspect-details")
        if (card && details) {
          fits(card, "fixed inspected card")
          expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(details.getBoundingClientRect().left)
          const y = card.getBoundingClientRect().top, top = header.getBoundingClientRect().top, bottom = footer.getBoundingClientRect().bottom
          details.scrollTop = details.scrollHeight
          expect(card.getBoundingClientRect().top).toBe(y)
          expect(header.getBoundingClientRect().top).toBe(top); expect(footer.getBoundingClientRect().bottom).toBe(bottom)
          details.scrollTop = 0
          expect(parseFloat(getComputedStyle(dialog.querySelector(".full-description") ?? details).fontSize)).toBeGreaterThanOrEqual(width > 850 ? 18 : 16)
        }
      }
      await page.screenshot({ path: `${evidence}/${width}-${height}-${panel}-top.png` })
      if (panel === "status") {
        await page.getByRole("button", { name: "座位2 · 缄默护罩 · 剩余2次", exact: true }).click()
        await page.getByRole("button", { name: "确定", exact: true }).click()
        expect(controls.play).toHaveBeenLastCalledWith(expect.objectContaining({ instanceId: "dispel", selections: { status: "shield-other" } }))
      }
      if (panel === "guess") {
        await page.getByRole("button", { name: "座位2 · 底牌1", exact: true }).click()
        await page.getByRole("button", { name: "红色", exact: true }).click()
        await page.getByRole("button", { name: "确定", exact: true }).click()
        expect(controls.play).toHaveBeenLastCalledWith(expect.objectContaining({ selections: { targetHole: "1:0", color: "red" } }))
      }
      if (panel === "ability" || panel === "poker") {
        const previous = controls.choose.mock.calls.length
        await page.getByRole("button", { name: /^候选 1，/ }).click()
        await expect.element(page.getByRole("button", { name: "确定", exact: true })).toBeEnabled()
        await page.getByRole("button", { name: "确定", exact: true }).click()
        expect(controls.choose).toHaveBeenCalledTimes(previous + 1)
        expect(controls.choose).toHaveBeenLastCalledWith(0)
      }
      if (panel === "reserve") {
        body.scrollTop = 0
        await page.getByRole("button", { name: "全部 来源", exact: true }).click()
        await expect.element(page.getByRole("listbox")).toBeVisible()
        await new Promise(resolve => setTimeout(resolve, 250))
        fits(page.getByRole("listbox").element(), "source popover")
        await page.screenshot({ path: `${evidence}/${width}-${height}-${panel}-filter.png` })
        await userEvent.keyboard("{Escape}")
        await expect.element(page.getByRole("listbox")).not.toBeInTheDocument()
        await page.getByRole("button", { name: "全部 来源", exact: true }).click()
        await page.getByRole("option", { name: "卡牌", exact: true }).click()
        await expect.element(page.getByRole("listbox")).not.toBeInTheDocument()
      }
      if (gameStage) await page.getByRole("button", { name: "关闭卡牌", exact: true }).click()
      else await userEvent.keyboard("{Escape}")
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument()
    } finally { await screen.unmount() }
  })
}
for (const width of [1280, 320]) it(`${width}px 待选回看情报并返回同一张预选，只有确认才提交`, async () => {
  await page.viewport(width, width === 320 ? 568 : 800)
  const screen = await render(<Fixture panel="poker" />)
  try {
    const previous = controls.choose.mock.calls.length
    await page.getByRole("button", { name: "打开测试面板", exact: true }).click()
    await page.getByRole("button", { name: /^候选 2，/ }).click()
    await page.getByRole("button", { name: "本人情报", exact: true }).click()
    await expect.element(page.getByRole("heading", { name: "本人情报", exact: true })).toBeVisible()
    fits(document.querySelector('.intel-values [data-card="2s"]')!, "authorized observation")
    fits(document.querySelector(".stage-footer")!, "intel footer")
    expect(controls.choose).toHaveBeenCalledTimes(previous)
    await page.screenshot({ path: `${evidence}/${width}-pending-intel.png` })
    await page.getByRole("button", { name: "返回选牌", exact: true }).click()
    await expect.element(page.getByRole("button", { name: /^候选 2，/ })).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("button", { name: "确定", exact: true }).click()
    expect(controls.choose).toHaveBeenCalledTimes(previous + 1)
    expect(controls.choose).toHaveBeenLastCalledWith(1)
  } finally { await screen.unmount() }
})

for (const [width, height] of [[1280, 800], [320, 568], [568, 320]]) it(`${width}×${height} 手牌任务的玩家、候选与确认共用中轴`, async () => {
  await page.viewport(width, height)
  const table = structuredClone(cardTable), hand = table.cards!.ownHand![0]
  hand.choices = [{ key: "player", kind: "player", label: "目标玩家", options: [{ value: "1", label: "座位2" }] }]
  table.seats[1].displayName = "LongUnbrokenPlayerName".repeat(2)
  table.cards!.definitions![hand.cardId].play = { cancelUntil: "target-confirm", result: "intel" }
  const flow = (snapshot: PokerTableView) => <div className="poker-immersive" data-control-layout="docked" data-hand-dock="true"><div className="poker-controls-anchor">
    <PokerCardDockFlow table={snapshot} controls={controls} disabled={false} onActivate={noop} onRefresh={noop} />
  </div></div>
  const screen = await render(flow(table))
  const center = (element: Element) => { const { left, width } = element.getBoundingClientRect(); return left + width / 2 }
  try {
    page.getByRole("button", { name: /偷梁换柱/ }).element().dispatchEvent(new MouseEvent("click", { bubbles: true }))
    const dialog = page.getByRole("dialog"), heading = dialog.getByRole("heading", { name: "选择玩家" })
    const option = dialog.getByRole("button", { name: /LongUnbrokenPlayerName/ })
    const confirm = dialog.getByRole("button", { name: "支付 2 筹码并确认" })
    await expect.element(heading).toBeVisible()
    await Promise.all(dialog.element().getAnimations().map(animation => animation.finished))
    const axis = center(dialog.element())
    for (const element of [heading.element(), option.element(), confirm.element()]) {
      expect(center(element)).toBeCloseTo(axis, 0)
      fits(element, "player task")
    }
    const optionWidth = option.element().getBoundingClientRect().width
    const optionButton = option.element() as HTMLButtonElement
    optionButton.click()
    await expect.element(option).toHaveAttribute("aria-pressed", "true")
    expect(option.element().getBoundingClientRect().width).toBe(optionWidth)
    await page.screenshot({ path: `${evidence}/${width}-${height}-dock-player.png` })

    const pending = structuredClone(table)
    pending.cards!.pending = { choiceId: "three", kind: "poker", origin: "card", paymentVersion: "paid", cardIndex: 1, candidates: ["9d", "Kd", "Kc"] }
    await screen.rerender(flow(pending))
    const card = dialog.getByRole("button", { name: /^候选 1，/ }).element() as HTMLButtonElement
    const face = card.querySelector(".poker-card-front")!
    expect(parseFloat(getComputedStyle(face).borderTopLeftRadius)).toBeGreaterThan(0)
    expect(getComputedStyle(face).borderTopLeftRadius).toBe(getComputedStyle(card).borderTopLeftRadius)
    const size = card.getBoundingClientRect().width
    card.click()
    await expect.element(dialog.getByRole("button", { name: /^候选 1，/ })).toHaveAttribute("aria-pressed", "true")
    expect(card.querySelector(".selection-tick")).not.toBeNull()
    expect(card.getBoundingClientRect().width).toBe(size)
    await page.screenshot({ path: `${evidence}/${width}-${height}-dock-three-candidates.png` })

    pending.cards!.pending = { ...pending.cards!.pending, choiceId: "five", candidates: ["2c", "Qc", "8d", "Td", "7s"] }
    await screen.rerender(flow(pending))
    const candidates = dialog.getByRole("button", { name: /^候选 \d，/ }).elements()
    expect(candidates).toHaveLength(5)
    for (const card of candidates) fits(card, "candidate card")
    expect((candidates[0].getBoundingClientRect().left + candidates.at(-1)!.getBoundingClientRect().right) / 2).toBeCloseTo(axis, 0)
    const choose = dialog.getByRole("button", { name: "确定", exact: true })
    fits(choose.element(), "candidate confirm")
    expect(center(choose.element())).toBeCloseTo(axis, 0)
    await page.screenshot({ path: `${evidence}/${width}-${height}-dock-candidates.png` })
  } finally { await screen.unmount() }
})
for (const [width, height] of [[320, 568], [568, 320]]) for (const recovery of ["uncertain", "storage"] as const) it(`${width}×${height} ${recovery} 恢复按钮和信息入口始终在底栏内`, async () => {
  await page.viewport(width, height)
  const screen = await render(<Fixture panel="cards" recovery={recovery} />)
  try {
    await page.getByRole("button", { name: "打开测试面板", exact: true }).click()
    await expect.element(page.getByRole("dialog")).toBeVisible()
    const footer = document.querySelector<HTMLElement>(".stage-footer")!
    fits(footer, "recovery footer")
    for (const button of footer.querySelectorAll("button")) fits(button, "recovery action")
    const retry = page.getByRole("button", { name: recovery === "storage" ? "重试恢复记录" : "核对原用牌请求", exact: true }), prior = controls.retry.mock.calls.length
    await retry.click(); expect(controls.retry).toHaveBeenCalledTimes(prior + 1)
    await page.screenshot({ path: `${evidence}/${width}-${height}-${recovery}.png` })
  } finally { await screen.unmount() }
})
it("候选选中保持静态描边，另一张 hover 抬起，Escape 关闭卡牌", async () => {
  await page.viewport(1280, 800)
  const screen = await render(<Fixture panel="poker" />)
  try {
    await page.getByRole("button", { name: "打开测试面板", exact: true }).click()
    const first = page.getByRole("button", { name: /^候选 1，/ })
    await first.click()
    const selected = first.element().parentElement!
    const hovered = page.getByRole("button", { name: /^候选 2，/ })
    expect(first.element().querySelector(".selection-tick")).not.toBeNull()
    await hovered.hover()
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(new DOMMatrix(getComputedStyle(selected).transform).m42).toBe(0)
    expect(new DOMMatrix(getComputedStyle(hovered.element().parentElement!).transform).m42).toBeLessThan(0)
    await userEvent.keyboard("{Escape}")
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument()
  } finally { await screen.unmount() }
})
it("少量详情与左卡在中间区域居中，能力候选完整规则只在右侧滚动", async () => {
  await page.viewport(1280, 800)
  const screen = await render(<Fixture panel="cards" />)
  try {
    await page.getByRole("button", { name: "打开测试面板", exact: true }).click()
    await page.getByRole("button", { name: "换牌术", exact: true }).click()
    const body = document.querySelector<HTMLElement>(".inspect-body")!, details = document.querySelector<HTMLElement>(".inspect-details")!, card = document.querySelector<HTMLElement>(".inspect-card")!
    const middle = (element: HTMLElement) => { const box = element.getBoundingClientRect(); return box.top + box.height / 2 }
    expect(Math.abs(middle(body) - middle(details))).toBeLessThan(3)
    expect(Math.abs(middle(card) - middle(details))).toBeLessThan(3)
  } finally { await screen.unmount() }
})
it.each([[1280, 800], [320, 568], [568, 320]])("%s×%s 等待状态和手牌增减不移动行动按钮，矮屏预览避开手牌", async (width, height) => {
  await page.viewport(width, height)
  const hand = cardTable.cards!.ownHand!
  const fixture = (ownHand: typeof hand, actionOnSeat = cardTable.actionOnSeat) => <div className="h-dvh">
    <Table table={{ ...cardTable, actionOnSeat, legalActions: actionOnSeat === cardTable.mySeatNo ? cardTable.legalActions : [],
      cards: { ...cardTable.cards!, version: "cards-v2", ownHand } }} perspective="owner" onPerspective={noop} onBack={noop} />
  </div>
  const screen = await render(fixture(hand))
  try {
    const anchor = document.querySelector(".poker-controls-anchor")!
    const actions = anchor.querySelector(".poker-action-buttons")!
    const presets = anchor.querySelector(".poker-bet-presets")!
    const card = anchor.querySelector(".poker-hand-dock-card")!
    const viewport = document.querySelector(".poker-canvas-viewport")!
    const bounds = actions.getBoundingClientRect()
    expect(getComputedStyle(actions).backgroundColor).toBe("rgba(0, 0, 0, 0)")
    expect(getComputedStyle(anchor).backgroundColor).toBe(getComputedStyle(anchor.closest(".poker-table")!).backgroundColor)
    expect(presets.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.top)
    expect(card.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.top)
    expect(bounds.width).toBeLessThan(anchor.getBoundingClientRect().width)
    const board = viewport.getBoundingClientRect().toJSON()
    if (height === 320) {
      await page.getByRole("button", { name: /偷梁换柱/ }).hover()
      const preview = page.getByRole("tooltip")
      await expect.element(preview).toHaveTextContent("实付 2 筹码")
      const panel = preview.element().getBoundingClientRect()
      const art = preview.element().querySelector("img")!.getBoundingClientRect()
      const fee = preview.element().querySelector("b")!.getBoundingClientRect()
      expect(panel.top).toBeGreaterThanOrEqual(8)
      expect(panel.bottom).toBeLessThan(card.getBoundingClientRect().top)
      expect(art.width).toBeLessThanOrEqual(68)
      expect(fee.bottom).toBeLessThanOrEqual(panel.bottom)
    }
    await screen.rerender(fixture(hand, 1))
    const status = anchor.querySelector(".poker-action-dock-status")!
    expect(status.textContent).toBe("等待 对手 行动")
    expect(actions.getBoundingClientRect().toJSON()).toEqual(bounds.toJSON())
    await screen.rerender(fixture([], 1))
    expect(anchor.querySelector(".poker-hand-dock-card")).toBeNull()
    expect(actions.getBoundingClientRect().toJSON()).toEqual(bounds.toJSON())
    expect(viewport.getBoundingClientRect().toJSON()).toEqual(board)
  } finally { await screen.unmount() }
})
it("850px两侧切换和卡牌面板开关复用原画布，减少动态效果仍可操作", async () => {
  const original = window.matchMedia.bind(window)
  const spy = vi.spyOn(window, "matchMedia").mockImplementation(query => query.includes("prefers-reduced-motion") ? { ...original(query), matches: true, addEventListener: noop, removeEventListener: noop } : original(query))
  await page.viewport(851, 700)
  const screen = await render(<div className="h-dvh"><Table table={table} perspective="owner" onPerspective={noop} onBack={noop} identityKey="card-browser" /></div>)
  try {
    const canvas = document.querySelector(".poker-canvas")!
    await page.getByRole("button", { name: "卡牌", exact: true }).click()
    await expect.element(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: "关闭卡牌", exact: true }).click()
    for (const width of [850, 849, 851]) { await page.viewport(width, 700); expect(document.querySelector(".poker-canvas")).toBe(canvas); fits(document.querySelector(".poker-controls-anchor")!, "controls") }
    await page.getByRole("button", { name: "卡牌", exact: true }).click()
    await expect.element(page.getByRole("dialog")).toBeVisible()
  } finally { await screen.unmount(); spy.mockRestore() }
})
for (const reduced of [false, true]) it(`星光实时帧实际反馈，去重、重连基线和身份隔离（减少动态${reduced}）`, async () => {
  const original = window.matchMedia.bind(window)
  const spy = vi.spyOn(window, "matchMedia").mockImplementation(query => query.includes("prefers-reduced-motion") ? { ...original(query), matches: reduced, addEventListener: noop, removeEventListener: noop } : original(query))
  await page.viewport(reduced ? 320 : 1280, reduced ? 568 : 800)
  const frame = { id: "spark-1", handId: table.handId!, seq: 4, events: [{ index: 0, type: "poker.sparked", cardId: "59", actorSeatNo: 0 }] }
  const props = { table, perspective: "owner" as const, onPerspective: noop, onBack: noop, identityKey: "spark-owner" }
  const screen = await render(<div className="h-dvh"><Table {...props} /></div>)
  try {
    await expect.element(page.getByText("星光一闪", { exact: true })).not.toBeInTheDocument()
    await screen.rerender(<div className="h-dvh"><Table {...props} animateFrames={[frame]} /></div>)
    await expect.element(page.getByText("星光一闪", { exact: true })).toBeVisible()
    const feedback = page.getByText("星光一闪", { exact: true }).element()
    fits(feedback, "spark feedback")
    expect(getComputedStyle(feedback.querySelector("svg")!).animationName).toBe(reduced ? "none" : "poker-card-spark")
    await page.screenshot({ path: `${evidence}/spark-${reduced ? "reduced-320" : "1280"}.png` })
    await new Promise(resolve => setTimeout(resolve, 1900))
    await expect.element(page.getByText("星光一闪", { exact: true })).not.toBeInTheDocument()
    await screen.rerender(<div className="h-dvh"><Table {...props} animateFrames={[{ ...frame }]} /></div>)
    await expect.element(page.getByText("星光一闪", { exact: true })).not.toBeInTheDocument()
    await screen.rerender(<div className="h-dvh"><Table {...props} animateFrames={[{ ...frame, id: "spark-2", seq: 5 }]} /></div>)
    await expect.element(page.getByText("星光一闪", { exact: true })).toBeVisible()
    await screen.rerender(<div className="h-dvh"><Table {...props} identityKey="another-owner" animateFrames={[{ ...frame, id: "spark-2", seq: 5 }]} /></div>)
    await expect.element(page.getByText("星光一闪", { exact: true })).not.toBeInTheDocument()
  } finally { await screen.unmount(); spy.mockRestore() }
})
