/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DelayedConfirmAlertDialog } from "@/components/delayed-confirm-alert-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("DelayedConfirmAlertDialog", () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it("uses the destructive action variant while the confirmation is delayed", () => {
    vi.useFakeTimers()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <DelayedConfirmAlertDialog
          open
          onOpenChange={() => undefined}
          title="危险操作"
          description="操作不可撤销。"
          confirmLabel="确认删除"
          delaySeconds={3}
          onConfirm={() => undefined}
        />,
      )
    })

    const confirmButton = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent === "确认删除 (3)")

    expect(confirmButton?.dataset.variant).toBe("destructive")
    expect(confirmButton?.disabled).toBe(true)

    act(() => root.unmount())
  })

  it("prevents overlay pointer-down from moving focus out of the alert dialog", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <DelayedConfirmAlertDialog
          open
          onOpenChange={() => undefined}
          title="危险操作"
          description="操作不可撤销。"
          confirmLabel="确认删除"
          delaySeconds={3}
          onConfirm={() => undefined}
        />,
      )
    })

    const overlay = document.body.querySelector<HTMLElement>("[data-slot='alert-dialog-overlay']")
    const pointerDown = new Event("pointerdown", { bubbles: true, cancelable: true })

    expect(overlay?.dispatchEvent(pointerDown)).toBe(false)
    expect(pointerDown.defaultPrevented).toBe(true)

    act(() => root.unmount())
  })
})
