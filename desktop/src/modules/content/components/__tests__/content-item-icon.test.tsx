/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ContentItemIcon } from "../content-item-icon"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => logger,
}))

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("ContentItemIcon", () => {
  it("evicts the oldest cached icon image after the cache reaches its limit", async () => {
    const readIconImage = vi.fn(async ({ id }: { id: string }) => `data:image/png;base64,${id}`)
    window.synapse = {
      resourceRepository: {
        operation: { readIconImage },
      },
    } as unknown as typeof window.synapse
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    for (let index = 0; index <= 200; index += 1) {
      await renderIcon(root, `item-${index}`)
    }
    expect(readIconImage).toHaveBeenCalledTimes(201)

    await renderIcon(root, "item-0")

    expect(readIconImage).toHaveBeenCalledTimes(202)
  })
})

async function renderIcon(root: Root, contentId: string): Promise<void> {
  await act(async () => {
    root.render(
      <ContentItemIcon
        contentId={contentId}
        contentType="rule"
        icon="file"
        iconImage="icon.png"
        iconType="image"
      />,
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}
