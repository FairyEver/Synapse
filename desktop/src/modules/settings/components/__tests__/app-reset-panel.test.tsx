/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

import { AppResetPanel } from "@/modules/settings/components/app-reset-panel"

vi.mock("@/app-shell/identity-context", () => ({
  useLocalIdentity: () => ({
    localIdentityState: {
      status: "ready",
      identity: { userId: "user-a" },
    },
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({ warning: vi.fn() }),
}))

vi.mock("@/components/delayed-confirm-alert-dialog", () => ({
  DelayedConfirmAlertDialog: () => null,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("AppResetPanel", () => {
  it("keeps the warning with the label and aligns the reset action to the right", () => {
    const container = document.createElement("div")
    const root = createRoot(container)

    act(() => root.render(<AppResetPanel />))

    const label = container.querySelector("[data-slot='field-label']")
    const description = container.querySelector("[data-slot='field-description']")
    const resetButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "重置")

    expect(label?.contains(description)).toBe(true)
    expect(resetButton?.parentElement?.classList.contains("justify-end")).toBe(true)

    act(() => root.unmount())
  })
})
