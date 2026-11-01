/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { LobbyView } from "../components/LobbyView"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("房间空状态", () => {
  it("将唯一创建入口放在空状态中，并在列表加载时保留创建入口", async () => {
    const host = document.createElement("div"), root = createRoot(host), onCreate = vi.fn()
    const props = { sessions: [], userId: "viewer", onRoom: vi.fn(), onCreate, onConnect: vi.fn(), onClose: vi.fn() }
    document.body.append(host)
    try {
      await act(async () => root.render(<LobbyView {...props} rooms={[]} />))
      const empty = [...host.querySelectorAll("p")].find(node => node.textContent === "暂无房间")!
      const buttons = [...host.querySelectorAll("button")].filter(button => button.textContent?.includes("创建房间"))
      expect(buttons).toHaveLength(1)
      expect(empty.parentElement?.contains(buttons[0])).toBe(true)
      expect(host.textContent).not.toContain("本页 0 间")
      await act(async () => buttons[0].click())
      expect(onCreate).toHaveBeenCalledOnce()

      await act(async () => root.render(<LobbyView {...props} rooms={null} />))
      expect(host.textContent).not.toContain("暂无房间")
      const create = host.querySelector<HTMLButtonElement>("header button")!
      await act(async () => create.click())
      expect(onCreate).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
