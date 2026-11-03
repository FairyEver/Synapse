/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { PokerCardsDialog } from "../components/PokerCardsDialog"
import { MatchOverview } from "../components/MatchOverview"
import { cardTable } from "./card-stage-fixture"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
const roots: Root[] = []
const controls = () => ({ blocked: false, storageError: false, canControl: true, busy: false, uncertain: false, error: null, play: vi.fn(), choose: vi.fn(), retry: vi.fn() })
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren() })
async function mount(table = cardTable) {
  const host = document.createElement("div"), root = createRoot(host), actions = controls()
  roots.push(root); document.body.append(host)
  const render = (snapshot = table, open = true, epoch = "owner:room:hand:3") => act(async () => root.render(<PokerCardsDialog table={snapshot} open={open} onOpenChange={vi.fn()} controls={actions} disabled={false} epoch={epoch} />))
  await render()
  return { render, actions }
}
async function click(selector: string) { const target = document.querySelector<HTMLButtonElement>(selector)!; expect(target).not.toBeNull(); await act(async () => target.click()) }
const primary = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "使用卡牌")!

it("开牌和检查不自动聚焦、不施放，撤回合法目标后确认立即禁用", async () => {
  const origin = document.createElement("button"); document.body.append(origin); origin.focus()
  const { render, actions } = await mount()
  expect(document.activeElement).toBe(origin)
  await click('button[data-held-card="card-instance"]')
  expect(document.activeElement).toBe(origin); expect(actions.play).not.toHaveBeenCalled()
  await click('button[data-choice="hole"][value="0"]'); await click('button[data-choice="player"][value="1"]')
  expect(primary().disabled).toBe(false)
  const revoked = structuredClone(cardTable); revoked.cards!.ownHand![0].choices[1].options = []
  await render(revoked)
  expect(primary().disabled).toBe(true); await act(async () => primary().click()); expect(actions.play).not.toHaveBeenCalled()
  await render(cardTable)
  expect(primary().disabled).toBe(true)
})
it("对手只显示获准暗牌槽位，更换目标后必须重新猜色", async () => {
  const snapshot = structuredClone(cardTable)
  snapshot.cards!.ownHand![0].choices = [
    { key: "targetHole", label: "目标底牌", kind: "hole", options: [{ value: "1:0", label: "座位2 · 底牌1" }, { value: "1:1", label: "座位2 · 底牌2" }] },
    { key: "color", label: "猜颜色", kind: "color", options: [{ value: "red", label: "红色" }, { value: "black", label: "黑色" }] },
  ]
  const { actions } = await mount(snapshot)
  await click('button[data-held-card="card-instance"]')
  expect(document.querySelectorAll('[data-selector="opponent-hole"] [data-face="down"]')).toHaveLength(2)
  expect(document.querySelector('[data-selector="opponent-hole"] [data-face="up"]')).toBeNull()
  expect(document.querySelector<HTMLButtonElement>('button[data-choice="color"]')!.disabled).toBe(true)
  await click('button[data-choice="targetHole"][value="1:0"]'); await click('button[data-choice="color"][value="red"]')
  expect(primary().disabled).toBe(false)
  await click('button[data-choice="targetHole"][value="1:1"]')
  expect(primary().disabled).toBe(true)
  await click('button[data-choice="color"][value="black"]'); await act(async () => primary().click())
  expect(actions.play).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ selections: { targetHole: "1:1", color: "black" } }))
})
it("待选保留真实索引，关闭重开仍选中；新行动点清空旧选择", async () => {
  const snapshot: PokerTableView = { ...cardTable, cards: { ...cardTable.cards!, pending: { choiceId: "choice", kind: "poker", origin: "card", paymentVersion: "paid", candidates: ["2c"] } } }
  const { render, actions } = await mount(snapshot)
  await click('button[data-choice="candidate"][value="0"]')
  await render(snapshot, false); expect(document.querySelector('[role="dialog"]')).toBeNull()
  await render(snapshot, true)
  expect(document.querySelector('button[data-choice="candidate"]')!.getAttribute("aria-pressed")).toBe("true")
  const choose = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "选择这张牌")!
  await act(async () => choose.click()); expect(actions.choose).toHaveBeenCalledExactlyOnceWith(0)
  await render(snapshot, true, "owner:room:hand:4")
  expect(document.querySelector('button[data-choice="candidate"]')!.getAttribute("aria-pressed")).toBe("false")
})
it("不可主动施放的能力牌仍可作材料，复制与消耗用途不同，同名实例不混淆", async () => {
  const snapshot = structuredClone(cardTable), cards = snapshot.cards!
  cards.definitions!["24"] = { id: "24", name: "弃旧图新", description: "消耗另一张牌", artId: "v1/24", cost: 0, consumeSelected: true }
  cards.ownHand = [{ ...cards.ownHand![0], instanceId: "source", cardId: "24", choices: [{ key: "ability", label: "另一张能力牌", kind: "ability", options: [{ value: "mat-a", label: "偷梁换柱" }, { value: "mat-b", label: "偷梁换柱" }] }] }, ...["mat-a", "mat-b"].map(instanceId => ({ ...cardTable.cards!.ownHand![0], instanceId, available: false }))]
  const { render, actions } = await mount(snapshot)
  await click('button[data-held-card="source"]')
  expect(document.querySelector<HTMLButtonElement>('button[data-choice="ability"][value="mat-b"]')!.disabled).toBe(false)
  await click('button[data-choice="ability"][value="mat-b"]')
  expect(document.body.textContent).toContain("将被消耗")
  await act(async () => primary().click())
  expect(actions.play).toHaveBeenCalledWith(expect.objectContaining({ selections: { ability: "mat-b" } }))
  cards.definitions!["24"].consumeSelected = false
  await render({ ...snapshot, cards: { ...cards } })
  expect(document.body.textContent).toContain("原牌保留")
})
it("能力候选预选后可读完整规则，切换候选不付款、不提前获得", async () => {
  const snapshot = structuredClone(cardTable), definition = snapshot.cards!.definitions!["01"]
  snapshot.cards!.pending = { choiceId: "ability-choice", kind: "ability", origin: "card", paymentVersion: "paid", candidates: ["01"], candidateCards: [{ ...definition, description: "完整候选规则。".repeat(20) }] }
  const { actions } = await mount(snapshot)
  await click('button[data-choice="candidate"][value="0"]')
  expect(document.querySelector(".full-description")?.textContent).toBe("完整候选规则。".repeat(20))
  expect(actions.choose).not.toHaveBeenCalled(); expect(actions.play).not.toHaveBeenCalled()
})
it("候选待选期间可回看本人情报，返回后保留同一张预选而不提交", async () => {
  const snapshot = structuredClone(cardTable)
  snapshot.cards!.pending = { choiceId: "intel-choice", kind: "poker", origin: "card", paymentVersion: "paid", candidates: ["As", "Kh"] }
  snapshot.cards!.privateResults = [{ id: "secret-result", cardId: "13", label: "one", values: ["Qs"], valid: true }]
  const { actions } = await mount(snapshot)
  await click('button[data-choice="candidate"][value="1"]')
  const intel = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.startsWith("情报"))
  expect(intel).toBeDefined(); await act(async () => intel!.click())
  expect(document.querySelector('.intel-values [data-card="Qs"]')).not.toBeNull()
  expect(document.querySelector('[data-choice="candidate"]')).toBeNull()
  await click('button[aria-label="返回选牌"]')
  expect(document.querySelector('button[data-choice="candidate"][value="1"]')!.getAttribute("aria-pressed")).toBe("true")
  expect(actions.choose).not.toHaveBeenCalled(); expect(actions.play).not.toHaveBeenCalled()
})
it("对局总览的公共状态仍能折叠，不受卡牌游戏样式隔离影响", async () => {
  const snapshot = structuredClone(cardTable)
  snapshot.cards!.statuses = [{ id: "shield", cardId: "43", title: "缄默护罩", polarity: "positive", seatNo: 0, remaining: 1, dispellable: true }]
  const host = document.createElement("div"), root = createRoot(host); roots.push(root); document.body.append(host)
  await act(async () => root.render(<MatchOverview table={snapshot} perspective="owner" />))
  const toggle = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.startsWith("生效状态"))
  expect(toggle).toBeDefined(); expect(toggle!.getAttribute("aria-expanded")).toBe("true")
  await act(async () => toggle!.click()); expect(toggle!.getAttribute("aria-expanded")).toBe("false")
  expect(document.querySelector(".stage-statuses")).toBeNull()
})
