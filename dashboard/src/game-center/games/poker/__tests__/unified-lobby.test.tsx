/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { Lobby } from "../components/Lobby"

const api = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock("@/game-center/runtime/account", () => ({
  useAccount: () => ({ state: { status: "authenticated", profile: { user: { id: "viewer" } } } }),
}))
vi.mock("../../../lib/api", () => ({
  gameApi: () => ({ hall: { overview: async () => ({ sessions: [] }) }, poker: { lobby: { list: api.list } } }),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("统一房间列表", () => {
  it("同时展示两类房间及其类型，翻页沿用全部类型且可打开任意房间", async () => {
    const room = { ownerUserId: "owner", maxSeats: 6, buyIn: 1000, status: "waiting", smallBlind: 1, bigBlind: 2, players: 2 }
    api.list.mockReset()
      .mockResolvedValueOnce({ items: [
        { ...room, roomCode: "1001", name: "点数牌桌", mode: "points" },
        { ...room, roomCode: "1002", name: "练习牌桌", mode: "practice" },
      ], nextOffset: 50 })
      .mockResolvedValueOnce({ items: [{ ...room, roomCode: "1003", name: "下一桌", mode: "practice" }], nextOffset: null })
    const host = document.createElement("div"), root = createRoot(host), onRoom = vi.fn()
    try {
      await act(async () => root.render(<Lobby onRoom={onRoom} />))
      expect(api.list).toHaveBeenLastCalledWith({ offset: 0, limit: 50, mode: "all" })
      expect(host.querySelector('[role="group"][aria-label="房间类型"]')).toBeNull()
      const rooms = [...host.querySelectorAll("li")]
      expect(rooms).toHaveLength(2)
      expect(rooms[0].textContent).toContain("点数房")
      expect(rooms[1].textContent).toContain("陪练房")
      expect(rooms[1].textContent).toContain("初始筹码")
      await act(async () => rooms[1].querySelector("button")!.click())
      expect(onRoom).toHaveBeenCalledWith("1002")
      await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "下一页")!.click())
      expect(api.list).toHaveBeenLastCalledWith({ offset: 50, limit: 50, mode: "all" })
      expect(host.textContent).toContain("下一桌")
      expect(host.textContent).not.toContain("点数牌桌")
      expect([...host.querySelectorAll("button")].find((button) => button.textContent === "下一页")!.disabled).toBe(true)
    } finally {
      await act(async () => root.unmount())
    }
  })
})
