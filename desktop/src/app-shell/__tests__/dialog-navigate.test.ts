import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DIALOG_CLOSE_SETTLE_MS, closeDialogThenNavigate, ensureBodyInteractable } from "../dialog-navigate"

const mockBodyStyle: { pointerEvents: string } = { pointerEvents: "" }

beforeEach(() => {
  vi.useFakeTimers()
  mockBodyStyle.pointerEvents = ""
  // @ts-expect-error - mocking document in node test environment
  globalThis.document = { body: { style: mockBodyStyle } }
})

afterEach(() => {
  vi.useRealTimers()
})

describe("DIALOG_CLOSE_SETTLE_MS", () => {
  it("is greater than 150ms to outlast the tw-animate-css default close animation", () => {
    expect(DIALOG_CLOSE_SETTLE_MS).toBeGreaterThan(150)
  })
})

describe("ensureBodyInteractable", () => {
  it("clears body.pointerEvents when it is non-empty", () => {
    mockBodyStyle.pointerEvents = "none"
    ensureBodyInteractable()
    expect(mockBodyStyle.pointerEvents).toBe("")
  })

  it("does not modify body.pointerEvents when it is already empty", () => {
    mockBodyStyle.pointerEvents = ""
    ensureBodyInteractable()
    expect(mockBodyStyle.pointerEvents).toBe("")
  })
})

describe("closeDialogThenNavigate", () => {
  it("calls onClose immediately", () => {
    const onClose = vi.fn()
    const action = vi.fn()
    closeDialogThenNavigate(onClose, action)
    expect(onClose).toHaveBeenCalledOnce()
    expect(action).not.toHaveBeenCalled()
  })

  it("does not call action before DIALOG_CLOSE_SETTLE_MS elapses", () => {
    const action = vi.fn()
    closeDialogThenNavigate(vi.fn(), action)
    vi.advanceTimersByTime(DIALOG_CLOSE_SETTLE_MS - 1)
    expect(action).not.toHaveBeenCalled()
  })

  it("calls action after DIALOG_CLOSE_SETTLE_MS elapses", () => {
    const action = vi.fn()
    closeDialogThenNavigate(vi.fn(), action)
    vi.advanceTimersByTime(DIALOG_CLOSE_SETTLE_MS)
    expect(action).toHaveBeenCalledOnce()
  })

  it("resets body.pointerEvents to empty before calling action", () => {
    mockBodyStyle.pointerEvents = "none"
    let pointerEventsAtCallTime = "not-checked"
    const action = vi.fn(() => {
      pointerEventsAtCallTime = mockBodyStyle.pointerEvents
    })
    closeDialogThenNavigate(vi.fn(), action)
    vi.advanceTimersByTime(DIALOG_CLOSE_SETTLE_MS)
    expect(pointerEventsAtCallTime).toBe("")
  })
})
