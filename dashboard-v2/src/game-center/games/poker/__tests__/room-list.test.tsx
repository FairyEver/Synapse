/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi } from "vitest"
import { RoomList } from "../components/RoomList"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
describe("房间行交互", () => {
  it("进入、接入AI与房主解散保持独立，不能因行点击而误触", async () => {
    const host = document.createElement("div"),
      root = createRoot(host),
      onRoom = vi.fn(),
      onConnect = vi.fn(),
      onClose = vi.fn()
    document.body.append(host)
    await act(async () =>
      root.render(
        <RoomList
          rooms={[
            {
              roomCode: "4821",
              name: "晚间牌桌",
              ownerUserId: "me",
              maxSeats: 6,
              buyIn: 1000,
              status: "running",
              smallBlind: 1,
              bigBlind: 2,
              players: 2,
            },
          ]}
          myRoomCodes={[]}
          userId="me"
          onRoom={onRoom}
          onConnect={onConnect}
          onClose={onClose}
        />,
      ),
    )
    const buttons = [...host.querySelectorAll("button")]
    await act(async () => buttons.find((b) => b.textContent?.includes("接入 AI"))!.click())
    expect(onConnect).toHaveBeenCalledExactlyOnceWith("4821")
    expect(onRoom).not.toHaveBeenCalled()
    await act(async () => buttons.find((b) => b.textContent?.includes("解散"))!.click())
    expect(onClose).toHaveBeenCalledExactlyOnceWith("4821")
    expect(onRoom).not.toHaveBeenCalled()
    await act(async () => buttons.find((b) => b.textContent?.includes("晚间牌桌"))!.click())
    expect(onRoom).toHaveBeenCalledExactlyOnceWith("4821")
    expect(host.querySelector("button button")).toBeNull()
    await act(async () => root.unmount())
    host.remove()
  })
  it("满员和已入座房间仍可观看，但不重复提供接入入口，完整保留房间条件", async () => {
    const host = document.createElement("div"),
      root = createRoot(host),
      onRoom = vi.fn()
    await act(async () =>
      root.render(
        <RoomList
          rooms={[
            {
              roomCode: "5001",
              name: "满员牌桌",
              ownerUserId: "other",
              maxSeats: 2,
              buyIn: 500,
              status: "running",
              smallBlind: 1,
              bigBlind: 2,
              players: 2,
            },
            {
              roomCode: "5002",
              name: "我的牌桌",
              ownerUserId: "other",
              maxSeats: 10,
              buyIn: 5000,
              status: "waiting",
              smallBlind: 1,
              bigBlind: 2,
              players: 1,
            },
          ]}
          myRoomCodes={["5002"]}
          userId="me"
          onRoom={onRoom}
          onConnect={() => {}}
          onClose={() => {}}
        />,
      ),
    )
    expect(host.textContent).not.toContain("接入 AI")
    expect(host.textContent).toContain("满员 · 可观看")
    expect(host.textContent).toContain("已在桌")
    expect(host.textContent).toContain("5,000")
    expect(host.textContent).toContain("1 / 2")
    const buttons = [...host.querySelectorAll("button")]
    expect(buttons).toHaveLength(2)
    await act(async () => buttons[0].click())
    await act(async () => buttons[1].click())
    expect(onRoom.mock.calls).toEqual([["5001"], ["5002"]])
    expect(host.querySelector('input[type="range"]')).toBeNull()
    await act(async () => root.unmount())
  })
  it("房间概览只展示真实人数和不可识别的示意牌背", async () => {
    const host = document.createElement("div"),
      root = createRoot(host)
    await act(async () =>
      root.render(
        <RoomList
          rooms={[
            {
              roomCode: "7321",
              name: "朋友局",
              ownerUserId: "other",
              maxSeats: 6,
              buyIn: 1000,
              status: "waiting",
              smallBlind: 1,
              bigBlind: 2,
              players: 4,
            },
          ]}
          myRoomCodes={[]}
          userId="me"
          onRoom={() => {}}
          onConnect={() => {}}
          onClose={() => {}}
        />,
      ),
    )
    expect(host.textContent).toContain("4 / 6 人")
    expect(host.querySelectorAll('[aria-label="牌背"]')).toHaveLength(2)
    expect(host.querySelector("[data-card]")).toBeNull()
    expect(host.querySelector(".gc-room-art img")).toBeNull()
    expect(host.querySelector("button button")).toBeNull()
    await act(async () => root.unmount())
  })
})
