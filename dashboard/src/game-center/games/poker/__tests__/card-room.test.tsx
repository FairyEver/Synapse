/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"
import { Lobby } from "../components/Lobby"
import { RoomList } from "../components/RoomList"
import { PokerAIConnectDialog } from "../components/PokerAIConnectDialog"
import { usePokerRoomDraft } from "../hooks/usePokerRoomDraft"
import { usePokerCardAvailability } from "../hooks/usePokerCardAvailability"
const api = vi.hoisted(() => ({ identity: "card-room-user", guide: vi.fn(), create: vi.fn(), state: vi.fn(), control: vi.fn() }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", connectivity: "online", profile: { user: { id: api.identity, nickname: "玩家" } } } }) }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ hall: { overview: async () => ({ sessions: [] }) }, poker: { guide: api.guide, lobby: { list: async () => ({ items: [], nextOffset: null }) }, room: { create: api.create }, table: { state: api.state }, control: { set: api.control } } }) }))
vi.mock("@heroui/react", async original => ({ ...await original<typeof import("@heroui/react")>(), toast: Object.assign(vi.fn(), { danger: vi.fn(), success: vi.fn(), update: vi.fn() }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
const roots = new Set<Root>()
beforeEach(() => { api.identity = "card-room-user"; vi.clearAllMocks(); localStorage.clear(); api.guide.mockResolvedValue({ cards: { available: true, supportedVersions: ["cards-v1", "chips-v2"] } }); api.create.mockResolvedValue({ roomCode: "4567" }) })
afterEach(async () => { for (const root of roots) await act(async () => root.unmount()); roots.clear(); document.body.replaceChildren(); localStorage.clear() })
async function mount(content: React.ReactNode) { const host = document.createElement("div"), root = createRoot(host); roots.add(root); document.body.append(host); await act(async () => root.render(content)); return { host, root } }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === label)!
async function click(label: string) { await act(async () => button(label).click()) }
async function toggle(label: string) { const input = [...document.querySelectorAll<HTMLInputElement>('input[role="switch"]')].find(i => i.closest("label")?.textContent?.includes(label))!; await act(async () => input.click()) }
async function submit() { await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))) }
it.each([[false, false], [true, false], [false, true], [true, true]])("cards=%s roll=%s 独立建房且重试保留原意图", async (cards, roll) => {
  api.create.mockRejectedValueOnce(new Error("响应丢失"))
  await mount(<Lobby onRoom={vi.fn()} />); await click("创建房间")
  if (cards) await toggle("卡牌模式")
  if (roll) await toggle("Roll 换牌")
  await submit(); await submit()
  const [first, second] = api.create.mock.calls.map(([input]) => input)
  expect(first.ruleOptions).toEqual({ cards, roll, ...(roll ? { rollCoins: 12 } : {}) })
  expect(second).toEqual(first)
  expect(first.creationId).toMatch(/^[0-9a-f-]{36}$/)
})
it("关闭门槛保留已记忆cards，不静默变成普通房；guide失败也不可用", async () => {
  localStorage.setItem(`synapse.game.poker-room-preferences.v1:${api.identity}`, JSON.stringify({ mode: "points", variant: "standard52", blindPreset: "1/2", maxSeats: 6, buyIn: 1000, cards: true }))
  api.guide.mockRejectedValue(new Error("读取失败"))
  await mount(<Lobby onRoom={vi.fn()} />); await click("创建房间")
  const input = [...document.querySelectorAll<HTMLInputElement>('input[role="switch"]')].find(i => i.closest("label")?.textContent?.includes("卡牌模式"))!
  expect(input.checked).toBe(true); expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  await submit(); expect(api.create).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain("读取失败")
})
it.each([true, false])("房间列表 cards=%s 只给普通房展示AI接入", async cards => {
  await mount(<RoomList rooms={[{ roomCode: "4567", mode: "practice", ownerUserId: "other", name: "测试房", maxSeats: 6, players: 2, status: "running", buyIn: 1000, smallBlind: 1, bigBlind: 2, rules: { ...tableResponse.rules!, ruleOptions: { cards } } }]} myRoomCodes={[]} userId={api.identity} onRoom={vi.fn()} onConnect={vi.fn()} onClose={vi.fn()} />)
  expect(document.body.textContent?.includes("接入 AI")).toBe(!cards)
  if (cards) expect(document.body.textContent).toContain("卡牌")
})
it("直接打开卡牌AI面板也没有授权或复制指令", async () => {
  await mount(<PokerAIConnectDialog open onOpenChange={vi.fn()} roomCode="4567" table={{ ...tableResponse, ruleOptions: { cards: true } }} onChanged={vi.fn()} />)
  expect(document.body.textContent).toContain("卡牌房仅限真人")
  expect(button("允许 AI 接入并复制指令")).toBeUndefined()
  expect(document.body.textContent).not.toContain("查看完整接入指令")
})
it("迟到的账号偏好与guide不进入新账号状态", async () => {
  let oldGuide!: (value: unknown) => void
  api.guide.mockImplementationOnce(() => new Promise(resolve => { oldGuide = resolve })).mockResolvedValue({ cards: { available: false } })
  let state!: ReturnType<typeof usePokerCardAvailability>, draft!: ReturnType<typeof usePokerRoomDraft>
  function Harness() { state = usePokerCardAvailability(api.identity); draft = usePokerRoomDraft(api.identity, "玩家"); return null }
  const { root } = await mount(<Harness />)
  let oldLoad!: Promise<boolean>
  await act(async () => { oldLoad = draft.loadDraft(); api.identity = "another"; root.render(<Harness />) })
  await act(async () => { oldGuide({ cards: { available: true, supportedVersions: ["cards-v1", "chips-v2"] } }); await oldLoad })
  expect(state.available).toBe(false); expect(draft.draft.cards).toBe(false)
})
