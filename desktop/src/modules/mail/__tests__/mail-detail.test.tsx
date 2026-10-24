/** @vitest-environment jsdom */
import { mount, detail } from "./harness"
import { act, type ComponentProps } from "react"
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

function renderDetail(html: string, onLink = vi.fn(), mail: ComponentProps<typeof MailDetail>["detail"] = detail) {
  mount(<MailDetail detail={mail} body={{ html, text: "正文", complete: true, truncated: false }} resources={{ cid: {}, remote: {} }} onBack={() => undefined} onResource={() => undefined} onDownload={() => undefined} onLink={onLink} onReply={() => undefined} onCopy={() => undefined} />)
  const iframe = document.querySelector("iframe")!
  // jsdom does not load srcdoc. Populate the frame with the application's sanitized output.
  const doc = iframe.contentDocument!
  doc.open(); doc.write(iframe.srcdoc); doc.close()
  act(() => iframe.dispatchEvent(new Event("load")))
  return { iframe, doc }
}

it.each(["mouse", "touch"])("dismisses address popovers on %s interaction in the isolated body", async pointerType => {
  const onLink = vi.fn()
  const { doc } = renderDetail('<p>正文</p><a href="https://example.com/doc">文档</a>', onLink, {
    ...detail, to: [{ name: "收件人", address: "recipient@example.com" }],
  })
  const openAddress = async () => {
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="收件人，查看邮箱地址"]')!.click())
    // Radix installs outside pointer listeners on the next task.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  }
  await openAddress()
  const popover = document.querySelector('[role="dialog"]')!
  act(() => popover.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType })))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  for (const target of [doc.querySelector("p")!, doc.querySelector("a")!]) {
    act(() => {
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType }))
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    if (target.tagName === "P") await openAddress()
  }
  expect(onLink).toHaveBeenCalledExactlyOnceWith("https://example.com/doc")
  await openAddress()
  act(() => {
    document.querySelector("h2")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType }))
    document.querySelector("h2")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

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

it("keeps the isolated reading colors in sync with the app theme and stops syncing after unmount", async () => {
  const root = document.documentElement
  const originalStyle = root.getAttribute("style")
  const originalClass = root.getAttribute("class")
  try {
    root.classList.remove("dark")
    root.style.setProperty("--link", "steelblue")
    root.style.setProperty("--link-hover", "navy")
    root.style.setProperty("--foreground", "black")
    root.style.setProperty("--background", "white")
    const { iframe, doc } = renderDetail('<a href="https://example.com/doc">文档</a>')
    expect(doc.documentElement.style.getPropertyValue("--link")).toBe("steelblue")
    expect(doc.documentElement.style.getPropertyValue("--link-hover")).toBe("navy")
    expect(doc.documentElement.style.getPropertyValue("--foreground")).toBe("black")
    expect(doc.documentElement.style.getPropertyValue("--background")).toBe("white")
    expect(doc.documentElement.style.colorScheme).toBe("light")
    await act(async () => {
      root.classList.add("dark")
      root.style.setProperty("--link", "lightskyblue")
    })
    expect(iframe.contentDocument).toBe(doc)
    expect(doc.documentElement.style.getPropertyValue("--link")).toBe("lightskyblue")
    expect(doc.documentElement.style.colorScheme).toBe("dark")
    mount(<div>已关闭</div>)
    await act(async () => { root.style.setProperty("--link", "steelblue") })
    expect(doc.documentElement.style.getPropertyValue("--link")).toBe("lightskyblue")
  } finally {
    if (originalStyle === null) root.removeAttribute("style")
    else root.setAttribute("style", originalStyle)
    if (originalClass === null) root.removeAttribute("class")
    else root.setAttribute("class", originalClass)
  }
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
  const onFrameInteraction = vi.fn()
  iframe.addEventListener("pointerdown", onFrameInteraction)
  iframe.addEventListener("click", onFrameInteraction)
  mount(<div>已关闭</div>)
  expect(observer.disconnect).toHaveBeenCalled()
  act(() => oldLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })))
  act(() => oldLink.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })))
  expect(onLink).not.toHaveBeenCalled()
  expect(onFrameInteraction).not.toHaveBeenCalled()
})
