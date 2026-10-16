/** @vitest-environment jsdom */
import { act, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useVoiceActionKey } from "../use-voice-action-key"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots.length = 0
  document.body.innerHTML = ""
})

function renderProbe() {
  const onSubmit = vi.fn()
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  function Probe({ active, pending }: { active: boolean; pending: boolean }) {
    const scopeRef = useRef<HTMLDivElement>(null)
    useVoiceActionKey({ active, pending, scopeRef, onSubmit })
    return <div ref={scopeRef}><textarea /><button type="button">完成</button></div>
  }
  const render = (active: boolean, pending = false) => act(() => root.render(<Probe active={active} pending={pending} />))
  render(true)
  return { onSubmit, container, render }
}

function key(target: EventTarget, type = "keydown", init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent(type, { key: "Enter", bubbles: true, cancelable: true, ...init })
  act(() => { target.dispatchEvent(event) })
  return event
}

describe("useVoiceActionKey", () => {
  it.each(["textarea", "button"])("录音时先于 %s 接住回车，阻止原控件执行", (selector) => {
    const { onSubmit, container } = renderProbe()
    const target = container.querySelector(selector)!
    const ordinaryInput = vi.fn()
    target.addEventListener("keydown", ordinaryInput)
    expect(key(target).defaultPrevented).toBe(true)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(ordinaryInput).not.toHaveBeenCalled()
  })

  it("焦点已离开录音按钮时仍能回车提交", () => {
    const { onSubmit } = renderProbe()
    key(window)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("收尾期间连按回车不会再提交，也不会漏给终端", () => {
    const { onSubmit, container, render } = renderProbe()
    const target = container.querySelector("textarea")!
    key(target)
    render(true, true)
    key(target, "keyup")
    expect(key(target).defaultPrevented).toBe(true)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("完成并恢复焦点后，按住回车产生的重复事件仍被拦截，松开后恢复普通输入", () => {
    const { onSubmit, container, render } = renderProbe()
    const target = container.querySelector("textarea")!
    key(target)
    render(false)
    expect(key(target, "keydown", { repeat: true }).defaultPrevented).toBe(true)
    expect(key(target, "keyup").defaultPrevented).toBe(true)
    expect(key(target).defaultPrevented).toBe(false)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it.each([{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }])(
    "不接管修饰键或输入法确认 %j", (init) => {
      const { onSubmit } = renderProbe()
      expect(key(window, "keydown", init).defaultPrevented).toBe(false)
      expect(onSubmit).not.toHaveBeenCalled()
    },
  )

  it("不抢其它输入框或弹窗按钮上的回车", () => {
    const { onSubmit } = renderProbe()
    const outside = document.createElement("input")
    document.body.appendChild(outside)
    expect(key(outside).defaultPrevented).toBe(false)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
