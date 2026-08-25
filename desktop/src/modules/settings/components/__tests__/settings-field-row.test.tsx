/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"

import { SettingsFieldRow } from "@/modules/settings/components/settings-field-row"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("SettingsFieldRow", () => {
  it("keeps descriptive information with the label instead of the control column", () => {
    const container = document.createElement("div")
    const root = createRoot(container)

    act(() => {
      root.render(
        <SettingsFieldRow label="设置标题" description="设置说明">
          <button type="button">操作</button>
        </SettingsFieldRow>,
      )
    })

    const label = container.querySelector("[data-slot='field-label']")
    const description = container.querySelector("[data-slot='field-description']")
    const control = container.querySelector("[data-slot='field-content']")

    expect(label?.contains(description)).toBe(true)
    expect(control?.contains(description)).toBe(false)
    expect(description?.classList.contains("text-pretty")).toBe(true)

    act(() => root.unmount())
  })
})
