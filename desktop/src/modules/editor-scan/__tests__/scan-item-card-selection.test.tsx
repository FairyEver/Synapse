/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { toast } from "sonner"
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
    const cardAction = document.querySelector<HTMLElement>("[data-scan-item-card-action]")

    await act(async () => {
      cardAction?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("aligns the checkbox and path with the card content column", async () => {
    await renderCard()
    const checkbox = document.querySelector<HTMLElement>('button[role="checkbox"]')
    const cardAction = document.querySelector<HTMLElement>("[data-scan-item-card-action]")
    const pathButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("/skills/jenkins"))

    expect(checkbox?.className).toContain("mt-0.5")
    expect(cardAction?.parentElement).toBe(pathButton?.parentElement)
    expect(cardAction?.parentElement?.className).toContain("min-w-0 flex-1")
    expect(pathButton?.querySelector("svg")).toBeNull()
  })

  it("exposes the card body as a keyboard button", async () => {
    const { onClick } = await renderCard()
    const card = document.querySelector<HTMLElement>("[data-scan-item-card]")
    const cardAction = document.querySelector<HTMLElement>("[data-scan-item-card-action]")

    expect(card?.getAttribute("role")).toBeNull()
    expect(cardAction?.getAttribute("role")).toBe("button")
    expect(cardAction?.tabIndex).toBe(0)

    await act(async () => {
      cardAction?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      cardAction?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    })

    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it("does not open the card from keyboard events on nested controls", async () => {
    const { onClick } = await renderCard()
    const checkbox = document.querySelector<HTMLElement>('button[role="checkbox"]')
    const pathButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("/skills/jenkins"))

    await act(async () => {
      checkbox?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
      pathButton?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    expect(onClick).not.toHaveBeenCalled()
  })

  it("reports an open-in-folder error when the bridge is unavailable", async () => {
    const { onClick } = await renderCard()
    const pathButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("/skills/jenkins"))

    await act(async () => {
      pathButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(toast.error).toHaveBeenCalledWith("无法在访达中打开文件。")
    expect(onClick).not.toHaveBeenCalled()
  })
})
