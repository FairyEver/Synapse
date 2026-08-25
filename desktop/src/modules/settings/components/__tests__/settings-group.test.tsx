/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import { SettingsGroup } from "@/modules/settings/components/settings-group"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("SettingsGroup", () => {
  it("provides the named container required by responsive setting rows", () => {
    const container = document.createElement("div")
    const root = createRoot(container)

    act(() => {
      root.render(
        <SettingsGroup>
          <div>设置项</div>
        </SettingsGroup>,
      )
    })

    expect(container.firstElementChild?.classList.contains("@container/field-group")).toBe(true)

    act(() => {
      root.unmount()
    })
  })
})
