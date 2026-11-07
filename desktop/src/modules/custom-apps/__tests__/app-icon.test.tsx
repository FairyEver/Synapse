/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { Globe } from "lucide-react"

import { AppEntryIcon } from "../app-icon"
import { CustomAppIconPreview } from "../icon-picker"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | null = null
let container: HTMLDivElement | null = null

describe("custom app icon shape", () => {
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it("uses the squircle class for dock and settings icons", () => {
    render(
      <AppEntryIcon
        icon={{ kind: "image", src: "https://example.com/icon.png" }}
        className="size-5"
      />,
    )

    expect(document.querySelector("img")?.classList.contains("app-icon-squircle")).toBe(true)
  })

  it("uses the same squircle shape in launcher and dialog previews", () => {
    render(<CustomAppIconPreview src="https://example.com/icon.png" size="lg" />)

    expect(document.querySelector("img")?.classList.contains("app-icon-squircle")).toBe(true)
  })

  it("does not apply image clipping to lucide fallback icons", () => {
    render(<AppEntryIcon icon={{ kind: "lucide", icon: Globe }} />)

    expect(document.querySelector("svg")?.classList.contains("app-icon-squircle")).toBe(false)
  })
})

function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(node))
}
