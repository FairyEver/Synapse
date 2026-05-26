/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ScanItemCard } from "../components/scan-item-card"

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
vi.mock("@/lib/electron-bridge", () => ({ getSynapseBridge: () => null }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

async function renderCard(props: Partial<Parameters<typeof ScanItemCard>[0]> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  const onClick = props.onClick ?? vi.fn()
  const onSelectionChange = props.onSelectionChange ?? vi.fn()

  await act(async () => {
    root.render(
      <ScanItemCard
        name="jenkins"
        path="/skills/jenkins"
        source="external"
        preview="Operate Jenkins"
        onClick={onClick}
        selectable
        selected={false}
        onSelectionChange={onSelectionChange}
        {...props}
      />,
    )
  })

  return { onClick, onSelectionChange }
}

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("ScanItemCard selection", () => {
  it("renders a checkbox when selectable", async () => {
    await renderCard()

    expect(document.querySelector('button[role="checkbox"]')).not.toBeNull()
  })

  it("toggles selection without opening the detail card", async () => {
    const { onClick, onSelectionChange } = await renderCard()
    const checkbox = document.querySelector<HTMLElement>('button[role="checkbox"]')

    await act(async () => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSelectionChange).toHaveBeenCalledWith(true)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("keeps card click behavior for the card body", async () => {
    const { onClick } = await renderCard()
    const card = document.querySelector<HTMLElement>("[data-scan-item-card]")

    await act(async () => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
