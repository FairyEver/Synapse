/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
} from "@/components/ui/dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("DialogFrame", () => {
  it("keeps centered header content independent from the right actions", async () => {
    await renderDialog(
      <DialogFrame>
        <DialogFrameHeader
          title="同步状态"
          center={<div role="tablist">筛选</div>}
          actions={<button type="button">刷新</button>}
        />
      </DialogFrame>,
    )

    const header = getHeader()
    expect(header.className).toContain("grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]")
    expect(header.textContent).toContain("同步状态")
    expect(header.querySelector('[role="tablist"]')?.textContent).toBe("筛选")
    expect(header.querySelector("button")?.textContent).toContain("刷新")

    const closeButton = Array.from(header.querySelectorAll<HTMLButtonElement>('button[data-slot="dialog-close"]'))
      .find((button) => button.textContent?.includes("关闭"))
    expect(closeButton).toBeTruthy()
    expect(closeButton?.className).not.toContain("absolute")
  })

  it("omits the header close button when the frame is intentionally blocking", async () => {
    await renderDialog(
      <DialogFrame>
        <DialogFrameHeader title="迁移知识库存储" showCloseButton={false} />
      </DialogFrame>,
    )

    expect(getHeader().querySelector('[data-slot="dialog-close"]')).toBeNull()
  })

  it("standardizes large dialog frame body and footer layout", async () => {
    await renderDialog(
      <DialogFrame>
        <DialogFrameHeader title="日志" showCloseButton={false} />
        <DialogFrameBody>内容</DialogFrameBody>
        <DialogFrameFooter>
          <button type="button">关闭</button>
        </DialogFrameFooter>
      </DialogFrame>,
    )

    expect(document.querySelector<HTMLElement>('[data-slot="dialog-frame"]')?.className).toContain("flex h-full min-h-0 flex-col overflow-hidden")
    expect(document.querySelector<HTMLElement>('[data-slot="dialog-frame-body"]')?.className).toContain("min-h-0 flex-1")
    expect(document.querySelector<HTMLElement>('[data-slot="dialog-frame-footer"]')?.className).toContain("mx-0 mb-0 shrink-0")
  })
})

async function renderDialog(children: React.ReactNode): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <Dialog open>
        <DialogContent showCloseButton={false} aria-describedby={undefined}>
          {children}
        </DialogContent>
      </Dialog>,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function getHeader(): HTMLElement {
  const header = document.querySelector<HTMLElement>('[data-slot="dialog-frame-header"]')
  if (!header) throw new Error("Dialog frame header not found")
  return header
}
