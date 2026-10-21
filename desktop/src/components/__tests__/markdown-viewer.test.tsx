/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { MarkdownViewer } from "../markdown-viewer"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ""
})

describe("MarkdownViewer", () => {
  it.each([false, true])("preserves the reading DOM and text selection on an unrelated rerender (tabs: %s)", (showTabs) => {
    const host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    const content = "正在阅读的正文\n\n![示意图](https://example.com/figure.png)"
    act(() => root?.render(<MarkdownViewer content={content} showTabs={showTabs} surface="plain" />))
    const paragraph = host.querySelector(".markdown-viewer p")!
    const image = host.querySelector("img")!
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    window.getSelection()!.addRange(range)

    act(() => root?.render(<MarkdownViewer content={content} showTabs={showTabs} surface="plain" className="w-full" />))
    expect(host.querySelector(".markdown-viewer p")).toBe(paragraph)
    expect(host.querySelector("img")).toBe(image)
    expect(window.getSelection()!.toString()).toBe("正在阅读的正文")
  })

  it("updates the body when the Markdown content changes", () => {
    const host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(<MarkdownViewer content="旧正文" showTabs={false} />))
    act(() => root?.render(<MarkdownViewer content="**新正文**" showTabs={false} />))
    expect(host.textContent).toBe("新正文\n")
    expect(host.querySelector("strong")?.textContent).toBe("新正文")
  })
})
