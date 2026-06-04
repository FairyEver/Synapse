// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HttpRequestConfigForm } from "../config.renderer"
import type { HttpRequestActionConfig } from "../schema"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("HttpRequestConfigForm", () => {
  afterEach(() => {
    document.body.innerHTML = ""
    vi.clearAllMocks()
  })

  it("clears body configuration when switching back to GET", async () => {
    const value: HttpRequestActionConfig = {
      method: "POST",
      url: "https://example.com/api",
      bodyType: "text",
      body: "not allowed on GET",
      timeoutMins: 5,
    }
    const onChange = vi.fn()
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<HttpRequestConfigForm value={value} onChange={onChange} />)
    })
    await act(async () => {
      findButton("GET")?.click()
    })

    expect(onChange).toHaveBeenCalledWith({
      ...value,
      method: "GET",
      bodyType: "none",
      body: undefined,
    })
  })

  it("disables body type choices while GET is selected", async () => {
    const value: HttpRequestActionConfig = {
      method: "GET",
      url: "https://example.com/api",
      bodyType: "none",
      timeoutMins: 5,
    }
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<HttpRequestConfigForm value={value} onChange={vi.fn()} />)
    })

    expect(findButton("JSON")?.disabled).toBe(true)
    expect(findButton("Text")?.disabled).toBe(true)
  })
})

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button"))
    .find((button) => button.textContent === text)
}
