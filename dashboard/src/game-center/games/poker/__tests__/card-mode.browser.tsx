import "@/styles/globals.css"
import "../../../styles/web.css"
import { useState } from "react"
import { Button } from "@heroui/react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import { PokerCardsDialog } from "../components/PokerCardsDialog"
import { PokerReserveDialog } from "../components/PokerReserveDialog"
import { SettlementPanel } from "../components/SettlementPanel"
import { Table } from "../components/Table"
import { rollTable } from "./roll-visibility-fixtures"
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
type Panel = "cards" | "target" | "status" | "ability" | "poker" | "reserve" | "settlement"
const evidence = "/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-03-poker-card-mode/browser"
function Fixture({ panel }: { panel: Panel }) {
  const [open, setOpen] = useState(false)
  const snapshot = structuredClone(table)
  if (panel === "target") snapshot.cards!.ownHand = [{ ...cards.ownHand![3], choices: [
    { key: "hole", label: "本人底牌", kind: "hole", options: [{ value: "0", label: "底牌1" }, { value: "1", label: "底牌2" }] },
    { key: "player", label: "目标玩家", kind: "player", options: Array.from({ length: 5 }, (_, i) => ({ value: String(i + 1), label: `玩家${i + 1}` + "LongUnbrokenPlayerName".repeat(5) })) },
  ] }]
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
  if (panel === "ability" || panel === "poker") snapshot.cards!.pending = { choiceId: "choice", kind: panel, origin: "card", paymentVersion: "q", candidates: panel === "ability" ? ["01", "02", "03"] : ["As", "Kh", "Qc"], ...(panel === "ability" ? { candidateCards: Object.values(cards.definitions!).slice(0, 3) } : {}) }
  snapshot.reserve = { handId: snapshot.handId!, status: "pending", total: 60, complete: true,
    players: [0, 1].map(i => ({ key: `p${i}`, seatNo: i, displayName: "LongUnbrokenPlayerName".repeat(5), pending: i ? 60 : 0, isMe: !i })),
    lots: [{ id: "lot", payerKey: "p0", sourceType: "card", originalAmount: 120, remainingAmount: 60, shares: [{ key: "p1", originalAmount: 120, remainingAmount: 60 }] }],
    movements: Array.from({ length: 24 }, (_, i) => ({ id: `m${i}`, seq: i, lotId: "lot", kind: i ? "steal" as const : "deposit" as const, amount: i ? 2 : 120, recipientKey: "p0", actorKey: "p0", beneficiaryKey: "p1" })),
  }
  return <><Button onPress={() => setOpen(true)}>打开测试面板</Button>
    {open && panel === "reserve" && <PokerReserveDialog table={snapshot} onClose={() => setOpen(false)} />}
    {panel === "settlement" && <SettlementPanel table={settled} perspective="owner" onRefresh={noop} ready={{ canReady: true, canTakeover: false, prepared: false, busy: false, error: null, ready: noop, takeover: noop, refresh: noop }} />}
    {!["reserve", "settlement"].includes(panel) && <PokerCardsDialog table={snapshot} open={open} onOpenChange={setOpen} controls={controls} disabled={false} epoch="browser" />}
  </>
}
function fits(element: Element, label: string) {
  const r = element.getBoundingClientRect()
  expect(r.left, label).toBeGreaterThanOrEqual(-1); expect(r.top, label).toBeGreaterThanOrEqual(-1)
  expect(r.right, label).toBeLessThanOrEqual(innerWidth + 1); expect(r.bottom, label).toBeLessThanOrEqual(innerHeight + 1)
}
for (const [width, height] of [[1280, 800], [390, 667], [390, 844], [320, 568], [568, 320], [667, 320]]) {
  for (const panel of ["cards", "target", "status", "ability", "poker", "reserve", "settlement"] as const) it(`${width}×${height} ${panel} 展开、单正文滚动、标准按钮和键盘关闭`, async () => {
    await page.viewport(width, height)
    const screen = await render(<Fixture panel={panel} />)
    try {
      if (panel !== "settlement") await page.getByRole("button", { name: "打开测试面板", exact: true }).click()
      await expect.element(page.getByRole("dialog")).toBeVisible()
      if (panel === "target") await page.getByText("精准调包", { exact: true }).click()
      if (panel === "status") await page.getByText("驱散术", { exact: true }).click()
      await new Promise(resolve => setTimeout(resolve, 250))
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!, body = dialog.querySelector<HTMLElement>(".modal__body")!, footer = dialog.querySelector<HTMLElement>(".modal__footer")!, header = dialog.querySelector<HTMLElement>(".modal__header")!
      fits(dialog, "dialog"); fits(header, "header"); fits(footer, "footer")
      expect(header.getBoundingClientRect().left - dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(20)
      expect(header.getBoundingClientRect().top - dialog.getBoundingClientRect().top).toBeGreaterThanOrEqual(20)
      expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1)
      expect(body.clientHeight).toBeGreaterThan(24)
      for (const button of footer.querySelectorAll("button")) { fits(button, "footer button"); expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(36) }
      for (const image of body.querySelectorAll<HTMLImageElement>(".poker-ability-art")) { expect(image.loading).toBe("lazy"); expect(image.getBoundingClientRect().height).toBeLessThanOrEqual(201) }
      const scrolls = [...dialog.querySelectorAll<HTMLElement>("*")].filter(el => /^(auto|scroll)$/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)
      expect(scrolls.every(el => el === body)).toBe(true)
      await page.screenshot({ path: `${evidence}/${width}-${height}-${panel}-top.png` })
      if (panel === "status") {
        await page.getByText("座位2 · 缄默护罩 · 剩余2次", { exact: true }).click()
        await page.getByRole("button", { name: "使用卡牌", exact: true }).click()
        expect(controls.play).toHaveBeenLastCalledWith(expect.objectContaining({ instanceId: "dispel", selections: { status: "shield-other" } }))
      }
      if (panel === "ability" || panel === "poker") {
        await page.getByText("候选 1", { exact: true }).click()
        await expect.element(page.getByRole("button", { name: "选择这张牌", exact: true })).toBeEnabled()
        await page.getByRole("button", { name: "选择这张牌", exact: true }).click()
        expect(controls.choose).toHaveBeenLastCalledWith(0)
      }
      if (body.scrollHeight > body.clientHeight + 1) { body.scrollTop = body.scrollHeight; expect(body.scrollTop).toBeGreaterThan(0); fits(footer, "scrolled footer") }
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
      await page.screenshot({ path: `${evidence}/${width}-${height}-${panel}.png` })
      await userEvent.keyboard("{Escape}")
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument()
      if (panel !== "settlement") await expect.element(page.getByRole("button", { name: "打开测试面板", exact: true })).toHaveFocus()
    } finally { await screen.unmount() }
  })
}
it("850px两侧切换和卡牌面板开关复用原画布，减少动态效果仍可操作", async () => {
  const original = window.matchMedia.bind(window)
  const spy = vi.spyOn(window, "matchMedia").mockImplementation(query => query.includes("prefers-reduced-motion") ? { ...original(query), matches: true, addEventListener: noop, removeEventListener: noop } : original(query))
  await page.viewport(851, 700)
  const screen = await render(<div className="h-dvh"><Table table={table} perspective="owner" onPerspective={noop} onBack={noop} identityKey="card-browser" /></div>)
  try {
    const canvas = document.querySelector(".poker-canvas")!
    await page.getByRole("button", { name: "卡牌", exact: true }).click()
    await expect.element(page.getByRole("dialog")).toBeVisible()
    await userEvent.keyboard("{Escape}")
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
