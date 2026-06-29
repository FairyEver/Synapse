/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { ContentItemText } from "@/modules/content/components/content-item-meta"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []
const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight")
const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  if (scrollHeightDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor)
  }
  if (clientHeightDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor)
  }
})

async function renderContentItemText(description: string) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return 120
    },
  })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 40
    },
  })

  await act(async () => {
    root.render(
      <ContentItemText
        description={description}
        descriptionWrap
        title="Gitee 问题跟踪"
      />,
    )
  })

  return { container }
}

describe("ContentItemText", () => {
  it("keeps the full description dialog scrollable and width constrained", async () => {
    const longDescription = [
      "## 1. 触发场景",
      "- 用户要求批量创建 Gitee 任务、项目任务、工作项。",
      "`export ISSUE_GATEKEEPER_SKILL_DIR=\"/实际安装目录/smarterlayer-issue-gatekeeper-with-a-very-long-folder-name\"`",
      "后续命令都默认在 skill 根目录执行。",
    ].join("\n")
    await renderContentItemText(longDescription)

    const moreButton = document.querySelector<HTMLButtonElement>("button")
    expect(moreButton?.textContent).toContain("更多")

    await act(async () => {
      moreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const dialogFrame = document.querySelector<HTMLElement>('[data-slot="dialog-frame"]')
    expect(dialogFrame?.className).toContain("flex")
    expect(dialogFrame?.className).toContain("flex-col")

    const dialogBody = document.querySelector<HTMLElement>('[data-slot="dialog-frame-body"]')
    expect(dialogBody?.className).toContain("min-h-0")
    expect(dialogBody?.className).toContain("flex-1")

    const scrollArea = document.querySelector<HTMLElement>('[data-slot="scroll-area"]')
    expect(scrollArea?.className).toContain("max-h-[calc(70vh-4rem)]")
    expect(scrollArea?.className).toContain("max-w-full")

    const scrollViewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    expect(scrollViewport?.className).toContain("max-h-[calc(70vh-4rem)]")

    const fullDescription = document.querySelector<HTMLElement>('[data-content-full-description="true"]')
    expect(fullDescription?.className).toContain("max-w-full")
    expect(fullDescription?.querySelector(".markdown-viewer")).not.toBeNull()
    expect(fullDescription?.querySelector("h2")?.textContent).toBe("1. 触发场景")
    expect(fullDescription?.textContent).toContain("后续命令都默认在 skill 根目录执行。")
  })
})
