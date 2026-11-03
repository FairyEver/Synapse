/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { cardTable } from "./card-stage-fixture"
import { HumanControls } from "../components/HumanControls"
import { usePokerCards } from "../hooks/usePokerCards"
import { cardIntentStore } from "../lib/card-intent-store"
import { projectTable } from "../lib/view"
const api = vi.hoisted(() => ({ play: vi.fn(), choose: vi.fn(), state: vi.fn(), action: vi.fn(), roll: vi.fn() }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { card: { play: api.play, choose: api.choose }, table: { state: api.state }, action: { act: api.action }, roll: { start: api.roll } } }) }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", connectivity: "online", profile: { user: { id: "card-ui" } } } }) }))
vi.mock("@heroui/react", async original => ({ ...await original<typeof import("@heroui/react")>(), toast: Object.assign(vi.fn(), { danger: vi.fn(), success: vi.fn(), update: vi.fn() }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
const roots = new Set<Root>()
beforeEach(() => { vi.clearAllMocks(); api.play.mockResolvedValue({ ok: true, actionSeq: 4 }); api.choose.mockResolvedValue({ ok: true, actionSeq: 4 }); api.action.mockResolvedValue({ ok: true }); api.state.mockResolvedValue(cardTable) })
afterEach(async () => { for (const root of roots) await act(async () => root.unmount()); roots.clear(); sessionStorage.clear(); vi.restoreAllMocks(); document.body.replaceChildren() })
async function mount(content: React.ReactNode) { const host = document.createElement("div"), root = createRoot(host); roots.add(root); document.body.append(host); await act(async () => root.render(content)); return root }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === label || b.getAttribute("aria-label") === label)!
async function click(label: string) { await act(async () => button(label).click()) }
async function openCard() { await click("卡牌"); await act(async () => document.querySelector<HTMLButtonElement>('button[data-held-card="card-instance"]')!.click()) }
it("打开及选中不施放，选择合法目标后明确确认才付款，携带报价版本", async () => {
  await mount(<HumanControls table={cardTable} perspective="owner" identityKey="open-card" onRefresh={vi.fn()} />)
  await openCard(); expect(api.play).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("实付 2 筹码")
  for (const [name, value] of [["hole", "1"], ["player", "1"]]) await act(async () => document.querySelector<HTMLButtonElement>(`button[data-choice="${name}"][value="${value}"]`)!.click())
  await click("使用卡牌")
  expect(api.play).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instanceId: "card-instance", selections: { hole: "1", player: "1" }, expectedPaymentVersion: "card-quote", expectedActionSeq: 3, controlVersion: 2 }))
  expect(api.play.mock.calls[0][0]).not.toHaveProperty("caller")
})
it("公开视角本地剥离持牌、候选、情报、报价与付款版本，DOM无私密名称", async () => {
  const table = projectTable(cardTable, "public")
  expect(table.cards).not.toHaveProperty("ownHand"); expect(table.cards).not.toHaveProperty("definitions"); expect(table).not.toHaveProperty("paymentVersion")
  await mount(<HumanControls table={table} perspective="public" identityKey="public-card" onRefresh={vi.fn()} />)
  expect(document.body.textContent).not.toContain("偷梁换柱"); expect(button("卡牌")).toBeUndefined()
})
it("存储失败只禁止新的卡牌写，不误禁合法普通行动", async () => {
  const bad = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied") })
  await mount(<HumanControls table={{ ...cardTable, cards: { ...cardTable.cards!, ownHand: [{ ...cardTable.cards!.ownHand![0], choices: [] }] } }} perspective="owner" identityKey="card-storage-fail" onRefresh={vi.fn()} />)
  await openCard(); await click("使用卡牌"); expect(api.play).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("恢复记录")
  bad.mockRestore(); await click("关闭卡牌")
  const check = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.startsWith("过牌"))!
  expect(check.disabled).toBe(false); await act(async () => check.click()); expect(api.action).toHaveBeenCalledOnce()
  expect(api.action.mock.calls[0][0].expectedPaymentVersion).toBe("bet-quote")
})
let controls!: ReturnType<typeof usePokerCards>
function Harness({ table = cardTable, identity = "card-hook", refresh = vi.fn() }: { table?: PokerTableView; identity?: string; refresh?: () => void }) { controls = usePokerCards(table, "owner", refresh, identity); return null }
const input = { roomCode: "1234", handId: "card-ui-hand", street: "flop" as const, expectedActionSeq: 3, controlVersion: 2, actionId: "8529bfca-a8e8-4de4-89da-162f516d2f01", expectedPaymentVersion: "card-quote", instanceId: "card-instance", selections: { hole: "0", player: "1" } }
it("硬刷新从持久参数核对原UUID，不被新手/序号/控制版本改写", async () => {
  const scope = { identityKey: "hard-card", roomCode: "1234" }
  cardIntentStore.save(scope, { operation: "play", input })
  await mount(<Harness identity="hard-card" table={{ ...cardTable, handId: "new-hand", actionSeq: 10, controlVersion: 9 }} />)
  expect(controls.uncertain).toBe(true); expect(api.play).not.toHaveBeenCalled()
  await act(async () => controls.retry()); expect(api.play).toHaveBeenCalledExactlyOnceWith(input)
  expect(api.state.mock.invocationCallOrder[0]).toBeLessThan(api.play.mock.invocationCallOrder[0]); expect(controls.uncertain).toBe(false)
})
it.each(["account", "room", "point"])("%s变化的迟到响应不刷新新上下文", async change => {
  let resolve!: (v: unknown) => void; api.play.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const refresh = vi.fn(), identity = `late-card-${change}`, root = await mount(<Harness identity={identity} refresh={refresh} />)
  await act(async () => { void controls.play(input) })
  await act(async () => root.render(<Harness identity={change === "account" ? "other" : identity} table={{ ...cardTable, ...(change === "room" ? { roomCode: "5678" } : change === "point" ? { actionSeq: 4 } : {}) }} refresh={refresh} />))
  await act(async () => resolve({ ok: true })); expect(refresh).not.toHaveBeenCalled(); expect(controls.busy).toBe(false)
})
it("未知用牌使普通下注与Roll等待；只有原请求可核对", async () => {
  api.play.mockRejectedValueOnce(new Error("响应丢失"))
  cardIntentStore.save({ identityKey: "unknown-card", roomCode: "1234" }, { operation: "play", input })
  await mount(<HumanControls table={cardTable} perspective="owner" identityKey="unknown-card" onRefresh={vi.fn()} />)
  const check = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.startsWith("过牌"))!
  expect(check.disabled).toBe(true); expect(api.action).not.toHaveBeenCalled()
})
it("持久候选关闭面板仍保留，只选择真实索引且不再收费", async () => {
  const table = { ...cardTable, cards: { ...cardTable.cards!, pending: { choiceId: "choice-1", origin: "card" as const, kind: "poker" as const, paymentVersion: "paid-quote", candidates: ["2c", "3c", "4c"] } } }
  await mount(<Harness table={table} identity="pending-card" />)
  await act(async () => controls.choose(9)); expect(api.choose).not.toHaveBeenCalled()
  await act(async () => controls.play(input)); expect(api.play).not.toHaveBeenCalled()
  await act(async () => controls.choose(1)); expect(api.choose).toHaveBeenCalledWith(expect.objectContaining({ choiceId: "choice-1", candidateIndex: 1, expectedPaymentVersion: "paid-quote" }))
})
it.each(["ability", "status", "color"] as const)("%s选择只提交服务端列出的真实选项", async kind => {
  const table = { ...cardTable, cards: { ...cardTable.cards!, ownHand: [{ ...cardTable.cards!.ownHand![0], choices: [{ key: kind, label: kind, kind, options: [{ value: "server-option", label: "合法目标" }] }] }] } }
  await mount(<HumanControls table={table} perspective="owner" identityKey={`target-${kind}`} onRefresh={vi.fn()} />)
  await openCard(); await act(async () => document.querySelector<HTMLButtonElement>(`button[data-choice="${kind}"][value="server-option"]`)!.click())
  await click("使用卡牌"); expect(api.play.mock.calls[0][0].selections).toEqual({ [kind]: "server-option" })
})
it.each(["transport", "domain"])("%s失败只有确定领域拒绝才清理原请求", async kind => {
  api.play.mockRejectedValueOnce(kind === "transport" ? new Error("网络中断") : Object.assign(new Error("报价变化"), { code: "POKER_CARD_PRICE_CHANGED" }))
  await mount(<Harness identity={`reject-${kind}`} />); await act(async () => controls.play(input))
  expect(controls.uncertain).toBe(kind === "transport"); expect(api.play).toHaveBeenCalledOnce()
})
it("待选可关闭重开，普通行动保持禁用；行动点变化清掉未提交选择", async () => {
  const refresh = vi.fn(), identity = "choice-reopen", table = { ...cardTable, cards: { ...cardTable.cards!, pending: { choiceId: "reopen-choice", kind: "poker" as const, origin: "card" as const, paymentVersion: "original-paid", candidates: ["2c", "3c", "4c"] } } }
  const root = await mount(<HumanControls table={table} perspective="owner" identityKey={identity} onRefresh={refresh} />)
  expect(document.querySelector('button[data-choice="candidate"]')).not.toBeNull()
  await click("关闭卡牌"); expect(document.querySelector('[role="dialog"]')).toBeNull(); await click("卡牌")
  expect(document.querySelectorAll('button[data-choice="candidate"]')).toHaveLength(3); expect(api.choose).not.toHaveBeenCalled()
  await click("关闭卡牌")
  await act(async () => root.render(<HumanControls table={cardTable} perspective="owner" identityKey={identity} onRefresh={refresh} />))
  await openCard(); await act(async () => document.querySelector<HTMLInputElement>('button[data-choice="hole"][value="0"]')!.click())
  await act(async () => root.render(<HumanControls table={{ ...cardTable, actionSeq: 4 }} perspective="owner" identityKey={identity} onRefresh={refresh} />))
  await click("卡牌"); expect(document.querySelector<HTMLButtonElement>('button[data-held-card="card-instance"]')!.getAttribute("aria-pressed")).not.toBe("true"); expect(api.play).not.toHaveBeenCalled()
})
