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
})
