/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AgentShareSelectionContext, ShareMessageFrame } from "../selection-context"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const item = { id: "question", kind: "message" as const, role: "user" as const, content: "select this text", timestamp: "2026-10-24T00:00:00Z" }
const choose = vi.fn(), action = vi.fn()
let host: HTMLDivElement, root: Root
function render(active = true, eligible = true) {
  root.render(<AgentShareSelectionContext.Provider value={{ active, indexes: eligible ? new Map([[item.id, 0]]) : new Map(), selected: new Set(), onChoose: choose, onShare: vi.fn() }}>
    <ShareMessageFrame item={item}><article><p>{item.content}</p><a href="https://example.com" onClick={action}>original link</a><button onClick={action}>original action</button></article></ShareMessageFrame>
  </AgentShareSelectionContext.Provider>)
}
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => render()) })
afterEach(() => { act(() => root.unmount()); host.remove(); window.getSelection()?.removeAllRanges(); vi.clearAllMocks() })

describe("share row selection", () => {
  it("selects from the message area and keeps Shift selection on content clicks", () => {
    act(() => host.querySelector("p")!.click())
    expect(choose).toHaveBeenLastCalledWith(item.id, false)
    act(() => host.querySelector("article")!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })))
    expect(choose).toHaveBeenLastCalledWith(item.id, true)
  })
  it("lets content clicks select without executing their original actions", () => {
    for (const node of host.querySelectorAll<HTMLElement>("article a, article button")) {
      act(() => node.click())
    }
    expect(choose).toHaveBeenCalledTimes(2)
    expect(action).not.toHaveBeenCalled()
  })
  it("toggles exactly once when the checkbox itself is clicked", () => {
    act(() => host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click())
    expect(choose).toHaveBeenCalledExactlyOnceWith(item.id, false)
  })
  it("does not select when the user drags or selects message text", () => {
    const text = host.querySelector("p")!
    const range = document.createRange(); range.selectNodeContents(text); window.getSelection()!.addRange(range)
    act(() => text.click()); expect(choose).not.toHaveBeenCalled()
    window.getSelection()!.removeAllRanges()
    act(() => {
      text.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
      text.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 100, clientY: 10 }))
      text.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
    })
    expect(choose).not.toHaveBeenCalled()
  })
  it("restores normal interaction without replacing message content when selection mode ends", () => {
    const original = host.querySelector("article")
    act(() => render(false))
    expect(host.querySelector("article")).toBe(original)
    act(() => host.querySelector<HTMLButtonElement>("article button")!.click())
    expect(action).toHaveBeenCalledTimes(1); expect(choose).not.toHaveBeenCalled()
  })
  it("does not toggle after dragging inside a checkbox, and a later keyboard click still works", () => {
    const checkbox = host.querySelector<HTMLButtonElement>('[role="checkbox"]')!
    act(() => {
      checkbox.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
      checkbox.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 20, clientY: 10 }))
      checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
    })
    expect(choose).not.toHaveBeenCalled()
    act(() => checkbox.click())
    expect(choose).toHaveBeenCalledExactlyOnceWith(item.id, false)
  })
  it("blocks original actions on unshareable attachment or streaming messages too", () => {
    act(() => render(true, false))
    act(() => host.querySelector<HTMLButtonElement>("article button")!.click())
    expect(host.querySelector('[role="checkbox"]')).toBeNull()
    expect(action).not.toHaveBeenCalled(); expect(choose).not.toHaveBeenCalled()
  })
  it("uses Shift to select messages even when a native text selection already exists", () => {
    const text = host.querySelector("p")!
    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, shiftKey: true, clientX: 10, clientY: 10 })
    act(() => text.dispatchEvent(down))
    expect(down.defaultPrevented).toBe(true)
    const range = document.createRange(); range.selectNodeContents(text); window.getSelection()!.addRange(range)
    act(() => text.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })))
    expect(choose).toHaveBeenCalledExactlyOnceWith(item.id, true)
    expect(window.getSelection()!.isCollapsed).toBe(true)
  })
})
