/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { Button } from "@heroui/react"
import { describe, expect, it, vi } from "vitest"
import { SystemAppWindowShell } from "../runtime/page-shell"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("游戏标准组件交互诊断", () => {
  it("HeroUI 标准按钮保留一次交互记录且不携带按钮文案和表单内容", async () => {
    const host = document.createElement("div"), root = createRoot(host), pressed = vi.fn(), listener = vi.fn()
    document.body.append(host)
    window.addEventListener("synapse:game-interaction", listener)
    try {
      await act(async () => root.render(<SystemAppWindowShell><Button onPress={pressed}>私人房间名称</Button></SystemAppWindowShell>))
      await act(async () => host.querySelector("button")!.click())
      expect(pressed).toHaveBeenCalledOnce()
      expect(listener).toHaveBeenCalledOnce()
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ component: "button", action: "click", eventKey: undefined })
    } finally {
      window.removeEventListener("synapse:game-interaction", listener)
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
