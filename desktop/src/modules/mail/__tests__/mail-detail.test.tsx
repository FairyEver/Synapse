/** @vitest-environment jsdom */
import { mount, detail } from "./harness"
import { act } from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { MailDetail } from "../message-detail"

const observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = []
beforeEach(() => {
  observers.length = 0
  vi.stubGlobal("ResizeObserver", class {
    disconnect = vi.fn()
    constructor(public callback: () => void) { observers.push(this) }
    observe() {}
  })
})
afterEach(() => vi.unstubAllGlobals())

function renderDetail(html: string, onLink = vi.fn()) {
  mount(<MailDetail detail={detail} body={{ html, text: "正文", complete: true, truncated: false }} resources={{ cid: {}, remote: {} }} onBack={() => undefined} onResource={() => undefined} onDownload={() => undefined} onLink={onLink} onReply={() => undefined} onCopy={() => undefined} />)
  const iframe = document.querySelector("iframe")!
  // jsdom does not load srcdoc. Populate the frame with the application's sanitized output.
  const doc = iframe.contentDocument!
  doc.open(); doc.write(iframe.srcdoc); doc.close()
  act(() => iframe.dispatchEvent(new Event("load")))
  return { iframe, doc }
}

it("opens a body link through the controlled handler without duplicating it above the message", () => {
  const onLink = vi.fn()
  const { doc } = renderDetail('<p>正文 <a href="https://example.com/doc"><strong>需求文档</strong></a></p>', onLink)
  expect(document.querySelector('article')?.textContent).not.toContain("需求文档")
  const click = new MouseEvent("click", { bubbles: true, cancelable: true })
  act(() => doc.querySelector("strong")!.dispatchEvent(click))
  expect(click.defaultPrevented).toBe(true)
  expect(onLink).toHaveBeenCalledExactlyOnceWith("https://example.com/doc")
  const middleClick = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 })
  act(() => doc.querySelector("a")!.dispatchEvent(middleClick))
  expect(middleClick.defaultPrevented).toBe(true)
  expect(onLink).toHaveBeenCalledTimes(2)
})

it("fits body growth and shrinkage and releases measurements and handlers when replaced", async () => {
  const onLink = vi.fn()
  const { iframe, doc } = renderDetail('<a href="https://example.com/old">旧链接</a>', onLink)
  const bounds = vi.spyOn(doc.body, "getBoundingClientRect").mockReturnValue({ height: 1800 } as DOMRect)
  act(() => iframe.dispatchEvent(new Event("load")))
  expect(iframe.style.height).toBe("1800px")
  const observer = observers.at(-1)!
  bounds.mockReturnValue({ height: 600 } as DOMRect)
  await act(async () => { observer.callback(); await new Promise(resolve => requestAnimationFrame(resolve)) })
  expect(iframe.style.height).toBe("600px")
  const oldLink = doc.querySelector("a")!
  mount(<div>已关闭</div>)
  expect(observer.disconnect).toHaveBeenCalled()
  act(() => oldLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })))
  expect(onLink).not.toHaveBeenCalled()
})
