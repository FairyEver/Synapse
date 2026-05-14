/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

const { rendererLogger } = vi.hoisted(() => ({
  rendererLogger: {
    error: vi.fn(),
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

import { AgentMessageToolbar } from "../agent-message-toolbar"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  rendererLogger.error.mockReset()
  vi.restoreAllMocks()
})

describe("AgentMessageToolbar", () => {
  it("hides invalid timestamps", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentMessageToolbar content="agent response" timestamp="not-a-date" />)
    })

    expect(container.querySelector("time")).toBeNull()
    expect(container.textContent).not.toContain("NaN")
  })

  it("logs clipboard copy failures without logging message content", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard blocked"))
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentMessageToolbar content="secret agent response" timestamp="2026-05-14T00:00:00.000Z" />)
    })

    const button = container.querySelector("button")
    expect(button).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalledWith("secret agent response")
    expect(rendererLogger.error).toHaveBeenCalledWith("Agent message copy failed.", {
      boundary: "renderer.agent.message-toolbar",
      contentLength: 21,
      errorName: "Error",
      errorLength: 17,
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret agent response")
  })
})
