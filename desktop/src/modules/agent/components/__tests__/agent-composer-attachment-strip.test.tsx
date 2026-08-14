/**
 * @vitest-environment jsdom
 */
import { act, type Ref } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createImageAttachment, createPathAttachment } from "../../attachments"
import { AgentComposerAttachmentStrip } from "../agent-composer-attachment-strip"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  value: vi.fn(),
})
Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  value: vi.fn(),
})

const track = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: () => "button",
  mergeRefs: (...refs: Array<Ref<HTMLElement> | undefined>) => (node: HTMLElement | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    }
  },
  track,
}))

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("AgentComposerAttachmentStrip", () => {
  it("renders compact two-line attachment items without file icons", () => {
    const attachment = createPathAttachment({
      id: "path-1",
      path: "/Users/liyang/Desktop/薪资等级.xlsx",
      entryType: "file",
      size: 10 * 1024,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    const html = renderToStaticMarkup(
      <AgentComposerAttachmentStrip
        attachments={[attachment]}
        onRemove={vi.fn()}
      />,
    )

    expect(html).toContain("agent-composer-attachment-strip")
    expect(html).toContain("agent-composer-attachment-strip__viewport")
    expect(html).toContain('role="list"')
    expect(html).toContain('aria-label="附件"')
    expect(html).toContain('role="listitem"')
    expect(html).toContain("薪资等级.xlsx")
    expect(html).toContain("Excel · 10 KB")
    expect(html).toContain('title="/Users/liyang/Desktop/薪资等级.xlsx"')
    expect(html).toContain("flex-nowrap")
    expect(html).toContain("w-44")
    expect(html).not.toContain("w-52")
    expect(html).toContain("bg-muted/60")
    expect(html).toContain("hover:bg-muted")
    expect(html).toContain("tabular-nums")
    expect(html).toContain("after:-inset-2")
    expect(html).toContain("active:scale-[0.96]")
    expect(html).toContain("transition-[opacity,scale]")
    expect(html).toContain("motion-reduce:transition-none")
    expect(html).toContain("motion-reduce:active:scale-100")
    expect(html).not.toContain("transition-all")
    expect(html).not.toContain("blur-[4px]")
    expect(html).not.toContain("blur-0")
    expect(html).toContain("group-hover:opacity-100")
    expect(html).toContain("group-focus-within:opacity-100")
    expect(html).toContain('aria-label="删除附件 薪资等级.xlsx"')
    expect(html).toContain('data-variant="default"')
    expect(html).not.toContain("lucide-file")
    expect(html).not.toContain("lucide-folder")
    expect(html).not.toContain("lucide-image")
  })

  it("renders image thumbnails on the left and opens an ordered lightbox group", async () => {
    const createObjectURL = vi.mocked(URL.createObjectURL)
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:screen")
    const revokeObjectURL = vi.mocked(URL.revokeObjectURL).mockImplementation(() => undefined)
    const onRemove = vi.fn()
    const firstImage = createImageAttachment({
      id: "image-0",
      name: "first.png",
      mimeType: "image/png",
      size: 2,
      bytes: Uint8Array.from([8, 9]).buffer,
    })
    const image = createImageAttachment({
      id: "image-1",
      name: "screen.png",
      mimeType: "image/png",
      size: 3,
      bytes: Uint8Array.from([1, 2, 3]).buffer,
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposerAttachmentStrip
          attachments={[firstImage, image]}
          onRemove={onRemove}
        />,
      )
    })

    const previewButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="预览图片 screen.png"]',
    )
    const removeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="删除附件 screen.png"]',
    )
    const card = previewButton?.closest('[role="listitem"]')
    const thumbnail = previewButton?.querySelector("img")
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(card?.className).toContain("w-52")
    expect(previewButton?.className).toContain("size-10")
    expect(thumbnail?.getAttribute("src")).toBe("blob:screen")
    expect(thumbnail?.className).toContain("object-cover")

    await act(async () => previewButton?.click())
    expect(track).toHaveBeenCalledWith({
      component: "button",
      name: "agent-attachment-preview-open",
      action: "click",
    })
    expect(document.querySelector("[data-image-lightbox]")?.textContent).toContain("2 / 2")
    expect(document.querySelector("[data-image-lightbox-active]")?.getAttribute("src")).toBe("blob:screen")
    expect(previewButton?.disabled).toBe(false)

    await act(async () => removeButton?.click())
    expect(onRemove).toHaveBeenCalledWith("image-1")

    await act(async () => {
      root.render(
        <AgentComposerAttachmentStrip
          attachments={[]}
          onRemove={onRemove}
        />,
      )
    })
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first")
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:screen")
  })

  it("shows directional controls only while more attachments remain", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const attachments = Array.from({ length: 5 }, (_, index) => createPathAttachment({
      id: `path-${index}`,
      path: `/Users/liyang/Desktop/file-${index}.pdf`,
      entryType: "file",
      size: 1024,
    }))

    await act(async () => {
      root.render(
        <AgentComposerAttachmentStrip
          attachments={attachments}
          onRemove={vi.fn()}
        />,
      )
    })

    const viewport = container.querySelector<HTMLElement>(".agent-composer-attachment-strip__viewport")
    expect(viewport).toBeTruthy()
    Object.defineProperties(viewport!, {
      clientWidth: { configurable: true, value: 400 },
      scrollWidth: { configurable: true, value: 800 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    })
    const scrollBy = vi.fn()
    Object.defineProperty(viewport!, "scrollBy", { configurable: true, value: scrollBy })

    await act(async () => {
      viewport!.dispatchEvent(new Event("scroll", { bubbles: true }))
    })
    const leftButton = container.querySelector<HTMLButtonElement>('button[aria-label="向左查看附件"]')
    const rightButton = container.querySelector<HTMLButtonElement>('button[aria-label="向右查看附件"]')
    expect(leftButton).toBeTruthy()
    expect(rightButton).toBeTruthy()
    expect(leftButton?.getAttribute("aria-hidden")).toBe("true")
    expect(leftButton?.tabIndex).toBe(-1)
    expect(rightButton?.getAttribute("aria-hidden")).toBe("false")
    expect(rightButton?.tabIndex).toBe(0)
    expect(rightButton?.className).toContain("size-7")
    expect(rightButton?.className).toContain("after:-inset-1.5")
    expect(rightButton?.className).toContain("active:not-aria-[haspopup]:-translate-y-1/2")
    expect(rightButton?.className).not.toContain("size-10")
    expect(rightButton?.className).not.toContain("active:not-aria-[haspopup]:translate-y-px")

    await act(async () => rightButton?.click())
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }))
    expect(scrollBy.mock.calls[0]?.[0]?.left).toBeGreaterThan(0)

    viewport!.scrollLeft = 200
    await act(async () => viewport!.dispatchEvent(new Event("scroll", { bubbles: true })))
    expect(leftButton?.getAttribute("aria-hidden")).toBe("false")
    expect(rightButton?.getAttribute("aria-hidden")).toBe("false")

    viewport!.scrollLeft = 400
    await act(async () => viewport!.dispatchEvent(new Event("scroll", { bubbles: true })))
    expect(leftButton?.getAttribute("aria-hidden")).toBe("false")
    expect(rightButton?.getAttribute("aria-hidden")).toBe("true")
  })
})
