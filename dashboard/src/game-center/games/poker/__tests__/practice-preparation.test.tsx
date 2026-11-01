/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { usePracticePreparation } from "../hooks/usePracticePreparation"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"

const api = vi.hoisted(() => ({ state: vi.fn(), add: vi.fn(), join: vi.fn(), control: vi.fn() }))
const identity = vi.hoisted(() => ({ id: "owner" }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", profile: { user: identity } } }) }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { table: { state: api.state }, bot: { add: api.add }, seat: { join: api.join }, control: { set: api.control } } }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let snapshot: PokerTableView, root: Root, host: HTMLElement
const refresh = vi.fn()
function Harness({ target = 3, code = "1234", participation = "human" as "human" | "ai" }) {
  const controls = usePracticePreparation(code, refresh)
  return <><button disabled={controls.busy} onClick={() => void controls.prepare(target, participation)}>准备</button><output>{controls.error}</output></>
}
beforeEach(() => {
  vi.clearAllMocks(); identity.id = "owner"
  snapshot = { ...tableResponse, roomCode: "1234", mode: "practice", ownerUserId: "owner", maxSeats: 4, handId: null, handNo: 0, mySeatNo: null, controller: null, controlVersion: 0, handoffPending: false, seats: [] }
  api.state.mockImplementation(async () => structuredClone(snapshot))
  api.add.mockImplementation(async () => { const botId = `bot-${snapshot.seats.length}`; snapshot.seats.push({ seatNo: snapshot.seats.length, displayName: botId, participantKind: "bot", botId, status: "ready", stack: 500, isMe: false, streetBet: 0, aiState: "bot" }); return { botId, seatNo: snapshot.seats.length - 1 } })
  api.join.mockResolvedValue({ roomCode: "1234", seatNo: 3 }); api.control.mockResolvedValue({})
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const render = async (props = {}) => act(async () => root.render(<Harness {...props} />))
const submit = async () => act(async () => host.querySelector("button")!.click())

it("先配齐三个机器人再本人入座，连续点击不重复执行", async () => {
  await render()
  await act(async () => { host.querySelector("button")!.click(); host.querySelector("button")!.click() })
  expect(api.add).toHaveBeenCalledTimes(3)
  expect(new Set(api.add.mock.calls.map(([input]) => input.creationId)).size).toBe(3)
  expect(api.join).toHaveBeenCalledExactlyOnceWith({ roomCode: "1234" })
  expect(api.add.mock.invocationCallOrder.at(-1)).toBeLessThan(api.join.mock.invocationCallOrder[0])
})

it("部分成功后丢响应，原创建标识确认成功后只补缺少数量", async () => {
  const add = api.add.getMockImplementation()!
  api.add.mockImplementationOnce(add).mockImplementationOnce(async (...args) => { await add(...args); throw new Error("响应丢失") })
  await render(); await submit()
  expect(api.join).not.toHaveBeenCalled()
  expect(snapshot.seats).toHaveLength(2)
  const uncertain = api.add.mock.calls[1][0].creationId
  api.add.mockImplementationOnce(async () => ({ botId: "bot-1", seatNo: 1 })).mockImplementation(add)
  await submit()
  expect(api.add.mock.calls[2][0].creationId).toBe(uncertain)
  expect(snapshot.seats).toHaveLength(3)
  expect(api.join).toHaveBeenCalledOnce()
})

it("外部 AI 方式仅在阵容配好后申请接入，重试已申请结果不重复交接", async () => {
  api.control.mockImplementation(async () => { snapshot.handoffPending = true; snapshot.controlVersion = 1; throw new Error("响应丢失") })
  await render({ participation: "ai" }); await submit(); await submit()
  expect(api.add).toHaveBeenCalledTimes(3)
  expect(api.control).toHaveBeenCalledExactlyOnceWith({ roomCode: "1234", controlVersion: 0, action: "request_ai" })
  expect(api.join).not.toHaveBeenCalled()
})

it.each(["account", "room", "unmount"])("%s 改变后旧请求不继续添加或入座", async change => {
  let resolve!: (value: { botId: string; seatNo: number }) => void
  api.add.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await render(); await submit()
  if (change === "account") { identity.id = "another"; await render() }
  else if (change === "room") await render({ code: "5678" })
  else { await act(async () => root.unmount()); root = createRoot(host) }
  await act(async () => resolve({ botId: "old", seatNo: 0 }))
  expect(api.add).toHaveBeenCalledTimes(1)
  expect(api.join).not.toHaveBeenCalled()
  expect(api.control).not.toHaveBeenCalled()
})

it("为自己保留座位，其他真人占位或权限变化时不继续写入", async () => {
  snapshot.seats = [{ ...tableResponse.seats[0], participantKind: "human", isMe: false }]
  await render(); await submit()
  expect(api.add).not.toHaveBeenCalled()
  expect(host.textContent).toContain("座位")
  snapshot.ownerUserId = "another"
  await submit()
  expect(api.add).not.toHaveBeenCalled()
  expect(api.join).not.toHaveBeenCalled()
})

it("离开后重新进入准备页，丢响应仍复用同一机器人创建标识", async () => {
  const add = api.add.getMockImplementation()!
  api.add.mockImplementationOnce(async (...args) => { await add(...args); throw new Error("响应丢失") })
  await render(); await submit()
  const creationId = api.add.mock.calls[0][0].creationId
  await act(async () => root.unmount()); root = createRoot(host)
  api.add.mockImplementationOnce(async () => ({ botId: "bot-0", seatNo: 0 })).mockImplementation(add)
  await render(); await submit()
  expect(api.add.mock.calls[1][0].creationId).toBe(creationId)
  expect(snapshot.seats).toHaveLength(3)
  expect(api.join).toHaveBeenCalledOnce()
})

it("读到过期成员列表时批次有界，未确认配齐前不入座", async () => {
  api.state.mockImplementation(async () => ({ ...snapshot, seats: [] }))
  api.add.mockResolvedValue({ botId: "confirmed", seatNo: 0 })
  await render(); await submit()
  expect(api.add).toHaveBeenCalledTimes(3)
  expect(api.join).not.toHaveBeenCalled()
  expect(host.textContent).toContain("成员状态已变化")
})

it("入座写入成功后刷新失败明确标记已完成，重试只读取已入座结果", async () => {
  api.join.mockImplementation(async () => { snapshot.mySeatNo = 3; return { roomCode: "1234", seatNo: 3 } })
  refresh.mockRejectedValueOnce(new Error("刷新失败"))
  await render(); await submit()
  expect(host.textContent).toContain("准备已完成")
  await submit()
  expect(api.join).toHaveBeenCalledOnce()
  expect(api.add).toHaveBeenCalledTimes(3)
})
